use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Agent 接口的配置文件名，保存在应用数据目录，权限 0600。
pub const CONFIG_FILE_NAME: &str = "agent-bridge.json";
pub const AUDIT_FILE_NAME: &str = "agent-bridge-audit.jsonl";
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
}

impl AgentBridgeConfig {
    pub fn scope_set(&self) -> std::collections::BTreeSet<AgentBridgeScope> {
        self.scopes.iter().copied().collect()
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

pub fn load_config(dir: &Path) -> Option<AgentBridgeConfig> {
    let text = std::fs::read_to_string(config_path(dir)).ok()?;
    serde_json::from_str(&text).ok()
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
