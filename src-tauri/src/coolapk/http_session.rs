//! 按站点、全局代理代次和跳转策略复用连接池；账号凭据始终由每次请求提供。
use reqwest::{Client, Url};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

pub(crate) const UPDATE_ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "www.github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Policy {
    Follow,
    NoRedirect,
    Download,
    Updater,
}

#[derive(PartialEq, Eq)]
struct Key {
    origin: String,
    policy: Policy,
    proxy_generation: u64,
}

#[derive(Default)]
struct Sessions(VecDeque<(Key, Client)>);

impl Sessions {
    fn get(&mut self, url: &str, policy: Policy) -> Result<Client, String> {
        let url = Url::parse(url).map_err(|_| "HTTP 地址无效".to_string())?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err("仅支持 HTTP(S) 地址".to_string());
        }
        let key = Key {
            origin: url.origin().ascii_serialization(),
            policy,
            proxy_generation: super::network_proxy::generation(),
        };
        if let Some(index) = self.0.iter().position(|(existing, _)| existing == &key) {
            let entry = self.0.remove(index).unwrap();
            let client = entry.1.clone();
            self.0.push_back(entry);
            return Ok(client);
        }
        let mut builder = super::client::http_client_builder();
        builder = match policy {
            Policy::Follow => builder.redirect(reqwest::redirect::Policy::limited(10)),
            Policy::NoRedirect => builder.redirect(reqwest::redirect::Policy::none()),
            Policy::Download => builder
                .user_agent("Dalvik/2.1.0 (Linux; U; Android 16; 23113RKC6C Build/AQ3A.250226.002) +CoolMarket/16.6.5-2610162-universal")
                .redirect(reqwest::redirect::Policy::limited(10)),
            Policy::Updater => builder.user_agent("coolapk-desktop-updater")
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if update_redirect_allowed(attempt.url(), attempt.previous().len()) {
                        attempt.follow()
                    } else { attempt.error("更新包跳转到了不可信地址") }
                })),
        };
        let client = builder
            .build()
            .map_err(|_| "创建 HTTP 客户端失败".to_string())?;
        // 外部网页可能涉及任意站点，限制缓存数量；正在使用的克隆不受淘汰影响。
        if self.0.len() >= 64 {
            self.0.pop_front();
        }
        self.0.push_back((key, client.clone()));
        Ok(client)
    }
}

fn update_redirect_allowed(url: &Url, previous: usize) -> bool {
    previous < 10
        && url.scheme() == "https"
        && url
            .host_str()
            .map(|host| UPDATE_ALLOWED_HOSTS.contains(&host))
            .unwrap_or(false)
}

pub(crate) fn session(url: &str, policy: Policy) -> Result<Client, String> {
    static SESSIONS: OnceLock<Mutex<Sessions>> = OnceLock::new();
    SESSIONS
        .get_or_init(|| Mutex::new(Sessions::default()))
        .lock()
        .map_err(|_| "无法读取 HTTP 连接池".to_string())?
        .get(url, policy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Duration;

    #[tokio::test]
    async fn cached_client_does_not_retain_request_credentials() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    socket.read_exact(&mut byte).unwrap();
                    bytes.push(byte[0]);
                }
                requests.push(String::from_utf8(bytes).unwrap().to_lowercase());
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\nSet-Cookie: server=test\r\n\r\n",
                    )
                    .unwrap();
            }
            requests
        });
        let mut cache = Sessions::default();
        // 使用本地测试服务器验证连接复用，账号凭据只随单次请求发送。
        let first = cache
            .get(&format!("{base}/first"), Policy::Follow)
            .unwrap();
        first
            .get(format!("{base}/first"))
            .timeout(Duration::from_secs(5))
            .header("Cookie", "account=test")
            .header("X-App-Token", "request-only")
            .header("User-Agent", "first-request")
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        let second = cache
            .get(&format!("{base}/second?q=1"), Policy::Follow)
            .unwrap();
        second
            .get(format!("{base}/second"))
            .timeout(Duration::from_secs(5))
            .header("User-Agent", "second-request")
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0].contains("cookie: account=test"));
        assert!(!requests[1].contains("cookie:"));
        assert!(!requests[1].contains("x-app-token:"));
        assert!(requests[0].contains("user-agent: first-request"));
        assert!(requests[1].contains("user-agent: second-request"));
        assert_eq!(requests[1].matches("user-agent:").count(), 1);
        assert_eq!(cache.0.len(), 1);
    }

    #[test]
    fn isolates_origins_and_policies_and_bounds_cache() {
        let mut cache = Sessions::default();
        for (url, policy) in [
            ("https://example.com/a", Policy::Follow),
            ("https://example.com:443/b", Policy::Follow),
            ("http://example.com/a", Policy::Follow),
            ("https://other.example/a", Policy::Follow),
            ("https://example.com:8443/a", Policy::Follow),
            ("https://example.com/a", Policy::NoRedirect),
        ] {
            cache.get(url, policy).unwrap();
        }
        assert_eq!(cache.0.len(), 5);
        assert!(cache.get("file:///tmp/a", Policy::Follow).is_err());
        for port in 10000..10080 {
            cache
                .get(&format!("http://localhost:{port}/"), Policy::Follow)
                .unwrap();
        }
        assert_eq!(cache.0.len(), 64);
    }

    #[test]
    fn updater_rejects_untrusted_redirects() {
        for (url, allowed) in [
            ("https://release-assets.githubusercontent.com/a", true),
            ("http://github.com/a", false),
            ("https://github.com.attacker.test/a", false),
            ("https://example.com/a", false),
        ] {
            assert_eq!(
                update_redirect_allowed(&Url::parse(url).unwrap(), 1),
                allowed
            );
        }
        assert!(!update_redirect_allowed(
            &Url::parse("https://github.com/a").unwrap(),
            10
        ));
    }

    #[tokio::test]
    async fn redirect_policies_remain_independent_on_the_same_origin() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/start", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for _ in 0..3 {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    socket.read_exact(&mut byte).unwrap();
                    bytes.push(byte[0]);
                }
                let request = String::from_utf8(bytes).unwrap();
                let response = if request.lines().next().unwrap().contains("/start ") {
                    "HTTP/1.1 302 Found\r\nLocation: /end\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                } else {
                    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                };
                socket.write_all(response.as_bytes()).unwrap();
            }
        });
        let mut cache = Sessions::default();
        let follow = cache.get(&url, Policy::Follow).unwrap();
        assert_eq!(
            follow
                .get(&url)
                .timeout(Duration::from_secs(5))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        let no_redirect = cache.get(&url, Policy::NoRedirect).unwrap();
        assert_eq!(
            no_redirect
                .get(&url)
                .timeout(Duration::from_secs(5))
                .send()
                .await
                .unwrap()
                .status(),
            302
        );
        server.join().unwrap();
    }
}
