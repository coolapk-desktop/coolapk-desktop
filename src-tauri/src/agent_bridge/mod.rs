//! 本地 Agent 接口（Agent Bridge）。
//!
//! 在应用进程内复用同一个 CoolapkClient，把只读能力以 REST 形式暴露给本机
//! agent、脚本，并在同一进程内提供 MCP 门面。默认关闭，开启后必须携带 token，
//! 写操作另有独立授权与闸门。

mod audit;
mod config;
mod guide;
mod http;
mod mcp;
mod ops;
// Task 2 接入写闸门后即可移除这里的 allow；当前只有测试与后续任务会用到这些参数模型。
#[cfg_attr(not(test), allow(dead_code))]
mod write;
#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio::sync::watch;

pub use config::{AgentBridgeConfig, AgentBridgePreferences, AgentBridgeScope, AgentBridgeTransport, AgentBridgeWriteMode};
pub use http::{BridgeCtx, Limits};

use audit::AuditSink;

#[derive(Default, Clone)]
pub struct AgentBridgeRuntime {
    running: Arc<Mutex<Option<RunningBridge>>>,
    confirm: Arc<write::ConfirmBroker>,
    dedupe: Arc<write::WriteDedupe>,
}

struct RunningBridge {
    config: AgentBridgeConfig,
    shutdown: Option<watch::Sender<bool>>,
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
    /// 同时开启 MCP 门面。
    #[serde(default)]
    pub mcp: bool,
    /// 内部使用：保留旧 token 重启（前端不传该字段，rotate 时传 None 换新）。
    #[serde(default)]
    pub token: Option<String>,
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
    // 读取权限始终开放：读接口没有副作用，设置页只让用户决定写权限。
    if !scopes.contains(&AgentBridgeScope::Read) {
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
                    "mcpEnabled": config.mcp_enabled,
                    "mcpEndpoint": config.mcp_endpoint(),
                    "mcpPort": config.mcp_port,
                }
            })
        }
        None => json!({
            "code": 200,
            "message": "",
            "data": { "enabled": false, "mcpEnabled": false, "mcpEndpoint": null }
        }),
    }
}

pub async fn start(app: AppHandle, runtime: &AgentBridgeRuntime, options: StartOptions) -> Result<Value, String> {
    let transport = match options.transport.as_deref() {
        Some(value) => AgentBridgeTransport::parse(value).ok_or_else(|| format!("未知传输方式：{value}"))?,
        None => default_transport(),
    };
    let write_mode = match options.write_mode.as_deref() {
        Some(value) => AgentBridgeWriteMode::parse(value).ok_or_else(|| format!("未知写入模式：{value}"))?,
        None => AgentBridgeWriteMode::Confirm,
    };
    // 空 token 表示沿用已持久化的 token（首次启用时才生成）。
    let token = options.token.unwrap_or_default();

    let config = AgentBridgeConfig {
        version: 1,
        transport,
        socket_path: None,
        port: None,
        token,
        scopes: parse_scopes(&options.scopes)?,
        write_mode,
        allowed_accounts: options.allowed_accounts.clone(),
        mcp_enabled: options.mcp,
        mcp_port: None,
    };
    start_with_config(app, runtime, config).await
}

/// 按给定配置绑定监听并启动服务；token 由调用方决定是否保留。
async fn start_with_config(
    app: AppHandle,
    runtime: &AgentBridgeRuntime,
    mut config: AgentBridgeConfig,
) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|error| format!("无法获取应用数据目录: {error}"))?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用数据目录: {error}"))?;

    stop_running(&runtime.running);

    if config.token.is_empty() {
        config.token = config::load_or_create_token(&dir)?;
    }

    let (shutdown_tx, _shutdown_guard) = watch::channel(false);

    enum RestListener {
        #[cfg(unix)]
        Uds(tokio::net::UnixListener),
        Tcp(tokio::net::TcpListener),
    }

    let rest = match config.transport {
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
                config.port = None;
                RestListener::Uds(listener)
            }
            #[cfg(not(unix))]
            {
                return Err("当前平台不支持 Unix domain socket，请改用 tcp 传输".to_string());
            }
        }
        AgentBridgeTransport::Tcp => {
            let listener = bind_loopback(config::PREFERRED_REST_PORT)
                .await
                .map_err(|error| format!("无法监听回环地址: {error}"))?;
            let address = listener.local_addr().map_err(|error| format!("无法读取监听地址: {error}"))?;
            config.port = Some(address.port());
            config.socket_path = None;
            RestListener::Tcp(listener)
        }
    };

    // MCP 总是独立监听回环端口：Unix Socket 无法被 MCP 客户端直接使用，Windows 也没有 UDS。
    let mcp_listener = if config.mcp_enabled {
        let bound = bind_loopback(config::PREFERRED_MCP_PORT).await;
        match bound {
            Ok(listener) => {
                let port = listener
                    .local_addr()
                    .map_err(|error| format!("无法读取 MCP 监听地址: {error}"))?
                    .port();
                config.mcp_port = Some(port);
                Some(listener)
            }
            Err(error) => {
                if let Some(path) = config.socket_path.as_deref() {
                    let _ = std::fs::remove_file(path);
                }
                return Err(format!("无法为 MCP 服务监听回环地址: {error}"));
            }
        }
    } else {
        config.mcp_port = None;
        None
    };

    if let Err(error) = config::save_config(&dir, &config) {
        if let Some(path) = config.socket_path.as_deref() {
            let _ = std::fs::remove_file(path);
        }
        return Err(error);
    }
    // token 持久化到独立文件，重启应用后 MCP/REST 客户端无需重新配置。
    config::save_token(&dir, &config.token)?;

    let ctx = Arc::new(BridgeCtx {
        app: Some(app.clone()),
        state: None,
        config: Arc::new(RwLock::new(config.clone())),
        audit: AuditSink::new(&dir),
        limits: Limits::new(),
        confirm: Some(Arc::clone(&runtime.confirm)),
        dedupe: Some(Arc::clone(&runtime.dedupe)),
    });

    let router = http::build_router(Arc::clone(&ctx));
    let mut rest_shutdown = shutdown_tx.subscribe();
    match rest {
        #[cfg(unix)]
        RestListener::Uds(listener) => {
            tauri::async_runtime::spawn(async move {
                let _ = axum::serve(listener, router)
                    .with_graceful_shutdown(async move {
                        let _ = rest_shutdown.changed().await;
                    })
                    .await;
            });
        }
        RestListener::Tcp(listener) => {
            tauri::async_runtime::spawn(async move {
                let _ = axum::serve(listener, router)
                    .with_graceful_shutdown(async move {
                        let _ = rest_shutdown.changed().await;
                    })
                    .await;
            });
        }
    }

    if let Some(listener) = mcp_listener {
        let mcp_router = mcp::build_router(ctx);
        let mut mcp_shutdown = shutdown_tx.subscribe();
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, mcp_router)
                .with_graceful_shutdown(async move {
                    let _ = mcp_shutdown.changed().await;
                })
                .await;
        });
    }

    let value = status_value(Some(&RunningBridge {
        config: config.clone(),
        shutdown: None,
        dir: dir.clone(),
    }));
    let mut guard = runtime.running.lock().map_err(|_| "Agent 接口状态锁异常".to_string())?;
    *guard = Some(RunningBridge { config, shutdown: Some(shutdown_tx), dir });
    Ok(value)
}

/// 优先占用固定端口，被占用时回退到系统随机端口，避免多开或端口冲突导致开启失败。
pub(super) async fn bind_loopback(preferred: u16) -> std::io::Result<tokio::net::TcpListener> {
    match tokio::net::TcpListener::bind(("127.0.0.1", preferred)).await {
        Ok(listener) => Ok(listener),
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            tokio::net::TcpListener::bind(("127.0.0.1", 0)).await
        }
        Err(error) => Err(error),
    }
}

fn stop_running(running: &Mutex<Option<RunningBridge>>) {
    let Ok(mut guard) = running.lock() else { return };
    if let Some(mut bridge) = guard.take() {
        if let Some(shutdown) = bridge.shutdown.take() {
            let _ = shutdown.send(true);
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

fn status_with_preferences(app: &AppHandle, runtime: &AgentBridgeRuntime) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|error| format!("无法获取应用数据目录: {error}"))?;
    let mut value = status(runtime);
    value["data"]["preferences"] = serde_json::to_value(config::load_preferences(&dir)).map_err(|error| format!("Agent 接口设置读取失败: {error}"))?;
    Ok(value)
}

fn save_active_preferences(app: &AppHandle, runtime: &AgentBridgeRuntime) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|error| format!("无法获取应用数据目录: {error}"))?;
    let guard = runtime.running.lock().map_err(|_| "Agent 接口状态锁异常".to_string())?;
    let bridge = guard.as_ref().ok_or_else(|| "Agent 接口尚未启动".to_string())?;
    let config = &bridge.config;
    config::save_preferences(&dir, &AgentBridgePreferences {
        enabled: true,
        transport: config.transport,
        scopes: config.scopes.clone(),
        write_mode: config.write_mode,
        allowed_accounts: config.allowed_accounts.clone(),
        mcp_enabled: config.mcp_enabled,
    })
}

pub async fn restore_preferences(app: AppHandle, runtime: &AgentBridgeRuntime) -> Result<Option<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|error| format!("无法获取应用数据目录: {error}"))?;
    let preferences = config::load_preferences(&dir);
    if !preferences.enabled {
        return Ok(None);
    }
    let options = StartOptions {
        scopes: preferences.scopes.iter().map(|scope| scope.as_str().to_string()).collect(),
        transport: Some(preferences.transport.as_str().to_string()),
        write_mode: Some(preferences.write_mode.as_str().to_string()),
        allowed_accounts: preferences.allowed_accounts,
        mcp: preferences.mcp_enabled,
        token: None,
    };
    start(app, runtime, options).await.map(Some)
}

#[tauri::command]
pub async fn agent_bridge_status(app: AppHandle, runtime: State<'_, AgentBridgeRuntime>) -> Result<Value, String> {
    status_with_preferences(&app, &runtime)
}

#[tauri::command]
pub async fn agent_bridge_start(
    app: AppHandle,
    runtime: State<'_, AgentBridgeRuntime>,
    scopes: Option<Vec<String>>,
    transport: Option<String>,
    write_mode: Option<String>,
    allowed_accounts: Option<Vec<String>>,
    mcp: Option<bool>,
) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|error| format!("无法获取应用数据目录: {error}"))?;
    let saved_preferences = config::load_preferences(&dir);
    let options = StartOptions {
        scopes: scopes.unwrap_or_else(|| saved_preferences.scopes.iter().map(|scope| scope.as_str().to_string()).collect()),
        transport: transport.or_else(|| Some(saved_preferences.transport.as_str().to_string())),
        write_mode: write_mode.or_else(|| Some(saved_preferences.write_mode.as_str().to_string())),
        allowed_accounts: allowed_accounts.unwrap_or(saved_preferences.allowed_accounts),
        mcp: mcp.unwrap_or(saved_preferences.mcp_enabled),
        token: None,
    };
    start(app.clone(), &runtime, options).await?;
    if let Err(error) = save_active_preferences(&app, &runtime) {
        stop(&runtime);
        return Err(error);
    }
    status_with_preferences(&app, &runtime)
}

#[tauri::command]
pub async fn agent_bridge_stop(app: AppHandle, runtime: State<'_, AgentBridgeRuntime>) -> Result<Value, String> {
    let save_result = app.path().app_data_dir().map_err(|error| format!("无法获取应用数据目录: {error}")).and_then(|dir| {
        let mut preferences = config::load_preferences(&dir);
        preferences.enabled = false;
        config::save_preferences(&dir, &preferences)
    });
    stop(&runtime);
    save_result?;
    status_with_preferences(&app, &runtime)
}

#[tauri::command]
pub async fn agent_bridge_save_preferences(
    app: AppHandle,
    runtime: State<'_, AgentBridgeRuntime>,
    scopes: Vec<String>,
    transport: String,
    write_mode: String,
    allowed_accounts: Option<Vec<String>>,
) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|error| format!("无法获取应用数据目录: {error}"))?;
    let previous_preferences = config::load_preferences(&dir);
    let mut preferences = previous_preferences.clone();
    preferences.scopes = parse_scopes(&scopes)?;
    preferences.transport = AgentBridgeTransport::parse(&transport).ok_or_else(|| format!("未知传输方式：{transport}"))?;
    preferences.write_mode = AgentBridgeWriteMode::parse(&write_mode).ok_or_else(|| format!("未知写入模式：{write_mode}"))?;
    if let Some(allowed_accounts) = allowed_accounts { preferences.allowed_accounts = allowed_accounts; }
    let active_config = {
        let guard = runtime.running.lock().map_err(|_| "Agent 接口状态锁异常".to_string())?;
        guard.as_ref().map(|bridge| bridge.config.clone())
    };
    config::save_preferences(&dir, &preferences)?;
    if let Some(mut config) = active_config {
        let restore_config = config.clone();
        config.transport = preferences.transport;
        config.scopes = preferences.scopes.clone();
        config.write_mode = preferences.write_mode;
        config.allowed_accounts = preferences.allowed_accounts.clone();
        match start_with_config(app.clone(), &runtime, config.clone()).await {
            Ok(_) => {},
            Err(error) => {
                let _ = config::save_preferences(&dir, &previous_preferences);
                return match start_with_config(app.clone(), &runtime, restore_config).await {
                    Ok(_) => Err(error),
                    Err(restore_error) => Err(format!("{error}；恢复原 Agent 接口失败：{restore_error}")),
                };
            }
        }
    }
    status_with_preferences(&app, &runtime)
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
            Some(bridge) => Some(StartOptions {
                scopes: bridge.config.scopes.iter().map(|scope| scope.as_str().to_string()).collect(),
                transport: Some(bridge.config.transport.as_str().to_string()),
                write_mode: Some(bridge.config.write_mode.as_str().to_string()),
                allowed_accounts: bridge.config.allowed_accounts.clone(),
                mcp: bridge.config.mcp_enabled,
                token: Some(config::generate_token()?),
            }),
            None => None,
        }
    };
    let Some(options) = options else { return status_with_preferences(&app, &runtime) };
    start(app.clone(), &runtime, options).await?;
    status_with_preferences(&app, &runtime)
}

/// 前端回传写操作确认结果；超时/已结束/未知 id 都会被忽略。
#[tauri::command]
pub async fn agent_bridge_confirm_result(
    runtime: State<'_, AgentBridgeRuntime>,
    id: String,
    approved: bool,
) -> Result<Value, String> {
    let accepted = runtime.confirm.resolve(&id, approved);
    Ok(json!({ "code": 200, "message": "", "data": { "accepted": accepted } }))
}

/// 单独开关 MCP 门面：只重建监听，保留现有 token、授权范围与写操作闸门。
#[tauri::command]
pub async fn agent_bridge_set_mcp(
    app: AppHandle,
    runtime: State<'_, AgentBridgeRuntime>,
    enabled: bool,
) -> Result<Value, String> {
    let config = {
        let guard = runtime.running.lock().map_err(|_| "Agent 接口状态锁异常".to_string())?;
        guard.as_ref().map(|bridge| bridge.config.clone())
    };
    let Some(mut config) = config else {
        return status_with_preferences(&app, &runtime);
    };
    let dir = app.path().app_data_dir().map_err(|error| format!("无法获取应用数据目录: {error}"))?;
    let previous_preferences = config::load_preferences(&dir);
    let mut preferences = previous_preferences.clone();
    preferences.enabled = true;
    preferences.mcp_enabled = enabled;
    config::save_preferences(&dir, &preferences)?;
    let restore_config = config.clone();
    config.mcp_enabled = enabled;
    match start_with_config(app.clone(), &runtime, config).await {
        Ok(_) => status_with_preferences(&app, &runtime),
        Err(error) => {
            let _ = config::save_preferences(&dir, &previous_preferences);
            match start_with_config(app.clone(), &runtime, restore_config).await {
                Ok(_) => Err(error),
                Err(restore_error) => Err(format!("{error}；恢复原 Agent 接口失败：{restore_error}")),
            }
        }
    }
}

/// 生成「给 AI 的说明」：整段复制给本机 AI 客户端即可完成注册并了解当前权限。
#[tauri::command]
pub async fn agent_bridge_usage_guide(runtime: State<'_, AgentBridgeRuntime>) -> Result<Value, String> {
    let guard = runtime.running.lock().map_err(|_| "Agent 接口状态锁异常".to_string())?;
    let bridge = guard.as_ref().ok_or_else(|| "Agent 接口尚未开启，开启后才能生成说明".to_string())?;
    Ok(json!({ "code": 200, "message": "", "data": guide::usage_guide(&bridge.config) }))
}
