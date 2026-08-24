//! Đọc ~/.ssh/config và thư mục khóa để nhập session có sẵn.

use crate::error::Result;
use russh::keys::ssh_key::PublicKey;
use serde::Serialize;

#[derive(Serialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SshHost {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

pub fn import() -> Result<Vec<SshHost>> {
    let Some(home) = dirs::home_dir() else {
        return Ok(vec![]);
    };
    let path = home.join(".ssh/config");
    if !path.exists() {
        return Ok(vec![]);
    }
    Ok(parse(&std::fs::read_to_string(path)?))
}

/// Bỏ qua các mẫu chứa ký tự đại diện vì không nối được trực tiếp.
pub fn parse(text: &str) -> Vec<SshHost> {
    let mut out: Vec<SshHost> = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = match line.split_once(|c: char| c == ' ' || c == '\t' || c == '=') {
            Some((k, v)) => (k.trim().to_lowercase(), v.trim().trim_start_matches('=').trim()),
            None => continue,
        };
        if key == "host" {
            for name in value.split_whitespace() {
                if name.contains('*') || name.contains('?') {
                    continue;
                }
                out.push(SshHost {
                    name: name.to_string(),
                    host: name.to_string(),
                    port: 22,
                    ..Default::default()
                });
            }
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        match key.as_str() {
            "hostname" => cur.host = value.to_string(),
            "port" => cur.port = value.parse().unwrap_or(22),
            "user" => cur.user = value.to_string(),
            "identityfile" => cur.identity_file = Some(value.to_string()),
            "proxyjump" => cur.proxy_jump = Some(value.to_string()),
            _ => {}
        }
    }
    out
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalKey {
    pub path: String,
    pub name: String,
    pub algo: String,
    pub fingerprint: Option<String>,
    pub comment: String,
    pub has_public: bool,
}

/// Quét ~/.ssh tìm khóa riêng (file có header PEM/OPENSSH).
pub fn local_keys() -> Result<Vec<LocalKey>> {
    let Some(home) = dirs::home_dir() else {
        return Ok(vec![]);
    };
    let dir = home.join(".ssh");
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir)?.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        if name.ends_with(".pub") || name == "known_hosts" || name == "config" || name == "authorized_keys" {
            continue;
        }
        let Ok(head) = std::fs::read_to_string(&p) else { continue };
        if !head.starts_with("-----BEGIN") {
            continue;
        }
        let pub_path = p.with_extension("pub");
        let pub_path = if pub_path.exists() {
            Some(pub_path)
        } else {
            let alt = p.with_file_name(format!("{name}.pub"));
            alt.exists().then_some(alt)
        };
        let (algo, fingerprint, comment) = match pub_path.as_ref().and_then(|pp| {
            std::fs::read_to_string(pp)
                .ok()
                .and_then(|t| PublicKey::from_openssh(t.trim()).ok())
        }) {
            Some(k) => (
                k.algorithm().as_str().to_string(),
                Some(k.fingerprint(Default::default()).to_string()),
                k.comment().to_string(),
            ),
            None => (
                if head.contains("OPENSSH PRIVATE KEY") { "openssh".into() } else { "pem".into() },
                None,
                String::new(),
            ),
        };
        out.push(LocalKey {
            path: p.to_string_lossy().into_owned(),
            name,
            algo,
            fingerprint,
            comment,
            has_public: pub_path.is_some(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn reads_hosts_and_options() {
        let out = parse(
            "\
# ghi chú
Host bastion
    HostName 203.0.113.9
    User ops
    Port 2222

Host web1 web2
    HostName 10.0.0.5
    IdentityFile ~/.ssh/id_ed25519
    ProxyJump bastion

Host *.internal
    User nobody
",
        );
        assert_eq!(out.len(), 3, "mẫu wildcard phải bị bỏ qua: {out:?}");

        let b = &out[0];
        assert_eq!((b.name.as_str(), b.host.as_str(), b.user.as_str(), b.port), ("bastion", "203.0.113.9", "ops", 2222));

        // `Host web1 web2` tạo hai mục, nhưng option chỉ gắn vào mục cuối —
        // đúng như cách OpenSSH áp dụng cho khối.
        assert_eq!(out[1].name, "web1");
        assert_eq!(out[2].name, "web2");
        assert_eq!(out[2].proxy_jump.as_deref(), Some("bastion"));
        assert_eq!(out[2].identity_file.as_deref(), Some("~/.ssh/id_ed25519"));
    }

    #[test]
    fn tolerates_equals_syntax() {
        let out = parse("Host x\n  HostName=1.2.3.4\n  Port=2200\n");
        assert_eq!(out.len(), 1);
        assert_eq!((out[0].host.as_str(), out[0].port), ("1.2.3.4", 2200));
    }
}
