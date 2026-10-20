//! 默认设备指纹只读取系统公开的型号/版本，不读取序列号、设备名称或硬件标识。
use super::client::DeviceProfile;

pub const COMPATIBILITY_UA: &str = "Dalvik/2.1.0 (Linux; U; Android 16; 23113RKC6C Build/AQ3A.250226.002) (#Build; Redmi; 23113RKC6C; AQ3A.250226.002; 16) +CoolMarket/16.2.0-2604201-universal";
#[cfg(any(target_os = "android", target_os = "ios", test))]
const APP_SUFFIX: &str = " +CoolMarket/16.2.0-2604201-universal";

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

#[cfg(any(target_os = "ios", test))]
fn apple_profile(platform: &str, model: &str, version: &str, build: &str) -> Option<DeviceProfile> {
    if model.is_empty() || version.is_empty() || build.is_empty() {
        return None;
    }
    let version_token = version.replace('.', "_");
    let system = match platform {
        "ios" if model.starts_with("iPhone") => {
            format!("iPhone; CPU iPhone OS {version_token} like Mac OS X")
        }
        "ios" if model.starts_with("iPad") => format!("iPad; CPU OS {version_token} like Mac OS X"),
        "ios" if model.starts_with("iPod") => {
            format!("iPod; CPU iPhone OS {version_token} like Mac OS X")
        }
        // 不把模拟器的 arm64/x86_64 当作真实 iPhone 型号。
        "ios" => return None,
        "macos" => format!("Macintosh; Mac OS X {version_token}"),
        _ => return None,
    };
    Some(DeviceProfile {
        manufacturer: Some("Apple".into()),
        brand: Some("Apple".into()),
        model: Some(model.into()),
        build: Some(build.into()),
        user_agent: Some(format!(
            "Mozilla/5.0 ({system}) AppleWebKit/605.1.15 (KHTML, like Gecko) (#Build; Apple; {model}; {build}; {version}){APP_SUFFIX}"
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

#[cfg(target_os = "ios")]
fn sysctl_string(name: &std::ffi::CStr) -> Option<String> {
    use std::ffi::{c_char, c_int, c_void};
    unsafe extern "C" {
        fn sysctlbyname(
            name: *const c_char,
            old: *mut c_void,
            length: *mut usize,
            new: *mut c_void,
            new_length: usize,
        ) -> c_int;
    }
    let mut length = 0;
    // SAFETY: 两阶段读取只读 sysctl；写缓冲区长度与实际分配一致。
    unsafe {
        if sysctlbyname(
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut length,
            std::ptr::null_mut(),
            0,
        ) != 0
            || length == 0
            || length > 4096
        {
            return None;
        }
        let mut bytes = vec![0u8; length];
        if sysctlbyname(
            name.as_ptr(),
            bytes.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }
        bytes.truncate(length);
        while bytes.last() == Some(&0) {
            bytes.pop();
        }
        String::from_utf8(bytes)
            .ok()
            .filter(|value| !value.is_empty())
    }
}

#[cfg(target_os = "macos")]
pub fn detect() -> DeviceProfile {
    // 桌面版请求的是酷安 Android API。将 Mac 主机标识放进 User-Agent 和
    // X-App-Device 会形成服务端不支持的 Apple/Mac 客户端指纹；桌面端沿用
    // Android 兼容模板，避免首页和登录检查被服务端拒绝。
    DeviceProfile::default()
}

#[cfg(target_os = "ios")]
pub fn detect() -> DeviceProfile {
    use objc2::{
        msg_send,
        runtime::{AnyClass, AnyObject},
    };
    use objc2_foundation::NSString;
    let version = unsafe {
        AnyClass::get(c"UIDevice").and_then(|class| {
            let device: *mut AnyObject = msg_send![class, currentDevice];
            if device.is_null() {
                return None;
            }
            let version: *mut NSString = msg_send![device, systemVersion];
            version.as_ref().map(ToString::to_string)
        })
    };
    let model = std::env::var("SIMULATOR_MODEL_IDENTIFIER")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| sysctl_string(c"hw.machine"));
    let profile = model
        .zip(version)
        .zip(sysctl_string(c"kern.osversion"))
        .and_then(|((model, version), build)| apple_profile("ios", &model, &version, &build));
    if profile.is_none() {
        log::warn!("device.native_detection_failed platform=ios; using compatibility profile");
    }
    profile.unwrap_or_default()
}

#[cfg(not(any(target_os = "android", target_os = "ios", target_os = "macos")))]
pub fn detect() -> DeviceProfile {
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
    #[test]
    fn apple_keeps_hardware_identifier_and_system_version() {
        for (platform, model, system) in [
            ("ios", "iPhone17,3", "iPhone; CPU iPhone OS 18_0"),
            ("ios", "iPad14,3", "iPad; CPU OS 18_0"),
            ("macos", "MacBookPro18,3", "Macintosh; Mac OS X 18_0"),
        ] {
            let profile = apple_profile(platform, model, "18.0", "actual-build").unwrap();
            assert_eq!(profile.model.as_deref(), Some(model));
            assert!(profile.user_agent.unwrap().contains(system));
        }
        assert!(apple_profile("ios", "arm64", "18.0", "build").is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_uses_compatibility_profile_instead_of_host_identity() {
        let profile = detect();
        assert!(profile.model.is_none());
        assert!(profile.user_agent.is_none());
    }
}
