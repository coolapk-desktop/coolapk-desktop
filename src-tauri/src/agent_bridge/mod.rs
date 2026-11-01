//! 本地 Agent 接口（Agent Bridge）。
//!
//! 在应用进程内复用同一个 CoolapkClient，把少量只读能力以 REST 形式暴露给本机
//! agent、脚本和 MCP 门面。默认关闭，开启后必须携带 token，写操作另有独立授权与闸门。

mod audit;
mod config;
mod http;
#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

pub use config::{AgentBridgeConfig, AgentBridgeScope, AgentBridgeTransport, AgentBridgeWriteMode};
pub use http::{BridgeCtx, Limits};

use audit::AuditSink;

#[derive(Default)]
pub struct AgentBridgeRuntime {
    running: Mutex<Option<RunningBridge>>,
}

struct RunningBridge {
    config: AgentBridgeConfig,
    shutdown: Option<oneshot::Sender<()>>,
    dir: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub transport: Option<String>,
    #[serde(default)]
    pub write_mode: Option<String>,
    #[serde(default)]
    pub allowed_accounts: Vec<String>,
}

fn default_transport() -> AgentBridgeTransport {
    #[cfg(unix)]
    {
        AgentBridgeTransport::Uds
    }
    #[cfg(not(unix))]
    {
        AgentBridgeTransport::Tcp
    }
}

fn parse_scopes(raw: &[String]) -> Result<Vec<AgentBridgeScope>, String> {
    let mut scopes: Vec<AgentBridgeScope> = Vec::new();
    for item in raw {
        let scope = AgentBridgeScope::parse(item).ok_or_else(|| format!("未知授权范围：{item}"))?;
        if !scopes.contains(&scope) {
            scopes.push(scope);
        }
    }
    if scopes.is_empty() {
        scopes.push(AgentBridgeScope::Read);
    }
    scopes.sort();
    Ok(scopes)
}

fn status_value(running: Option<&RunningBridge>) -> Value {
    match running {
        Some(bridge) => {
            let config = &bridge.config;
            json!({
                "code": 200,
                "message": "",
                "data": {
                    "enabled": true,
                    "transport": config.transport.as_str(),
                    "endpoint": config.endpoint(),
                    "socketPath": config.socket_path,
                    "port": config.port,
                    "token": config.token,
                    "scopes": config.scopes.iter().map(|scope| scope.as_str()).collect::<Vec<_>>(),
                    "writeMode": config.write_mode.as_str(),
                    "allowedAccounts": config.allowed_accounts,
                }
            })
        }
        None => json!({
            "code": 200,
            "message": "",
            "data": { "enabled": false }
        }),
    }
}

pub async fn start(app: AppHandle, runtime: &AgentBridgeRuntime, options: StartOptions) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|error| format!("无法获取应用数据目录: {error}"))?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用数据目录: {error}"))?;

    stop_running(&runtime.running);

    let transport = match options.transport.as_deref() {
        Some(value) => AgentBridgeTransport::parse(value).ok_or_else(|| format!("未知传输方式：{value}"))?,
        None => default_transport(),
    };
    let write_mode = match options.write_mode.as_deref() {
        Some(value) => AgentBridgeWriteMode::parse(value).ok_or_else(|| format!("未知写入模式：{value}"))?,
        None => AgentBridgeWriteMode::Confirm,
    };

    let mut config = AgentBridgeConfig {
        version: 1,
        transport,
        socket_path: None,
        port: None,
        token: config::generate_token()?,
        scopes: parse_scopes(&options.scopes)?,
        write_mode,
        allowed_accounts: options.allowed_accounts.clone(),
    };

    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    match transport {
        AgentBridgeTransport::Uds => {
            #[cfg(unix)]
            {
                let path = dir.join(config::SOCKET_FILE_NAME);
                if path.as_os_str().len() >= 104 {
                    return Err(format!("socket 路径过长，请改用 tcp 模式：{}", path.display()));
                }
                let _ = std::fs::remove_file(&path);
                let listener = tokio::net::UnixListener::bind(&path).map_err(|error| format!("无法创建 socket: {error}"))?;
                config::set_private_permissions(&path).map_err(|error| format!("无法设置 socket 权限: {error}"))?;
                config.socket_path = Some(path.display().to_string());

                config::save_config(&dir, &config)?;
                let ctx = build_ctx(&app, &config, &dir);
                let router = http::build_router(ctx);
                tauri::async_runtime::spawn(async move {
                    let _ = axum::serve(listener, router)
                        .with_graceful_shutdown(async move {
                            let _ = shutdown_rx.await;
                        })
                        .await;
                });
            }
            #[cfg(not(unix))]
            {
                return Err("当前平台不支持 Unix domain socket，请改用 tcp 传输".to_string());
            }
        }
        AgentBridgeTransport::Tcp => {
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .map_err(|error| format!("无法监听回环地址: {error}"))?;
            let address = listener.local_addr().map_err(|error| format!("无法读取监听地址: {error}"))?;
            config.port = Some(address.port());

            config::save_config(&dir, &config)?;
            let ctx = build_ctx(&app, &config, &dir);
            let router = http::build_router(ctx);
            tauri::async_runtime::spawn(async move {
                let _ = axum::serve(listener, router)
                    .with_graceful_shutdown(async move {
                        let _ = shutdown_rx.await;
                    })
                    .await;
            });
        }
    }

    let value = status_value(Some(&RunningBridge { config: config.clone(), shutdown: None, dir: dir.clone() }));
    let mut guard = runtime.running.lock().map_err(|_| "Agent 接口状态锁异常".to_string())?;
    *guard = Some(RunningBridge { config, shutdown: Some(shutdown_tx), dir });
    Ok(value)
}

fn build_ctx(app: &AppHandle, config: &AgentBridgeConfig, dir: &std::path::Path) -> Arc<BridgeCtx> {
    Arc::new(BridgeCtx {
        app: Some(app.clone()),
        state: None,
        config: Arc::new(RwLock::new(config.clone())),
        audit: AuditSink::new(dir),
        limits: Limits::new(),
    })
}

fn stop_running(running: &Mutex<Option<RunningBridge>>) {
    let Ok(mut guard) = running.lock() else { return };
    if let Some(mut bridge) = guard.take() {
        if let Some(shutdown) = bridge.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(socket_path) = bridge.config.socket_path.as_deref() {
            let _ = std::fs::remove_file(socket_path);
        }
        config::remove_config(&bridge.dir);
    }
}

pub fn stop(runtime: &AgentBridgeRuntime) -> Value {
    stop_running(&runtime.running);
    status_value(None)
}

pub fn status(runtime: &AgentBridgeRuntime) -> Value {
    let guard = match runtime.running.lock() {
        Ok(guard) => guard,
        Err(_) => return status_value(None),
    };
    status_value(guard.as_ref())
}

#[tauri::command]
pub async fn agent_bridge_status(runtime: State<'_, AgentBridgeRuntime>) -> Result<Value, String> {
    Ok(status(&runtime))
}

#[tauri::command]
pub async fn agent_bridge_start(
    app: AppHandle,
    runtime: State<'_, AgentBridgeRuntime>,
    scopes: Option<Vec<String>>,
    transport: Option<String>,
    write_mode: Option<String>,
    allowed_accounts: Option<Vec<String>>,
) -> Result<Value, String> {
    let options = StartOptions {
        scopes: scopes.unwrap_or_else(|| vec!["read".to_string()]),
        transport,
        write_mode,
        allowed_accounts: allowed_accounts.unwrap_or_default(),
    };
    start(app, &runtime, options).await
}

#[tauri::command]
pub async fn agent_bridge_stop(runtime: State<'_, AgentBridgeRuntime>) -> Result<Value, String> {
    Ok(stop(&runtime))
}

/// 换发 token：使用当前授权范围重启服务，旧 token 立即失效。
#[tauri::command]
pub async fn agent_bridge_rotate_token(
    app: AppHandle,
    runtime: State<'_, AgentBridgeRuntime>,
) -> Result<Value, String> {
    let options = {
        let guard = runtime.running.lock().map_err(|_| "Agent 接口状态锁异常".to_string())?;
        match guard.as_ref() {
            Some(bridge) => StartOptions {
                scopes: bridge.config.scopes.iter().map(|scope| scope.as_str().to_string()).collect(),
                transport: Some(bridge.config.transport.as_str().to_string()),
                write_mode: Some(bridge.config.write_mode.as_str().to_string()),
                allowed_accounts: bridge.config.allowed_accounts.clone(),
            },
            None => return Ok(status_value(None)),
        }
    };
    start(app, &runtime, options).await
}
