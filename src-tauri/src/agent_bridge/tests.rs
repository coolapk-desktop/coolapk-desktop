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
        confirm: Some(Arc::new(super::write::ConfirmBroker::default())),
        dedupe: Some(Arc::new(super::write::WriteDedupe::new())),
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
fn preferences_survive_runtime_config_cleanup() {
    let dir = test_dir("preferences-runtime-cleanup");
    let preferences = super::config::AgentBridgePreferences {
        enabled: true,
        transport: AgentBridgeTransport::Tcp,
        scopes: vec![AgentBridgeScope::Read, AgentBridgeScope::WriteInteract],
        write_mode: AgentBridgeWriteMode::Confirm,
        allowed_accounts: vec!["123".to_string()],
        mcp_enabled: true,
    };
    super::config::save_preferences(&dir, &preferences).unwrap();
    // 退出应用只清理运行时配置，开关和授权偏好应继续保留。
    std::fs::write(super::config::config_path(&dir), "{}").unwrap();
    super::config::remove_config(&dir);
    let restored = super::config::load_preferences(&dir);
    assert!(restored.enabled && restored.mcp_enabled);
    assert_eq!(restored.transport, preferences.transport);
    assert_eq!(restored.scopes, preferences.scopes);
    assert_eq!(restored.write_mode, preferences.write_mode);
    assert_eq!(restored.allowed_accounts, preferences.allowed_accounts);
    let text = std::fs::read_to_string(super::config::preferences_path(&dir)).unwrap();
    let stored: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert!(stored.get("token").is_none() && stored.get("port").is_none() && stored.get("mcpPort").is_none());
    // 手动关闭总开关后，再次读取应保持关闭，其他选项仍保留。
    super::config::save_preferences(&dir, &super::config::AgentBridgePreferences { enabled: false, ..restored }).unwrap();
    let disabled = super::config::load_preferences(&dir);
    assert!(!disabled.enabled);
    assert!(disabled.mcp_enabled);
    std::fs::remove_file(super::config::preferences_path(&dir)).unwrap();
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
    let images: Vec<_> = (0..10).map(|i| image_arg(&format!("{i}.png"), "image/png")).collect();
    let args = serde_json::json!({ "message": "动态正文", "images": images });
    let error = super::write::parse_publish_args(&args).unwrap_err();
    assert!(error.message().contains("9 张"), "实际错误：{}", error.message());
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

fn tiny_png_bytes() -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(tiny_png_base64()).unwrap()
}

#[test]
fn resolve_uploaded_url_normalizes_variants() {
    let cases: Vec<(serde_json::Value, Option<&str>)> = vec![
        (
            serde_json::json!({ "url": "https://image.coolapk.com/a.jpg" }),
            Some("https://image.coolapk.com/a.jpg"),
        ),
        (serde_json::json!({ "url": "//image.coolapk.com/b.jpg" }), Some("https://image.coolapk.com/b.jpg")),
        (serde_json::json!({ "pic": "/c.jpg" }), Some("https://image.coolapk.com/c.jpg")),
        (serde_json::json!({ "url": "   " }), None),
        (serde_json::json!({ "filename": "d.jpg" }), None),
        (serde_json::json!({}), None),
        // upload_image 实际返回 { code, data } 且 data 就是地址字符串
        (serde_json::json!("https://image.coolapk.com/f.jpg"), Some("https://image.coolapk.com/f.jpg")),
        (serde_json::json!(""), None),
        (serde_json::json!("g.jpg"), None),
    ];
    for (data, expected) in cases {
        assert_eq!(super::write::resolve_uploaded_url(&data).as_deref(), expected, "{data}");
    }
}

#[test]
fn write_parse_publish_accepts_image_only_with_paths() {
    let dir = test_dir("publish-image-paths");
    let file = dir.join("shot.PNG");
    std::fs::write(&file, tiny_png_bytes()).unwrap();

    let parsed = super::write::parse_publish_args(&serde_json::json!({
        "imagePaths": [file.display().to_string()]
    }))
    .unwrap();
    assert!(parsed.message.is_empty());
    assert_eq!(parsed.image_paths.len(), 1);
    assert_eq!(parsed.image_paths[0].mime, "image/png");
    assert_eq!(parsed.image_paths[0].name, "shot.PNG");
    assert_eq!(parsed.image_paths[0].path, file);

    let preview = super::write::preview_publish(&parsed);
    assert_eq!(preview["imageCount"], 1);
    assert_eq!(preview["images"][0]["source"], "path");
    assert!(preview["images"][0].get("dataBase64").is_none(), "预览不能包含图片内容");
}

#[test]
fn write_parse_publish_rejects_bad_image_paths() {
    let dir = test_dir("publish-bad-image-paths");
    let relative = super::write::parse_publish_args(&serde_json::json!({
        "message": "正文",
        "imagePaths": ["shot.png"]
    }))
    .unwrap_err();
    assert!(relative.message().contains("绝对路径"), "实际错误：{}", relative.message());

    let gif = dir.join("a.gif");
    std::fs::write(&gif, b"gif").unwrap();
    let unsupported = super::write::parse_publish_args(&serde_json::json!({
        "message": "正文",
        "imagePaths": [gif.display().to_string()]
    }))
    .unwrap_err();
    assert!(unsupported.message().contains("格式"), "实际错误：{}", unsupported.message());

    let missing = super::write::parse_publish_args(&serde_json::json!({
        "message": "正文",
        "imagePaths": [dir.join("missing.png").display().to_string()]
    }))
    .unwrap_err();
    assert!(missing.message().contains("无法读取"), "实际错误：{}", missing.message());
}

#[test]
fn write_parse_publish_counts_base64_and_paths_together() {
    let dir = test_dir("publish-image-count");
    let file = dir.join("extra.png");
    std::fs::write(&file, tiny_png_bytes()).unwrap();
    let images: Vec<_> = (0..9).map(|i| image_arg(&format!("{i}.png"), "image/png")).collect();
    let error = super::write::parse_publish_args(&serde_json::json!({
        "message": "正文",
        "images": images,
        "imagePaths": [file.display().to_string()]
    }))
    .unwrap_err();
    assert!(error.message().contains("9 张"), "实际错误：{}", error.message());
}

#[test]
fn write_parse_publish_merges_options_and_rejects_unknown() {
    let parsed = super::write::parse_publish_args(&serde_json::json!({
        "message": "正文",
        "options": { "targetType": "tag", "targetId": "123", "largeCover": true },
        "visibleStatus": -1
    }))
    .unwrap();
    assert_eq!(parsed.options.target_type.as_deref(), Some("tag"));
    assert_eq!(parsed.options.target_id.as_deref(), Some("123"));
    assert_eq!(parsed.options.visible_status, Some(-1));
    assert_eq!(parsed.options.large_cover, Some(true));
    let preview = super::write::preview_publish(&parsed);
    assert_eq!(preview["options"]["targetId"], "123");
    assert_eq!(preview["visibleStatus"], -1);

    let unknown = super::write::parse_publish_args(&serde_json::json!({
        "message": "正文",
        "options": { "take": "nope" }
    }))
    .unwrap_err();
    assert!(unknown.message().contains("options"), "实际错误：{}", unknown.message());
}
#[test]
fn write_parse_reply_requires_content_and_valid_target() {
    // 正文或图片至少一项
    let empty = super::write::parse_reply_args(&serde_json::json!({ "feedId": "74836959" })).unwrap_err();
    assert!(empty.message().contains("评论正文或图片"), "实际错误：{}", empty.message());

    // ID 必须存在且只含字母数字
    let missing = super::write::parse_reply_args(&serde_json::json!({ "message": "你好" })).unwrap_err();
    assert!(missing.message().contains("feedId"), "实际错误：{}", missing.message());
    let injected = super::write::parse_reply_args(&serde_json::json!({
        "feedId": "1&type=feed",
        "message": "你好"
    }))
    .unwrap_err();
    assert!(injected.message().contains("不是合法的 ID"), "实际错误：{}", injected.message());

    // 超长正文
    let long = super::write::parse_reply_args(&serde_json::json!({
        "feedId": "74836959",
        "message": "字".repeat(1001)
    }))
    .unwrap_err();
    assert!(long.message().contains("1000"), "实际错误：{}", long.message());
}

#[test]
fn write_parse_reply_accepts_louzhonglou_and_image_only() {
    let dir = test_dir("reply-args");
    let file = dir.join("reply.png");
    std::fs::write(&file, tiny_png_bytes()).unwrap();
    let parsed = super::write::parse_reply_args(&serde_json::json!({
        "feedId": "74836959",
        "rid": "9001",
        "imagePaths": [file.display().to_string()],
        "requestId": "reply-1"
    }))
    .unwrap();
    assert!(parsed.message.is_empty());
    assert_eq!(parsed.rid.as_deref(), Some("9001"));
    assert_eq!(parsed.request_id.as_deref(), Some("reply-1"));
    assert_eq!(parsed.image_paths.len(), 1);

    let call = super::write::WriteCall::Reply(parsed);
    assert_eq!(call.tool(), "coolapk_reply_feed");
    assert_eq!(call.scope(), "write.interact");
    let preview = call.preview();
    assert_eq!(preview["feedId"], "74836959");
    assert_eq!(preview["rid"], "9001");
    assert_eq!(preview["imageCount"], 1);
    assert!(call.summary().contains("回复评论"));
}

#[test]
fn write_parse_forward_allows_empty_message() {
    let parsed =
        super::write::parse_forward_args(&serde_json::json!({ "feedId": "74836959" })).unwrap();
    assert!(parsed.message.is_empty());
    let call = super::write::WriteCall::Forward(parsed);
    assert_eq!(call.tool(), "coolapk_forward_feed");
    assert_eq!(call.preview()["imageCount"], 0);
    assert!(call.summary().contains("转发动态"));
}

#[test]
fn write_delete_and_favorite_use_expected_scopes() {
    let delete = super::write::WriteCall::DeleteFeed { feed_id: "74836959".to_string() };
    assert_eq!(delete.tool(), "coolapk_delete_feed");
    assert_eq!(delete.scope(), "write.publish");
    assert_eq!(delete.preview()["action"], "delete");

    let favorite = super::write::WriteCall::FavoriteFeed { feed_id: "1".to_string(), favorite: true };
    assert_eq!(favorite.tool(), "coolapk_favorite_feed");
    assert_eq!(favorite.scope(), "write.interact");
    assert_eq!(favorite.preview()["action"], "favorite");
    let unfavorite = super::write::WriteCall::FavoriteFeed { feed_id: "1".to_string(), favorite: false };
    assert_eq!(unfavorite.tool(), "coolapk_unfavorite_feed");
    assert_eq!(unfavorite.preview()["action"], "unfavorite");
}
#[test]
fn write_parse_package_name_maps_apk_favorite() {
    let parsed = super::write::parse_package_name(&serde_json::json!({ "packageName": " com.coolapk.market " })).unwrap();
    assert_eq!(parsed, "com.coolapk.market");
    assert!(super::write::parse_package_name(&serde_json::json!({})).is_err());
    assert!(super::write::parse_package_name(&serde_json::json!({ "packageName": "   " })).is_err());
    assert!(super::write::parse_package_name(&serde_json::json!({ "packageName": "com/evil" })).is_err());
    assert!(super::write::parse_package_name(&serde_json::json!({ "packageName": "a b" })).is_err());

    let favorite = super::write::WriteCall::FavoriteApk { package_name: parsed.clone(), favorite: true };
    assert_eq!(favorite.tool(), "coolapk_favorite_apk");
    assert_eq!(favorite.scope(), "write.interact");
    assert_eq!(favorite.preview()["packageName"], "com.coolapk.market");
    assert_eq!(favorite.preview()["action"], "favorite");
    assert!(favorite.summary().contains("收藏应用"));

    let unfavorite = super::write::WriteCall::FavoriteApk { package_name: parsed, favorite: false };
    assert_eq!(unfavorite.tool(), "coolapk_unfavorite_apk");
    assert_eq!(unfavorite.scope(), "write.interact");
    assert_eq!(unfavorite.preview()["action"], "unfavorite");
}
#[test]
fn extract_feed_finds_entity_in_nested_envelopes() {
    let nested = serde_json::json!({
        "code": 200,
        "data": {
            "code": 200,
            "data": {
                "feed": { "id": 74837196, "feedType": "feed", "message": "正文" }
            }
        }
    });
    let feed = super::write::extract_feed(&nested).expect("应能定位动态实体");
    assert_eq!(feed["id"], 74837196);
    assert!(super::write::extract_feed(&serde_json::json!({ "code": 500 })).is_none());
}
#[test]
fn write_parse_update_feed_validates_message_and_images() {
    let missing = super::write::parse_update_feed_args(&serde_json::json!({ "feedId": "74836959" })).unwrap_err();
    assert!(missing.message().contains("正文"), "实际错误：{}", missing.message());

    let conflict = super::write::parse_update_feed_args(&serde_json::json!({
        "feedId": "74836959",
        "message": "新正文",
        "clearImages": true,
        "imagePaths": ["/tmp/x.png"]
    }))
    .unwrap_err();
    assert!(conflict.message().contains("clearImages"), "实际错误：{}", conflict.message());

    let parsed = super::write::parse_update_feed_args(&serde_json::json!({
        "feedId": "74836959",
        "message": "  新正文  ",
        "requestId": "edit-1"
    }))
    .unwrap();
    assert_eq!(parsed.message, "新正文");
    assert!(!parsed.clear_images);
    assert_eq!(parsed.request_id.as_deref(), Some("edit-1"));

    let call = super::write::WriteCall::UpdateFeed(parsed);
    assert_eq!(call.tool(), "coolapk_update_feed");
    assert_eq!(call.scope(), "write.publish");
    assert_eq!(call.preview()["feedId"], "74836959");
    assert!(call.summary().contains("编辑动态"));
}

#[test]
fn write_parse_reply_id_topic_and_message_args() {
    let reply_id = super::write::parse_reply_id(&serde_json::json!({ "replyId": "61535463" })).unwrap();
    assert_eq!(reply_id, "61535463");
    assert!(super::write::parse_reply_id(&serde_json::json!({ "replyId": "1&x=2" })).is_err());

    let tag = super::write::parse_topic_tag(&serde_json::json!({ "tag": " #酷安# " })).unwrap();
    assert_eq!(tag, "酷安");
    assert!(super::write::parse_topic_tag(&serde_json::json!({ "tag": "##" })).is_err());

    let (uid, message) =
        super::write::parse_message_args(&serde_json::json!({ "uid": "44272578", "message": "  你好  " }))
            .unwrap();
    assert_eq!(uid, "44272578");
    assert_eq!(message, "你好");
    assert!(super::write::parse_message_args(&serde_json::json!({ "uid": "44272578", "message": "  " })).is_err());

    let like = super::write::WriteCall::LikeReply { reply_id: "1".to_string(), unlike: false };
    assert_eq!(like.tool(), "coolapk_like_reply");
    assert_eq!(like.preview()["action"], "like");
    let unlike = super::write::WriteCall::LikeReply { reply_id: "1".to_string(), unlike: true };
    assert_eq!(unlike.tool(), "coolapk_unlike_reply");
    let topic = super::write::WriteCall::FollowTopic { tag: "酷安".to_string(), follow: false };
    assert_eq!(topic.tool(), "coolapk_unfollow_topic");
    let message = super::write::WriteCall::SendMessage { uid: "1".to_string(), message: "你好".to_string() };
    assert_eq!(message.tool(), "coolapk_send_message");
    assert_eq!(message.scope(), "write.interact");
}

#[test]
fn detail_pic_urls_handles_string_and_object_array() {
    assert_eq!(
        super::write::detail_pic_urls(&serde_json::json!("https://a/1.jpg,https://a/2.jpg")).as_deref(),
        Some("https://a/1.jpg,https://a/2.jpg"),
    );
    assert_eq!(
        super::write::detail_pic_urls(&serde_json::json!([{ "url": "https://a/1.jpg" }, "https://a/2.jpg"])).as_deref(),
        Some("https://a/1.jpg,https://a/2.jpg"),
    );
    assert!(super::write::detail_pic_urls(&serde_json::json!([])).is_none());
    assert!(super::write::detail_pic_urls(&serde_json::json!("")).is_none());
}
#[test]
fn write_set_and_unset_feed_top_previews() {
    let top = super::write::WriteCall::SetFeedTop { feed_id: "74836959".to_string(), top: true };
    assert_eq!(top.tool(), "coolapk_set_feed_top");
    assert_eq!(top.scope(), "write.interact");
    assert_eq!(top.preview()["action"], "top");
    assert_eq!(top.preview()["feedId"], "74836959");
    assert!(top.summary().contains("置顶"));

    let untop = super::write::WriteCall::SetFeedTop { feed_id: "74836959".to_string(), top: false };
    assert_eq!(untop.tool(), "coolapk_unset_feed_top");
    assert!(untop.summary().contains("取消置顶"));
}
#[test]
fn write_parse_collection_save_args_validates_fields() {
    let missing = super::write::parse_collection_save_args(&serde_json::json!({ "title": "  " }), false).unwrap_err();
    assert!(missing.message().contains("标题"), "实际错误：{}", missing.message());

    let long = super::write::parse_collection_save_args(
        &serde_json::json!({ "title": "字".repeat(61) }),
        false,
    )
    .unwrap_err();
    assert!(long.message().contains("60"), "实际错误：{}", long.message());

    let bad_cover = super::write::parse_collection_save_args(
        &serde_json::json!({ "title": "测试", "cover": "javascript:alert(1)" }),
        false,
    )
    .unwrap_err();
    assert!(bad_cover.message().contains("cover"), "实际错误：{}", bad_cover.message());

    let created = super::write::parse_collection_save_args(
        &serde_json::json!({ "title": " 我的收藏单 ", "description": " 简介 " }),
        false,
    )
    .unwrap();
    assert_eq!(created.title, "我的收藏单");
    assert_eq!(created.description, "简介");
    assert!(created.is_open);
    assert!(created.collection_id.is_none());

    let updated = super::write::parse_collection_save_args(
        &serde_json::json!({ "collectionId": "123", "title": "改名", "isOpen": false }),
        true,
    )
    .unwrap();
    assert_eq!(updated.collection_id.as_deref(), Some("123"));
    assert!(!updated.is_open);
    assert!(super::write::parse_collection_save_args(&serde_json::json!({ "title": "改名" }), true).is_err());

    let call = super::write::WriteCall::CollectionUpdate(updated);
    assert_eq!(call.tool(), "coolapk_collection_update");
    assert_eq!(call.scope(), "write.publish");
    assert_eq!(call.preview()["collectionId"], "123");
    let create_call = super::write::WriteCall::CollectionCreate(created);
    assert_eq!(create_call.scope(), "write.interact");
    assert!(create_call.summary().contains("新建收藏单"));
}

#[test]
fn write_parse_collection_move_args_normalizes_ids() {
    let parsed = super::write::parse_collection_move_args(&serde_json::json!({
        "feedId": "72058782",
        "collectionIds": ["111", "222"],
        "cancelIds": "333"
    }))
    .unwrap();
    assert_eq!(parsed.collection_ids, "111,222");
    assert_eq!(parsed.cancel_ids, "333");
    assert_eq!(parsed.feed_id, "72058782");

    assert!(super::write::parse_collection_move_args(&serde_json::json!({ "feedId": "72058782" })).is_err());
    assert!(super::write::parse_collection_move_args(&serde_json::json!({
        "feedId": "72058782",
        "collectionIds": ["1&x=2"]
    }))
    .is_err());

    let call = super::write::WriteCall::CollectionAddFeed(parsed);
    assert_eq!(call.tool(), "coolapk_collection_add_feed");
    assert_eq!(call.scope(), "write.interact");
    assert_eq!(call.preview()["collectionIds"], "111,222");
}
fn write_ctx(name: &str, mode: AgentBridgeWriteMode) -> Arc<BridgeCtx> {
    write_ctx_with_scopes(
        name,
        mode,
        vec![
            AgentBridgeScope::Read,
            AgentBridgeScope::WritePublish,
            AgentBridgeScope::WriteInteract,
        ],
    )
}

fn write_ctx_with_scopes(name: &str, mode: AgentBridgeWriteMode, scopes: Vec<AgentBridgeScope>) -> Arc<BridgeCtx> {
    let dir = test_dir(name);
    let _ = std::fs::remove_file(dir.join(super::config::AUDIT_FILE_NAME));
    Arc::new(BridgeCtx {
        app: None,
        state: None,
        config: Arc::new(RwLock::new(AgentBridgeConfig {
            version: 1,
            transport: AgentBridgeTransport::Tcp,
            socket_path: None,
            port: Some(1),
            token: "test-token".to_string(),
            scopes,
            write_mode: mode,
            allowed_accounts: Vec::new(),
            mcp_enabled: false,
            mcp_port: None,
        })),
        audit: AuditSink::new(&dir),
        limits: Limits::new(),
        confirm: Some(Arc::new(super::write::ConfirmBroker::default())),
        dedupe: Some(Arc::new(super::write::WriteDedupe::new())),
    })
}

fn parse_publish(message: &str) -> super::write::PublishArgs {
    super::write::parse_publish_args(&serde_json::json!({ "message": message })).unwrap()
}

#[tokio::test]
async fn write_gate_disabled_rejects_and_audits() {
    let ctx = write_ctx("write-gate-disabled", AgentBridgeWriteMode::Disabled);
    let error = super::write::execute(&ctx, super::write::WriteCall::Publish(parse_publish("正文")))
        .await
        .unwrap_err();
    assert_eq!(error.error_code(), Some("write_disabled"));
    let log = std::fs::read_to_string(ctx.audit.path()).unwrap();
    assert!(log.contains(r#""ok":false"#), "审计：{log}");
    assert!(log.contains(r#""write":true"#), "审计：{log}");
    assert!(log.contains("write_disabled"), "审计：{log}");
}

#[tokio::test]
async fn write_gate_dry_run_previews_without_network() {
    let ctx = write_ctx("write-gate-dry-run", AgentBridgeWriteMode::DryRun);
    let value = super::write::execute(&ctx, super::write::WriteCall::Publish(parse_publish("秘密内容")))
        .await
        .unwrap();
    assert_eq!(value["dryRun"], true);
    assert_eq!(value["preview"]["messageChars"], 4);
    assert_eq!(value["preview"]["imageCount"], 0);

    let log = std::fs::read_to_string(ctx.audit.path()).unwrap();
    assert!(log.contains(r#""dryRun":true"#), "审计：{log}");
    assert!(log.contains(r#""messageChars":4"#), "审计：{log}");
    assert!(!log.contains("秘密内容"), "审计不能落正文：{log}");
}

#[tokio::test]
async fn write_gate_confirm_needs_app_and_auto_reaches_execution() {
    // confirm 没有应用实例时无法弹窗，明确返回 501。
    let ctx = write_ctx("write-gate-confirm", AgentBridgeWriteMode::Confirm);
    let error = super::write::execute(&ctx, super::write::WriteCall::Publish(parse_publish("正文")))
        .await
        .unwrap_err();
    assert_eq!(error.error_code(), Some("write_not_implemented"));

    // auto 已接通真实执行通道：缺少应用状态时是 503（应用状态不可用），不再是 501。
    let ctx = write_ctx("write-gate-auto", AgentBridgeWriteMode::Auto);
    let error = super::write::execute(&ctx, super::write::WriteCall::Publish(parse_publish("正文")))
        .await
        .unwrap_err();
    assert_eq!(error.status_code(), 503);
    assert!(!error.message().is_empty());
}

#[tokio::test]
async fn confirm_broker_resolves_approval() {
    use std::time::Duration;
    use tokio::sync::Notify;

    let broker = Arc::new(super::write::ConfirmBroker::default());
    let emitted = Arc::new(Notify::new());
    let worker = broker.clone();
    let notify = emitted.clone();
    let waiting = tokio::spawn(async move {
        worker.request("id-1", Duration::from_secs(2), || notify.notify_one()).await
    });
    emitted.notified().await;

    assert!(broker.resolve("id-1", true));
    assert!(waiting.await.unwrap());
    // 同一次请求不能重复结算
    assert!(!broker.resolve("id-1", true));
}

#[tokio::test]
async fn confirm_broker_denies_and_times_out() {
    use std::time::Duration;
    use tokio::sync::Notify;

    // 用户拒绝
    let broker = Arc::new(super::write::ConfirmBroker::default());
    let emitted = Arc::new(Notify::new());
    let worker = broker.clone();
    let notify = emitted.clone();
    let waiting = tokio::spawn(async move {
        worker.request("id-deny", Duration::from_secs(2), || notify.notify_one()).await
    });
    emitted.notified().await;
    assert!(broker.resolve("id-deny", false));
    assert!(!waiting.await.unwrap());

    // 超时未回应：迟到结果被忽略
    let broker = super::write::ConfirmBroker::default();
    assert!(!broker.request("id-timeout", Duration::from_millis(30), || {}).await);
    assert!(!broker.resolve("id-timeout", true));
}

#[tokio::test]
async fn confirm_broker_replacement_rejects_previous_request() {
    use std::time::Duration;
    use tokio::sync::Notify;

    let broker = Arc::new(super::write::ConfirmBroker::default());
    let first_emitted = Arc::new(Notify::new());
    let worker = broker.clone();
    let notify = first_emitted.clone();
    let first = tokio::spawn(async move {
        worker.request("id-a", Duration::from_secs(2), || notify.notify_one()).await
    });
    first_emitted.notified().await;

    let second_emitted = Arc::new(Notify::new());
    let worker = broker.clone();
    let notify = second_emitted.clone();
    let second = tokio::spawn(async move {
        worker.request("id-b", Duration::from_secs(2), || notify.notify_one()).await
    });
    second_emitted.notified().await;

    // 旧请求被自动拒绝，且不能再被结算
    assert!(!first.await.unwrap());
    assert!(!broker.resolve("id-a", true));
    assert!(broker.resolve("id-b", true));
    assert!(second.await.unwrap());
}

fn like_call(feed_id: &str) -> super::write::WriteCall {
    super::write::WriteCall::LikeFeed { feed_id: feed_id.to_string(), unlike: false }
}

#[tokio::test]
async fn write_interact_dry_run_previews_target() {
    let ctx = write_ctx("write-interact-dry-run", AgentBridgeWriteMode::DryRun);
    let value = super::write::execute(&ctx, like_call("12345678")).await.unwrap();
    assert_eq!(value["dryRun"], true);
    assert_eq!(value["preview"]["feedId"], "12345678");
    assert_eq!(value["preview"]["action"], "like");
}

#[tokio::test]
async fn write_apk_favorite_dry_run_previews_package() {
    let ctx = write_ctx("write-apk-favorite-dry-run", AgentBridgeWriteMode::DryRun);
    let value = super::write::execute(
        &ctx,
        super::write::WriteCall::FavoriteApk { package_name: "com.coolapk.market".to_string(), favorite: true },
    )
    .await
    .unwrap();
    assert_eq!(value["dryRun"], true);
    assert_eq!(value["preview"]["packageName"], "com.coolapk.market");
    assert_eq!(value["preview"]["action"], "favorite");
}

#[tokio::test]
async fn write_requires_matching_scope() {
    let ctx = write_ctx_with_scopes(
        "write-scope-denied",
        AgentBridgeWriteMode::Auto,
        vec![AgentBridgeScope::Read],
    );
    let error = super::write::execute(&ctx, like_call("12345678")).await.unwrap_err();
    assert_eq!(error.status_code(), 403);
    assert!(error.message().contains("缺少授权范围"), "实际错误：{}", error.message());
}

#[tokio::test]
async fn write_confirm_without_app_reports_not_implemented() {
    let ctx = write_ctx("write-confirm-no-app", AgentBridgeWriteMode::Confirm);
    let error = super::write::execute(&ctx, like_call("12345678")).await.unwrap_err();
    assert_eq!(error.error_code(), Some("write_not_implemented"));
}

#[tokio::test]
async fn mcp_interact_tools_follow_scope_and_dry_run() {
    let ctx = write_ctx("mcp-interact-tools", AgentBridgeWriteMode::DryRun);
    let (_, listed) = mcp_send(&ctx, serde_json::json!({ "jsonrpc": "2.0", "id": 30, "method": "tools/list" })).await;
    let names = tool_names(&listed);
    for name in ["coolapk_like_feed", "coolapk_unlike_feed", "coolapk_follow_user", "coolapk_unfollow_user"] {
        assert!(names.contains(&name.to_string()), "缺少 {name}");
    }

    let (_, value) = mcp_send(
        &ctx,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 31,
            "method": "tools/call",
            "params": { "name": "coolapk_like_feed", "arguments": { "feedId": "12345678" } }
        }),
    )
    .await;
    assert_eq!(value["result"]["isError"], false);
    let text = value["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains(r#""feedId":"12345678""#), "{text}");
}

#[test]
fn write_limits_are_split_by_scope() {
    let limits = Limits::new();
    // 发布：1 次/分钟
    assert!(limits.check("write.publish").is_ok());
    assert!(limits.check("write.publish").is_err());
    // 互动：6 次/分钟，且不被发布桶占用
    for _ in 0..6 {
        assert!(limits.check("write.interact").is_ok());
    }
    assert!(limits.check("write.interact").is_err());
    // 读桶独立
    assert!(limits.check("read").is_ok());
}

#[test]
fn write_dedupe_caches_by_tool_account_and_request_id() {
    use super::write::WriteDedupe;
    let dedupe = WriteDedupe::new();
    let value = serde_json::json!({ "code": 200, "data": { "feedId": "1" } });
    let key = WriteDedupe::key("coolapk_publish_feed", Some("u1"), "req-1");
    dedupe.store(key.clone(), &value);
    assert_eq!(dedupe.get(&key), Some(value));
    assert!(dedupe.get(&WriteDedupe::key("coolapk_publish_feed", Some("u2"), "req-1")).is_none());
    assert!(dedupe.get(&WriteDedupe::key("coolapk_reply_feed", Some("u1"), "req-1")).is_none());
    assert!(dedupe.get(&WriteDedupe::key("coolapk_publish_feed", Some("u1"), "req-2")).is_none());
}

#[test]
fn write_dedupe_expires_after_ttl() {
    use super::write::WriteDedupe;
    use std::time::Duration;
    let dedupe = WriteDedupe::with_ttl(Duration::from_millis(20));
    let key = WriteDedupe::key("coolapk_publish_feed", Some("u1"), "req-ttl");
    dedupe.store(key.clone(), &serde_json::json!({ "ok": true }));
    std::thread::sleep(Duration::from_millis(40));
    assert!(dedupe.get(&key).is_none());
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
async fn mcp_reply_and_forward_dry_run_preview() {
    let ctx = write_ctx("mcp-reply-dry-run", AgentBridgeWriteMode::DryRun);
    for (id, name, arguments, needle) in [
        (60, "coolapk_reply_feed", serde_json::json!({ "feedId": "74836959", "message": "预览评论", "rid": "9001" }), r#""rid":"9001""#),
        (61, "coolapk_forward_feed", serde_json::json!({ "feedId": "74836959", "message": "预览转发" }), r#""feedId":"74836959""#),
        (62, "coolapk_favorite_feed", serde_json::json!({ "feedId": "74836959" }), r#""action":"favorite""#),
        (63, "coolapk_delete_feed", serde_json::json!({ "feedId": "74836959" }), r#""action":"delete""#),
    ] {
        let (_, value) = mcp_send(
            &ctx,
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "tools/call",
                "params": { "name": name, "arguments": arguments }
            }),
        )
        .await;
        assert_eq!(value["result"]["isError"], false, "{name}: {value}");
        let text = value["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains(r#""dryRun":true"#), "{name}：{text}");
        assert!(text.contains(needle), "{name}：{text}");
    }
}

#[tokio::test]
async fn mcp_delete_feed_requires_publish_scope() {
    let ctx = write_ctx_with_scopes(
        "mcp-delete-scope",
        AgentBridgeWriteMode::DryRun,
        vec![AgentBridgeScope::Read, AgentBridgeScope::WriteInteract],
    );
    let (_, value) = mcp_send(
        &ctx,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 64,
            "method": "tools/call",
            "params": { "name": "coolapk_delete_feed", "arguments": { "feedId": "74836959" } }
        }),
    )
    .await;
    assert_eq!(value["result"]["isError"], true);
    let text = value["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("缺少授权范围"), "{text}");
}
/// axum 默认 body 上限 2 MB，发帖图片必须证明放宽后的上限真的生效。
#[tokio::test]
async fn mcp_accepts_body_larger_than_default_axum_limit() {
    let ctx = test_ctx("mcp-large-body", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let padding = "A".repeat(3 * 1024 * 1024);
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 40,
        "method": "ping",
        "params": { "padding": padding }
    })
    .to_string();
    let response = build_mcp_router(ctx)
        .oneshot(mcp_post(&body, Some("test-token")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["result"].as_object().map(|object| object.is_empty()), Some(true), "{value}");
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
async fn mcp_write_tools_follow_scope() {
    let write_scope = write_ctx("mcp-write-tools", AgentBridgeWriteMode::DryRun);
    let (_, listed) = mcp_send(&write_scope, serde_json::json!({ "jsonrpc": "2.0", "id": 20, "method": "tools/list" })).await;
    assert!(tool_names(&listed).contains(&"coolapk_publish_feed".to_string()));

    let read_only = test_ctx("mcp-read-only-tools", vec![AgentBridgeScope::Read], AgentBridgeTransport::Tcp);
    let (_, listed) = mcp_send(&read_only, serde_json::json!({ "jsonrpc": "2.0", "id": 21, "method": "tools/list" })).await;
    assert!(!tool_names(&listed).contains(&"coolapk_publish_feed".to_string()));
}

#[tokio::test]
async fn mcp_publish_dry_run_returns_preview() {
    let ctx = write_ctx("mcp-publish-dry-run", AgentBridgeWriteMode::DryRun);
    let (_, value) = mcp_send(
        &ctx,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 22,
            "method": "tools/call",
            "params": { "name": "coolapk_publish_feed", "arguments": { "message": "预览正文" } }
        }),
    )
    .await;
    assert_eq!(value["result"]["isError"], false);
    let text = value["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains(r#""dryRun":true"#), "{text}");
    assert!(text.contains("预览正文"), "{text}");
}
#[tokio::test]
async fn mcp_favorite_apk_dry_run_previews_package() {
    let ctx = write_ctx("mcp-favorite-apk-dry-run", AgentBridgeWriteMode::DryRun);
    let (_, value) = mcp_send(
        &ctx,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 23,
            "method": "tools/call",
            "params": { "name": "coolapk_favorite_apk", "arguments": { "packageName": "com.coolapk.market" } }
        }),
    )
    .await;
    assert_eq!(value["result"]["isError"], false, "{value}");
    let text = value["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains(r#""dryRun":true"#), "{text}");
    assert!(text.contains("com.coolapk.market"), "{text}");
}

#[tokio::test]
async fn mcp_publish_dry_run_accepts_image_paths() {
    let dir = test_dir("mcp-publish-image-paths");
    let file = dir.join("shot.png");
    std::fs::write(&file, tiny_png_bytes()).unwrap();
    let ctx = write_ctx("mcp-publish-image-paths-run", AgentBridgeWriteMode::DryRun);
    let (_, value) = mcp_send(
        &ctx,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 24,
            "method": "tools/call",
            "params": {
                "name": "coolapk_publish_feed",
                "arguments": { "imagePaths": [file.display().to_string()], "options": { "targetType": "tag", "targetId": "1" } }
            }
        }),
    )
    .await;
    assert_eq!(value["result"]["isError"], false);
    let text = value["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains(r#""dryRun":true"#), "{text}");
    assert!(text.contains(r#""source":"path""#), "{text}");
    assert!(text.contains(r#""imageCount":1"#), "{text}");
    assert!(text.contains(r#""targetId":"1""#), "{text}");
}

#[tokio::test]
async fn mcp_publish_respects_write_gate() {
    let ctx = write_ctx("mcp-publish-disabled", AgentBridgeWriteMode::Disabled);
    let (_, value) = mcp_send(
        &ctx,
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 23,
            "method": "tools/call",
            "params": { "name": "coolapk_publish_feed", "arguments": { "message": "正文" } }
        }),
    )
    .await;
    assert_eq!(value["result"]["isError"], true);
    let text = value["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("写操作已禁用"), "{text}");
}

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


#[test]
fn parse_scopes_always_includes_read() {
    // 读取权限由服务端强制加入，前端无法关闭。
    let scopes = super::parse_scopes(&["write.interact".to_string()]).unwrap();
    assert_eq!(scopes, vec![AgentBridgeScope::Read, AgentBridgeScope::WriteInteract]);
    assert_eq!(super::parse_scopes(&[]).unwrap(), vec![AgentBridgeScope::Read]);
}

#[test]
fn usage_guide_reflects_current_config() {
    let ctx = test_ctx(
        "usage-guide",
        vec![AgentBridgeScope::Read, AgentBridgeScope::WriteInteract],
        AgentBridgeTransport::Tcp,
    );
    let config = ctx.config.read().unwrap().clone();
    let text = super::guide::usage_guide(&config);
    assert!(text.contains("test-token"));
    assert!(text.contains("coolapk_health"));
    assert!(text.contains("coolapk_like_feed"));
    // 未授权的 write.publish 工具不应出现在说明里。
    assert!(!text.contains("coolapk_publish_feed"));
    assert!(text.contains("互动操作"));
    assert!(text.contains("MCP 地址：当前未开启"));

    let mut with_mcp = config.clone();
    with_mcp.mcp_enabled = true;
    with_mcp.mcp_port = Some(47654);
    let mcp_text = super::guide::usage_guide(&with_mcp);
    assert!(mcp_text.contains("http://127.0.0.1:47654/mcp"));
    assert!(mcp_text.contains("claude mcp add --transport http coolapk"));
}
