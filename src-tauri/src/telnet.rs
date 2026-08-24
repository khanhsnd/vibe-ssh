//! Telnet (RFC 854 + TTYPE/NAWS/SGA/ECHO) đủ để dùng như một terminal thật:
//! thương lượng option, báo kích thước cửa sổ, lọc IAC ra khỏi luồng dữ liệu.

use crate::error::Result;
use crate::state::{AppState, Term, TermIn};
use crate::termio::{self, FLUSH_BYTES, FLUSH_MS};
use crate::ui::Ui;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

const IAC: u8 = 255;
const SE: u8 = 240;
const SB: u8 = 250;
const WILL: u8 = 251;
const WONT: u8 = 252;
const DO: u8 = 253;
const DONT: u8 = 254;

const OPT_ECHO: u8 = 1;
const OPT_SGA: u8 = 3;
const OPT_TTYPE: u8 = 24;
const OPT_NAWS: u8 = 31;

const TTYPE_IS: u8 = 0;
const TTYPE_SEND: u8 = 1;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TelnetOpts {
    pub term_id: String,
    pub host: String,
    pub port: u16,
    pub cols: u16,
    pub rows: u16,
    /// Giá trị trả về khi server hỏi TERMINAL-TYPE.
    pub term: String,
    pub log_path: Option<String>,
}

#[derive(PartialEq, Debug)]
enum St {
    Data,
    Iac,
    Verb(u8),
    Sb,
    SbIac,
}

/// Bộ lọc NVT: tách dữ liệu người dùng khỏi các chuỗi điều khiển IAC.
struct Nvt {
    st: St,
    sb: Vec<u8>,
    term: String,
    cols: u16,
    rows: u16,
    naws_ok: bool,
}

impl Nvt {
    fn new(term: &str, cols: u16, rows: u16) -> Self {
        Self {
            st: St::Data,
            sb: Vec::new(),
            term: if term.is_empty() { "xterm-256color".into() } else { term.into() },
            cols,
            rows,
            naws_ok: false,
        }
    }

    /// Lời mời thương lượng gửi ngay khi kết nối.
    fn hello(&self) -> Vec<u8> {
        vec![
            IAC, WILL, OPT_TTYPE,
            IAC, WILL, OPT_NAWS,
            IAC, DO, OPT_SGA,
            IAC, WILL, OPT_SGA,
            IAC, DO, OPT_ECHO,
        ]
    }

    fn naws(&self) -> Vec<u8> {
        let (c, r) = (self.cols.to_be_bytes(), self.rows.to_be_bytes());
        let mut v = vec![IAC, SB, OPT_NAWS];
        // Byte 0xFF trong kích thước phải được nhân đôi như mọi dữ liệu khác.
        for b in [c[0], c[1], r[0], r[1]] {
            v.push(b);
            if b == IAC {
                v.push(IAC);
            }
        }
        v.extend_from_slice(&[IAC, SE]);
        v
    }

    /// Nhận `input`, đẩy dữ liệu người dùng vào `data` và phản hồi vào `ctl`.
    fn feed(&mut self, input: &[u8], data: &mut Vec<u8>, ctl: &mut Vec<u8>) {
        for &b in input {
            match self.st {
                St::Data => {
                    if b == IAC {
                        self.st = St::Iac;
                    } else {
                        data.push(b);
                    }
                }
                St::Iac => match b {
                    IAC => {
                        data.push(IAC);
                        self.st = St::Data;
                    }
                    WILL | WONT | DO | DONT => self.st = St::Verb(b),
                    SB => {
                        self.sb.clear();
                        self.st = St::Sb;
                    }
                    // NOP, GA, AYT… bỏ qua.
                    _ => self.st = St::Data,
                },
                St::Verb(verb) => {
                    self.answer(verb, b, ctl);
                    self.st = St::Data;
                }
                St::Sb => {
                    if b == IAC {
                        self.st = St::SbIac;
                    } else {
                        self.sb.push(b);
                    }
                }
                St::SbIac => {
                    if b == SE {
                        self.subneg(ctl);
                        self.st = St::Data;
                    } else {
                        // IAC IAC trong subnegotiation = byte 0xFF.
                        self.sb.push(b);
                        self.st = St::Sb;
                    }
                }
            }
        }
    }

    fn answer(&mut self, verb: u8, opt: u8, ctl: &mut Vec<u8>) {
        match (verb, opt) {
            // Server muốn chúng ta bật: chỉ đồng ý những gì thực sự hỗ trợ.
            (DO, OPT_TTYPE) => ctl.extend_from_slice(&[IAC, WILL, OPT_TTYPE]),
            (DO, OPT_SGA) => ctl.extend_from_slice(&[IAC, WILL, OPT_SGA]),
            (DO, OPT_NAWS) => {
                self.naws_ok = true;
                ctl.extend_from_slice(&[IAC, WILL, OPT_NAWS]);
                ctl.extend_from_slice(&self.naws());
            }
            (DO, other) => ctl.extend_from_slice(&[IAC, WONT, other]),
            (DONT, OPT_NAWS) => self.naws_ok = false,
            (DONT, _) => {}
            // Server đề nghị tự bật: echo và SGA là điều ta muốn.
            (WILL, OPT_ECHO) => ctl.extend_from_slice(&[IAC, DO, OPT_ECHO]),
            (WILL, OPT_SGA) => ctl.extend_from_slice(&[IAC, DO, OPT_SGA]),
            (WILL, other) => ctl.extend_from_slice(&[IAC, DONT, other]),
            (WONT, _) => {}
            _ => {}
        }
    }

    fn subneg(&mut self, ctl: &mut Vec<u8>) {
        if self.sb.first() == Some(&OPT_TTYPE) && self.sb.get(1) == Some(&TTYPE_SEND) {
            ctl.extend_from_slice(&[IAC, SB, OPT_TTYPE, TTYPE_IS]);
            for &b in self.term.as_bytes() {
                ctl.push(b);
                if b == IAC {
                    ctl.push(IAC);
                }
            }
            ctl.extend_from_slice(&[IAC, SE]);
        }
        self.sb.clear();
    }

    fn resize(&mut self, cols: u16, rows: u16) -> Option<Vec<u8>> {
        self.cols = cols;
        self.rows = rows;
        self.naws_ok.then(|| self.naws())
    }
}

/// Dữ liệu người dùng gửi ra: nhân đôi 0xFF, và Enter thành CR LF theo NVT.
fn encode_out(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 8);
    let mut i = 0;
    while i < data.len() {
        let b = data[i];
        match b {
            IAC => out.extend_from_slice(&[IAC, IAC]),
            b'\r' => {
                out.extend_from_slice(b"\r\n");
                // Bỏ LF nếu terminal đã gửi sẵn CR LF.
                if data.get(i + 1) == Some(&b'\n') {
                    i += 1;
                }
            }
            _ => out.push(b),
        }
        i += 1;
    }
    out
}

pub async fn open(ui: Ui, state: Arc<AppState>, o: TelnetOpts) -> Result<()> {
    let port = if o.port == 0 { 23 } else { o.port };
    let mut sock = TcpStream::connect((o.host.as_str(), port))
        .await
        .map_err(|e| crate::error::AppError::Msg(format!("Telnet {}:{port}: {e}", o.host)))?;
    sock.set_nodelay(true).ok();

    let mut nvt = Nvt::new(&o.term, o.cols.max(20), o.rows.max(5));
    sock.write_all(&nvt.hello()).await?;

    let (tx, mut rx) = mpsc::unbounded_channel::<TermIn>();
    state
        .terms
        .lock()
        .await
        .insert(o.term_id.clone(), Term { tx });

    let log = termio::log_path(o.log_path.as_ref());
    let term_id = o.term_id.clone();

    tokio::spawn(async move {
        let mut net = [0u8; 16 * 1024];
        let mut buf: Vec<u8> = Vec::with_capacity(FLUSH_BYTES);
        let mut tick = tokio::time::interval(Duration::from_millis(FLUSH_MS));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut reason = "kết nối đã đóng";

        loop {
            tokio::select! {
                biased;

                cmd = rx.recv() => match cmd {
                    Some(TermIn::Data(d)) => {
                        if sock.write_all(&encode_out(&d)).await.is_err() {
                            reason = "mất kết nối khi gửi";
                            break;
                        }
                    }
                    Some(TermIn::Resize { cols, rows }) => {
                        if let Some(msg) = nvt.resize(cols, rows) {
                            let _ = sock.write_all(&msg).await;
                        }
                    }
                    Some(TermIn::Close) | None => {
                        reason = "đã đóng";
                        break;
                    }
                },

                read = sock.read(&mut net) => match read {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let mut ctl = Vec::new();
                        nvt.feed(&net[..n], &mut buf, &mut ctl);
                        if !ctl.is_empty() && sock.write_all(&ctl).await.is_err() {
                            break;
                        }
                        if buf.len() >= FLUSH_BYTES {
                            termio::flush(&ui, &term_id, &mut buf, log.as_deref());
                        }
                    }
                },

                _ = tick.tick() => termio::flush(&ui, &term_id, &mut buf, log.as_deref()),
            }
        }

        termio::flush(&ui, &term_id, &mut buf, log.as_deref());
        state.terms.lock().await.remove(&term_id);
        termio::exit(&ui, &term_id, None, Some(reason));
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(nvt: &mut Nvt, input: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let (mut data, mut ctl) = (Vec::new(), Vec::new());
        nvt.feed(input, &mut data, &mut ctl);
        (data, ctl)
    }

    #[test]
    fn strips_iac_and_keeps_payload() {
        let mut n = Nvt::new("xterm", 80, 24);
        // "hi" + IAC NOP + "!" + IAC IAC (byte 255 thật)
        let (data, ctl) = run(&mut n, &[b'h', b'i', IAC, 241, b'!', IAC, IAC]);
        assert_eq!(data, vec![b'h', b'i', b'!', 255]);
        assert!(ctl.is_empty(), "NOP không cần trả lời");
    }

    #[test]
    fn negotiates_terminal_type() {
        let mut n = Nvt::new("xterm-256color", 80, 24);
        let (_, ctl) = run(&mut n, &[IAC, DO, OPT_TTYPE]);
        assert_eq!(ctl, vec![IAC, WILL, OPT_TTYPE]);

        let (data, ctl) = run(&mut n, &[IAC, SB, OPT_TTYPE, TTYPE_SEND, IAC, SE]);
        assert!(data.is_empty(), "subnegotiation không phải dữ liệu người dùng");
        let mut want = vec![IAC, SB, OPT_TTYPE, TTYPE_IS];
        want.extend_from_slice(b"xterm-256color");
        want.extend_from_slice(&[IAC, SE]);
        assert_eq!(ctl, want);
    }

    #[test]
    fn reports_window_size_when_asked() {
        let mut n = Nvt::new("xterm", 132, 43);
        let (_, ctl) = run(&mut n, &[IAC, DO, OPT_NAWS]);
        assert_eq!(
            ctl,
            vec![IAC, WILL, OPT_NAWS, IAC, SB, OPT_NAWS, 0, 132, 0, 43, IAC, SE],
        );
        // Sau khi đã thoả thuận, resize phải phát NAWS mới.
        assert_eq!(
            n.resize(100, 30).unwrap(),
            vec![IAC, SB, OPT_NAWS, 0, 100, 0, 30, IAC, SE],
        );
    }

    #[test]
    fn refuses_unknown_options_politely() {
        let mut n = Nvt::new("xterm", 80, 24);
        let (_, ctl) = run(&mut n, &[IAC, DO, 34, IAC, WILL, 39]);
        assert_eq!(ctl, vec![IAC, WONT, 34, IAC, DONT, 39]);
    }

    #[test]
    fn accepts_server_echo_and_sga() {
        let mut n = Nvt::new("xterm", 80, 24);
        let (_, ctl) = run(&mut n, &[IAC, WILL, OPT_ECHO, IAC, WILL, OPT_SGA]);
        assert_eq!(ctl, vec![IAC, DO, OPT_ECHO, IAC, DO, OPT_SGA]);
    }

    #[test]
    fn no_naws_before_agreement() {
        let mut n = Nvt::new("xterm", 80, 24);
        assert!(n.resize(90, 25).is_none(), "chưa thoả thuận thì không gửi NAWS");
    }

    #[test]
    fn encodes_outgoing_data() {
        assert_eq!(encode_out(b"ls\r"), b"ls\r\n".to_vec());
        assert_eq!(encode_out(b"ls\r\n"), b"ls\r\n".to_vec(), "không nhân đôi LF");
        assert_eq!(encode_out(&[b'a', 255, b'b']), vec![b'a', 255, 255, b'b']);
    }

    #[test]
    fn handles_iac_split_across_reads() {
        let mut n = Nvt::new("xterm", 80, 24);
        let (d1, c1) = run(&mut n, &[b'x', IAC]);
        assert_eq!(d1, vec![b'x']);
        assert!(c1.is_empty());
        // Phần còn lại của chuỗi đến ở lần đọc sau.
        let (d2, c2) = run(&mut n, &[DO, OPT_SGA]);
        assert!(d2.is_empty());
        assert_eq!(c2, vec![IAC, WILL, OPT_SGA]);
    }
}
