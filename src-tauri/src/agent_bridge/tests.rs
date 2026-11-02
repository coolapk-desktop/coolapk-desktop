use std::sync::{Arc, RwLock};

use axum::body::to_bytes;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use super::audit::AuditSink;
use super::config::{
    token_matches, AgentBridgeConfig, AgentBridgeScope, AgentBridgeTransport, AgentBridgeWriteMode,
};
use super::http::{build_router, BridgeCtx, Limits};
use super::mcp::build_router as build_mcp_router;

fn test_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("coolapk-agent-bridge-{name}"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn test_ctx(name: &str, scopes: Vec<AgentBridgeScope>, transport: AgentBridgeTransport) -> Arc<BridgeCtx> {
    let dir = test_dir(name);
    Arc::new(BridgeCtx {
        app: None,
        state: None,
        config: Arc::new(RwLock::new(AgentBridgeConfig {
            version: 1,
            transport,
            socket_path: None,
            port: Some(1),
            token: "test-token".to_string(),
            scopes,
            write_mode: AgentBridgeWriteMode::Disabled,
            allowed_accounts: Vec::new(),
            mcp_enabled: false,
            mcp_port: None,
        })),
        audit: AuditSink::new(&dir),
        limits: Limits::new(),
    })
}

fn request(path: &str, token: Option<&str>) -> Request<axum::body::Body> {
    let mut builder = Request::builder().uri(path).header("host", "127.0.0.1:1");
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    builder.body(axum::body::Body::empty()).unwrap()
}

#[test]
fn token_compare_requires_exact_match() {
    assert!(token_matches("abc123", "abc123"));
    assert!(!token_matches("abc123", "abc124"));
    assert!(!token_matches("abc123", "abc12"));
    assert!(!token_matches("abc123", "abc1234"));
    assert!(!token_matches("abc123", ""));
}

#[test]
fn scope_parse_matches_wire_names() {
    assert_eq!(AgentBridgeScope::parse("read"), Some(AgentBridgeScope::Read));
    assert_eq!(AgentBridgeScope::parse("write.publish"), Some(AgentBridgeScope::WritePublish));
    assert_eq!(AgentBridgeScope::parse("write.interact"), Some(AgentBridgeScope::WriteInteract));
    assert_eq!(AgentBridgeScope::parse("write"), None);
    assert_eq!(AgentBridgeScope::Read.as_str(), "read");
}

#[tokio::test]
async fn health_requires_token() {
    let ctx = test_ctx("health-no-token", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let response = build_router(ctx).oneshot(request("/v1/health", None)).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn health_rejects_wrong_token() {
    let ctx = test_ctx("health-bad-token", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let response = build_router(ctx).oneshot(request("/v1/health", Some("nope"))).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn health_reports_scopes_with_valid_token() {
    let ctx = test_ctx(
        "health-ok",
        vec![AgentBridgeScope::Read, AgentBridgeScope::WritePublish],
        AgentBridgeTransport::Tcp,
    );
    let response = build_router(ctx).oneshot(request("/v1/health", Some("test-token"))).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let scopes = value["data"]["scopes"].as_array().unwrap();
    assert!(scopes.iter().any(|scope| scope == "write.publish"));
    assert_eq!(value["data"]["version"], env!("CARGO_PKG_VERSION"));
    // token 不得出现在响应体里
    assert!(!String::from_utf8_lossy(&body).contains("test-token"));
}

#[tokio::test]
async fn read_endpoint_requires_read_scope() {
    let ctx = test_ctx("scope-denied", vec![], AgentBridgeTransport::Tcp);
    let response = build_router(ctx)
        .oneshot(request("/v1/feed/123", Some("test-token")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn tcp_transport_rejects_foreign_host_header() {
    let ctx = test_ctx("host-check", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let request = Request::builder()
        .uri("/v1/health")
        .header("host", "evil.example.com")
        .header("authorization", "Bearer test-token")
        .body(axum::body::Body::empty())
        .unwrap();
    let response = build_router(ctx).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn browser_origin_is_rejected() {
    let ctx = test_ctx("origin-check", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let request = Request::builder()
        .uri("/v1/health")
        .header("host", "127.0.0.1:1")
        .header("origin", "https://evil.example.com")
        .header("authorization", "Bearer test-token")
        .body(axum::body::Body::empty())
        .unwrap();
    let response = build_router(ctx).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

/// 真实监听回环端口并用 HTTP 客户端打一次，验证 axum::serve + 中间件链路可用。
#[tokio::test]
async fn real_socket_serves_health() {
    let ctx = test_ctx("live-socket", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = build_router(ctx);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/v1/health");
    let unauthorized = client.get(&url).send().await.unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let authorized = client
        .get(&url)
        .header("authorization", "Bearer test-token")
        .send()
        .await
        .unwrap();
    assert_eq!(authorized.status(), StatusCode::OK);
    let value: serde_json::Value = authorized.json().await.unwrap();
    assert_eq!(value["data"]["transport"], "tcp");
    assert_eq!(value["data"]["writeMode"], "disabled");
}

// ---------- MCP 门面 ----------

fn mcp_post(body: &str, token: Option<&str>) -> Request<axum::body::Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("host", "127.0.0.1:1")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream");
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    builder.body(axum::body::Body::from(body.to_string())).unwrap()
}

async fn mcp_send(ctx: &Arc<BridgeCtx>, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
    let response = build_mcp_router(Arc::clone(ctx))
        .oneshot(mcp_post(&body.to_string(), Some("test-token")))
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 256 * 1024).await.unwrap();
    let value = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, value)
}

fn tool_names(value: &serde_json::Value) -> Vec<String> {
    value["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn token_is_persisted_across_restarts() {
    let dir = test_dir("token-persist");
    let _ = std::fs::remove_file(super::config::token_path(&dir));
    let first = super::config::load_or_create_token(&dir).unwrap();
    let second = super::config::load_or_create_token(&dir).unwrap();
    assert_eq!(first, second);
    assert_eq!(first.len(), 64);
    assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
}

/// 首选端口被占用时必须回退到随机端口，而不是直接开启失败。
#[tokio::test]
async fn preferred_port_falls_back_when_busy() {
    let held = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let busy = held.local_addr().unwrap().port();
    let fallback = super::bind_loopback(busy).await.unwrap();
    assert_ne!(fallback.local_addr().unwrap().port(), busy);
}

// ---------- 写工具参数模型（Task 1） ----------

fn tiny_png_base64() -> String {
    use base64::Engine;
    // 1x1 透明 PNG
    base64::engine::general_purpose::STANDARD.encode([
        0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
    ])
}

fn image_arg(name: &str, mime: &str) -> serde_json::Value {
    serde_json::json!({ "name": name, "mimeType": mime, "dataBase64": tiny_png_base64() })
}

#[test]
fn write_parse_publish_rejects_empty_message() {
    let args = serde_json::json!({ "message": "   " });
    let error = super::write::parse_publish_args(&args).unwrap_err();
    assert!(error.message().contains("正文"), "实际错误：{}", error.message());
}

#[test]
fn write_parse_publish_rejects_too_many_images() {
    let images: Vec<_> = (0..5).map(|i| image_arg(&format!("{i}.png"), "image/png")).collect();
    let args = serde_json::json!({ "message": "动态正文", "images": images });
    let error = super::write::parse_publish_args(&args).unwrap_err();
    assert!(error.message().contains("4 张"), "实际错误：{}", error.message());
}

#[test]
fn write_parse_publish_rejects_bad_mime() {
    let args = serde_json::json!({ "message": "正文", "images": [image_arg("a.gif", "image/gif")] });
    let error = super::write::parse_publish_args(&args).unwrap_err();
    assert!(error.message().contains("格式"), "实际错误：{}", error.message());
}

#[test]
fn write_parse_publish_rejects_invalid_base64() {
    let args = serde_json::json!({ "message": "正文", "images": [{ "name": "a.png", "mimeType": "image/png", "dataBase64": "not*base64" }] });
    let error = super::write::parse_publish_args(&args).unwrap_err();
    assert!(error.message().contains("base64") || error.message().contains("Base64"), "实际错误：{}", error.message());
}

#[test]
fn write_image_limits_reject_oversized_and_total() {
    // 单张超过 8 MB
    let oversize = super::write::enforce_image_limits(1, 8 * 1024 * 1024 + 1, 8 * 1024 * 1024 + 1).unwrap_err();
    assert!(oversize.message().contains("8 MB"), "实际错误：{}", oversize.message());
    // 总计超过 20 MB（单张都未超）
    let total = super::write::enforce_image_limits(3, 7 * 1024 * 1024, 21 * 1024 * 1024).unwrap_err();
    assert!(total.message().contains("20 MB"), "实际错误：{}", total.message());
}

#[test]
fn write_parse_publish_accepts_data_url_and_sanitizes_name() {
    let data_url = format!("data:image/png;base64,{}", tiny_png_base64());
    let args = serde_json::json!({
        "message": "  你好酷安  ",
        "images": [{ "name": "../../etc/passwd.png", "dataBase64": data_url }],
        "visibleStatus": -1,
        "requestId": "req-1"
    });
    let parsed = super::write::parse_publish_args(&args).unwrap();
    assert_eq!(parsed.message, "你好酷安");
    assert_eq!(parsed.images.len(), 1);
    assert_eq!(parsed.images[0].name, "passwd.png");
    assert_eq!(parsed.images[0].mime, "image/png");
    assert!(!parsed.images[0].bytes.is_empty());
    assert_eq!(parsed.visible_status, Some(-1));
    assert_eq!(parsed.request_id.as_deref(), Some("req-1"));

    let preview = super::write::preview_publish(&parsed);
    assert_eq!(preview["messageChars"], 4);
    assert_eq!(preview["imageCount"], 1);
    assert_eq!(preview["visibleStatus"], -1);
    assert!(preview["images"][0].get("dataBase64").is_none(), "预览不能包含图片内容");
}

#[test]
fn write_parse_publish_rejects_invalid_visible_status() {
    let args = serde_json::json!({ "message": "正文", "visibleStatus": 0 });
    let error = super::write::parse_publish_args(&args).unwrap_err();
    assert!(error.message().contains("可见"), "实际错误：{}", error.message());
}

#[tokio::test]
async fn mcp_requires_token() {
    let ctx = test_ctx("mcp-no-token", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let response = build_mcp_router(ctx)
        .oneshot(mcp_post(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn mcp_initialize_negotiates_protocol() {
    let ctx = test_ctx("mcp-init", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let (status, value) = mcp_send(
        &ctx,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "test", "version": "0" } }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(value["result"]["serverInfo"]["name"], "coolapk-desktop");
    assert_eq!(value["result"]["capabilities"]["tools"]["listChanged"], false);
    assert!(value["result"]["instructions"].as_str().unwrap().contains("本机"));
}

#[tokio::test]
async fn mcp_notification_is_accepted() {
    let ctx = test_ctx("mcp-notification", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let response = build_mcp_router(ctx)
        .oneshot(mcp_post(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#, Some("test-token")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let bytes = to_bytes(response.into_body(), 1024).await.unwrap();
    assert!(bytes.is_empty());
}

#[tokio::test]
async fn mcp_tools_list_follows_scope() {
    let read_ctx = test_ctx("mcp-list-read", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let (status, value) = mcp_send(&read_ctx, serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).await;
    assert_eq!(status, StatusCode::OK);
    let names = tool_names(&value);
    assert!(names.contains(&"coolapk_search".to_string()));
    assert!(names.contains(&"coolapk_feed_detail".to_string()));
    assert!(names.contains(&"coolapk_health".to_string()));

    let no_scope = test_ctx("mcp-list-empty", vec![], AgentBridgeTransport::Tcp);
    let (_, value) = mcp_send(&no_scope, serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).await;
    assert_eq!(tool_names(&value), vec!["coolapk_health".to_string()]);
}

#[tokio::test]
async fn mcp_tools_call_unknown_tool_is_tool_error() {
    let ctx = test_ctx("mcp-unknown", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let (status, value) = mcp_send(
        &ctx,
        serde_json::json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "nope", "arguments": {} } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["result"]["isError"], true);
    assert!(value["result"]["content"][0]["text"].as_str().unwrap().contains("未知工具"));
}

#[tokio::test]
async fn mcp_tools_call_reports_missing_app_state() {
    let ctx = test_ctx("mcp-no-state", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let (_, value) = mcp_send(
        &ctx,
        serde_json::json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "coolapk_me", "arguments": {} } }),
    )
    .await;
    assert_eq!(value["result"]["isError"], true);
    assert!(value["result"]["content"][0]["text"].as_str().unwrap().contains("应用状态不可用"));
}

/// 工具表里列出的每个工具都必须有对应分发，防止 schema 与实现漂移。
#[tokio::test]
async fn mcp_every_listed_tool_dispatches() {
    let ctx = test_ctx("mcp-dispatch", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let (_, listed) = mcp_send(&ctx, serde_json::json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/list" })).await;
    for name in tool_names(&listed) {
        let (_, value) = mcp_send(
            &ctx,
            serde_json::json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": { "name": name, "arguments": {} } }),
        )
        .await;
        let text = value["result"]["content"][0]["text"].as_str().unwrap();
        assert!(!text.contains("未知工具"), "{name} 缺少分发实现：{text}");
    }
}

/// MCP 全部走 POST，不能因此被 REST 的「写操作 1 次/分钟」限流误伤。
#[tokio::test]
async fn mcp_post_is_not_rate_limited_as_write() {
    let ctx = test_ctx("mcp-rate", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    for _ in 0..3 {
        let (status, value) = mcp_send(&ctx, serde_json::json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/list" })).await;
        assert_eq!(status, StatusCode::OK);
        assert!(value["result"]["tools"].is_array());
    }
}

/// UDS 模式下 REST 不校验 Host，但 MCP 走 TCP 回环，必须照常拒绝外部 Host。
#[tokio::test]
async fn mcp_rejects_foreign_host_even_on_uds_transport() {
    let ctx = test_ctx("mcp-host-uds", vec![AgentBridgeScope::Read], AgentBridgeTransport::Uds);
    let request = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("host", "evil.example.com")
        .header("content-type", "application/json")
        .header("authorization", "Bearer test-token")
        .body(axum::body::Body::from(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#))
        .unwrap();
    let response = build_mcp_router(ctx).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mcp_tools_call_requires_scope() {
    let ctx = test_ctx("mcp-scope", vec![], AgentBridgeTransport::Tcp);
    let (_, value) = mcp_send(
        &ctx,
        serde_json::json!({ "jsonrpc": "2.0", "id": 8, "method": "tools/call", "params": { "name": "coolapk_search", "arguments": { "q": "酷安" } } }),
    )
    .await;
    assert_eq!(value["result"]["isError"], true);
    assert!(value["result"]["content"][0]["text"].as_str().unwrap().contains("缺少授权范围"));
}

/// 真实监听 + HTTP 客户端：验证 MCP 端点可直接被外部客户端按 Streamable HTTP 调用。
#[tokio::test]
async fn real_socket_serves_mcp() {
    let ctx = test_ctx("mcp-live", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = build_mcp_router(ctx);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/mcp");
    let unauthorized = client
        .post(&url)
        .json(&serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }))
        .send()
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let initialize = client
        .post(&url)
        .header("authorization", "Bearer test-token")
        .header("accept", "application/json, text/event-stream")
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "test", "version": "0" } }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(initialize.status(), StatusCode::OK);
    let value: serde_json::Value = initialize.json().await.unwrap();
    assert_eq!(value["result"]["protocolVersion"], "2025-06-18");

    let tools = client
        .post(&url)
        .header("authorization", "Bearer test-token")
        .json(&serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }))
        .send()
        .await
        .unwrap();
    assert_eq!(tools.status(), StatusCode::OK);
    let value: serde_json::Value = tools.json().await.unwrap();
    assert!(tool_names(&value).contains(&"coolapk_topic_detail".to_string()));
}
