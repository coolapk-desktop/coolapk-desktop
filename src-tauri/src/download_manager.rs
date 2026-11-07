use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::watch;

// 复用 delete_apk_download_file 的路径校验/定位辅助函数，保证断点探测与删除逻辑对同一路径的判定一致。
use crate::coolapk::commands::{
    path_is_direct_child_of, reject_download_symlink, user_save_dir,
    validate_download_path_for_file_operation,
};

/// 单个下载任务的控制信号。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DownloadControl {
    Run,
    Pause,
    Cancel,
}

/// 保存正在运行任务的控制通道；任务历史由前端持久化，避免 Rust 状态和页面状态重复存储。
pub struct DownloadManager {
    controls: Mutex<HashMap<String, watch::Sender<DownloadControl>>>,
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            controls: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, task_id: &str) -> Result<watch::Receiver<DownloadControl>, String> {
        let (sender, receiver) = watch::channel(DownloadControl::Run);
        let mut controls = self
            .controls
            .lock()
            .map_err(|_| "下载任务控制器不可用".to_string())?;
        if controls.contains_key(task_id) {
            return Err("下载任务已经在运行".to_string());
        }
        controls.insert(task_id.to_string(), sender);
        Ok(receiver)
    }

    pub fn request(&self, task_id: &str, control: DownloadControl) -> Result<(), String> {
        let controls = self
            .controls
            .lock()
            .map_err(|_| "下载任务控制器不可用".to_string())?;
        let sender = controls
            .get(task_id)
            .ok_or_else(|| "下载任务当前没有运行".to_string())?;
        sender
            .send(control)
            .map_err(|_| "下载任务已经结束".to_string())
    }

    pub fn finish(&self, task_id: &str) {
        if let Ok(mut controls) = self.controls.lock() {
            controls.remove(task_id);
        }
    }
}

/// 断点文件探测的三态结果。
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PartialExistsStatus {
    Exists,
    Missing,
    Unknown,
}

/// 断点(.part)文件只读探测命令。
/// 任何路径校验失败、目录无法解析等情形都安全归为 unknown，而不是报错崩溃——
/// 调用方（下载中心启动恢复）只把它当作「无法确认」，不影响其余恢复流程。
///
/// 之所以放在 Rust 而不是前端 fs 插件：capabilities 只授予了 fs:allow-write-text-file，
/// 没有 exists/read 权限；且必须复用与删除命令完全相同的路径校验（.part 后缀、
/// 拒绝 ..、必须是下载目录直接子文件、拒绝符号链接），前端单独实现会与 Rust 判定漂移。
#[tauri::command]
pub async fn apk_download_partial_exists(
    app: tauri::AppHandle,
    dir: Option<String>,
    partial_path: Option<String>,
    file_name: Option<String>,
) -> Result<PartialExistsStatus, String> {
    let partial = partial_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            // 与下载侧命名方式保持一致：file_name + ".part"
            file_name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .map(|value| format!("{value}.part"))
        });
    let Some(partial) = partial else {
        return Ok(PartialExistsStatus::Unknown);
    };
    let target_dir = match user_save_dir(&app, dir.as_deref()) {
        Ok(value) => value,
        Err(_) => return Ok(PartialExistsStatus::Unknown),
    };
    let path = match validate_download_path_for_file_operation(&partial) {
        Ok(value) => value,
        Err(_) => return Ok(PartialExistsStatus::Unknown),
    };
    // 越界路径（不在下载目录内）与符号链接一律不探测，返回 unknown 防止误判。
    let is_child = matches!(path_is_direct_child_of(&path, &target_dir), Ok(true));
    let not_symlink = reject_download_symlink(&path).is_ok();
    if !is_child || !not_symlink {
        return Ok(PartialExistsStatus::Unknown);
    }
    if path.is_file() {
        Ok(PartialExistsStatus::Exists)
    } else {
        Ok(PartialExistsStatus::Missing)
    }
}

#[cfg(test)]
mod partial_exists_tests {
    use super::*;
    use std::path::Path;

    /// 纯路径校验部分（无文件系统副作用）：合法 .part 名称应通过删除命令同款校验。
    #[test]
    fn valid_partial_name_passes_validation() {
        // 校验要求绝对路径（与删除命令一致），用临时目录拼出绝对路径验证合法名。
        let raw = std::env::temp_dir().join("com.example.app.apk.part");
        let path = validate_download_path_for_file_operation(&raw.to_string_lossy()).unwrap();
        assert_eq!(path.file_name().unwrap(), "com.example.app.apk.part");
    }

    /// 空路径 / 目录穿越 / 非安装包后缀都必须被拒绝，防止探测任意文件。
    #[test]
    fn invalid_partial_names_fail_validation() {
        // 相对路径一律拒绝；空路径、目录穿越、非安装包后缀同理。
        let base = std::env::temp_dir();
        let absolute = |name: &str| base.join(name).to_string_lossy().to_string();
        let bads = [
            "".to_string(),
            "com.example.app.apk.part".to_string(),
            // 注：../穿越靠 path_is_direct_child_of 兜底，文件名校验只看最后一段。
            absolute("notes.txt.part"),
            absolute(".."),
        ];
        for bad in &bads {
            assert!(validate_download_path_for_file_operation(bad).is_err(), "{bad} 应被拒绝");
        }
    }

    /// 直接子文件判定：目录不存在 -> Err，调用方视为 unknown；不 panic。
    #[test]
    fn direct_child_check_is_safe() {
        let base = std::env::temp_dir().join("coolapk_h1_test_child_dir_nonexistent");
        let file = base.join("sub").join("x.apk.part");
        assert!(path_is_direct_child_of(&file, &base).is_err());
    }

    /// 符号链接拒绝：对不存在/普通路径应放行（Ok），存在性判断交给 is_file。
    #[test]
    fn symlink_reject_passes_regular_paths() {
        let missing = std::env::temp_dir().join("coolapk_h1_test_missing.apk.part");
        assert!(reject_download_symlink(Path::new(&missing)).is_ok());
        assert!(!Path::new(&missing).exists());
        let _ = std::fs::remove_file(&missing);
    }
}
