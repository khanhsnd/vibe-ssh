//! Test đầu-cuối đường SSH: chạy một `sshd` thật trên loopback rồi dùng chính
//! code của app để kết nối, mở shell, làm SFTP và dựng cả ba loại tunnel.
//!
//! Test tự bỏ qua (không fail) nếu máy không dựng được `sshd` — xem
//! [`crate::sshfixture`].

use crate::ssh::conn::{ConnectOpts, Hop};
use crate::ssh::{conn, sftp, shell, tunnel};
use crate::sshfixture::{self, Sshd};
use crate::state::{AppState, TermIn};
use crate::{hostkeys, store, ui};
use base64::Engine;
use serde_json::Value;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::UnboundedReceiver;

/// Các test SSH chạy tuần tự: chúng dùng chung một `known_hosts.json` và một
/// thư mục dữ liệu, chạy song song sẽ đá nhau.
fn serial() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

fn rt<F: Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(f)
}

/// Dựng server và thư mục dữ liệu riêng. Trả `None` nếu máy không có sshd.
/// Giá trị trả về phải được giữ đến hết test — drop là lúc sshd bị tắt.
fn setup() -> Option<Sshd> {
    let s = sshfixture::spawn()?;

    // Không ghi vào thư mục cấu hình thật của người dùng.
    // Tên cố định: mỗi lần chạy test dùng lại một thư mục, không sinh rác mới.
    let data = std::env::temp_dir().join("vibe-ssh-testdata");
    std::fs::create_dir_all(&data).ok()?;
    std::env::set_var(store::DATA_DIR_ENV, &data);

    // Nhớ trước host key để test không phải đi qua bước hỏi (có test riêng cho
    // luồng hỏi/đáp).
    let pubkey = std::fs::read_to_string(s.dir.join("hostkey.pub")).ok()?;
    let key = russh::keys::ssh_key::PublicKey::from_openssh(pubkey.trim()).ok()?;
    let (algo, fp) = hostkeys::fingerprint_of(&key);
    hostkeys::remember("127.0.0.1", s.port, &algo, &fp).ok()?;
    Some(s)
}

fn opts(s: &Sshd, key: &std::path::Path, jumps: Vec<Hop>) -> ConnectOpts {
    ConnectOpts {
        id: format!("c-{}", uuid::Uuid::new_v4()),
        target: Hop {
            label: "test".into(),
            host: "127.0.0.1".into(),
            port: s.port,
            user: s.user.clone(),
            auth: vec!["key".into()],
            key_path: Some(key.to_string_lossy().into_owned()),
            ..Default::default()
        },
        jumps,
        keepalive: 0,
        compression: false,
        x11: false,
        agent_forward: false,
        strict_host_key: true,
    }
}

fn term_text(ev: &str, v: &Value) -> Option<String> {
    if ev != "term:data" {
        return None;
    }
    let b64 = v.get("b64")?.as_str()?;
    Some(String::from_utf8_lossy(&base64::engine::general_purpose::STANDARD.decode(b64).ok()?).into_owned())
}

async fn read_term_until(
    rx: &mut UnboundedReceiver<(String, Value)>,
    needle: &str,
    cap: Duration,
) -> String {
    let mut seen = String::new();
    let _ = tokio::time::timeout(cap, async {
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

async fn write_term(state: &Arc<AppState>, term_id: &str, data: &[u8]) {
    let terms = state.terms.lock().await;
    terms
        .get(term_id)
        .expect("terminal đã đăng ký")
        .tx
        .send(TermIn::Data(data.to_vec()))
        .unwrap();
}

/// Đọc banner "SSH-2.0-…" từ một socket — bằng chứng dữ liệu đã đi hết đường hầm.
async fn expect_ssh_banner(stream: &mut TcpStream) -> String {
    let mut buf = [0u8; 64];
    let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buf))
        .await
        .unwrap_or(Ok(0))
        .unwrap_or(0);
    String::from_utf8_lossy(&buf[..n]).into_owned()
}

// ── Kết nối & shell ───────────────────────────────────────────────────────

#[test]
fn connects_with_key_and_runs_a_command() {
    let _g = serial();
    let Some(s) = setup() else {
        eprintln!("bỏ qua: không dựng được sshd cục bộ");
        return;
    };

    rt(async {
        let state = Arc::new(AppState::default());
        let (u, mut rx) = ui::channel(state.asks.clone());

        let conn = conn::connect(u.clone(), state.clone(), opts(&s, &s.client_key, vec![]))
            .await
            .expect("kết nối SSH");
        assert_eq!(conn.info.host, "127.0.0.1");
        assert!(conn.info.via.is_empty());

        shell::open(
            u,
            state.clone(),
            shell::ShellOpts {
                term_id: "ssh-1".into(),
                conn_id: conn.info.id.clone(),
                cols: 100,
                rows: 30,
                ..Default::default()
            },
        )
        .await
        .expect("mở shell");

        write_term(&state, "ssh-1", b"echo SSH_SHELL_OK\n").await;
        let seen = read_term_until(&mut rx, "SSH_SHELL_OK", Duration::from_secs(20)).await;
        assert!(seen.contains("SSH_SHELL_OK"), "output shell qua SSH: {seen:?}");

        conn::disconnect(&state, &conn.info.id).await.unwrap();
    });
}

#[test]
fn connects_with_rsa_key() {
    let _g = serial();
    let Some(s) = setup() else { return };
    rt(async {
        let state = Arc::new(AppState::default());
        let (u, _rx) = ui::channel(state.asks.clone());
        // Khóa RSA đi qua nhánh thương lượng rsa-sha2-256/512.
        let conn = conn::connect(u, state.clone(), opts(&s, &s.client_key_rsa, vec![]))
            .await
            .expect("kết nối bằng khóa RSA");
        conn::disconnect(&state, &conn.info.id).await.unwrap();
    });
}

#[test]
fn connects_through_a_bastion() {
    let _g = serial();
    let Some(s) = setup() else { return };
    rt(async {
        let state = Arc::new(AppState::default());
        let (u, mut rx) = ui::channel(state.asks.clone());

        // Cùng một server vừa làm bastion vừa làm đích: đủ để kiểm tra
        // direct-tcpip + connect_stream của chuỗi jump.
        let bastion = Hop {
            label: "bastion".into(),
            host: "127.0.0.1".into(),
            port: s.port,
            user: s.user.clone(),
            auth: vec!["key".into()],
            key_path: Some(s.client_key.to_string_lossy().into_owned()),
            ..Default::default()
        };
        let conn = conn::connect(u.clone(), state.clone(), opts(&s, &s.client_key, vec![bastion]))
            .await
            .expect("kết nối qua bastion");
        assert_eq!(conn.info.via.len(), 1, "phải ghi nhận 1 chặng trung gian");

        shell::open(
            u,
            state.clone(),
            shell::ShellOpts {
                term_id: "ssh-jump".into(),
                conn_id: conn.info.id.clone(),
                cols: 90,
                rows: 24,
                ..Default::default()
            },
        )
        .await
        .expect("mở shell qua bastion");
        write_term(&state, "ssh-jump", b"echo JUMP_OK\n").await;
        let seen = read_term_until(&mut rx, "JUMP_OK", Duration::from_secs(20)).await;
        assert!(seen.contains("JUMP_OK"), "shell qua bastion: {seen:?}");

        conn::disconnect(&state, &conn.info.id).await.unwrap();
    });
}

#[test]
fn asks_before_trusting_an_unknown_host_key() {
    let _g = serial();
    let Some(s) = setup() else { return };
    // Quên khóa để buộc đi qua bước hỏi.
    hostkeys::forget("127.0.0.1", s.port).unwrap();

    rt(async {
        let state = Arc::new(AppState::default());
        let (u, mut rx) = ui::channel(state.asks.clone());

        // Trả lời "chấp nhận + ghi nhớ" ngay khi thấy câu hỏi.
        let asks = state.asks.clone();
        tokio::spawn(async move {
            while let Some((ev, v)) = rx.recv().await {
                if ev == "hostkey:ask" {
                    let id = v.get("askId").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    assert_eq!(v.get("status").and_then(|x| x.as_str()), Some("new"));
                    assert!(v.get("fingerprint").and_then(|x| x.as_str()).unwrap_or("").starts_with("SHA256:"));
                    ui::answer(&asks, &id, serde_json::json!({ "accept": true, "remember": true })).await;
                }
            }
        });

        let mut o = opts(&s, &s.client_key, vec![]);
        o.strict_host_key = false; // strict = từ chối thẳng, không hỏi
        let conn = conn::connect(u, state.clone(), o).await.expect("kết nối sau khi chấp nhận");
        conn::disconnect(&state, &conn.info.id).await.unwrap();

        // Đã được ghi nhớ để lần sau không hỏi lại.
        assert!(hostkeys::lookup("127.0.0.1", s.port).is_some(), "host key phải được lưu");
    });
}

#[test]
fn rejects_unknown_host_key_in_strict_mode() {
    let _g = serial();
    let Some(s) = setup() else { return };
    hostkeys::forget("127.0.0.1", s.port).unwrap();

    rt(async {
        let state = Arc::new(AppState::default());
        let (u, _rx) = ui::channel(state.asks.clone());
        let msg = match conn::connect(u, state.clone(), opts(&s, &s.client_key, vec![])).await {
            Ok(_) => panic!("strict phải từ chối host key lạ"),
            Err(e) => e.to_string(),
        };
        assert!(msg.contains("Không nối được"), "lỗi nên nói rõ không nối được: {msg}");
    });
}

// ── SFTP ──────────────────────────────────────────────────────────────────

#[test]
fn sftp_round_trip() {
    let _g = serial();
    let Some(s) = setup() else { return };

    rt(async {
        let state = Arc::new(AppState::default());
        let (u, _rx) = ui::channel(state.asks.clone());
        let conn = conn::connect(u.clone(), state.clone(), opts(&s, &s.client_key, vec![]))
            .await
            .expect("kết nối SSH");
        let id = conn.info.id.clone();

        let base = std::env::temp_dir().join(format!("vibe-sftp-{}", uuid::Uuid::new_v4()));
        let base_s = base.to_string_lossy().into_owned();

        // mkdir
        sftp::mkdir(&state, &id, &base_s).await.expect("mkdir");
        assert!(base.is_dir(), "thư mục phải tồn tại thật");

        // Trên macOS /var là symlink tới /private/var và SFTP trả về đường dẫn
        // đã canonical hoá, nên so sánh phải dùng bản canonical.
        let base = std::fs::canonicalize(&base).unwrap();
        let base_s = base.to_string_lossy().into_owned();

        // upload
        let local = base.join("local-src.txt");
        let payload = b"vibe-sftp-payload\n".repeat(4096); // ~72 KB, vượt 1 chunk
        std::fs::write(&local, &payload).unwrap();
        let remote = format!("{base_s}/uploaded.bin");
        sftp::upload(
            u.clone(),
            state.clone(),
            id.clone(),
            local.to_string_lossy().into_owned(),
            remote.clone(),
            "x1".into(),
        )
        .await
        .expect("upload");
        assert_eq!(std::fs::read(&remote).unwrap(), payload, "nội dung upload phải khớp");

        // list
        let listing = sftp::list(&state, &id, &base_s).await.expect("list");
        assert_eq!(listing.path, base_s);
        let e = listing
            .entries
            .iter()
            .find(|e| e.name == "uploaded.bin")
            .expect("thấy file vừa upload");
        assert_eq!(e.kind, "file");
        assert_eq!(e.size, payload.len() as u64);
        assert!(e.mode_str.starts_with('-'), "chuỗi quyền: {}", e.mode_str);

        // chmod
        sftp::chmod(&state, &id, &remote, 0o600).await.expect("chmod");
        let listing = sftp::list(&state, &id, &base_s).await.unwrap();
        let e = listing.entries.iter().find(|e| e.name == "uploaded.bin").unwrap();
        assert_eq!(e.mode & 0o777, 0o600, "quyền sau chmod: {:o}", e.mode);

        // download
        let back = base.join("downloaded.bin");
        sftp::download(
            u.clone(),
            state.clone(),
            id.clone(),
            remote.clone(),
            back.to_string_lossy().into_owned(),
            "x2".into(),
        )
        .await
        .expect("download");
        assert_eq!(std::fs::read(&back).unwrap(), payload, "nội dung download phải khớp");

        // đọc nội dung để xem nhanh trong bảng SFTP
        let (text, cut) = sftp::read_text(&state, &id, &remote, 64).await.expect("read_text");
        assert_eq!(text.len(), 1024, "phải kẹp tối thiểu 1 KB");
        assert!(cut, "file 72 KB đọc 1 KB thì phải báo bị cắt bớt");
        assert!(text.starts_with("vibe-sftp-payload"));

        let (full, cut) = sftp::read_text(&state, &id, &remote, 4 * 1024 * 1024)
            .await
            .expect("read_text đầy đủ");
        assert_eq!(full.len(), payload.len(), "đọc hết file");
        assert!(!cut);

        // Lưu nội dung ngắn hơn phải cắt phần dư và giữ quyền file.
        let edited = "Nội dung đã sửa\r\n";
        sftp::write_text(&state, &id, &remote, edited).await.expect("write_text");
        assert_eq!(std::fs::read(&remote).unwrap(), edited.as_bytes());
        let listing = sftp::list(&state, &id, &base_s).await.unwrap();
        assert_eq!(listing.entries.iter().find(|e| e.path == remote).unwrap().mode & 0o777, 0o600);
        sftp::write_text(&state, &id, &remote, "").await.expect("save empty file");
        assert!(std::fs::read(&remote).unwrap().is_empty());
        std::fs::write(&remote, [0xff, 0xfe]).unwrap();
        assert!(sftp::read_text(&state, &id, &remote, 1024).await.is_err());
        std::fs::write(&remote, b"binary\0data").unwrap();
        assert!(sftp::read_text(&state, &id, &remote, 1024).await.is_err());

        // rename + remove đệ quy
        let renamed = format!("{base_s}/renamed.bin");
        sftp::rename(&state, &id, &remote, &renamed).await.expect("rename");
        assert!(std::path::Path::new(&renamed).exists());

        sftp::remove(&state, &id, &base_s).await.expect("xóa đệ quy");
        assert!(!base.exists(), "thư mục phải bị xóa hết");

        conn::disconnect(&state, &id).await.unwrap();
    });
}

#[test]
fn sftp_transfers_whole_directories() {
    let _g = serial();
    let Some(s) = setup() else { return };

    rt(async {
        let state = Arc::new(AppState::default());
        let (u, _rx) = ui::channel(state.asks.clone());
        let conn = conn::connect(u.clone(), state.clone(), opts(&s, &s.client_key, vec![]))
            .await
            .unwrap();
        let id = conn.info.id.clone();

        let root = std::fs::canonicalize(std::env::temp_dir()).unwrap()
            .join(format!("vibe-tree-{}", uuid::Uuid::new_v4()));
        let src = root.join("src");
        std::fs::create_dir_all(src.join("a/b")).unwrap();
        std::fs::write(src.join("top.txt"), b"top").unwrap();
        std::fs::write(src.join("a/mid.txt"), b"mid".repeat(1000)).unwrap();
        std::fs::write(src.join("a/b/deep.txt"), b"deep").unwrap();

        // upload cả cây
        let remote = root.join("uploaded").to_string_lossy().into_owned();
        sftp::upload(
            u.clone(), state.clone(), id.clone(),
            src.to_string_lossy().into_owned(), remote.clone(), "up-dir".into(),
        )
        .await
        .expect("upload thư mục");
        assert_eq!(std::fs::read(format!("{remote}/a/b/deep.txt")).unwrap(), b"deep");
        assert_eq!(std::fs::read(format!("{remote}/a/mid.txt")).unwrap(), b"mid".repeat(1000));

        // download cả cây
        let back = root.join("back");
        sftp::download(
            u.clone(), state.clone(), id.clone(),
            remote.clone(), back.to_string_lossy().into_owned(), "down-dir".into(),
        )
        .await
        .expect("download thư mục");
        assert_eq!(std::fs::read(back.join("a/b/deep.txt")).unwrap(), b"deep");
        assert_eq!(std::fs::read(back.join("top.txt")).unwrap(), b"top");

        std::fs::remove_dir_all(&root).ok();
        conn::disconnect(&state, &id).await.unwrap();
    });
}

// ── Tunnel ────────────────────────────────────────────────────────────────

#[test]
fn local_forward_carries_traffic() {
    let _g = serial();
    let Some(s) = setup() else { return };

    rt(async {
        let state = Arc::new(AppState::default());
        let (u, _rx) = ui::channel(state.asks.clone());
        let conn = conn::connect(u.clone(), state.clone(), opts(&s, &s.client_key, vec![]))
            .await
            .unwrap();
        let id = conn.info.id.clone();

        // -L <cổng trống>:127.0.0.1:<sshd> → đọc lại banner của chính sshd.
        let port = tunnel::start(
            u.clone(),
            state.clone(),
            tunnel::TunnelSpec {
                id: "t-local".into(),
                conn_id: id.clone(),
                kind: "local".into(),
                bind_host: "127.0.0.1".into(),
                bind_port: 0,
                dest_host: "127.0.0.1".into(),
                dest_port: s.port,
            },
        )
        .await
        .expect("mở local forward");
        assert!(port > 0);

        let mut sock = TcpStream::connect(("127.0.0.1", port)).await.expect("nối vào tunnel");
        let banner = expect_ssh_banner(&mut sock).await;
        assert!(banner.starts_with("SSH-2.0-"), "banner qua -L: {banner:?}");

        tunnel::stop(&state, "t-local").await.unwrap();
        conn::disconnect(&state, &id).await.unwrap();
    });
}

#[test]
fn dynamic_socks5_proxy_connects() {
    let _g = serial();
    let Some(s) = setup() else { return };

    rt(async {
        let state = Arc::new(AppState::default());
        let (u, _rx) = ui::channel(state.asks.clone());
        let conn = conn::connect(u.clone(), state.clone(), opts(&s, &s.client_key, vec![]))
            .await
            .unwrap();
        let id = conn.info.id.clone();

        let port = tunnel::start(
            u.clone(),
            state.clone(),
            tunnel::TunnelSpec {
                id: "t-dyn".into(),
                conn_id: id.clone(),
                kind: "dynamic".into(),
                bind_host: "127.0.0.1".into(),
                bind_port: 0,
                ..Default::default()
            },
        )
        .await
        .expect("mở SOCKS5");

        let mut sock = TcpStream::connect(("127.0.0.1", port)).await.expect("nối proxy");
        sock.write_all(&[5, 1, 0]).await.unwrap(); // ver, 1 method, no-auth
        let mut hello = [0u8; 2];
        sock.read_exact(&mut hello).await.unwrap();
        assert_eq!(hello, [5, 0], "SOCKS5 phải chọn no-auth");

        let p = s.port.to_be_bytes();
        sock.write_all(&[5, 1, 0, 1, 127, 0, 0, 1, p[0], p[1]]).await.unwrap();
        let mut reply = [0u8; 10];
        sock.read_exact(&mut reply).await.unwrap();
        assert_eq!(&reply[..2], &[5, 0], "CONNECT phải thành công");

        let banner = expect_ssh_banner(&mut sock).await;
        assert!(banner.starts_with("SSH-2.0-"), "banner qua -D: {banner:?}");

        tunnel::stop(&state, "t-dyn").await.unwrap();
        conn::disconnect(&state, &id).await.unwrap();
    });
}

#[test]
fn remote_forward_reaches_back() {
    let _g = serial();
    let Some(s) = setup() else { return };

    rt(async {
        let state = Arc::new(AppState::default());
        let (u, _rx) = ui::channel(state.asks.clone());
        let conn = conn::connect(u.clone(), state.clone(), opts(&s, &s.client_key, vec![]))
            .await
            .unwrap();
        let id = conn.info.id.clone();

        // Đích của -R: một listener trên máy này, trả về "PONG".
        let sink = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let sink_port = sink.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut c, _)) = sink.accept().await {
                let _ = c.write_all(b"PONG").await;
                let _ = c.flush().await;
            }
        });

        let bound = tunnel::start(
            u.clone(),
            state.clone(),
            tunnel::TunnelSpec {
                id: "t-remote".into(),
                conn_id: id.clone(),
                kind: "remote".into(),
                bind_host: "127.0.0.1".into(),
                bind_port: 0, // để server tự chọn
                dest_host: "127.0.0.1".into(),
                dest_port: sink_port,
            },
        )
        .await
        .expect("mở remote forward");
        assert!(bound > 0, "server phải trả về cổng đã bind");

        // sshd chạy ngay trên máy này nên cổng nó bind cũng nối được từ đây.
        let mut sock = TcpStream::connect(("127.0.0.1", bound)).await.expect("nối cổng -R");
        let mut buf = [0u8; 8];
        let n = tokio::time::timeout(Duration::from_secs(10), sock.read(&mut buf))
            .await
            .unwrap_or(Ok(0))
            .unwrap_or(0);
        assert_eq!(&buf[..n], b"PONG", "dữ liệu phải đi từ server về listener cục bộ");

        tunnel::stop(&state, "t-remote").await.unwrap();
        conn::disconnect(&state, &id).await.unwrap();
    });
}
