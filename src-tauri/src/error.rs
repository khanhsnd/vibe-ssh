use serde::Serialize;

/// Lỗi trả về cho frontend: luôn là chuỗi đọc được, không leak stack trace.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    /// Server hoặc người dùng đã từ chối (sai mật khẩu, host key không tin):
    /// thử lại tự động cũng vô ích.
    #[error("{0}")]
    Rejected(String),
    #[error("SSH: {0}")]
    Ssh(#[from] russh::Error),
    #[error("SFTP: {0}")]
    Sftp(#[from] russh_sftp::client::error::Error),
    #[error("Khóa: {0}")]
    Key(#[from] russh::keys::ssh_key::Error),
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Keychain: {0}")]
    Keyring(#[from] keyring::Error),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Msg(s)
    }
}
impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Msg(s.to_string())
    }
}

/// `bail!("...")` cho gọn.
#[macro_export]
macro_rules! bail {
    ($($t:tt)*) => { return Err($crate::error::AppError::Msg(format!($($t)*))) };
}
