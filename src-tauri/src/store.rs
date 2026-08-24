//! Lưu trữ cục bộ. Backend không hiểu cấu trúc cấu hình (đó là việc của UI) —
//! nó chỉ đọc/ghi một tài liệu JSON một cách nguyên tử. Nhờ vậy schema chỉ được
//! định nghĩa một lần, ở phía TypeScript.

use crate::error::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};

const APP_DIR: &str = "VibeSSH";

/// Đặt biến này để chạy ở chế độ portable: mọi cấu hình nằm trong thư mục chỉ
/// định (ổ USB, thư mục dự án…) thay vì thư mục cấu hình của hệ điều hành.
pub const DATA_DIR_ENV: &str = "VIBE_SSH_DATA_DIR";

pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var(DATA_DIR_ENV) {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join(APP_DIR)
}

pub fn path_of(file: &str) -> PathBuf {
    data_dir().join(file)
}

pub fn read_doc(file: &str) -> Result<Value> {
    let p = path_of(file);
    if !p.exists() {
        return Ok(Value::Null);
    }
    let raw = std::fs::read_to_string(&p)?;
    if raw.trim().is_empty() {
        return Ok(Value::Null);
    }
    Ok(serde_json::from_str(&raw)?)
}

/// Ghi nguyên tử: viết vào `.tmp` rồi rename, tránh mất cấu hình khi crash.
pub fn write_doc(file: &str, doc: &Value) -> Result<()> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir)?;
    let target = dir.join(file);
    let tmp = dir.join(format!("{file}.tmp"));
    std::fs::write(&tmp, serde_json::to_vec_pretty(doc)?)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

pub fn append_log(file: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(file)?;
    f.write_all(bytes)?;
    Ok(())
}
