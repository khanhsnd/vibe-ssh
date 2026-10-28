use crate::ui::Asks;
use crate::error::{AppError, Result};
use crate::ssh::conn::SshConn;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};

/// Lệnh gửi vào một terminal đang chạy (SSH shell hoặc PTY cục bộ).
#[derive(Debug)]
pub enum TermIn {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

pub struct Term {
    pub tx: mpsc::UnboundedSender<TermIn>,
}

pub struct Tunnel {
    pub stop: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct AppState {
    pub conns: Mutex<HashMap<String, Arc<SshConn>>>,
    pub terms: Mutex<HashMap<String, Term>>,
    pub tunnels: Mutex<HashMap<String, Tunnel>>,
    pub asks: Asks,
}

impl AppState {
    pub async fn conn(&self, id: &str) -> Result<Arc<SshConn>> {
        self.conns
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::Msg(format!("Kết nối '{id}' không còn hoạt động")))
    }
}
