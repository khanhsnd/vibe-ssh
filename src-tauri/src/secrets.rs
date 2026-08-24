//! Mật khẩu / passphrase nằm trong keychain của HĐH (macOS Keychain,
//! Windows Credential Manager), không bao giờ nằm trong file cấu hình.

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
