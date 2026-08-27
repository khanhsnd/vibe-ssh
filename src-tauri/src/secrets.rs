//! Mật khẩu / passphrase nằm trong keychain của HĐH (macOS Keychain,
//! Windows Credential Manager), không bao giờ nằm trong file cấu hình.
//!
//! Mục được tạo với ACL mặc định nên mọi bản build của app đều đọc lại được —
//! đã kiểm chứng bằng cách đọc từ một chương trình khác (`security find-generic-password`).

use crate::error::Result;
use keyring::Entry;

const SERVICE: &str = "vibe-ssh";

fn entry(key: &str) -> Result<Entry> {
    Ok(Entry::new(SERVICE, key)?)
}

pub fn set(key: &str, secret: &str) -> Result<()> {
    entry(key)?.set_password(secret)?;
    Ok(())
}

pub fn get(key: &str) -> Option<String> {
    entry(key).ok()?.get_password().ok()
}

pub fn delete(key: &str) -> Result<()> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ghi/đọc/xoá thật trên keychain của hệ điều hành.
    #[test]
    fn round_trips_through_the_os_keychain() {
        let key = format!("test:{}", uuid::Uuid::new_v4());
        assert_eq!(get(&key), None, "khóa mới phải chưa tồn tại");

        set(&key, "mat-khau-bi-mat").expect("ghi được vào keychain");
        assert_eq!(get(&key).as_deref(), Some("mat-khau-bi-mat"));

        set(&key, "doi-mat-khau").expect("ghi đè được");
        assert_eq!(get(&key).as_deref(), Some("doi-mat-khau"));

        delete(&key).expect("xoá được");
        assert_eq!(get(&key), None, "sau khi xoá phải trống");
        // Xoá thứ không tồn tại không được coi là lỗi.
        delete(&key).expect("xoá lần hai vẫn ok");
    }
}
