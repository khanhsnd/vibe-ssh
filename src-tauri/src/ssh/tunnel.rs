//! Port forwarding: local (-L), remote (-R) và dynamic SOCKS5 (-D).

use crate::error::Result;
use crate::state::{AppState, Tunnel};
use crate::{bail, ssh::conn::RemoteFwd};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use crate::ui::Ui;
use tokio::io::{copy_bidirectional, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TunnelSpec {
    pub id: String,
    pub conn_id: String,
    /// `local` | `remote` | `dynamic`
    pub kind: String,
    pub bind_host: String,
    pub bind_port: u16,
    pub dest_host: String,
    pub dest_port: u16,
}

pub async fn start(ui: Ui, state: Arc<AppState>, spec: TunnelSpec) -> Result<u16> {
    let conn = state.conn(&spec.conn_id).await?;
    let bind_host = if spec.bind_host.is_empty() {
        "127.0.0.1".to_string()
    } else {
        spec.bind_host.clone()
    };
    let (stop_tx, stop_rx) = oneshot::channel::<()>();

    let port = match spec.kind.as_str() {
        "local" | "dynamic" => {
            let listener = TcpListener::bind((bind_host.as_str(), spec.bind_port))
                .await
                .map_err(|e| {
                    crate::error::AppError::Msg(format!(
                        "Không mở được {bind_host}:{}: {e}",
                        spec.bind_port
                    ))
                })?;
            let port = listener.local_addr()?.port();
            let dynamic = spec.kind == "dynamic";
            let (ui2, spec2, conn2) = (ui.clone(), spec.clone(), conn.clone());
            tokio::spawn(async move {
                let reason = accept_loop(listener, conn2, spec2.clone(), dynamic, stop_rx).await;
                ui2.emit("tunnel:closed", json!({ "id": spec2.id, "reason": reason }));
            });
            port
        }
        "remote" => {
            let assigned = conn
                .handle
                .lock()
                .await
                .tcpip_forward(bind_host.clone(), spec.bind_port as u32)
                .await?;
            let port = if spec.bind_port == 0 {
                assigned as u16
            } else {
                spec.bind_port
            };
            conn.shared.remote_fwds.lock().await.push(RemoteFwd {
                bind_port: port as u32,
                local_host: if spec.dest_host.is_empty() {
                    "127.0.0.1".into()
                } else {
                    spec.dest_host.clone()
                },
                local_port: spec.dest_port,
            });
            // Kênh dừng: khi nhận tín hiệu thì hủy forward phía server.
            let (ui2, spec2, conn2, bind2) =
                (ui.clone(), spec.clone(), conn.clone(), bind_host.clone());
            tokio::spawn(async move {
                let _ = stop_rx.await;
                let _ = conn2
                    .handle
                    .lock()
                    .await
                    .cancel_tcpip_forward(bind2, port as u32)
                    .await;
                conn2
                    .shared
                    .remote_fwds
                    .lock()
                    .await
                    .retain(|f| f.bind_port != port as u32);
                ui2.emit("tunnel:closed", json!({ "id": spec2.id, "reason": "đã dừng" }));
            });
            port
        }
        other => bail!("Loại tunnel không hợp lệ: {other}"),
    };

    state.tunnels.lock().await.insert(
        spec.id.clone(),
        Tunnel { stop: Some(stop_tx), conn_id: spec.conn_id.clone() },
    );
    ui.emit("tunnel:open", json!({ "id": spec.id, "port": port, "kind": spec.kind }));
    Ok(port)
}

pub async fn stop(state: &Arc<AppState>, id: &str) -> Result<()> {
    if let Some(mut t) = state.tunnels.lock().await.remove(id) {
        if let Some(s) = t.stop.take() {
            let _ = s.send(());
        }
    }
    Ok(())
}

async fn accept_loop(
    listener: TcpListener,
    conn: Arc<crate::ssh::conn::SshConn>,
    spec: TunnelSpec,
    dynamic: bool,
    mut stop: oneshot::Receiver<()>,
) -> String {
    loop {
        tokio::select! {
            _ = &mut stop => return "đã dừng".into(),
            accepted = listener.accept() => {
                let Ok((sock, _peer)) = accepted else { return "lỗi accept".into() };
                let conn = conn.clone();
                let spec = spec.clone();
                tokio::spawn(async move {
                    let _ = if dynamic {
                        socks5(sock, conn).await
                    } else {
                        forward(sock, conn, &spec.dest_host, spec.dest_port).await
                    };
                });
            }
        }
    }
}

async fn forward(
    mut sock: TcpStream,
    conn: Arc<crate::ssh::conn::SshConn>,
    host: &str,
    port: u16,
) -> Result<()> {
    let ch = conn
        .handle
        .lock()
        .await
        .channel_open_direct_tcpip(host.to_string(), port as u32, "127.0.0.1", 0)
        .await?;
    let mut remote = ch.into_stream();
    copy_bidirectional(&mut sock, &mut remote).await?;
    Ok(())
}

/// SOCKS5 tối giản: không xác thực, chỉ CONNECT — đủ cho `-D` kiểu OpenSSH.
async fn socks5(mut sock: TcpStream, conn: Arc<crate::ssh::conn::SshConn>) -> Result<()> {
    let mut head = [0u8; 2];
    sock.read_exact(&mut head).await?;
    if head[0] != 5 {
        bail!("SOCKS: chỉ hỗ trợ version 5");
    }
    let mut methods = vec![0u8; head[1] as usize];
    sock.read_exact(&mut methods).await?;
    sock.write_all(&[5, 0]).await?; // no-auth

    let mut req = [0u8; 4];
    sock.read_exact(&mut req).await?;
    if req[1] != 1 {
        sock.write_all(&[5, 7, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
        bail!("SOCKS: chỉ hỗ trợ CONNECT");
    }

    let host = match req[3] {
        1 => {
            let mut a = [0u8; 4];
            sock.read_exact(&mut a).await?;
            std::net::Ipv4Addr::from(a).to_string()
        }
        3 => {
            let mut l = [0u8; 1];
            sock.read_exact(&mut l).await?;
            let mut d = vec![0u8; l[0] as usize];
            sock.read_exact(&mut d).await?;
            String::from_utf8_lossy(&d).into_owned()
        }
        4 => {
            let mut a = [0u8; 16];
            sock.read_exact(&mut a).await?;
            std::net::Ipv6Addr::from(a).to_string()
        }
        _ => {
            sock.write_all(&[5, 8, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
            bail!("SOCKS: kiểu địa chỉ không hỗ trợ");
        }
    };
    let mut p = [0u8; 2];
    sock.read_exact(&mut p).await?;
    let port = u16::from_be_bytes(p);

    let opened = conn
        .handle
        .lock()
        .await
        .channel_open_direct_tcpip(host, port as u32, "127.0.0.1", 0)
        .await;

    match opened {
        Ok(ch) => {
            sock.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
            let mut remote = ch.into_stream();
            copy_bidirectional(&mut sock, &mut remote).await?;
            Ok(())
        }
        Err(e) => {
            sock.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
            Err(e.into())
        }
    }
}
