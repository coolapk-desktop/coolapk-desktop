//! 写工具的参数模型与校验。
//!
//! 这里只负责把 MCP / REST 传入的 JSON 变成可信的强类型参数：正文长度、图片数量与
//! 大小、可见范围、幂等 requestId。真正的执行闸门（disabled / dry-run / confirm /
//! auto）在后续任务接入。

use base64::Engine;
use serde_json::{json, Value};

use super::http::ApiError;

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
