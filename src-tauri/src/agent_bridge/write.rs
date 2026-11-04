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
const MAX_TAG_CHARS: usize = 64;
const MAX_PACKAGE_NAME_CHARS: usize = 128;
const MAX_COLLECTION_TITLE_CHARS: usize = 60;
const MAX_COLLECTION_DESCRIPTION_CHARS: usize = 200;
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
    if !valid_id(raw) {
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

/// 编辑自己已发布动态的参数；图片集合以本次传入为准，未传时默认沿用原动态配图。
#[derive(Debug, Clone)]
pub(super) struct UpdateFeedArgs {
    pub feed_id: String,
    pub message: String,
    pub images: Vec<ImageArg>,
    pub image_paths: Vec<ImagePath>,
    pub options: PublishOptions,
    pub clear_images: bool,
    pub request_id: Option<String>,
}

pub(super) fn parse_update_feed_args(args: &Value) -> Result<UpdateFeedArgs, ApiError> {
    let feed_id = target_id_arg(args, "feedId", "动态 ID")?;
    let message = trimmed_arg(args, "message").to_string();
    if message.is_empty() {
        return Err(ApiError::bad_request("编辑后的正文不能为空"));
    }
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(ApiError::bad_request(format!("动态正文不能超过 {MAX_MESSAGE_CHARS} 字")));
    }
    let options = parse_publish_options(args.get("options"))?;
    // 先判互斥再读图，避免为了报冲突去碰不存在的路径。
    let clear_images = args.get("clearImages").and_then(Value::as_bool).unwrap_or(false);
    if clear_images && (args.get("images").is_some() || args.get("imagePaths").is_some()) {
        return Err(ApiError::bad_request("clearImages 不能与 images/imagePaths 同时使用"));
    }
    let (images, image_paths) = parse_image_set(args)?;
    Ok(UpdateFeedArgs {
        feed_id,
        message,
        images,
        image_paths,
        options,
        clear_images,
        request_id: normalize_request_id(args.get("requestId"))?,
    })
}

/// 通用 ID 参数解析（收藏单条目、评论等）。
pub(super) fn parse_id_arg(args: &Value, key: &str, label: &str) -> Result<String, ApiError> {
    target_id_arg(args, key, label)
}

/// 评论 id（点赞/删除评论用）。
pub(super) fn parse_reply_id(args: &Value) -> Result<String, ApiError> {
    target_id_arg(args, "replyId", "评论 ID")
}

/// 话题名允许中文，去掉官方写法里的 # 包裹。
pub(super) fn parse_topic_tag(args: &Value) -> Result<String, ApiError> {
    let raw = trimmed_arg(args, "tag");
    let tag = raw.trim_matches('#').trim();
    if tag.is_empty() {
        return Err(ApiError::bad_request("缺少参数 tag（话题名）"));
    }
    if tag.chars().count() > MAX_TAG_CHARS {
        return Err(ApiError::bad_request("话题名过长"));
    }
    if tag.chars().any(char::is_control) {
        return Err(ApiError::bad_request("话题名包含非法字符"));
    }
    Ok(tag.to_string())
}

/// 私信参数（uid + 正文）。
pub(super) fn parse_message_args(args: &Value) -> Result<(String, String), ApiError> {
    let uid = target_id_arg(args, "uid", "用户 uid")?;
    let message = trimmed_arg(args, "message").to_string();
    if message.is_empty() {
        return Err(ApiError::bad_request("私信内容不能为空"));
    }
    if message.chars().count() > MAX_REPLY_CHARS {
        return Err(ApiError::bad_request(format!("私信内容不能超过 {MAX_REPLY_CHARS} 字")));
    }
    Ok((uid, message))
}

/// 应用包名：只接受 ASCII 字母/数字/下划线/点，避免任意字符串被拼进收藏接口。
pub(super) fn parse_package_name(args: &Value) -> Result<String, ApiError> {
    let raw = trimmed_arg(args, "packageName");
    if raw.is_empty() {
        return Err(ApiError::bad_request("缺少参数 packageName（应用包名）"));
    }
    if raw.chars().count() > MAX_PACKAGE_NAME_CHARS {
        return Err(ApiError::bad_request("应用包名过长"));
    }
    if !raw.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_') {
        return Err(ApiError::bad_request(format!("packageName 不是合法包名：{raw}")));
    }
    Ok(raw.to_string())
}

/// 收藏单（收藏夹分类）新建/编辑参数。
#[derive(Debug, Clone)]
pub(super) struct CollectionSaveArgs {
    /// None 表示新建。
    pub collection_id: Option<String>,
    pub title: String,
    pub description: String,
    pub cover: String,
    pub is_open: bool,
}

/// 把动态加入/移出收藏单。
#[derive(Debug, Clone)]
pub(super) struct CollectionMoveArgs {
    pub collection_ids: String,
    pub cancel_ids: String,
    pub feed_id: String,
}

fn valid_id(raw: &str) -> bool {
    !raw.is_empty() && raw.len() <= 64 && raw.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn ids_arg(args: &Value, key: &str) -> Result<Vec<String>, ApiError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::String(raw)) => Ok(raw
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect()),
        Some(Value::Array(items)) => {
            let mut ids = Vec::with_capacity(items.len());
            for item in items {
                let raw = item
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| ApiError::bad_request(format!("{key} 只能是 ID 字符串数组")))?;
                ids.push(raw.to_string());
            }
            Ok(ids)
        }
        _ => Err(ApiError::bad_request(format!("{key} 必须是 ID 字符串或字符串数组"))),
    }
}

pub(super) fn parse_collection_save_args(args: &Value, updating: bool) -> Result<CollectionSaveArgs, ApiError> {
    let collection_id = if updating {
        Some(target_id_arg(args, "collectionId", "收藏单 ID")?)
    } else {
        None
    };
    let title = trimmed_arg(args, "title").to_string();
    if title.is_empty() {
        return Err(ApiError::bad_request("收藏单标题不能为空"));
    }
    if title.chars().count() > MAX_COLLECTION_TITLE_CHARS {
        return Err(ApiError::bad_request(format!("收藏单标题不能超过 {MAX_COLLECTION_TITLE_CHARS} 字")));
    }
    let description = trimmed_arg(args, "description").to_string();
    if description.chars().count() > MAX_COLLECTION_DESCRIPTION_CHARS {
        return Err(ApiError::bad_request(format!(
            "收藏单简介不能超过 {MAX_COLLECTION_DESCRIPTION_CHARS} 字"
        )));
    }
    let cover = trimmed_arg(args, "cover").to_string();
    if !cover.is_empty() && (!(cover.starts_with("http://") || cover.starts_with("https://")) || cover.len() > 512) {
        return Err(ApiError::bad_request("cover 必须是 http(s) 图片地址"));
    }
    let is_open = args.get("isOpen").and_then(Value::as_bool).unwrap_or(true);
    Ok(CollectionSaveArgs { collection_id, title, description, cover, is_open })
}

pub(super) fn parse_collection_move_args(args: &Value) -> Result<CollectionMoveArgs, ApiError> {
    let feed_id = target_id_arg(args, "feedId", "动态 ID")?;
    let collection_ids = ids_arg(args, "collectionIds")?;
    let cancel_ids = ids_arg(args, "cancelIds")?;
    if collection_ids.is_empty() && cancel_ids.is_empty() {
        return Err(ApiError::bad_request("collectionIds 与 cancelIds 至少要有一项"));
    }
    if !collection_ids.iter().chain(cancel_ids.iter()).all(|id| valid_id(id)) {
        return Err(ApiError::bad_request("collectionIds / cancelIds 里有非法 ID"));
    }
    Ok(CollectionMoveArgs {
        collection_ids: collection_ids.join(","),
        cancel_ids: cancel_ids.join(","),
        feed_id,
    })
}
/// 一次写调用的强类型描述。
pub(super) enum WriteCall {
    Publish(PublishArgs),
    Reply(ReplyArgs),
    Forward(ForwardArgs),
    DeleteFeed { feed_id: String },
    FavoriteFeed { feed_id: String, favorite: bool },
    FavoriteApk { package_name: String, favorite: bool },
    UpdateFeed(UpdateFeedArgs),
    DeleteReply { reply_id: String },
    LikeReply { reply_id: String, unlike: bool },
    FollowTopic { tag: String, follow: bool },
    SendMessage { uid: String, message: String },
    SetFeedTop { feed_id: String, top: bool },
    CollectionCreate(CollectionSaveArgs),
    CollectionUpdate(CollectionSaveArgs),
    CollectionDelete { collection_id: String },
    CollectionAddFeed(CollectionMoveArgs),
    CollectionRemoveItem { item_id: String },
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
            Self::UpdateFeed(_) => "coolapk_update_feed",
            Self::DeleteReply { .. } => "coolapk_delete_reply",
            Self::LikeReply { unlike: false, .. } => "coolapk_like_reply",
            Self::LikeReply { unlike: true, .. } => "coolapk_unlike_reply",
            Self::FollowTopic { follow: true, .. } => "coolapk_follow_topic",
            Self::FollowTopic { follow: false, .. } => "coolapk_unfollow_topic",
            Self::SendMessage { .. } => "coolapk_send_message",
            Self::SetFeedTop { top: true, .. } => "coolapk_set_feed_top",
            Self::SetFeedTop { top: false, .. } => "coolapk_unset_feed_top",
            Self::CollectionCreate(_) => "coolapk_collection_create",
            Self::CollectionUpdate(_) => "coolapk_collection_update",
            Self::CollectionDelete { .. } => "coolapk_collection_delete",
            Self::CollectionAddFeed(_) => "coolapk_collection_add_feed",
            Self::CollectionRemoveItem { .. } => "coolapk_collection_remove_item",
            Self::FavoriteFeed { favorite: true, .. } => "coolapk_favorite_feed",
            Self::FavoriteFeed { favorite: false, .. } => "coolapk_unfavorite_feed",
            Self::FavoriteApk { favorite: true, .. } => "coolapk_favorite_apk",
            Self::FavoriteApk { favorite: false, .. } => "coolapk_unfavorite_apk",
            Self::LikeFeed { unlike: false, .. } => "coolapk_like_feed",
            Self::LikeFeed { unlike: true, .. } => "coolapk_unlike_feed",
            Self::FollowUser { unfollow: false, .. } => "coolapk_follow_user",
            Self::FollowUser { unfollow: true, .. } => "coolapk_unfollow_user",
        }
    }

    pub(super) fn scope(&self) -> &'static str {
        match self {
            // 发布与删除都算「内容管理」，共用 write.publish 授权与限流桶。
            Self::Publish(_)
            | Self::DeleteFeed { .. }
            | Self::UpdateFeed(_)
            | Self::CollectionUpdate(_)
            | Self::CollectionDelete { .. } => AgentBridgeScope::WritePublish.as_str(),
            _ => AgentBridgeScope::WriteInteract.as_str(),
        }
    }

    fn required_scope(&self) -> AgentBridgeScope {
        match self {
            Self::Publish(_)
            | Self::DeleteFeed { .. }
            | Self::UpdateFeed(_)
            | Self::CollectionUpdate(_)
            | Self::CollectionDelete { .. } => AgentBridgeScope::WritePublish,
            _ => AgentBridgeScope::WriteInteract,
        }
    }

    fn request_id(&self) -> Option<&str> {
        match self {
            Self::Publish(args) => args.request_id.as_deref(),
            Self::Reply(args) => args.request_id.as_deref(),
            Self::Forward(args) => args.request_id.as_deref(),
            Self::UpdateFeed(args) => args.request_id.as_deref(),
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
            Self::UpdateFeed(args) => json!({
                "feedId": args.feed_id,
                "messageChars": args.message.chars().count(),
                "imageCount": image_total(&args.images, &args.image_paths),
                "clearImages": args.clear_images,
            }),
            Self::DeleteReply { reply_id } => json!({ "replyId": reply_id, "action": "delete" }),
            Self::LikeReply { reply_id, unlike } => json!({
                "replyId": reply_id,
                "action": if *unlike { "unlike" } else { "like" },
            }),
            Self::FollowTopic { tag, follow } => json!({
                "tag": tag,
                "action": if *follow { "follow" } else { "unfollow" },
            }),
            Self::SendMessage { uid, message } => json!({
                "uid": uid,
                "messageChars": message.chars().count(),
            }),
            Self::CollectionCreate(args) => json!({
                "title": args.title,
                "descriptionChars": args.description.chars().count(),
                "cover": args.cover,
                "isOpen": args.is_open,
            }),
            Self::CollectionUpdate(args) => json!({
                "collectionId": args.collection_id,
                "title": args.title,
                "descriptionChars": args.description.chars().count(),
                "cover": args.cover,
                "isOpen": args.is_open,
            }),
            Self::CollectionDelete { collection_id } => json!({
                "collectionId": collection_id,
                "action": "delete",
            }),
            Self::CollectionAddFeed(args) => json!({
                "feedId": args.feed_id,
                "collectionIds": args.collection_ids,
                "cancelIds": args.cancel_ids,
            }),
            Self::CollectionRemoveItem { item_id } => json!({
                "itemId": item_id,
                "action": "remove",
            }),
            Self::SetFeedTop { feed_id, top } => json!({
                "feedId": feed_id,
                "action": if *top { "top" } else { "untop" },
            }),

            Self::FavoriteFeed { feed_id, favorite } => json!({
                "feedId": feed_id,
                "action": if *favorite { "favorite" } else { "unfavorite" },
            }),
            Self::FavoriteApk { package_name, favorite } => json!({
                "packageName": package_name,
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
            Self::UpdateFeed(args) => format!(
                "编辑动态 {}：{} 字、{} 张图片",
                args.feed_id,
                args.message.chars().count(),
                image_total(&args.images, &args.image_paths)
            ),
            Self::DeleteReply { reply_id } => format!("删除评论 {reply_id}"),
            Self::LikeReply { reply_id, unlike } => format!(
                "{}评论 {reply_id}",
                if *unlike { "取消点赞" } else { "点赞" }
            ),
            Self::FollowTopic { tag, follow } => {
                format!("{}话题 {tag}", if *follow { "关注" } else { "取消关注" })
            }
            Self::SendMessage { uid, message } => {
                format!("给用户 {uid} 发私信：{} 字", message.chars().count())
            }
            Self::CollectionCreate(args) => format!("新建收藏单：{}", args.title),
            Self::CollectionUpdate(args) => format!(
                "编辑收藏单 {}：{}",
                args.collection_id.as_deref().unwrap_or_default(),
                args.title
            ),
            Self::CollectionDelete { collection_id } => format!("删除收藏单 {collection_id}"),
            Self::CollectionAddFeed(args) => format!(
                "把动态 {} 加入收藏单 {}（移出 {}）",
                args.feed_id, args.collection_ids, args.cancel_ids
            ),
            Self::CollectionRemoveItem { item_id } => format!("移除收藏单条目 {item_id}"),
            Self::SetFeedTop { feed_id, top } => {
                format!("{}动态 {feed_id}", if *top { "置顶" } else { "取消置顶" })
            }

            Self::FavoriteFeed { feed_id, favorite } => format!(
                "{}动态 {feed_id}",
                if *favorite { "收藏" } else { "取消收藏" }
            ),
            Self::FavoriteApk { package_name, favorite } => format!(
                "{}应用 {package_name}",
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
            Self::UpdateFeed(args) => json!({
                "messageChars": args.message.chars().count(),
                "imageCount": image_total(&args.images, &args.image_paths),
                "target": args.feed_id,
            }),
            Self::DeleteReply { reply_id } => json!({ "target": reply_id }),
            Self::LikeReply { reply_id, .. } => json!({ "target": reply_id }),
            Self::FollowTopic { tag, .. } => json!({ "target": tag }),
            Self::SendMessage { uid, message } => json!({
                "messageChars": message.chars().count(),
                "target": uid,
            }),
            Self::CollectionCreate(args) => json!({
                "target": Value::Null,
                "titleChars": args.title.chars().count(),
            }),
            Self::CollectionUpdate(args) => json!({
                "target": args.collection_id,
                "titleChars": args.title.chars().count(),
            }),
            Self::CollectionDelete { collection_id } => json!({ "target": collection_id }),
            Self::CollectionAddFeed(args) => json!({
                "target": args.feed_id,
                "collectionIds": args.collection_ids,
                "cancelIds": args.cancel_ids,
            }),
            Self::CollectionRemoveItem { item_id } => json!({ "target": item_id }),
            Self::SetFeedTop { feed_id, .. } => json!({ "target": feed_id }),

            Self::FavoriteFeed { feed_id, .. } => json!({ "target": feed_id }),
            Self::FavoriteApk { package_name, .. } => json!({ "target": package_name }),
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
        WriteCall::UpdateFeed(args) => return update_feed(ctx, args).await,
        WriteCall::DeleteReply { reply_id } => state()?.client.delete_reply(reply_id).await,
        WriteCall::LikeReply { reply_id, unlike: false } => state()?.client.like_reply(reply_id).await,
        WriteCall::LikeReply { reply_id, unlike: true } => state()?.client.unlike_reply(reply_id).await,
        WriteCall::FollowTopic { tag, follow: true } => state()?.client.follow_tag(tag).await,
        WriteCall::FollowTopic { tag, follow: false } => state()?.client.unfollow_tag(tag).await,
        WriteCall::SendMessage { uid, message } => state()?.client.send_private_message(uid, message).await,
        WriteCall::CollectionCreate(args) => {
            let state = state()?;
            state
                .client
                .create_collection(
                    &args.title,
                    &args.description,
                    &args.cover,
                    if args.is_open { 1 } else { 0 },
                    "",
                )
                .await
        }
        WriteCall::CollectionUpdate(args) => {
            let state = state()?;
            let collection_id = args.collection_id.as_deref().unwrap_or_default();
            state
                .client
                .update_collection(
                    collection_id,
                    &args.title,
                    &args.description,
                    &args.cover,
                    if args.is_open { 1 } else { 0 },
                )
                .await
        }
        WriteCall::CollectionDelete { collection_id } => state()?.client.delete_collection(collection_id).await,
        WriteCall::CollectionAddFeed(args) => {
            state()?
                .client
                .update_collection_item(&args.collection_ids, &args.cancel_ids, &args.feed_id, "feed", "")
                .await
        }
        WriteCall::CollectionRemoveItem { item_id } => {
            state()?.client.remove_collection_item(item_id).await
        }
        WriteCall::SetFeedTop { feed_id, top } => {
            let state = state()?;
            let uid = state
                .client
                .current_uid()
                .ok_or_else(|| ApiError::unauthorized("当前未登录，无法置顶动态"))?;
            state.client.set_user_feed_top(&uid, feed_id, *top).await
        }

        WriteCall::FavoriteFeed { feed_id, favorite: true } => state()?.client.favorite_feed(feed_id).await,
        WriteCall::FavoriteFeed { feed_id, favorite: false } => state()?.client.unfavorite_feed(feed_id).await,
        WriteCall::FavoriteApk { package_name, favorite: true } => {
            state()?.client.favorite_apk(package_name).await
        }
        WriteCall::FavoriteApk { package_name, favorite: false } => {
            state()?.client.unfavorite_apk(package_name).await
        }
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
        "feedId": feed_id,
        "feed": feed,
        "imageUrls": urls,
        "messageChars": args.message.chars().count(),
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

/// 编辑自己的动态：未指定图片时沿用原动态配图，只有 clearImages 才清空。
async fn update_feed(ctx: &BridgeCtx, args: &UpdateFeedArgs) -> Result<Value, ApiError> {
    let state = ctx.app_state().ok_or_else(ApiError::service_unavailable)?;
    let client = &state.client;
    let pic = if args.clear_images {
        String::new()
    } else if args.images.is_empty() && args.image_paths.is_empty() {
        existing_feed_pic(client, &args.feed_id).await?
    } else {
        upload_all_images(client, &args.images, &args.image_paths).await?.join(",")
    };
    let wrapped = client
        .update_feed(&args.feed_id, &args.message, &pic, None, Some(&args.options))
        .await
        .map_err(ApiError::from_client_error)?;
    let feed = extract_feed(&wrapped).unwrap_or(wrapped);
    let image_urls: Vec<String> = if pic.is_empty() { Vec::new() } else { pic.split(',').map(str::to_string).collect() };
    Ok(json!({
        "feedId": args.feed_id,
        "feed": feed,
        "imageUrls": image_urls,
        "messageChars": args.message.chars().count(),
    }))
}

/// 读取可编辑动态当前的配图（pic 可能是逗号串，也可能是图片对象数组）。
async fn existing_feed_pic(client: &CoolapkClient, feed_id: &str) -> Result<String, ApiError> {
    let detail = client.get_editable_feed(feed_id).await.map_err(ApiError::from_client_error)?;
    let data = detail.get("data").cloned().unwrap_or(detail);
    if let Some(urls) = detail_pic_urls(&data) {
        return Ok(urls);
    }
    if let Some(object) = data.as_object() {
        for key in ["message_pic", "messagePic", "picArr", "pic_arr"] {
            if let Some(urls) = object.get(key).and_then(detail_pic_urls) {
                return Ok(urls);
            }
        }
    }
    Ok(String::new())
}

pub(super) fn detail_pic_urls(value: &Value) -> Option<String> {
    match value {
        Value::String(raw) if !raw.trim().is_empty() => Some(raw.trim().to_string()),
        Value::Array(items) => {
            let urls: Vec<String> = items
                .iter()
                .filter_map(|item| match item {
                    Value::String(url) => Some(url.clone()),
                    Value::Object(map) => map
                        .get("url")
                        .or_else(|| map.get("pic"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    _ => None,
                })
                .filter(|url| !url.is_empty())
                .collect();
            (!urls.is_empty()).then(|| urls.join(","))
        }
        _ => None,
    }
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
