use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use bcrypt::{BASE_64 as BCRYPT_BASE64, Version, hash_with_salt};
use md5::{Digest, Md5};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_ID: &str = "com.coolapk.market";
// 签名中的版本编码必须与请求头一致，否则服务端会返回“请求验证错误”。
pub(crate) const APP_CODE: u64 = 2_610_162;
const STD_BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const AUTH_BLOB_B64: &str = include_str!("auth_blob.b64");

/// 酷安 Token V3 离线签名器。
///
/// 算法与项目 Python SDK 保持一致：按时间选取密码表片段，组合设备摘要，
/// 再通过 bcrypt 生成酷安 API 接受的 v3 token。
pub struct CoolapkAuth {
    device_code: String,
    auth_blob: Vec<u8>,
}

impl CoolapkAuth {
    pub fn new(device_code: impl Into<String>) -> Self {
        let auth_blob = BASE64
            .decode(AUTH_BLOB_B64.trim())
            .expect("embedded Coolapk auth blob must be valid base64");

        Self {
            device_code: device_code.into(),
            auth_blob,
        }
    }

    /// 运行时切换设备码（登录/切换账号/游客态之间切换时调用）。
    /// Token V3 与设备码绑定，切换后所有后续请求的签名使用新设备码。
    pub fn set_device_code(&mut self, device_code: String) {
        self.device_code = device_code;
    }

    pub fn get_app_token(&self) -> Result<String, String> {
        self.get_app_token_with_app_code(APP_CODE)
    }

    /// 自定义请求版本与签名必须共用同一个编码，不能始终按内置版本签名。
    pub fn get_app_token_with_app_code(&self, app_code: u64) -> Result<String, String> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("system clock error: {e}"))?
            .as_secs();

        // 某些时间点生成的 22 位盐不满足 bcrypt 字符表，和 Python SDK 一样
        // 最多向前探测 15 秒寻找下一组有效盐。
        let mut last_error = String::new();
        for offset in 0..=15 {
            match self.generate_token_at(timestamp + offset, app_code) {
                Ok(token) => return Ok(token),
                Err(error) => last_error = error,
            }
        }

        Err(format!("failed to generate Coolapk token: {last_error}"))
    }

    fn generate_token_at(&self, timestamp: u64, app_code: u64) -> Result<String, String> {
        let index = (((timestamp + app_code) % 100) * 4 + 0x80) as usize;
        let chunk = self
            .auth_blob
            .get(index..index + 0x80)
            .ok_or_else(|| "auth blob lookup exceeded its bounds".to_string())?;
        let segment = BASE64
            .decode(chunk)
            .map_err(|e| format!("invalid auth blob segment: {e}"))?;

        let device_md5 = md5_hex(self.device_code.as_bytes());
        let plain = format!(
            "{}&{}&{}&{}&{}",
            APP_ID,
            String::from_utf8_lossy(&segment),
            device_md5,
            timestamp,
            app_code
        );

        let password = md5_hex(BASE64.encode(plain.as_bytes()).as_bytes());
        let salt_source = BASE64
            .encode(format!("{:x}/{}", timestamp, md5_hex(plain.as_bytes())))
            .trim_end_matches('=')
            .to_string();
        let salt22 = shift_last_base64_char(
            salt_source
                .get(..22)
                .ok_or_else(|| "generated salt is too short".to_string())?,
            -5,
        )?;

        let salt_bytes = BCRYPT_BASE64
            .decode(salt22.as_bytes())
            .map_err(|e| format!("invalid bcrypt salt: {e}"))?;
        let salt: [u8; 16] = salt_bytes
            .try_into()
            .map_err(|bytes: Vec<u8>| format!("invalid bcrypt salt length: {}", bytes.len()))?;
        // 酷安当前 Token V3 校验使用 bcrypt cost=4；cost=10 会导致登录校验返回“登录信息有误”。
        let hash = hash_with_salt(password.as_bytes(), 4, salt)
            .map_err(|e| format!("bcrypt failed: {e}"))?
            .format_for_version(Version::TwoY);

        Ok(format!(
            "v3{}",
            BASE64.encode(hash.as_bytes()).trim_end_matches('=')
        ))
    }
}

fn md5_hex(bytes: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn shift_last_base64_char(value: &str, shift: i32) -> Result<String, String> {
    let (prefix, last) = value.split_at(value.len().saturating_sub(1));
    let last = last
        .as_bytes()
        .first()
        .ok_or_else(|| "cannot shift an empty salt".to_string())?;
    let index = STD_BASE64_ALPHABET
        .iter()
        .position(|candidate| candidate == last)
        .ok_or_else(|| "salt contains a non-base64 character".to_string())? as i32;
    let shifted = (index + shift).rem_euclid(64) as usize;
    Ok(format!("{prefix}{}", STD_BASE64_ALPHABET[shifted] as char))
}

#[cfg(test)]
mod tests {
    use super::{APP_CODE, CoolapkAuth};
    use base64::{Engine as _, engine::general_purpose::STANDARD_NO_PAD};

    #[test]
    fn signing_uses_the_selected_request_version() {
        let auth = CoolapkAuth::new("synthetic-test-device");
        // 摘要由独立 Python 实现计算，分别覆盖旧版自定义配置与当前默认版本。
        for (code, timestamp, password) in [
            (2_604_201, 1_770_000_000, "1ce908486cd6e2f4aedf30d09ab32e15"),
            (2_610_162, 1_770_000_001, "b716df744e00ecaaddafcc28ac9c6089"),
        ] {
            let token = auth.generate_token_at(timestamp, code).unwrap();
            let hash = String::from_utf8(STANDARD_NO_PAD.decode(token.strip_prefix("v3").unwrap()).unwrap()).unwrap();
            assert!(bcrypt::verify(password, &hash).unwrap(), "版本编码 {code} 的签名摘要不一致");
        }
    }

    #[test]
    fn token_is_deterministic_for_a_synthetic_device_and_timestamp() {
        let auth = CoolapkAuth::new("synthetic-test-device");
        // 此时间点为当前版本生成有效的 bcrypt 盐，固定输入用于验证签名可重复。
        let first = auth.generate_token_at(1_770_000_001, APP_CODE).unwrap();
        let second = auth.generate_token_at(1_770_000_001, APP_CODE).unwrap();
        assert_eq!(first, second);
        assert!(first.starts_with("v3"));
        assert!(first.len() > 70);
    }
}
