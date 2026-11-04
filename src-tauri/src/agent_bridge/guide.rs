//! 生成「给 AI 的说明」：设置页一键复制后可直接整段粘贴给本机 AI 客户端。
//!
//! 文本完全来自当前运行中的配置与 MCP 工具表，避免说明与实现漂移。

use super::config::{AgentBridgeConfig, AgentBridgeScope, AgentBridgeTransport, AgentBridgeWriteMode};
use super::mcp;

fn scope_label(scope: AgentBridgeScope) -> &'static str {
    match scope {
        AgentBridgeScope::Read => "只读",
        AgentBridgeScope::WritePublish => "发布内容",
        AgentBridgeScope::WriteInteract => "互动操作",
    }
}

fn write_mode_label(mode: AgentBridgeWriteMode) -> &'static str {
    match mode {
        AgentBridgeWriteMode::Disabled => "disabled：拒绝所有写操作，只能读取",
        AgentBridgeWriteMode::DryRun => "dry-run：写工具只校验参数并返回预览，不会真正提交",
        AgentBridgeWriteMode::Confirm => "confirm：每次写入都会在酷安客户端弹窗，需要我手动点确认；60 秒未确认即拒绝（返回 write_confirm_denied），不要重试",
        AgentBridgeWriteMode::Auto => "auto：参数校验通过就直接提交，只有审计记录，没有二次确认",
    }
}

fn rest_example(config: &AgentBridgeConfig) -> String {
    match config.transport {
        AgentBridgeTransport::Tcp => {
            format!("curl -s {}/v1/health -H 'Authorization: Bearer {}'", config.endpoint(), config.token)
        }
        AgentBridgeTransport::Uds => {
            let path = config.socket_path.clone().unwrap_or_else(|| "<socket 路径>".to_string());
            format!("curl -s --unix-socket '{path}' -H 'Authorization: Bearer {}' http://localhost/v1/health", config.token)
        }
    }
}

/// 生成可直接粘贴给 AI 客户端的接入说明（Markdown，含当前 token）。
pub fn usage_guide(config: &AgentBridgeConfig) -> String {
    let scopes = config.scope_set();
    let approved: Vec<&str> = [AgentBridgeScope::Read, AgentBridgeScope::WritePublish, AgentBridgeScope::WriteInteract]
        .into_iter()
        .filter(|scope| scopes.contains(scope))
        .map(scope_label)
        .collect();
    let available: Vec<(&str, &str, Option<AgentBridgeScope>)> = mcp::tool_catalog()
        .filter(|(_, _, scope)| scope.is_none_or(|scope| scopes.contains(&scope)))
        .collect();
    let mcp_endpoint = config.mcp_endpoint();
    let token = config.token.as_str();

    let mut text = String::new();
    text.push_str("# 酷安桌面客户端本地接口接入说明\n\n");
    text.push_str("我已经在本机「酷安桌面客户端」里开启了本地 Agent 接口，你可以直接调用它读取和发布酷安内容。请按下面的信息自行完成配置，不要向我索要额外信息。\n\n");

    text.push_str("## 1. 连接信息\n\n");
    match mcp_endpoint.as_deref() {
        Some(endpoint) => text.push_str(&format!("- MCP 地址（推荐，Streamable HTTP）：{endpoint}\n")),
        None => text.push_str("- MCP 地址：当前未开启。如果需要 MCP，请让我在「设置 → Agent 接口 → MCP 服务」里打开，或先改用下面的本地 REST。\n"),
    }
    text.push_str(&format!("- 本地 REST：{}\n", config.endpoint()));
    text.push_str("- 请求头：Authorization: Bearer <token>\n");
    text.push_str(&format!("- 访问 token：{token}\n"));
    text.push_str("- 账号：我当前登录的酷安账号（接口不提供切换账号）\n\n");

    text.push_str("## 2. 客户端注册\n\n");
    match mcp_endpoint.as_deref() {
        Some(endpoint) => {
            text.push_str("Claude Code：\n\n```bash\n");
            text.push_str(&format!("claude mcp add --transport http coolapk {endpoint} \\\n  --header 'Authorization: Bearer {token}'\n"));
            text.push_str("```\n\n通用 JSON 配置（Claude Desktop、Cursor 等支持 HTTP transport 的客户端）：\n\n```json\n");
            text.push_str(&format!(
                "{{\n  \"mcpServers\": {{\n    \"coolapk\": {{\n      \"type\": \"http\",\n      \"url\": \"{endpoint}\",\n      \"headers\": {{ \"Authorization\": \"Bearer {token}\" }}\n    }}\n  }}\n}}\n"
            ));
            text.push_str("```\n\n只有 stdio 的旧客户端：\n\n```bash\n");
            text.push_str(&format!("npx -y mcp-remote {endpoint} --header \"Authorization: Bearer {token}\"\n"));
            text.push_str("```\n\n");
        }
        None => {
            text.push_str("MCP 未开启，只能通过本地 REST 调用，示例（同样要带这个 token）：\n\n```bash\n");
            text.push_str(&rest_example(config));
            text.push_str("\n```\n\n");
        }
    }

    text.push_str("## 3. 当前权限\n\n");
    text.push_str(&format!("- 已授权范围：{}\n", approved.join(" / ")));
    text.push_str("- 读取（动态、评论、用户、话题、搜索）始终可用。\n");
    text.push_str(&format!("- 写操作闸门：{}\n", write_mode_label(config.write_mode)));
    text.push_str("- 限流：读取 60 次/分钟；发布类写操作 1 次/分钟、10 次/小时；互动类写操作 6 次/分钟、60 次/小时。超限返回 429 并带 Retry-After，请等待后再试，不要并发重试。\n");
    text.push_str("- 所有调用都以我的账号身份执行，并写入本机审计日志（只记接口名、目标 ID 和结果，不记正文与图片）。\n\n");

    text.push_str(&format!("## 4. 可用工具（共 {} 个）\n", available.len()));
    // 工具表按功能排列，这里按授权范围重新分组，避免同名小节重复出现。
    for key in [None, Some(AgentBridgeScope::Read), Some(AgentBridgeScope::WritePublish), Some(AgentBridgeScope::WriteInteract)] {
        let group: Vec<&(&str, &str, Option<AgentBridgeScope>)> = available.iter().filter(|(_, _, scope)| *scope == key).collect();
        if group.is_empty() {
            continue;
        }
        let label = key.map(scope_label).unwrap_or("无需额外授权");
        text.push_str(&format!("\n### {label}\n\n"));
        for (name, description, _) in group {
            text.push_str(&format!("- {name}：{description}\n"));
        }
    }
    if scopes.len() < 3 {
        text.push_str("\n未授权的写工具不会出现在 tools/list 里，请以 tools/list 的实际结果为准；需要更多权限时告诉我，我来改设置。\n");
    }
    text.push('\n');

    text.push_str("## 5. 使用约定\n\n");
    text.push_str("1. 先调用 `coolapk_health` 确认接口可用与当前账号，再执行其他工具。\n");
    text.push_str("2. 写工具需要真实的 feedId / replyId / uid，先用只读工具查到再操作，不要猜 ID。\n");
    text.push_str("3. 不要执行「批量删除、清空动态、清空收藏」这类破坏性操作；每次写之前先说明你要做什么。\n");
    text.push_str("4. 返回 `428` + `captcha_required` 表示酷安要求人工验证：停下来告诉我，我需要先在客户端里完成拼图；接口不会自动重试或绕过。\n");
    text.push_str("5. 自动化的写操作可能触发酷安风控，风险由我承担；只在我明确要求时调用写工具。\n");
    text
}
