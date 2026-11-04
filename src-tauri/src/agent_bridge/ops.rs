//! 桥接层复用的业务操作：REST 与 MCP 共用同一份实现，避免两套入口行为漂移。
//!
//! 所有操作都复用应用托管的 AppState，因此登录态、账号切换、代理与设备身份
//! 与界面完全同步；操作本身不做授权判断，授权由调用方（HTTP 中间件 / MCP 工具表）负责。

use std::collections::BTreeSet;

use serde_json::{json, Value};

use super::config::AgentBridgeScope;
use super::http::{ApiError, BridgeCtx, StateRef};

fn mapped(value: Result<Value, String>) -> Result<Value, ApiError> {
    value.map_err(ApiError::from_client_error)
}

fn state(ctx: &BridgeCtx) -> Result<StateRef<'_>, ApiError> {
    ctx.app_state().ok_or_else(ApiError::service_unavailable)
}

pub(super) async fn health(ctx: &BridgeCtx, scopes: &BTreeSet<AgentBridgeScope>) -> Result<Value, ApiError> {
    let (transport, endpoint, write_mode, mcp_endpoint) = {
        let config = ctx
            .config
            .read()
            .map_err(|_| ApiError::unauthorized("Agent 接口状态异常"))?;
        (
            config.transport.as_str(),
            config.endpoint(),
            config.write_mode.as_str(),
            config.mcp_endpoint(),
        )
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
                        .and_then(|list| {
                            list.iter()
                                .find(|item| item.get("uid").and_then(Value::as_str) == Some(uid.as_str()))
                                .cloned()
                        })
                })
                .and_then(|item| item.get("username").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_default();
            json!({ "uid": uid, "username": username })
        }
        _ => Value::Null,
    };
    Ok(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "transport": transport,
        "endpoint": endpoint,
        "mcpEndpoint": mcp_endpoint,
        "writeMode": write_mode,
        "scopes": scopes.iter().map(|scope| scope.as_str()).collect::<Vec<_>>(),
        "account": account,
        "limits": { "readPerMinute": 60, "writePerMinute": 1, "writePerHour": 10 },
    }))
}

pub(super) async fn me(ctx: &BridgeCtx) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    let uid = state
        .client
        .current_uid()
        .ok_or_else(|| ApiError::unauthorized("当前未登录"))?;
    mapped(state.client.get_my_profile(&uid).await)
}

pub(super) async fn feed_detail(ctx: &BridgeCtx, id: &str) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_feed_detail(id, None, None).await)
}

pub(super) async fn feed_replies(
    ctx: &BridgeCtx,
    id: &str,
    page: u32,
    list_type: &str,
) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_feed_replies_paged(id, page, "", "", list_type, 0).await)
}

pub(super) async fn user_profile(ctx: &BridgeCtx, uid: &str) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    let result = match state.client.get_user_profile(uid).await {
        Ok(value) => Ok(value),
        Err(error) => {
            if state.client.get_user_cookie().is_some() {
                Err(error)
            } else {
                state.client.get_public_user_profile(uid).await
            }
        }
    };
    mapped(result)
}

pub(super) async fn user_feeds(
    ctx: &BridgeCtx,
    uid: &str,
    page: u32,
    feed_type: &str,
) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_user_feeds(uid, page, feed_type).await)
}

pub(super) async fn topic_detail(ctx: &BridgeCtx, tag: &str) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_topic_detail(tag).await)
}

/// 我的收藏单（收藏夹分类）列表。
pub(super) async fn collections(ctx: &BridgeCtx, page: u32) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    let uid = state
        .client
        .current_uid()
        .ok_or_else(|| ApiError::unauthorized("当前未登录，无法读取收藏单"))?;
    mapped(state.client.get_collection_list(&uid, page, "", "").await)
}

/// 收藏单里的内容列表（条目 id 用返回里的 id 字段）。
pub(super) async fn collection_items(
    ctx: &BridgeCtx,
    collection_id: &str,
    page: u32,
) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_collection_item_list(collection_id, page, "", "").await)
}

pub(super) async fn collection_detail(ctx: &BridgeCtx, collection_id: &str) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_collection_detail(collection_id).await)
}

/// 某条动态已被收进哪些收藏单，供「加入收藏单」前查询。
pub(super) async fn feed_collections(ctx: &BridgeCtx, feed_id: &str) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_feed_collection_status(feed_id).await)
}

/// 数码产品详情（只读）：优先按名称查询，其次按 productId。
pub(super) async fn product_detail(
    ctx: &BridgeCtx,
    product_id: &str,
    name: &str,
) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    let name = name.trim();
    if !name.is_empty() {
        return mapped(state.client.get_product_detail_by_name(name).await);
    }
    let product_id = product_id.trim();
    if product_id.is_empty() {
        return Err(ApiError::bad_request("需要 productId 或 name"));
    }
    mapped(state.client.get_product_detail(product_id).await)
}

/// 产品（数码）相关动态（只读）。
pub(super) async fn product_feeds(
    ctx: &BridgeCtx,
    product_id: &str,
    feed_type: &str,
    page: u32,
) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_product_feeds(product_id, feed_type, "", page).await)
}

/// 产品版本/到手价配置（只读）。
pub(super) async fn product_versions(ctx: &BridgeCtx, product_id: &str) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_product_versions(product_id).await)
}
/// 通知列表：type 决定接口（list 默认通知、sublist 分组、feedLikeList 点赞、contactsFollowList 关注）。
pub(super) async fn notifications(
    ctx: &BridgeCtx,
    notification_type: &str,
    page: u32,
    note_type: &str,
) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_notifications(notification_type, page, "", "", note_type).await)
}

/// 我的收藏列表（type 常见值：feed 动态、apk 应用、topic 话题）。
pub(super) async fn favorites(ctx: &BridgeCtx, fav_type: &str, page: u32) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_favorite_list(fav_type, page, "", "").await)
}

/// 关注时间线。
pub(super) async fn following_feeds(ctx: &BridgeCtx, page: u32) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_following_feeds(page).await)
}

/// 某条一级评论下的楼中楼。
pub(super) async fn reply_thread(
    ctx: &BridgeCtx,
    feed_id: &str,
    reply_id: &str,
    page: u32,
) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.get_sub_replies(feed_id, reply_id, page).await)
}

/// 私信会话列表。
pub(super) async fn private_messages(ctx: &BridgeCtx, page: u32) -> Result<Value, ApiError> {
    let state = state(ctx)?;
    mapped(state.client.list_messages(page, "", "").await)
}

pub(super) async fn search(
    ctx: &BridgeCtx,
    keyword: &str,
    search_type: &str,
    page: u32,
) -> Result<Value, ApiError> {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return Err(ApiError::bad_request("q 不能为空"));
    }
    let state = state(ctx)?;
    let result = if search_type.is_empty() || search_type == "all" {
        state.client.search_all(keyword, page).await
    } else {
        state
            .client
            .search_by_type(&search_type, keyword, page, "", "", "", "", "", "", 0, "", "")
            .await
    };
    mapped(result)
}
