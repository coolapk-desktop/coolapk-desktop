use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Agent 接口的配置文件名，保存在应用数据目录，权限 0600。
pub const CONFIG_FILE_NAME: &str = "agent-bridge.json";
pub const PREFERENCES_FILE_NAME: &str = "agent-bridge-preferences.json";
pub const AUDIT_FILE_NAME: &str = "agent-bridge-audit.jsonl";
/// access token 单独持久化：重启应用后本机客户端不必重新配置；「重新生成」会覆盖它。
pub const TOKEN_FILE_NAME: &str = "agent-bridge-token";
/// 优先使用的固定回环端口，便于客户端配置长期有效；被占用时回退到系统随机端口。
pub const PREFERRED_REST_PORT: u16 = 47653;
pub const PREFERRED_MCP_PORT: u16 = 47654;
#[cfg(unix)]
pub const SOCKET_FILE_NAME: &str = "agent-bridge.sock";

/// 桥接服务的授权范围。写操作分成发布与互动两类，便于单独授权。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AgentBridgeScope {
    #[serde(rename = "read")]
    Read,
    #[serde(rename = "write.publish")]
    WritePublish,
    #[serde(rename = "write.interact")]
    WriteInteract,
}

impl AgentBridgeScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::WritePublish => "write.publish",
            Self::WriteInteract => "write.interact",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "read" => Some(Self::Read),
            "write.publish" => Some(Self::WritePublish),
            "write.interact" => Some(Self::WriteInteract),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentBridgeTransport {
    /// Unix domain socket（Linux/macOS），不占用任何端口。
    Uds,
    /// 仅监听 127.0.0.1，需校验 Host 头防 DNS rebinding。
    Tcp,
}

impl AgentBridgeTransport {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "uds" => Some(Self::Uds),
            "tcp" => Some(Self::Tcp),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Uds => "uds",
            Self::Tcp => "tcp",
        }
    }
}

/// 写操作的执行闸门，默认 confirm：每次写入都需要用户在应用内确认。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentBridgeWriteMode {
    Disabled,
    DryRun,
    Confirm,
    Auto,
}

impl AgentBridgeWriteMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "disabled" => Some(Self::Disabled),
            "dry-run" => Some(Self::DryRun),
            "confirm" => Some(Self::Confirm),
            "auto" => Some(Self::Auto),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::DryRun => "dry-run",
            Self::Confirm => "confirm",
            Self::Auto => "auto",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentBridgeConfig {
    pub version: u32,
    pub transport: AgentBridgeTransport,
    #[serde(default)]
    pub socket_path: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    pub token: String,
    pub scopes: Vec<AgentBridgeScope>,
    pub write_mode: AgentBridgeWriteMode,
    /// 允许 agent 使用的账号 uid；空表示只允许当前登录账号。
    #[serde(default)]
    pub allowed_accounts: Vec<String>,
    /// 是否同时开启 MCP 门面（独立回环端口，/mcp 路径）。
    #[serde(default)]
    pub mcp_enabled: bool,
    /// MCP 服务监听的回环端口；mcp_enabled 为 false 时为空。
    #[serde(default)]
    pub mcp_port: Option<u16>,
}

/// 持久化用户选择的服务状态与授权选项，不包含 token 或运行时端口。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AgentBridgePreferences {
    pub enabled: bool,
    pub transport: AgentBridgeTransport,
    pub scopes: Vec<AgentBridgeScope>,
    pub write_mode: AgentBridgeWriteMode,
    pub allowed_accounts: Vec<String>,
    pub mcp_enabled: bool,
}

impl Default for AgentBridgePreferences {
    fn default() -> Self {
        Self {
            enabled: false,
            transport: if cfg!(unix) { AgentBridgeTransport::Uds } else { AgentBridgeTransport::Tcp },
            scopes: vec![AgentBridgeScope::Read],
            write_mode: AgentBridgeWriteMode::Disabled,
            allowed_accounts: Vec::new(),
            mcp_enabled: false,
        }
    }
}

impl AgentBridgeConfig {
    pub fn scope_set(&self) -> std::collections::BTreeSet<AgentBridgeScope> {
        self.scopes.iter().copied().collect()
    }

    /// MCP 客户端应连接的地址；总是走 TCP 回环，Unix Socket 无法直接被 MCP 客户端使用。
    pub fn mcp_endpoint(&self) -> Option<String> {
        if !self.mcp_enabled {
            return None;
        }
        self.mcp_port.map(|port| format!("http://127.0.0.1:{port}/mcp"))
    }

    pub fn endpoint(&self) -> String {
        match self.transport {
            AgentBridgeTransport::Tcp => format!("http://127.0.0.1:{}", self.port.unwrap_or(0)),
            AgentBridgeTransport::Uds => self
                .socket_path
                .clone()
                .unwrap_or_else(|| "unix socket 不可用".to_string()),
        }
    }
}

pub fn config_path(dir: &Path) -> PathBuf {
    dir.join(CONFIG_FILE_NAME)
}

pub fn preferences_path(dir: &Path) -> PathBuf {
    dir.join(PREFERENCES_FILE_NAME)
}

pub fn load_preferences(dir: &Path) -> AgentBridgePreferences {
    std::fs::read_to_string(preferences_path(dir)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn save_preferences(dir: &Path, preferences: &AgentBridgePreferences) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| format!("无法创建应用数据目录: {error}"))?;
    let path = preferences_path(dir);
    let text = serde_json::to_string_pretty(preferences).map_err(|error| format!("Agent 接口设置序列化失败: {error}"))?;
    std::fs::write(&path, text).map_err(|error| format!("无法写入 Agent 接口设置: {error}"))?;
    set_private_permissions(&path).map_err(|error| format!("无法设置 Agent 接口设置权限: {error}"))?;
    Ok(())
}

pub fn token_path(dir: &Path) -> PathBuf {
    dir.join(TOKEN_FILE_NAME)
}

/// 读取已持久化的 token；格式不符（被损坏或手工改过）时视为不存在。
pub fn load_token(dir: &Path) -> Option<String> {
    let token = std::fs::read_to_string(token_path(dir)).ok()?;
    let token = token.trim().to_string();
    (token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit())).then_some(token)
}

pub fn save_token(dir: &Path, token: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建应用数据目录: {e}"))?;
    let path = token_path(dir);
    std::fs::write(&path, token.trim()).map_err(|e| format!("无法写入 Agent 接口 token: {e}"))?;
    set_private_permissions(&path).map_err(|e| format!("无法设置 token 文件权限: {e}"))?;
    Ok(())
}

/// 首次启用时生成并持久化；之后复用同一个 token，只有「重新生成」才会更换。
pub fn load_or_create_token(dir: &Path) -> Result<String, String> {
    if let Some(token) = load_token(dir) {
        return Ok(token);
    }
    let token = generate_token()?;
    save_token(dir, &token)?;
    Ok(token)
}

/// 生成 32 字节随机 token（hex，64 字符）。
pub fn generate_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "无法生成随机 token".to_string())?;
    Ok(hex::encode(bytes))
}

/// 常量时间字符串比较，避免 token 通过响应时间泄漏。
pub fn token_matches(expected: &str, provided: &str) -> bool {
    let expected = expected.as_bytes();
    let provided = provided.as_bytes();
    if expected.len() != provided.len() {
        return false;
    }
    let mut diff = 0u8;
    for (left, right) in expected.iter().zip(provided.iter()) {
        diff |= left ^ right;
    }
    diff == 0
}

/// 写入配置文件；unix 下收紧为 0600，避免同机其他用户读取 token。
pub fn save_config(dir: &Path, config: &AgentBridgeConfig) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建应用数据目录: {e}"))?;
    let path = config_path(dir);
    let text = serde_json::to_string_pretty(config).map_err(|e| format!("配置序列化失败: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("无法写入 Agent 接口配置: {e}"))?;
    set_private_permissions(&path).map_err(|e| format!("无法设置配置权限: {e}"))?;
    Ok(())
}

pub fn remove_config(dir: &Path) {
    let _ = std::fs::remove_file(config_path(dir));
}

#[cfg(unix)]
pub fn set_private_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
pub fn set_private_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}
