//! Port forwarding: local (-L), remote (-R) và dynamic SOCKS5 (-D).
//!
//! Mỗi tunnel giữ kết nối SSH riêng, không phụ thuộc tab terminal nào, và có
//! một vòng giám sát: rớt kết nối thì (nếu bật) tự nối lại mãi đến khi người
//! dùng bấm dừng. Trạng thái báo lên giao diện qua sự kiện `tunnel:state`.

use crate::error::{AppError, Result};
use crate::ssh::conn::{self, ConnectOpts, RemoteFwd, SshConn};
use crate::state::{AppState, Tunnel};
use crate::bail;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use crate::ui::Ui;
use tokio::io::{copy_bidirectional, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TunnelSpec {
    pub id: String,
    /// Kết nối riêng của tunnel; `connect.id` là id kết nối.
    pub connect: ConnectOpts,
    /// `local` | `remote` | `dynamic`
    pub kind: String,
    pub bind_host: String,
    pub bind_port: u16,
    pub dest_host: String,
    pub dest_port: u16,
    /// Rớt kết nối thì tự nối lại thay vì dừng hẳn.
    pub auto_reconnect: bool,
}

/// Số giây chờ trước mỗi lần nối lại; hết danh sách thì giữ mức cuối.
const BACKOFF: [u64; 5] = [1, 2, 5, 10, 30];

/// Chạy tunnel (hoặc chạy lại nếu đang chạy). Lỗi trả về ngay chỉ khi không mở
/// được cổng cục bộ; lỗi kết nối đi qua `tunnel:state`.
pub async fn start(ui: Ui, state: Arc<AppState>, spec: TunnelSpec) -> Result<()> {
    if !matches!(spec.kind.as_str(), "local" | "remote" | "dynamic") {
        bail!("Loại tunnel không hợp lệ: {}", spec.kind);
    }
    stop(&state, &spec.id).await?;

    // Cổng local/SOCKS mở một lần và giữ suốt vòng đời tunnel: trong lúc nối
    // lại, app client chỉ phải chờ trong hàng đợi chứ không bị từ chối.
    let listener = if spec.kind == "remote" {
        None
    } else {
        let host = bind_host(&spec);
        let l = TcpListener::bind((host.as_str(), spec.bind_port))
            .await
            .map_err(|e| AppError::Msg(format!("Không mở được {host}:{}: {e}", spec.bind_port)))?;
        Some(l)
    };

    let (stop_tx, stop_rx) = oneshot::channel();
    state.tunnels.lock().await.insert(spec.id.clone(), Tunnel { stop: Some(stop_tx) });
    tokio::spawn(supervise(ui, state, spec, listener, stop_rx));
    Ok(())
}

pub async fn stop(state: &Arc<AppState>, id: &str) -> Result<()> {
    if let Some(mut t) = state.tunnels.lock().await.remove(id) {
        if let Some(s) = t.stop.take() {
            let _ = s.send(());
        }
    }
    Ok(())
}

fn bind_host(spec: &TunnelSpec) -> String {
    if spec.bind_host.is_empty() { "127.0.0.1".into() } else { spec.bind_host.clone() }
}

fn emit(ui: &Ui, id: &str, status: &str, extra: Value) {
    let mut v = json!({ "id": id, "state": status });
    if let (Value::Object(m), Value::Object(e)) = (&mut v, extra) {
        m.extend(e);
    }
    ui.emit("tunnel:state", v);
}

/// Kết quả một lượt phục vụ trên một kết nối.
enum Served {
    Stopped,
    Dropped(String),
}

async fn supervise(
    ui: Ui,
    state: Arc<AppState>,
    spec: TunnelSpec,
    listener: Option<TcpListener>,
    mut stop: oneshot::Receiver<()>,
) {
    let mut attempt = 0;
    let reason = loop {
        emit(&ui, &spec.id, "connecting", json!({}));
        let dialed = tokio::select! {
            _ = &mut stop => return,
            r = conn::connect(ui.clone(), state.clone(), spec.connect.clone()) => r,
        };
        let reason = match dialed {
            Ok(c) => {
                attempt = 0;
                let served = serve(&ui, &spec, &c, listener.as_ref(), &mut stop).await;
                let _ = conn::disconnect(&state, &spec.connect.id).await;
                match served {
                    Served::Stopped => return,
                    Served::Dropped(why) => why,
                }
            }
            // Sai mật khẩu hay từ chối host key thì thử lại cũng vô ích.
            Err(e @ AppError::Rejected(_)) => break e.to_string(),
            Err(e) => e.to_string(),
        };
        if !spec.auto_reconnect {
            break reason;
        }
        let wait = BACKOFF[attempt.min(BACKOFF.len() - 1)];
        attempt += 1;
        emit(&ui, &spec.id, "retrying", json!({ "detail": reason, "retryIn": wait }));
        tokio::select! {
            _ = &mut stop => return,
            _ = tokio::time::sleep(Duration::from_secs(wait)) => {}
        }
    };
    // Tự dừng (không phải do người dùng): dọn mục của chính mình.
    state.tunnels.lock().await.remove(&spec.id);
    emit(&ui, &spec.id, "stopped", json!({ "detail": reason }));
}

async fn serve(
    ui: &Ui,
    spec: &TunnelSpec,
    c: &Arc<SshConn>,
    listener: Option<&TcpListener>,
    stop: &mut oneshot::Receiver<()>,
) -> Served {
    let port = match listener {
        Some(l) => l.local_addr().map(|a| a.port()).unwrap_or(spec.bind_port),
        None => match remote_forward(c, spec).await {
            Ok(p) => p,
            Err(e) => return Served::Dropped(e.to_string()),
        },
    };
    emit(ui, &spec.id, "running", json!({ "port": port }));

    // Keepalive của russh đóng session khi server im lặng; ở đây chỉ cần nhìn.
    let mut check = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = &mut *stop => return Served::Stopped,
            _ = check.tick() => {
                if c.handle.lock().await.is_closed() {
                    return Served::Dropped("mất kết nối SSH".into());
                }
            }
            accepted = accept(listener) => {
                let Ok((sock, _)) = accepted else { continue };
                let (c, spec) = (c.clone(), spec.clone());
                tokio::spawn(async move {
                    let _ = if spec.kind == "dynamic" {
                        socks5(sock, c).await
                    } else {
                        forward(sock, c, &spec.dest_host, spec.dest_port).await
                    };
                });
            }
        }
    }
}

async fn accept(l: Option<&TcpListener>) -> std::io::Result<(TcpStream, std::net::SocketAddr)> {
    match l {
        Some(l) => l.accept().await,
        None => std::future::pending().await,
    }
}

/// Đăng ký -R trên kết nối mới. Ngắt kết nối là server tự hủy, không cần dọn.
async fn remote_forward(c: &Arc<SshConn>, spec: &TunnelSpec) -> Result<u16> {
    let assigned = c
        .handle
        .lock()
        .await
        .tcpip_forward(bind_host(spec), spec.bind_port as u32)
        .await?;
    let port = if spec.bind_port == 0 { assigned as u16 } else { spec.bind_port };
    c.shared.remote_fwds.lock().await.push(RemoteFwd {
        bind_port: port as u32,
        local_host: if spec.dest_host.is_empty() { "127.0.0.1".into() } else { spec.dest_host.clone() },
        local_port: spec.dest_port,
    });
    Ok(port)
}

async fn forward(
    mut sock: TcpStream,
    conn: Arc<SshConn>,
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
async fn socks5(mut sock: TcpStream, conn: Arc<SshConn>) -> Result<()> {
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
