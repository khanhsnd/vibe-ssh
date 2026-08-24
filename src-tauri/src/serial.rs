//! Serial console (RS-232 / USB-UART) — cùng giao diện terminal như SSH và PTY.
//! API của `serialport` là chặn nên phần này chạy trên thread thường.

use crate::error::{AppError, Result};
use crate::state::{AppState, Term, TermIn};
use crate::termio;
use crate::ui::Ui;
use serde::{Deserialize, Serialize};
use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub name: String,
    /// `usb` | `bluetooth` | `pci` | `unknown`
    pub kind: &'static str,
    pub label: Option<String>,
}

pub fn ports() -> Result<Vec<PortInfo>> {
    let list = serialport::available_ports()
        .map_err(|e| AppError::Msg(format!("Không liệt kê được cổng serial: {e}")))?;
    Ok(list
        .into_iter()
        .map(|p| {
            let (kind, label) = match &p.port_type {
                serialport::SerialPortType::UsbPort(u) => (
                    "usb",
                    u.product.clone().or_else(|| u.manufacturer.clone()),
                ),
                serialport::SerialPortType::BluetoothPort => ("bluetooth", None),
                serialport::SerialPortType::PciPort => ("pci", None),
                serialport::SerialPortType::Unknown => ("unknown", None),
            };
            PortInfo { name: p.port_name, kind, label }
        })
        .collect())
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct SerialOpts {
    pub term_id: String,
    pub path: String,
    pub baud: u32,
    /// 5, 6, 7 hoặc 8
    pub data_bits: u8,
    /// `none` | `odd` | `even`
    pub parity: String,
    /// 1 hoặc 2
    pub stop_bits: u8,
    /// `none` | `software` | `hardware`
    pub flow: String,
    pub log_path: Option<String>,
}

impl Default for SerialOpts {
    fn default() -> Self {
        Self {
            term_id: String::new(),
            path: String::new(),
            baud: 115_200,
            data_bits: 8,
            parity: "none".into(),
            stop_bits: 1,
            flow: "none".into(),
            log_path: None,
        }
    }
}

pub fn open(ui: Ui, state: Arc<AppState>, o: SerialOpts) -> Result<()> {
    if o.path.trim().is_empty() {
        return Err(AppError::Msg("Chưa chọn cổng serial".into()));
    }
    let port = serialport::new(&o.path, if o.baud == 0 { 115_200 } else { o.baud })
        .data_bits(match o.data_bits {
            5 => DataBits::Five,
            6 => DataBits::Six,
            7 => DataBits::Seven,
            _ => DataBits::Eight,
        })
        .parity(match o.parity.as_str() {
            "odd" => Parity::Odd,
            "even" => Parity::Even,
            _ => Parity::None,
        })
        .stop_bits(if o.stop_bits == 2 { StopBits::Two } else { StopBits::One })
        .flow_control(match o.flow.as_str() {
            "software" => FlowControl::Software,
            "hardware" => FlowControl::Hardware,
            _ => FlowControl::None,
        })
        // Timeout ngắn để vòng đọc không chặn mãi khi thiết bị im lặng.
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|e| AppError::Msg(format!("Không mở được {}: {e}", o.path)))?;

    let mut reader = port
        .try_clone()
        .map_err(|e| AppError::Msg(format!("Không nhân bản được cổng: {e}")))?;
    let mut writer = port;

    let (tx, mut rx) = mpsc::unbounded_channel::<TermIn>();
    let term_id = o.term_id.clone();
    let log = termio::log_path(o.log_path.as_ref());

    tauri::async_runtime::block_on({
        let (st, id) = (state.clone(), term_id.clone());
        async move {
            st.terms.lock().await.insert(id, Term { tx });
        }
    });

    // Thiết bị → giao diện.
    {
        let (ui, id, log) = (ui.clone(), term_id.clone(), log.clone());
        std::thread::spawn(move || {
            let mut buf = [0u8; 8 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => continue,
                    Ok(n) => termio::emit(&ui, &id, &buf[..n], log.as_deref()),
                    Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                    Err(_) => break, // thiết bị bị rút
                }
            }
            let st = state.clone();
            let id2 = id.clone();
            tauri::async_runtime::spawn(async move {
                st.terms.lock().await.remove(&id2);
            });
            termio::exit(&ui, &id, None, Some("cổng serial đã đóng"));
        });
    }

    // Giao diện → thiết bị. Serial không có khái niệm kích thước cửa sổ.
    std::thread::spawn(move || {
        while let Some(cmd) = rx.blocking_recv() {
            match cmd {
                TermIn::Data(d) => {
                    if writer.write_all(&d).is_err() {
                        break;
                    }
                    let _ = writer.flush();
                }
                TermIn::Resize { .. } => {}
                TermIn::Close => break,
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn lists_ports_without_error() {
        // Máy có thể không có cổng nào — chỉ cần không lỗi và dữ liệu hợp lệ.
        let ports = super::ports().expect("liệt kê cổng serial");
        for p in &ports {
            assert!(!p.name.is_empty());
            assert!(["usb", "bluetooth", "pci", "unknown"].contains(&p.kind));
        }
        eprintln!("tìm thấy {} cổng serial", ports.len());
    }

    #[test]
    fn rejects_empty_path() {
        let state = std::sync::Arc::new(crate::state::AppState::default());
        let (ui, _rx) = crate::ui::channel(state.asks.clone());
        let err = super::open(ui, state, super::SerialOpts::default()).unwrap_err();
        assert!(err.to_string().contains("Chưa chọn cổng"), "{err}");
    }
}
