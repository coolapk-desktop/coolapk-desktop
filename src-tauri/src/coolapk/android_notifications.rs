use serde::Deserialize;
#[cfg(any(target_os = "android", test))]
use serde_json::Value;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundConfig {
    pub enabled: bool,
    pub uid: String,
    pub interval_minutes: u64,
    pub notify_replies: bool,
    pub notify_at: bool,
    pub notify_pm: bool,
    #[serde(default)]
    pub sound: bool,
}

#[cfg(any(target_os = "android", test))]
fn counts(response: &Value) -> [u64; 7] {
    let data = response.get("data").unwrap_or(response);
    let keys: [&[&str]; 7] = [
        &["commentme", "commentMe", "comment"], &["atme", "atMe"],
        &["atcommentme", "atCommentMe"], &["feedlike", "feedLike"],
        &["contacts_follow", "contactsFollow", "follow"], &["message", "messageCount"],
        &["badge_v18", "badge", "count", "total", "unreadCount"],
    ];
    let mut result = keys.map(|aliases| aliases.iter().find_map(|key| data.get(key).and_then(|value|
        value.as_u64().or_else(|| value.as_str()?.parse().ok()))).unwrap_or(0));
    // v18 普通通知包含回复和 @，总数按 APK 规则排除关注，不能重复累加旧分类。
    if let Some(notification) = data.get("notification_v18").and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok())) {
        result[0] = notification;
        result[1] = 0;
        result[2] = 0;
        result[6] = notification + result[3] + result[5];
    } else { result[6] = result[6].max(result[..6].iter().sum()); }
    result
}

#[cfg(any(target_os = "android", test))]
fn increased(previous: [u64; 7], current: [u64; 7], config: &BackgroundConfig) -> bool {
    let enabled = [config.notify_replies || config.notify_at, config.notify_at, config.notify_at, true, true, config.notify_pm];
    (0..6).any(|index| enabled[index] && current[index] > previous[index])
        || (current[..6].iter().all(|count| *count == 0) && current[6] > previous[6]
            && (config.notify_replies || config.notify_at || config.notify_pm))
}

#[cfg(any(target_os = "android", test))]
fn self_sent(item: &Value, uid: &str) -> bool {
    ["fromuid", "fromUid", "senderUid", "sender_uid", "lastMessageFromUid"].iter()
        .find_map(|key| item.get(key).map(|value| value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string())))
        .is_some_and(|sender| sender == uid)
}

#[cfg(any(target_os = "android", test))]
fn self_message_count(response: &Value, uid: &str) -> u64 {
    let items = response.get("data").unwrap_or(response).as_array();
    items.into_iter().flatten().filter(|item| self_sent(item, uid)).map(|item| {
        ["unreadNum", "unread_num", "unreadCount", "unread_count"].iter()
            .filter_map(|key| item.get(key).and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok())))
            .max().unwrap_or_else(|| u64::from(item.get("isnew").and_then(Value::as_u64).unwrap_or(0) > 0))
    }).sum()
}

#[tauri::command]
pub async fn configure_android_background_notifications(app: tauri::AppHandle, config: BackgroundConfig) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::Duration;
        use tauri::{Emitter, Manager};
        use super::commands::{AppState, call_android_update_method};
        static GENERATION: AtomicU64 = AtomicU64::new(0);
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let enabled = config.enabled && !config.uid.trim().is_empty();
        let result = call_android_update_method(&app, "setBackgroundNotifications", enabled.to_string()).await?;
        if result.starts_with("error:") { return Err(result.trim_start_matches("error:").to_string()); }
        if !enabled { return Ok(()); }
        tauri::async_runtime::spawn(async move {
            let mut previous = None;
            let delay = Duration::from_secs(config.interval_minutes.clamp(1, 30) * 60);
            loop {
                if GENERATION.load(Ordering::SeqCst) != generation { break; }
                let mut state = call_android_update_method(&app, "backgroundNotificationState", String::new()).await;
                if previous.is_none() && matches!(state.as_deref(), Ok("stopped")) {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    state = call_android_update_method(&app, "backgroundNotificationState", String::new()).await;
                }
                if let Ok(error) = &state {
                    if let Some(message) = error.strip_prefix("error:") {
                        let _ = app.emit("android-background-notification-error", message);
                        break;
                    }
                }
                if state.is_err() || matches!(state.as_deref(), Ok("stopped")) { break; }
                if let Ok(response) = app.state::<AppState>().client.get_notification_count().await {
                    let mut current = counts(&response);
                    if current[5] > 0 {
                        if let Ok(messages) = app.state::<AppState>().client.list_messages(1, "", "").await {
                            let own = self_message_count(&messages, &config.uid).min(current[5]);
                            current[5] -= own;
                            current[6] = current[6].saturating_sub(own);
                        }
                    }
                    if GENERATION.load(Ordering::SeqCst) != generation { break; }
                    if matches!(state.as_deref(), Ok("background")) {
                        if let Some(last) = previous.filter(|last| increased(*last, current, &config)) {
                            let total = current[6];
                            let enabled = [config.notify_replies || config.notify_at, config.notify_at, config.notify_at, true, true, config.notify_pm];
                            let categories = ["notification", "atMe", "atComment", "like", "follow", "message"];
                            let increased_category = (0..6).find(|index| enabled[*index] && current[*index] > last[*index]);
                            let index = increased_category.unwrap_or(0);
                            let mut payload = serde_json::json!({ "title": "酷安新通知",
                                "body": format!("你有 {total} 条未读通知，点击查看详情。"),
                                "category": categories[index], "sound": config.sound,
                                "route": if index == 5 { "/messages" } else { "/notifications" } });
                            let app_state = app.state::<AppState>();
                            let client = &app_state.client;
                            let details = if increased_category.is_none() { Err("仅总数增加，保留汇总通知".to_string()) }
                                else if index == 5 { client.list_messages(1, "", "").await }
                                else { client.get_notifications(["list", "atMeList", "atCommentMeList", "feedLikeList", "contactsFollowList"][index], 1, "", "", "").await };
                            if GENERATION.load(Ordering::SeqCst) != generation { break; }
                            if let Ok(details) = details {
                                if let Some(items) = details.get("data").unwrap_or(&details).as_array() {
                                    if let Some(item) = items.iter().find(|item| index != 5 || !self_sent(item, &config.uid)) {
                                        let string = |keys: &[&str]| -> String { keys.iter().find_map(|key| item.get(*key).and_then(Value::as_str)).unwrap_or("").to_string() };
                                        let title = string(if index == 3 { &["likeUsername"] } else { &["fromusername", "username", "title"] });
                                        let body = string(&["note", "message", "lastMessage"]);
                                        if !title.is_empty() { payload["title"] = serde_json::json!(title); }
                                        if !body.is_empty() { payload["body"] = serde_json::json!(body); }
                                        payload["avatar"] = serde_json::json!(string(if index == 3 { &["likeAvatar"] } else { &["fromUserAvatar", "userAvatar"] }));
                                        if index == 5 {
                                            let uid = string(&["messageUid", "fromuid", "fromUid"]);
                                            if !uid.is_empty() && uid.chars().all(|c| c.is_ascii_digit()) { payload["route"] = serde_json::json!(format!("/messages?uid={uid}")); }
                                        } else {
                                            let feed = item.get("feedId").or_else(|| item.get("fid")).map(|v| v.as_str().map(str::to_owned).unwrap_or_else(|| v.to_string())).unwrap_or_default();
                                            if !feed.is_empty() && feed.chars().all(|c| c.is_ascii_digit()) { payload["route"] = serde_json::json!(format!("/feed/{feed}")); }
                                        }
                                    }
                                }
                            }
                            match call_android_update_method(&app, "showCoolNotification", payload.to_string()).await {
                                Ok(result) if result.starts_with("error:") => { let _ = app.emit("android-background-notification-error", result.trim_start_matches("error:")); }
                                Err(error) => { let _ = app.emit("android-background-notification-error", error); }
                                _ => {}
                            }
                        }
                        let _ = app.emit("android-background-notification-count", &response);
                    }
                    previous = Some(current);
                }
                tokio::time::sleep(delay).await;
            }
        });
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    { let _ = (app, config.enabled, config.uid, config.interval_minutes, config.notify_replies, config.notify_at, config.notify_pm, config.sound); Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn filters_disabled_categories_and_handles_total_only_responses() {
        let config = BackgroundConfig { enabled: true, uid: "1".into(), interval_minutes: 1, notify_replies: false, notify_at: true, notify_pm: false, sound: false };
        let empty = counts(&json!({"data": {"badge_v18": 0}}));
        assert!(!increased(empty, counts(&json!({"data": {"message": 1, "badge_v18": 1}})), &config));
        assert!(increased(empty, counts(&json!({"data": {"atme": "1", "badge_v18": 1}})), &config));
        assert!(increased(empty, counts(&json!({"data": {"badge_v18": 1}})), &config));
        assert!(!increased(counts(&json!({"badge": 2})), counts(&json!({"badge": 2})), &config));
    }
    #[test]
    fn official_v18_total_does_not_double_count_reply_at_or_follow() {
        assert_eq!(counts(&json!({"data": {"notification_v18": 2, "commentme": 2, "atme": 1, "feedlike": 3, "contacts_follow": 4, "message": 1, "badge_v18": 99}})), [2, 0, 0, 3, 4, 1, 6]);
    }
    #[test]
    fn excludes_only_explicitly_self_sent_unread_messages() {
        assert!(self_sent(&json!({"fromuid": "123", "unreadNum": 0}), "123"));
        assert_eq!(self_message_count(&json!({"data": [
            {"fromuid": "123", "unreadNum": 2},
            {"fromuid": 456, "unreadNum": 3},
            {"unreadNum": 4}
        ]}), "123"), 2);
    }
}
