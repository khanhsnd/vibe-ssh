//! known_hosts riêng của app (JSON), cộng khả năng nhập từ ~/.ssh/known_hosts.
//! Chỉ lưu fingerprint SHA256 — đủ để phát hiện host key đổi, gọn hơn lưu cả khóa.

use crate::error::Result;
use crate::store;
use russh::keys::ssh_key::PublicKey;
use serde::{Deserialize, Serialize};

const FILE: &str = "known_hosts.json";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub host: String,
    pub port: u16,
    pub algo: String,
    pub fingerprint: String,
    pub added_at: u64,
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn load() -> Vec<KnownHost> {
    store::read_doc(FILE)
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save(list: &[KnownHost]) -> Result<()> {
    store::write_doc(FILE, &serde_json::to_value(list)?)
}

pub fn lookup(host: &str, port: u16) -> Option<KnownHost> {
    load()
        .into_iter()
        .find(|k| k.host.eq_ignore_ascii_case(host) && k.port == port)
}

pub fn remember(host: &str, port: u16, algo: &str, fingerprint: &str) -> Result<()> {
    let mut list = load();
    list.retain(|k| !(k.host.eq_ignore_ascii_case(host) && k.port == port));
    list.push(KnownHost {
        host: host.to_string(),
        port,
        algo: algo.to_string(),
        fingerprint: fingerprint.to_string(),
        added_at: now(),
    });
    save(&list)
}

pub fn forget(host: &str, port: u16) -> Result<()> {
    let mut list = load();
    list.retain(|k| !(k.host.eq_ignore_ascii_case(host) && k.port == port));
    save(&list)
}

pub fn fingerprint_of(key: &PublicKey) -> (String, String) {
    (
        key.algorithm().as_str().to_string(),
        key.fingerprint(Default::default()).to_string(),
    )
}

/// Nhập các dòng dạng thường (không hash) từ ~/.ssh/known_hosts.
/// Dòng đã băm (`|1|...`) bị bỏ qua vì không thể suy ra hostname.
pub fn import_openssh() -> Result<(usize, usize)> {
    let Some(home) = dirs::home_dir() else {
        return Ok((0, 0));
    };
    let path = home.join(".ssh/known_hosts");
    if !path.exists() {
        return Ok((0, 0));
    }
    let text = std::fs::read_to_string(&path)?;
    let mut list = load();
    let mut added = 0usize;
    let mut skipped = 0usize;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(hosts) = parts.next() else { continue };
        let Some(algo) = parts.next() else { continue };
        let Some(b64) = parts.next() else { continue };
        if hosts.starts_with("|1|") {
            skipped += 1;
            continue;
        }
        let Ok(key) = PublicKey::from_openssh(&format!("{algo} {b64}")) else {
            skipped += 1;
            continue;
        };
        let (algo, fp) = fingerprint_of(&key);
        for h in hosts.split(',') {
            let (host, port) = split_host_port(h);
            if list
                .iter()
                .any(|k| k.host.eq_ignore_ascii_case(&host) && k.port == port)
            {
                continue;
            }
            list.push(KnownHost {
                host,
                port,
                algo: algo.clone(),
                fingerprint: fp.clone(),
                added_at: now(),
            });
            added += 1;
        }
    }
    save(&list)?;
    Ok((added, skipped))
}

/// `[host]:2222` → ("host", 2222); `host` → ("host", 22)
pub(crate) fn split_host_port(entry: &str) -> (String, u16) {
    if let Some(rest) = entry.strip_prefix('[') {
        if let Some((h, p)) = rest.split_once("]:") {
            return (h.to_string(), p.parse().unwrap_or(22));
        }
    }
    (entry.trim_start_matches('[').trim_end_matches(']').to_string(), 22)
}

#[cfg(test)]
mod tests {
    use super::split_host_port;

    #[test]
    fn parses_known_hosts_entries() {
        assert_eq!(split_host_port("example.com"), ("example.com".into(), 22));
        assert_eq!(split_host_port("[example.com]:2222"), ("example.com".into(), 2222));
        assert_eq!(split_host_port("[10.0.0.1]:22"), ("10.0.0.1".into(), 22));
        // Cổng rác → về mặc định thay vì panic.
        assert_eq!(split_host_port("[h]:abc"), ("h".into(), 22));
    }
}
