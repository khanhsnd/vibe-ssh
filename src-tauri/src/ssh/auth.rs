//! Xác thực SSH: agent, khóa riêng, mật khẩu, keyboard-interactive.

use crate::bail;
use crate::error::{AppError, Result};
use crate::ssh::conn::{hop_label, phase, Client, Hop};
use russh::client::{Handle, KeyboardInteractiveAuthResponse};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::PrivateKeyWithHashAlg;
use serde_json::json;
use std::sync::Arc;
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

    let mut pass = hop.key_passphrase.clone().filter(|s| !s.is_empty());
    let key = loop {
        match russh::keys::load_secret_key(&path, pass.as_deref()) {
            Ok(k) => break k,
            Err(_) if pass.is_none() => {
                let ans = ui
                    .ask(
                        "auth:secret",
                        json!({
                            "connId": conn_id, "kind": "passphrase",
                            "title": "Passphrase của khóa",
                            "detail": path, "user": user,
                        }),
                        180,
                    )
                    .await;
                let v = ans
                    .and_then(|v| v.get("value").and_then(|s| s.as_str().map(String::from)))
                    .unwrap_or_default();
                if v.is_empty() {
                    bail!("Cần passphrase để mở khóa {path}");
                }
                pass = Some(v);
            }
            Err(e) => bail!("Khóa {path} không đọc được: {e}"),
        }
    };

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
    let mut pw = hop.password.clone().filter(|s| !s.is_empty());
    if pw.is_none() {
        let ans = ui
            .ask(
                "auth:secret",
                json!({
                    "connId": conn_id, "kind": "password",
                    "title": "Mật khẩu SSH",
                    "detail": format!("{user}@{}", hop.host), "user": user,
                }),
                180,
            )
            .await;
        pw = ans
            .and_then(|v| v.get("value").and_then(|s| s.as_str().map(String::from)))
            .filter(|s| !s.is_empty());
    }
    let Some(pw) = pw else { return Ok(false) };
    Ok(h.authenticate_password(user.to_string(), pw).await?.success())
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
