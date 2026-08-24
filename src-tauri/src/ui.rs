//! Cầu nối duy nhất giữa phần nghiệp vụ (SSH, PTY, SFTP, tunnel) và giao diện.
//!
//! Nhờ đi qua `Ui` thay vì `AppHandle`, các module đó không phụ thuộc Tauri:
//! test dựng được một `Ui` đọc sự kiện qua channel, không cần cửa sổ nào.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{oneshot, Mutex};

/// Các câu hỏi đang chờ người dùng trả lời (host key, mật khẩu, 2FA…).
pub type Asks = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

type Sink = Arc<dyn Fn(&str, Value) + Send + Sync>;

#[derive(Clone)]
pub struct Ui {
    sink: Sink,
    asks: Asks,
}

impl Ui {
    #[cfg(test)]
    pub fn new(sink: Sink, asks: Asks) -> Self {
        Self { sink, asks }
    }

    pub fn tauri<R: tauri::Runtime>(app: tauri::AppHandle<R>, asks: Asks) -> Self {
        let sink: Sink = Arc::new(move |event: &str, payload: Value| {
            use tauri::Emitter;
            let _ = app.emit(event, payload);
        });
        Self { sink, asks }
    }

    pub fn emit(&self, event: &str, payload: Value) {
        (self.sink)(event, payload);
    }

    /// Phát `event` kèm `askId` rồi chờ giao diện gọi lệnh `answer`.
    /// `None` = quá hạn hoặc người dùng bỏ qua.
    pub async fn ask(&self, event: &str, mut payload: Value, timeout_secs: u64) -> Option<Value> {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.asks.lock().await.insert(id.clone(), tx);

        if let Value::Object(ref mut m) = payload {
            m.insert("askId".into(), json!(id.clone()));
        }
        self.emit(event, payload);

        let out = tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await;
        self.asks.lock().await.remove(&id);
        match out {
            Ok(Ok(v)) => Some(v),
            _ => None,
        }
    }
}

pub async fn answer(asks: &Asks, ask_id: &str, value: Value) {
    if let Some(tx) = asks.lock().await.remove(ask_id) {
        let _ = tx.send(value);
    }
}

/// `Ui` gửi sự kiện vào một channel — dùng cho test.
#[cfg(test)]
pub fn channel(asks: Asks) -> (Ui, tokio::sync::mpsc::UnboundedReceiver<(String, Value)>) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let sink: Sink = Arc::new(move |event: &str, payload: Value| {
        let _ = tx.send((event.to_string(), payload));
    });
    (Ui::new(sink, asks), rx)
}
