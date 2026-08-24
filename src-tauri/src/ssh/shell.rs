//! Shell tương tác trên SSH: mở PTY, bơm dữ liệu hai chiều, ghi log tùy chọn.

use crate::error::Result;
use crate::state::{AppState, Term, TermIn};
use crate::termio::{self, FLUSH_BYTES, FLUSH_MS};
use crate::ui::Ui;
use russh::ChannelMsg;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ShellOpts {
    pub term_id: String,
    pub conn_id: String,
    pub cols: u16,
    pub rows: u16,
    /// `TERM` gửi cho server, mặc định `xterm-256color`.
    pub term: String,
    pub env: Vec<(String, String)>,
    pub x11: bool,
    pub agent_forward: bool,
    /// Lệnh chạy ngay sau khi shell mở (mỗi phần tử một dòng).
    pub init: Vec<String>,
    pub log_path: Option<String>,
}

pub async fn open(ui: Ui, state: Arc<AppState>, o: ShellOpts) -> Result<()> {
    let conn = state.conn(&o.conn_id).await?;
    let ch = conn.handle.lock().await.channel_open_session().await?;

    if o.agent_forward {
        let _ = ch.agent_forward(false).await;
    }
    if o.x11 {
        // single-connection = false → cho phép nhiều cửa sổ X trong một session.
        let _ = ch.request_x11(false, false, "MIT-MAGIC-COOKIE-1", "", 0).await;
    }
    for (k, v) in &o.env {
        let _ = ch.set_env(false, k.clone(), v.clone()).await;
    }

    let term = if o.term.is_empty() {
        "xterm-256color".to_string()
    } else {
        o.term.clone()
    };
    let (cols, rows) = (o.cols.max(20) as u32, o.rows.max(5) as u32);
    ch.request_pty(true, &term, cols, rows, 0, 0, &[]).await?;
    ch.request_shell(true).await?;

    let (tx, rx) = mpsc::unbounded_channel::<TermIn>();
    state.terms.lock().await.insert(
        o.term_id.clone(),
        Term { tx: tx.clone() },
    );

    for line in &o.init {
        let mut s = line.clone();
        s.push('\n');
        let _ = tx.send(TermIn::Data(s.into_bytes()));
    }

    let log = termio::log_path(o.log_path.as_ref());
    tokio::spawn(pump(ui, state, o.term_id, ch, rx, log));
    Ok(())
}

async fn pump(
    ui: Ui,
    state: Arc<AppState>,
    term_id: String,
    ch: russh::Channel<russh::client::Msg>,
    mut rx: mpsc::UnboundedReceiver<TermIn>,
    log: Option<std::path::PathBuf>,
) {
    let (mut read, write) = ch.split();
    let mut buf: Vec<u8> = Vec::with_capacity(FLUSH_BYTES);
    let mut tick = tokio::time::interval(Duration::from_millis(FLUSH_MS));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut exit_code: Option<u32> = None;

    loop {
        tokio::select! {
            biased;

            cmd = rx.recv() => match cmd {
                Some(TermIn::Data(d)) => { let _ = write.data(&d[..]).await; }
                Some(TermIn::Resize { cols, rows }) => {
                    let _ = write.window_change(cols as u32, rows as u32, 0, 0).await;
                }
                Some(TermIn::Close) | None => break,
            },

            msg = read.wait() => match msg {
                Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    buf.extend_from_slice(&data);
                    if buf.len() >= FLUSH_BYTES {
                        termio::flush(&ui, &term_id, &mut buf, log.as_deref());
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            },

            _ = tick.tick() => termio::flush(&ui, &term_id, &mut buf, log.as_deref()),
        }
    }

    termio::flush(&ui, &term_id, &mut buf, log.as_deref());
    let _ = write.close().await;
    state.terms.lock().await.remove(&term_id);
    termio::exit(&ui, &term_id, exit_code, None);
}
