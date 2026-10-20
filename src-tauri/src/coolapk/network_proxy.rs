use std::sync::{OnceLock, RwLock, atomic::{AtomicU64, Ordering}};
use std::time::{Duration, Instant};
use serde::Serialize;

// 所有平台共用客户端代理，修改代次用于使下载会话缓存失效。
static PROXY_URL: OnceLock<RwLock<Option<String>>> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn proxy_url() -> &'static RwLock<Option<String>> { PROXY_URL.get_or_init(|| RwLock::new(None)) }

pub(crate) fn generation() -> u64 { GENERATION.load(Ordering::SeqCst) }

pub(crate) fn configure(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    let configured = proxy_url().read().ok().and_then(|value| value.clone());
    match configured {
        Some(url) => builder.proxy(reqwest::Proxy::all(url).expect("已校验的代理地址应保持有效")),
        // “网络代理”设置为空就应当直连。reqwest 默认会读取 HTTP(S)_PROXY，
        // 这会让从带代理环境变量的终端启动的应用悄悄连到本地代理端口。
        None => builder.no_proxy(),
    }
}

pub(crate) fn update(value: Option<&str>) -> Result<Option<String>, String> {
    let value = value.map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned);
    if let Some(url) = value.as_deref() { validate(url)?; }
    let mut configured = proxy_url().write().map_err(|_| "无法更新代理设置".to_string())?;
    let previous = configured.clone();
    if previous != value { *configured = value; GENERATION.fetch_add(1, Ordering::SeqCst); }
    Ok(previous)
}

fn validate(url: &str) -> Result<reqwest::Proxy, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "代理地址无效，请输入完整地址".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "socks4" | "socks4a" | "socks5" | "socks5h") || parsed.host_str().is_none() { return Err("代理类型仅支持 HTTP、HTTPS、SOCKS4、SOCKS4a、SOCKS5 和 SOCKS5h".to_string()); }
    if parsed.path() != "/" && !parsed.path().is_empty() || parsed.query().is_some() || parsed.fragment().is_some() { return Err("代理地址不能包含路径或查询参数".to_string()); }
    reqwest::Proxy::all(url).map_err(|_| "代理地址无效".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyTestResult { pub status_code: u16, pub elapsed_ms: u128 }

pub(crate) async fn test_connection(url: &str) -> Result<ProxyTestResult, String> {
    let proxy = validate(url)?;
    // 使用独立客户端测试草稿地址，不修改当前生效的全局代理。
    let client = super::client::base_http_client_builder().proxy(proxy).timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "创建代理测试客户端失败".to_string())?;
    let started = Instant::now();
    let response = client.get("https://api.coolapk.com/").send().await.map_err(|error| if error.is_timeout() { "代理连接超时，请检查地址和端口".to_string() } else { "代理连接失败，请检查地址、端口和认证信息".to_string() })?;
    if response.status() == reqwest::StatusCode::PROXY_AUTHENTICATION_REQUIRED { return Err("代理认证失败，请检查用户名和密码".to_string()); }
    Ok(ProxyTestResult { status_code: response.status().as_u16(), elapsed_ms: started.elapsed().as_millis() })
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn accepts_supported_proxy_schemes() {
        for scheme in ["http", "https", "socks4", "socks4a", "socks5", "socks5h"] { assert!(validate(&format!("{scheme}://127.0.0.1:7890")).is_ok(), "{scheme}"); }
    }

    #[test]
    fn rejects_unsupported_or_non_proxy_urls() {
        for url in ["ftp://127.0.0.1:21", "http://", "http://127.0.0.1:7890/path", "socks5://127.0.0.1:7890?x=1"] { assert!(validate(url).is_err(), "{url}"); }
    }
}
