use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, ensure};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use futures_util::StreamExt;
use serde_json::{Value, json};
use tower_http::{compression::CompressionLayer, services::ServeDir};

use crate::coolapk::{
    apk_download::{
        empty_download_verification, request_apk_download, resolve_apk_download_url,
        sanitize_apk_file_name,
    },
    client::CoolapkClient,
    http_session::{Policy as SessionPolicy, session as http_session},
};

use crate::web_commands::dispatch_web_command;

const SESSION_COOKIE: &str = "coolapk_web_session";
const SECURE_SESSION_COOKIE: &str = "__Host-coolapk_web_session";
const DEMO_SESSION_COOKIE: &str = "coolapk_web_demo_session";
const SECURE_DEMO_SESSION_COOKIE: &str = "__Host-coolapk_web_demo_session";
const DEMO_LOGIN_DISABLED: &str = "演示模式不支持登录";
const MAX_SESSIONS: usize = 512;
const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_UPLOAD_BYTES: usize = 272 * 1024 * 1024;

struct Session {
    client: Arc<tokio::sync::Mutex<Arc<CoolapkClient>>>,
    persisted: Option<Mutex<(PathBuf, Value)>>,
    last_used: Mutex<Instant>,
}

impl Session {
    fn persist(&self, client: &CoolapkClient) -> Result<(), WebError> {
        let Some(persisted) = &self.persisted else { return Ok(()); };
        let mut saved = persisted.lock().expect("web session snapshot lock");
        let snapshot = client.web_session_snapshot();
        if saved.1 == snapshot {
            return Ok(());
        }
        let temporary = saved.0.with_extension("tmp");
        let write = || -> anyhow::Result<()> {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            serde_json::to_writer(options.open(&temporary)?, &snapshot)?;
            std::fs::rename(&temporary, &saved.0)?;
            Ok(())
        };
        write().map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "无法保存 Web 会话"))?;
        saved.1 = snapshot;
        Ok(())
    }
}

struct WebState {
    desktop_origin: Option<String>,
    demo_mode: bool,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    desktop: Option<Arc<tokio::sync::Mutex<Arc<CoolapkClient>>>>,
    session_dir: Option<PathBuf>,
    requests: tokio::sync::Semaphore,
    media_requests: tokio::sync::Semaphore,
    public_media: CoolapkClient,
    uploads: tokio::sync::Semaphore,
    downloads: Arc<tokio::sync::Semaphore>,
}

type WebError = (StatusCode, Json<Value>);

fn error(status: StatusCode, message: &str) -> WebError {
    (status, Json(json!({ "error": message })))
}

fn session_cookies<'a>(
    headers: &'a HeaderMap,
    cookie_name: &'a str,
) -> impl Iterator<Item = &'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .filter_map(move |(name, value)| (name == cookie_name).then_some(value))
}

impl WebState {
    fn make_session_room(
        &self,
        sessions: &mut HashMap<String, Arc<Session>>,
    ) -> Result<(), WebError> {
        if sessions.len() < MAX_SESSIONS {
            return Ok(());
        }
        // 优先回收最久未使用的访客会话。含账号的会话只有能完整恢复时才移出内存。
        let evictable = sessions.iter().filter_map(|(key, session)| {
            if Arc::strong_count(session) != 1 {
                return None;
            }
            let client = session.client.try_lock().ok()?;
            let saved = session.persisted.as_ref().map(|saved| saved.lock().expect("web session snapshot lock"));
            let has_account = self.desktop.is_none() && client.has_web_account_state();
            if has_account && saved.as_ref().is_none_or(|saved| saved.1 != client.web_session_snapshot()) {
                return None;
            }
            // 有磁盘目录时，保留尚未完成初次落盘的会话。
            if saved.is_some_and(|saved| saved.1.is_null()) {
                return None;
            }
            Some((key, has_account, *session.last_used.lock().expect("web session access lock")))
        }).min_by_key(|(_, has_account, last_used)| (*has_account, *last_used));
        if let Some((key, _, _)) = evictable {
            let key = key.clone();
            sessions.remove(&key);
            return Ok(());
        }
        Err(error(StatusCode::SERVICE_UNAVAILABLE, "浏览器会话已满，请稍后重试"))
    }

    fn session(
        &self,
        headers: &HeaderMap,
        create: bool,
    ) -> Result<(Arc<Session>, Option<String>), WebError> {
        let mut sessions = self.sessions.lock().expect("web sessions lock");
        // Older builds used Path=/api, so browsers can send the stale cookie before the new one.
        // Same-origin GET requests may omit Origin. The browser sends Secure cookies
        // according to the public URL, even when a proxy forwards over HTTP.
        let names = self.cookie_names();
        let cookie_names: &[&str] = match self.origin(headers) {
            Some(origin) if origin.starts_with("https://") => &names[..1],
            Some(_) => &names[1..],
            None => &names,
        };
        for key in cookie_names.iter().flat_map(|name| session_cookies(headers, name)) {
            if let Some(session) = sessions.get(key) {
                *session.last_used.lock().expect("web session access lock") = Instant::now();
                return Ok((Arc::clone(session), None));
            }
            if let Some(dir) = &self.session_dir
                && key.len() == 64 && key.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                let path = dir.join(format!("{key}.json"));
                if let Ok(file) = std::fs::File::open(&path)
                    && let Ok(snapshot) = serde_json::from_reader::<_, Value>(file)
                    && let Ok(client) = CoolapkClient::restore_web_session(&snapshot)
                {
                    self.make_session_room(&mut sessions)?;
                    let session = Arc::new(Session {
                        client: Arc::new(tokio::sync::Mutex::new(Arc::new(client))),
                        persisted: Some(Mutex::new((path, snapshot))),
                        last_used: Mutex::new(Instant::now()),
                    });
                    sessions.insert(key.to_owned(), Arc::clone(&session));
                    return Ok((session, None));
                }
            }
        }
        if !create {
            return Err(error(StatusCode::UNAUTHORIZED, "浏览器会话不可用，请重试"));
        }
        self.make_session_room(&mut sessions)?;
        let mut token = [0u8; 32];
        getrandom::fill(&mut token)
            .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "无法创建浏览器会话"))?;
        let token = hex::encode(token);
        let session = Arc::new(Session {
            client: self.desktop.as_ref().map(Arc::clone)
                .unwrap_or_else(|| Arc::new(tokio::sync::Mutex::new(Arc::new(CoolapkClient::new_web())))),
            persisted: self.session_dir.as_ref().map(|dir| Mutex::new((dir.join(format!("{token}.json")), Value::Null))),
            last_used: Mutex::new(Instant::now()),
        });
        sessions.insert(token.clone(), Arc::clone(&session));
        Ok((session, Some(token)))
    }

    fn origin<'a>(&'a self, headers: &'a HeaderMap) -> Option<&'a str> {
        self.desktop_origin.as_deref().or_else(|| headers.get(header::ORIGIN)?.to_str().ok())
    }

    fn cookie_names(&self) -> [&'static str; 2] {
        // 演示模式使用独立 Cookie，保留浏览器原有会话以便关闭演示模式后恢复。
        if self.demo_mode {
            [SECURE_DEMO_SESSION_COOKIE, DEMO_SESSION_COOKIE]
        } else {
            [SECURE_SESSION_COOKIE, SESSION_COOKIE]
        }
    }
}

fn standalone_origin_allowed(origin: &str) -> bool {
    reqwest::Url::parse(origin).is_ok_and(|url| {
        url.origin().ascii_serialization() == origin
            && (url.scheme() == "https"
                || (url.scheme() == "http"
                    && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))))
    })
}

async fn check_request(
    State(state): State<Arc<WebState>>,
    request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();
    let fetch_same_origin = headers.get("sec-fetch-site").is_some_and(|v| v == "same-origin");
    let origin = headers.get(header::ORIGIN).and_then(|value| value.to_str().ok());
    let same_origin = match state.desktop_origin.as_deref() {
        Some(expected) if request.method() != axum::http::Method::GET => origin == Some(expected),
        Some(_) => fetch_same_origin,
        None if request.method() == axum::http::Method::GET => {
            fetch_same_origin && origin.is_none_or(standalone_origin_allowed)
        }
        None => fetch_same_origin && origin.is_some_and(standalone_origin_allowed),
    };
    if !same_origin {
        return error(StatusCode::FORBIDDEN, "请求来源无效").into_response();
    }
    let limit = match request.uri().path() {
        "/command/get_image_data_url"
        | "/command/get_live_photo_video_header"
        | "/media/weibo-video" => &state.media_requests,
        _ => &state.requests,
    };
    let Ok(_permit) = limit.try_acquire() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "请求过多，请稍后重试").into_response();
    };
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

async fn initialize_session(
    State(state): State<Arc<WebState>>,
    headers: HeaderMap,
) -> Result<Response, WebError> {
    let (session, token) = state.session(&headers, true)?;
    if session.persisted.is_some() {
        let client = session.client.lock().await;
        session.persist(&client)?;
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    if let Some(token) = token {
        let secure_cookie = state.origin(&headers).is_some_and(|origin| origin.starts_with("https://"));
        let [secure_name, plain_name] = state.cookie_names();
        let (name, secure) = if secure_cookie {
            (secure_name, "; Secure")
        } else {
            (plain_name, "")
        };
        let cookie = format!(
            "{name}={token}; Path=/; HttpOnly; SameSite=Strict{secure}"
        );
        response.headers_mut().insert(
            header::SET_COOKIE,
            HeaderValue::from_str(&cookie).expect("valid session cookie"),
        );
        if !secure_cookie && !state.demo_mode {
            response.headers_mut().append(
                header::SET_COOKIE,
                HeaderValue::from_static(
                    "coolapk_web_session=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict",
                ),
            );
        }
    }
    Ok(response)
}

async fn command(
    State(state): State<Arc<WebState>>,
    Path(name): Path<String>,
    headers: HeaderMap,
    Json(args): Json<Value>,
) -> Result<Json<Value>, WebError> {
    if state.demo_mode && matches!(
        name.as_str(),
        "import_web_account" | "login_as" | "login_by_account" | "login_by_mobile"
            | "send_sms_vcode" | "save_cookie_securely" | "save_account" | "persist_current_account"
    ) {
        return Err(error(StatusCode::FORBIDDEN, DEMO_LOGIN_DISABLED));
    }
    let (session, _) = state.session(&headers, false)?;
    if name == "get_image_data_url" {
        let url = args
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| error(StatusCode::BAD_REQUEST, "缺少资源地址"))?;
        let result = if CoolapkClient::web_image_needs_account(url) {
            session
                .client
                .lock()
                .await
                .get_web_image_data_url(url)
                .await
        } else {
            state.public_media.get_web_image_data_url(url).await
        };
        return result
            .map(|value| Json(Value::String(value)))
            .map_err(|message| error(StatusCode::BAD_REQUEST, &message));
    }
    if name == "get_live_photo_video_header" {
        let url = args
            .get("videoUrl")
            .and_then(Value::as_str)
            .ok_or_else(|| error(StatusCode::BAD_REQUEST, "缺少视频地址"))?;
        return state
            .public_media
            .get_web_live_photo_video_header(url)
            .await
            .map(|value| Json(Value::String(value)))
            .map_err(|message| error(StatusCode::BAD_REQUEST, &message));
    }
    // Account switches and their requests share a lock so credentials cannot change midway.
    let client = session.client.lock().await;
    let result = match name.as_str() {
        "check_login_info" if state.demo_mode => Ok(json!({ "code": 200, "data": null })),
        "check_login_status" if client.get_user_cookie().is_none() => {
            Ok(json!({ "code": 200, "data": null }))
        }
        "import_web_account" => {
            let cookie = args
                .get("cookieStr")
                .and_then(Value::as_str)
                .ok_or_else(|| error(StatusCode::BAD_REQUEST, "缺少登录凭据"))?;
            client.import_web_account(cookie).await
        }
        "save_cookie_securely" | "persist_current_account" => Err("请使用 Web 账号导入接口".into()),
        "fetch_external_page" => {
            let url = args
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| error(StatusCode::BAD_REQUEST, "缺少资源地址"))?;
            client.fetch_web_page(url).await
        }
        "upload_publish_video" | "upload_image" | "change_avatar" => {
            Err("请使用 Web 文件上传接口".into())
        }
        _ => dispatch_web_command(&client, &name, args).await,
    };
    session.persist(&client)?;
    let result = result.map_err(|message| error(StatusCode::BAD_REQUEST, &message))?;
    Ok(Json(
        if matches!(
            name.as_str(),
            "import_web_account" | "check_login_info" | "check_login_status" | "login_as"
        ) {
            let mut profile = result;
            if let Some(data) = profile.get_mut("data").and_then(Value::as_object_mut) {
                data.retain(|key, _| {
                    matches!(
                        key.as_str(),
                        "uid"
                            | "id"
                            | "username"
                            | "userName"
                            | "displayUsername"
                            | "userAvatar"
                            | "avatar"
                            | "user_avatar"
                            | "level"
                            | "userLevel"
                            | "bio"
                            | "sign"
                            | "be_like_num"
                            | "feed_like_num"
                            | "like_num"
                            | "likenum"
                            | "fans"
                            | "fansNum"
                            | "fans_num"
                            | "follow"
                            | "followNum"
                            | "follow_num"
                            | "avatarPluginUrl"
                            | "feedPluginUrl"
                            | "gender"
                            | "cover"
                            | "logintime"
                    )
                });
            }
            profile
        } else {
            result
        },
    ))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadMetadata {
    file_name: String,
    content_type: Option<String>,
    dir: Option<String>,
    to_uid: Option<String>,
    hdr: Option<u32>,
    duration: Option<u64>,
}

async fn upload(
    State(state): State<Arc<WebState>>,
    Path(name): Path<String>,
    headers: HeaderMap,
    mut form: Multipart,
) -> Result<Json<Value>, WebError> {
    let (session, _) = state.session(&headers, false)?;
    let invalid = || error(StatusCode::BAD_REQUEST, "文件上传参数无效");
    let fields: &[(&str, usize)] = match name.as_str() {
        "upload_publish_video" => &[("videoBytes", 256), ("coverBytes", 15)],
        "upload_image" => &[("imageBytes", 20), ("liveVideoBytes", 100)],
        "change_avatar" => &[("imageBytes", 20)],
        _ => return Err(invalid()),
    };
    if session.client.lock().await.get_user_cookie().is_none() {
        return Err(error(StatusCode::FORBIDDEN, "请登录后上传文件"));
    }
    let _permit = state
        .uploads
        .try_acquire()
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "上传任务过多，请稍后重试"))?;
    let mut parts = HashMap::new();
    let mut metadata: Option<UploadMetadata> = None;
    while let Some(mut field) = form.next_field().await.map_err(|_| invalid())? {
        let name = field.name().ok_or_else(invalid)?.to_owned();
        let limit = if name == "metadata" && metadata.is_none() {
            4096
        } else {
            fields
                .iter()
                .find(|(key, _)| *key == name && !parts.contains_key(&name))
                .map(|(_, size)| size * 1024 * 1024)
                .ok_or_else(invalid)?
        };
        let mut bytes = Vec::new();
        while let Some(chunk) = field.chunk().await.map_err(|_| invalid())? {
            if bytes.len() + chunk.len() > limit {
                return Err(error(StatusCode::PAYLOAD_TOO_LARGE, "上传文件超过大小限制"));
            }
            bytes.extend_from_slice(&chunk);
        }
        if name == "metadata" {
            metadata = Some(serde_json::from_slice(&bytes).map_err(|_| invalid())?);
        } else {
            parts.insert(name, bytes);
        }
    }
    let metadata = metadata.ok_or_else(invalid)?;
    let client = session.client.lock().await;
    if client.get_user_cookie().is_none() {
        return Err(error(StatusCode::FORBIDDEN, "请登录后上传文件"));
    }
    let part = |name| parts.get(name).map(Vec::as_slice).ok_or_else(invalid);
    let result = match name.as_str() {
        "upload_publish_video" => {
            client
                .upload_publish_video(
                    part("videoBytes")?,
                    &metadata.file_name,
                    part("coverBytes")?,
                    metadata.duration.ok_or_else(invalid)?,
                )
                .await
        }
        "upload_image" => {
            client
                .upload_image_with_live(
                    part("imageBytes")?,
                    &metadata.file_name,
                    metadata.content_type.as_deref().ok_or_else(invalid)?,
                    metadata.dir.as_deref().ok_or_else(invalid)?,
                    metadata.to_uid.as_deref(),
                    parts.get("liveVideoBytes").map(Vec::as_slice),
                    metadata.hdr.unwrap_or(0),
                )
                .await
        }
        "change_avatar" => {
            client
                .change_avatar(
                    part("imageBytes")?,
                    &metadata.file_name,
                    metadata.content_type.as_deref().ok_or_else(invalid)?,
                )
                .await
        }
        _ => return Err(invalid()),
    };
    result
        .map(Json)
        .map_err(|message| error(StatusCode::BAD_REQUEST, &message))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApkDownload {
    package_name: String,
    apk_id: Option<String>,
    version_code: Option<String>,
    file_name: String,
}

async fn download_apk(
    State(state): State<Arc<WebState>>,
    headers: HeaderMap,
    Query(args): Query<ApkDownload>,
) -> Response {
    match stream_apk_download(&state, &headers, &args).await {
        Ok(response) => response,
        Err((status, _))
            if headers
                .get(header::ACCEPT)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.contains("text/html"))
                && !args.package_name.is_empty()
                && args
                    .package_name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_')) =>
        {
            let package = &args.package_name;
            let page = format!(
                r#"<!doctype html><html lang="zh-CN"><meta charset="utf-8">
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <title>暂时无法下载</title><body><main>
                <h1>暂时无法下载</h1><p>酷安未提供可下载的安装包。你可以打开官方应用页面查看下载方式。</p>
                <a href="https://www.coolapk.com/apk/{package}" rel="noreferrer">打开酷安应用页</a>
                </main></body></html>"#
            );
            (status, Html(page)).into_response()
        }
        Err(error) => error.into_response(),
    }
}

async fn stream_apk_download(
    state: &WebState,
    headers: &HeaderMap,
    args: &ApkDownload,
) -> Result<Response, WebError> {
    let (session, _) = state.session(headers, false)?;
    let permit = Arc::clone(&state.downloads)
        .try_acquire_owned()
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "下载任务过多，请稍后重试"))?;
    let upstream_error = |message: String| error(StatusCode::BAD_GATEWAY, &message);
    let file_name = sanitize_apk_file_name(&args.file_name)
        .map_err(|message| error(StatusCode::BAD_REQUEST, &message))?;
    let client = session.client.lock().await;
    let url = resolve_apk_download_url(
        &client,
        &args.package_name,
        args.apk_id.as_deref(),
        args.version_code.as_deref(),
        None,
    )
    .await
    .map_err(upstream_error)?;
    let mut upstream = request_apk_download(&client, &url, 0, SessionPolicy::DownloadNoRedirect)
        .await
        .map_err(upstream_error)?;
    if upstream.status().is_redirection() {
        let target = upstream
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| url.join(value).ok())
            .filter(|url| {
                url.scheme() == "https"
                    && url.port().is_none()
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.host_str().is_some_and(|host| {
                        host.ends_with(".coolapk.com")
                            || host.ends_with(".myqcloud.com")
                            || host.ends_with(".aliyuncs.com")
                    })
            })
            .ok_or_else(|| error(StatusCode::BAD_GATEWAY, "酷安下载跳转地址无效"))?;
        upstream = http_session(target.as_str(), SessionPolicy::NoRedirect)
            .map_err(upstream_error)?
            .get(target)
            .timeout(Duration::from_secs(900))
            .send()
            .await
            .map_err(|_| error(StatusCode::BAD_GATEWAY, "应用安装包下载失败"))?;
    }
    let media_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if media_type.starts_with("application/json") {
        let mut body = Vec::new();
        while let Some(chunk) = upstream
            .chunk()
            .await
            .map_err(|_| error(StatusCode::BAD_GATEWAY, "无法读取酷安下载响应"))?
        {
            if body.len() + chunk.len() > 16 * 1024 {
                break;
            }
            body.extend_from_slice(&chunk);
        }
        let envelope = serde_json::from_slice::<Value>(&body).unwrap_or(Value::Null);
        let message = envelope
            .get("message")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty());
        let message: String = message
            .unwrap_or("酷安未返回应用安装包")
            .chars()
            .take(160)
            .collect();
        return Err(error(StatusCode::BAD_GATEWAY, &message));
    }
    if !upstream.status().is_success()
        || media_type.starts_with("text/")
        || media_type.starts_with("application/xhtml")
    {
        return Err(error(
            StatusCode::BAD_GATEWAY,
            &format!(
                "酷安未返回应用安装包（HTTP {}）",
                upstream.status().as_u16()
            ),
        ));
    }
    if client
        .verify_apk_download(&args.package_name, url.as_str(), upstream.url().as_str())
        .await
        .is_ok_and(|result| empty_download_verification(&result))
    {
        return Err(error(StatusCode::BAD_GATEWAY, "酷安下载校验未通过"));
    }
    drop(client);
    let file_name: String = file_name
        .bytes()
        .map(|byte| format!("%{byte:02X}"))
        .collect();
    let disposition = format!("attachment; filename*=UTF-8''{file_name}");
    let length = upstream.content_length();
    let body = Body::from_stream(upstream.bytes_stream().map(move |chunk| {
        let _ = &permit;
        chunk
    }));
    let mut response = Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_DISPOSITION, disposition);
    if let Some(length) = length {
        response = response.header(header::CONTENT_LENGTH, length);
    }
    response
        .body(body)
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "无法创建下载响应"))
}

#[derive(serde::Deserialize)]
struct MediaQuery {
    url: String,
}

async fn weibo_video(
    State(state): State<Arc<WebState>>,
    headers: HeaderMap,
    Query(args): Query<MediaQuery>,
) -> Result<Response, WebError> {
    let permit = Arc::clone(&state.downloads)
        .try_acquire_owned()
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "媒体请求过多，请稍后重试"))?;
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    let upstream = state
        .public_media
        .request_weibo_video(&args.url, range, SessionPolicy::NoRedirect)
        .await
        .map_err(|message| error(StatusCode::BAD_GATEWAY, &message))?;
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if status == StatusCode::RANGE_NOT_SATISFIABLE {
        let mut response = status.into_response();
        if let Some(value) = upstream.headers().get(header::CONTENT_RANGE) {
            response
                .headers_mut()
                .insert(header::CONTENT_RANGE, value.clone());
        }
        return Ok(response);
    }
    if !status.is_success()
        || !(content_type.starts_with("video/") || content_type == "application/octet-stream")
    {
        return Err(error(StatusCode::BAD_GATEWAY, "微博 CDN 未返回视频内容"));
    }
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "video/mp4");
    for name in [
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            response = response.header(name, value);
        }
    }
    response
        .body(Body::from_stream(upstream.bytes_stream().map(
            move |chunk| {
                let _ = &permit;
                chunk
            },
        )))
        .map_err(|_| error(StatusCode::BAD_GATEWAY, "无法创建视频响应"))
}

fn static_cache_control(path: &str) -> Option<&'static str> {
    if matches!(path, "/" | "/index.html") {
        return Some("no-cache");
    }
    let name = path.strip_prefix("/assets/")?;
    let (stem, _) = name.rsplit_once('.')?;
    let suffix = stem.get(stem.len().checked_sub(9)?..)?;
    let hash = suffix.strip_prefix('-')?;
    if hash
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Some("public, max-age=31536000, immutable");
    }
    None
}

fn router_with_assets(state: Arc<WebState>, assets: Router, extra_api: Router<Arc<WebState>>) -> Router {
    let api = Router::new()
        .route("/session", post(initialize_session))
        .route("/download/apk", get(download_apk))
        .route("/media/weibo-video", get(weibo_video))
        .route("/command/{name}", post(command))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .route(
            "/upload/{name}",
            post(upload).layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)),
        )
        .merge(extra_api)
        .fallback(|| async { StatusCode::NOT_FOUND })
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            check_request,
        ))
        .with_state(state);
    Router::new()
        .nest("/api", api)
        .fallback_service(assets.layer(CompressionLayer::new()))
        .layer(middleware::from_fn(
            |request: Request, next: Next| async move {
                let cache_control = static_cache_control(request.uri().path());
                let mut response = next.run(request).await;
                if let Some(cache_control) = cache_control
                    && (response.status().is_success()
                        || response.status() == StatusCode::NOT_MODIFIED)
                {
                    response.headers_mut().insert(
                        header::CACHE_CONTROL,
                        HeaderValue::from_static(cache_control),
                    );
                }
                response.headers_mut().insert(
                    header::CONTENT_SECURITY_POLICY,
                    HeaderValue::from_static("frame-ancestors 'none'"),
                );
                response
            },
        ))
}

fn is_page_navigation(request: &Request) -> bool {
    let path = request.uri().path();
    matches!(*request.method(), axum::http::Method::GET | axum::http::Method::HEAD)
        && !path.starts_with("/assets/")
        && path != "/api"
        && !path.starts_with("/api/")
        && request.headers().get(header::ACCEPT).is_some_and(|value| {
            value.to_str().is_ok_and(|value| {
                value.split(',').any(|kind| kind.split(';').next().is_some_and(|kind| kind.trim() == "text/html"))
            })
        })
}

#[cfg_attr(all(feature = "native", desktop), allow(dead_code))]
fn router(state: Arc<WebState>, dist: PathBuf) -> Router {
    let index = dist.join("index.html");
    let demo_mode = state.demo_mode;
    let page = move |request: Request| {
        let index = index.clone();
        async move {
            if !matches!(request.uri().path(), "/" | "/index.html") && !is_page_navigation(&request) {
                return StatusCode::NOT_FOUND.into_response();
            }
            match tokio::fs::read_to_string(index).await {
                Ok(html) => {
                    let html = if demo_mode {
                        html.replacen("<head>", "<head><meta name=\"coolapk-web-demo\">", 1)
                    } else {
                        html
                    };
                    ([(header::CACHE_CONTROL, "no-cache")], Html(html)).into_response()
                }
                Err(_) => StatusCode::NOT_FOUND.into_response(),
            }
        }
    };
    let pages = Router::new().fallback(get(page.clone()));
    let mut assets = Router::new().fallback_service(ServeDir::new(dist).fallback(pages));
    // ServeDir 会直接返回首页文件，演示模式下由同一处理器为所有页面注入模式标记。
    if demo_mode {
        assets = assets.route("/", get(page.clone())).route("/index.html", get(page));
    }
    router_with_assets(state, assets, Router::new())
}

fn new_state(desktop_origin: Option<String>) -> WebState {
    WebState {
        desktop_origin,
        demo_mode: false,
        sessions: Mutex::new(HashMap::new()),
        desktop: None,
        session_dir: None,
        requests: tokio::sync::Semaphore::new(16),
        media_requests: tokio::sync::Semaphore::new(8),
        public_media: CoolapkClient::new(),
        uploads: tokio::sync::Semaphore::new(2),
        downloads: Arc::new(tokio::sync::Semaphore::new(4)),
    }
}

#[cfg(all(feature = "native", desktop))]
pub struct DesktopWebServer {
    pub url: String,
    pub lan_url: Option<String>,
    pub task: tokio::task::JoinHandle<()>,
    shutdown: tokio::sync::watch::Sender<bool>,
}

#[cfg(all(feature = "native", desktop))]
impl DesktopWebServer {
    pub fn stop(self) {
        let _ = self.shutdown.send(true);
    }
}

#[cfg(all(feature = "native", desktop))]
fn desktop_lan_ipv4() -> Option<std::net::Ipv4Addr> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let result = std::process::Command::new("powershell.exe")
            .creation_flags(0x08000000)
            .args(["-NoProfile", "-NonInteractive", "-Command",
                "Get-NetIPConfiguration | Where-Object { $_.NetAdapter.HardwareInterface -and $_.IPv4DefaultGateway } | ForEach-Object { $_.IPv4Address.IPAddress }"])
            .output();
        if let Ok(output) = result
            && output.status.success()
            && let Some(ip) = String::from_utf8_lossy(&output.stdout).lines()
                .filter_map(|line| line.trim().parse::<std::net::Ipv4Addr>().ok())
                .find(std::net::Ipv4Addr::is_private)
        {
            return Some(ip);
        }
    }
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if ip.is_private() => Some(ip),
        _ => None,
    }
}

#[cfg(all(feature = "native", desktop))]
pub async fn start_desktop(
    app: tauri::AppHandle,
    client: Arc<CoolapkClient>,
    allow_lan: bool,
) -> Result<DesktopWebServer, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await
        .map_err(|err| format!("无法启动本机 Web 访问（{err}）"))?;
    let address = listener.local_addr().map_err(|e| e.to_string())?;
    let lan_listener = if allow_lan {
        let ip = tokio::task::spawn_blocking(desktop_lan_ipv4).await
            .ok().flatten().ok_or("未找到局域网地址，请先连接 Wi-Fi 或网线")?;
        Some(tokio::net::TcpListener::bind((ip, address.port())).await
            .map_err(|err| format!("无法启动局域网访问（{err}）"))?)
    } else {
        None
    };
    let origin = format!("http://{address}");
    let url = format!("{origin}/");
    let shared_client = Arc::new(tokio::sync::Mutex::new(client));
    let assets_app = app.clone();
    let assets = Router::new().fallback(get(move |request: Request| {
        let app = assets_app.clone();
        async move {
            let path = request.uri().path();
            let asset_path = if path == "/" { "/index.html" } else { path };
            let resolver = app.asset_resolver();
            let asset = resolver.get(asset_path.to_owned());
            let is_index = asset_path == "/index.html" || (asset.is_none() && is_page_navigation(&request));
            let asset = if is_index { resolver.get("/index.html".to_owned()) } else { asset };
            let Some(asset) = asset else {
                return StatusCode::NOT_FOUND.into_response();
            };
            if is_index {
                let html = String::from_utf8_lossy(&asset.bytes);
                let html = html.replacen("<head>", "<head><meta name=\"coolapk-desktop-web\">", 1);
                return ([(header::CACHE_CONTROL, "no-cache")], Html(html)).into_response();
            }
            ([(header::CONTENT_TYPE, asset.mime_type)], asset.bytes).into_response()
        }
    }));
    let drafts = Router::new().route(
        "/desktop-drafts",
        post(move |state, headers, request| desktop_drafts(app.clone(), state, headers, request))
            .layer(DefaultBodyLimit::max(384 * 1024 * 1024)),
    );
    let router_for = |origin| {
        let mut state = new_state(Some(origin));
        state.desktop = Some(Arc::clone(&shared_client));
        router_with_assets(Arc::new(state), assets.clone(), drafts.clone())
    };
    let (shutdown, stopped) = tokio::sync::watch::channel(false);
    let serve = |listener, router, mut stopped: tokio::sync::watch::Receiver<bool>| async move {
        if let Err(err) = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = stopped.wait_for(|value| *value).await;
        }).await {
            log::warn!("Desktop Web stopped: {err}");
        }
    };
    let local = serve(listener, router_for(origin), stopped.clone());
    let (lan_url, lan) = if let Some(listener) = lan_listener {
        let origin = format!("http://{}", listener.local_addr().map_err(|err| err.to_string())?);
        let lan_url = format!("{origin}/");
        (Some(lan_url), Some(serve(listener, router_for(origin), stopped)))
    } else {
        (None, None)
    };
    let task = tokio::spawn(async move {
        if let Some(lan) = lan {
            tokio::join!(local, lan);
        } else {
            local.await;
        }
    });
    Ok(DesktopWebServer { url, lan_url, task, shutdown })
}

#[cfg(all(feature = "native", desktop))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopDraftRequest {
    file_name: String,
    key: String,
    value: Option<Value>,
}

#[cfg(all(feature = "native", desktop))]
async fn desktop_drafts(
    app: tauri::AppHandle,
    State(state): State<Arc<WebState>>,
    headers: HeaderMap,
    request: Request,
) -> Result<Json<Value>, WebError> {
    use axum::extract::FromRequest;
    use tauri_plugin_store::StoreExt;

    state.session(&headers, false)?;
    let _permit = state.uploads.try_acquire()
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "草稿请求过多，请稍后重试"))?;
    let Json(draft) = Json::<DesktopDraftRequest>::from_request(request, &state).await
        .map_err(|_| error(StatusCode::BAD_REQUEST, "草稿参数无效或超出大小限制"))?;
    if !matches!((draft.file_name.as_str(), draft.key.as_str()),
        ("comment_drafts.json", "drafts") | ("publish_drafts.json", "drafts" | "fullDrafts"))
    {
        return Err(error(StatusCode::BAD_REQUEST, "草稿类型无效"));
    }
    let store = app.store(&draft.file_name)
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "无法打开桌面草稿"))?;
    if let Some(value) = draft.value {
        if !value.is_object() {
            return Err(error(StatusCode::BAD_REQUEST, "草稿格式无效"));
        }
        store.set(&draft.key, value);
        store.save().map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "无法保存桌面草稿"))?;
        return Ok(Json(Value::Null));
    }
    Ok(Json(store.get(&draft.key).unwrap_or(Value::Null)))
}

#[cfg_attr(all(feature = "native", desktop), allow(dead_code))]
pub async fn run() -> anyhow::Result<()> {
    let bind: SocketAddr = std::env::var("COOLAPK_WEB_BIND")
        .unwrap_or_else(|_| "127.0.0.1:17521".into())
        .parse()
        .context("COOLAPK_WEB_BIND 无效")?;
    let dist =
        PathBuf::from(std::env::var_os("COOLAPK_WEB_DIST").unwrap_or_else(|| "dist-web".into()));
    ensure!(
        dist.join("index.html").is_file(),
        "找不到 Web 构建产物，请先执行 npm run build:web"
    );
    let mut state = new_state(None);
    state.demo_mode = match std::env::var("COOLAPK_WEB_DEMO").as_deref() {
        Ok("1" | "true") => true,
        Ok("0" | "false") | Err(std::env::VarError::NotPresent) => false,
        _ => anyhow::bail!("COOLAPK_WEB_DEMO 必须为 0、1、false 或 true"),
    };
    // 演示模式不读取或写入保存过账号的会话目录。
    if !state.demo_mode
        && let Some(dir) = std::env::var_os("COOLAPK_WEB_DATA_DIR").map(PathBuf::from)
    {
        std::fs::create_dir_all(&dir).context("无法创建 Web 会话目录")?;
        state.session_dir = Some(dir);
    }
    let state = Arc::new(state);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    println!("Coolapk Web listening on {bind}");
    axum::serve(listener, router(state, dist)).await?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    const ORIGIN: &str = "https://coolapk.example";

    fn state() -> Arc<WebState> {
        Arc::new(new_state(None))
    }

    async fn post(app: &Router, path: &str, origin: &str, cookie: &str, args: Value) -> Response {
        app.clone()
            .oneshot(
                Request::post(path)
                    .header(header::ORIGIN, origin)
                    .header("sec-fetch-site", "same-origin")
                    .header(header::COOKIE, cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(args.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn open_session(app: &Router, origin: &str) -> String {
        let response = post(app, "/api/session", origin, "", json!({})).await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(cookie.starts_with(SECURE_SESSION_COOKIE));
        assert!(
            cookie.contains("; Secure")
                && cookie.contains("; HttpOnly")
                && cookie.contains("; SameSite=Strict")
        );
        cookie.split(';').next().unwrap().to_owned()
    }

    #[tokio::test]
    async fn public_media_does_not_wait_for_account_requests() {
        let state = state();
        let app = router(Arc::clone(&state), PathBuf::from("dist-web"));
        let cookie = open_session(&app, ORIGIN).await;
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_str(&cookie).unwrap());
        let (session, _) = state.session(&headers, false).unwrap();
        let _account = session.client.lock().await;
        let _requests = state.requests.acquire_many(16).await.unwrap();
        let response = tokio::time::timeout(
            Duration::from_secs(1),
            post(
                &app,
                "/api/command/get_image_data_url",
                ORIGIN,
                &cookie,
                json!({"url":"https://example.invalid/image.png"}),
            ),
        )
        .await
        .expect("media must not wait for the account lock");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn cache_policy_only_marks_hashed_assets_immutable() {
        assert_eq!(static_cache_control("/"), Some("no-cache"));
        assert_eq!(static_cache_control("/index.html"), Some("no-cache"));
        assert_eq!(
            static_cache_control("/assets/index-Abc-1234.js"),
            Some("public, max-age=31536000, immutable")
        );
        assert_eq!(static_cache_control("/assets/icon.png"), None);
        assert_eq!(
            static_cache_control("/api/command/get_image_data_url"),
            None
        );
    }

    #[tokio::test]
    async fn replaces_legacy_cookie_and_accepts_the_new_cookie_even_if_both_are_sent() {
        let state = state();
        let origin = "http://127.0.0.1:17521";
        let app = router(Arc::clone(&state), PathBuf::from("dist-web"));
        let stale = format!("{SESSION_COOKIE}=stale");
        let rejected = post(
            &app,
            "/api/command/list_accounts",
            origin,
            &stale,
            json!({}),
        )
        .await;
        assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

        let renewed = post(&app, "/api/session", origin, &stale, json!({})).await;
        assert_eq!(renewed.status(), StatusCode::NO_CONTENT);
        let mut cookies = renewed.headers().get_all(header::SET_COOKIE).iter();
        let fresh = cookies
            .next()
            .unwrap()
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap();
        assert!(
            cookies
                .next()
                .unwrap()
                .to_str()
                .unwrap()
                .contains("Path=/api; Max-Age=0")
        );

        let mixed = format!("{stale}; {fresh}");
        let recovered = post(
            &app,
            "/api/command/list_accounts",
            origin,
            &mixed,
            json!({}),
        )
        .await;
        assert_eq!(recovered.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn accounts_are_scoped_to_the_browser_session() {
        let state = state();
        let app = router(Arc::clone(&state), PathBuf::from("dist-web"));
        let a = open_session(&app, ORIGIN).await;
        let b = open_session(&app, ORIGIN).await;
        assert_ne!(a, b);
        let guest = post(
            &app,
            "/api/command/check_login_status",
            ORIGIN,
            &b,
            json!({}),
        )
        .await;
        assert_eq!(guest.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(guest.into_body(), 4096).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            json!({ "code": 200, "data": null })
        );
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_str(&a).unwrap());
        let (session, _) = state.session(&headers, false).unwrap();
        session
            .client
            .lock()
            .await
            .save_account("123", "example", "", "SESSID=fake-test-value; uid=123")
            .await
            .unwrap();

        for (cookie, count) in [(&a, 1), (&b, 0)] {
            let response = post(
                &app,
                "/api/command/list_accounts",
                ORIGIN,
                cookie,
                json!({}),
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
            let bytes = axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap();
            let data: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(data["data"].as_array().unwrap().len(), count);
            assert!(!String::from_utf8_lossy(&bytes).contains("fake-test-value"));
        }
    }

    #[tokio::test]
    async fn memory_session_limit_reclaims_old_guest_but_preserves_account_and_active_requests() {
        let state = new_state(None);
        let headers = HeaderMap::new();
        let (signed_in, signed_in_key) = state.session(&headers, true).unwrap();
        signed_in.client.lock().await.set_user_cookie("SESSID=fake; uid=123".into()).unwrap();
        drop(signed_in);
        let (busy, busy_key) = state.session(&headers, true).unwrap();
        let (saved_account, saved_account_key) = state.session(&headers, true).unwrap();
        saved_account.client.lock().await.save_account("456", "example", "", "SESSID=fake; uid=456").await.unwrap();
        saved_account.client.lock().await.clear_user_cookie().unwrap();
        drop(saved_account);
        let (old_guest, old_guest_key) = state.session(&headers, true).unwrap();
        *old_guest.last_used.lock().unwrap() = Instant::now() - Duration::from_secs(60);
        drop(old_guest);
        for _ in 4..MAX_SESSIONS {
            state.session(&headers, true).unwrap();
        }

        state.session(&headers, true).unwrap();
        let sessions = state.sessions.lock().unwrap();
        assert_eq!(sessions.len(), MAX_SESSIONS);
        assert!(!sessions.contains_key(&old_guest_key.unwrap()));
        assert!(sessions.contains_key(&signed_in_key.unwrap()));
        assert!(sessions.contains_key(&saved_account_key.unwrap()));
        assert!(Arc::ptr_eq(sessions.get(&busy_key.unwrap()).unwrap(), &busy));
    }

    #[tokio::test]
    async fn demo_uses_guest_sessions_and_rejects_login_commands() {
        let normal_state = state();
        let normal_app = router(Arc::clone(&normal_state), PathBuf::from("dist-web"));
        let normal_cookie = open_session(&normal_app, ORIGIN).await;
        let mut demo_state = new_state(None);
        demo_state.demo_mode = true;
        let demo_app = router(Arc::new(demo_state), PathBuf::from("dist-web"));

        let guest_status = "/api/command/check_login_status";
        let old_session = post(&demo_app, guest_status, ORIGIN, &normal_cookie, json!({})).await;
        assert_eq!(old_session.status(), StatusCode::UNAUTHORIZED);

        let response = post(&demo_app, "/api/session", ORIGIN, &normal_cookie, json!({})).await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(cookie.starts_with(SECURE_DEMO_SESSION_COOKIE));
        let cookie = cookie.split(';').next().unwrap();
        let cookies = format!("{normal_cookie}; {cookie}");
        let guest = post(&demo_app, guest_status, ORIGIN, &cookies, json!({})).await;
        assert_eq!(guest.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(guest.into_body(), 4096).await.unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), json!({ "code": 200, "data": null }));

        for (command, args) in [
            ("import_web_account", json!({ "cookieStr": "SESSID=unused; uid=123" })),
            ("login_as", json!({ "uid": "123" })),
            ("login_by_account", json!({ "account": "example", "password": "unused" })),
            ("login_by_mobile", json!({ "mobile": "13800000000", "vcode": "123456" })),
            ("send_sms_vcode", json!({ "mobile": "13800000000" })),
            ("save_cookie_securely", json!({ "cookieStr": "SESSID=unused; uid=123" })),
        ] {
            let response = post(&demo_app, &format!("/api/command/{command}"), ORIGIN, &cookies, args).await;
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{command}");
        }

        let normal = post(&normal_app, guest_status, ORIGIN, &cookies, json!({})).await;
        assert_eq!(normal.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn refuses_foreign_origins_and_native_or_untrusted_requests() {
        let state = state();
        let app = router(Arc::clone(&state), PathBuf::from("dist-web"));
        assert_eq!(
            app.clone()
                .oneshot(Request::post("/api/session")
                    .header(header::ORIGIN, "https://wrong.example")
                    .header("sec-fetch-site", "cross-site")
                    .body(Body::empty())
                    .unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            post(
                &app,
                "/api/command/list_accounts",
                ORIGIN,
                "",
                json!({})
            )
            .await
            .status(),
            StatusCode::UNAUTHORIZED
        );
        let cookie = open_session(&app, ORIGIN).await;
        for (name, args) in [
            ("get_user_cookie", json!({})),
            ("set_network_proxy", json!({})),
            ("save_cookie_securely", json!({"cookieStr":"SESSID=fake"})),
            ("get_index_v8_feeds", json!({"page":"1"})),
            (
                "get_image_data_url",
                json!({"url":"http://127.0.0.1/image.jpg"}),
            ),
            (
                "fetch_external_page",
                json!({"url":"https://www.coolapk.com/redirect?url=http://127.0.0.1"}),
            ),
        ] {
            let response = post(
                &app,
                &format!("/api/command/{name}"),
                ORIGIN,
                &cookie,
                args,
            )
            .await;
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{name}");
        }
    }
}
