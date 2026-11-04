//! 写工具的参数模型、校验与执行。
//!
//! 这里负责把 MCP / REST 传入的 JSON 变成可信的强类型参数（正文长度、图片数量与
//! 大小、可见范围、板块、幂等 requestId），再经过写闸门（disabled / dry-run /
//! confirm / auto）执行：发帖按官方 App 的顺序先上传图片再提交 createFeed。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use tauri::Emitter;
use tokio::sync::oneshot;

use crate::coolapk::client::{CoolapkClient, PublishOptions};

use super::config::{AgentBridgeScope, AgentBridgeWriteMode};
use super::http::{audit_write, ApiError, BridgeCtx};

const MAX_MESSAGE_CHARS: usize = 5000;
const MAX_REPLY_CHARS: usize = 1000;
/// 与官方 App / PublishDialog.vue 的 MAX_IMAGES=9 对齐。
const MAX_IMAGES: usize = 9;
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

/// 本机图片路径：只在执行阶段读盘，避免把大文件塞进 MCP 请求体。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ImagePath {
    pub path: PathBuf,
    pub name: String,
    pub mime: String,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub(super) struct PublishArgs {
    pub message: String,
    pub images: Vec<ImageArg>,
    pub image_paths: Vec<ImagePath>,
    /// 官方 createFeed 的扩展表单选项，直接透传给 create_feed_with_options。
    pub options: PublishOptions,
    pub visible_status: Option<i32>,
    pub request_id: Option<String>,
}

impl PublishArgs {
    fn image_count(&self) -> usize {
        self.images.len() + self.image_paths.len()
    }
}

/// 解析并校验发动态参数；任何不合法输入都在触网前拒绝。
pub(super) fn parse_publish_args(args: &Value) -> Result<PublishArgs, ApiError> {
    let message = args.get("message").and_then(Value::as_str).map(str::trim).unwrap_or_default().to_string();
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(ApiError::bad_request(format!("动态正文不能超过 {MAX_MESSAGE_CHARS} 字")));
    }

    let mut options = parse_publish_options(args.get("options"))?;
    let visible_status = match args.get("visibleStatus") {
        None | Some(Value::Null) => options.visible_status,
        Some(value) => Some(parse_visible_status(value)?),
    };
    // 顶层 visibleStatus 与 options.visibleStatus 合并成一份，交给 create_feed_with_options。
    options.visible_status = visible_status;

    let (images, image_paths) = parse_image_set(args)?;
    // 官方 App 允许纯图片动态（PublishDialog 的 canPublish），这里保持一致。
    if message.is_empty() && images.is_empty() && image_paths.is_empty() {
        return Err(ApiError::bad_request("动态正文或图片至少要有一项"));
    }
    Ok(PublishArgs {
        message,
        images,
        image_paths,
        options,
        visible_status,
        request_id: normalize_request_id(args.get("requestId"))?,
    })
}

fn parse_visible_status(value: &Value) -> Result<i32, ApiError> {
    let status = value.as_i64().ok_or_else(|| ApiError::bad_request("visibleStatus 必须是整数"))?;
    if status != 1 && status != -1 {
        return Err(ApiError::bad_request("可见范围只能是 1（公开）或 -1（仅自己）"));
    }
    Ok(status as i32)
}

/// 发布板块、图文、视频等官方表单选项；未知字段直接拒绝，避免拼错参数后静默发到错误板块。
fn parse_publish_options(value: Option<&Value>) -> Result<PublishOptions, ApiError> {
    let Some(value) = value.filter(|value| !value.is_null()) else { return Ok(PublishOptions::default()) };
    if !value.is_object() {
        return Err(ApiError::bad_request("options 必须是对象"));
    }
    let options: PublishOptions = serde_json::from_value(value.clone())
        .map_err(|error| ApiError::bad_request(format!("options 参数无效：{error}")))?;
    if let Some(status) = options.visible_status {
        parse_visible_status(&json!(status))?;
    }
    Ok(options)
}

/// 本机图片路径：平板端 agent 传路径，由应用自己读盘上传，避免 base64 撑爆请求体。
fn parse_image_paths(value: Option<&Value>) -> Result<Vec<ImagePath>, ApiError> {
    let Some(value) = value.filter(|value| !value.is_null()) else { return Ok(Vec::new()) };
    let Some(list) = value.as_array() else {
        return Err(ApiError::bad_request("imagePaths 必须是字符串数组"));
    };
    let mut paths = Vec::with_capacity(list.len());
    for item in list {
        let raw = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ApiError::bad_request("imagePaths 每项都必须是非空路径字符串"))?;
        let path = PathBuf::from(raw);
        if !path.is_absolute() {
            return Err(ApiError::bad_request(format!("imagePaths 必须是绝对路径：{raw}")));
        }
        let mime = path_mime(&path)
            .ok_or_else(|| ApiError::bad_request(format!("不支持的图片格式：{raw}（只接受 JPEG/PNG/WebP）")))?;
        let metadata = std::fs::metadata(&path)
            .map_err(|error| ApiError::bad_request(format!("无法读取图片 {raw}：{error}")))?;
        if !metadata.is_file() {
            return Err(ApiError::bad_request(format!("不是普通文件：{raw}")));
        }
        let name = sanitize_name(path.file_name().and_then(|value| value.to_str()).unwrap_or_default(), mime);
        paths.push(ImagePath { path, name, mime: mime.to_string(), size: metadata.len() });
    }
    Ok(paths)
}

fn path_mime(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// 供确认弹窗与 dry-run 使用的预览；不包含图片字节内容。
pub(super) fn preview_publish(args: &PublishArgs) -> Value {
    let mut images: Vec<Value> = args
        .images
        .iter()
        .map(|image| json!({ "source": "base64", "name": image.name, "mime": image.mime, "bytes": image.bytes.len() }))
        .collect();
    images.extend(args.image_paths.iter().map(|image| {
        json!({
            "source": "path",
            "path": image.path.display().to_string(),
            "name": image.name,
            "mime": image.mime,
            "bytes": image.size,
        })
    }));
    json!({
        "message": args.message,
        "messageChars": args.message.chars().count(),
        "images": images,
        "imageCount": args.image_count(),
        "visibleStatus": args.visible_status,
        "options": serde_json::to_value(&args.options).unwrap_or(Value::Null),
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

/// 评论 / 楼中楼回复的参数（图片走同一套上传与限制）。
#[derive(Debug, Clone)]
pub(super) struct ReplyArgs {
    pub feed_id: String,
    pub message: String,
    /// 楼中楼时为目标评论 id；此时 feed_id 仍是该评论所属动态 id。
    pub rid: Option<String>,
    pub images: Vec<ImageArg>,
    pub image_paths: Vec<ImagePath>,
    pub request_id: Option<String>,
}

/// 转发动态的参数：评语与图片都可选。
#[derive(Debug, Clone)]
pub(super) struct ForwardArgs {
    pub feed_id: String,
    pub message: String,
    pub images: Vec<ImageArg>,
    pub image_paths: Vec<ImagePath>,
    pub request_id: Option<String>,
}

fn trimmed_arg<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).map(str::trim).unwrap_or_default()
}

/// 动态/评论 ID 会直接拼进 URL query，只接受字母数字，避免参数被注入。
fn target_id_arg(args: &Value, key: &str, label: &str) -> Result<String, ApiError> {
    let raw = trimmed_arg(args, key);
    if raw.is_empty() {
        return Err(ApiError::bad_request(format!("缺少参数 {key}（{label}）")));
    }
    if raw.len() > 64 || !raw.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err(ApiError::bad_request(format!("{key} 不是合法的 ID：{raw}")));
    }
    Ok(raw.to_string())
}

fn optional_id_arg(args: &Value, key: &str) -> Result<Option<String>, ApiError> {
    if args.get(key).is_none_or(Value::is_null) {
        return Ok(None);
    }
    Ok(Some(target_id_arg(args, key, key)?))
}

/// 解析并统一校验一组图片（base64 与本地路径），数量/体积限制与发帖一致。
fn parse_image_set(args: &Value) -> Result<(Vec<ImageArg>, Vec<ImagePath>), ApiError> {
    let images = parse_images(args.get("images"))?;
    let image_paths = parse_image_paths(args.get("imagePaths"))?;
    let base64_bytes = || images.iter().map(|image| image.bytes.len());
    enforce_image_limits(
        images.len() + image_paths.len(),
        base64_bytes().chain(image_paths.iter().map(|image| image.size as usize)).max().unwrap_or(0),
        base64_bytes().sum::<usize>() + image_paths.iter().map(|image| image.size as usize).sum::<usize>(),
    )?;
    Ok((images, image_paths))
}

fn image_total(images: &[ImageArg], image_paths: &[ImagePath]) -> usize {
    images.len() + image_paths.len()
}

/// 评论参数：正文或图片至少一项；带 rid 表示楼中楼回复。
pub(super) fn parse_reply_args(args: &Value) -> Result<ReplyArgs, ApiError> {
    let feed_id = target_id_arg(args, "feedId", "动态 ID")?;
    let message = trimmed_arg(args, "message").to_string();
    if message.chars().count() > MAX_REPLY_CHARS {
        return Err(ApiError::bad_request(format!("评论正文不能超过 {MAX_REPLY_CHARS} 字")));
    }
    let rid = optional_id_arg(args, "rid")?;
    let (images, image_paths) = parse_image_set(args)?;
    if message.is_empty() && images.is_empty() && image_paths.is_empty() {
        return Err(ApiError::bad_request("评论正文或图片至少要有一项"));
    }
    Ok(ReplyArgs {
        feed_id,
        message,
        rid,
        images,
        image_paths,
        request_id: normalize_request_id(args.get("requestId"))?,
    })
}

/// 转发参数：评语与图片都可选（只转发原动态也合法）。
pub(super) fn parse_forward_args(args: &Value) -> Result<ForwardArgs, ApiError> {
    let feed_id = target_id_arg(args, "feedId", "动态 ID")?;
    let message = trimmed_arg(args, "message").to_string();
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(ApiError::bad_request(format!("转发评语不能超过 {MAX_MESSAGE_CHARS} 字")));
    }
    let (images, image_paths) = parse_image_set(args)?;
    Ok(ForwardArgs {
        feed_id,
        message,
        images,
        image_paths,
        request_id: normalize_request_id(args.get("requestId"))?,
    })
}

/// 一次写调用的强类型描述。
pub(super) enum WriteCall {
    Publish(PublishArgs),
    Reply(ReplyArgs),
    Forward(ForwardArgs),
    DeleteFeed { feed_id: String },
    FavoriteFeed { feed_id: String, favorite: bool },
    LikeFeed { feed_id: String, unlike: bool },
    FollowUser { uid: String, unfollow: bool },
}

impl WriteCall {
    pub(super) fn tool(&self) -> &'static str {
        match self {
            Self::Publish(_) => "coolapk_publish_feed",
            Self::Reply(_) => "coolapk_reply_feed",
            Self::Forward(_) => "coolapk_forward_feed",
            Self::DeleteFeed { .. } => "coolapk_delete_feed",
            Self::FavoriteFeed { favorite: true, .. } => "coolapk_favorite_feed",
            Self::FavoriteFeed { favorite: false, .. } => "coolapk_unfavorite_feed",
            Self::LikeFeed { unlike: false, .. } => "coolapk_like_feed",
            Self::LikeFeed { unlike: true, .. } => "coolapk_unlike_feed",
            Self::FollowUser { unfollow: false, .. } => "coolapk_follow_user",
            Self::FollowUser { unfollow: true, .. } => "coolapk_unfollow_user",
        }
    }

    pub(super) fn scope(&self) -> &'static str {
        match self {
            // 发布与删除都算「内容管理」，共用 write.publish 授权与限流桶。
            Self::Publish(_) | Self::DeleteFeed { .. } => AgentBridgeScope::WritePublish.as_str(),
            _ => AgentBridgeScope::WriteInteract.as_str(),
        }
    }

    fn required_scope(&self) -> AgentBridgeScope {
        match self {
            Self::Publish(_) | Self::DeleteFeed { .. } => AgentBridgeScope::WritePublish,
            _ => AgentBridgeScope::WriteInteract,
        }
    }

    fn request_id(&self) -> Option<&str> {
        match self {
            Self::Publish(args) => args.request_id.as_deref(),
            Self::Reply(args) => args.request_id.as_deref(),
            Self::Forward(args) => args.request_id.as_deref(),
            _ => None,
        }
    }

    pub(super) fn preview(&self) -> Value {
        match self {
            Self::Publish(args) => preview_publish(args),
            Self::Reply(args) => json!({
                "feedId": args.feed_id,
                "rid": args.rid,
                "messageChars": args.message.chars().count(),
                "imageCount": image_total(&args.images, &args.image_paths),
            }),
            Self::Forward(args) => json!({
                "feedId": args.feed_id,
                "messageChars": args.message.chars().count(),
                "imageCount": image_total(&args.images, &args.image_paths),
            }),
            Self::DeleteFeed { feed_id } => json!({ "feedId": feed_id, "action": "delete" }),
            Self::FavoriteFeed { feed_id, favorite } => json!({
                "feedId": feed_id,
                "action": if *favorite { "favorite" } else { "unfavorite" },
            }),
            Self::LikeFeed { feed_id, unlike } => {
                json!({ "feedId": feed_id, "action": if *unlike { "unlike" } else { "like" } })
            }
            Self::FollowUser { uid, unfollow } => {
                json!({ "uid": uid, "action": if *unfollow { "unfollow" } else { "follow" } })
            }
        }
    }

    pub(super) fn summary(&self) -> String {
        match self {
            Self::Publish(args) => {
                let mut summary =
                    format!("发布动态：{} 字、{} 张图片", args.message.chars().count(), args.image_count());
                if let Some(target) = args.options.target_id.as_deref() {
                    summary.push_str(&format!(
                        "、板块 {} {}",
                        args.options.target_type.as_deref().unwrap_or(""),
                        target
                    ));
                }
                summary
            }
            Self::Reply(args) => format!(
                "{}动态 {}：{} 字、{} 张图片",
                if args.rid.is_some() { "回复评论" } else { "评论" },
                args.feed_id,
                args.message.chars().count(),
                image_total(&args.images, &args.image_paths)
            ),
            Self::Forward(args) => format!(
                "转发动态 {}：{} 字、{} 张图片",
                args.feed_id,
                args.message.chars().count(),
                image_total(&args.images, &args.image_paths)
            ),
            Self::DeleteFeed { feed_id } => format!("删除动态 {feed_id}"),
            Self::FavoriteFeed { feed_id, favorite } => format!(
                "{}动态 {feed_id}",
                if *favorite { "收藏" } else { "取消收藏" }
            ),
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
                "imageCount": args.image_count(),
                "target": args.options.target_id,
            }),
            Self::Reply(args) => json!({
                "messageChars": args.message.chars().count(),
                "imageCount": image_total(&args.images, &args.image_paths),
                "target": args.feed_id,
            }),
            Self::Forward(args) => json!({
                "messageChars": args.message.chars().count(),
                "imageCount": image_total(&args.images, &args.image_paths),
                "target": args.feed_id,
            }),
            Self::DeleteFeed { feed_id } => json!({ "target": feed_id }),
            Self::FavoriteFeed { feed_id, .. } => json!({ "target": feed_id }),
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
        WriteCall::Publish(args) => return publish(ctx, args).await,
        WriteCall::Reply(args) => return reply(ctx, args).await,
        WriteCall::Forward(args) => return forward(ctx, args).await,
        WriteCall::DeleteFeed { feed_id } => state()?.client.delete_feed(feed_id).await,
        WriteCall::FavoriteFeed { feed_id, favorite: true } => state()?.client.favorite_feed(feed_id).await,
        WriteCall::FavoriteFeed { feed_id, favorite: false } => state()?.client.unfavorite_feed(feed_id).await,
        WriteCall::LikeFeed { feed_id, unlike: false } => state()?.client.like_feed(feed_id).await,
        WriteCall::LikeFeed { feed_id, unlike: true } => state()?.client.unlike_feed(feed_id).await,
        WriteCall::FollowUser { uid, unfollow: false } => state()?.client.follow_user(uid).await,
        WriteCall::FollowUser { uid, unfollow: true } => state()?.client.unfollow_user(uid).await,
    };
    result.map_err(ApiError::from_client_error)
}

/// 发帖：按官方 App 的顺序先逐张上传取地址，再逗号拼 pic 提交 createFeed。
///
/// 网易易盾 _v2_post_token 需要应用内人工验证，服务端并不强制携带；若服务端返回
/// captcha_required，ApiError 会透出 428，让用户在应用内完成验证后再重试。
async fn publish(ctx: &BridgeCtx, args: &PublishArgs) -> Result<Value, ApiError> {
    let state = ctx.app_state().ok_or_else(ApiError::service_unavailable)?;
    let client = &state.client;
    let urls = upload_all_images(client, &args.images, &args.image_paths).await?;
    let pic = (!urls.is_empty()).then(|| urls.join(","));
    let wrapped = client
        .create_feed_with_options(&args.message, pic.as_deref(), None, Some(&args.options))
        .await
        .map_err(ApiError::from_client_error)?;
    // createFeed 的返回会套多层 {code,data} 信封，这里直接给调用方一份扁平结果。
    let feed = extract_feed(&wrapped).unwrap_or(wrapped);
    let feed_id = feed.get("id").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "code": 200,
        "data": {
            "feedId": feed_id,
            "feed": feed,
            "imageUrls": urls,
            "messageChars": args.message.chars().count(),
        }
    }))
}

/// 官方 createFeed 的响应可能被包裹多层 data/code 信封，按内容定位真正的动态实体。
pub(super) fn extract_feed(value: &Value) -> Option<Value> {
    if let Some(object) = value.as_object() {
        let is_feed = object.contains_key("entityTemplate")
            || (object.contains_key("id") && object.contains_key("feedType"));
        if is_feed {
            return Some(value.clone());
        }
        for key in ["data", "feed", "entity", "entities"] {
            if let Some(inner) = object.get(key) {
                if let Some(found) = extract_feed(inner) {
                    return Some(found);
                }
            }
        }
        for inner in object.values() {
            if let Some(found) = extract_feed(inner) {
                return Some(found);
            }
        }
        return None;
    }
    value.as_array().into_iter().flatten().find_map(extract_feed)
}

/// 评论：图片按发帖的方式上传后拼 pic，再走官方 /v6/feed/reply。
async fn reply(ctx: &BridgeCtx, args: &ReplyArgs) -> Result<Value, ApiError> {
    let state = ctx.app_state().ok_or_else(ApiError::service_unavailable)?;
    let client = &state.client;
    let urls = upload_all_images(client, &args.images, &args.image_paths).await?;
    let pic = urls.join(",");
    client
        .reply_feed(
            &args.feed_id,
            &args.message,
            args.rid.as_deref(),
            (!pic.is_empty()).then_some(pic.as_str()),
            None,
        )
        .await
        .map_err(ApiError::from_client_error)
}

/// 转发：评语与图片都可选，官方用 createFeed 的 forwardid 表单字段。
async fn forward(ctx: &BridgeCtx, args: &ForwardArgs) -> Result<Value, ApiError> {
    let state = ctx.app_state().ok_or_else(ApiError::service_unavailable)?;
    let client = &state.client;
    let urls = upload_all_images(client, &args.images, &args.image_paths).await?;
    let pic = urls.join(",");
    client
        .create_forward(&args.feed_id, &args.message, (!pic.is_empty()).then_some(pic.as_str()))
        .await
        .map_err(ApiError::from_client_error)
}

/// 逐张上传图片并返回地址列表（发帖 / 评论 / 转发共用）。
async fn upload_all_images(
    client: &CoolapkClient,
    images: &[ImageArg],
    image_paths: &[ImagePath],
) -> Result<Vec<String>, ApiError> {
    let mut urls: Vec<String> = Vec::with_capacity(image_total(images, image_paths));
    for image in images {
        urls.push(upload_publish_image(client, &image.name, &image.mime, &image.bytes).await?);
    }
    for image in image_paths {
        let bytes = tokio::fs::read(&image.path).await.map_err(|error| {
            ApiError::bad_request(format!("无法读取图片 {}：{error}", image.path.display()))
        })?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(ApiError::bad_request(format!(
                "单张图片不能超过 8 MB（{}）",
                image.path.display()
            )));
        }
        urls.push(upload_publish_image(client, &image.name, &image.mime, &bytes).await?);
    }
    Ok(urls)
}

/// 单张图片上传，返回可提交给 createFeed 的图片地址（与官方 App / PublishDialog 一致）。
async fn upload_publish_image(
    client: &CoolapkClient,
    name: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<String, ApiError> {
    // 发动态配图固定走官方 image/feed 目录。
    let response = client
        .upload_image(bytes, name, mime, "feed", None)
        .await
        .map_err(ApiError::from_client_error)?;
    let data = response.get("data").unwrap_or(&response);
    resolve_uploaded_url(data).ok_or_else(|| ApiError::internal("图片上传成功但未返回图片地址"))
}

/// upload_image 会包装成 { code, data }，其中 data 可能是地址字符串（当前实现），
/// 也可能是带 url/pic/path 字段的对象；两种都按官方 App 的取法归一化。
pub(super) fn resolve_uploaded_url(data: &Value) -> Option<String> {
    if let Some(raw) = data.as_str() {
        return normalize_image_url(raw.trim());
    }
    let raw = ["url", "pic", "path", "filename"]
        .iter()
        .filter_map(|key| data.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())?;
    normalize_image_url(raw)
}

fn normalize_image_url(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }
    if let Some(rest) = raw.strip_prefix("//") {
        return Some(format!("https://{rest}"));
    }
    if let Some(rest) = raw.strip_prefix('/') {
        return Some(format!("https://image.coolapk.com/{rest}"));
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Some(raw.to_string());
    }
    // 只有残缺文件名时不拼地址：宁可报错，也不要发布成一堆坏图。
    None
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
