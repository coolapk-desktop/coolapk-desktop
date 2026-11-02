//! 写工具的参数模型与校验。
//!
//! 这里只负责把 MCP / REST 传入的 JSON 变成可信的强类型参数：正文长度、图片数量与
//! 大小、可见范围、幂等 requestId。真正的执行闸门（disabled / dry-run / confirm /
//! auto）在后续任务接入。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use tauri::Emitter;
use tokio::sync::oneshot;

use super::config::{AgentBridgeScope, AgentBridgeWriteMode};
use super::http::{audit_write, ApiError, BridgeCtx};

const MAX_MESSAGE_CHARS: usize = 5000;
const MAX_IMAGES: usize = 4;
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES: [&str; 3] = ["image/jpeg", "image/png", "image/webp"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ImageArg {
    /// 上传用的文件名；已去掉路径分隔符，只保留最后一段。
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PublishArgs {
    pub message: String,
    pub images: Vec<ImageArg>,
    pub visible_status: Option<i32>,
    pub request_id: Option<String>,
}

/// 解析并校验发动态参数；任何不合法输入都在触网前拒绝。
pub(super) fn parse_publish_args(args: &Value) -> Result<PublishArgs, ApiError> {
    let message = args.get("message").and_then(Value::as_str).map(str::trim).unwrap_or_default();
    if message.is_empty() {
        return Err(ApiError::bad_request("动态正文不能为空"));
    }
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(ApiError::bad_request(format!("动态正文不能超过 {MAX_MESSAGE_CHARS} 字")));
    }

    let visible_status = match args.get("visibleStatus") {
        None | Some(Value::Null) => None,
        Some(value) => {
            let status = value
                .as_i64()
                .ok_or_else(|| ApiError::bad_request("visibleStatus 必须是整数"))?;
            if status != 1 && status != -1 {
                return Err(ApiError::bad_request("可见范围只能是 1（公开）或 -1（仅自己）"));
            }
            Some(status as i32)
        }
    };

    Ok(PublishArgs {
        message: message.to_string(),
        images: parse_images(args.get("images"))?,
        visible_status,
        request_id: normalize_request_id(args.get("requestId"))?,
    })
}

/// 供确认弹窗与 dry-run 使用的预览；不包含图片字节内容。
pub(super) fn preview_publish(args: &PublishArgs) -> Value {
    json!({
        "message": args.message,
        "messageChars": args.message.chars().count(),
        "images": args
            .images
            .iter()
            .map(|image| json!({ "name": image.name, "mime": image.mime, "bytes": image.bytes.len() }))
            .collect::<Vec<_>>(),
        "imageCount": args.images.len(),
        "visibleStatus": args.visible_status,
    })
}

/// 图片数量/单张/总量限制，解析前后各检查一次（先按 base64 长度估算，避免超大分配）。
pub(super) fn enforce_image_limits(count: usize, largest: usize, total: usize) -> Result<(), ApiError> {
    if count > MAX_IMAGES {
        return Err(ApiError::bad_request(format!("图片不能超过 {MAX_IMAGES} 张")));
    }
    if largest > MAX_IMAGE_BYTES {
        return Err(ApiError::bad_request("单张图片不能超过 8 MB"));
    }
    if total > MAX_TOTAL_IMAGE_BYTES {
        return Err(ApiError::bad_request("图片总大小不能超过 20 MB"));
    }
    Ok(())
}

fn parse_images(value: Option<&Value>) -> Result<Vec<ImageArg>, ApiError> {
    let Some(value) = value else { return Ok(Vec::new()) };
    let Some(list) = value.as_array() else {
        return Err(ApiError::bad_request("images 必须是数组"));
    };
    if list.len() > MAX_IMAGES {
        return Err(ApiError::bad_request(format!("图片不能超过 {MAX_IMAGES} 张")));
    }

    let mut pending = Vec::with_capacity(list.len());
    let mut estimated = Vec::with_capacity(list.len());
    for item in list {
        let raw = item
            .get("dataBase64")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::bad_request("每张图片都需要 dataBase64"))?;
        let (mime_from_url, payload) = split_data_url(raw);
        let mime = item
            .get("mimeType")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase())
            .or(mime_from_url)
            .ok_or_else(|| ApiError::bad_request("每张图片都需要 mimeType"))?;
        if !ALLOWED_MIME_TYPES.contains(&mime.as_str()) {
            return Err(ApiError::bad_request(format!("不支持的图片格式：{mime}（只接受 JPEG/PNG/WebP）")));
        }
        let cleaned: String = payload.chars().filter(|value| !value.is_whitespace()).collect();
        if cleaned.is_empty() {
            return Err(ApiError::bad_request("图片内容不能为空"));
        }
        estimated.push(cleaned.len() / 4 * 3);
        pending.push((sanitize_name(item.get("name").and_then(Value::as_str).unwrap_or_default(), &mime), mime, cleaned));
    }
    enforce_image_limits(
        pending.len(),
        estimated.iter().copied().max().unwrap_or(0),
        estimated.iter().sum(),
    )?;

    let mut images = Vec::with_capacity(pending.len());
    for (name, mime, payload) in pending {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.as_bytes())
            .map_err(|_| ApiError::bad_request("图片 dataBase64 解码失败"))?;
        images.push(ImageArg { name, mime, bytes });
    }
    enforce_image_limits(
        images.len(),
        images.iter().map(|image| image.bytes.len()).max().unwrap_or(0),
        images.iter().map(|image| image.bytes.len()).sum(),
    )?;
    Ok(images)
}

/// 支持 `data:image/png;base64,<payload>` 形式，也支持裸 base64。
fn split_data_url(raw: &str) -> (Option<String>, &str) {
    let raw = raw.trim();
    if let Some(rest) = raw.strip_prefix("data:") {
        if let Some((meta, payload)) = rest.split_once(',') {
            if meta.to_ascii_lowercase().contains(";base64") {
                let mime = meta.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
                let mime = (!mime.is_empty()).then_some(mime);
                return (mime, payload);
            }
        }
    }
    (None, raw)
}

fn sanitize_name(raw: &str, mime: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or_default().trim();
    let cleaned: String = base.chars().filter(|value| !value.is_control()).collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return match mime {
            "image/png" => "image.png".to_string(),
            "image/webp" => "image.webp".to_string(),
            _ => "image.jpg".to_string(),
        };
    }
    cleaned.to_string()
}

/// 一次写调用的强类型描述。
pub(super) enum WriteCall {
    Publish(PublishArgs),
    LikeFeed { feed_id: String, unlike: bool },
    FollowUser { uid: String, unfollow: bool },
}

impl WriteCall {
    pub(super) fn tool(&self) -> &'static str {
        match self {
            Self::Publish(_) => "coolapk_publish_feed",
            Self::LikeFeed { unlike: false, .. } => "coolapk_like_feed",
            Self::LikeFeed { unlike: true, .. } => "coolapk_unlike_feed",
            Self::FollowUser { unfollow: false, .. } => "coolapk_follow_user",
            Self::FollowUser { unfollow: true, .. } => "coolapk_unfollow_user",
        }
    }

    pub(super) fn scope(&self) -> &'static str {
        match self {
            Self::Publish(_) => AgentBridgeScope::WritePublish.as_str(),
            Self::LikeFeed { .. } | Self::FollowUser { .. } => AgentBridgeScope::WriteInteract.as_str(),
        }
    }

    fn required_scope(&self) -> AgentBridgeScope {
        match self {
            Self::Publish(_) => AgentBridgeScope::WritePublish,
            Self::LikeFeed { .. } | Self::FollowUser { .. } => AgentBridgeScope::WriteInteract,
        }
    }

    fn request_id(&self) -> Option<&str> {
        match self {
            Self::Publish(args) => args.request_id.as_deref(),
            _ => None,
        }
    }

    fn preview(&self) -> Value {
        match self {
            Self::Publish(args) => preview_publish(args),
            Self::LikeFeed { feed_id, unlike } => {
                json!({ "feedId": feed_id, "action": if *unlike { "unlike" } else { "like" } })
            }
            Self::FollowUser { uid, unfollow } => {
                json!({ "uid": uid, "action": if *unfollow { "unfollow" } else { "follow" } })
            }
        }
    }

    fn summary(&self) -> String {
        match self {
            Self::Publish(args) => {
                format!("发布动态：{} 字、{} 张图片", args.message.chars().count(), args.images.len())
            }
            Self::LikeFeed { feed_id, unlike } => {
                format!("{}动态 {feed_id}", if *unlike { "取消点赞" } else { "点赞" })
            }
            Self::FollowUser { uid, unfollow } => {
                format!("{}用户 {uid}", if *unfollow { "取消关注" } else { "关注" })
            }
        }
    }

    /// 审计细节：只记录长度/数量与目标，不落正文和图片内容。
    fn audit_details(&self) -> Value {
        match self {
            Self::Publish(args) => json!({
                "messageChars": args.message.chars().count(),
                "imageCount": args.images.len(),
                "target": Value::Null,
            }),
            Self::LikeFeed { feed_id, .. } => json!({ "target": feed_id }),
            Self::FollowUser { uid, .. } => json!({ "target": uid }),
        }
    }
}

const CONFIRM_TIMEOUT_SEC: u64 = 60;

/// 确认超时；debug 构建可用环境变量缩短，便于无头 e2e 验证「拒绝/超时」路径。
fn confirm_timeout() -> Duration {
    #[cfg(debug_assertions)]
    if let Ok(raw) = std::env::var("COOLAPK_AGENT_BRIDGE_CONFIRM_TIMEOUT") {
        if let Ok(seconds) = raw.trim().parse::<u64>() {
            if seconds > 0 {
                return Duration::from_secs(seconds);
            }
        }
    }
    Duration::from_secs(CONFIRM_TIMEOUT_SEC)
}

fn confirmation_id() -> Result<String, ApiError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| ApiError::internal("无法生成确认 id"))?;
    Ok(hex::encode(bytes))
}

fn account_uid(ctx: &BridgeCtx) -> Option<String> {
    ctx.app_state().and_then(|state| state.client.current_uid())
}

/// 写闸门：disabled 拒绝、dry-run 预览、confirm 应用内确认、auto 直接提交。
pub(super) async fn execute(ctx: &BridgeCtx, call: WriteCall) -> Result<Value, ApiError> {
    let (mode, granted) = {
        let config = ctx
            .config
            .read()
            .map_err(|_| ApiError::unauthorized("Agent 接口状态异常"))?;
        (config.write_mode, config.scope_set())
    };
    if !granted.contains(&call.required_scope()) {
        let mut details = call.audit_details();
        details["error"] = json!("missing_scope");
        audit_write(ctx, call.tool(), call.scope(), false, details);
        return Err(ApiError::forbidden(format!("缺少授权范围：{}", call.scope())));
    }

    let preview = call.preview();
    match mode {
        AgentBridgeWriteMode::Disabled => {
            let mut details = call.audit_details();
            details["dryRun"] = json!(false);
            details["error"] = json!("write_disabled");
            audit_write(ctx, call.tool(), call.scope(), false, details);
            return Err(ApiError::write_disabled());
        }
        AgentBridgeWriteMode::DryRun => {
            let mut details = call.audit_details();
            details["dryRun"] = json!(true);
            audit_write(ctx, call.tool(), call.scope(), true, details);
            return Ok(json!({ "dryRun": true, "preview": preview }));
        }
        AgentBridgeWriteMode::Confirm => {
            let (Some(app), Some(broker)) = (ctx.app.clone(), ctx.confirm.clone()) else {
                return Err(ApiError::write_not_implemented());
            };
            let id = confirmation_id()?;
            let timeout = confirm_timeout();
            let payload = json!({
                "id": id,
                "tool": call.tool(),
                "scope": call.scope(),
                "summary": call.summary(),
                "preview": preview,
                "expiresInSec": timeout.as_secs(),
            });
            let approved = broker
                .request(&id, timeout, || {
                    let _ = app.emit("agent-bridge:write-confirm", payload);
                })
                .await;
            if !approved {
                let mut details = call.audit_details();
                details["dryRun"] = json!(false);
                details["error"] = json!("write_confirm_denied");
                audit_write(ctx, call.tool(), call.scope(), false, details);
                return Err(ApiError::write_confirm_denied());
            }
        }
        AgentBridgeWriteMode::Auto => {}
    }

    let dedupe_key = call
        .request_id()
        .map(|request_id| WriteDedupe::key(call.tool(), account_uid(ctx).as_deref(), request_id));
    if let (Some(dedupe), Some(key)) = (ctx.dedupe.as_ref(), dedupe_key.as_ref()) {
        if let Some(cached) = dedupe.get(key) {
            let mut details = call.audit_details();
            details["dryRun"] = json!(false);
            details["deduplicated"] = json!(true);
            audit_write(ctx, call.tool(), call.scope(), true, details);
            return Ok(json!({ "dryRun": false, "deduplicated": true, "data": cached }));
        }
    }

    match run(ctx, &call).await {
        Ok(value) => {
            if let (Some(dedupe), Some(key)) = (ctx.dedupe.as_ref(), dedupe_key) {
                dedupe.store(key, &value);
            }
            let mut details = call.audit_details();
            details["dryRun"] = json!(false);
            audit_write(ctx, call.tool(), call.scope(), true, details);
            Ok(json!({ "dryRun": false, "deduplicated": false, "data": value }))
        }
        Err(error) => {
            let mut details = call.audit_details();
            details["dryRun"] = json!(false);
            details["error"] = json!(error.error_code().unwrap_or("write_failed"));
            audit_write(ctx, call.tool(), call.scope(), false, details);
            Err(error)
        }
    }
}

async fn run(ctx: &BridgeCtx, call: &WriteCall) -> Result<Value, ApiError> {
    let state = || ctx.app_state().ok_or_else(ApiError::service_unavailable);
    let result = match call {
        // 发帖的执行（含图片上传）在后续任务接入，这里先明确拒绝而不是假装成功。
        WriteCall::Publish(_) => return Err(ApiError::write_not_implemented()),
        WriteCall::LikeFeed { feed_id, unlike: false } => state()?.client.like_feed(feed_id).await,
        WriteCall::LikeFeed { feed_id, unlike: true } => state()?.client.unlike_feed(feed_id).await,
        WriteCall::FollowUser { uid, unfollow: false } => state()?.client.follow_user(uid).await,
        WriteCall::FollowUser { uid, unfollow: true } => state()?.client.unfollow_user(uid).await,
    };
    result.map_err(ApiError::from_client_error)
}

/// confirm 模式的一次性确认通道：同一时刻只保留一个待确认请求。
///
/// 应用窗口最小化/隐藏时不会自动抢焦点，超时即按拒绝处理；迟到的结果会被忽略。
#[derive(Default)]
pub(super) struct ConfirmBroker {
    pending: Mutex<Option<PendingConfirm>>,
}

struct PendingConfirm {
    id: String,
    tx: oneshot::Sender<bool>,
}

impl ConfirmBroker {
    /// 注册请求并触发 `emit`，等待用户结果；超时、通道关闭或请求被新请求替换都返回 false。
    pub(super) async fn request<F>(&self, id: &str, timeout: Duration, emit: F) -> bool
    where
        F: FnOnce(),
    {
        let (tx, rx) = oneshot::channel();
        {
            let Ok(mut pending) = self.pending.lock() else {
                return false;
            };
            if let Some(previous) = pending.take() {
                let _ = previous.tx.send(false);
            }
            *pending = Some(PendingConfirm { id: id.to_string(), tx });
        }
        emit();
        let approved = tokio::time::timeout(timeout, rx)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(false);
        if let Ok(mut pending) = self.pending.lock() {
            if pending.as_ref().is_some_and(|item| item.id == id) {
                pending.take();
            }
        }
        approved
    }

    /// 由前端回传确认结果；返回 false 表示请求已超时/已结束或 id 不匹配。
    pub(super) fn resolve(&self, id: &str, approved: bool) -> bool {
        let Ok(mut pending) = self.pending.lock() else {
            return false;
        };
        let matches = pending.as_ref().is_some_and(|item| item.id == id);
        if !matches {
            return false;
        }
        if let Some(item) = pending.take() {
            let _ = item.tx.send(approved);
        }
        true
    }
}

/// 写操作的幂等缓存：同一 `tool + account + requestId` 在 TTL 内复用上次成功结果。
///
/// 没有 `requestId` 时不参与去重（客户端重试会造成重复内容，由文档提示）。
#[derive(Default)]
pub(super) struct WriteDedupe {
    ttl: Duration,
    entries: Mutex<HashMap<String, CachedWrite>>,
}

struct CachedWrite {
    at: Instant,
    value: Value,
}

const DEDUPE_TTL: Duration = Duration::from_secs(300);

impl WriteDedupe {
    pub(super) fn new() -> Self {
        Self::with_ttl(DEDUPE_TTL)
    }

    pub(super) fn with_ttl(ttl: Duration) -> Self {
        Self { ttl, entries: Mutex::new(HashMap::new()) }
    }

    /// 幂等键：用单元分隔符拼接，避免工具名/账号/requestId 相互污染。
    pub(super) fn key(tool: &str, account: Option<&str>, request_id: &str) -> String {
        format!("{tool}\u{1f}{}\u{1f}{request_id}", account.unwrap_or_default())
    }

    pub(super) fn get(&self, key: &str) -> Option<Value> {
        let now = Instant::now();
        let mut entries = self.entries.lock().ok()?;
        Self::prune(&mut entries, now, self.ttl);
        entries.get(key).map(|entry| entry.value.clone())
    }

    pub(super) fn store(&self, key: String, value: &Value) {
        let now = Instant::now();
        let Ok(mut entries) = self.entries.lock() else { return };
        Self::prune(&mut entries, now, self.ttl);
        entries.insert(key, CachedWrite { at: now, value: value.clone() });
    }

    fn prune(entries: &mut HashMap<String, CachedWrite>, now: Instant, ttl: Duration) {
        entries.retain(|_, entry| now.duration_since(entry.at) < ttl);
    }
}

fn normalize_request_id(value: Option<&Value>) -> Result<Option<String>, ApiError> {
    let Some(value) = value else { return Ok(None) };
    let Some(raw) = value.as_str() else {
        return Err(ApiError::bad_request("requestId 必须是字符串"));
    };
    let id = raw.trim();
    if id.is_empty() {
        return Ok(None);
    }
    if id.chars().count() > 128 || id.chars().any(char::is_control) {
        return Err(ApiError::bad_request("requestId 无效"));
    }
    Ok(Some(id.to_string()))
}
