//! 仅 Android 默认读取系统公开的真实型号；其他平台使用酷安兼容默认机型。
use super::client::DeviceProfile;

pub const COMPATIBILITY_UA: &str = "Dalvik/2.1.0 (Linux; U; Android 16; 23113RKC6C Build/AQ3A.250226.002) (#Build; Redmi; 23113RKC6C; AQ3A.250226.002; 16) +CoolMarket/16.6.5-2610162-universal";
#[cfg(any(target_os = "android", target_os = "ios", test))]
const APP_SUFFIX: &str = " +CoolMarket/16.6.5-2610162-universal";

#[cfg(any(target_os = "android", test))]
fn android_profile(
    manufacturer: &str,
    brand: &str,
    model: &str,
    build: &str,
    version: &str,
    sdk: &str,
) -> Option<DeviceProfile> {
    if [manufacturer, brand, model, build, version, sdk]
        .iter()
        .any(|value| value.trim().is_empty())
    {
        return None;
    }
    Some(DeviceProfile {
        manufacturer: Some(manufacturer.into()),
        brand: Some(brand.into()),
        model: Some(model.into()),
        build: Some(build.into()),
        sdk_int: Some(sdk.into()),
        user_agent: Some(format!(
            "Dalvik/2.1.0 (Linux; U; Android {version}; {model} Build/{build}) (#Build; {brand}; {model}; {build}; {version}){APP_SUFFIX}"
        )),
        ..Default::default()
    })
}

#[cfg(target_os = "android")]
pub fn detect() -> DeviceProfile {
    // Build 的公开字段来自这些只读系统属性；无需等 WebView/JNI 初始化，也不申请权限。
    fn property(name: &str) -> String {
        use std::ffi::{CString, c_char, c_int};
        unsafe extern "C" {
            fn __system_property_get(name: *const c_char, value: *mut c_char) -> c_int;
        }
        let Ok(name) = CString::new(name) else {
            return String::new();
        };
        // Bionic 的 PROP_VALUE_MAX 为 92；这些公开属性均为短只读值。
        let mut bytes = [0u8; 92];
        let length = unsafe { __system_property_get(name.as_ptr(), bytes.as_mut_ptr().cast()) };
        if length <= 0 || length as usize >= bytes.len() {
            return String::new();
        }
        String::from_utf8(bytes[..length as usize].to_vec())
            .unwrap_or_default()
            .trim()
            .to_string()
    }
    let profile = android_profile(
        &property("ro.product.manufacturer"),
        &property("ro.product.brand"),
        &property("ro.product.model"),
        &property("ro.build.display.id"),
        &property("ro.build.version.release"),
        &property("ro.build.version.sdk"),
    );
    if profile.is_none() {
        log::warn!("device.native_detection_failed platform=android; using compatibility profile");
    }
    profile.unwrap_or_default()
}

#[cfg(not(target_os = "android"))]
pub fn detect() -> DeviceProfile {
    // 酷安接口使用 Android 客户端指纹；避免把 iOS、macOS 或桌面主机信息当作请求机型。
    DeviceProfile::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn android_uses_actual_sdk_and_build() {
        let profile =
            android_profile("Xiaomi", "Redmi", "24117RK2CC", "actual-build", "15", "35").unwrap();
        assert_eq!(profile.sdk_int.as_deref(), Some("35"));
        assert!(
            profile
                .user_agent
                .unwrap()
                .contains("(#Build; Redmi; 24117RK2CC; actual-build; 15)")
        );
        assert!(android_profile("", "", "", "", "", "").is_none());
    }
    #[cfg(not(target_os = "android"))]
    #[test]
    fn non_android_uses_compatibility_profile_instead_of_host_identity() {
        let profile = detect();
        assert!(profile.model.is_none());
        assert!(profile.manufacturer.is_none());
        assert!(profile.brand.is_none());
        assert!(profile.build.is_none());
        assert!(profile.user_agent.is_none());
    }
}
