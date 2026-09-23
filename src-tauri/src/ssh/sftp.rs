//! Thao tác SFTP: liệt kê, đổi tên, xóa, chmod, và truyền file có tiến độ.

use crate::error::Result;
use crate::state::AppState;
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;
use crate::ui::Ui;
use russh_sftp::client::SftpSession;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const CHUNK: usize = 64 * 1024;
const PROGRESS_EVERY: u64 = 256 * 1024;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    pub size: u64,
    pub mode: u32,
    pub mode_str: String,
    pub user: Option<String>,
    pub group: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub mtime: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub entries: Vec<Entry>,
}

fn join(dir: &str, name: &str) -> String {
    if dir == "/" {
        format!("/{name}")
    } else {
        format!("{}/{name}", dir.trim_end_matches('/'))
    }
}

/// `0o40755` → `drwxr-xr-x`
pub(crate) fn mode_str(mode: u32, kind: &str) -> String {
    let t = match kind {
        "dir" => 'd',
        "link" => 'l',
        _ => '-',
    };
    let bit = |i: u32, c: char| if mode & (1 << i) != 0 { c } else { '-' };
    format!(
        "{t}{}{}{}{}{}{}{}{}{}",
        bit(8, 'r'), bit(7, 'w'), bit(6, 'x'),
        bit(5, 'r'), bit(4, 'w'), bit(3, 'x'),
        bit(2, 'r'), bit(1, 'w'), bit(0, 'x'),
    )
}

pub async fn list(state: &Arc<AppState>, conn_id: &str, path: &str) -> Result<Listing> {
    let sftp = state.conn(conn_id).await?.sftp().await?;
    let path = if path.trim().is_empty() { "." } else { path };
    let abs = sftp.canonicalize(path).await.unwrap_or_else(|_| path.to_string());

    let mut entries = Vec::new();
    for e in sftp.read_dir(&abs).await? {
        let name = e.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let m = e.metadata();
        let kind = if m.is_dir() {
            "dir"
        } else if m.is_symlink() {
            "link"
        } else {
            "file"
        };
        let mode = m.permissions.unwrap_or(0);
        entries.push(Entry {
            path: join(&abs, &name),
            name,
            kind,
            size: m.size.unwrap_or(0),
            mode: mode & 0o7777,
            mode_str: mode_str(mode, kind),
            user: m.user.clone(),
            group: m.group.clone(),
            uid: m.uid,
            gid: m.gid,
            mtime: m.mtime,
        });
    }
    // Thư mục lên trước, rồi theo tên (không phân biệt hoa/thường).
    entries.sort_by(|a, b| {
        (a.kind != "dir")
            .cmp(&(b.kind != "dir"))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Listing { path: abs, entries })
}

pub async fn home(state: &Arc<AppState>, conn_id: &str) -> Result<String> {
    let sftp = state.conn(conn_id).await?.sftp().await?;
    Ok(sftp.canonicalize(".").await.unwrap_or_else(|_| "/".into()))
}

pub async fn mkdir(state: &Arc<AppState>, conn_id: &str, path: &str) -> Result<()> {
    let sftp = state.conn(conn_id).await?.sftp().await?;
    sftp.create_dir(path).await?;
    Ok(())
}

pub async fn rename(state: &Arc<AppState>, conn_id: &str, from: &str, to: &str) -> Result<()> {
    let sftp = state.conn(conn_id).await?.sftp().await?;
    sftp.rename(from, to).await?;
    Ok(())
}

pub async fn chmod(state: &Arc<AppState>, conn_id: &str, path: &str, mode: u32) -> Result<()> {
    let sftp = state.conn(conn_id).await?.sftp().await?;
    let mut meta = sftp.metadata(path).await?;
    meta.permissions = Some(mode & 0o7777);
    sftp.set_metadata(path, meta).await?;
    Ok(())
}

/// Đọc phần đầu một file dạng văn bản để xem nhanh trong bảng SFTP.
/// Trả về `(nội dung, đã bị cắt bớt)`.
pub async fn read_text(
    state: &Arc<AppState>,
    conn_id: &str,
    path: &str,
    max_bytes: u64,
) -> Result<(String, bool)> {
    let sftp = state.conn(conn_id).await?.sftp().await?;
    let size = sftp.metadata(path).await?.size.unwrap_or(0);
    let cap = max_bytes.clamp(1024, 4 * 1024 * 1024);

    let mut file = sftp.open(path).await?;
    let mut buf = vec![0u8; cap as usize + 1];
    let mut filled = 0usize;
    while filled < buf.len() {
        let n = file.read(&mut buf[filled..]).await?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    buf.truncate(filled);
    let cut = filled as u64 > cap || size > filled as u64;
    buf.truncate(cap as usize);
    if buf.contains(&0) {
        crate::bail!("File nhị phân không hỗ trợ chỉnh sửa văn bản");
    }
    let text = match std::str::from_utf8(&buf) {
        Ok(text) => text.to_owned(),
        Err(err) if cut && err.error_len().is_none() => {
            String::from_utf8(buf[..err.valid_up_to()].to_vec()).unwrap()
        }
        Err(_) => crate::bail!("Chỉ hỗ trợ file văn bản UTF-8"),
    };
    Ok((text, cut))
}

/// Lưu nội dung vào file hiện có, giữ nguyên quyền truy cập.
pub async fn write_text(
    state: &Arc<AppState>, conn_id: &str, path: &str, text: &str,
) -> Result<()> {
    use russh_sftp::protocol::OpenFlags;
    let sftp = state.conn(conn_id).await?.sftp().await?;
    let mut file = sftp.open_with_flags(path, OpenFlags::WRITE | OpenFlags::TRUNCATE).await?;
    file.write_all(text.as_bytes()).await?;
    file.shutdown().await?;
    Ok(())
}

pub async fn read_link(state: &Arc<AppState>, conn_id: &str, path: &str) -> Result<String> {
    let sftp = state.conn(conn_id).await?.sftp().await?;
    Ok(sftp.read_link(path).await?)
}

/// Xóa đệ quy — SFTP không có `rm -rf`, phải tự đi cây thư mục.
pub async fn remove(state: &Arc<AppState>, conn_id: &str, path: &str) -> Result<()> {
    let sftp = state.conn(conn_id).await?.sftp().await?;
    let meta = sftp.symlink_metadata(path).await?;
    if !meta.is_dir() {
        sftp.remove_file(path).await?;
        return Ok(());
    }
    // BFS ngược: thu thập trước, xóa sau, tránh đệ quy async.
    let mut dirs = vec![path.to_string()];
    let mut order: Vec<String> = Vec::new();
    while let Some(d) = dirs.pop() {
        for e in sftp.read_dir(&d).await? {
            let name = e.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = join(&d, &name);
            if e.metadata().is_dir() {
                dirs.push(child.clone());
            } else {
                sftp.remove_file(&child).await?;
            }
        }
        order.push(d);
    }
    for d in order.into_iter().rev() {
        sftp.remove_dir(&d).await?;
    }
    Ok(())
}

fn progress(ui: &Ui, id: &str, done: u64, total: u64) {
    ui.emit("xfer:progress", json!({ "id": id, "done": done, "total": total }));
}

/// Danh sách file cần chuyển cùng tổng dung lượng, để tiến độ tính trên cả cây.
struct Plan {
    files: Vec<(String, String, u64)>,
    dirs: Vec<String>,
    total: u64,
}

/// Đi cây thư mục phía xa. SFTP không có `cp -r` nên phải tự liệt kê;
/// dùng vòng lặp thay vì đệ quy để không cần future đóng hộp.
async fn plan_remote(
    sftp: &SftpSession,
    remote: &str,
    local: &str,
) -> Result<Plan> {
    let mut plan = Plan { files: vec![], dirs: vec![], total: 0 };
    let mut queue = vec![(remote.to_string(), local.to_string())];
    while let Some((r, l)) = queue.pop() {
        plan.dirs.push(l.clone());
        for e in sftp.read_dir(&r).await? {
            let name = e.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let (rp, lp) = (join(&r, &name), join(&l, &name));
            let m = e.metadata();
            if m.is_dir() {
                queue.push((rp, lp));
            } else if !m.is_symlink() {
                let size = m.size.unwrap_or(0);
                plan.total += size;
                plan.files.push((rp, lp, size));
            }
        }
    }
    Ok(plan)
}

fn plan_local(local: &str, remote: &str) -> Result<Plan> {
    let mut plan = Plan { files: vec![], dirs: vec![], total: 0 };
    let mut queue = vec![(local.to_string(), remote.to_string())];
    while let Some((l, r)) = queue.pop() {
        plan.dirs.push(r.clone());
        for e in std::fs::read_dir(&l)?.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let lp = e.path().to_string_lossy().into_owned();
            let rp = join(&r, &name);
            let m = e.metadata()?;
            if m.is_dir() {
                queue.push((lp, rp));
            } else if m.is_file() {
                plan.total += m.len();
                plan.files.push((rp, lp, m.len()));
            }
        }
    }
    Ok(plan)
}

/// Một file: `done` là số byte đã chuyển của cả phiên, `total` để hiện tiến độ.
async fn pull_file(
    sftp: &SftpSession,
    remote: &str,
    local: &str,
    ui: &Ui,
    xfer_id: &str,
    done: &mut u64,
    total: u64,
) -> Result<()> {
    if let Some(dir) = std::path::Path::new(local).parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let mut src = sftp.open(remote).await?;
    let mut dst = tokio::fs::File::create(local).await?;
    let mut buf = vec![0u8; CHUNK];
    let mut mark = *done;
    loop {
        let n = src.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await?;
        *done += n as u64;
        if *done - mark >= PROGRESS_EVERY {
            mark = *done;
            progress(ui, xfer_id, *done, total);
        }
    }
    dst.flush().await?;
    Ok(())
}

async fn push_file(
    sftp: &SftpSession,
    local: &str,
    remote: &str,
    ui: &Ui,
    xfer_id: &str,
    done: &mut u64,
    total: u64,
) -> Result<()> {
    let mut src = tokio::fs::File::open(local).await?;
    let mut dst = sftp.create(remote).await?;
    let mut buf = vec![0u8; CHUNK];
    let mut mark = *done;
    loop {
        let n = src.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await?;
        *done += n as u64;
        if *done - mark >= PROGRESS_EVERY {
            mark = *done;
            progress(ui, xfer_id, *done, total);
        }
    }
    dst.flush().await?;
    dst.shutdown().await?;
    Ok(())
}

/// Tải xuống một file, hoặc cả thư mục nếu `remote` là thư mục.
pub async fn download(
    ui: Ui,
    state: Arc<AppState>,
    conn_id: String,
    remote: String,
    local: String,
    xfer_id: String,
) -> Result<()> {
    let sftp = state.conn(&conn_id).await?.sftp().await?;
    let meta = sftp.metadata(&remote).await?;
    let mut done = 0u64;

    if !meta.is_dir() {
        let total = meta.size.unwrap_or(0);
        progress(&ui, &xfer_id, 0, total);
        pull_file(&sftp, &remote, &local, &ui, &xfer_id, &mut done, total).await?;
        progress(&ui, &xfer_id, done, total.max(done));
        return Ok(());
    }

    let plan = plan_remote(&sftp, &remote, &local).await?;
    progress(&ui, &xfer_id, 0, plan.total);
    for d in &plan.dirs {
        tokio::fs::create_dir_all(d).await?;
    }
    for (r, l, _) in &plan.files {
        pull_file(&sftp, r, l, &ui, &xfer_id, &mut done, plan.total).await?;
    }
    progress(&ui, &xfer_id, done, plan.total.max(done));
    Ok(())
}

/// Tải lên một file, hoặc cả thư mục nếu `local` là thư mục.
pub async fn upload(
    ui: Ui,
    state: Arc<AppState>,
    conn_id: String,
    local: String,
    remote: String,
    xfer_id: String,
) -> Result<()> {
    let sftp = state.conn(&conn_id).await?.sftp().await?;
    let meta = tokio::fs::metadata(&local).await?;
    let mut done = 0u64;

    if !meta.is_dir() {
        let total = meta.len();
        progress(&ui, &xfer_id, 0, total);
        push_file(&sftp, &local, &remote, &ui, &xfer_id, &mut done, total).await?;
        progress(&ui, &xfer_id, done, total.max(done));
        return Ok(());
    }

    let plan = plan_local(&local, &remote)?;
    progress(&ui, &xfer_id, 0, plan.total);
    for d in &plan.dirs {
        // Thư mục có thể đã tồn tại — bỏ qua lỗi đó.
        let _ = sftp.create_dir(d.as_str()).await;
    }
    for (r, l, _) in &plan.files {
        push_file(&sftp, l, r, &ui, &xfer_id, &mut done, plan.total).await?;
    }
    progress(&ui, &xfer_id, done, plan.total.max(done));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{join, mode_str};

    #[test]
    fn renders_unix_permissions() {
        assert_eq!(mode_str(0o755, "dir"), "drwxr-xr-x");
        assert_eq!(mode_str(0o644, "file"), "-rw-r--r--");
        assert_eq!(mode_str(0o777, "link"), "lrwxrwxrwx");
        assert_eq!(mode_str(0o000, "file"), "----------");
    }

    #[test]
    fn joins_without_double_slash() {
        assert_eq!(join("/", "etc"), "/etc");
        assert_eq!(join("/var", "log"), "/var/log");
        assert_eq!(join("/var/", "log"), "/var/log");
    }
}
