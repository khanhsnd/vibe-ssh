//! Xác thực SSH: agent, khóa riêng, mật khẩu, keyboard-interactive.

use crate::bail;
use crate::error::{AppError, Result};
use crate::ssh::conn::{hop_label, phase, Client, Hop};
use russh::client::{Handle, KeyboardInteractiveAuthResponse};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::PrivateKeyWithHashAlg;
use serde_json::json;
use std::sync::Arc;
use crate::secrets;
use crate::ui::Ui;

/// russh dựng future của `Signer` (ssh-agent) mà không đảm bảo `Send`, nên cả
/// bước xác thực chạy trên một runtime current-thread riêng. Session task của
/// russh vẫn tiến triển trên runtime chính nên kết nối không bị treo.
pub(crate) async fn authenticate(
    ui: Ui,
    h: Handle<Client>,
    hop: Hop,
    conn_id: String,
) -> Result<Handle<Client>> {
    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| AppError::Msg(format!("Không tạo được runtime xác thực: {e}")))?;
        let mut h = h;
        rt.block_on(auth_inner(&ui, &mut h, &hop, &conn_id))?;
        Ok(h)
    })
    .await
    .map_err(|e| AppError::Msg(format!("Tiến trình xác thực dừng: {e}")))?
}

async fn auth_inner(
    ui: &Ui,
    h: &mut Handle<Client>,
    hop: &Hop,
    conn_id: &str,
) -> Result<()> {
    let order: Vec<String> = if hop.auth.is_empty() {
        ["agent", "key", "password", "interactive"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    } else {
        hop.auth.clone()
    };

    let user = if hop.user.is_empty() {
        std::env::var("USER").unwrap_or_else(|_| "root".into())
    } else {
        hop.user.clone()
    };

    let mut tried: Vec<String> = Vec::new();
    for method in &order {
        let ok = match method.as_str() {
            "none" => h.authenticate_none(user.clone()).await?.success(),
            "agent" => try_agent(h, &user).await?,
            "key" => try_key(ui, h, hop, &user, conn_id).await?,
            "password" => try_password(ui, h, hop, &user, conn_id).await?,
            "interactive" => try_interactive(ui, h, &user, conn_id).await?,
            other => {
                tried.push(format!("{other} (không hỗ trợ)"));
                false
            }
        };
        if ok {
            phase(ui, conn_id, &format!("Xác thực bằng {method}"), &hop_label(hop));
            return Ok(());
        }
        tried.push(method.clone());
    }
    bail!(
        "Xác thực thất bại cho {user}@{} (đã thử: {})",
        hop.host,
        tried.join(", ")
    )
}

#[cfg(unix)]
async fn open_agent() -> Option<AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>> {
    AgentClient::connect_env().await.ok().map(|a| a.dynamic())
}

#[cfg(windows)]
async fn open_agent() -> Option<AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>> {
    if let Ok(a) = AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
        return Some(a.dynamic());
    }
    Some(AgentClient::connect_pageant().await.dynamic())
}

async fn try_agent(h: &mut Handle<Client>, user: &str) -> Result<bool> {
    let Some(mut agent) = open_agent().await else {
        return Ok(false);
    };
    let keys = agent.request_identities().await.unwrap_or_default();
    if keys.is_empty() {
        return Ok(false);
    }
    let rsa_hash = h.best_supported_rsa_hash().await?.flatten();
    for pk in keys {
        let hash = if pk.algorithm().is_rsa() { rsa_hash } else { None };
        let res = h
            .authenticate_publickey_with(user.to_string(), pk, hash, &mut agent)
            .await
            .map_err(|e| AppError::Msg(format!("ssh-agent: {e:?}")))?;
        if res.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Bản đã lưu + số lần hỏi lại khi sai, giống `NumberOfPasswordPrompts` của OpenSSH.
const PROMPTS: usize = 3;

/// Một mật khẩu hoặc passphrase gắn với một mục keychain: lần đầu dùng bản đã
/// lưu, sai hoặc chưa có thì hỏi người dùng qua dải inline.
struct Secret<'a> {
    ui: &'a Ui,
    conn_id: &'a str,
    key: Option<String>,
    /// `kind`, `title`, `detail`, `user` cho dải hỏi.
    prompt: serde_json::Value,
    /// Chỉ đọc keychain khi thật sự cần, tránh hộp thoại Keychain thừa.
    store_read: bool,
    /// Đã đưa ra ít nhất một giá trị → lần hỏi kế tiếp nghĩa là giá trị trước sai.
    tried: bool,
}

impl<'a> Secret<'a> {
    fn new(ui: &'a Ui, conn_id: &'a str, key: Option<String>, prompt: serde_json::Value) -> Self {
        Self { ui, conn_id, key, prompt, store_read: false, tried: false }
    }

    /// Giá trị kế tiếp để thử và có cần lưu lại nếu đúng. `None` = người dùng bỏ qua.
    async fn next(&mut self) -> Option<(String, bool)> {
        if !self.store_read {
            self.store_read = true;
            if let Some(v) = self.key.as_deref().and_then(secrets::get) {
                self.tried = true;
                return Some((v, false));
            }
        }
        let mut payload = self.prompt.clone();
        payload["connId"] = json!(self.conn_id);
        payload["retry"] = json!(self.tried);
        payload["canSave"] = json!(self.key.is_some());
        self.tried = true;

        let ans = self.ui.ask("auth:secret", payload, 180).await?;
        let value = ans.get("value")?.as_str()?.to_string();
        let remember = ans.get("remember").and_then(|b| b.as_bool()).unwrap_or(false);
        (!value.is_empty()).then_some((value, remember))
    }

    /// Gọi khi giá trị đã được server/khóa chấp nhận.
    fn accepted(&self, value: &str, remember: bool) {
        let (Some(key), true) = (&self.key, remember) else { return };
        if let Err(e) = secrets::set(key, value) {
            self.ui.emit(
                "conn:warn",
                json!({ "connId": self.conn_id, "text": format!("Không lưu được vào keychain: {e}") }),
            );
        }
    }
}

async fn try_key(
    ui: &Ui,
    h: &mut Handle<Client>,
    hop: &Hop,
    user: &str,
    conn_id: &str,
) -> Result<bool> {
    let Some(path) = hop.key_path.as_ref().filter(|p| !p.trim().is_empty()) else {
        return Ok(false);
    };
    let path = crate::ssh::conn::expand_tilde(path);
    if !std::path::Path::new(&path).exists() {
        bail!("Không tìm thấy khóa: {path}");
    }

    let mut secret = Secret::new(
        ui,
        conn_id,
        hop.secret_key("pp"),
        json!({ "kind": "passphrase", "title": "Passphrase của khóa", "detail": path, "user": user }),
    );
    let mut pass: Option<(String, bool)> = None;
    let mut tries = 0;
    let key = loop {
        match russh::keys::load_secret_key(&path, pass.as_ref().map(|p| p.0.as_str())) {
            Ok(k) => break k,
            Err(_) if tries <= PROMPTS => {
                tries += 1;
                pass = Some(secret.next().await.ok_or_else(|| {
                    AppError::Msg(format!("Cần passphrase để mở khóa {path}"))
                })?);
            }
            Err(e) => bail!("Khóa {path} không đọc được: {e}"),
        }
    };
    if let Some((p, remember)) = &pass {
        secret.accepted(p, *remember);
    }

    let hash = if key.algorithm().is_rsa() {
        h.best_supported_rsa_hash().await?.flatten()
    } else {
        None
    };
    let res = h
        .authenticate_publickey(
            user.to_string(),
            PrivateKeyWithHashAlg::new(Arc::new(key), hash),
        )
        .await?;
    Ok(res.success())
}

async fn try_password(
    ui: &Ui,
    h: &mut Handle<Client>,
    hop: &Hop,
    user: &str,
    conn_id: &str,
) -> Result<bool> {
    let mut secret = Secret::new(
        ui,
        conn_id,
        hop.secret_key("pw"),
        json!({
            "kind": "password", "title": "Mật khẩu SSH",
            "detail": format!("{user}@{}", hop.host), "user": user,
        }),
    );
    for _ in 0..=PROMPTS {
        let Some((pw, remember)) = secret.next().await else { return Ok(false) };
        if h.authenticate_password(user.to_string(), pw.clone()).await?.success() {
            secret.accepted(&pw, remember);
            return Ok(true);
        }
    }
    Ok(false)
}

async fn try_interactive(
    ui: &Ui,
    h: &mut Handle<Client>,
    user: &str,
    conn_id: &str,
) -> Result<bool> {
    let mut step = h
        .authenticate_keyboard_interactive_start(user.to_string(), None)
        .await?;
    // Chặn vòng lặp vô hạn nếu server cứ hỏi lại.
    for _ in 0..8 {
        match step {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => {
                let items: Vec<_> = prompts
                    .iter()
                    .map(|p| json!({ "prompt": p.prompt, "echo": p.echo }))
                    .collect();
                let ans = ui
                    .ask(
                        "auth:interactive",
                        json!({
                            "connId": conn_id, "name": name,
                            "instructions": instructions, "prompts": items,
                        }),
                        180,
                    )
                    .await;
                let Some(vals) = ans.and_then(|v| {
                    v.get("values").and_then(|a| {
                        a.as_array().map(|a| {
                            a.iter()
                                .map(|s| s.as_str().unwrap_or("").to_string())
                                .collect::<Vec<_>>()
                        })
                    })
                }) else {
                    return Ok(false);
                };
                step = h.authenticate_keyboard_interactive_respond(vals).await?;
            }
        }
    }
    Ok(matches!(step, KeyboardInteractiveAuthResponse::Success))
}
