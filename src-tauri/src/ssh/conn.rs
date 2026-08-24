//! Kết nối SSH: chuỗi jump host, xác thực nhiều phương thức, X11 / agent
//! forwarding và xác minh host key có hỏi người dùng.

use crate::error::{AppError, Result};
use crate::hostkeys;
use crate::state::AppState;
use crate::{bail, ssh::pipe};
use russh::client::{self, Config, Handle, Msg};
use russh::{Channel, Preferred};
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use crate::ui::Ui;
use tokio::sync::Mutex;

/// Một chặng trong đường đi (bastion hoặc đích cuối).
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Hop {
    pub label: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// Thứ tự thử: `agent` | `key` | `password` | `interactive` | `none`.
    pub auth: Vec<String>,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectOpts {
    pub id: String,
    pub target: Hop,
    /// Bastion theo thứ tự đi qua: `jumps[0]` được nối trực tiếp.
    pub jumps: Vec<Hop>,
    pub keepalive: u64,
    pub compression: bool,
    pub x11: bool,
    pub agent_forward: bool,
    /// `true` = host key lạ bị từ chối ngay, không hỏi.
    pub strict_host_key: bool,
}

#[derive(Clone, Debug)]
pub struct RemoteFwd {
    pub bind_port: u32,
    pub local_host: String,
    pub local_port: u16,
}

/// Trạng thái dùng chung giữa handler và các lệnh tunnel của cùng kết nối.
#[derive(Default)]
pub struct ConnShared {
    pub remote_fwds: Mutex<Vec<RemoteFwd>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnInfo {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub via: Vec<String>,
    pub connected_at: u64,
}

pub struct SshConn {
    pub info: ConnInfo,
    /// `tcpip_forward` cần `&mut`, nên handle nằm sau Mutex.
    pub handle: Mutex<Handle<Client>>,
    pub shared: Arc<ConnShared>,
    pub sftp: Mutex<Option<Arc<SftpSession>>>,
    /// Giữ các handle bastion sống đến khi kết nối đích đóng.
    _chain: Vec<Handle<Client>>,
}

impl SshConn {
    /// SFTP session dùng lại được — mở lần đầu rồi cache.
    pub async fn sftp(&self) -> Result<Arc<SftpSession>> {
        let mut slot = self.sftp.lock().await;
        if let Some(s) = slot.as_ref() {
            return Ok(s.clone());
        }
        let ch = self.handle.lock().await.channel_open_session().await?;
        ch.request_subsystem(true, "sftp").await?;
        let s = Arc::new(SftpSession::new(ch.into_stream()).await?);
        *slot = Some(s.clone());
        Ok(s)
    }
}

// ── Handler ───────────────────────────────────────────────────────────────

pub struct Client {
    ui: Ui,
    conn_id: String,
    host: String,
    port: u16,
    strict: bool,
    x11: bool,
    agent_forward: bool,
    shared: Arc<ConnShared>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn auth_banner(
        &mut self,
        banner: &str,
        _s: &mut client::Session,
    ) -> std::result::Result<(), Self::Error> {
        self.ui.emit(
            "conn:banner",
            json!({ "connId": self.conn_id, "text": banner }),
        );
        Ok(())
    }

    async fn check_server_key(
        &mut self,
        key: &russh::keys::ssh_key::PublicKey,
    ) -> std::result::Result<bool, Self::Error> {
        let (algo, fp) = hostkeys::fingerprint_of(key);
        let known = hostkeys::lookup(&self.host, self.port);

        if let Some(k) = &known {
            if k.fingerprint == fp {
                return Ok(true);
            }
        }
        if self.strict {
            self.ui.emit(
                "conn:hostkey-rejected",
                json!({ "connId": self.conn_id, "host": self.host, "fingerprint": fp }),
            );
            return Ok(false);
        }

        let answer = self
            .ui
            .ask(
                "hostkey:ask",
                json!({
                    "connId": self.conn_id,
                    "host": self.host,
                    "port": self.port,
                    "algo": algo,
                    "fingerprint": fp,
                    "status": if known.is_some() { "changed" } else { "new" },
                    "previous": known.as_ref().map(|k| k.fingerprint.clone()),
                }),
                180,
            )
            .await;

        let accept = answer
            .as_ref()
            .and_then(|v| v.get("accept").and_then(|b| b.as_bool()))
            .unwrap_or(false);
        let remember = answer
            .as_ref()
            .and_then(|v| v.get("remember").and_then(|b| b.as_bool()))
            .unwrap_or(false);

        if accept && remember {
            let _ = hostkeys::remember(&self.host, self.port, &algo, &fp);
        }
        Ok(accept)
    }

    async fn server_channel_open_x11(
        &mut self,
        channel: Channel<Msg>,
        _addr: &str,
        _port: u32,
        _s: &mut client::Session,
    ) -> std::result::Result<(), Self::Error> {
        if !self.x11 {
            return Ok(());
        }
        let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".into());
        let (ui, id) = (self.ui.clone(), self.conn_id.clone());
        tokio::spawn(async move {
            if let Err(e) = pipe::to_x11(channel, &display).await {
                ui.emit("conn:warn", json!({ "connId": id, "text": format!("X11: {e}") }));
            }
        });
        Ok(())
    }

    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<Msg>,
        _s: &mut client::Session,
    ) -> std::result::Result<(), Self::Error> {
        if !self.agent_forward {
            return Ok(());
        }
        let sock = std::env::var("SSH_AUTH_SOCK").ok();
        let (ui, id) = (self.ui.clone(), self.conn_id.clone());
        tokio::spawn(async move {
            match sock {
                Some(p) => {
                    if let Err(e) = pipe::to_unix(channel, &p).await {
                        ui.emit("conn:warn", json!({ "connId": id, "text": format!("Agent forward: {e}") }));
                    }
                }
                None => ui.emit(
                    "conn:warn",
                    json!({ "connId": id, "text": "Agent forward: thiếu SSH_AUTH_SOCK" }),
                ),
            }
        });
        Ok(())
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        _connected_address: &str,
        connected_port: u32,
        _orig_addr: &str,
        _orig_port: u32,
        _s: &mut client::Session,
    ) -> std::result::Result<(), Self::Error> {
        let target = self
            .shared
            .remote_fwds
            .lock()
            .await
            .iter()
            .find(|f| f.bind_port == connected_port)
            .map(|f| (f.local_host.clone(), f.local_port));

        let (ui, id) = (self.ui.clone(), self.conn_id.clone());
        tokio::spawn(async move {
            match target {
                Some((h, p)) => {
                    if let Err(e) = pipe::to_tcp(channel, &h, p).await {
                        ui.emit("conn:warn", json!({ "connId": id, "text": format!("Remote forward: {e}") }));
                    }
                }
                None => {
                    let _ = channel.close().await;
                }
            }
        });
        Ok(())
    }
}

// ── Kết nối ───────────────────────────────────────────────────────────────

fn config_of(o: &ConnectOpts) -> Arc<Config> {
    Arc::new(Config {
        preferred: if o.compression {
            Preferred::COMPRESSED
        } else {
            Preferred::DEFAULT
        },
        keepalive_interval: (o.keepalive > 0).then(|| Duration::from_secs(o.keepalive)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    })
}

pub async fn connect(ui: Ui, state: Arc<AppState>, o: ConnectOpts) -> Result<Arc<SshConn>> {
    if o.target.host.trim().is_empty() {
        bail!("Thiếu địa chỉ máy chủ");
    }
    let cfg = config_of(&o);
    let shared = Arc::new(ConnShared::default());

    let mut chain: Vec<Handle<Client>> = Vec::new();
    let mut via: Vec<String> = Vec::new();

    // Đi qua từng bastion.
    for hop in &o.jumps {
        let label = hop_label(hop);
        phase(&ui, &o.id, "Đang nối bastion", &label);
        let h = match chain.last() {
            None => client::connect(cfg.clone(), (hop.host.as_str(), hop.port), client_for(&ui, &o, &shared, hop))
                .await
                .map_err(|e| AppError::Msg(format!("Không nối được {label}: {e}")))?,
            Some(prev) => {
                let ch = prev
                    .channel_open_direct_tcpip(hop.host.clone(), hop.port as u32, "127.0.0.1", 0)
                    .await
                    .map_err(|e| AppError::Msg(format!("Mở đường tới {label} thất bại: {e}")))?;
                client::connect_stream(cfg.clone(), ch.into_stream(), client_for(&ui, &o, &shared, hop))
                    .await
                    .map_err(|e| AppError::Msg(format!("Không nối được {label}: {e}")))?
            }
        };
        phase(&ui, &o.id, "Đang xác thực bastion", &label);
        let h = super::auth::authenticate(ui.clone(), h, hop.clone(), o.id.clone()).await?;
        chain.push(h);
        via.push(label);
    }

    // Chặng cuối.
    let t = &o.target;
    let label = hop_label(t);
    phase(&ui, &o.id, "Đang kết nối", &label);
    let h = match chain.last() {
        None => client::connect(cfg.clone(), (t.host.as_str(), t.port), client_for(&ui, &o, &shared, t))
            .await
            .map_err(|e| AppError::Msg(format!("Không nối được {label}: {e}")))?,
        Some(prev) => {
            let ch = prev
                .channel_open_direct_tcpip(t.host.clone(), t.port as u32, "127.0.0.1", 0)
                .await
                .map_err(|e| AppError::Msg(format!("Mở đường tới {label} thất bại: {e}")))?;
            client::connect_stream(cfg.clone(), ch.into_stream(), client_for(&ui, &o, &shared, t))
                .await
                .map_err(|e| AppError::Msg(format!("Không nối được {label}: {e}")))?
        }
    };

    phase(&ui, &o.id, "Đang xác thực", &label);
    let h = super::auth::authenticate(ui.clone(), h, t.clone(), o.id.clone()).await?;

    let conn = Arc::new(SshConn {
        info: ConnInfo {
            id: o.id.clone(),
            host: t.host.clone(),
            port: t.port,
            user: t.user.clone(),
            via,
            connected_at: hostkeys::now(),
        },
        handle: Mutex::new(h),
        shared,
        sftp: Mutex::new(None),
        _chain: chain,
    });

    state.conns.lock().await.insert(o.id.clone(), conn.clone());
    ui.emit("conn:ready", json!({ "conn": conn.info.clone() }));
    Ok(conn)
}

pub(crate) fn phase(ui: &Ui, conn_id: &str, text: &str, hop: &str) {
    ui.emit("conn:phase", json!({ "connId": conn_id, "text": text, "hop": hop }));
}

/// Hàm tự do thay vì closure: closure sẽ bắt tham chiếu tới các field của
/// `ConnectOpts` và giữ chúng qua `await`, khiến future không còn `Send`.
fn client_for(ui: &Ui, o: &ConnectOpts, shared: &Arc<ConnShared>, hop: &Hop) -> Client {
    Client {
        ui: ui.clone(),
        conn_id: o.id.clone(),
        host: hop.host.clone(),
        port: hop.port,
        strict: o.strict_host_key,
        x11: o.x11,
        agent_forward: o.agent_forward,
        shared: shared.clone(),
    }
}

pub(crate) fn hop_label(h: &Hop) -> String {
    if h.label.is_empty() {
        format!("{}@{}:{}", h.user, h.host, h.port)
    } else {
        h.label.clone()
    }
}

/// `~/x` và (trên Windows) `~\x` → đường dẫn tuyệt đối.
pub fn expand_tilde(p: &str) -> String {
    let rest = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\"));
    match (rest, dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest).to_string_lossy().into_owned(),
        _ => p.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::expand_tilde;

    #[test]
    fn expands_home_prefix() {
        let home = dirs::home_dir().unwrap().to_string_lossy().into_owned();
        assert_eq!(expand_tilde("~/.ssh/id_ed25519"), format!("{home}/.ssh/id_ed25519"));
        // Dấu gạch chéo ngược cũng được nhận, cho người dùng Windows.
        assert!(expand_tilde("~\\.ssh\\id_rsa").starts_with(&home));
        // Không có tiền tố `~` thì giữ nguyên.
        assert_eq!(expand_tilde("/etc/ssh/key"), "/etc/ssh/key");
        assert_eq!(expand_tilde("~notauser/x"), "~notauser/x");
    }
}

/// Đóng kết nối và mọi thứ phụ thuộc vào nó.
pub async fn disconnect(state: &Arc<AppState>, id: &str) -> Result<()> {
    if let Some(c) = state.conns.lock().await.remove(id) {
        let _ = c
            .handle
            .lock()
            .await
            .disconnect(russh::Disconnect::ByApplication, "bye", "")
            .await;
    }
    let mut tunnels = state.tunnels.lock().await;
    let ids: Vec<String> = tunnels
        .iter()
        .filter(|(_, t)| t.conn_id == id)
        .map(|(k, _)| k.clone())
        .collect();
    for tid in ids {
        if let Some(mut t) = tunnels.remove(&tid) {
            if let Some(s) = t.stop.take() {
                let _ = s.send(());
            }
        }
    }
    Ok(())
}
