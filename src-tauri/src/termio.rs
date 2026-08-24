//! Phần chung của mọi loại terminal (SSH, PTY, Telnet, Serial): gộp output,
//! ghi log tuỳ chọn và phát sự kiện lên giao diện.

use crate::store;
use crate::ui::Ui;
use base64::Engine;
use serde_json::json;
use std::path::{Path, PathBuf};

/// Gộp dữ liệu ~6ms hoặc 24 KB một lần để không làm ngập kênh IPC khi output
/// dồn dập (ví dụ `cat` một file lớn).
pub const FLUSH_MS: u64 = 6;
pub const FLUSH_BYTES: usize = 24 * 1024;

pub fn log_path(raw: Option<&String>) -> Option<PathBuf> {
    raw.filter(|p| !p.trim().is_empty())
        .map(|p| PathBuf::from(crate::ssh::conn::expand_tilde(p)))
}

pub fn emit(ui: &Ui, term_id: &str, bytes: &[u8], log: Option<&Path>) {
    if bytes.is_empty() {
        return;
    }
    if let Some(p) = log {
        let _ = store::append_log(p, bytes);
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    ui.emit("term:data", json!({ "termId": term_id, "b64": b64 }));
}

pub fn flush(ui: &Ui, term_id: &str, buf: &mut Vec<u8>, log: Option<&Path>) {
    emit(ui, term_id, buf, log);
    buf.clear();
}

pub fn exit(ui: &Ui, term_id: &str, code: Option<u32>, reason: Option<&str>) {
    ui.emit(
        "term:exit",
        json!({ "termId": term_id, "code": code, "reason": reason }),
    );
}
