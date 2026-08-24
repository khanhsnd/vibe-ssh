//! Telnet đầu-cuối: dựng một server TCP nhỏ nói đúng giao thức, rồi kiểm tra
//! `telnet::open` thương lượng, nhận dữ liệu và gửi dữ liệu đi đúng cách.

use crate::state::{AppState, TermIn};
use crate::telnet::{self, TelnetOpts};
use crate::ui;
use base64::Engine;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc::UnboundedReceiver;

const IAC: u8 = 255;
const SE: u8 = 240;
const SB: u8 = 250;
const WILL: u8 = 251;
const DO: u8 = 253;
const OPT_TTYPE: u8 = 24;
const OPT_NAWS: u8 = 31;
const OPT_ECHO: u8 = 1;

fn term_text(ev: &str, v: &Value) -> Option<String> {
    if ev != "term:data" {
        return None;
    }
    let b64 = v.get("b64")?.as_str()?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

async fn read_until(rx: &mut UnboundedReceiver<(String, Value)>, needle: &str) -> String {
    let mut seen = String::new();
    let _ = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some((ev, v)) = rx.recv().await {
            if let Some(t) = term_text(&ev, &v) {
                seen.push_str(&t);
                if seen.contains(needle) {
                    return;
                }
            }
        }
    })
    .await;
    seen
}

#[test]
fn negotiates_then_carries_data_both_ways() {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();

            // Server: hỏi TTYPE và NAWS, gửi banner, rồi đọc lại lệnh của client.
            let server = tokio::spawn(async move {
                let (mut c, _) = listener.accept().await.unwrap();
                let mut seen: Vec<u8> = Vec::new();
                let mut buf = [0u8; 1024];

                c.write_all(&[IAC, DO, OPT_TTYPE, IAC, DO, OPT_NAWS, IAC, WILL, OPT_ECHO])
                    .await
                    .unwrap();

                // Đọc đến khi thấy đủ phản hồi thương lượng.
                let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
                while tokio::time::Instant::now() < deadline {
                    let want_ttype = seen
                        .windows(3)
                        .any(|w| w == [IAC, WILL, OPT_TTYPE]);
                    let want_naws = seen.windows(3).any(|w| w == [IAC, SB, OPT_NAWS]);
                    if want_ttype && want_naws {
                        break;
                    }
                    match tokio::time::timeout(Duration::from_millis(300), c.read(&mut buf)).await {
                        Ok(Ok(0)) | Ok(Err(_)) => break,
                        Ok(Ok(n)) => seen.extend_from_slice(&buf[..n]),
                        Err(_) => continue,
                    }
                }

                // Hỏi tên terminal.
                c.write_all(&[IAC, SB, OPT_TTYPE, 1, IAC, SE]).await.unwrap();
                let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
                while tokio::time::Instant::now() < deadline {
                    if seen.windows(4).any(|w| w == b"xter") {
                        break;
                    }
                    match tokio::time::timeout(Duration::from_millis(300), c.read(&mut buf)).await {
                        Ok(Ok(0)) | Ok(Err(_)) => break,
                        Ok(Ok(n)) => seen.extend_from_slice(&buf[..n]),
                        Err(_) => continue,
                    }
                }

                c.write_all(b"WELCOME-TELNET\r\n").await.unwrap();

                // Chờ client gửi lệnh.
                let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
                while tokio::time::Instant::now() < deadline {
                    if seen.windows(8).any(|w| w == b"whoami\r\n") {
                        break;
                    }
                    match tokio::time::timeout(Duration::from_millis(300), c.read(&mut buf)).await {
                        Ok(Ok(0)) | Ok(Err(_)) => break,
                        Ok(Ok(n)) => seen.extend_from_slice(&buf[..n]),
                        Err(_) => continue,
                    }
                }
                seen
            });

            let state = Arc::new(AppState::default());
            let (u, mut rx) = ui::channel(state.asks.clone());
            telnet::open(
                u,
                state.clone(),
                TelnetOpts {
                    term_id: "tn-1".into(),
                    host: "127.0.0.1".into(),
                    port,
                    cols: 132,
                    rows: 43,
                    term: "xterm-256color".into(),
                    log_path: None,
                },
            )
            .await
            .expect("mở telnet");

            let banner = read_until(&mut rx, "WELCOME-TELNET").await;
            assert!(banner.contains("WELCOME-TELNET"), "banner telnet: {banner:?}");
            assert!(!banner.contains('\u{ff}'), "IAC phải bị lọc khỏi dữ liệu: {banner:?}");

            {
                let terms = state.terms.lock().await;
                terms.get("tn-1").unwrap().tx.send(TermIn::Data(b"whoami\r".to_vec())).unwrap();
            }

            let seen = server.await.unwrap();
            assert!(
                seen.windows(3).any(|w| w == [IAC, WILL, OPT_TTYPE]),
                "client phải nhận TTYPE",
            );
            // NAWS phải mang đúng 132×43.
            assert!(
                seen.windows(8)
                    .any(|w| w == [IAC, SB, OPT_NAWS, 0, 132, 0, 43, IAC]),
                "NAWS phải báo 132×43; nhận: {seen:?}",
            );
            assert!(
                seen.windows(14).any(|w| w == b"xterm-256color"),
                "phải trả về tên terminal",
            );
            assert!(
                seen.windows(8).any(|w| w == b"whoami\r\n"),
                "Enter phải thành CR LF theo NVT",
            );

            let terms = state.terms.lock().await;
            if let Some(t) = terms.get("tn-1") {
                let _ = t.tx.send(TermIn::Close);
            }
        });
}
