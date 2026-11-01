use std::sync::{Arc, RwLock};

use axum::body::to_bytes;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use super::audit::AuditSink;
use super::config::{
    token_matches, AgentBridgeConfig, AgentBridgeScope, AgentBridgeTransport, AgentBridgeWriteMode,
};
use super::http::{build_router, BridgeCtx, Limits};

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
