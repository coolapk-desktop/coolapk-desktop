use super::{
    client::CoolapkClient,
    http_session::{Policy as SessionPolicy, session},
};
use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD as BASE64, STANDARD_NO_PAD as BASE64_NO_PAD},
};
use serde_json::Value;

fn download_value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) if !value.trim().is_empty() => Some(value.trim().to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

pub(crate) fn download_object_string(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .and_then(|item| item.get(*key))
            .and_then(download_value_to_string)
    })
}

fn decode_extra_analysis_data(value: &str) -> Option<Value> {
    let encoded = value.split('~').next()?.trim();
    if encoded.is_empty() {
        return None;
    }
    let bytes = BASE64
        .decode(encoded)
        .or_else(|_| BASE64_NO_PAD.decode(encoded))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(crate) fn build_coolapk_download_url(
    package_name: &str,
    apk_id: &str,
    version_code: &str,
) -> Result<reqwest::Url, String> {
    let package_name = package_name.trim();
    let apk_id = apk_id.trim();
    let version_code = version_code.trim();
    if package_name.is_empty() || apk_id.is_empty() || version_code.is_empty() {
        return Err("应用下载参数不完整，缺少包名、应用 ID 或版本号".to_string());
    }
    let mut url = reqwest::Url::parse("https://api.coolapk.com/v6/apk/download")
        .map_err(|error| format!("构造酷安下载地址失败：{error}"))?;
    url.query_pairs_mut()
        .append_pair("pn", package_name)
        .append_pair("aid", apk_id)
        .append_pair("vc", version_code)
        .append_pair("extra", "");
    Ok(url)
}

pub(crate) fn is_coolapk_download_host(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "api.coolapk.com" | "api-dev.coolapk.com"
    )
}

pub(crate) fn is_windows_reserved_file_name(file_name: &str) -> bool {
    if !cfg!(windows) {
        return false;
    }
    let base_name = file_name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches(|character| character == ' ' || character == '.')
        .to_ascii_uppercase();
    if matches!(base_name.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    let bytes = base_name.as_bytes();
    (bytes.len() == 4 && (bytes.starts_with(b"COM") || bytes.starts_with(b"LPT")))
        && (b'1'..=b'9').contains(&bytes[3])
}

pub(crate) fn sanitize_apk_file_name(file_name: &str) -> Result<String, String> {
    let mut safe_name = file_name
        .chars()
        .take(160)
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if safe_name.is_empty() || safe_name == "." || safe_name == ".." || safe_name.contains("..") {
        return Err("下载文件名不合法".to_string());
    }
    let lower_name = safe_name.to_ascii_lowercase();
    if ![".apk", ".xapk", ".apks"]
        .iter()
        .any(|suffix| lower_name.ends_with(suffix))
    {
        safe_name.push_str(".apk");
    }
    if is_windows_reserved_file_name(&safe_name) {
        safe_name.insert(0, '_');
    }
    Ok(safe_name)
}

pub(crate) fn empty_download_verification(value: &Value) -> bool {
    match value.get("data") {
        None | Some(Value::Null) => true,
        Some(Value::String(data)) => data.trim().is_empty(),
        Some(_) => false,
    }
}

pub(crate) async fn resolve_apk_download_url(
    client: &CoolapkClient,
    package_name: &str,
    apk_id: Option<&str>,
    version_code: Option<&str>,
    extra_analysis_data: Option<&str>,
) -> Result<reqwest::Url, String> {
    // /v6/apk/url 返回的是网页跳转地址，不能当作安装包下载地址。
    let requested_apk_id = apk_id.map(str::trim).filter(|value| !value.is_empty());
    let requested_version_code = version_code
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let detail = if requested_apk_id.is_none() || requested_version_code.is_none() {
        Some(client.get_app_detail(package_name).await?)
    } else {
        None
    };
    let detail_data = detail.as_ref().and_then(|value| value.get("data"));
    let decoded_extra = extra_analysis_data
        .and_then(decode_extra_analysis_data)
        .or_else(|| {
            detail_data
                .and_then(|value| value.get("extraAnalysisData"))
                .and_then(Value::as_str)
                .and_then(decode_extra_analysis_data)
        });
    let resolved_apk_id = requested_apk_id
        .map(str::to_string)
        .or_else(|| download_object_string(detail_data, &["aid", "id", "entityId"]))
        .ok_or_else(|| "应用详情未返回数字应用 ID".to_string())?;
    let resolved_version_code = requested_version_code
        .map(str::to_string)
        .or_else(|| {
            download_object_string(
                detail_data,
                &[
                    "versionCode",
                    "versioncode",
                    "version_code",
                    "apkversioncode",
                    "apkVersionCode",
                    "apk_version_code",
                ],
            )
        })
        .or_else(|| {
            download_object_string(
                decoded_extra.as_ref(),
                &["versionCode", "versioncode", "version_code"],
            )
        })
        .ok_or_else(|| "应用详情未返回应用版本号".to_string())?;
    build_coolapk_download_url(package_name, &resolved_apk_id, &resolved_version_code)
}

pub(crate) async fn request_apk_download(
    client: &CoolapkClient,
    request_url: &reqwest::Url,
    existing_length: u64,
    policy: SessionPolicy,
) -> Result<reqwest::Response, String> {
    use reqwest::header::{ACCEPT_ENCODING, COOKIE, RANGE};

    let is_coolapk_download = request_url.host_str().is_some_and(is_coolapk_download_host);
    let http_client = session(request_url.as_str(), policy)?;
    let mut request = if is_coolapk_download {
        http_client
            .post(request_url.clone())
            .form(&[("nd", "1"), ("extraAnalysisData", "")])
    } else {
        http_client.get(request_url.clone())
    };
    if is_coolapk_download {
        request = client.apply_download_headers(request)?;
        if let Some(cookie) = client
            .get_user_cookie()
            .filter(|value| !value.trim().is_empty())
        {
            let header = reqwest::header::HeaderValue::from_str(&cookie)
                .map_err(|_| "登录 Cookie 格式无效".to_string())?;
            request = request.header(COOKIE, header);
        }
    }
    // 反编译 APK 的下载器无论是否断点续传都会发送这两个请求头。
    request = request
        .header(RANGE, format!("bytes={existing_length}-"))
        .header(ACCEPT_ENCODING, "identity");
    request
        .send()
        .await
        .map_err(|error| format!("下载请求失败：{error}"))
}
