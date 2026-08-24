//! Đường dữ liệu terminal cục bộ, đầu-cuối: `pty::open` → shell thật →
//! sự kiện `term:data` (base64) → giải mã ra đúng output.

use crate::pty::PtyOpts;
use crate::state::{AppState, TermIn};
use crate::ui;
use base64::Engine;
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedReceiver;

/// Shell không đọc file khởi động → output tất định, không phụ thuộc .zshrc.
fn bare(term_id: &str, cols: u16, rows: u16) -> PtyOpts {
    PtyOpts {
        term_id: term_id.into(),
        shell: Some("/bin/zsh".into()),
        args: vec!["-f".into(), "-i".into()],
        cols,
        rows,
        ..Default::default()
    }
}

fn payload_text(event: &str, v: &Value) -> Option<String> {
    if event != "term:data" {
        return None;
    }
    let b64 = v.get("b64")?.as_str()?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Bỏ output đến khi im lặng `quiet`: shell đăng nhập còn đang in prompt và có
/// thể ăn mất ký tự đầu của lệnh nếu gõ quá sớm.
fn drain(rx: &mut UnboundedReceiver<(String, Value)>, quiet: Duration, cap: Duration) {
    let deadline = Instant::now() + cap;
    while Instant::now() < deadline {
        match rx.blocking_recv_timeout(quiet) {
            Some(_) => continue,
            None => return,
        }
    }
}

fn read_until(
    rx: &mut UnboundedReceiver<(String, Value)>,
    needle: &str,
    cap: Duration,
) -> String {
    let deadline = Instant::now() + cap;
    let mut seen = String::new();
    while Instant::now() < deadline {
        match rx.blocking_recv_timeout(Duration::from_millis(400)) {
            Some((ev, v)) => {
                if let Some(t) = payload_text(&ev, &v) {
                    seen.push_str(&t);
                    if seen.contains(needle) {
                        break;
                    }
                }
            }
            None => continue,
        }
    }
    seen
}

/// `UnboundedReceiver` không có `blocking_recv_timeout`; thêm cho gọn.
trait BlockingRecvTimeout<T> {
    fn blocking_recv_timeout(&mut self, d: Duration) -> Option<T>;
}
impl<T: Send + 'static> BlockingRecvTimeout<T> for UnboundedReceiver<T> {
    fn blocking_recv_timeout(&mut self, d: Duration) -> Option<T> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .expect("runtime");
        rt.block_on(async { tokio::time::timeout(d, self.recv()).await.ok().flatten() })
    }
}

fn send(state: &Arc<AppState>, term_id: &str, cmd: TermIn) {
    let (st, id) = (state.clone(), term_id.to_string());
    let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
    rt.block_on(async move {
        let terms = st.terms.lock().await;
        terms.get(&id).expect("terminal đã đăng ký").tx.send(cmd).unwrap();
    });
}

#[test]
fn shell_output_reaches_the_frontend() {
    let state = Arc::new(AppState::default());
    let (ui, mut rx) = ui::channel(state.asks.clone());

    crate::pty::open(ui, state.clone(), bare("t-out", 100, 30)).expect("mở được shell");
    drain(&mut rx, Duration::from_millis(700), Duration::from_secs(10));

    send(&state, "t-out", TermIn::Data(b"echo vibe-e2e-ok\n".to_vec()));
    let seen = read_until(&mut rx, "vibe-e2e-ok", Duration::from_secs(10));

    send(&state, "t-out", TermIn::Close);
    assert!(seen.contains("vibe-e2e-ok"), "không thấy output shell; nhận: {seen:?}");
}

#[test]
fn resize_reaches_the_pty() {
    let state = Arc::new(AppState::default());
    let (ui, mut rx) = ui::channel(state.asks.clone());

    crate::pty::open(ui, state.clone(), bare("t-size", 80, 24)).expect("mở được shell");
    drain(&mut rx, Duration::from_millis(700), Duration::from_secs(10));

    send(&state, "t-size", TermIn::Resize { cols: 133, rows: 41 });
    send(&state, "t-size", TermIn::Data(b"stty size\n".to_vec()));
    let seen = read_until(&mut rx, "41 133", Duration::from_secs(10));

    send(&state, "t-size", TermIn::Close);
    assert!(seen.contains("41 133"), "PTY không nhận 133×41; nhận: {seen:?}");
}
