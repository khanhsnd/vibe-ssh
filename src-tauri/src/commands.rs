//! Lớp lệnh Tauri — mỏng, chỉ chuyển tiếp sang các module nghiệp vụ.

use crate::error::{AppError, Result};
use crate::ssh::conn::{ConnInfo, ConnectOpts};
use crate::ssh::{conn, sftp, shell, tunnel};
use crate::state::{AppState, TermIn};
use crate::ui::{self, Ui};
use crate::{hostkeys, pty, secrets, sshconfig, store, telnet};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, State};

type St<'a> = State<'a, Arc<AppState>>;

/// Cầu nối tới giao diện, dựng lại cho mỗi lệnh (chỉ là hai `Arc::clone`).
fn ui(app: &AppHandle, state: &St<'_>) -> Ui {
    Ui::tauri(app.clone(), state.asks.clone())
}

// ── Lưu trữ cục bộ ────────────────────────────────────────────────────────

#[tauri::command]
pub fn store_read(file: String) -> Result<Value> {
    store::read_doc(&file)
}

#[tauri::command]
pub fn store_write(file: String, doc: Value) -> Result<()> {
    store::write_doc(&file, &doc)
}

#[tauri::command]
pub fn data_dir() -> String {
    store::data_dir().to_string_lossy().into_owned()
}

// ── Bí mật ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<()> {
    secrets::set(&key, &value)
}

#[tauri::command]
pub fn secret_get(key: String) -> Option<String> {
    secrets::get(&key)
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<()> {
    secrets::delete(&key)
}

// ── Trả lời câu hỏi từ backend ────────────────────────────────────────────

#[tauri::command]
pub async fn answer(state: St<'_>, ask_id: String, value: Value) -> Result<()> {
    ui::answer(&state.asks, &ask_id, value).await;
    Ok(())
}

// ── Kết nối ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: St<'_>,
    opts: ConnectOpts,
) -> Result<ConnInfo> {
    let u = ui(&app, &state);
    let c = conn::connect(u, state.inner().clone(), opts).await?;
    Ok(c.info.clone())
}

#[tauri::command]
pub async fn ssh_disconnect(state: St<'_>, id: String) -> Result<()> {
    conn::disconnect(state.inner(), &id).await
}

// ── Terminal ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn shell_open(app: AppHandle, state: St<'_>, opts: shell::ShellOpts) -> Result<()> {
    let u = ui(&app, &state);
    shell::open(u, state.inner().clone(), opts).await
}

#[tauri::command]
pub async fn telnet_open(app: AppHandle, state: St<'_>, opts: telnet::TelnetOpts) -> Result<()> {
    telnet::open(ui(&app, &state), state.inner().clone(), opts).await
}

/// Serial chỉ được biên dịch cho macOS và Windows; nền tảng khác trả lỗi rõ ràng.
#[cfg(any(target_os = "macos", target_os = "windows"))]
#[tauri::command]
pub fn serial_ports() -> Result<Vec<crate::serial::PortInfo>> {
    crate::serial::ports()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
pub fn serial_ports() -> Result<Vec<serde_json::Value>> {
    Ok(vec![])
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[tauri::command]
pub async fn serial_open(
    app: AppHandle,
    state: St<'_>,
    opts: crate::serial::SerialOpts,
) -> Result<()> {
    let (u, s) = (ui(&app, &state), state.inner().clone());
    tokio::task::spawn_blocking(move || crate::serial::open(u, s, opts))
        .await
        .map_err(|e| AppError::Msg(e.to_string()))?
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
pub async fn serial_open(_opts: serde_json::Value) -> Result<()> {
    Err(AppError::Msg("Serial chưa hỗ trợ trên nền tảng này".into()))
}

#[tauri::command]
pub async fn pty_open(app: AppHandle, state: St<'_>, opts: pty::PtyOpts) -> Result<()> {
    let (u, s) = (ui(&app, &state), state.inner().clone());
    // portable-pty chặn nên đẩy sang thread riêng.
    tokio::task::spawn_blocking(move || pty::open(u, s, opts))
        .await
        .map_err(|e| AppError::Msg(e.to_string()))?
}

#[tauri::command]
pub async fn term_write(state: St<'_>, term_id: String, data: String) -> Result<()> {
    let terms = state.terms.lock().await;
    let t = terms
        .get(&term_id)
        .ok_or_else(|| AppError::Msg(format!("Terminal '{term_id}' đã đóng")))?;
    let _ = t.tx.send(TermIn::Data(data.into_bytes()));
    Ok(())
}

/// Dữ liệu nhị phân (mouse report…) không đi qua String được vì sẽ bị encode
/// UTF-8; frontend base64 hoá trước khi gửi.
#[tauri::command]
pub async fn term_write_b64(state: St<'_>, term_id: String, b64: String) -> Result<()> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| AppError::Msg(format!("base64 không hợp lệ: {e}")))?;
    let terms = state.terms.lock().await;
    let t = terms
        .get(&term_id)
        .ok_or_else(|| AppError::Msg(format!("Terminal '{term_id}' đã đóng")))?;
    let _ = t.tx.send(TermIn::Data(bytes));
    Ok(())
}

/// Multi-exec: gửi cùng một chuỗi tới nhiều terminal.
#[tauri::command]
pub async fn term_broadcast(state: St<'_>, term_ids: Vec<String>, data: String) -> Result<usize> {
    let terms = state.terms.lock().await;
    let bytes = data.into_bytes();
    let mut n = 0;
    for id in term_ids {
        if let Some(t) = terms.get(&id) {
            if t.tx.send(TermIn::Data(bytes.clone())).is_ok() {
                n += 1;
            }
        }
    }
    Ok(n)
}

#[tauri::command]
pub async fn term_resize(state: St<'_>, term_id: String, cols: u16, rows: u16) -> Result<()> {
    if let Some(t) = state.terms.lock().await.get(&term_id) {
        let _ = t.tx.send(TermIn::Resize { cols, rows });
    }
    Ok(())
}

#[tauri::command]
pub async fn term_close(state: St<'_>, term_id: String) -> Result<()> {
    if let Some(t) = state.terms.lock().await.remove(&term_id) {
        let _ = t.tx.send(TermIn::Close);
    }
    Ok(())
}

/// Chạy lệnh ngắn trên server (không PTY) — để lấy tên container/unit cho gợi ý lệnh.
#[tauri::command]
pub async fn ssh_exec(state: St<'_>, conn_id: String, cmd: String) -> Result<String> {
    state.conn(&conn_id).await?.exec(&cmd).await
}

// ── SFTP ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_list(state: St<'_>, conn_id: String, path: String) -> Result<sftp::Listing> {
    sftp::list(state.inner(), &conn_id, &path).await
}

#[tauri::command]
pub async fn sftp_home(state: St<'_>, conn_id: String) -> Result<String> {
    sftp::home(state.inner(), &conn_id).await
}

#[tauri::command]
pub async fn sftp_mkdir(state: St<'_>, conn_id: String, path: String) -> Result<()> {
    sftp::mkdir(state.inner(), &conn_id, &path).await
}

#[tauri::command]
pub async fn sftp_rename(state: St<'_>, conn_id: String, from: String, to: String) -> Result<()> {
    sftp::rename(state.inner(), &conn_id, &from, &to).await
}

#[tauri::command]
pub async fn sftp_chmod(state: St<'_>, conn_id: String, path: String, mode: u32) -> Result<()> {
    sftp::chmod(state.inner(), &conn_id, &path, mode).await
}

#[tauri::command]
pub async fn sftp_remove(state: St<'_>, conn_id: String, path: String) -> Result<()> {
    sftp::remove(state.inner(), &conn_id, &path).await
}

/// `maxBytes` được kẹp trong khoảng 1 KB…4 MB ở tầng dưới.
#[tauri::command]
pub async fn sftp_read_text(
    state: St<'_>,
    conn_id: String,
    path: String,
    max_bytes: u64,
) -> Result<(String, bool)> {
    sftp::read_text(state.inner(), &conn_id, &path, max_bytes).await
}

#[tauri::command]
pub async fn sftp_write_text(state: St<'_>, conn_id: String, path: String, text: String) -> Result<()> {
    sftp::write_text(state.inner(), &conn_id, &path, &text).await
}

#[tauri::command]
pub async fn sftp_readlink(state: St<'_>, conn_id: String, path: String) -> Result<String> {
    sftp::read_link(state.inner(), &conn_id, &path).await
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    state: St<'_>,
    conn_id: String,
    remote: String,
    local: String,
    xfer_id: String,
) -> Result<()> {
    sftp::download(ui(&app, &state), state.inner().clone(), conn_id, remote, local, xfer_id).await
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    state: St<'_>,
    conn_id: String,
    local: String,
    remote: String,
    xfer_id: String,
) -> Result<()> {
    sftp::upload(ui(&app, &state), state.inner().clone(), conn_id, local, remote, xfer_id).await
}

// ── Tunnel ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tunnel_start(
    app: AppHandle,
    state: St<'_>,
    spec: tunnel::TunnelSpec,
) -> Result<()> {
    tunnel::start(ui(&app, &state), state.inner().clone(), spec).await
}

#[tauri::command]
pub async fn tunnel_stop(state: St<'_>, id: String) -> Result<()> {
    tunnel::stop(state.inner(), &id).await
}

// ── Host key ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn hostkeys_list() -> Vec<hostkeys::KnownHost> {
    hostkeys::load()
}

#[tauri::command]
pub fn hostkey_forget(host: String, port: u16) -> Result<()> {
    hostkeys::forget(&host, port)
}

#[tauri::command]
pub fn hostkeys_import() -> Result<Value> {
    let (added, skipped) = hostkeys::import_openssh()?;
    Ok(json!({ "added": added, "skipped": skipped }))
}

// ── Nhập từ OpenSSH ───────────────────────────────────────────────────────

#[tauri::command]
pub fn ssh_config_import() -> Result<Vec<sshconfig::SshHost>> {
    sshconfig::import()
}

#[tauri::command]
pub fn local_keys() -> Result<Vec<sshconfig::LocalKey>> {
    sshconfig::local_keys()
}

// ── Tiện ích ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn read_env(name: String) -> Option<String> {
    std::env::var(name).ok()
}


/// Ứng viên tên file thực thi cho một chương trình. Trên Windows phải thử thêm
/// các đuôi trong `PATHEXT`. Tách hàm để test được cả nhánh Windows từ macOS.
fn exe_candidates(name: &str, pathext: Option<&str>, windows: bool) -> Vec<String> {
    let mut out = vec![name.to_string()];
    if windows {
        let exts = pathext.unwrap_or(".EXE;.CMD;.BAT;.COM");
        for e in exts.split(';').filter(|e| !e.trim().is_empty()) {
            out.push(format!("{name}{}", e.to_lowercase()));
        }
    }
    out
}

/// Tìm một chương trình trong PATH (dùng để biết `mosh` đã được cài chưa).
#[tauri::command]
pub fn which_bin(name: String) -> Option<String> {
    if name.is_empty() || name.contains(['/', '\\']) {
        return None;
    }
    let windows = cfg!(windows);
    let pathext = std::env::var("PATHEXT").ok();
    let names = exe_candidates(&name, pathext.as_deref(), windows);

    let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    // App GUI trên macOS không thừa hưởng PATH của shell → thêm chỗ Homebrew.
    if cfg!(target_os = "macos") {
        dirs.push("/opt/homebrew/bin".into());
        dirs.push("/usr/local/bin".into());
    }

    for dir in dirs {
        for n in &names {
            let p = dir.join(n);
            if p.is_file() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// Lấy RSS (KB) từ output CSV của `tasklist`. Cột cuối có dạng `"12,345 K"`
/// nên không thể chỉ `split(',')`.
#[cfg(any(windows, test))]
fn parse_tasklist_rss(text: &str) -> Option<u64> {
    let line = text.lines().find(|l| l.contains(" K"))?;
    let cell = line.rsplit('"').nth(1)?;
    let digits: String = cell.chars().filter(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// RSS của tiến trình (KB) để hiện trên status bar.
#[tauri::command]
pub fn mem_usage() -> Option<u64> {
    let pid = std::process::id();
    #[cfg(unix)]
    {
        let out = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        String::from_utf8_lossy(&out.stdout).trim().parse().ok()
    }
    #[cfg(windows)]
    {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
            .output()
            .ok()?;
        parse_tasklist_rss(&String::from_utf8_lossy(&out.stdout))
    }
}

#[cfg(test)]
mod tests {
    use super::{exe_candidates, parse_tasklist_rss};

    #[test]
    fn adds_windows_extensions() {
        assert_eq!(exe_candidates("mosh", None, false), vec!["mosh"]);
        assert_eq!(
            exe_candidates("mosh", Some(".EXE;.CMD"), true),
            vec!["mosh", "mosh.exe", "mosh.cmd"],
        );
        // PATHEXT rỗng/rác không được sinh tên trống.
        assert_eq!(exe_candidates("git", Some(".EXE;;"), true), vec!["git", "git.exe"]);
    }

    #[test]
    fn reads_tasklist_memory_column() {
        // Đúng định dạng `tasklist /NH /FO CSV`, có dấu phẩy phân cách nghìn.
        let out = "\"vibe-ssh.exe\",\"7104\",\"Console\",\"1\",\"84,912 K\"\r\n";
        assert_eq!(parse_tasklist_rss(out), Some(84_912));

        let small = "\"vibe-ssh.exe\",\"7104\",\"Console\",\"1\",\"912 K\"\r\n";
        assert_eq!(parse_tasklist_rss(small), Some(912));

        // Không tìm thấy tiến trình → tasklist in thông báo, không có cột K.
        assert_eq!(parse_tasklist_rss("INFO: No tasks are running.\r\n"), None);
    }
}
