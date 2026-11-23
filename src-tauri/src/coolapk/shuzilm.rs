//! DUID 协议参考 kongwufang/szlm_res（MIT，见 NOTICE.md）。
//! 只发送新建的合成标识；不读取硬件标识，不携带酷安账号或 Cookie。
use flate2::{Compression, read::ZlibDecoder, write::ZlibEncoder};
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const ENDPOINT: &str = "https://auni.telecome.cn/a/mdna/report?v=8.7&t=m&p=F9BD0FBDACFE80FCF34370FBCFEE1A98&r=5bb7efdd4c794f0e9563317b7802b995&n=0&l=2&h=0";
const KEY: &[u8] = b"xp7j@&!v5]2k#+3z{n9$q^r%[8f1*d4e:c>0l?m/6)yb-=w}";
const MAX_RESPONSE: usize = 64 * 1024;

#[derive(Default)]
pub(crate) struct IdentityState {
    pub automatic: bool,
    pub guest_id: Option<String>,
    pub account_id: Option<(String, String)>,
    pub auth_epoch: u64,
    pub last_failure: Option<Instant>,
    pub error: Option<String>,
}

impl IdentityState {
    pub fn active_id(&self, uid: Option<&str>) -> Option<&str> {
        match uid {
            None => self.guest_id.as_deref(),
            Some(uid) => self.account_id.as_ref().filter(|(owner, _)| owner == uid).map(|(_, id)| id.as_str()),
        }
    }

    pub fn session_changed(&mut self) {
        self.auth_epoch = self.auth_epoch.wrapping_add(1);
        self.account_id = None;
        self.error = None;
    }

    pub fn should_generate(&self, uid: Option<&str>) -> bool {
        self.automatic && self.active_id(uid).is_none()
            && self.last_failure.is_none_or(|time| time.elapsed() >= Duration::from_secs(60))
    }
}

pub(crate) fn valid_duid(id: &str) -> bool {
    id.starts_with("DU") && (10..=128).contains(&id.len())
        && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn new_payload() -> Result<Value, String> {
    let mut random = [0u8; 96];
    getrandom::fill(&mut random).map_err(|_| "无法创建随机设备标识".to_string())?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "系统时间无效".to_string())?;
    // 最小协议字段，不复用上游测试设备的锚点、证书、局域网地址或硬件信息。
    Ok(json!({
        "DUv": "com.coolapk.market", "3mS": "v9.0.1", "AAA": "v1.0",
        "75c": "11e7b222083a4b732b4b14811f6fc05995a01415eb",
        "sfOo": hex::encode_upper(&random[..4])[..7],
        "foO": hex::encode(&random[4..12])[..15],
        "2cO": format!("{}.{:09}", now.as_secs(), now.subsec_nanos()),
        "w91": hex::encode_upper(&random[12..28]),
        "gEd": hex::encode(&random[28..44]), "6yY": hex::encode(&random[44..76]),
    }))
}

fn xor(bytes: &[u8]) -> Vec<u8> {
    bytes.iter().enumerate().map(|(i, byte)| byte ^ KEY[i % KEY.len()]).collect()
}

fn encode(payload: &Value) -> Result<Vec<u8>, String> {
    let raw = serde_json::to_string(payload).map_err(|_| "设备请求编码失败".to_string())?.replace('/', "\\/");
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::new(6));
    encoder.write_all(raw.as_bytes()).map_err(|_| "设备请求压缩失败".to_string())?;
    Ok(xor(&encoder.finish().map_err(|_| "设备请求压缩失败".to_string())?))
}

fn decode_response(raw: &[u8]) -> Result<String, String> {
    if raw.len() > MAX_RESPONSE { return Err("数盟响应超过大小限制".into()); }
    let decoded = xor(raw);
    let mut json_bytes = Vec::new();
    if ZlibDecoder::new(decoded.as_slice()).take((MAX_RESPONSE + 1) as u64).read_to_end(&mut json_bytes).is_err() {
        json_bytes = decoded;
    }
    if json_bytes.len() > MAX_RESPONSE { return Err("数盟响应超过大小限制".into()); }
    let value: Value = serde_json::from_slice(&json_bytes).map_err(|_| "数盟响应格式无效".to_string())?;
    let id = value.get("n_a").and_then(Value::as_str).unwrap_or("");
    if !valid_duid(id) { return Err("数盟未返回有效设备 ID，请稍后重试".into()); }
    Ok(id.to_string())
}

pub(crate) async fn generate() -> Result<String, String> {
    let body = encode(&new_payload()?)?;
    // 使用应用代理设置并正常验证 TLS；独立客户端不继承账号头或 Cookie，也不跟随跳转。
    let client = super::client::http_client_builder()
        .redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(12))
        .build().map_err(|_| "无法创建数盟请求客户端".to_string())?;
    let mut response = client.post(ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("User-Agent", "Dalvik/2.1.0 (Linux; U; Android 8.1; TK Watch Build/OPM2.171019.012)")
        .header("Accept-Encoding", "identity").body(body).send().await
        .map_err(|_| "获取数盟设备 ID 失败，请检查网络或代理后重试".to_string())?;
    if !response.status().is_success() { return Err(format!("数盟服务返回 HTTP {}", response.status().as_u16())); }
    let mut raw = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取数盟响应失败".to_string())? {
        if raw.len() + chunk.len() > MAX_RESPONSE { return Err("数盟响应超过大小限制".into()); }
        raw.extend_from_slice(&chunk);
    }
    decode_response(&raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_selection_never_leaks_between_guest_and_accounts() {
        let mut state = IdentityState { automatic: true, guest_id: Some("DUguest123456".into()), ..Default::default() };
        assert_eq!(state.active_id(None), Some("DUguest123456"));
        assert_eq!(state.active_id(Some("1")), None);
        state.account_id = Some(("1".into(), "DUaccount123456".into()));
        assert_eq!(state.active_id(Some("1")), Some("DUaccount123456"));
        assert_eq!(state.active_id(Some("2")), None);
        state.session_changed();
        assert_eq!(state.active_id(Some("1")), None);
        assert_eq!(state.active_id(None), Some("DUguest123456"));
    }

    #[test]
    fn automatic_generation_checks_current_identity_and_failure_cooldown() {
        let mut state = IdentityState { automatic: true, ..Default::default() };
        assert!(state.should_generate(None));
        assert!(state.should_generate(Some("1")));
        state.last_failure = Some(Instant::now());
        assert!(!state.should_generate(None));
        assert!(!state.should_generate(Some("1")));
        state.last_failure = None;
        state.guest_id = Some("DUguest123456".into());
        assert!(!state.should_generate(None));
        assert!(state.should_generate(Some("1")));
        state.account_id = Some(("1".into(), "DUaccount123456".into()));
        assert!(!state.should_generate(Some("1")));
        assert!(state.should_generate(Some("2")));
    }

    #[test]
    fn payload_is_fresh_minimal_and_roundtrips_protocol_encoding() {
        let a = new_payload().unwrap();
        let b = new_payload().unwrap();
        assert_eq!(a.as_object().unwrap().len(), 10);
        for field in ["sfOo", "foO", "2cO", "w91", "gEd", "6yY"] { assert_ne!(a[field], b[field]); }
        let encoded = encode(&a).unwrap();
        let plain = xor(&encoded);
        let decoded: Value = serde_json::from_reader(ZlibDecoder::new(plain.as_slice())).unwrap();
        assert_eq!(decoded, a);
    }

    #[test]
    fn responses_reject_zero_invalid_and_oversized_ids() {
        for id in ["", "000000000000000000000000000000000000", "DUbad\r\nheader"] {
            assert!(decode_response(&encode(&json!({"n_a": id})).unwrap()).is_err());
        }
        assert_eq!(decode_response(&encode(&json!({"n_a": "DUvalid_test_123456"})).unwrap()).unwrap(), "DUvalid_test_123456");
        assert!(decode_response(&vec![0; MAX_RESPONSE + 1]).is_err());
    }

    #[tokio::test]
    #[ignore = "显式联网验证数盟协议，每次调用仅请求一个新 DUID"]
    async fn live_duid_generation() {
        assert!(valid_duid(&generate().await.expect("数盟真实请求失败")));
    }
}
