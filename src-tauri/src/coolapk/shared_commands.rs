/// 诊断日志只记录预定义类别，避免把服务器响应、Cookie 或授权码写入日志。
fn login_failure_kind(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("captcha") || error.contains("验证码") {
        "captcha"
    } else if lower.contains("http 401") {
        "http_401"
    } else if lower.contains("http 403") {
        "http_403"
    } else if lower.contains("http 429") || lower.contains("rate_limit") {
        "rate_limit"
    } else if lower.contains("http 5") {
        "http_5xx"
    } else if lower.contains("http 4") {
        "http_4xx"
    } else if lower.contains("timed out") || lower.contains("timeout") || error.contains("超时") {
        "timeout"
    } else if lower.contains("error sending request")
        || lower.contains("failed to send")
        || lower.contains("connection")
        || lower.contains("connect error")
    {
        "transport"
    } else if lower.contains("sessid") || error.contains("会话") {
        "invalid_session"
    } else if error.contains("没有登录凭据") || error.contains("没有带回登录 Cookie") {
        "missing_cookie"
    } else if error.contains("未返回完整登录信息") || error.contains("未通过账号校验") {
        "invalid_account_response"
    } else if lower.contains("invalid coolapk json")
        || lower.contains("failed to read coolapk response")
    {
        "invalid_response"
    } else if error.contains("登录信息有误") || error.contains("未登录") {
        "authentication"
    } else {
        "other"
    }
}


// Shared Tauri and Web command definitions. Adding an operation here exposes it over HTTP.

shared_commands! {

async fn get_index_v8_feeds(state, page: u32) -> Value {
    state.client.get_index_v8_feeds(page).await
}

async fn get_index_v8_feeds_paged(state,
    page: u32,
    first_item: String,
    last_item: String,
) -> Value {
    state
        .client
        .get_index_v8_feeds_paged(page, &first_item, &last_item)
        .await
}

async fn get_index_v8_entities_paged(state,
    page: u32,
    first_item: String,
    last_item: String,
) -> Value {
    state
        .client
        .get_index_v8_entities_paged(page, &first_item, &last_item)
        .await
}

async fn get_tab_config(state) -> Value {
    state.client.get_tab_config().await
}

async fn update_home_tab_config(state,
    config_json: String,
) -> Value {
    state.client.update_home_tab_config(&config_json).await
}

async fn get_discovery_config(state) -> Value {
    state.client.get_discovery_config().await
}

async fn get_discovery_page_data(state,
    url: String,
    title: String,
    sub_title: String,
    page: u32,
    first_item: String,
    last_item: String,
    page_context: String,
    request_args_json: Option<String>,
) -> Value {
    state
        .client
        .get_discovery_page_data(
            &url,
            &title,
            &sub_title,
            page,
            &first_item,
            &last_item,
            &page_context,
            request_args_json.as_deref().unwrap_or(""),
        )
        .await
}

async fn get_live_detail(state, live_id: String) -> Value {
    state.client.get_live_detail(&live_id).await
}

async fn get_search_suggestions(state,
    query: String,
) -> Value {
    state.client.get_search_suggestions(&query).await
}

async fn get_topic_detail_v7(state, tag: String) -> Value {
    state.client.get_topic_detail_v7(&tag).await
}

async fn get_product_detail(state,
    product_id: String,
) -> Value {
    state.client.get_product_detail(&product_id).await
}

async fn get_product_feeds(state,
    product_id: String,
    feed_type: String,
    list_type: String,
    page: u32,
) -> Value {
    state
        .client
        .get_product_feeds(&product_id, &feed_type, &list_type, page)
        .await
}

async fn get_product_config(state,
    config_id: String,
) -> Value {
    state.client.get_product_config(&config_id).await
}

async fn add_config_compare(state,
    config_id: String,
) -> Value {
    state.client.add_config_compare(&config_id).await
}

async fn remove_config_compare(state,
    config_id: String,
) -> Value {
    state.client.remove_config_compare(&config_id).await
}

async fn get_product_brand_list(state) -> Value {
    state.client.get_product_brand_list().await
}

async fn get_product_category_list(state) -> Value {
    state.client.get_product_category_list().await
}

async fn get_product_list(state,
    url: String,
    title: String,
    sub_title: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state
        .client
        .get_product_list(&url, &title, &sub_title, page, first_item.as_deref().unwrap_or(""), last_item.as_deref().unwrap_or(""))
        .await
}

async fn get_product_brand_products(state,
    brand_id: String,
    brand_type: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state
        .client
        .get_product_brand_products(&brand_id, &brand_type, page, first_item.as_deref().unwrap_or(""), last_item.as_deref().unwrap_or(""))
        .await
}

async fn get_secondhand_brand_list(state) -> Value {
    state.client.get_secondhand_brand_list().await
}

async fn get_secondhand_product_list(state,
    brand_id: String,
    list_type: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state
        .client
        .get_secondhand_product_list(&brand_id, &list_type, page, first_item.as_deref().unwrap_or(""), last_item.as_deref().unwrap_or(""))
        .await
}

async fn get_product_media_list(state,
    product_id: String,
    media_type: String,
    is_recommend: i32,
    page: u32,
) -> Value {
    state
        .client
        .get_product_media_list(&product_id, &media_type, is_recommend, page)
        .await
}

async fn change_product_wish_status(state,
    product_id: String,
    status: i32,
) -> Value {
    state
        .client
        .change_product_wish_status(&product_id, status)
        .await
}

async fn change_product_follow_status(state,
    product_id: String,
    status: i32,
) -> Value {
    state
        .client
        .change_product_follow_status(&product_id, status)
        .await
}

async fn get_product_wish_list(state,
    product_id: String,
    page: u32,
) -> Value {
    state.client.get_product_wish_list(&product_id, page).await
}

async fn get_product_buy_list(state,
    product_id: String,
    page: u32,
) -> Value {
    state.client.get_product_buy_list(&product_id, page).await
}

async fn get_my_product_list(state,
    uid: String,
    product_type: String,
    page: u32,
) -> Value {
    state
        .client
        .get_my_product_list(&uid, &product_type, page)
        .await
}

async fn get_product_rating_chart(state,
    product_id: String,
) -> Value {
    state.client.get_product_rating_chart(&product_id).await
}

async fn get_product_subtab_feeds(state,
    product_id: String,
    sub_id: String,
    page: u32,
) -> Value {
    state.client.get_product_subtab_feeds(&product_id, &sub_id, page).await
}

async fn create_product_rating(state,
    product_id: String,
    score: i32,
    message: String,
    buy_status: bool,
) -> Value {
    state.client.create_product_rating(&product_id, score, &message, buy_status).await
}

async fn get_product_rating_list(state,
    product_id: String,
    star: i32,
    is_owner: i32,
    page: u32,
) -> Value {
    state
        .client
        .get_product_rating_list(&product_id, star, is_owner, page)
        .await
}

async fn get_apk_rating_user_list(state,
    apk_id: String,
    page: u32,
) -> Value {
    state.client.get_apk_rating_user_list(&apk_id, page).await
}

async fn change_rating_status(state,
    product_id: String,
    value: i32,
    uid: String,
    buy_status: Option<i32>,
    is_owner: Option<i32>,
) -> Value {
    state
        .client
        .change_rating_status(&product_id, value, &uid, buy_status, is_owner)
        .await
}

async fn get_dyh_detail(state, dyh_id: String) -> Value {
    state.client.get_dyh_detail(&dyh_id).await
}

async fn get_dyh_list(state, page: u32) -> Value {
    state.client.get_dyh_list(page).await
}

async fn get_dyh_feeds(state,
    dyh_id: String,
    feed_type: String,
    page: u32,
) -> Value {
    state.client.get_dyh_feeds(&dyh_id, &feed_type, page).await
}

async fn get_event_list(state, page: u32) -> Value {
    state.client.get_event_list(page).await
}

async fn get_event_detail(state,
    event_id: String,
) -> Value {
    state.client.get_event_detail(&event_id).await
}

async fn get_dyh_follow_list(state, page: u32) -> Value {
    state.client.get_dyh_follow_list(page).await
}

async fn get_dyh_subscribe_list(state,
    page: u32,
) -> Value {
    state.client.get_dyh_subscribe_list(page).await
}

async fn get_dyh_editor_list(state, page: u32) -> Value {
    state.client.get_dyh_editor_list(page).await
}

async fn get_feed_share_dyh_list(state, share_type: u32, page: u32) -> Value {
    state.client.get_feed_share_dyh_list(share_type, page).await
}

async fn share_feed_to_dyh(state, feed_id: String, dyh_ids: String, share_type: u32) -> Value {
    state.client.share_feed_to_dyh(&feed_id, &dyh_ids, share_type).await
}

async fn get_user_product_albums(state,
    uid: String,
    page: u32,
) -> Value {
    state.client.get_user_product_albums(&uid, page).await
}

async fn get_goods_list_items(state,
    uid: String,
    goods_id: String,
    page: u32,
) -> Value {
    state.client.get_goods_list_items(&uid, &goods_id, page).await
}

async fn create_product_album(state,
    title: String,
    description: String,
    album_type: u32,
    target_type: String,
    target_id: String,
    product_items: String,
) -> Value {
    state
        .client
        .create_product_album(
            &title,
            &description,
            album_type,
            &target_type,
            &target_id,
            &product_items,
        )
        .await
}

async fn get_node_feeds(state,
    node_type: String,
    node_id: String,
    page: u32,
) -> Value {
    state.client.get_node_feeds(&node_type, &node_id, page).await
}

async fn get_apk_feeds(state,
    package_name: String,
    sort_type: String,
    page: u32,
) -> Value {
    state
        .client
        .get_apk_feeds(&package_name, &sort_type, page)
        .await
}

async fn check_login_info(state) -> Value {
    let result = state.client.check_login_info().await;
    match &result {
        Ok(_) => log::info!("login.info_check_succeeded"),
        Err(error) => log::warn!(
            "login.info_check_failed reason={}",
            login_failure_kind(error)
        ),
    }
    result
}

async fn get_hot_feeds(state, page: u32) -> Value {
    state.client.get_hot_feeds(page).await
}

async fn get_rank_feeds(state,
    rank_type: String,
    page: u32,
    background: Option<bool>,
) -> Value {
    state
        .client
        .get_rank_feeds_with_mode(&rank_type, page, background.unwrap_or(false))
        .await
}

async fn get_latest_feeds(state, page: u32) -> Value {
    state.client.get_latest_feeds(page).await
}

async fn get_digest_feeds(state, page: u32) -> Value {
    state.client.get_digest_feeds(page).await
}

async fn get_cool_picture_rank(state, page: u32) -> Value {
    state.client.get_cool_picture_rank(page).await
}

async fn get_board_feeds(state,
    board_tag: String,
    page: u32,
    background: Option<bool>,
) -> Value {
    state
        .client
        .get_board_feeds_with_mode(&board_tag, page, background.unwrap_or(false))
        .await
}

async fn get_secondhand_feeds(state, page: u32) -> Value {
    state.client.get_secondhand_feeds(page).await
}

async fn get_hot_topics(state) -> Value {
    state.client.get_hot_topics().await
}

async fn get_favorite_list(state,
    fav_type: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state
        .client
        .get_favorite_list(
            &fav_type,
            page,
            first_item.as_deref().unwrap_or(""),
            last_item.as_deref().unwrap_or(""),
        )
        .await
}

async fn get_feed_collection_status(state,
    feed_id: String,
) -> Value {
    state.client.get_feed_collection_status(&feed_id).await
}

async fn update_collection_item(state,
    collection_ids: String,
    cancel_ids: String,
    target_id: String,
    feed_type: String,
    trace: String,
) -> Value {
    state
        .client
        .update_collection_item(
            &collection_ids,
            &cancel_ids,
            &target_id,
            &feed_type,
            &trace,
        )
        .await
}

async fn get_collection_list(state,
    uid: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state.client.get_collection_list(&uid, page, first_item.as_deref().unwrap_or(""), last_item.as_deref().unwrap_or("")).await
}

async fn get_collection_item_list(state,
    collection_id: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state
        .client
        .get_collection_item_list(
            &collection_id,
            page,
            first_item.as_deref().unwrap_or(""),
            last_item.as_deref().unwrap_or(""),
        )
        .await
}

async fn get_collection_detail(state,
    collection_id: String,
) -> Value {
    state.client.get_collection_detail(&collection_id).await
}

async fn create_collection(state,
    title: String,
    description: String,
    cover: String,
    is_open: i32,
    source_id: String,
) -> Value {
    state
        .client
        .create_collection(&title, &description, &cover, is_open, &source_id)
        .await
}

async fn update_collection(state,
    id: String,
    title: String,
    description: String,
    cover: String,
    is_open: i32,
) -> Value {
    state
        .client
        .update_collection(&id, &title, &description, &cover, is_open)
        .await
}

async fn delete_collection(state, id: String) -> Value {
    state.client.delete_collection(&id).await
}

async fn remove_collection_item(state,
    item_id: String,
) -> Value {
    state.client.remove_collection_item(&item_id).await
}

async fn clear_collection_invalid_items(state,
    collection_id: String,
) -> Value {
    state
        .client
        .clear_collection_invalid_items(&collection_id)
        .await
}

async fn follow_collection(state,
    collection_id: String,
) -> Value {
    state.client.follow_collection(&collection_id).await
}

async fn unfollow_collection(state,
    collection_id: String,
) -> Value {
    state.client.unfollow_collection(&collection_id).await
}

async fn like_collection(state,
    collection_id: String,
) -> Value {
    state.client.like_collection(&collection_id).await
}

async fn unlike_collection(state,
    collection_id: String,
) -> Value {
    state.client.unlike_collection(&collection_id).await
}

async fn follow_dyh(state, dyh_id: String) -> Value {
    state.client.follow_dyh(&dyh_id).await
}

async fn unfollow_dyh(state, dyh_id: String) -> Value {
    state.client.unfollow_dyh(&dyh_id).await
}

async fn follow_live(state, live_id: String) -> Value {
    state.client.follow_live(&live_id).await
}

async fn unfollow_live(state, live_id: String) -> Value {
    state.client.unfollow_live(&live_id).await
}

async fn get_feed_forward_list(state,
    feed_id: String,
    feed_type: String,
    page: u32,
) -> Value {
    state
        .client
        .get_feed_forward_list(&feed_id, &feed_type, page)
        .await
}

async fn get_feed_like_list(state,
    feed_id: String,
    page: u32,
) -> Value {
    state.client.get_feed_like_list(&feed_id, page).await
}

async fn get_feed_change_history(state,
    feed_id: String,
) -> Value {
    state.client.get_feed_change_history(&feed_id).await
}

async fn search_tags(state,
    query: String,
    page: u32,
) -> Value {
    state.client.search_tags(&query, page).await
}

async fn follow_tag(state, tag: String) -> Value {
    state.client.follow_tag(&tag).await
}

async fn unfollow_tag(state, tag: String) -> Value {
    state.client.unfollow_tag(&tag).await
}

async fn get_device_feed_list(state,
    tag: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state
        .client
        .get_device_feed_list(&tag, page, first_item.as_deref().unwrap_or(""), last_item.as_deref().unwrap_or(""))
        .await
}

async fn get_question_answers(state,
    feed_id: String,
    sort: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state
        .client
        .get_question_answers(
            &feed_id,
            &sort,
            page,
            first_item.as_deref().unwrap_or(""),
            last_item.as_deref().unwrap_or(""),
        )
        .await
}

async fn follow_question(state, question_id: String) -> Value {
    state.client.follow_question(&question_id).await
}

async fn unfollow_question(state, question_id: String) -> Value {
    state.client.unfollow_question(&question_id).await
}

async fn invite_question_answer(state, question_id: String, uid: String) -> Value {
    state.client.invite_question_answer(&question_id, &uid).await
}

async fn get_vote_comments(state,
    feed_id: String,
    page: u32,
) -> Value {
    state.client.get_vote_comments(&feed_id, page).await
}

async fn create_user_vote(state,
    feed_id: String,
    option_ids: Vec<String>,
    anonymous_status: bool,
) -> Value {
    state
        .client
        .create_user_vote(&feed_id, &option_ids, anonymous_status)
        .await
}

async fn get_hit_history(state,
    page: u32,
    history_type: String,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state.client.get_hit_history(page, &history_type, first_item.as_deref(), last_item.as_deref()).await
}

async fn get_recent_history(state, page: u32, first_item: Option<String>, last_item: Option<String>) -> Value {
    state.client.get_recent_history(page, first_item.as_deref(), last_item.as_deref()).await
}

async fn get_spam_feed_list(state, page: u32) -> Value {
    state.client.get_spam_feed_list(page).await
}

async fn get_hidden_replies(state,
    feed_id: String,
    page: u32,
) -> Value {
    state.client.get_hidden_replies(&feed_id, page).await
}

async fn get_followed_topics(state, page: u32) -> Value {
    state.client.get_followed_topics(page).await
}

async fn search_users(state,
    query: String,
    page: u32,
) -> Value {
    state.client.search_users(&query, page).await
}

async fn get_search_suggestions_app(state,
    query: String,
) -> Value {
    state.client.get_search_suggestions_app(&query).await
}

async fn search_feed_topics(state,
    query: String,
    page: u32,
) -> Value {
    state.client.search_feed_topics(&query, page).await
}

async fn search_publish_topics(state, query: String, page: u32, recent_ids: String) -> Value {
    state.client.search_publish_topics(&query, page, &recent_ids).await
}

async fn get_product_versions(state, product_id: String) -> Value {
    state.client.get_product_versions(&product_id).await
}

async fn get_product_detail_by_name(state,
    name: String,
) -> Value {
    state.client.get_product_detail_by_name(&name).await
}

async fn get_load_config(state, refresh: Option<bool>) -> Value {
    state.client.get_my_profile_cards(refresh.unwrap_or(false)).await
}

async fn get_my_card_manager(state) -> Value {
    state.client.get_my_card_manager().await
}

async fn update_my_card_config(state, config_json: String) -> Value {
    state.client.update_my_card_config(&config_json).await
}

async fn get_home_tab_config(state,
    reset: bool,
) -> Value {
    state.client.get_home_tab_config(reset).await
}

async fn get_feed_detail(state, feed_id: String, post_token: Option<String>, post_token_field: Option<String>) -> Value {
    state.client.get_feed_detail(&feed_id, post_token.as_deref(), post_token_field.as_deref()).await
}

async fn get_public_feed_detail(state, feed_id: String) -> Value {
    state.client.get_public_feed_detail(&feed_id).await
}

async fn get_editable_feed(state, feed_id: String) -> Value {
    state.client.get_editable_feed(&feed_id).await
}

async fn update_feed(state,
    feed_id: String,
    message: String,
    pic: String,
    post_token: Option<String>,
    options: Option<crate::coolapk::client::PublishOptions>,
) -> Value {
    state.client.update_feed(&feed_id, &message, &pic, post_token.as_deref(), options.as_ref()).await
}

async fn get_reply_detail(state,
    reply_id: String,
) -> Value {
    state.client.get_reply_detail(&reply_id).await
}

async fn get_feed_replies(state,
    feed_id: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
    list_type: Option<String>,
    from_feed_author: Option<u32>,
    post_token: Option<String>,
    post_token_field: Option<String>,
) -> Value {
    state
        .client
        .get_feed_replies_with_captcha(
            &feed_id,
            page,
            first_item.as_deref().unwrap_or(""),
            last_item.as_deref().unwrap_or(""),
            list_type.as_deref().unwrap_or("lastupdate_desc"),
            from_feed_author.unwrap_or(0),
            post_token.as_deref(),
            post_token_field.as_deref(),
        )
        .await
}

async fn get_sub_replies(state,
    feed_id: String,
    reply_id: String,
    page: u32,
    last_item: Option<String>,
    post_token: Option<String>,
    post_token_field: Option<String>,
) -> Value {
    state
        .client
        .get_sub_replies_with_captcha(
            &feed_id,
            &reply_id,
            page,
            last_item.as_deref().unwrap_or(""),
            post_token.as_deref(),
            post_token_field.as_deref(),
        )
        .await
}

async fn get_hot_replies(state,
    feed_id: String,
    page: u32,
) -> Value {
    state.client.get_hot_replies(&feed_id, page).await
}

async fn search_all(state,
    query: String,
    page: u32,
) -> Value {
    state.client.search_all(&query, page).await
}

async fn search_by_type(state,
    search_type: String,
    query: String,
    page: u32,
    first_item: String,
    last_item: String,
    page_type: String,
    page_param: String,
    feed_type: String,
    sort: String,
    is_strict: u32,
    category: String,
    page_context: String,
) -> Value {
    state
        .client
        .search_by_type(
            &search_type,
            &query,
            page,
            &first_item,
            &last_item,
            &page_type,
            &page_param,
            &feed_type,
            &sort,
            is_strict,
            &category,
            &page_context,
        )
        .await
}

async fn get_hot_searches(state, refresh: bool) -> Value {
    state.client.get_hot_searches(refresh).await
}

async fn search_feeds(state,
    query: String,
    page: u32,
    sort_type: String,
) -> Value {
    state.client.search_feeds(&query, page, &sort_type).await
}

async fn get_user_space(state, uid: String) -> Value {
    state.client.get_user_space(&uid).await
}

async fn get_public_user_space(state, uid: String) -> Value {
    state.client.get_public_user_space(&uid).await
}

async fn get_user_profile(state, uid: String) -> Value {
    state.client.get_user_profile(&uid).await
}

async fn get_user_plugins(state, store: bool, page: u32, plugin_type: u8) -> Value {
    state.client.get_user_plugins(store, page, plugin_type).await
}

async fn save_user_plugins(state, avatar_id: u64, feed_id: u64) -> Value {
    state.client.save_user_plugins(avatar_id, feed_id).await
}

async fn claim_user_plugin(state, id: u64) -> Value {
    state.client.claim_user_plugin(id).await
}

async fn get_my_profile(state, uid: String) -> Value {
    state.client.get_my_profile(&uid).await
}

async fn get_public_user_profile(state, uid: String) -> Value {
    state.client.get_public_user_profile(&uid).await
}

async fn get_user_remark_list(state, uid: String) -> Value {
    state.client.get_user_remark_list(&uid).await
}

async fn update_user_profile(state,
    key: String,
    value: String,
) -> Value {
    state.client.update_user_profile(&key, &value).await
}

async fn update_user_cover(state,
    url: String,
) -> Value {
    state.client.update_user_cover(&url).await
}

async fn get_user_qr_image(state, uid: String) -> Value {
    state.client.get_user_qr_image(&uid).await
}

async fn get_user_follow_nodes(state,
    uid: String,
) -> Value {
    state.client.get_user_follow_nodes(&uid).await
}

async fn get_user_forum_follow_list(state,
    uid: String,
    page: u32,
) -> Value {
    state.client.get_user_forum_follow_list(&uid, page).await
}

async fn get_user_feeds(state,
    uid: String,
    page: u32,
    feed_type: String,
) -> Value {
    state.client.get_user_feeds(&uid, page, &feed_type).await
}

async fn get_user_like_list(state,
    uid: String,
    page: u32,
) -> Value {
    state.client.get_user_like_list(&uid, page).await
}

async fn get_user_tab_data(state,
    uid: String,
    tab: String,
    page: u32,
    first_item: String,
    last_item: String,
    rating_target: String,
) -> Value {
    state
        .client
        .get_user_tab_data(
            &uid,
            &tab,
            page,
            &first_item,
            &last_item,
            &rating_target,
        )
        .await
}

async fn get_topic_detail(state, tag: String) -> Value {
    state.client.get_topic_detail(&tag).await
}

async fn get_topic_rating_list(state, topic_id: String, page: u32, star: i32,
    rating_type: String, detail_only: bool, first_item: String, last_item: String,
) -> Value {
    state.client.get_topic_rating_list(&topic_id, page, star, &rating_type, detail_only, &first_item, &last_item).await
}

async fn get_topic_rating_chart(state, topic_id: String) -> Value {
    state.client.get_topic_rating_chart(&topic_id).await
}

async fn get_topic_feeds(state,
    tag: String,
    page: u32,
    list_type: String,
    first_item: String,
    last_item: String,
    block_status: i32,
) -> Value {
    state
        .client
        .get_topic_feeds(&tag, page, &list_type, &first_item, &last_item, block_status)
        .await
}

async fn get_topic_tab_data(state,
    url: String,
    title: String,
    sub_title: String,
    page: u32,
    first_item: String,
    last_item: String,
    page_context: String,
) -> Value {
    state
        .client
        .get_topic_tab_data(&url, &title, &sub_title, page, &first_item, &last_item, &page_context)
        .await
}

async fn get_topic_hub_data(state,
    sub_url: String,
    page: u32,
    first_item: String,
    last_item: String,
) -> Value {
    state
        .client
        .get_topic_hub_data(&sub_url, page, &first_item, &last_item)
        .await
}

async fn get_app_detail(state,
    package_name: String,
) -> Value {
    state.client.get_app_detail(&package_name).await
}

async fn get_apk_comments(state,
    app_id: String,
    list_type: String,
    page: u32,
) -> Value {
    state
        .client
        .get_apk_comments(&app_id, &list_type, page)
        .await
}

async fn get_notification_count(state) -> Value {
    state.client.get_notification_count().await
}

async fn get_emoji_pictures(state) -> Value {
    state.client.get_emoji_pictures().await
}

async fn add_emoji_picture(state, url: String) -> Value {
    state.client.add_emoji_picture(&url).await
}

async fn edit_emoji_pictures(state, action: String, ids: Vec<String>) -> Value {
    state.client.edit_emoji_pictures(&action, &ids).await
}

async fn clear_notification_count(state,
    notification_type: String,
) -> Value {
    state.client.clear_notification_count(&notification_type).await
}

async fn delete_all_notifications(state) -> Value {
    state.client.delete_all_notifications().await
}

async fn report_notification_click(state, task_id: String) -> Value {
    state.client.report_notification_click(&task_id).await
}

async fn read_notification(state, id: String, notification_type: String) -> Value {
    state.client.read_notification(&id, &notification_type).await
}

async fn get_notifications(state,
    notification_type: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
    note_type: Option<String>,
) -> Value {
    state
        .client
        .get_notifications(&notification_type, page, first_item.as_deref().unwrap_or(""), last_item.as_deref().unwrap_or(""), note_type.as_deref().unwrap_or(""))
        .await
}

async fn list_messages(state, page: u32, first_item: String, last_item: String) -> Value {
    state.client.list_messages(page, &first_item, &last_item).await
}

async fn get_recent_chat_users(state,
    page: u32,
) -> Value {
    state.client.get_recent_chat_users(page).await
}

async fn list_chat_history(state,
    ukey: String,
    page: u32,
    first_item: Option<String>,
    last_item: Option<String>,
) -> Value {
    state
        .client
        .list_chat_history(&ukey, page, first_item.as_deref().unwrap_or(""), last_item.as_deref().unwrap_or(""))
        .await
}

async fn delete_message_chat(state,
    ukey: String,
) -> Value {
    state.client.delete_message_chat(&ukey).await
}

async fn send_private_message(state,
    uid: String,
    message: String,
) -> Value {
    state.client.send_private_message(&uid, &message).await
}

async fn send_private_image(state,
    uid: String,
    message_pic: String,
) -> Value {
    state.client.send_private_image(&uid, &message_pic).await
}

async fn read_message(state, ukey: String) -> Value {
    state.client.read_message(&ukey).await
}

async fn favorite_feed(state, feed_id: String) -> Value {
    state.client.favorite_feed(&feed_id).await
}

async fn unfavorite_feed(state, feed_id: String) -> Value {
    state.client.unfavorite_feed(&feed_id).await
}

async fn favorite_apk(state,
    package_name: String,
) -> Value {
    state.client.favorite_apk(&package_name).await
}

async fn get_apk_collection_status(state, apk_id: String) -> Value {
    state.client.get_apk_collection_status(&apk_id).await
}

async fn unfavorite_apk(state,
    package_name: String,
) -> Value {
    state.client.unfavorite_apk(&package_name).await
}

async fn set_user_feed_top(state, uid: String, feed_id: String, top: bool) -> Value {
    state.client.set_user_feed_top(&uid, &feed_id, top).await
}

async fn delete_feed(state, feed_id: String) -> Value {
    state.client.delete_feed(&feed_id).await
}

async fn delete_reply(state, reply_id: String) -> Value {
    state.client.delete_reply(&reply_id).await
}

async fn create_forward(state,
    feed_id: String,
    message: String,
    pic: Option<String>,
) -> Value {
    state
        .client
        .create_forward(&feed_id, &message, pic.as_deref())
        .await
}

async fn get_black_list(state, page: u32) -> Value {
    state.client.get_black_list(page).await
}

async fn get_ignore_list(state, page: u32) -> Value {
    state.client.get_ignore_list(page).await
}

async fn get_limit_list(state, page: u32) -> Value {
    state.client.get_limit_list(page).await
}

async fn add_to_black_list(state, uid: String) -> Value {
    state.client.add_to_black_list(&uid).await
}

async fn remove_from_black_list(state,
    uid: String,
) -> Value {
    state.client.remove_from_black_list(&uid).await
}

async fn add_to_ignore_list(state, uid: String) -> Value {
    state.client.add_to_ignore_list(&uid).await
}

async fn remove_from_ignore_list(state,
    uid: String,
) -> Value {
    state.client.remove_from_ignore_list(&uid).await
}

async fn get_apk_url(state,
    package_name: String,
) -> Value {
    state.client.get_apk_url(&package_name).await
}

async fn get_apk_qr(state, package_name: String) -> Value {
    state.client.get_apk_qr(&package_name).await
}

async fn like_feed(state, feed_id: String) -> Value {
    state.client.like_feed(&feed_id).await
}

async fn unlike_feed(state, feed_id: String) -> Value {
    state.client.unlike_feed(&feed_id).await
}

async fn like_reply(state, reply_id: String) -> Value {
    state.client.like_reply(&reply_id).await
}

async fn unlike_reply(state, reply_id: String) -> Value {
    state.client.unlike_reply(&reply_id).await
}

async fn reply_feed(state,
    feed_id: String,
    message: String,
    rid: Option<String>,
    pic: Option<String>,
    post_token: Option<String>,
) -> Value {
    state
        .client
        .reply_feed(
            &feed_id,
            &message,
            rid.as_deref(),
            pic.as_deref(),
            post_token.as_deref(),
        )
        .await
}

async fn comment_apk(state,
    app_id: String,
    message: String,
) -> Value {
    state.client.comment_apk(&app_id, &message).await
}

async fn follow_user(state, uid: String) -> Value {
    state.client.follow_user(&uid).await
}

async fn unfollow_user(state, uid: String) -> Value {
    state.client.unfollow_user(&uid).await
}

async fn special_follow_user(state,
    uid: String,
    special: bool,
) -> Value {
    state.client.special_follow_user(&uid, special).await
}

async fn cancel_follower(state, uid: String) -> Value {
    state.client.cancel_follower(&uid).await
}

async fn update_user_remark(state,
    uid: String,
    name: String,
) -> Value {
    state.client.update_user_remark(&uid, &name).await
}

async fn get_following_feeds(state, page: u32) -> Value {
    state.client.get_following_feeds(page).await
}

async fn get_follow_user_list(state,
    uid: String,
    page: u32,
    category: Option<String>,
) -> Value {
    state.client.get_follow_user_list(&uid, page, category.as_deref()).await
}

async fn get_fans_user_list(state,
    uid: String,
    page: u32,
) -> Value {
    state.client.get_fans_user_list(&uid, page).await
}

async fn create_feed(state,
    message: String,
    pic: Option<String>,
    post_token: Option<String>,
    options: Option<crate::coolapk::client::PublishOptions>,
) -> Value {
    state
        .client
        .create_feed_with_options(&message, pic.as_deref(), post_token.as_deref(), options.as_ref())
        .await
}

async fn create_answer(state,
    question_id: String,
    message: String,
    pic: Option<String>,
    post_token: Option<String>,
) -> Value {
    state
        .client
        .create_answer(
            &question_id,
            &message,
            pic.as_deref(),
            post_token.as_deref(),
        )
        .await
}

sync fn update_device_profile(state,
    profile: DeviceProfile,
) -> Value {
    state.client.update_device_profile(profile);
    Ok(json!({ "code": 200, "data": true }))
}

sync fn get_device_info(state) -> Value {
    state.client.get_device_info()
}

async fn generate_device_identity(state) -> Value {
    state.client.generate_device_identity().await
}

sync fn use_saved_device_identity(state) -> Value {
    state.client.use_saved_device_identity()
}

async fn check_login_status(state) -> Value {
    log::info!("login.status_check");
    let result = state.client.check_login_status().await;
    match &result {
        Ok(_) => log::info!("login.status_check_succeeded"),
        Err(error) => log::warn!(
            "login.status_check_failed reason={}",
            login_failure_kind(error)
        ),
    }
    result
}

sync fn clear_user_cookie(state) -> String {
    state.client.clear_user_cookie()?;
    Ok("登录状态已清除".to_string())
}

async fn list_accounts(state) -> Value {
    state.client.list_accounts().await
}

async fn login_as(state, uid: String) -> Value {
    state.client.login_as(&uid).await
}

async fn remove_account(state, uid: String) -> Value {
    state.client.remove_account(&uid).await
}

async fn get_game_list(state,
    page: u32,
    game_type: String,
) -> Value {
    state.client.get_game_list(page, &game_type).await
}

async fn search_apks(state,
    query: String,
    page: u32,
) -> Value {
    state.client.search_apks(&query, page).await
}

async fn search_games(state,
    query: String,
    page: u32,
) -> Value {
    state.client.search_games(&query, page).await
}

async fn get_app_list(state,
    page: u32,
    cat: String,
) -> Value {
    state.client.get_app_list(page, &cat).await
}

async fn submit_feed_report(state, id: String, report_type: String, reason: String, custom_reason: String, request_hash: String, pictures: Vec<String>) -> Value {
    state.client.submit_feed_report(&id, &report_type, &reason, &custom_reason, &request_hash, &pictures).await
}

async fn get_album_list(state,
    list_type: String,
    page: u32,
) -> Value {
    state.client.get_album_list(&list_type, page).await
}

async fn search_albums(state,
    query: String,
    page: u32,
) -> Value {
    state.client.search_albums(&query, page).await
}

async fn get_album_detail(state,
    album_id: String,
) -> Value {
    state.client.get_album_detail(&album_id).await
}

async fn get_user_album_list(state,
    uid: String,
    page: u32,
) -> Value {
    state.client.get_user_album_list(&uid, page).await
}

async fn create_album(state,
    title: String,
    intro: String,
    cover: String,
) -> Value {
    state.client.create_album(&title, &intro, &cover).await
}

async fn edit_album(state,
    album_id: String,
    title: String,
    intro: String,
    cover: String,
) -> Value {
    state.client.edit_album(&album_id, &title, &intro, &cover).await
}

async fn add_album_apk(state,
    album_id: String,
    package_name: String,
    title: String,
    url: String,
    note: String,
    display_order: i32,
    logo: String,
) -> Value {
    state
        .client
        .add_album_apk(&album_id, &package_name, &title, &url, &note, display_order, &logo)
        .await
}

async fn delete_album_apk(state,
    album_id: String,
    package_name: String,
) -> Value {
    state.client.delete_album_apk(&album_id, &package_name).await
}

async fn get_album_replies(state,
    album_id: String,
    page: u32,
) -> Value {
    state.client.get_album_replies(&album_id, page).await
}

async fn get_headline_feeds(state, page: u32) -> Value {
    state.client.get_headline_feeds(page).await
}

async fn get_update_list(state, page: u32) -> Value {
    state.client.get_update_list(page).await
}

async fn get_editor_choice_feeds(state,
    page: u32,
) -> Value {
    state.client.get_editor_choice_feeds(page).await
}

async fn get_apk_discoverers(state,
    package_name: String,
    page: u32,
) -> Value {
    state.client.get_apk_discoverers(&package_name, page).await
}

async fn get_apk_recommend_list(state,
    apk_type: String,
    title: String,
    page: u32,
) -> Value {
    state
        .client
        .get_apk_recommend_list(&apk_type, &title, page)
        .await
}

async fn get_apk_related_apps(state,
    package_name: String,
    page: u32,
) -> Value {
    state
        .client
        .get_apk_related_apps(&package_name, page)
        .await
}

async fn get_apk_gift_list(state,
    apk_id: Option<String>,
    page: u32,
) -> Value {
    state
        .client
        .get_apk_gift_list(apk_id.as_deref(), page)
        .await
}

async fn get_download_version_list(state,
    package_name: String,
) -> Value {
    state.client.get_download_version_list(&package_name).await
}

async fn get_picture_list(state,
    tag: String,
    page: u32,
) -> Value {
    state.client.get_picture_list(&tag, page).await
}

async fn get_user_rating_list(state,
    uid: String,
    page: u32,
) -> Value {
    state.client.get_user_rating_list(&uid, page).await
}

async fn search_apks_by_developer(state,
    developer: String,
    page: u32,
) -> Value {
    state
        .client
        .search_apks_by_developer(&developer, page)
        .await
}

async fn search_apks_by_tag(state,
    tag: String,
    apk_type: String,
    page: u32,
) -> Value {
    state.client.search_apks_by_tag(&tag, &apk_type, page).await
}

async fn get_goods_search_hot_words(state) -> Value {
    state.client.get_goods_search_hot_words().await
}

async fn search_goods(state,
    keyword: String,
    sort_name: String,
    sort: String,
    is_coupon: u32,
    page: u32,
) -> Value {
    state
        .client
        .search_goods(&keyword, &sort_name, &sort, is_coupon, page)
        .await
}

async fn get_goods_detail(state,
    goods_id: String,
) -> Value {
    state.client.get_goods_detail(&goods_id).await
}

async fn get_goods_list_types(state) -> Value {
    state.client.get_goods_list_types().await
}

async fn get_goods_list(state,
    uid: String,
    goods_id: String,
    page: u32,
) -> Value {
    state.client.get_goods_list(&uid, &goods_id, page).await
}

async fn get_goods_store_items(state,
    uid: String,
    page: u32,
) -> Value {
    state.client.get_goods_store_items(&uid, page).await
}

async fn get_product_albums(state,
    uid: String,
    page: u32,
) -> Value {
    state.client.get_product_albums(&uid, page).await
}

async fn get_my_goods_feeds(state,
    uid: String,
    goods_type: String,
    page: u32,
) -> Value {
    state.client.get_my_goods_feeds(&uid, &goods_type, page).await
}

async fn create_goods_list(state,
    title: String,
    message: String,
    cover: String,
    top_limit: u32,
    is_open_vote: u32,
    list_type: String,
    target_id: String,
    target_type: String,
) -> Value {
    state
        .client
        .create_goods_list(
            &title,
            &message,
            &cover,
            top_limit,
            is_open_vote,
            &list_type,
            &target_id,
            &target_type,
        )
        .await
}

async fn edit_goods_list(state,
    id: String,
    title: String,
    message: String,
    cover: String,
    top_limit: u32,
    is_open_vote: u32,
    list_type: String,
) -> Value {
    state
        .client
        .edit_goods_list(&id, &title, &message, &cover, top_limit, is_open_vote, &list_type)
        .await
}

async fn add_goods_to_goods_list(state,
    feed_id: String,
    goods_id: String,
    note: String,
    pic: String,
) -> Value {
    state
        .client
        .add_goods_to_goods_list(&feed_id, &goods_id, &note, &pic)
        .await
}

async fn delete_goods_list_items(state,
    cancel_feed_id: String,
    goods_id: String,
) -> Value {
    state
        .client
        .delete_goods_list_items(&cancel_feed_id, &goods_id)
        .await
}

async fn edit_goods_list_item(state,
    feed_id: String,
    goods_id: String,
    note: String,
    pic: String,
) -> Value {
    state
        .client
        .edit_goods_list_item(&feed_id, &goods_id, &note, &pic)
        .await
}

async fn vote_goods_list_item(state,
    id: String,
    item_id: String,
    value: i32,
) -> Value {
    state.client.vote_goods_list_item(&id, &item_id, value).await
}

async fn bind_feed_to_goods_list(state,
    feed_id: String,
    goods_list_id: String,
) -> Value {
    state
        .client
        .bind_feed_to_goods_list(&feed_id, &goods_list_id)
        .await
}

async fn resolve_video_url(state,
    request_params: String,
) -> Value {
    state.client.resolve_video_url(&request_params).await
}

async fn resolve_live_photo_video(state,
    image_url: String,
    content_id: String,
    content_type: String,
) -> Value {
    state
        .client
        .resolve_live_photo_video(&image_url, &content_id, &content_type)
        .await
}

async fn prepare_goods_by_url(state, url: String) -> Value {
    state.client.prepare_goods_by_url(&url).await
}

}
