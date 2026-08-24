//! Terminal cục bộ (zsh/bash trên macOS, PowerShell trên Windows).
//! portable-pty là API chặn nên phần này chạy trên thread thường,
//! không phải trên tokio runtime.

use crate::error::Result;
use crate::state::{AppState, Term, TermIn};
use crate::termio;
use crate::ui::Ui;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PtyOpts {
    pub term_id: String,
    pub shell: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub env: Vec<(String, String)>,
    pub log_path: Option<String>,
}

/// Nền tảng mà lựa chọn shell nhắm tới. Tách ra để test được cả nhánh Windows
/// từ máy macOS — phần `#[cfg]` chỉ còn việc đọc biến môi trường.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Host {
    Unix,
    /// Chỉ được dựng khi biên dịch cho Windows (và trong test).
    #[cfg_attr(not(windows), allow(dead_code))]
    Windows,
}

/// Shell mặc định và tham số của nó.
/// - Unix: `$SHELL` với `-l` để nạp profile như Terminal.app.
/// - Windows: PowerShell 7 nếu có, sau đó `%ComSpec%` nếu không phải cmd.exe.
pub fn default_shell_for(
    host: Host,
    env_shell: Option<&str>,
    comspec: Option<&str>,
    pwsh7: Option<&str>,
) -> (String, Vec<String>) {
    match host {
        Host::Unix => (
            env_shell.filter(|s| !s.is_empty()).unwrap_or("/bin/zsh").to_string(),
            vec!["-l".to_string()],
        ),
        Host::Windows => {
            if let Some(p) = pwsh7 {
                return (p.to_string(), vec![]);
            }
            let sh = comspec.filter(|s| !s.is_empty()).unwrap_or("powershell.exe");
            // cmd.exe rất hạn chế; PowerShell là mặc định dễ dùng hơn.
            if sh.to_lowercase().ends_with("cmd.exe") {
                ("powershell.exe".to_string(), vec![])
            } else {
                (sh.to_string(), vec![])
            }
        }
    }
}

fn default_shell() -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        const PWSH7: &str = r"C:\Program Files\PowerShell\7\pwsh.exe";
        let pwsh = std::path::Path::new(PWSH7).exists().then_some(PWSH7);
        default_shell_for(
            Host::Windows,
            None,
            std::env::var("ComSpec").ok().as_deref(),
            pwsh,
        )
    }
    #[cfg(not(windows))]
    {
        default_shell_for(Host::Unix, std::env::var("SHELL").ok().as_deref(), None, None)
    }
}

/// PTY đã mở cùng các đầu vào/ra của nó.
pub struct Spawned {
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
}

/// Mở PTY và chạy shell. Tách khỏi `open` để test được mà không cần AppHandle.
pub fn spawn(o: &PtyOpts) -> Result<Spawned> {
    let size = PtySize {
        rows: o.rows.max(5),
        cols: o.cols.max(20),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|e| crate::error::AppError::Msg(format!("Không mở được PTY: {e}")))?;

    let (prog, def_args) = default_shell();
    let prog = o.shell.clone().filter(|s| !s.is_empty()).unwrap_or(prog);
    let mut cmd = CommandBuilder::new(&prog);
    for a in if o.args.is_empty() { &def_args } else { &o.args } {
        cmd.arg(a);
    }
    let cwd = o
        .cwd
        .clone()
        .map(|c| crate::ssh::conn::expand_tilde(&c))
        .filter(|c| std::path::Path::new(c).is_dir())
        .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().into_owned()));
    if let Some(c) = cwd {
        cmd.cwd(c);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for (k, v) in &o.env {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| crate::error::AppError::Msg(format!("Không chạy được '{prog}': {e}")))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| crate::error::AppError::Msg(e.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| crate::error::AppError::Msg(e.to_string()))?;
    Ok(Spawned { child, reader, writer, master: pair.master })
}

pub fn open(ui: Ui, state: Arc<AppState>, o: PtyOpts) -> Result<()> {
    let Spawned { mut child, mut reader, mut writer, master } = spawn(&o)?;
    let master = Arc::new(Mutex::new(master));

    let (tx, mut rx) = mpsc::unbounded_channel::<TermIn>();
    let term_id = o.term_id.clone();
    let log = termio::log_path(o.log_path.as_ref());

    tauri::async_runtime::block_on(async {
        state.terms.lock().await.insert(
            term_id.clone(),
            Term { tx },
        );
    });

    // Đọc từ PTY → UI.
    {
        let (ui, id, log) = (ui.clone(), term_id.clone(), log.clone());
        std::thread::spawn(move || {
            let mut buf = [0u8; 32 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => termio::emit(&ui, &id, &buf[..n], log.as_deref()),
                }
            }
        });
    }

    // UI → PTY (write/resize là API chặn nên dùng blocking_recv).
    {
        let master = master.clone();
        std::thread::spawn(move || {
            use std::io::Write;
            while let Some(cmd) = rx.blocking_recv() {
                match cmd {
                    TermIn::Data(d) => {
                        if writer.write_all(&d).is_err() {
                            break;
                        }
                        let _ = writer.flush();
                    }
                    TermIn::Resize { cols, rows } => {
                        if let Ok(m) = master.lock() {
                            let _ = m.resize(PtySize {
                                rows: rows.max(5),
                                cols: cols.max(20),
                                pixel_width: 0,
                                pixel_height: 0,
                            });
                        }
                    }
                    TermIn::Close => break,
                }
            }
        });
    }

    // Chờ process kết thúc để dọn state.
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        let st = state.clone();
        let id = term_id.clone();
        tauri::async_runtime::spawn(async move {
            st.terms.lock().await.remove(&id);
        });
        termio::exit(&ui, &term_id, code, None);
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn bare(cols: u16, rows: u16) -> PtyOpts {
        // `-f` bỏ mọi file khởi động → output tất định, không phụ thuộc .zshrc.
        PtyOpts {
            shell: Some("/bin/zsh".into()),
            args: vec!["-f".into(), "-i".into()],
            cols,
            rows,
            ..Default::default()
        }
    }

    #[test]
    fn picks_sensible_default_shells() {
        use super::{default_shell_for, Host};

        // Unix: theo $SHELL và luôn là login shell.
        assert_eq!(
            default_shell_for(Host::Unix, Some("/bin/fish"), None, None),
            ("/bin/fish".into(), vec!["-l".to_string()]),
        );
        assert_eq!(
            default_shell_for(Host::Unix, None, None, None).0,
            "/bin/zsh",
        );

        // Windows: PowerShell 7 thắng nếu có.
        let pwsh = r"C:\Program Files\PowerShell\7\pwsh.exe";
        assert_eq!(
            default_shell_for(Host::Windows, None, Some(r"C:\WINDOWS\system32\cmd.exe"), Some(pwsh)),
            (pwsh.to_string(), vec![]),
        );
        // Không có pwsh7 và ComSpec là cmd.exe → dùng powershell.exe.
        assert_eq!(
            default_shell_for(Host::Windows, None, Some(r"C:\WINDOWS\system32\cmd.exe"), None),
            ("powershell.exe".to_string(), vec![]),
        );
        // ComSpec trỏ tới thứ khác thì tôn trọng nó.
        assert_eq!(
            default_shell_for(Host::Windows, None, Some(r"C:\bin\nu.exe"), None),
            (r"C:\bin\nu.exe".to_string(), vec![]),
        );
        // Không có gì cả.
        assert_eq!(
            default_shell_for(Host::Windows, None, None, None),
            ("powershell.exe".to_string(), vec![]),
        );
    }

    #[test]
    fn spawns_shell_and_echoes() {
        let o = bare(100, 30);
        let mut p = spawn(&o).expect("mở được PTY");

        use std::io::Write;
        writeln!(p.writer, "echo vibe-pty-ok").unwrap();
        p.writer.flush().unwrap();

        // Đọc đến khi thấy marker hoặc quá 8 giây.
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut seen = String::new();
        let mut buf = [0u8; 4096];
        while Instant::now() < deadline {
            match p.reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    seen.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if seen.matches("vibe-pty-ok").count() >= 2 {
                        break; // một lần do echo lệnh, một lần do output
                    }
                }
            }
        }
        let _ = p.child.kill();
        assert!(seen.contains("vibe-pty-ok"), "output PTY: {seen:?}");
    }

    #[test]
    fn resize_works() {
        let o = bare(80, 24);
        let p = spawn(&o).expect("mở được PTY");
        p.master
            .resize(PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 })
            .expect("resize được");
        let size = p.master.get_size().unwrap();
        assert_eq!((size.cols, size.rows), (120, 40));
        let mut child = p.child;
        let _ = child.kill();
    }

    #[test]
    fn clamps_tiny_sizes() {
        let o = bare(1, 1);
        let p = spawn(&o).expect("mở được PTY");
        let size = p.master.get_size().unwrap();
        assert!(size.cols >= 20 && size.rows >= 5);
        let mut child = p.child;
        let _ = child.kill();
    }
}
