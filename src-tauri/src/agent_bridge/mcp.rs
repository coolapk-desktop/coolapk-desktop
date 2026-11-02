//! MCP（Model Context Protocol）门面：在应用进程内、复用同一个 CoolapkClient。
//!
//! 只实现 Streamable HTTP 传输里 MCP 客户端实际用到的子集：POST /mcp 上的
//! initialize / ping / tools/list / tools/call 与通知。不启用服务器到客户端的 SSE 流
//! （GET 返回 405），也不维护会话状态，因此内存占用只有工具表本身。
//!
//! 安全模型与 REST 接口一致：仅监听 127.0.0.1、校验 Host 与 Origin、必须携带
//! Authorization: Bearer <token>；工具按授权范围过滤，调用复用同一套限流与审计。

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};

use super::config::AgentBridgeScope;
use super::http::{audit, authorize_tcp, ApiError, Auth, BridgeCtx};
use super::ops;
use super::write;

/// 支持协商的 MCP 协议版本，新的在前。
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION: &str = "2025-06-18";
const MAX_BODY_BYTES: usize = 256 * 1024;

/// 工具描述：scope 为 None 表示只需 token、不需要额外授权。
struct ToolSpec {
    name: &'static str,
    description: &'static str,
    scope: Option<AgentBridgeScope>,
    schema: fn() -> Value,
}

fn object_schema(properties: Value, required: Vec<&str>) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false,
    })
}

static TOOLS: &[ToolSpec] = &[
    ToolSpec {
        name: "coolapk_health",
        description: "查看本地酷安接口状态：版本、监听地址、MCP 地址、授权范围、当前登录账号。",
        scope: None,
        schema: || object_schema(json!({}), vec![]),
    },
    ToolSpec {
        name: "coolapk_me",
        description: "获取当前登录账号的酷安个人资料。",
        scope: Some(AgentBridgeScope::Read),
        schema: || object_schema(json!({}), vec![]),
    },
    ToolSpec {
        name: "coolapk_search",
        description: "按关键词搜索酷安内容。type 可选 feed（动态）、user（用户）、topic（话题）等，默认综合搜索。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({
                    "q": { "type": "string", "description": "搜索关键词" },
                    "type": { "type": "string", "description": "搜索类型：all、feed、user、topic 等，默认 all" },
                    "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" }
                }),
                vec!["q"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_feed_detail",
        description: "获取单条动态的详情（正文、作者、互动数据等）。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({ "id": { "type": "string", "description": "动态 ID" } }),
                vec!["id"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_feed_replies",
        description: "分页获取某条动态的评论列表。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({
                    "id": { "type": "string", "description": "动态 ID" },
                    "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" },
                    "listType": { "type": "string", "description": "排序方式，默认 lastupdate_desc" }
                }),
                vec!["id"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_user_profile",
        description: "获取指定用户（uid）的酷安个人资料。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({ "uid": { "type": "string", "description": "用户 uid" } }),
                vec!["uid"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_user_feeds",
        description: "分页获取指定用户发布的动态。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({
                    "uid": { "type": "string", "description": "用户 uid" },
                    "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" },
                    "feedType": { "type": "string", "description": "动态类型过滤，留空表示全部" }
                }),
                vec!["uid"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_publish_feed",
        description: "发布一条酷安动态（需要 write.publish 授权）。受写操作闸门约束：dry-run 只返回预览，confirm 需要在应用内确认，auto 直接提交。",
        scope: Some(AgentBridgeScope::WritePublish),
        schema: || {
            object_schema(
                json!({
                    "message": { "type": "string", "description": "动态正文，最多 5000 字" },
                    "images": {
                        "type": "array",
                        "maxItems": 4,
                        "description": "可选图片（base64），最多 4 张、单张 8 MB、总计 20 MB",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string", "description": "上传文件名" },
                                "mimeType": { "type": "string", "enum": ["image/jpeg", "image/png", "image/webp"] },
                                "dataBase64": { "type": "string", "description": "base64 或 data URL" }
                            },
                            "required": ["dataBase64"],
                            "additionalProperties": false
                        }
                    },
                    "visibleStatus": { "type": "integer", "enum": [1, -1], "description": "1 公开、-1 仅自己" },
                    "requestId": { "type": "string", "description": "幂等请求 id；客户端重试时带上可避免重复发布" }
                }),
                vec!["message"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_topic_detail",
        description: "获取话题详情（按话题 tag）。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({ "tag": { "type": "string", "description": "话题 tag，例如 酷安" } }),
                vec!["tag"],
            )
        },
    },
];

pub fn build_router(ctx: Arc<BridgeCtx>) -> Router {
    Router::new()
        .route("/mcp", post(handle_post).get(handle_get).delete(handle_delete))
        .with_state(ctx)
}

async fn handle_get(State(ctx): State<Arc<BridgeCtx>>, headers: HeaderMap) -> Response {
    if let Err(error) = authorize_tcp(&ctx, &headers) {
        return error.into_response();
    }
    // 不提供服务端主动推送流；MCP 客户端收到 405 会退回纯请求/响应模式。
    (StatusCode::METHOD_NOT_ALLOWED, [(header::ALLOW, "POST, DELETE")], "").into_response()
}

async fn handle_delete(State(ctx): State<Arc<BridgeCtx>>, headers: HeaderMap) -> Response {
    if let Err(error) = authorize_tcp(&ctx, &headers) {
        return error.into_response();
    }
    // 无会话状态，收到会话结束请求直接确认。
    StatusCode::NO_CONTENT.into_response()
}

async fn handle_post(State(ctx): State<Arc<BridgeCtx>>, headers: HeaderMap, body: Bytes) -> Response {
    let auth = match authorize_tcp(&ctx, &headers) {
        Ok(auth) => auth,
        Err(error) => return error.into_response(),
    };
    if !is_json_content_type(&headers) {
        return rpc_error(None, -32600, "Content-Type 必须为 application/json");
    }
    if body.len() > MAX_BODY_BYTES {
        return rpc_error(None, -32600, "请求体过大");
    }
    let payload: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => return rpc_error(None, -32700, "JSON 解析失败"),
    };
    let Value::Object(request) = payload else {
        return rpc_error(None, -32600, "只接受单个 JSON-RPC 对象");
    };
    if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return rpc_error(request.get("id").cloned(), -32600, "jsonrpc 必须为 2.0");
    }
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return rpc_error(request.get("id").cloned(), -32600, "缺少 method");
    };
    let Some(id) = request.get("id").cloned() else {
        // 通知（notifications/initialized 等）不需要响应。
        return StatusCode::ACCEPTED.into_response();
    };
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    match method {
        "initialize" => rpc_result(id, initialize_result(&params)),
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(id, tools_list(&auth)),
        "tools/call" => tools_call(&ctx, &auth, id, &params).await,
        "resources/list" => rpc_result(id, json!({ "resources": [] })),
        "prompts/list" => rpc_result(id, json!({ "prompts": [] })),
        other => rpc_error(Some(id), -32601, format!("不支持的方法：{other}")),
    }
}

fn is_json_content_type(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_none_or(|value| value.to_ascii_lowercase().contains("application/json"))
}

fn initialize_result(params: &Value) -> Value {
    let requested = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or(LATEST_PROTOCOL_VERSION);
    let version = if PROTOCOL_VERSIONS.contains(&requested) {
        requested
    } else {
        LATEST_PROTOCOL_VERSION
    };
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": {
            "name": "coolapk-desktop",
            "title": "酷安桌面端本地接口",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "instructions": "通过本机酷安桌面客户端访问当前登录账号：只读动态、评论、用户、话题与搜索。所有调用都在本机完成，受授权范围、限流与审计约束；需要人工验证码时返回 captcha_required，请在应用内处理。",
    })
}

fn tools_list(auth: &Auth) -> Value {
    let tools: Vec<Value> = TOOLS
        .iter()
        .filter(|tool| tool.scope.is_none_or(|scope| auth.scopes.contains(&scope)))
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": (tool.schema)(),
            })
        })
        .collect();
    json!({ "tools": tools })
}

async fn tools_call(ctx: &BridgeCtx, auth: &Auth, id: Value, params: &Value) -> Response {
    let name = params.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    if !args.is_object() {
        return rpc_result(id, tool_error(ApiError::bad_request("arguments 必须是 JSON 对象")));
    }
    let Some(spec) = TOOLS.iter().find(|tool| tool.name == name) else {
        return rpc_result(id, tool_error(ApiError::bad_request(format!("未知工具：{name}"))));
    };
    if let Some(scope) = spec.scope {
        if !auth.scopes.contains(&scope) {
            return rpc_result(
                id,
                tool_error(ApiError::forbidden(format!("缺少授权范围：{}", scope.as_str()))),
            );
        }
    }
    let limit_class = match spec.scope {
        Some(AgentBridgeScope::WritePublish) => "write.publish",
        Some(AgentBridgeScope::WriteInteract) => "write.interact",
        _ => "read",
    };
    if let Err(retry_after) = ctx.limits.check(limit_class) {
        return rpc_result(id, tool_error(ApiError::rate_limited(retry_after)));
    }

    let result = dispatch(ctx, spec.name, &args).await;
    // 写工具的审计由 write::execute 记录（含 dryRun/目标/正文字数），这里只审计只读调用。
    if !matches!(
        spec.scope,
        Some(AgentBridgeScope::WritePublish | AgentBridgeScope::WriteInteract)
    ) {
        audit(ctx, "read", &format!("MCP {}", spec.name), result.is_ok());
    }
    match result {
        Ok(value) => rpc_result(
            id,
            json!({
                "content": [{ "type": "text", "text": json!({ "code": 200, "data": value, "message": "" }).to_string() }],
                "isError": false,
            }),
        ),
        Err(error) => rpc_result(id, tool_error(error)),
    }
}

async fn dispatch(ctx: &BridgeCtx, name: &str, args: &Value) -> Result<Value, ApiError> {
    match name {
        "coolapk_health" => {
            let scopes = ctx
                .config
                .read()
                .map_err(|_| ApiError::unauthorized("Agent 接口状态异常"))?
                .scope_set();
            ops::health(ctx, &scopes).await
        }
        "coolapk_me" => ops::me(ctx).await,
        "coolapk_search" => {
            let keyword = required_arg(args, "q", "搜索关键词")?;
            let search_type = string_arg(args, "type").unwrap_or_else(|| "all".to_string());
            ops::search(ctx, &keyword, &search_type, page_arg(args)).await
        }
        "coolapk_feed_detail" => {
            let id = required_arg(args, "id", "动态 ID")?;
            ops::feed_detail(ctx, &id).await
        }
        "coolapk_feed_replies" => {
            let id = required_arg(args, "id", "动态 ID")?;
            let list_type = string_arg(args, "listType")
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "lastupdate_desc".to_string());
            ops::feed_replies(ctx, &id, page_arg(args), &list_type).await
        }
        "coolapk_user_profile" => {
            let uid = required_arg(args, "uid", "用户 uid")?;
            ops::user_profile(ctx, &uid).await
        }
        "coolapk_user_feeds" => {
            let uid = required_arg(args, "uid", "用户 uid")?;
            let feed_type = string_arg(args, "feedType").unwrap_or_default();
            ops::user_feeds(ctx, &uid, page_arg(args), &feed_type).await
        }
        "coolapk_topic_detail" => {
            let tag = required_arg(args, "tag", "话题 tag")?;
            ops::topic_detail(ctx, &tag).await
        }
        "coolapk_publish_feed" => {
            let publish = write::parse_publish_args(args)?;
            write::execute(ctx, write::WriteCall::Publish(publish)).await
        }
        other => Err(ApiError::bad_request(format!("未知工具：{other}"))),
    }
}

fn string_arg(args: &Value, key: &str) -> Option<String> {
    match args.get(key) {
        Some(Value::String(value)) => Some(value.trim().to_string()),
        Some(Value::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn required_arg(args: &Value, key: &str, label: &str) -> Result<String, ApiError> {
    string_arg(args, key)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request(format!("缺少参数 {key}（{label}）")))
}

fn page_arg(args: &Value) -> u32 {
    args.get("page")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, 500) as u32
}

fn tool_error(error: ApiError) -> Value {
    let mut payload = json!({
        "code": error.status_code(),
        "message": error.message(),
        "retryable": error.retryable(),
    });
    if let Some(code) = error.error_code() {
        payload["error"] = json!(code);
    }
    json!({
        "content": [{ "type": "text", "text": payload.to_string() }],
        "isError": true,
    })
}

fn rpc_result(id: Value, result: Value) -> Response {
    Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response()
}

fn rpc_error(id: Option<Value>, code: i64, message: impl Into<String>) -> Response {
    Json(json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": { "code": code, "message": message.into() },
    }))
    .into_response()
}
