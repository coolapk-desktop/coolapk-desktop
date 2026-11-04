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
use axum::extract::{DefaultBodyLimit, State};
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
/// 发帖支持最多 9 张、单张 8 MB、合计 20 MB 的 base64 图片，膨胀后约 27 MB，
/// 因此请求体上限放宽到 32 MiB；平板端更推荐用 imagePaths 传本机路径。
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

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

/// 发帖 / 评论 / 转发共用的图片入参（base64 与本机路径二选一，合计最多 9 张）。
fn image_properties() -> Value {
    json!({
        "images": {
            "type": "array",
            "maxItems": 9,
            "description": "可选图片（base64），与 imagePaths 合计最多 9 张、单张 8 MB、总计 20 MB",
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
        "imagePaths": {
            "type": "array",
            "maxItems": 9,
            "description": "本机绝对路径列表（JPEG/PNG/WebP），由应用自己读盘上传，适合平板/大图",
            "items": { "type": "string" }
        }
    })
}

/// 在给定属性上合并图片入参，避免三个写工具各自复制一份 schema。
fn media_object_schema(properties: Value, required: Vec<&str>) -> Value {
    let mut merged = properties;
    if let (Some(target), Some(extra)) = (merged.as_object_mut(), image_properties().as_object()) {
        for (key, value) in extra {
            target.insert(key.clone(), value.clone());
        }
    }
    object_schema(merged, required)
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
        description: "发布一条酷安动态（需要 write.publish 授权）。正文与图片至少给一项；图片可用 base64 或 imagePaths（本机绝对路径）。受写操作闸门约束：dry-run 只返回预览，confirm 需要在应用内确认，auto 直接提交。",
        scope: Some(AgentBridgeScope::WritePublish),
        schema: || {
            media_object_schema(
                json!({
                    "message": { "type": "string", "description": "动态正文，最多 5000 字；可含 #话题# 文本" },

                    "visibleStatus": { "type": "integer", "enum": [1, -1], "description": "1 公开、-1 仅自己" },
                    "options": {
                        "type": "object",
                        "description": "官方 createFeed 扩展表单：targetType(target/apk/product_phone)+targetId 发布板块、largeCover、subTypeId/subData、originalType、extraUrl、dyhId、mediaUrl/mediaInfo；未知字段会被拒绝",
                        "properties": {
                            "includeDeviceModel": { "type": "boolean", "description": "是否附带设备型号" },
                            "targetType": { "type": "string", "enum": ["tag", "apk", "product_phone"] },
                            "targetId": { "type": "string" },
                            "visibleStatus": { "type": "integer", "enum": [1, -1] },
                            "largeCover": { "type": "boolean" },
                            "subTypeId": { "type": "string" },
                            "subData": { "type": "string" },
                            "originalType": { "type": "integer", "minimum": 0, "maximum": 3 },
                            "extraUrl": { "type": "string" },
                            "dyhId": { "type": "string" },
                            "mediaUrl": { "type": "string" },
                            "mediaInfo": { "type": "string" },
                            "htmlArticle": { "type": "boolean", "description": "图文长文；正文 message 需为官方 ArticleModel JSON" },
                            "messageTitle": { "type": "string" },
                            "messageCover": { "type": "string" }
                        },
                        "additionalProperties": false
                    },
                    "requestId": { "type": "string", "description": "幂等请求 id；客户端重试时带上可避免重复发布" }
                }),
                vec![],
            )
        },
    },
    ToolSpec {
        name: "coolapk_reply_feed",
        description: "评论一条动态，或带 rid 时回复某条评论（需要 write.interact 授权，受写操作闸门约束）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || {
            media_object_schema(
                json!({
                    "feedId": { "type": "string", "description": "动态 ID" },
                    "message": { "type": "string", "description": "评论正文，最多 1000 字；可含 #话题# 与表情" },
                    "rid": { "type": "string", "description": "回复某条评论时填该评论 id（楼中楼）" },
                    "requestId": { "type": "string", "description": "幂等请求 id；客户端重试时带上可避免重复评论" }
                }),
                vec!["feedId"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_forward_feed",
        description: "转发一条动态（需要 write.interact 授权）。评语与图片都可选。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || {
            media_object_schema(
                json!({
                    "feedId": { "type": "string", "description": "被转发的动态 ID" },
                    "message": { "type": "string", "description": "转发评语，可选，最多 5000 字" },
                    "requestId": { "type": "string", "description": "幂等请求 id" }
                }),
                vec!["feedId"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_favorite_feed",
        description: "收藏一条动态（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "feedId": { "type": "string", "description": "动态 ID" } }), vec!["feedId"]),
    },
    ToolSpec {
        name: "coolapk_unfavorite_feed",
        description: "取消收藏一条动态（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "feedId": { "type": "string", "description": "动态 ID" } }), vec!["feedId"]),
    },
    ToolSpec {
        name: "coolapk_favorite_apk",
        description: "收藏一个应用，加入酷安默认收藏单（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || {
            object_schema(
                json!({ "packageName": { "type": "string", "description": "应用包名，例如 com.coolapk.market" } }),
                vec!["packageName"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_unfavorite_apk",
        description: "取消收藏一个应用，会移出所有已选收藏单（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || {
            object_schema(
                json!({ "packageName": { "type": "string", "description": "应用包名，例如 com.coolapk.market" } }),
                vec!["packageName"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_delete_feed",
        description: "删除自己发布的动态（需要 write.publish 授权；不可恢复，建议配合 confirm 闸门）。",
        scope: Some(AgentBridgeScope::WritePublish),
        schema: || object_schema(json!({ "feedId": { "type": "string", "description": "要删除的动态 ID" } }), vec!["feedId"]),
    },
    ToolSpec {
        name: "coolapk_update_feed",
        description: "编辑自己已发布的动态（需要 write.publish 授权）。不传图片时沿用原配图，clearImages=true 才清空；图文长文需传 options.htmlArticle 与官方 ArticleModel 正文。",
        scope: Some(AgentBridgeScope::WritePublish),
        schema: || {
            media_object_schema(
                json!({
                    "feedId": { "type": "string", "description": "要编辑的动态 ID" },
                    "message": { "type": "string", "description": "编辑后的正文，最多 5000 字" },
                    "clearImages": { "type": "boolean", "description": "true 表示清空配图；与 images/imagePaths 互斥" },
                    "options": { "type": "object", "description": "与发帖相同的 createFeed 扩展表单（图文长文用 htmlArticle/messageTitle/messageCover）" },
                    "requestId": { "type": "string", "description": "幂等请求 id" }
                }),
                vec!["feedId", "message"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_delete_reply",
        description: "删除自己发表的评论/回复（需要 write.interact 授权，不可恢复）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "replyId": { "type": "string", "description": "评论 ID" } }), vec!["replyId"]),
    },
    ToolSpec {
        name: "coolapk_like_reply",
        description: "点赞一条评论（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "replyId": { "type": "string", "description": "评论 ID" } }), vec!["replyId"]),
    },
    ToolSpec {
        name: "coolapk_unlike_reply",
        description: "取消点赞一条评论（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "replyId": { "type": "string", "description": "评论 ID" } }), vec!["replyId"]),
    },
    ToolSpec {
        name: "coolapk_follow_topic",
        description: "关注一个话题（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "tag": { "type": "string", "description": "话题名，可带 # 包裹" } }), vec!["tag"]),
    },
    ToolSpec {
        name: "coolapk_unfollow_topic",
        description: "取消关注一个话题（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "tag": { "type": "string", "description": "话题名，可带 # 包裹" } }), vec!["tag"]),
    },
    ToolSpec {
        name: "coolapk_send_message",
        description: "给指定用户发一条私信（需要 write.interact 授权，1000 字以内；请确认收件人与内容，避免打扰他人）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(
            json!({
                "uid": { "type": "string", "description": "收件人 uid" },
                "message": { "type": "string", "description": "私信正文，最多 1000 字" }
            }),
            vec!["uid", "message"],
        ),
    },    ToolSpec {
        name: "coolapk_set_feed_top",
        description: "把自己主页置顶动态设为指定动态（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "feedId": { "type": "string", "description": "要置顶的动态 ID" } }), vec!["feedId"]),
    },
    ToolSpec {
        name: "coolapk_unset_feed_top",
        description: "取消自己主页的置顶动态（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "feedId": { "type": "string", "description": "要取消置顶的动态 ID" } }), vec!["feedId"]),
    },
    ToolSpec {
        name: "coolapk_collection_create",
        description: "新建收藏单（收藏夹分类）。isOpen 默认 true（公开），false 为私密。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || {
            object_schema(
                json!({
                    "title": { "type": "string", "description": "收藏单标题，最多 60 字" },
                    "description": { "type": "string", "description": "简介，最多 200 字" },
                    "cover": { "type": "string", "description": "可选封面图 http(s) 地址" },
                    "isOpen": { "type": "boolean", "description": "是否公开，默认 true" }
                }),
                vec!["title"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_collection_update",
        description: "编辑收藏单标题/简介/封面/公开状态（需要 write.publish 授权）。",
        scope: Some(AgentBridgeScope::WritePublish),
        schema: || {
            object_schema(
                json!({
                    "collectionId": { "type": "string", "description": "收藏单 ID" },
                    "title": { "type": "string", "description": "收藏单标题，最多 60 字" },
                    "description": { "type": "string", "description": "简介，最多 200 字" },
                    "cover": { "type": "string", "description": "封面图 http(s) 地址" },
                    "isOpen": { "type": "boolean", "description": "是否公开" }
                }),
                vec!["collectionId", "title"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_collection_delete",
        description: "删除收藏单（需要 write.publish 授权，不可恢复，其中内容会一并取消归属）。",
        scope: Some(AgentBridgeScope::WritePublish),
        schema: || object_schema(json!({ "collectionId": { "type": "string", "description": "收藏单 ID" } }), vec!["collectionId"]),
    },
    ToolSpec {
        name: "coolapk_collection_add_feed",
        description: "把动态加入（或移出）收藏单：collectionIds 加入、cancelIds 移出，都支持字符串或数组。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || {
            object_schema(
                json!({
                    "feedId": { "type": "string", "description": "动态 ID" },
                    "collectionIds": { "type": "array", "items": { "type": "string" }, "description": "要加入的收藏单 ID 列表" },
                    "cancelIds": { "type": "array", "items": { "type": "string" }, "description": "要移出的收藏单 ID 列表" }
                }),
                vec!["feedId"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_collection_remove_item",
        description: "从收藏单中移除一条内容（itemId 取 coolapk_collection_items 每条返回的 id，实测通常等于动态 id）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "itemId": { "type": "string", "description": "收藏单条目 ID" } }), vec!["itemId"]),
    },    ToolSpec {
        name: "coolapk_like_feed",
        description: "点赞一条动态（需要 write.interact 授权，受写操作闸门约束）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "feedId": { "type": "string", "description": "动态 ID" } }), vec!["feedId"]),
    },
    ToolSpec {
        name: "coolapk_unlike_feed",
        description: "取消点赞一条动态（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "feedId": { "type": "string", "description": "动态 ID" } }), vec!["feedId"]),
    },
    ToolSpec {
        name: "coolapk_follow_user",
        description: "关注指定用户（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "uid": { "type": "string", "description": "用户 uid" } }), vec!["uid"]),
    },
    ToolSpec {
        name: "coolapk_unfollow_user",
        description: "取消关注指定用户（需要 write.interact 授权）。",
        scope: Some(AgentBridgeScope::WriteInteract),
        schema: || object_schema(json!({ "uid": { "type": "string", "description": "用户 uid" } }), vec!["uid"]),
    },
    ToolSpec {
        name: "coolapk_notifications",
        description: "当前账号的通知列表。type 取 list（通知，默认）、sublist（分组，需 noteType）、feedLikeList（点赞）、contactsFollowList（关注）。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({
                    "type": { "type": "string", "enum": ["list", "sublist", "feedLikeList", "contactsFollowList"], "description": "通知类型，默认 list" },
                    "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" },
                    "noteType": { "type": "string", "description": "type=sublist 时必填的分组类型" }
                }),
                vec![],
            )
        },
    },
    ToolSpec {
        name: "coolapk_favorites",
        description: "当前账号的收藏列表。favType 常见值：feed（动态，默认）、apk（应用）、topic（话题）。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({
                    "favType": { "type": "string", "description": "收藏类型，默认 feed" },
                    "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" }
                }),
                vec![],
            )
        },
    },
    ToolSpec {
        name: "coolapk_following_feeds",
        description: "关注时间线（当前账号关注的人发布的动态）。",
        scope: Some(AgentBridgeScope::Read),
        schema: || object_schema(json!({ "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" } }), vec![]),
    },
    ToolSpec {
        name: "coolapk_reply_thread",
        description: "获取某条一级评论下的楼中楼回复。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({
                    "feedId": { "type": "string", "description": "评论所属动态 ID" },
                    "replyId": { "type": "string", "description": "一级评论 ID（replies 列表里的 id）" },
                    "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" }
                }),
                vec!["feedId", "replyId"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_private_messages",
        description: "当前账号的私信会话列表。",
        scope: Some(AgentBridgeScope::Read),
        schema: || object_schema(json!({ "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" } }), vec![]),
    },    ToolSpec {
        name: "coolapk_collections",
        description: "当前账号的收藏单（收藏夹分类）列表，含系统默认收藏单。",
        scope: Some(AgentBridgeScope::Read),
        schema: || object_schema(json!({ "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" } }), vec![]),
    },
    ToolSpec {
        name: "coolapk_collection_items",
        description: "收藏单里的内容列表；移除条目时 itemId 用每条返回的 id（实测通常等于动态 id）。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({
                    "collectionId": { "type": "string", "description": "收藏单 ID" },
                    "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" }
                }),
                vec!["collectionId"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_collection_detail",
        description: "收藏单详情。",
        scope: Some(AgentBridgeScope::Read),
        schema: || object_schema(json!({ "collectionId": { "type": "string", "description": "收藏单 ID" } }), vec!["collectionId"]),
    },
    ToolSpec {
        name: "coolapk_feed_collections",
        description: "查询某条动态已加入哪些收藏单（加入收藏单前先查）。",
        scope: Some(AgentBridgeScope::Read),
        schema: || object_schema(json!({ "feedId": { "type": "string", "description": "动态 ID" } }), vec!["feedId"]),
    },
    ToolSpec {
        name: "coolapk_product_detail",
        description: "数码产品详情（只读）。可用 productId 或 name（名称更稳），二选一。本接口不提供下单/购买等交易操作。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({
                    "productId": { "type": "string", "description": "产品 ID" },
                    "name": { "type": "string", "description": "产品名称，例如 Redmi K70" }
                }),
                vec![],
            )
        },
    },
    ToolSpec {
        name: "coolapk_product_feeds",
        description: "产品（数码）相关动态列表（只读）。feedType 留空表示全部。",
        scope: Some(AgentBridgeScope::Read),
        schema: || {
            object_schema(
                json!({
                    "productId": { "type": "string", "description": "产品 ID" },
                    "feedType": { "type": "string", "description": "动态类型过滤，例如 discuss/qa/picture/video/ershou，留空表示全部" },
                    "page": { "type": "integer", "minimum": 1, "description": "页码，从 1 开始" }
                }),
                vec!["productId"],
            )
        },
    },
    ToolSpec {
        name: "coolapk_product_versions",
        description: "产品版本与到手价配置（只读，仅展示信息，不做任何交易动作）。",
        scope: Some(AgentBridgeScope::Read),
        schema: || object_schema(json!({ "productId": { "type": "string", "description": "产品 ID" } }), vec!["productId"]),
    },    ToolSpec {
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

/// 工具清单（名称、描述、所需授权范围），供设置页生成「给 AI 的说明」时与工具表保持一致。
pub(super) fn tool_catalog() -> impl Iterator<Item = (&'static str, &'static str, Option<AgentBridgeScope>)> {
    TOOLS.iter().map(|tool| (tool.name, tool.description, tool.scope))
}

pub fn build_router(ctx: Arc<BridgeCtx>) -> Router {
    Router::new()
        .route("/mcp", post(handle_post).get(handle_get).delete(handle_delete))
        // axum 默认 body 上限 2 MB，发帖图片必须显式放宽，否则大图在进入 handler 前就被 413。
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
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
        "coolapk_notifications" => {
            let notification_type = string_arg(args, "type").unwrap_or_else(|| "list".to_string());
            let note_type = string_arg(args, "noteType").unwrap_or_default();
            ops::notifications(ctx, &notification_type, page_arg(args), &note_type).await
        }
        "coolapk_favorites" => {
            let fav_type = string_arg(args, "favType").filter(|value| !value.is_empty()).unwrap_or_else(|| "feed".to_string());
            ops::favorites(ctx, &fav_type, page_arg(args)).await
        }
        "coolapk_following_feeds" => ops::following_feeds(ctx, page_arg(args)).await,
        "coolapk_reply_thread" => {
            let feed_id = required_arg(args, "feedId", "动态 ID")?;
            let reply_id = required_arg(args, "replyId", "评论 ID")?;
            ops::reply_thread(ctx, &feed_id, &reply_id, page_arg(args)).await
        }
        "coolapk_private_messages" => ops::private_messages(ctx, page_arg(args)).await,
        "coolapk_collections" => ops::collections(ctx, page_arg(args)).await,
        "coolapk_collection_items" => {
            let collection_id = required_arg(args, "collectionId", "收藏单 ID")?;
            ops::collection_items(ctx, &collection_id, page_arg(args)).await
        }
        "coolapk_collection_detail" => {
            let collection_id = required_arg(args, "collectionId", "收藏单 ID")?;
            ops::collection_detail(ctx, &collection_id).await
        }
        "coolapk_feed_collections" => {
            let feed_id = required_arg(args, "feedId", "动态 ID")?;
            ops::feed_collections(ctx, &feed_id).await
        }
        "coolapk_product_detail" => {
            let product_id = string_arg(args, "productId").unwrap_or_default();
            let name = string_arg(args, "name").unwrap_or_default();
            ops::product_detail(ctx, &product_id, &name).await
        }
        "coolapk_product_feeds" => {
            let product_id = required_arg(args, "productId", "产品 ID")?;
            let feed_type = string_arg(args, "feedType").unwrap_or_default();
            ops::product_feeds(ctx, &product_id, &feed_type, page_arg(args)).await
        }
        "coolapk_product_versions" => {
            let product_id = required_arg(args, "productId", "产品 ID")?;
            ops::product_versions(ctx, &product_id).await
        }
        "coolapk_topic_detail" => {
            let tag = required_arg(args, "tag", "话题 tag")?;
            ops::topic_detail(ctx, &tag).await
        }
        "coolapk_publish_feed" => {
            let publish = write::parse_publish_args(args)?;
            write::execute(ctx, write::WriteCall::Publish(publish)).await
        }
        "coolapk_reply_feed" => {
            let reply = write::parse_reply_args(args)?;
            write::execute(ctx, write::WriteCall::Reply(reply)).await
        }
        "coolapk_forward_feed" => {
            let forward = write::parse_forward_args(args)?;
            write::execute(ctx, write::WriteCall::Forward(forward)).await
        }
        "coolapk_delete_feed" => {
            let feed_id = required_arg(args, "feedId", "动态 ID")?;
            write::execute(ctx, write::WriteCall::DeleteFeed { feed_id }).await
        }
        "coolapk_favorite_feed" | "coolapk_unfavorite_feed" => {
            let feed_id = required_arg(args, "feedId", "动态 ID")?;
            let favorite = name == "coolapk_favorite_feed";
            write::execute(ctx, write::WriteCall::FavoriteFeed { feed_id, favorite }).await
        }
        "coolapk_favorite_apk" | "coolapk_unfavorite_apk" => {
            let package_name = write::parse_package_name(args)?;
            let favorite = name == "coolapk_favorite_apk";
            write::execute(ctx, write::WriteCall::FavoriteApk { package_name, favorite }).await
        }
        "coolapk_update_feed" => {
            let update = write::parse_update_feed_args(args)?;
            write::execute(ctx, write::WriteCall::UpdateFeed(update)).await
        }
        "coolapk_delete_reply" => {
            let reply_id = write::parse_reply_id(args)?;
            write::execute(ctx, write::WriteCall::DeleteReply { reply_id }).await
        }
        "coolapk_like_reply" | "coolapk_unlike_reply" => {
            let reply_id = write::parse_reply_id(args)?;
            let unlike = name == "coolapk_unlike_reply";
            write::execute(ctx, write::WriteCall::LikeReply { reply_id, unlike }).await
        }
        "coolapk_follow_topic" | "coolapk_unfollow_topic" => {
            let tag = write::parse_topic_tag(args)?;
            let follow = name == "coolapk_follow_topic";
            write::execute(ctx, write::WriteCall::FollowTopic { tag, follow }).await
        }
        "coolapk_send_message" => {
            let (uid, message) = write::parse_message_args(args)?;
            write::execute(ctx, write::WriteCall::SendMessage { uid, message }).await
        }
        "coolapk_set_feed_top" | "coolapk_unset_feed_top" => {
            let feed_id = required_arg(args, "feedId", "动态 ID")?;
            let top = name == "coolapk_set_feed_top";
            write::execute(ctx, write::WriteCall::SetFeedTop { feed_id, top }).await
        }

        "coolapk_collection_create" => {
            let args_save = write::parse_collection_save_args(args, false)?;
            write::execute(ctx, write::WriteCall::CollectionCreate(args_save)).await
        }
        "coolapk_collection_update" => {
            let args_save = write::parse_collection_save_args(args, true)?;
            write::execute(ctx, write::WriteCall::CollectionUpdate(args_save)).await
        }
        "coolapk_collection_delete" => {
            let collection_id = required_arg(args, "collectionId", "收藏单 ID")?;
            write::execute(ctx, write::WriteCall::CollectionDelete { collection_id }).await
        }
        "coolapk_collection_add_feed" => {
            let move_args = write::parse_collection_move_args(args)?;
            write::execute(ctx, write::WriteCall::CollectionAddFeed(move_args)).await
        }
        "coolapk_collection_remove_item" => {
            let item_id = write::parse_id_arg(args, "itemId", "收藏单条目 ID")?;
            write::execute(ctx, write::WriteCall::CollectionRemoveItem { item_id }).await
        }
        "coolapk_like_feed" | "coolapk_unlike_feed" => {
            let feed_id = required_arg(args, "feedId", "动态 ID")?;
            let unlike = name == "coolapk_unlike_feed";
            write::execute(ctx, write::WriteCall::LikeFeed { feed_id, unlike }).await
        }
        "coolapk_follow_user" | "coolapk_unfollow_user" => {
            let uid = required_arg(args, "uid", "用户 uid")?;
            let unfollow = name == "coolapk_unfollow_user";
            write::execute(ctx, write::WriteCall::FollowUser { uid, unfollow }).await
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
