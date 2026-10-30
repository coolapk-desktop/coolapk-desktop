use super::*;

#[test]
fn default_request_version_matches_token_signing_version() {
    // 检查实际下载请求与 UA，避免升级请求头时遗漏签名版本。
    let client = CoolapkClient::new();
    let request = client.apply_download_headers(reqwest::Client::new().get("https://api.coolapk.com/v6/main/init")).unwrap().build().unwrap();
    let code = APP_CODE.to_string();
    assert_eq!(request.headers()["X-App-Code"], code.as_str());
    assert_eq!(request.headers()["X-App-Supported"], code.as_str());
    assert!(super::super::native_device::COMPATIBILITY_UA.contains(&format!("-{code}-")));
}

#[test]
fn custom_request_version_matches_signing_and_resets_with_profile() {
    let client = CoolapkClient::new();
    // 保留旧版自定义机型时也要按实际请求头签名，不能混入当前默认版本。
    for code in ["2604201", "2610162"] {
        client.update_device_profile(DeviceProfile { app_code: Some(code.into()), ..Default::default() });
        let request = client.apply_download_headers(reqwest::Client::new().get("https://api.coolapk.com/v6/main/init")).unwrap().build().unwrap();
        assert_eq!(request.headers()["X-App-Code"], code);
        assert_eq!(request.headers()["X-App-Supported"], code);
        assert_eq!(request.headers().get_all("X-App-Code").iter().count(), 1);
        assert_eq!(request.headers().get_all("X-App-Supported").iter().count(), 1);
        assert_eq!(client.request_app_code().unwrap().to_string(), code);
        assert!(request.headers()["X-App-Token"].to_str().unwrap().starts_with("v3"));
    }
    client.update_device_profile(DeviceProfile::default());
    assert_eq!(client.request_app_code().unwrap(), APP_CODE);
}

#[test]
fn invalid_custom_request_version_is_rejected_before_signing() {
    let client = CoolapkClient::new();
    for code in ["0", "-1", "16.6.5", "not-a-version", "4294967296"] {
        client.update_device_profile(DeviceProfile { app_code: Some(code.into()), ..Default::default() });
        assert!(client.get_token().unwrap_err().contains("版本编码无效"));
    }
}

#[test]
fn public_user_requests_keep_custom_version_headers_aligned_with_signing() {
    let client = CoolapkClient::new();
    *client.user_cookie.write().unwrap() = Some("uid=123; token=test-account-token".into());
    for code in ["2604201", "2610162"] {
        client.update_device_profile(DeviceProfile {
            app_version: Some("16.6.5".into()),
            app_code: Some(code.into()),
            sdk_int: Some("37".into()),
            locale: Some("en-US".into()),
            api_version: Some("16".into()),
            dark_mode: Some("1".into()),
            user_agent: Some("Coolapk-Profile-Test".into()),
            device_id: Some("DUguestTest123456".into()),
            ..Default::default()
        });
        let active_device = client.device_code.read().unwrap().clone();
        for origin in ["https://api.coolapk.com", "https://api2.coolapk.com"] {
            for path in ["/v6/user/space", "/v6/user/profile"] {
                let request = client.public_api_request(origin, path, &[("uid", "456".into())])
                    .unwrap().build().unwrap();
                let headers = request.headers();
                assert_eq!(headers["X-App-Code"], client.request_app_code().unwrap().to_string());
                assert_eq!(headers["X-App-Supported"], code);
                assert_eq!(headers["X-App-Version"], "16.6.5");
                assert_eq!(headers.get_all("X-App-Code").iter().count(), 1);
                assert_eq!(headers.get_all("X-App-Supported").iter().count(), 1);
                assert_eq!(headers["X-Sdk-Int"], "37");
                assert_eq!(headers["X-Sdk-Locale"], "en-US");
                assert_eq!(headers["X-Api-Version"], "16");
                assert_eq!(headers["X-Dark-Mode"], "1");
                assert_eq!(headers[USER_AGENT], "Coolapk-Profile-Test");
                let guest_device = device_code_with_profile(&client.guest_device_code(), &client.effective_device_profile());
                assert_eq!(headers["X-App-Device"], guest_device);
                assert!(headers["X-App-Token"].to_str().unwrap().starts_with("v3"));
                assert!(!headers.contains_key(COOKIE));
                assert_eq!(request.url().query(), Some("uid=456"));
            }
        }
        assert_eq!(*client.device_code.read().unwrap(), active_device);
        assert_eq!(client.get_user_cookie().as_deref(), Some("uid=123; token=test-account-token"));
    }
}

#[test]
fn public_user_request_rejects_untrusted_host_and_invalid_signing_version() {
    let client = CoolapkClient::new();
    assert!(client.public_api_request("https://example.com", "/v6/user/space", &[]).is_err());
    client.update_device_profile(DeviceProfile { app_code: Some("invalid".into()), ..Default::default() });
    assert!(client.public_api_request("https://api.coolapk.com", "/v6/user/space", &[])
        .err().unwrap().contains("版本编码无效"));
}

/// 使用当前默认版本与临时游客身份实测；不读取账号文件、不打印凭据或资料。
#[tokio::test]
#[ignore]
async fn probe_latest_public_user_data() {
    let client = CoolapkClient::new();
    let code = client.request_app_code().unwrap();
    assert_eq!(code, APP_CODE);
    let mut successes = 0;
    for origin in ["https://api.coolapk.com", "https://api2.coolapk.com"] {
        for path in ["/v6/user/space", "/v6/user/profile"] {
            let request = client.public_api_request(origin, path, &[("uid", "612390".into())])
                .unwrap().timeout(std::time::Duration::from_secs(12)).build().unwrap();
            match client.api_client().unwrap().execute(request).await {
                Ok(response) => {
                    let http_status = response.status().as_u16();
                    match response_json(response).await {
                        Ok(value) => {
                            let reason: String = value.get("message").and_then(Value::as_str).unwrap_or("")
                                .chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).take(80).collect();
                            let profile_received = wrap_api_data(value.clone()).ok().is_some_and(|result|
                                result.get("data").and_then(|data| data.get("uid")).is_some_and(|uid| value_to_string(uid) == "612390"));
                            successes += usize::from(profile_received);
                            println!("origin={origin} path={path} app_code={code} http_status={http_status} api_status={} profile_received={profile_received} reason_zh={reason}",
                                value.get("status").or_else(|| value.get("code")).unwrap_or(&Value::Null),
                            );
                        }
                        Err(_) => println!("origin={origin} path={path} app_code={code} http_status={http_status} invalid_response=true"),
                    }
                }
                Err(error) => println!("origin={origin} path={path} app_code={code} transport_failed=true timeout={}", error.is_timeout()),
            }
        }
    }
    assert_eq!(successes, 4, "部分游客资料接口未返回目标用户资料，见上方状态摘要");
}

#[test]
fn reply_detail_normalization_preserves_navigation_and_reply_context() {
    let raw = json!({ "data": {
        "id": 222, "fid": "333", "rid": "111", "rrid": "111",
        "uid": "456", "username": "回复者", "message": "完整回复",
        "userInfo": { "uid": "456", "level": 4 },
        "feed": { "id": "333", "entityType": "feed" },
        "device_title": "测试机型"
    }});
    let result = CoolapkClient::normalize_reply_detail(&raw).unwrap();
    let detail = &result["data"];
    assert_eq!(detail["id"], "222");
    for key in ["fid", "rid", "rrid", "uid", "username", "userInfo", "feed"] {
        assert_eq!(detail[key], raw["data"][key], "关联字段 {key} 不应被丢弃");
    }
    assert_eq!(detail["message"], "完整回复");
    assert_eq!(detail["deviceTitle"], "测试机型");
    assert_eq!(detail["userLevel"], "4");
}

#[test]
fn reply_detail_normalization_rejects_missing_reply_data() {
    assert!(CoolapkClient::normalize_reply_detail(&json!({ "data": null })).is_err());
}

#[test]
fn reply_detail_normalization_preserves_server_errors() {
    // 服务端使用 HTTP 200 返回验证失败或删除提示时，也必须显示原始原因。
    for raw in [
        json!({ "status": -3, "message": "请求验证错误", "data": null }),
        json!({ "code": 404, "message": "这条评论已被删除", "data": null }),
        json!({ "error": "评论暂时不可见", "data": null }),
    ] {
        let expected = raw.get("message").or_else(|| raw.get("error")).unwrap().as_str().unwrap();
        assert_eq!(CoolapkClient::normalize_reply_detail(&raw).unwrap_err(), expected);
    }
}

#[test]
fn reply_detail_normalization_preserves_captcha_response() {
    // 验证码响应必须保留结构化信息，供现有验证流程识别。
    let raw = json!({ "code": 403, "message": "请完成验证", "messageStatus": "err_request_captcha_v2", "data": null });
    let error = CoolapkClient::normalize_reply_detail(&raw).unwrap_err();
    assert_eq!(serde_json::from_str::<Value>(&error).unwrap(), raw);
}

#[test]
fn generated_duid_is_guest_default_and_account_explicit_only() {
    let client = CoolapkClient::new();
    client.update_device_profile(DeviceProfile { device_id: Some("DUmanual123456".into()), ..Default::default() });
    client.generated_identity.write().unwrap().guest_id = Some("DUguest123456".into());
    client.sync_device_code();
    let assert_identity = |expected: &str| {
        assert_eq!(client.effective_custom_device_id().as_deref(), Some(expected));
        let mut encoded: String = client.device_code.read().unwrap().chars().rev().collect();
        while encoded.len() % 4 != 0 { encoded.push('='); }
        let decoded = String::from_utf8(BASE64.decode(encoded).unwrap()).unwrap();
        assert_eq!(decoded.split(';').next().unwrap(), expected);
    };
    assert_identity("DUguest123456");
    client.set_user_cookie("uid=10001; SESSID=synthetic-session".into()).unwrap();
    assert_identity("DUmanual123456");
    client.generated_identity.write().unwrap().account_id = Some(("10001".into(), "DUoptin123456".into()));
    client.sync_device_code();
    assert_identity("DUoptin123456");
    // 常规机型同步不能把用户本次点击的生成值覆盖掉，也不覆盖手动配置。
    client.update_device_profile(DeviceProfile { device_id: Some("DUmanual123456".into()), ..Default::default() });
    assert_identity("DUoptin123456");
    client.set_user_cookie("uid=10001; SESSID=synthetic-session".into()).unwrap();
    assert_identity("DUoptin123456");
    client.set_user_cookie("uid=10001; SESSID=reauthenticated-session".into()).unwrap();
    assert_identity("DUoptin123456");
    client.generated_identity.write().unwrap().account_id = Some(("10001".into(), "DUoptin123456".into()));
    client.set_user_cookie("uid=10002; SESSID=another-session".into()).unwrap();
    assert_identity("DUmanual123456");
    client.set_user_cookie("uid=10001; SESSID=synthetic-session".into()).unwrap();
    assert_identity("DUmanual123456");
    client.clear_user_cookie().unwrap();
    assert_identity("DUguest123456");
}

#[tokio::test]
async fn pending_duid_generation_is_discarded_when_login_changes() {
    let client = CoolapkClient::new();
    client.update_device_profile(DeviceProfile { device_id: Some("DUmanual123456".into()), ..Default::default() });
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
    let pending = client.generate_device_identity_with(async {
        started_tx.send(()).unwrap();
        finish_rx.await.unwrap();
        Ok("DUlate_result123456".to_string())
    });
    let login = async {
        started_rx.await.unwrap();
        client.set_user_cookie("uid=10001; SESSID=new-session".into()).unwrap();
        finish_tx.send(()).unwrap();
    };
    let (result, _) = tokio::join!(pending, login);
    assert!(result.unwrap_err().contains("登录状态已变化"));
    assert_eq!(client.effective_custom_device_id().as_deref(), Some("DUmanual123456"));
    assert!(client.generated_identity.read().unwrap().guest_id.is_none());
    assert!(client.generated_identity.read().unwrap().account_id.is_none());
}

#[tokio::test]
async fn guest_duid_cache_restores_without_network_and_never_activates_for_login() {
    let mut random = [0; 8];
    getrandom::fill(&mut random).unwrap();
    let folder = std::env::temp_dir().join(format!("coolapk-duid-{}", hex::encode(random)));
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("accounts.json"), json!({
        "generatedGuestDeviceId": "DUcached123456", "accounts": [], "lastLoginUid": ""
    }).to_string()).unwrap();
    let client = CoolapkClient::new();
    client.persist_cookie_to(folder.join("session_cookie.txt"));
    let info = client.initialize_device_identity().await.unwrap();
    assert_eq!(info["data"]["deviceId"], "DUcached123456");
    assert_eq!(info["data"]["deviceIdSource"], "generated_guest");
    client.set_user_cookie("uid=10001; SESSID=synthetic-session".into()).unwrap();
    let info = client.initialize_device_identity().await.unwrap();
    assert!(info["data"]["deviceId"].is_null());
    assert_eq!(info["data"]["deviceIdSource"], "default");
    std::fs::remove_dir_all(folder).unwrap();
}

#[tokio::test]
async fn account_duid_persists_across_restart_cookie_refresh_and_account_switch() {
    let mut random = [0; 8];
    getrandom::fill(&mut random).unwrap();
    let folder = std::env::temp_dir().join(format!("coolapk-account-duid-{}", hex::encode(random)));
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("accounts.json"), json!({
        "lastLoginUid": "10001", "generatedGuestDeviceId": "DUguest123456",
        "accounts": [{ "uid": "10001", "cookie": "uid=10001; SESSID=synthetic-session" }]
    }).to_string()).unwrap();
    let client = CoolapkClient::new();
    client.persist_cookie_to(folder.join("session_cookie.txt"));
    client.update_device_profile(DeviceProfile { device_id: Some("DUmanual123456".into()), ..Default::default() });
    client.initialize_device_identity().await.unwrap();
    client.generate_device_identity_with(async { Ok("DUaccountA123456".into()) }).await.unwrap();
    client.set_user_cookie("uid=10001; SESSID=refreshed-session".into()).unwrap();
    assert_eq!(client.effective_custom_device_id().as_deref(), Some("DUaccountA123456"));
    client.set_user_cookie("uid=10002; SESSID=another-session".into()).unwrap();
    assert_eq!(client.effective_custom_device_id().as_deref(), Some("DUmanual123456"));
    client.generate_device_identity_with(async { Ok("DUaccountB123456".into()) }).await.unwrap();
    client.set_user_cookie("uid=10001; SESSID=refreshed-session".into()).unwrap();
    assert_eq!(client.effective_custom_device_id().as_deref(), Some("DUaccountA123456"));
    client.clear_user_cookie().unwrap();
    assert_eq!(client.effective_custom_device_id().as_deref(), Some("DUguest123456"));
    client.set_user_cookie("uid=10001; SESSID=new-login".into()).unwrap();
    client.set_last_login_uid("10001");

    let restarted = CoolapkClient::new();
    restarted.persist_cookie_to(folder.join("session_cookie.txt"));
    let info = restarted.initialize_device_identity().await.unwrap();
    assert_eq!(info["data"]["deviceId"], "DUaccountA123456");
    assert_eq!(info["data"]["deviceIdSource"], "generated_account");
    restarted.use_saved_device_identity().unwrap();
    assert!(restarted.effective_custom_device_id().is_none());
    assert!(restarted.load_accounts_root()["generatedAccountDeviceIds"].get("10001").is_none());
    restarted.set_user_cookie("uid=10002; SESSID=another-session".into()).unwrap();
    assert_eq!(restarted.effective_custom_device_id().as_deref(), Some("DUaccountB123456"));
    std::fs::remove_dir_all(folder).unwrap();
}

#[tokio::test]
async fn account_duid_save_failure_does_not_apply_generated_identity() {
    let client = CoolapkClient::new();
    client.set_user_cookie("uid=10001; SESSID=synthetic-session".into()).unwrap();
    let result = client.generate_device_identity_with(async { Ok("DUunsaved123456".into()) }).await;
    assert!(result.is_err());
    assert!(client.generated_identity.read().unwrap().account_id.is_none());
}

#[test]
fn test_feed_cleaning_preserves_private_visibility() {
    for raw in [
        json!({ "id": "42", "uid": "123", "username": "作者", "message": "正文", "publish_status": 1 }),
        json!({ "id": "42", "uid": "123", "username": "作者", "message": "正文", "publishStatus": "1" }),
    ] {
        let expected = raw.get("publish_status").or_else(|| raw.get("publishStatus")).unwrap();
        let cleaned = CoolapkClient::clean_single_feed(&raw, 0).unwrap();
        assert_eq!(&cleaned["publishStatus"], expected);
    }
    let reviewed = CoolapkClient::clean_single_feed(&json!({ "id": "42", "uid": "123", "username": "作者", "message": "正文", "status": -1 }), 0).unwrap();
    assert!(reviewed.get("publishStatus").is_none());
}

#[test]
fn test_publish_device_model_is_scoped_and_preserves_identity() {
    let client = CoolapkClient::new();
    client.update_device_profile(DeviceProfile {
        device_id: Some("publish-identity".into()),
        manufacturer: Some("Apple".into()), brand: Some("Apple".into()),
        model: Some("iPhone17,3".into()), build: Some("real-build".into()),
        user_agent: Some("native-UA iPhone17,3".into()),
        ..Default::default()
    });
    let original_code = client.device_code.read().unwrap().clone();
    let form = build_create_feed_form("正文", None, None);
    let hidden = client.create_feed_request(&form, false).unwrap().build().unwrap();
    let visible = client.create_feed_request(&form, true).unwrap().build().unwrap();
    let decode = |request: &reqwest::Request| {
        let mut encoded: String = request.headers()["X-App-Device"].to_str().unwrap().chars().rev().collect();
        while encoded.len() % 4 != 0 { encoded.push('='); }
        String::from_utf8(BASE64.decode(encoded).unwrap()).unwrap()
            .split(';').map(|part| part.trim().to_string()).collect::<Vec<_>>()
    };
    let hidden_fields = decode(&hidden);
    let visible_fields = decode(&visible);
    assert_eq!(&hidden_fields[..4], &visible_fields[..4]);
    assert_eq!(hidden_fields[0], "publish-identity");
    assert!(hidden_fields[4..8].iter().all(String::is_empty));
    assert_eq!(visible_fields[6], "iPhone17,3");
    assert_eq!(hidden.headers()[USER_AGENT], "CoolMarket/16.6.5-2610162-universal");
    assert_eq!(hidden.headers().get_all(USER_AGENT).iter().count(), 1);
    assert_eq!(visible.headers()[USER_AGENT], "native-UA iPhone17,3");
    assert_eq!(hidden.body().unwrap().as_bytes(), visible.body().unwrap().as_bytes());
    assert_eq!(*client.device_code.read().unwrap(), original_code);
    assert!(device_code_without_model("invalid").is_err());
    assert!(client.default_publish_device_model());
}

#[test]
fn test_publish_extras_apk_fields() {
    let options: PublishOptions = serde_json::from_value(json!({"originalType":2,"dyhId":"9","extraUrl":"/goods/detail?id=8"})).unwrap();
    let mut form = build_create_feed_form("正文", None, None);
    apply_publish_options(&mut form, &options).unwrap();
    assert!(form.contains(&("original_type", "2".to_string())));
    assert!(form.contains(&("dyhId", "9".to_string())));
    assert!(form.contains(&("extra_url", "/goods/detail?id=8".to_string())));
    let invalid: PublishOptions = serde_json::from_value(json!({"originalType":4})).unwrap();
    assert!(apply_publish_options(&mut form, &invalid).is_err());
}

#[test]
fn test_publish_live_photo_upload_files() {
    let (files, video_name) = build_publish_upload_files(b"cover", "photo.jpg", Some(b"video"), 1);
    let entries: Value = serde_json::from_str(&files).unwrap();
    assert_eq!(entries.as_array().unwrap().len(), 2);
    assert_eq!(entries[0]["livePhoto"], 1);
    assert_eq!(entries[0]["hdr"], 1);
    assert_eq!(entries[0]["livePhotoVideo"], entries[1]["name"]);
    assert_eq!(entries[1]["name"].as_str(), video_name.as_deref());
    let (static_files, name) = build_publish_upload_files(b"cover", "photo.jpg", None, 0);
    let entries: Value = serde_json::from_str(&static_files).unwrap();
    assert_eq!(entries.as_array().unwrap().len(), 1);
    assert!(entries[0].get("livePhoto").is_none());
    assert!(name.is_none());
    let options: PublishOptions = serde_json::from_value(json!({"largeCover":true})).unwrap();
    let mut form = build_create_feed_form("正文", None, None);
    apply_publish_options(&mut form, &options).unwrap();
    assert!(form.contains(&("is_html_article", "2".to_string())));
}

#[test]
fn test_publish_visibility_maps_to_publish_status() {
    for (visible, expected) in [(1, "0"), (-1, "1")] {
        let options: PublishOptions = serde_json::from_value(json!({"visibleStatus":visible})).unwrap();
        let mut form = build_create_feed_form("正文", None, None);
        apply_publish_options(&mut form, &options).unwrap();
        assert!(form.contains(&("publish_status", expected.to_string())));
        assert!(form.contains(&("status", "1".to_string())));
    }
    let options: PublishOptions = serde_json::from_value(json!({"visibleStatus":0})).unwrap();
    assert!(apply_publish_options(&mut build_create_feed_form("正文", None, None), &options).is_err());
}

#[test]
fn test_publish_product_subdata_validation() {
    for (sub_type, data) in [("1", "8.5"), ("2", "{\"antutu_score\":1200000}"), ("5", "4"), ("6", "{\"final_price\":2999,\"config_id\":123,\"config_name\":\"标准版\"}")] {
        let options: PublishOptions = serde_json::from_value(json!({"targetType":"product_phone","targetId":"321","subTypeId":sub_type,"subData":data})).unwrap();
        let mut form = build_create_feed_form("正文", None, None);
        apply_publish_options(&mut form, &options).unwrap();
        assert!(form.contains(&("tsubid", sub_type.to_string())));
        assert!(form.contains(&("tsubdata", data.to_string())));
    }
    for (sub_type, data) in [("1", "NaN"), ("2", "{}"), ("5", "6"), ("6", "{\"final_price\":100}"), ("3", "")] {
        let options: PublishOptions = serde_json::from_value(json!({"targetType":"product_phone","targetId":"321","subTypeId":sub_type,"subData":data})).unwrap();
        assert!(apply_publish_options(&mut build_create_feed_form("正文", None, None), &options).is_err());
    }
}

#[test]
fn test_publish_target_matches_apk_form() {
    let mut form = build_create_feed_form("正文", None, None);
    let options: PublishOptions = serde_json::from_value(json!({"targetType":"apk","targetId":"123"})).unwrap();
    apply_publish_options(&mut form, &options).unwrap();
    assert!(form.contains(&("type", "comment".to_string())));
    assert!(form.contains(&("targetType", "apk".to_string())));
    assert!(form.contains(&("targetId", "123".to_string())));
    let invalid: PublishOptions = serde_json::from_value(json!({"targetType":"tag"})).unwrap();
    assert!(apply_publish_options(&mut form, &invalid).is_err());
}

#[test]
fn test_search_response_filters_sponsor_entities_recursively() {
    let raw = serde_json::json!({
        "data": [{
            "entities": [
                {"entityType": "feed", "id": "1", "message": "正常动态"},
                {"entityTemplate": "sponsorForSearch", "sponsorType": "apk", "id": "2"},
                {"entityType": "entityCard", "entities": [{"entityType": "sponsorForSearch", "id": "3"}]}
            ]
        }]
    });
    let filtered = CoolapkClient::wrap_sanitized_search_data(&raw);
    let json = filtered.to_string();
    assert!(json.contains("正常动态"));
    assert!(!json.contains("sponsorForSearch"));
    assert!(!json.contains("sponsorType"));
}

#[test]
fn test_classify_path_detects_requirements() {
    // DDI 写接口：需要 ddid（unlike 不在 useDDIEventList 内）
    assert!(classify_path("/v6/feed/like").needs_ddid);
    assert!(!classify_path("/v6/feed/unlike").needs_ddid);
    assert!(classify_path("/v6/feed/likeReply").needs_ddid);
    // PostToken 接口：发动态/评论需要 _v2_post_token
    assert!(classify_path("/v6/feed/createFeed").needs_post_token);
    assert!(classify_path("/v6/feed/reply").needs_post_token);
    assert!(classify_path("/v6/feed/createFeed").needs_ddid);
    // 只读接口：不需要
    assert!(!classify_path("/v6/main/indexV8").needs_ddid);
    assert!(!classify_path("/v6/feed/detail").needs_post_token);
    // 带查询串也能匹配
    assert!(classify_path("/v6/feed/like?id=123").needs_ddid);
}

#[test]
fn test_ddid_is_not_sent_when_disabled() {
    let cookie = "SESSID=session; uid=123; ddid=stale-ddid; sid=other";
    assert_eq!(cookie_without_ddid(cookie), "SESSID=session; uid=123; sid=other");
    assert!(!cookie_for_request(cookie, true, None).contains("ddid="));
    assert!(!cookie_for_request(cookie, false, Some("DU-MOCK-TEST-ID")).contains("ddid="));
    let configured = cookie_for_request(cookie, true, Some("DU-MOCK-TEST-ID"));
    assert!(configured.contains("ddid=DU-MOCK-TEST-ID"));
    assert!(!configured.contains("stale-ddid"));
}

#[test]
fn test_user_plugin_cookie_uses_configured_did_without_confusing_ddid() {
    let cookie = "uid=123; token=account-token; DID=old-device; ddid=old-session";
    let configured = user_plugin_cookie(cookie, Some("DU-CONFIGURED-DEVICE"), None);
    assert!(configured.contains("DID=DU-CONFIGURED-DEVICE"));
    assert!(configured.contains("token=account-token"));
    assert!(!configured.contains("old-device"));
    assert!(!configured.contains("ddid="));
    let with_session = user_plugin_cookie(cookie, Some("DU-CONFIGURED-DEVICE"), Some("session-value"));
    assert!(with_session.contains("DID=DU-CONFIGURED-DEVICE"));
    assert!(with_session.contains("ddid=session-value"));
    assert!(!with_session.contains("old-session"));
    assert!(user_plugin_cookie(cookie, None, None).contains("DID=old-device"));
}

#[test]
fn test_login_info_cookie_matches_official_cookie_interceptor() {
    assert_eq!(encode_login_cookie_value("name with space"), "name+with+space");
    assert_eq!(encode_login_cookie_value("中文"), "%E4%B8%AD%E6%96%87");
    let cookie = remove_cookie_values(
        "SESSID=session; uid=old; username=old-user; token=old-token",
        &["uid", "username", "token"],
    );
    assert_eq!(cookie, "SESSID=session");
    let cookie = merge_cookie_value(&cookie, "uid", "123");
    let cookie = merge_cookie_value(&cookie, "username", "cool+user");
    let cookie = merge_cookie_value(&cookie, "token", "new-token");
    assert_eq!(
        cookie,
        "SESSID=session; uid=123; username=cool+user; token=new-token"
    );
}

#[test]
fn test_product_rating_query_matches_apk_contract() {
    assert_eq!(
        build_product_rating_query("2967", 5),
        vec![("id", "2967".to_string()), ("value", "5".to_string())]
    );
    assert_eq!(
        build_product_rating_query("2967", 0),
        vec![("id", "2967".to_string()), ("value", "0".to_string())]
    );
}

#[test]
fn test_product_review_uses_official_feed_contract() {
    let form = build_product_review_form("5573", 4, "影像不错", true);
    let field = |key| form.iter().find(|(name, _)| *name == key).map(|(_, value)| value.as_str());
    assert_eq!(field("type"), Some("rating"));
    assert_eq!(field("targetType"), Some("product_phone"));
    assert_eq!(field("targetId"), Some("5573"));
    assert_eq!(field("rating_score_1"), Some("4"));
    assert_eq!(field("buy_status"), Some("1"));
    assert_eq!(field("message"), Some("影像不错"));
}

#[test]
fn test_product_rating_list_query_matches_apk_contract() {
    assert_eq!(
        build_product_rating_list_query("5573", 0, 0, 0),
        vec![
            ("url", "/feed/nodeRatingList".to_string()),
            ("targetType", "7".to_string()),
            ("targetId", "5573".to_string()),
            ("page", "1".to_string()),
        ]
    );
    assert_eq!(
        build_product_rating_list_query("5573", 5, 1, 2).last(),
        Some(&("star", "5".to_string()))
    );
    assert!(build_product_rating_list_query("5573", 5, 1, 2).contains(&("isOwner", "1".to_string())));
}

#[test]
fn test_topic_rating_list_query_matches_apk_contract() {
    assert_eq!(build_topic_rating_list_query("topic-id", 0, 0, "", false, "", ""), vec![
        ("url", "/feed/nodeRatingList".to_string()),
        ("targetType", "3".to_string()),
        ("targetId", "topic-id".to_string()),
        ("page", "1".to_string()),
    ]);
    let query = build_topic_rating_list_query("topic-id", 2, 5, "1", true, "first", "last");
    for field in [("star", "5"), ("ratingType", "1"), ("v4RatingItem", "1"), ("firstItem", "first"), ("lastItem", "last")] {
        assert!(query.contains(&(field.0, field.1.to_string())));
    }
    let query = build_topic_rating_list_query("topic-id", 1, 8, "invalid", false, "", "");
    assert!(!query.iter().any(|(name, _)| matches!(*name, "star" | "ratingType" | "isOwner" | "v4RatingItem")));
}

#[test]
fn test_secondhand_product_list_query_matches_apk_contract() {
    assert_eq!(
        build_secondhand_product_list_query("1016", "recommend", 0, "", ""),
        vec![
            ("id", "1016".to_string()),
            ("listType", "recommend".to_string()),
            ("page", "1".to_string()),
        ]
    );
    assert_eq!(
        build_secondhand_product_list_query("1016", "recommend", 2, "first", "last"),
        vec![
            ("id", "1016".to_string()),
            ("listType", "recommend".to_string()),
            ("page", "2".to_string()),
            ("firstItem", "first".to_string()),
            ("lastItem", "last".to_string()),
        ]
    );
}

#[test]
fn test_collection_list_query_includes_default_collection_and_page_cursor() {
    assert_eq!(
        build_collection_list_query("12345", 1, "", ""),
        vec![
            ("uid", "12345".to_string()),
            ("showDefault", "1".to_string()),
            ("page", "1".to_string()),
            ("firstItem", "".to_string()),
            ("lastItem", "".to_string()),
        ]
    );
    assert_eq!(
        build_collection_list_query("12345", 2, "collection-100", "collection-90"),
        vec![
            ("uid", "12345".to_string()),
            ("showDefault", "1".to_string()),
            ("page", "2".to_string()),
            ("firstItem", "collection-100".to_string()),
            ("lastItem", "collection-90".to_string()),
        ]
    );
}

#[test]
fn test_product_feeds_query_includes_sort_only_when_selected() {
    assert_eq!(
        build_product_feeds_query("5573", "feed", "", 1),
        vec![
            ("url", "/page?url=/product/feedList".to_string()),
            ("id", "5573".to_string()),
            ("type", "feed".to_string()),
            ("page", "1".to_string()),
        ]
    );
    assert_eq!(
        build_product_feeds_query("5573", "feed", " rank_score ", 1),
        vec![
            ("url", "/page?url=/product/feedList".to_string()),
            ("id", "5573".to_string()),
            ("type", "feed".to_string()),
            ("listType", "rank_score".to_string()),
            ("page", "1".to_string()),
        ]
    );
}

#[test]
fn test_product_subtab_query_matches_official_sample_tab() {
    let query = build_product_subtab_query("5136", "4", 1);
    assert!(query.contains(&("type", "subTabFeed".to_string())));
    assert!(query.contains(&("subId", "4".to_string())));
    assert!(query.contains(&("withSubTabFeedCard", "1".to_string())));
}

#[test]
fn test_feed_cleaner_preserves_live_photo_metadata() {
    let raw = serde_json::json!({
        "id": "live-feed-1",
        "entityType": "feed",
        "username": "测试用户",
        "message": "实况图",
        "imageUriList": [{
            "sourceUrl": "https://image.coolapk.com/feed/livepic@1080x1920.jpg",
            "compressedUrl": "https://image.coolapk.com/feed/livepic-cover.jpg",
            "liveVideoUrl": "https://video.coolapk.com/live/1.mp4",
            "livePhotoEnable": 1,
            "livePhotoSoundEnable": 0
        }]
    });

    let cleaned = CoolapkClient::clean_single_feed(&raw, 0).expect("feed should be kept");
    assert_eq!(cleaned["pics"][0], "https://image.coolapk.com/feed/livepic@1080x1920.jpg");
    assert_eq!(
        cleaned["imageUriList"][0]["liveVideoUrl"],
        "https://video.coolapk.com/live/1.mp4"
    );
    assert_eq!(cleaned["imageUriList"][0]["livePhotoEnable"], 1);
}

#[test]
fn test_live_photo_response_extracts_nested_url_list() {
    let response = serde_json::json!({
        "code": 200,
        "data": {
            "urlList": [
                "not-a-url",
                "https://video.coolapk.com/live/123.mp4"
            ]
        }
    });
    assert_eq!(
        extract_live_photo_video_url(&response),
        Some("https://video.coolapk.com/live/123.mp4".to_string())
    );
}

/// 在线接口探测：需要网络，默认测试集不执行。
#[tokio::test]
#[ignore]
async fn probe_product_rating_endpoints_contract() {
    let client = CoolapkClient::new();
    let product_id = "5573";

    let chart = client
        .api_get("/v6/product/ratingChart", &[("id", product_id.to_string())])
        .await
        .expect("评分趋势接口应能返回 HTTP JSON");
    assert!(chart.get("data").is_some(), "评分趋势响应缺少 data: {chart}");
    assert!(chart["data"].is_object(), "评分趋势 data 不是对象: {chart}");
    assert!(wrap_api_data(chart).is_ok(), "评分趋势接口返回业务错误");

    let list_query = build_product_rating_list_query(product_id, 0, 0, 1);
    let list = client
        .api_get("/v6/page/dataList", &list_query)
        .await
        .expect("产品评分列表接口应能返回 HTTP JSON");
    assert!(list.get("data").is_some(), "评分列表响应缺少 data: {list}");
    assert!(list["data"].is_array(), "评分列表 data 不是数组: {list}");
    assert!(wrap_api_data(list).is_ok(), "评分列表接口返回业务错误");
}

#[tokio::test]
#[ignore]
async fn probe_product_tabs_contract() {
    let client = CoolapkClient::new();
    let raw = client.get_product_detail_by_name("华为Mate 80 RS非凡大师").await.unwrap();
    let data = &raw["data"];
    println!("product id={} title={} tabs={:?} hot={} discussions={} follows={} owner_score={} rating_score={}",
        data["id"], data["title"], data["tabList"].as_array().into_iter().flatten().map(|tab| (tab["title"].as_str(), tab["page_name"].as_str())).collect::<Vec<_>>(),
        data["hot_num_txt"], data["feed_comment_num_txt"], data["follow_num_txt"],
        data["owner_star_average_score"], data["rating_average_score"]);
    let sample = client.api_get("/v6/page/dataList", &build_product_subtab_query("5136", "4", 1)).await.unwrap();
    assert!(sample["data"].is_array(), "样张列表应返回数组");
    println!("sample item count={} first types={:?}", sample["data"].as_array().map_or(0, Vec::len), sample["data"].as_array().into_iter().flatten().take(4).map(|item| (item["entityType"].as_str(), item["entityTemplate"].as_str())).collect::<Vec<_>>());
    assert!(wrap_api_data(sample).is_ok(), "样张列表接口返回业务错误");
    let sample_tab_url = data["tabList"].as_array().unwrap().iter().find(|tab| tab["page_name"] == "4").unwrap()["url"].as_str().unwrap();
    let configured = client.get_discovery_page_data(sample_tab_url, "", "", 1, "", "", "", "").await.unwrap();
    println!("configured sample count={}", configured["data"].as_array().map_or(0, Vec::len));
    assert!(configured["data"].is_array(), "按栏目 URL 加载的样张列表应返回数组");
    let external_tab_url = data["tabList"].as_array().unwrap().iter().find(|tab| tab["title"] == "鸿蒙").unwrap()["url"].as_str().unwrap();
    let external = client.get_discovery_page_data(external_tab_url, "鸿蒙", "", 1, "", "", "", "").await.unwrap();
    println!("configured external count={}", external["data"].as_array().map_or(0, Vec::len));
    assert!(external["data"].is_array(), "按栏目 URL 加载的外部栏目应返回数组");
    let rating_tab_url = data["tabList"].as_array().unwrap().iter().find(|tab| tab["page_name"] == "rating").unwrap()["url"].as_str().unwrap();
    let rating_tab = client.get_discovery_page_data(rating_tab_url, "", "", 1, "", "", "", "").await.unwrap();
    println!("rating tab first cards={:?}", rating_tab["data"].as_array().into_iter().flatten().take(3).map(|item| (item["entityType"].as_str(), item["entityTemplate"].as_str(), item["title"].as_str(), item["extraData"].as_str())).collect::<Vec<_>>());
    let sort_card = rating_tab["data"].as_array().unwrap().iter().find(|item| item["entityTemplate"] == "sortSelectCard").unwrap();
    for option in sort_card["entities"].as_array().unwrap() {
        let url = option["url"].as_str().unwrap();
        let sorted = client.get_discovery_page_data(url, "", "", 1, "", "", "", "").await.unwrap();
        let first_feed = sorted["data"].as_array().into_iter().flatten().find(|item| item["entityType"] == "feed");
        println!("rating sort={} items={} feeds={} has_more={} first_feed={}", option["title"],
            sorted["data"].as_array().map_or(0, Vec::len),
            sorted["data"].as_array().into_iter().flatten().filter(|item| item["entityType"] == "feed").count(),
            sorted["hasMore"], first_feed.map_or(&Value::Null, |item| &item["id"]));
        assert!(sorted["data"].is_array(), "点评排序请求应返回列表");
        if option["title"] == "差评" {
            let feeds: Vec<&Value> = sorted["data"].as_array().unwrap().iter().filter(|item| item["entityType"] == "feed").collect();
            let first = feeds.first().and_then(|item| item["id"].as_i64()).map(|id| id.to_string()).unwrap_or_default();
            let last = feeds.last().and_then(|item| item["id"].as_i64()).map(|id| id.to_string()).unwrap_or_default();
            let next = client.get_discovery_page_data(url, "", "", 2, &first, &last, "", "").await.unwrap();
            println!("rating worst page2 items={} feeds={}", next["data"].as_array().map_or(0, Vec::len), next["data"].as_array().into_iter().flatten().filter(|item| item["entityType"] == "feed").count());
        }
    }
    for feed_type in ["article", "feedArticle"] {
        let raw = client.api_get("/v6/page/dataList", &build_product_feeds_query("5136", feed_type, "", 1)).await.unwrap();
        println!("product feed type={feed_type} items={}", raw["data"].as_array().map_or(0, Vec::len));
        assert!(wrap_api_data(raw).is_ok(), "图文列表接口返回业务错误");
    }
}

#[test]
fn test_oss_image_url_uses_prepare_prefix_and_file_name() {
    let url = build_oss_image_url(
        "https://image.coolapk.com/",
        "/feed/2026/08/23/test.png",
    )
    .expect("应生成图片地址");
    assert_eq!(url, "https://image.coolapk.com/feed/2026/08/23/test.png");
    assert!(build_oss_image_url("image.coolapk.com", "feed/test.png").is_none());
}

#[test]
fn test_image_resolution_reads_png_dimensions() {
    let mut png_header = vec![
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0, 0, 0, 0, b'I', b'H', b'D', b'R',
        0, 0, 0x04, 0x38, 0, 0, 0x08, 0x70,
    ];
    assert_eq!(image_resolution(&png_header), "1080x2160");
    png_header[16..20].copy_from_slice(&1u32.to_be_bytes());
    png_header[20..24].copy_from_slice(&1u32.to_be_bytes());
    assert_eq!(image_resolution(&png_header), "1x1");
}

#[test]
fn test_reply_target_uses_comment_id_and_reply_type() {
    assert_eq!(
        reply_target_params("73356707", Some(" 601858220 ")),
        ("601858220".to_string(), "reply".to_string())
    );
    assert_eq!(
        reply_target_params("73356707", None),
        ("73356707".to_string(), "feed".to_string())
    );
}

#[test]
fn test_create_feed_form_includes_pic_and_publish_state() {
    let form = build_create_feed_form(
        "测试",
        Some("http://image.coolapk.com/feed/test@0x0.png"),
        None,
    );
    let value = |key: &str| {
        form.iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value.as_str())
    };

    assert_eq!(value("pic"), Some("http://image.coolapk.com/feed/test@0x0.png"));
    assert_eq!(value("status"), Some("1"));
    assert_eq!(value("publish_status"), Some("0"));
    assert_eq!(value("is_html_article"), Some("0"));
}

#[test]
fn test_create_answer_form_uses_answer_type_and_question_fid() {
    let form = build_create_feed_form_for_type("回答内容", None, None, "answer", "question-42");
    let value = |key: &str| {
        form.iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value.as_str())
    };

    assert_eq!(value("type"), Some("answer"));
    assert_eq!(value("fid"), Some("question-42"));
    assert_eq!(value("message"), Some("回答内容"));
}

#[test]
fn test_forward_form_uses_forwardid_instead_of_fid() {
    let form = build_forward_form("转发内容", Some("https://image.coolapk.com/feed/test.png"), "feed-42");
    let value = |key: &str| form.iter().find(|(name, _)| *name == key).map(|(_, value)| value.as_str());
    assert_eq!(value("forwardid"), Some("feed-42"));
    assert_eq!(value("fid"), Some(""));
    assert_eq!(value("type"), Some("feed"));
    assert_eq!(value("pic"), Some("https://image.coolapk.com/feed/test.png"));
}

#[test]
fn test_hot_rank_routes_use_statistics_api() {
    assert_eq!(
        rank_feed_url("month"),
        Some("#/feed/statList?statType=30days&sortField=likenum")
    );
    assert_eq!(
        rank_feed_url("favorite"),
        Some("#/feed/statList?statType=7days&sortField=favnum")
    );
    assert_eq!(
        rank_feed_url("index"),
        Some("#/feed/statList?statType=7days&sortField=detailnum")
    );
    assert_eq!(rank_feed_url("unknown"), None);
}

#[test]
fn test_clean_feed_keeps_edit_metadata() {
    let raw = json!({
        "id": 123,
        "uid": 456,
        "username": "测试用户",
        "message": "测试正文",
        "isModified": 1,
        "change_count": 2,
        "last_change_time": 1_786_000_100_u64
    });

    let cleaned = CoolapkClient::clean_single_feed(&raw, 0).expect("动态应能正常清洗");
    assert_eq!(cleaned["isModified"], 1);
    assert_eq!(cleaned["changeCount"], 2);
    assert_eq!(cleaned["lastChangeTime"], 1_786_000_100_u64);
}

#[test]
fn test_clean_feed_keeps_apk_read_num() {
    let raw = json!({"id": 123, "uid": 456, "username": "测试用户", "message": "测试正文", "readNum": 604000, "hitnum": 12});
    let cleaned = CoolapkClient::clean_single_feed(&raw, 0).expect("动态应能正常清洗");
    assert_eq!(cleaned["readNum"], 604000);
}

#[test]
fn test_clean_feed_preserves_cloud_collection_state() {
    let raw = json!({
        "id": 123,
        "uid": 456,
        "username": "测试用户",
        "message": "测试正文",
        "userAction": {"collect": 1, "like": 0}
    });

    let cleaned = CoolapkClient::clean_single_feed(&raw, 0).expect("动态应能正常清洗");
    assert_eq!(cleaned["userAction"]["collect"], 1);
    assert_eq!(cleaned["userAction"]["like"], 0);
}

#[test]
fn test_clean_rating_feed_preserves_apk_rating_fields() {
    let raw = json!({
        "id": 123,
        "uid": 456,
        "username": "点评用户",
        "type": "rating",
        "message": "点评摘要",
        "v4_rating_message": "{\"性能\":\"性能评语\",\"续航\":\"续航评语\"}",
        "rating_score": 8,
        "rating_score_1": 9,
        "rating_item_info": [{"id": 1, "name": "续航", "star": 4, "starDesc": "不错"}],
        "filter_rating": 1,
        "comment_addition": "对象内容",
        "comment_good": "优点内容",
        "comment_general": "一般内容",
        "comment_bad": "缺点内容",
        "is_owner": 1,
        "target_row": {"id": 789, "title": "测试手机"}
    });

    let cleaned = CoolapkClient::clean_single_feed(&raw, 0).expect("只有点评字段的动态也应能正常清洗");
    assert_eq!(cleaned["feedType"], "rating");
    assert_eq!(cleaned["type"], "rating");
    assert_eq!(cleaned["message"], "点评摘要");
    assert_eq!(cleaned["ratingScore"], 8);
    assert_eq!(cleaned["ratingScore1"], 9);
    assert_eq!(cleaned["ratingItemInfo"][0]["name"], "续航");
    assert_eq!(cleaned["filterRating"], 1);
    assert_eq!(cleaned["commentAddition"], "对象内容");
    assert_eq!(cleaned["commentGood"], "优点内容");
    assert_eq!(cleaned["commentGeneral"], "一般内容");
    assert_eq!(cleaned["commentBad"], "缺点内容");
    assert_eq!(cleaned["isOwner"], 1);
    assert_eq!(cleaned["targetRow"]["title"], "测试手机");
}

#[test]
fn test_clean_feed_preserves_relation_and_video_fields() {
    let raw = json!({
        "id": 123,
        "uid": 456,
        "username": "测试用户",
        "target_row": {"id": 2967, "title": "黑神话：钟馗", "entityType": "game"},
        "relation_rows": [{"id": 2967, "title": "黑神话：钟馗"}],
        "extraRows": [{"id": 789, "title": "关联扩展卡片"}],
        "productRows": [{"id": 999, "title": "关联产品"}],
        "video_url": "https://example.com/video.mp4",
        "video_pic": "https://example.com/video.jpg",
        "video_duration": 900,
        "media_url": "https://video.example.com/media.mp4",
        "media_pic": "https://video.example.com/media.jpg",
        "media_info": "{\"mediaType\":\"video\",\"duration\":952183}",
        "media_type": "2",
        "feedType": "video",
        "feedTypeName": "视频"
    });

    let cleaned = CoolapkClient::clean_single_feed(&raw, 0).expect("带视频和关联标的的动态应能正常清洗");
    assert_eq!(cleaned["targetRow"]["id"], 2967);
    assert_eq!(cleaned["relationRows"][0]["title"], "黑神话：钟馗");
    assert_eq!(cleaned["extraRows"][0]["title"], "关联扩展卡片");
    assert_eq!(cleaned["productRows"][0]["title"], "关联产品");
    assert_eq!(cleaned["videoUrl"], "https://example.com/video.mp4");
    assert_eq!(cleaned["videoPic"], "https://example.com/video.jpg");
    assert_eq!(cleaned["videoDuration"], 900);
    assert_eq!(cleaned["mediaUrl"], "https://video.example.com/media.mp4");
    assert_eq!(cleaned["mediaPic"], "https://video.example.com/media.jpg");
    assert_eq!(cleaned["mediaInfo"], "{\"mediaType\":\"video\",\"duration\":952183}");
    assert_eq!(cleaned["mediaType"], "2");
    assert_eq!(cleaned["feedType"], "video");
}

#[test]
fn test_clean_answer_keeps_parent_question_id() {
    let raw = json!({
        "id": 123,
        "uid": 456,
        "username": "回答用户",
        "feedType": "answer",
        "fid": 789,
        "message": "回答正文"
    });

    let cleaned = CoolapkClient::clean_single_feed(&raw, 0).expect("回答动态应能正常清洗");
    assert_eq!(cleaned["feedType"], "answer");
    assert_eq!(cleaned["questionId"], 789);
}

#[test]
fn test_clean_forward_keeps_source_feed() {
    let raw = json!({"id": 124, "uid": 456, "username": "转发用户", "message": "转发内容", "forwardid": "123", "forwardSourceType": "feed", "forwardSourceFeed": {"id": "123", "entityType": "feed", "username": "原作者", "message": "原动态内容"}});
    let cleaned = CoolapkClient::clean_single_feed(&raw, 0).expect("转发动态应能正常清洗");
    assert_eq!(cleaned["forwardId"], "123");
    assert_eq!(cleaned["forwardSourceType"], "feed");
    assert_eq!(cleaned["forwardSourceFeed"]["message"], "原动态内容");
}

#[test]
fn test_clean_feed_keeps_video_or_relation_only_items() {
    let video_only = json!({
        "id": 123,
        "uid": 456,
        "username": "视频用户",
        "videoUrl": "https://example.com/video.mp4"
    });
    let relation_only = json!({
        "id": 124,
        "uid": 456,
        "username": "关联用户",
        "relationRows": [{"id": 2967, "title": "黑神话：钟馗"}]
    });

    assert!(CoolapkClient::clean_single_feed(&video_only, 0).is_some());
    assert!(CoolapkClient::clean_single_feed(&relation_only, 1).is_some());
}

#[test]
fn test_user_page_data_url_allowlist() {
    assert!(CoolapkClient::is_allowed_user_page_url(
        "#/feed/userCoolPictureFeedList?fragmentTemplate=flex"
    ));
    assert!(CoolapkClient::is_allowed_user_page_url(
        "#/feed/nodeRatingList?uid=123&targetType=all&parseRatingToFeed=1"
    ));
    assert!(CoolapkClient::is_allowed_user_page_url(
        "#/feed/userDeleteFeedList"
    ));
    assert!(!CoolapkClient::is_allowed_user_page_url(
        "https://example.com/anything"
    ));
    assert!(!CoolapkClient::is_allowed_user_page_url(
        "#/feed/userCoolPictureFeedList?fragmentTemplate=flex&proxy=https://example.com"
    ));
}

#[test]
fn test_user_entity_rows_preserve_unknown_templates() {
    let raw = json!({
        "data": [
            {
                "entityType": "future_template",
                "entityTemplate": "server_v99",
                "title": "服务端新卡片",
                "unknownField": {"keep": true}
            },
            {
                "entityType": "card",
                "entities": [{"entityType": "apk", "id": 7, "title": "应用"}]
            }
        ]
    });
    let rows = CoolapkClient::extract_entity_rows(&raw);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["entityTemplate"], "server_v99");
    assert_eq!(rows[0]["unknownField"]["keep"], true);
    assert_eq!(rows[1]["id"], 7);
}

/// 随机设备码：每次调用生成不同结果（游客态/新账号首次生成随机并持久化）
#[test]
fn test_device_code_is_random() {
    let a = generate_random_device_code();
    let b = generate_random_device_code();
    assert_ne!(a, b, "两次生成的设备码不应相同");
    assert!(a.len() >= 60, "设备码应有足够长度");
    assert!(is_valid_device_code(&a), "生成的设备码必须符合官方规范格式");
    assert!(
        HeaderValue::from_str(&a).is_ok(),
        "设备码必须是合法 HTTP header 值"
    );
}

#[test]
fn test_account_cookie_requires_real_sessid() {
    assert!(CoolapkClient::has_valid_session_cookie(
        "SESSID=valid-session; uid=12345; username=test"
    ));
    assert!(!CoolapkClient::has_valid_session_cookie(
        "uid=12345; username=test; token=only-token"
    ));
    assert!(!CoolapkClient::has_valid_session_cookie(
        "SESSID=deleted; uid=12345"
    ));
    assert!(!CoolapkClient::has_valid_session_cookie(
        "SESSID=expired; uid=12345"
    ));
}

#[tokio::test]
#[ignore]
async fn test_reply_list_api() {
    let client = CoolapkClient::new();
    println!("=== Fetching feeds ===");
    let feeds = match client.get_index_v8_feeds(1).await {
        Ok(f) => f,
        Err(e) => {
            println!("Fetching feeds failed in CI: {e}");
            return;
        }
    };
    let feed_id = match feeds["data"]
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|f| f.get("replynum").and_then(|v| v.as_u64()).unwrap_or(0) > 0)
        })
        .and_then(|f| f.get("id").and_then(|v| v.as_str()))
    {
        Some(id) => id.to_string(),
        None => {
            println!("No valid feed with replynum found");
            return;
        }
    };
    println!("Target feed_id: {}", feed_id);

    println!("=== Fetching top level replies ===");
    let replies = match client.get_feed_replies(&feed_id, 1).await {
        Ok(r) => r,
        Err(e) => {
            println!("Fetching feed replies failed in CI: {e}");
            return;
        }
    };
    let replies_arr = replies["data"].as_array().unwrap();
    println!("Replies count: {}", replies_arr.len());

    // 找到有楼中楼的评论
    let mut target_cid = String::new();
    for r in replies_arr.iter() {
        let rrc = r
            .get("replyRowsCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if rrc > 2 {
            target_cid = r
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            println!(
                "Found comment with {} sub-replies: id={}, author={}",
                rrc,
                target_cid,
                r.get("username").and_then(|v| v.as_str()).unwrap_or("")
            );
            break;
        }
    }
    if target_cid.is_empty() {
        println!("No comment with >2 sub-replies found, skipping");
        return;
    }

    let embedded_ids: Vec<String> = replies_arr
        .iter()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(target_cid.as_str()))
        .and_then(|item| item.get("replyRows"))
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter_map(|row| row.get("id").map(value_to_string)).collect())
        .unwrap_or_default();
    println!("Embedded child IDs: {:?}", embedded_ids);

    // 测试 APK 对应的 replyList 子回复分页请求，并按上一页最后一条 ID 传递游标。
    let mut last_item = String::new();
    for page in 1..=5 {
        println!("\nTesting APK sub-reply request page={page}, feedType=feed_reply");
        let json = match client
            .get_sub_replies_paged(&feed_id, &target_cid, page, &last_item)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                println!("Sub-reply request failed: {error}");
                continue;
            }
        };
        let ids: Vec<String> = json
            .get("data")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.get("id").map(value_to_string))
                    .collect()
            })
            .unwrap_or_default();
        println!("Total items returned: {}, ids={ids:?}", ids.len());
        last_item = ids.last().cloned().unwrap_or_default();
    }
}

/// 验证公开动态在登录设备触发风控时，匿名设备仍可读取完整一级评论。
/// 该测试只输出评论数量与层级字段，不读取或打印任何登录凭据。
#[tokio::test]
#[ignore]
async fn probe_public_reply_list_for_single_comments() {
    let client = CoolapkClient::new();
    let query = [
        ("id", "72018814".to_string()),
        ("listType", "dateline_desc".to_string()),
        ("page", "1".to_string()),
        ("discussMode", "1".to_string()),
        ("feedType", "feed".to_string()),
        ("blockStatus", "0".to_string()),
        ("fromFeedAuthor", "0".to_string()),
    ];

    for (name, result) in [
        (
            "api2",
            client
                .public_api_get_from("https://api2.coolapk.com", "/v6/feed/replyList", &query)
                .await,
        ),
        (
            "api",
            client
                .public_api_get_from("https://api.coolapk.com", "/v6/feed/replyList", &query)
                .await,
        ),
    ] {
        match result {
            Ok(value) => {
                let rows = value
                    .get("data")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let summary: Vec<Value> = rows
                    .iter()
                    .map(|item| {
                        json!({
                            "id": item.get("id").cloned().unwrap_or(Value::Null),
                            "rid": item.get("rid").cloned().unwrap_or(Value::Null),
                            "rrid": item.get("rrid").cloned().unwrap_or(Value::Null),
                            "replyRowsCount": item
                                .get("replyRowsCount")
                                .cloned()
                                .unwrap_or(Value::Null),
                        })
                    })
                    .collect();
                let field_names = rows
                    .first()
                    .and_then(Value::as_object)
                    .map(|object| {
                        let mut names = object.keys().cloned().collect::<Vec<_>>();
                        names.sort();
                        names
                    })
                    .unwrap_or_default();
                let available_fields = [
                    "device_title",
                    "deviceTitle",
                    "floor",
                    "rank",
                    "ipLocation",
                    "ip_location",
                    "location",
                    "pic",
                    "picArr",
                    "images",
                    "verify_title",
                    "dateline",
                ]
                .into_iter()
                .filter(|field| {
                    rows.iter().any(|item| {
                        let value = item.get(*field).unwrap_or(&Value::Null);
                        !value.is_null()
                            && value.as_str().is_none_or(|text| !text.trim().is_empty())
                            && value.as_array().is_none_or(|items| !items.is_empty())
                    })
                })
                .collect::<Vec<_>>();
                let user_info_fields = rows
                    .iter()
                    .find_map(|item| item.get("userInfo").and_then(Value::as_object))
                    .map(|object| {
                        let mut names = object.keys().cloned().collect::<Vec<_>>();
                        names.sort();
                        names
                    })
                    .unwrap_or_default();
                let nested_fields = rows
                    .iter()
                    .filter_map(|item| item.get("replyRows").and_then(Value::as_array))
                    .flatten()
                    .find_map(Value::as_object)
                    .map(|object| {
                        let mut names = object.keys().cloned().collect::<Vec<_>>();
                        names.sort();
                        names
                    })
                    .unwrap_or_default();
                println!("{name}: count={}, rows={}", rows.len(), json!(summary));
                println!("{name}: first_fields={field_names:?}");
                println!("{name}: available_display_fields={available_fields:?}");
                println!("{name}: user_info_fields={user_info_fields:?}");
                println!("{name}: nested_fields={nested_fields:?}");
            }
            Err(error) => println!("{name}: error={error}"),
        }
    }
}

/// 探测评论是否存在可读取的详情接口，以确认能否补齐发表评论时的设备信息。
/// 只打印状态码和字段名，不打印评论正文、用户信息或登录凭据。
#[tokio::test]
#[ignore]
async fn probe_reply_detail_metadata() {
    let client = CoolapkClient::new();
    let reply_id = "601858220";

    for path in ["/v6/feed/detail", "/v6/feed/replyDetail", "/v6/feed/reply"] {
        let result = client
            .public_api_get_from(
                "https://api.coolapk.com",
                path,
                &[("id", reply_id.to_string())],
            )
            .await;

        match result {
            Ok(value) => {
                let data = value.get("data").unwrap_or(&Value::Null);
                let mut fields = data
                    .as_object()
                    .map(|object| object.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                fields.sort();
                let has_device = data.get("device_title").is_some()
                    || data.get("deviceTitle").is_some()
                    || data.get("device_name").is_some();
                let device_metadata = json!({
                    "device_title": data.get("device_title").and_then(Value::as_str).unwrap_or(""),
                    "device_name": data.get("device_name").and_then(Value::as_str).unwrap_or(""),
                    "device_build": data.get("device_build").and_then(Value::as_str).unwrap_or(""),
                    "device_rom": data.get("device_rom").and_then(Value::as_str).unwrap_or(""),
                    "useragent": data.get("useragent").and_then(Value::as_str).unwrap_or(""),
                });
                println!(
                    "path={path}, code={:?}, data_fields={fields:?}, has_device={has_device}, device_metadata={device_metadata}",
                    value.get("code")
                );
            }
            Err(error) => println!("path={path}, error={error}"),
        }
    }
}

#[test]
fn test_parse_reply_user_agent_keeps_real_device_metadata() {
    let user_agent = "Dalvik/2.1.0 (Linux; U; Android 16; 2210132C Build/BP2A.250605.031.A3) (#Build; Xiaomi; 2210132C; BP2A.250605.031.A3; HyperOS_3.0; 3.0.310.0) +CoolMarket/16.5.1";
    let (device_title, device_build, device_rom) = parse_reply_user_agent(user_agent);
    assert_eq!(device_title, "Xiaomi 2210132C");
    assert_eq!(device_build, "BP2A.250605.031.A3");
    assert_eq!(device_rom, "Android 16 · HyperOS 3.0.310.0");
}

#[test]
fn test_parse_reply_user_agent_android_rom_fallback_is_not_duplicated() {
    let ua = "Dalvik/2.1.0 (Linux; U; Android 16; 23113RKC6C Build/AQ3A.250226.002) (#Build; Redmi; 23113RKC6C; AQ3A.250226.002; 16) +CoolMarket/16.6.5-2610162-universal";
    let (title, build, rom) = parse_reply_user_agent(ua);
    assert_eq!(title, "Redmi 23113RKC6C");
    assert_eq!(build, "AQ3A.250226.002");
    assert_eq!(rom, "Android 16");
}

#[test]
fn test_user_agent_device_profile_headers_for_publish_request() {
    let client = CoolapkClient::new();
    let ua = "Dalvik/2.1.0 (Linux; U; Android 16; 2210132C Build/BP2A.250605.031.A3) (#Build; Xiaomi; 2210132C; BP2A.250605.031.A3; HyperOS_3.0; 3.0.310.0) +CoolMarket/16.6.5-2610162-universal";
    client.update_device_profile(DeviceProfile {
        user_agent: Some(ua.into()), manufacturer: Some("Xiaomi".into()),
        brand: Some("Xiaomi".into()), model: Some("2210132C".into()),
        build: Some("BP2A.250605.031.A3".into()), ..Default::default()
    });
    let request = client.apply_device_profile(client.api_client().unwrap().post("https://api.coolapk.com/v6/feed/createFeed"))
        .unwrap().build().unwrap();
    assert_eq!(request.headers().get(USER_AGENT).unwrap().to_str().unwrap(), ua);
    let code = request.headers().get("X-App-Device").unwrap().to_str().unwrap();
    assert_eq!(code, client.device_code.read().unwrap().as_str());
    let mut encoded: String = code.chars().rev().collect();
    while encoded.len() % 4 != 0 { encoded.push('='); }
    let decoded = String::from_utf8(BASE64.decode(encoded).unwrap()).unwrap();
    assert!(decoded.contains("; Xiaomi; Xiaomi; 2210132C; BP2A.250605.031.A3;"));
}

/// 模拟「登录 → 保存 Cookie → 落盘 JSON → 重启恢复 → 登出」完整链路（不依赖网络）
#[tokio::test]
async fn test_login_cookie_persistence_flow() {
    use std::path::PathBuf;

    let dir =
        std::env::temp_dir().join(format!("coolapk_desktop_login_test_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let cookie_file: PathBuf = dir.join("session_cookie.txt");
    let accounts_file: PathBuf = dir.join("accounts.json");

    // 1. 首次启动：无持久化凭据
    let client = CoolapkClient::new();
    client.persist_cookie_to(cookie_file.clone());
    assert_eq!(client.get_user_cookie(), None, "首次启动不应有 cookie");

    // 2. 模拟 Webview 授权登录：save_cookie_securely 内部调用 set_user_cookie
    let fake_cookie = "SESSID=abc123def456; uid=10086; Hm_lvt_xxx=1";
    client
        .save_account("10086", "测试用户", "", fake_cookie)
        .await
        .unwrap();
    assert_eq!(client.get_user_cookie(), Some(fake_cookie.to_string()));
    assert!(accounts_file.exists(), "登录后凭据应已写入 JSON 账户库");
    let root: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&accounts_file).unwrap()).unwrap();
    assert_eq!(
        root["lastLoginUid"].as_str(),
        Some("10086"),
        "JSON 库应记录当前登录 uid"
    );

    // 3. 模拟应用重启：新实例通过 persist_cookie_to 从 JSON 自动恢复
    let restarted = CoolapkClient::new();
    restarted.persist_cookie_to(cookie_file.clone());
    assert_eq!(
        restarted.get_user_cookie(),
        Some(fake_cookie.to_string()),
        "重启后应自动恢复登录凭据"
    );

    // 4. 模拟退出登录：clear_user_cookie 清空内存与当前登录标记（账户记录保留）
    restarted.clear_user_cookie().unwrap();
    assert_eq!(restarted.get_user_cookie(), None);
    let root2: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&accounts_file).unwrap()).unwrap();
    assert_eq!(
        root2["lastLoginUid"].as_str(),
        Some(""),
        "登出后当前登录标记应清空"
    );
    assert_eq!(
        root2["accounts"].as_array().map(|a| a.len()),
        Some(1),
        "账户记录应保留，便于下次快速切换"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// 未通过服务端校验的暂存 Cookie 不应在账户库留下空凭据幽灵账号：
/// set_user_cookie 会触发 sync_device_code → account_device_code，
/// 旧实现会为未知 uid 写入 { cookie: "" } 条目，导致“已保存账户”里的账号点登录报“该账户凭据为空”。
#[tokio::test]
async fn test_staged_cookie_does_not_create_credential_less_account() {
    use std::path::PathBuf;

    let dir = std::env::temp_dir().join(format!(
        "coolapk_desktop_phantom_account_test_{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let accounts_file: PathBuf = dir.join("accounts.json");

    let client = CoolapkClient::new();
    client.persist_cookie_to(dir.join("session_cookie.txt"));

    // 模拟 iOS 登录链路：校验前先暂存 WebView Cookie（服务端校验随后失败）
    client
        .set_user_cookie("SESSID=staged-only; uid=4441808".to_string())
        .unwrap();

    // 设备码仍应可用，但不得产生任何账户条目
    assert!(
        client.effective_custom_device_id().is_none(),
        "该用例不应带自定义设备 ID"
    );
    let accounts = client.load_accounts();
    assert!(
        accounts.is_empty(),
        "暂存 Cookie 不得写入账户库"
    );
    let exists = accounts_file.exists();
    if exists {
        let root: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&accounts_file).unwrap()).unwrap();
        assert_eq!(
            root["accounts"].as_array().map(|a| a.len()),
            Some(0),
            "账户库不应含空凭据条目"
        );
    }

    // 正常保存账户后，设备码仍写入该账户记录（原有行为保留）
    client
        .save_account("4441808", "酷友", "", "SESSID=real-session; uid=4441808")
        .await
        .unwrap();
    let accounts = client.load_accounts();
    assert_eq!(accounts.len(), 1, "真实登录应恰好写入一个账户");
    assert_eq!(accounts[0]["uid"].as_str(), Some("4441808"));
    assert!(
        !accounts[0]["cookie"].as_str().unwrap_or("").is_empty(),
        "已保存账户必须带有效凭据"
    );
    assert!(
        accounts[0]["deviceCode"].as_str().is_some_and(|c| !c.is_empty()),
        "账户存在时仍应记录设备码"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// HTTP 客户端必须能成功初始化 TLS 后端：
/// 捕获 rustls 多 provider 冲突、use_preconfigured_tls 版本不匹配、
/// 以及 Apple 平台系统信任库配置失败等问题。
#[test]
fn test_http_client_builder_initializes_tls_backend() {
    let client = http_client_builder().build();
    assert!(
        client.is_ok(),
        "HTTP 客户端应能初始化 TLS 后端：{:?}",
        client.err()
    );

    // 带默认头与重定向策略的组合也必须可用（登录/API 主客户端走这条路径）
    let configured = http_client_builder()
        .redirect(reqwest::redirect::Policy::none())
        .build();
    assert!(
        configured.is_ok(),
        "带重定向策略的客户端应能初始化：{:?}",
        configured.err()
    );
}

/// 传输失败原因链用于定位真因（DNS / 证书 / 代理），且不得泄露请求 URL。
#[test]
fn test_transport_cause_chain_reports_root_source() {
    use std::error::Error;
    use std::fmt;

    #[derive(Debug)]
    struct Root;
    #[derive(Debug)]
    struct Middle(Root);
    #[derive(Debug)]
    struct Outer(Middle);

    impl fmt::Display for Root {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "invalid peer certificate: UnknownIssuer")
        }
    }
    impl fmt::Display for Middle {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "tls handshake failed")
        }
    }
    impl fmt::Display for Outer {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "error sending request")
        }
    }
    impl Error for Root {}
    impl Error for Middle {
        fn source(&self) -> Option<&(dyn Error + 'static)> {
            Some(&self.0)
        }
    }
    impl Error for Outer {
        fn source(&self) -> Option<&(dyn Error + 'static)> {
            Some(&self.0)
        }
    }

    let chain = error_cause_chain(&Outer(Middle(Root)));
    assert!(
        chain.contains("UnknownIssuer"),
        "应透出最深层根因：{chain}"
    );
    assert!(
        chain.contains(" <- "),
        "多层 source 应以箭头连接：{chain}"
    );
    assert!(
        !chain.contains("http") && !chain.contains("coolapk"),
        "原因链不应包含 URL：{chain}"
    );

    // 无 source 时返回固定占位，避免日志出现空字段
    assert_eq!(error_cause_chain(&Root), "none");
}

/// 网页外壳噪音剔除 + 正文提取：酷安 /feed/ 分享页只有导航/页脚/扫码提示，
/// 提取后不应残留导航与页脚链接
#[test]
fn test_extract_readable_content_strips_chrome() {
    let html = r#"<!DOCTYPE html>
<html><head><title>动态分享 - 酷安</title></head>
<body>
<header><a href="/">酷安</a><a href="/editorChoice">编辑精选</a></header>
<nav><a href="/apk/">应用</a><a href="/game/">游戏</a><a href="/u/10086">测试用户</a></nav>
<div>您当前查看的是「动态分享」，请用酷安手机APP扫码查看详情<br>下载酷安手机APP</div>
<article>
<p>在家用 Windows 刷酷安的新方式——</p>
<a href="/t/数码日常">#数码日常#</a>
</article>
<footer><a href="/about/contact.html">联系酷安</a><span>粤ICP备15030494号</span></footer>
<script>alert(1)</script>
</body></html>"#;

    let cleaned = extract_readable_content(html);
    assert!(cleaned.contains("在家用 Windows 刷酷安"), "正文应保留");
    assert!(cleaned.contains("#数码日常#"), "正文链接应保留");
    assert!(!cleaned.contains("编辑精选"), "导航不应残留");
    assert!(!cleaned.contains("测试用户"), "导航用户链接不应残留");
    assert!(!cleaned.contains("粤ICP备"), "页脚不应残留");
    assert!(!cleaned.contains("alert"), "脚本不应残留");
    assert!(!cleaned.contains("<script"), "script 标签不应残留");
}

/// 无 article/main 容器时退化为整体剥壳结果，且自闭合/未闭合标签不 panic
#[test]
fn test_extract_readable_content_fallback_safe() {
    let html = r#"<html><body><nav>导航</nav><div><br/><img src="a.png">正文内容</div><footer>页脚</footer></body></html>"#;
    let cleaned = extract_readable_content(html);
    assert!(cleaned.contains("正文内容"));
    assert!(!cleaned.contains("导航"));
    assert!(!cleaned.contains("页脚"));

    let broken = "<article>无闭合正文...<div>内容";
    let out = extract_readable_content(broken);
    assert!(out.contains("无闭合正文"));
}

/// 浏览历史/最近访问实体没有 username/userInfo，
/// 必须能原样保留（此前走 clean_single_feed 会被全部丢弃）
#[test]
fn test_extract_history_list_preserves_entities() {
    let raw = json!({
        "data": [
            {
                "title": "测试用户",
                "description": "",
                "logo": "http://avatar.coolapk.com/test_avatar_middle.jpg",
                "url": "u/10086",
                "historyType": "user",
                "typeName": "用户",
                "id": "user:10086",
                "entityType": "history",
                "dateline": 1786022084
            },
            {
                "id": 247872765,
                "uid": 10086,
                "target_type": "apk",
                "entityType": "recentHistory",
                "entityId": 247872765,
                "target_type_title": "应用",
                "title": "哔哩哔哩",
                "url": "/apk/tv.danmaku.bili",
                "logo": "//pp.myapp.com/ma_icon/0/icon/256",
                "follow_num": 25289
            }
        ]
    });

    let list = CoolapkClient::extract_history_list(&raw);
    assert_eq!(list.len(), 2, "历史实体不能被丢弃");

    let history = &list[0];
    assert_eq!(history["entityType"], "history");
    assert_eq!(history["url"], "/u/10086", "url 应补全前导斜杠");
    assert_eq!(
        history["logo"], "https://avatar.coolapk.com/test_avatar_middle.jpg",
        "http 图片应升级为 https"
    );

    let recent = &list[1];
    assert_eq!(recent["entityType"], "recentHistory");
    assert_eq!(
        recent["url"], "/apk/tv.danmaku.bili",
        "已有前导斜杠的 url 不应被改动"
    );
    assert_eq!(
        recent["logo"], "https://pp.myapp.com/ma_icon/0/icon/256",
        "// 开头图片应补全 https"
    );
}

/// 数码品牌/分类实体没有 username/author/dyh_name，
/// 必须原样保留（此前走 clean_single_feed 会被全部丢弃，导致分类页为空）
#[test]
fn test_extract_product_entity_list_preserves_brands() {
    let raw = json!({
        "code": 200,
        "data": [
            {
                "id": 1,
                "title": "Apple",
                "logo": "http://image.coolapk.com/logo/apple.png",
                "product_num": 120,
                "entityType": "brand"
            },
            {
                "entityId": 2,
                "name": "华为",
                "pic": "//image.coolapk.com/logo/huawei.png",
                "series_num": 88,
                "entityType": "brand"
            },
            {
                "entityTemplate": "productGroupTitle",
                "title": "Mate 系列"
            },
            {
                "entityTemplate": "productGroupMore",
                "title": "查看更多",
                "url": "/product/more"
            },
            {
                "entityType": "header",
                "title": "热门品牌"
            }
        ]
    });

    let list = CoolapkClient::extract_product_entity_list(&raw);
    assert_eq!(list.len(), 4, "品牌实体和产品组结构卡不能被丢弃，普通占位应被过滤");

    let apple = &list[0];
    assert_eq!(apple["title"], "Apple");
    assert_eq!(apple["product_num"], 120);

    let huawei = &list[1];
    assert_eq!(huawei["name"], "华为");
    assert_eq!(huawei["series_num"], 88);
    assert_eq!(list[2]["entityTemplate"], "productGroupTitle");
    assert_eq!(list[3]["entityTemplate"], "productGroupMore");
}

#[test]
fn test_interaction_response_preserves_user_only_rows() {
    let raw = json!({
        "code": 200,
        "data": [{"uid": "10086", "username": "点赞用户"}]
    });

    let wrapped = wrap_api_data(raw).expect("互动列表响应应能正常包装");
    assert_eq!(wrapped["data"][0]["uid"], "10086");
    assert_eq!(wrapped["data"][0]["username"], "点赞用户");
}

#[test]
fn comment_response_preserves_captcha_without_message() {
    let raw = json!({"code": 403, "messageStatus": "err_request_captcha_v2", "messageExtra": {"captchaId": "test"}});
    let error = comment_list_data(raw.clone()).unwrap_err();
    assert_eq!(serde_json::from_str::<Value>(&error).unwrap(), raw);
}

#[test]
fn comment_response_distinguishes_empty_data_from_failure() {
    assert!(comment_list_data(json!({"data": []})).unwrap().is_empty());
    assert_eq!(comment_list_data(json!({"data": [{"id": "123"}]})).unwrap().len(), 1);
    assert!(comment_list_data(json!({"code": 403})).is_err());
    assert_eq!(comment_list_data(json!({"code": 403, "message": "无权访问"})).unwrap_err(), "无权访问");
    assert!(comment_list_data(json!({"code": 200, "data": {}})).is_err());
    assert!(comment_list_data(json!({"status": -1, "message": "网络异常"})).is_err());
}

#[test]
fn comment_response_captcha_query_preserves_pagination() {
    let mut query = vec![("page", "2".into()), ("lastItem", "123".into())];
    append_comment_captcha_token(&mut query, Some("validated"), Some("_challenge_token"));
    assert_eq!(query, vec![("page", "2".into()), ("lastItem", "123".into()), ("_challenge_token", "validated".into())]);
    let mut query = Vec::new();
    append_comment_captcha_token(&mut query, Some("validated"), Some("id"));
    assert_eq!(query, vec![("_v2_post_token", "validated".into())]);
    let mut query = vec![("id", "123".into())];
    append_comment_captcha_token(&mut query, Some("NEC:test:validated"), Some(""));
    assert_eq!(query, vec![("id", "123".into())]);
}

#[test]
fn comment_response_validation_cookie_preserves_session_and_encodes_token() {
    assert_eq!(cookie_with_captcha_validation("uid=123; SESSID=test; validate=expired", Some("NEC:test:abc+def/=")),
        "uid=123; SESSID=test; validate=NEC%3Atest%3Aabc%2Bdef%2F%3D");
    assert_eq!(cookie_with_captcha_validation("", Some("NEC:test:validated")), "validate=NEC%3Atest%3Avalidated");
    assert_eq!(cookie_with_captcha_validation("uid=123", None), "uid=123");
}

#[test]
fn comment_response_validation_survives_account_changes_logout_and_restart() {
    let dir = std::env::temp_dir().join(format!("coolapk_captcha_reuse_{}_{}", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir(&dir).unwrap();
    let client = CoolapkClient::new();
    client.persist_cookie_to(dir.join("session_cookie.txt"));
    assert_eq!(client.validation_for_request(None).unwrap(), None);
    client.validation_for_request(Some("NEC:test:first")).unwrap();
    client.set_user_cookie("uid=123; SESSID=synthetic".into()).unwrap();
    client.set_user_cookie("uid=456; SESSID=synthetic".into()).unwrap();
    client.clear_user_cookie().unwrap();
    assert_eq!(client.validation_for_request(None).unwrap().as_deref(), Some("NEC:test:first"));
    let restarted = CoolapkClient::new();
    restarted.persist_cookie_to(dir.join("session_cookie.txt"));
    assert_eq!(restarted.validation_for_request(None).unwrap().as_deref(), Some("NEC:test:first"));
    restarted.validation_for_request(Some("NEC:test:replacement")).unwrap();
    assert_eq!(restarted.validation_for_request(None).unwrap().as_deref(), Some("NEC:test:replacement"));
    assert_eq!(restarted.validation_for_request(Some("")).unwrap().as_deref(), Some("NEC:test:replacement"));
    std::fs::remove_file(dir.join("accounts.json")).unwrap();
    std::fs::remove_dir(dir).unwrap();
}

#[test]
fn test_extract_product_entity_list_flattens_nested_entities() {
    let raw = json!({
        "code": 200,
        "data": [
            {
                "title": "分类组",
                "entities": [
                    { "id": "c1", "title": "手机" },
                    { "entities": [{ "id": "c2", "title": "平板" }] }
                ]
            }
        ]
    });

    let list = CoolapkClient::extract_product_entity_list(&raw);
    assert_eq!(list.len(), 2, "嵌套 entities 应被摊平");
    assert_eq!(list[0]["id"], "c1");
    assert_eq!(list[1]["id"], "c2");
}

#[test]
fn test_discovery_request_args_filters_reserved_and_unsafe_values() {
    let args = parse_discovery_request_args(
        r#"{"type":"phone","sort":"hot","page":99,"bad key":"x","nested":{"mode":"new"},"empty":null,"line":"a\n b"}"#,
    );
    assert_eq!(args.len(), 3);
    assert!(args.contains(&("type".to_string(), "phone".to_string())));
    assert!(args.contains(&("sort".to_string(), "hot".to_string())));
    assert!(args.contains(&("nested".to_string(), r#"{"mode":"new"}"#.to_string())));
    assert!(!args.iter().any(|(key, _)| key == "page" || key == "bad key" || key == "empty" || key == "line"));
}

#[test]
fn test_product_entity_page_response_keeps_pagination_metadata() {
    let raw = serde_json::json!({
        "data": [{ "id": 1, "title": "手机", "entityType": "product" }],
        "firstItem": "1",
        "lastItem": "1",
        "hasMore": true,
        "total": 42,
        "pagination": { "current": 1 }
    });
    let response = CoolapkClient::product_entity_page_response(&raw);
    assert_eq!(response["data"].as_array().map(|items| items.len()), Some(1));
    assert_eq!(response["firstItem"], "1");
    assert_eq!(response["lastItem"], "1");
    assert_eq!(response["hasMore"], true);
    assert_eq!(response["total"], 42);
    assert_eq!(response["pagination"]["current"], 1);
}

/// 模拟 Webview 登录脚本捕获到的真实 Cookie 形态（含中文/换行等脏字符），
/// 验证 set_user_cookie 的 ASCII 清洗与落盘逻辑不会崩坏
#[tokio::test]
async fn test_login_cookie_dirty_input_sanitized() {
    use std::path::PathBuf;

    let dir = std::env::temp_dir().join(format!(
        "coolapk_desktop_sanitize_test_{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let cookie_file: PathBuf = dir.join("session_cookie.txt");

    let client = CoolapkClient::new();
    client.persist_cookie_to(cookie_file.clone());

    let dirty = "SESSID=abc;\r\n uid=10086; 昵称=测试用户; other=\"v\"";
    client.set_user_cookie(dirty.to_string()).unwrap();
    // 先建立账户，set_user_cookie 才会同步写 JSON 账户库
    client
        .save_account("10086", "测试用户", "", dirty)
        .await
        .unwrap();
    client.set_user_cookie(dirty.to_string()).unwrap();

    let stored = client.get_user_cookie().unwrap();
    assert!(
        !stored.contains('\r') && !stored.contains('\n'),
        "不应包含换行"
    );
    assert!(stored.contains("SESSID=abc") && stored.contains("uid=10086"));
    // 落盘 JSON 账户库中的 cookie 字段必须是清洗后的安全形态
    let accounts_file: PathBuf = dir.join("accounts.json");
    let root: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&accounts_file).unwrap()).unwrap();
    let cookie = root["accounts"][0]["cookie"].as_str().unwrap_or("");
    assert!(
        !cookie.contains('\r') && !cookie.contains('\n'),
        "JSON 库中 cookie 不应包含换行"
    );
    assert!(
        cookie.contains("SESSID=abc") && cookie.contains("uid=10086"),
        "cookie 应保留有效字段"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// 验证修复后的 get_fans_user_list 返回真实粉丝（需登录）
#[tokio::test]
#[ignore]
async fn verify_fans_user_list_fixed() {
    let client = CoolapkClient::new();
    let accounts_path =
        std::path::Path::new(r"C:\Users\admin\AppData\Roaming\com.coolapk.desktop\accounts.json");
    if let Ok(content) = std::fs::read_to_string(accounts_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(cookie) = json["accounts"][0]["cookie"].as_str() {
                let _ = client.set_user_cookie(cookie.to_string());
            }
        }
    }

    let current_uid = client
        .get_user_cookie()
        .unwrap_or_default()
        .split(';')
        .find_map(|item| {
            let (key, value) = item.trim().split_once('=')?;
            key.eq_ignore_ascii_case("uid")
                .then(|| value.trim().to_string())
        })
        .unwrap_or_default();
    if current_uid.is_empty() {
        println!("[fixed fansList] skipped: no authenticated account");
        return;
    }

    match client.get_fans_user_list(&current_uid, 1).await {
        Ok(res) => {
            let arr = res["data"].as_array().cloned().unwrap_or_default();
            println!("[fixed fansList] len={}", arr.len());
            for u in arr.iter().take(5) {
                let uid = u
                    .get("uid")
                    .map(serde_json::to_string)
                    .and_then(Result::ok)
                    .unwrap_or_default();
                let name = u
                    .get("username")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                // 测试日志只报告字段是否存在，避免输出真实用户信息。
                println!("  has_uid={} has_username={}", !uid.is_empty(), !name.is_empty());
            }
        }
        Err(e) => println!("[fixed fansList] ERROR: {}", e),
    }
}

#[tokio::test]
#[ignore]
async fn test_live_oss_and_reply() {
    let client = CoolapkClient::new();
    client.persist_cookie_to(std::path::PathBuf::from(r"C:\Users\daimi\AppData\Roaming\com.coolapk.desktop\session_cookie.txt"));

    // Set a valid structured device code
    let valid_dev = ";t00LjQwODAzMjEuMVFLVTsgTzZDS1IzMTExMzIgO2ltb2FpWDsgO2ltb2FpWCA7IDsgOyA7IDRkM2MyYjFhNmY1ZTRrN2M".to_string();
    if let Ok(mut auth) = client.auth.write() {
        auth.set_device_code(valid_dev.clone());
    }
    if let Ok(mut guard) = client.device_code.write() {
        *guard = valid_dev.clone();
    }

    // 真实接口测试也不能把用户 ID 或设备码写入日志。
    println!("已设置测试设备信息");

    let fake_png: Vec<u8> = vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
        0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
        0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78,
        0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    println!("\n=== TESTING UPLOAD IMAGE (REAL CALL) ===");
    let upload_res = client
        .upload_image(&fake_png, "test_dot.png", "image/png", "feed", None)
        .await;
    println!("上传请求成功={}", upload_res.is_ok());
}

#[test]
fn test_generate_device_code_with_device_id() {
    let custom_id = "DU-MOCK-TEST-DEVICE-ID-99999999";
    let code = generate_device_code_with_device_id(custom_id, Some("23113RKC6C"), Some("AQ3A.250226.002"));
    assert!(is_valid_device_code(&code));

    let mut rev_code: String = code.chars().rev().collect();
    while rev_code.len() % 4 != 0 {
        rev_code.push('=');
    }
    let decoded_bytes = BASE64.decode(rev_code.as_bytes()).expect("base64 decode failed");
    let decoded = String::from_utf8(decoded_bytes).expect("valid utf8");
    assert!(decoded.starts_with(&format!("{custom_id}; ; ; ; Xiaomi; Xiaomi; 23113RKC6C; AQ3A.250226.002; ")));
}

#[test]
fn test_update_device_profile_with_device_id() {
    let client = CoolapkClient::new();
    let custom_id = "DU-MOCK-TEST-DEVICE-ID-99999999";

    client.update_device_profile(DeviceProfile {
        device_id: Some(custom_id.to_string()),
        model: Some("23113RKC6C".to_string()),
        build: Some("AQ3A.250226.002".to_string()),
        ..Default::default()
    });

    assert_eq!(client.effective_custom_device_id(), Some(custom_id.to_string()));

    let info = client.get_device_info().expect("get_device_info");
    assert_eq!(info["data"]["deviceId"].as_str(), Some(custom_id));

    let active_code = client.device_code.read().unwrap().clone();
    assert!(is_valid_device_code(&active_code));
}

#[test]
fn test_device_profile_preserves_identity_and_updates_all_model_fields() {
    let raw = "stable-id; ; ; ; Xiaomi; Xiaomi; old-model; old-build; stable-oaid";
    let code: String = BASE64.encode(raw).chars().rev().filter(|c| *c != '=').collect();
    let profile = DeviceProfile {
        manufacturer: Some("Samsung".into()),
        brand: Some("samsung".into()),
        model: Some("SM-S9280".into()),
        build: Some("actual-build".into()),
        ..Default::default()
    };
    let decode = |code: String| {
        let mut encoded: String = code.chars().rev().collect();
        while encoded.len() % 4 != 0 { encoded.push('='); }
        String::from_utf8(BASE64.decode(encoded).unwrap()).unwrap()
    };
    assert_eq!(decode(device_code_with_profile(&code, &profile)),
        "stable-id; ; ; ; Samsung; samsung; SM-S9280; actual-build; stable-oaid");
    assert_eq!(decode(device_code_with_profile(&code, &DeviceProfile::default())),
        "stable-id; ; ; ; Xiaomi; Redmi; 23113RKC6C; AQ3A.250226.002; stable-oaid");
    assert_eq!(device_code_with_profile("invalid", &profile), "invalid");
}

#[test]
fn test_device_profile_model_applies_without_custom_device_id() {
    let client = CoolapkClient::new();
    client.update_device_profile(DeviceProfile {
        manufacturer: Some("Samsung".into()), brand: Some("samsung".into()),
        model: Some("SM-S9280".into()), build: Some("actual-build".into()),
        ..Default::default()
    });
    assert_eq!(client.effective_custom_device_id(), None);
    let active = client.device_code.read().unwrap().clone();
    let mut encoded: String = active.chars().rev().collect();
    while encoded.len() % 4 != 0 { encoded.push('='); }
    let decoded = String::from_utf8(BASE64.decode(encoded).unwrap()).unwrap();
    assert!(decoded.contains("; Samsung; samsung; SM-S9280; actual-build;"));
    assert!(is_valid_device_code(&active));
}

#[test]
fn test_native_device_profile_survives_settings_sync_and_custom_reset() {
    let mut client = CoolapkClient::new();
    let native_ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) (#Build; Apple; iPhone17,3; 22A3354; 18.0) +CoolMarket/16.6.5-2610162-universal";
    client.native_device_profile = DeviceProfile {
        manufacturer: Some("Apple".into()), brand: Some("Apple".into()),
        model: Some("iPhone17,3".into()), build: Some("22A3354".into()),
        user_agent: Some(native_ua.into()), ..Default::default()
    };
    let verify = |expected_ua: &str, expected_model_fields: &str| {
        let request = client.apply_device_profile(client.api_client().unwrap().post("https://api.coolapk.com/v6/feed/createFeed"))
            .unwrap().build().unwrap();
        assert_eq!(request.headers().get(USER_AGENT).unwrap().to_str().unwrap(), expected_ua);
        let code = request.headers().get("X-App-Device").unwrap().to_str().unwrap();
        let mut encoded: String = code.chars().rev().collect();
        while encoded.len() % 4 != 0 { encoded.push('='); }
        let decoded = String::from_utf8(BASE64.decode(encoded).unwrap()).unwrap();
        assert!(decoded.starts_with("saved-device-id;"));
        assert!(decoded.contains(expected_model_fields));
    };
    // 前端关闭自定义时仍发送保存的设备 ID，不能抹掉本机信息。
    client.update_device_profile(DeviceProfile { device_id: Some("saved-device-id".into()), ..Default::default() });
    verify(native_ua, "; Apple; Apple; iPhone17,3; 22A3354;");
    assert_eq!(client.get_device_info().unwrap()["data"]["defaultProfile"]["source"], "native");
    client.update_device_profile(DeviceProfile {
        device_id: Some("saved-device-id".into()), manufacturer: Some("Xiaomi".into()), brand: Some("Redmi".into()),
        model: Some("24117RK2CC".into()), build: Some("custom-build".into()),
        user_agent: Some("custom-user-agent".into()), ..Default::default()
    });
    verify("custom-user-agent", "; Xiaomi; Redmi; 24117RK2CC; custom-build;");
    client.update_device_profile(DeviceProfile { device_id: Some("saved-device-id".into()), ..Default::default() });
    verify(native_ua, "; Apple; Apple; iPhone17,3; 22A3354;");
}

// 关注流需要保留官方卡片，不能把内部酷友实体清洗成动态。
#[test]
fn following_list_preserves_official_icon_card() {
    let card = serde_json::json!({ "entityType": "card", "entityTemplate": "iconScrollCard", "url": "/user/recentUpdateList", "entities": [{ "entityType": "user", "uid": "20", "username": "酷友", "url": "/u/20" }] });
    let raw = serde_json::json!({ "data": [card.clone(), { "entityType": "feed", "id": "123", "uid": "30", "username": "作者", "message": "动态" }] });
    let rows = CoolapkClient::extract_following_list(&raw);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0], card);
    assert_eq!(rows[1]["id"], "123");
}

// 官方页面仅下发头像栏时必须继续回退，同时保留原始入口与用户顺序。
#[test]
fn following_card_only_page_does_not_stop_feed_fallback() {
    let card = json!({ "entityType": "card", "entityTemplate": "iconScrollCard", "url": "/user/recentUpdateList", "entities": [{ "entityType": "user", "uid": "20", "username": "酷友" }] });
    let mut rows = Vec::new();
    assert!(!CoolapkClient::merge_following_page(&mut rows, &json!({ "data": [card.clone()] })));
    assert!(!CoolapkClient::merge_following_page(&mut rows, &json!({ "data": [] })));
    assert_eq!(rows, vec![card.clone()]);
    let fallback = json!({ "data": [card.clone(), { "entityType": "feed", "id": "123", "uid": "30", "username": "作者", "message": "动态" }] });
    assert!(CoolapkClient::merge_following_page(&mut rows, &fallback));
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0], card);
    assert_eq!(rows[1]["id"], "123");
}

#[test]
fn test_feed_cleaning_preserves_official_top_fields() {
    let raw = json!({ "id": "42", "uid": "123", "username": "作者", "message": "正文",
        "isStickTop": 1, "is_editor_title_top": 0, "collectionItem": { "is_top": 1 }, "topInfo": { "title": "推荐" } });
    let cleaned = CoolapkClient::clean_single_feed(&raw, 0).unwrap();
    for key in ["isStickTop", "is_editor_title_top", "collectionItem", "topInfo"] {
        assert_eq!(cleaned[key], raw[key]);
    }
}
