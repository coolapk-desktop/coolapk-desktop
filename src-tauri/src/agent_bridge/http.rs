use std::collections::{BTreeSet, HashMap};
use std::ops::Deref;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;

use super::audit::AuditSink;
use super::config::{token_matches, AgentBridgeConfig, AgentBridgeScope, AgentBridgeTransport};
use crate::coolapk::commands::AppState;

/// 浏览器/网页发起的请求必须被拒绝，避免本地服务被 CSRF 或 DNS rebinding 利用。
const ALLOWED_ORIGINS: [&str; 0] = [];

pub struct BridgeCtx {
    /// 生产路径：通过 AppHandle 取 Tauri 托管的全局状态。
    pub app: Option<tauri::AppHandle>,
    /// 测试路径：直接持有状态，避免单元测试需要真实应用实例。
    pub state: Option<Arc<AppState>>,
    pub config: Arc<RwLock<AgentBridgeConfig>>,
    pub audit: AuditSink,
    pub limits: Limits,
}

impl BridgeCtx {
    pub fn app_state(&self) -> Option<StateRef<'_>> {
        if let Some(state) = &self.state {
            return Some(StateRef::Owned(Arc::clone(state)));
        }
        self.app
            .as_ref()
            .map(|app| StateRef::Managed(app.state::<AppState>()))
    }
}

pub enum StateRef<'a> {
    Managed(tauri::State<'a, AppState>),
    Owned(Arc<AppState>),
}

impl Deref for StateRef<'_> {
    type Target = AppState;

    fn deref(&self) -> &AppState {
        match self {
            Self::Managed(state) => state.inner(),
            Self::Owned(state) => state.as_ref(),
        }
    }
}

/// 固定窗口限流：读 60 次/分钟；写 1 次/分钟、10 次/小时。
pub struct Limits {
    buckets: Mutex<HashMap<&'static str, Vec<Instant>>>,
}

impl Default for Limits {
    fn default() -> Self {
        Self::new()
    }
}

impl Limits {
    pub fn new() -> Self {
        Self { buckets: Mutex::new(HashMap::new()) }
    }

    /// 成功返回 Ok(())，被限流返回 Err(建议的 Retry-After 秒数)。
    pub fn check(&self, class: &'static str) -> Result<(), u64> {
        let now = Instant::now();
        let mut buckets = match self.buckets.lock() {
            Ok(buckets) => buckets,
            Err(_) => return Ok(()),
        };
        let hits = buckets.entry(class).or_default();
        hits.retain(|at| now.duration_since(*at) < Duration::from_secs(3600));
        let (window, limit) = match class {
            "write" => (Duration::from_secs(60), 1usize),
            _ => (Duration::from_secs(60), 60usize),
        };
        let in_window = hits.iter().filter(|at| now.duration_since(**at) < window).count();
        let hourly = hits.len();
        if in_window >= limit || (class == "write" && hourly >= 10) {
            let wait = hits
                .iter()
                .map(|at| now.duration_since(*at))
                .min()
                .map(|elapsed| window.saturating_sub(elapsed).as_secs().max(1))
                .unwrap_or(1);
            return Err(wait);
        }
        hits.push(now);
        Ok(())
    }
}

pub struct ApiError {
    status: StatusCode,
    message: String,
    retryable: bool,
    retry_after: Option<u64>,
    error_code: Option<&'static str>,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into(), retryable: false, retry_after: None, error_code: None }
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, message)
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }

    fn rate_limited(retry_after: u64) -> Self {
        Self { retry_after: Some(retry_after), retryable: true, ..Self::new(StatusCode::TOO_MANY_REQUESTS, "请求过于频繁，请稍后重试") }
    }

    /// 酷安要求人工验证码：不能自动重试，必须由应用内用户完成。
    fn captcha() -> Self {
        Self {
            error_code: Some("captcha_required"),
            retryable: false,
            ..Self::new(StatusCode::PRECONDITION_REQUIRED, "需要人工完成酷安验证码，请在应用内处理后重试")
        }
    }

    /// 把 CoolapkClient 的 Err(String) 转成 HTTP 语义。
    pub fn from_client_error(error: String) -> Self {
        if let Ok(value) = serde_json::from_str::<Value>(&error) {
            let message = value
                .get("message")
                .or_else(|| value.get("err"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            if message.contains("captcha") || value.get("messageStatus").and_then(Value::as_str).is_some_and(|status| status.contains("captcha")) {
                return Self::captcha();
            }
            let status = value
                .get("status")
                .or_else(|| value.get("code"))
                .and_then(Value::as_i64)
                .filter(|status| (400..600).contains(status))
                .and_then(|status| StatusCode::from_u16(status as u16).ok())
                .unwrap_or(StatusCode::BAD_GATEWAY);
            return Self::new(status, message);
        }
        Self::new(StatusCode::BAD_GATEWAY, truncate(&error, 300))
    }
}

fn truncate(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = json!({
            "code": self.status.as_u16(),
            "message": self.message,
            "retryable": self.retryable,
        });
        if let Some(error) = self.error_code {
            body["error"] = json!(error);
        }
        let mut response = (self.status, Json(body)).into_response();
        if let Some(retry_after) = self.retry_after {
            if let Ok(value) = header::HeaderValue::from_str(&retry_after.to_string()) {
                response.headers_mut().insert(header::RETRY_AFTER, value);
            }
        }
        response
    }
}

/// 请求已通过 token 校验后的授权信息。
pub struct Auth {
    pub scopes: BTreeSet<AgentBridgeScope>,
}

impl Auth {
    pub fn require(&self, scope: AgentBridgeScope) -> Result<(), ApiError> {
        if self.scopes.contains(&scope) {
            Ok(())
        } else {
            Err(ApiError::forbidden(format!("缺少授权范围：{}", scope.as_str())))
        }
    }
}

impl FromRequestParts<Arc<BridgeCtx>> for Auth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, ctx: &Arc<BridgeCtx>) -> Result<Self, Self::Rejection> {
        let config = ctx.config.read().map_err(|_| ApiError::unauthorized("Agent 接口状态异常"))?;
        if config.transport == AgentBridgeTransport::Tcp {
            check_loopback_host(&parts.headers)?;
        }
        check_origin(&parts.headers)?;

        let provided = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ApiError::unauthorized("缺少 Authorization: Bearer <token>"))?;
        if !token_matches(&config.token, provided) {
            return Err(ApiError::unauthorized("token 无效"));
        }

        let class = if parts.method == Method::POST { "write" } else { "read" };
        ctx.limits.check(class).map_err(ApiError::rate_limited)?;
        Ok(Self { scopes: config.scope_set() })
    }
}

fn check_loopback_host(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let valid = host.starts_with("127.0.0.1") || host.starts_with("localhost") || host.starts_with("[::1]");
    if valid { Ok(()) } else { Err(ApiError::forbidden("只接受本机回环地址的请求")) }
}

fn check_origin(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    // 任何带 Origin 的跨界请求一律拒绝；本地 agent 不使用浏览器，不需要 CORS。
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|value| value.to_str().ok()) {
        if !ALLOWED_ORIGINS.contains(&origin) {
            return Err(ApiError::forbidden("不允许来自浏览器的跨域请求"));
        }
    }
    Ok(())
}

fn envelope(value: Value) -> Value {
    if value.get("code").is_some() {
        value
    } else {
        json!({ "code": 200, "data": value, "message": "" })
    }
}

fn client_result(result: Result<Value, String>) -> Result<Json<Value>, ApiError> {
    match result {
        Ok(value) => Ok(Json(envelope(value))),
        Err(error) => Err(ApiError::from_client_error(error)),
    }
}

pub fn build_router(ctx: Arc<BridgeCtx>) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/me", get(me))
        .route("/v1/feed/{id}", get(feed_detail))
        .route("/v1/feed/{id}/replies", get(feed_replies))
        .route("/v1/user/{uid}", get(user_profile))
        .route("/v1/user/{uid}/feeds", get(user_feeds))
        .route("/v1/topic/{tag}", get(topic_detail))
        .route("/v1/search", get(search))
        .with_state(ctx)
}

fn audit(ctx: &BridgeCtx, scope: &str, route: &str, ok: bool) {
    let account = ctx
        .config
        .read()
        .ok()
        .and_then(|_| ctx.app_state())
        .and_then(|state| state.client.current_uid());
    ctx.audit.record(json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "route": route,
        "scope": scope,
        "ok": ok,
        "account": account,
    }));
}

async fn health(State(ctx): State<Arc<BridgeCtx>>, auth: Auth) -> Result<Json<Value>, ApiError> {
    let scopes: Vec<&str> = auth.scopes.iter().map(|scope| scope.as_str()).collect();
    let (transport, endpoint, write_mode) = {
        let config = ctx.config.read().map_err(|_| ApiError::unauthorized("Agent 接口状态异常"))?;
        (config.transport.as_str(), config.endpoint(), config.write_mode.as_str())
    };
    let account = match ctx.app_state() {
        Some(state) if state.client.get_user_cookie().is_some() => {
            let uid = state.client.current_uid().unwrap_or_default();
            let username = state
                .client
                .list_accounts()
                .await
                .ok()
                .and_then(|value| {
                    value
                        .get("data")
                        .and_then(Value::as_array)
                        .and_then(|list| list.iter().find(|item| item.get("uid").and_then(Value::as_str) == Some(uid.as_str())).cloned())
                })
                .and_then(|item| item.get("username").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_default();
            json!({ "uid": uid, "username": username })
        }
        _ => Value::Null,
    };
    Ok(Json(json!({
        "code": 200,
        "message": "",
        "data": {
            "version": env!("CARGO_PKG_VERSION"),
            "transport": transport,
            "endpoint": endpoint,
            "writeMode": write_mode,
            "scopes": scopes,
            "account": account,
            "limits": { "readPerMinute": 60, "writePerMinute": 1, "writePerHour": 10 },
        }
    })))
}

#[derive(Deserialize)]
struct RepliesQuery {
    #[serde(default)]
    page: Option<u32>,
    #[serde(default, rename = "listType")]
    list_type: Option<String>,
}

#[derive(Deserialize)]
struct UserFeedsQuery {
    #[serde(default)]
    page: Option<u32>,
    #[serde(default, rename = "feedType")]
    feed_type: Option<String>,
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    #[serde(default, rename = "type")]
    search_type: Option<String>,
    #[serde(default)]
    page: Option<u32>,
}

async fn me(State(ctx): State<Arc<BridgeCtx>>, auth: Auth) -> Result<Json<Value>, ApiError> {
    auth.require(AgentBridgeScope::Read)?;
    let state = ctx.app_state().ok_or_else(|| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "应用状态不可用"))?;
    let uid = state.client.current_uid().ok_or_else(|| ApiError::unauthorized("当前未登录"))?;
    let result = state.client.get_my_profile(&uid).await;
    audit(&ctx, "read", "GET /v1/me", result.is_ok());
    client_result(result)
}

async fn feed_detail(State(ctx): State<Arc<BridgeCtx>>, auth: Auth, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    auth.require(AgentBridgeScope::Read)?;
    let state = ctx.app_state().ok_or_else(|| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "应用状态不可用"))?;
    let result = state.client.get_feed_detail(&id, None, None).await;
    audit(&ctx, "read", "GET /v1/feed/{id}", result.is_ok());
    client_result(result)
}

async fn feed_replies(
    State(ctx): State<Arc<BridgeCtx>>,
    auth: Auth,
    Path(id): Path<String>,
    Query(query): Query<RepliesQuery>,
) -> Result<Json<Value>, ApiError> {
    auth.require(AgentBridgeScope::Read)?;
    let state = ctx.app_state().ok_or_else(|| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "应用状态不可用"))?;
    let page = query.page.unwrap_or(1).max(1);
    let list_type = query.list_type.unwrap_or_else(|| "lastupdate_desc".to_string());
    let result = state.client.get_feed_replies_paged(&id, page, "", "", &list_type, 0).await;
    audit(&ctx, "read", "GET /v1/feed/{id}/replies", result.is_ok());
    client_result(result)
}

async fn user_profile(State(ctx): State<Arc<BridgeCtx>>, auth: Auth, Path(uid): Path<String>) -> Result<Json<Value>, ApiError> {
    auth.require(AgentBridgeScope::Read)?;
    let state = ctx.app_state().ok_or_else(|| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "应用状态不可用"))?;
    let result = match state.client.get_user_profile(&uid).await {
        Ok(value) => Ok(value),
        Err(error) => {
            if state.client.get_user_cookie().is_some() {
                Err(error)
            } else {
                state.client.get_public_user_profile(&uid).await
            }
        }
    };
    audit(&ctx, "read", "GET /v1/user/{uid}", result.is_ok());
    client_result(result)
}

async fn user_feeds(
    State(ctx): State<Arc<BridgeCtx>>,
    auth: Auth,
    Path(uid): Path<String>,
    Query(query): Query<UserFeedsQuery>,
) -> Result<Json<Value>, ApiError> {
    auth.require(AgentBridgeScope::Read)?;
    let state = ctx.app_state().ok_or_else(|| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "应用状态不可用"))?;
    let page = query.page.unwrap_or(1).max(1);
    let feed_type = query.feed_type.unwrap_or_default();
    let result = state.client.get_user_feeds(&uid, page, &feed_type).await;
    audit(&ctx, "read", "GET /v1/user/{uid}/feeds", result.is_ok());
    client_result(result)
}

async fn topic_detail(State(ctx): State<Arc<BridgeCtx>>, auth: Auth, Path(tag): Path<String>) -> Result<Json<Value>, ApiError> {
    auth.require(AgentBridgeScope::Read)?;
    let state = ctx.app_state().ok_or_else(|| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "应用状态不可用"))?;
    let result = state.client.get_topic_detail(&tag).await;
    audit(&ctx, "read", "GET /v1/topic/{tag}", result.is_ok());
    client_result(result)
}

async fn search(
    State(ctx): State<Arc<BridgeCtx>>,
    auth: Auth,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Value>, ApiError> {
    auth.require(AgentBridgeScope::Read)?;
    let state = ctx.app_state().ok_or_else(|| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "应用状态不可用"))?;
    let keyword = query.q.trim();
    if keyword.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "q 不能为空"));
    }
    let page = query.page.unwrap_or(1).max(1);
    let search_type = query.search_type.unwrap_or_else(|| "all".to_string());
    let result = if search_type == "all" || search_type.is_empty() {
        state.client.search_all(keyword, page).await
    } else {
        state
            .client
            .search_by_type(&search_type, keyword, page, "", "", "", "", "", "", 0, "", "")
            .await
    };
    audit(&ctx, "read", "GET /v1/search", result.is_ok());
    client_result(result)
}
