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
