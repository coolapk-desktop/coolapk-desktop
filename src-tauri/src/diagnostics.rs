use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Once, OnceLock};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const LOG_PREFIX: &str = "coolapk-diagnostics";
const MAX_FILES: usize = 5;
const MAX_TAIL_BYTES: usize = 2_000_000;
const SESSION_MARKER: &str = "coolapk-session.marker";
const CRASH_FILE: &str = "coolapk-diagnostics-crash.log";
const LOGIN_CHECKPOINT_FILE: &str = "coolapk-diagnostics-login.log";
const FOREGROUND_FILE: &str = "coolapk-diagnostics-foreground.log";
const FOREGROUND_PREVIOUS_FILE: &str = "coolapk-diagnostics-foreground.previous.log";
static REPORT_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
static LOGIN_STAGE: AtomicU8 = AtomicU8::new(0);
static VERBOSE: AtomicBool = AtomicBool::new(false);
static PANIC_HOOK: Once = Once::new();

/// 仅记录固定步骤名，禁止把 Cookie、授权码或完整 URL 写入崩溃检查点。
#[derive(Clone, Copy)]
#[repr(u8)]
pub enum LoginStage {
    OpenRequested = 1,
    WindowBuildStarted,
    WindowBuildCompleted,
    SafeAreaStarted,
    SafeAreaCompleted,
    CookieReadStarted,
    CookieReadCompleted,
    CloseRequested,
    CloseCompleted,
}

fn login_stage_name(stage: u8) -> &'static str {
    match stage {
        1 => "open_requested",
        2 => "window_build_started",
        3 => "window_build_completed",
        4 => "safe_area_started",
        5 => "safe_area_completed",
        6 => "cookie_read_started",
        7 => "cookie_read_completed",
        8 => "close_requested",
        9 => "close_completed",
        _ => "none",
    }
}

/// 独立文件同步落盘，不依赖日志插件的缓存；只保留最近一次报告并限制大小。
fn write_report(path: &Path, content: &str) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new().create(true).write(true).truncate(true).open(path)?;
    let mut end = content.len().min(64_000);
    while !content.is_char_boundary(end) { end -= 1; }
    file.write_all(content[..end].as_bytes())?;
    file.sync_all()
}

pub fn login_checkpoint(stage: LoginStage) {
    LOGIN_STAGE.store(stage as u8, Ordering::Relaxed);
    let name = login_stage_name(stage as u8);
    log::info!("login.checkpoint stage={name}");
    log::logger().flush();
    if let Some(dir) = REPORT_DIRECTORY.get() {
        let content = format!("version={} os={} pid={} time={} login_stage={name}\n", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::process::id(), chrono::Utc::now().to_rfc3339());
        if write_report(&dir.join(LOGIN_CHECKPOINT_FILE), &content).is_err() {
            log::warn!("diagnostics.checkpoint_write_failed");
        }
    }
}

fn save_crash_report(kind: &str, details: &str) {
    if let Some(dir) = REPORT_DIRECTORY.get() {
        let content = format!("runtime.crash kind={kind} version={} os={} arch={} pid={} time={} login_stage={}\n{details}\n", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH, std::process::id(), chrono::Utc::now().to_rfc3339(), login_stage_name(LOGIN_STAGE.load(Ordering::Relaxed)));
        // 崩溃处理时不调用日志插件，避免重入其文件锁。
        let _ = write_report(&dir.join(CRASH_FILE), &content);
    }
}

#[cfg(target_os = "ios")]
mod ios_exceptions {
    use super::*;
    use objc2_foundation::{NSException, NSGetUncaughtExceptionHandler, NSSetUncaughtExceptionHandler};

    type ExceptionHandler = unsafe extern "C-unwind" fn(&NSException);
    static INSTALL: Once = Once::new();
    static PREVIOUS: OnceLock<Option<ExceptionHandler>> = OnceLock::new();
    static HANDLING: AtomicBool = AtomicBool::new(false);

    unsafe extern "C-unwind" fn handle_exception(exception: &NSException) {
        if !HANDLING.swap(true, Ordering::Relaxed) {
            // 不记录 reason/userInfo，它们可能包含登录请求或凭据；调用栈足以定位原生方法。
            let stack = exception.callStackSymbols().iter().map(|value| value.to_string()).collect::<Vec<_>>().join("\n");
            save_crash_report("objc_exception", &format!("exception={}\n{stack}", exception.name()));
        }
        if let Some(Some(previous)) = PREVIOUS.get() {
            // 保留已有异常处理器的行为，记录后仍由系统终止异常进程。
            unsafe { previous(exception); }
        }
    }

    pub fn install() {
        INSTALL.call_once(|| unsafe {
            let previous = NSGetUncaughtExceptionHandler();
            let handler = handle_exception as ExceptionHandler as *mut std::ffi::c_void;
            // Foundation 以 void 指针暴露 C 回调；仅在此 FFI 边界转换函数指针。
            let previous = if previous.is_null() || previous == handler { None } else { Some(std::mem::transmute::<*mut std::ffi::c_void, ExceptionHandler>(previous)) };
            let _ = PREVIOUS.set(previous);
            NSSetUncaughtExceptionHandler(handler);
        });
    }
}

pub fn install_panic_hook() {
    PANIC_HOOK.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let thread = std::thread::current();
            let location = info
                .location()
                .map(|value| format!("{}:{}:{}", value.file(), value.line(), value.column()))
                .unwrap_or_else(|| "unknown".to_string());
            // Panic 载荷可能包含账号或请求数据，只记录线程和代码位置。
            save_crash_report("rust_panic", &format!("thread={} location={}\n{}", thread.name().unwrap_or("unnamed"), location, std::backtrace::Backtrace::force_capture()));
            log::error!(
                "runtime.panic thread={} location={}",
                thread.name().unwrap_or("unnamed"),
                location
            );
            previous(info);
        }));
    });
}

fn create_session_marker(path: &Path) -> std::io::Result<bool> {
    let previous_unclean = path.exists();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let started_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    fs::write(path, format!("pid={} started_at={started_at}\n", std::process::id()))?;
    Ok(previous_unclean)
}

pub fn begin_session(app: &tauri::AppHandle) {
    crate::performance_diagnostics::start();
    if let Ok(dir) = log_dir(app) {
        if fs::create_dir_all(&dir).is_ok() {
            let _ = REPORT_DIRECTORY.set(dir);
            #[cfg(target_os = "ios")]
            ios_exceptions::install();
        }
    }
    let marker = log_dir(app).map(|dir| dir.join(SESSION_MARKER));
    match marker.and_then(|path| create_session_marker(&path).map_err(|_| "write failed".to_string())) {
        Ok(previous_unclean) => log::info!(
            "runtime.started version={} os={} arch={} pid={} previous_exit_unclean={}",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH,
            std::process::id(),
            previous_unclean
        ),
        Err(_) => log::warn!("runtime.session_marker_failed operation=start"),
    }
}

pub fn end_session(app: &tauri::AppHandle) {
    crate::performance_diagnostics::stop();
    log::info!("runtime.exit_normal pid={}", std::process::id());
    if let Ok(dir) = log_dir(app) {
        let marker = dir.join(SESSION_MARKER);
        if marker.exists() && fs::remove_file(marker).is_err() {
            log::warn!("runtime.session_marker_failed operation=exit");
        }
    }
}

pub fn verbose_enabled() -> bool {
    VERBOSE.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn get_diagnostic_verbose() -> bool {
    verbose_enabled()
}

#[tauri::command]
pub fn set_diagnostic_verbose(enabled: bool) {
    VERBOSE.store(enabled, Ordering::Relaxed);
    log::info!("diagnostics.verbose_changed enabled={enabled}");
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticFile {
    name: String,
    size: u64,
    modified_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSnapshot {
    files: Vec<DiagnosticFile>,
    content: String,
    directory: String,
}

fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_log_dir().map_err(|error| error.to_string())
}

fn is_diagnostic_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(LOG_PREFIX) && name.contains(".log"))
}

fn list_log_paths(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_file() && is_diagnostic_file(&path) {
            paths.push(path);
        }
    }
    paths.sort_by_key(|path| path.metadata().and_then(|meta| meta.modified()).ok());
    Ok(paths)
}

fn select_report_paths(paths: &[PathBuf]) -> Vec<&PathBuf> {
    let is_report = |path: &PathBuf| matches!(path.file_name().and_then(|name| name.to_str()), Some(CRASH_FILE | LOGIN_CHECKPOINT_FILE | FOREGROUND_FILE | FOREGROUND_PREVIOUS_FILE));
    let mut selected: Vec<_> = paths.iter().rev().filter(|path| !is_report(path)).take(MAX_FILES).collect();
    selected.reverse();
    // 原生恢复日志不依赖页面脚本；与崩溃报告、检查点一样，不能被普通日志轮转挤出导出。
    selected.extend(paths.iter().filter(|path| is_report(path)));
    selected
}

#[tauri::command]
pub fn get_diagnostic_logs(app: tauri::AppHandle) -> Result<DiagnosticSnapshot, String> {
    let dir = log_dir(&app)?;
    let paths = list_log_paths(&dir)?;
    let mut files = Vec::new();
    let mut content = String::new();
    for path in select_report_paths(&paths) {
        let metadata = path.metadata().map_err(|error| error.to_string())?;
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let tail = &bytes[bytes.len().saturating_sub(MAX_TAIL_BYTES)..];
        content.push_str(&format!("\n===== {name} =====\n"));
        content.push_str(&String::from_utf8_lossy(tail));
        files.push(DiagnosticFile {
            name,
            size: metadata.len(),
            modified_at: metadata.modified().ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |duration| duration.as_secs()),
        });
    }
    Ok(DiagnosticSnapshot {
        files,
        content,
        directory: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn clear_diagnostic_logs(app: tauri::AppHandle) -> Result<usize, String> {
    let dir = log_dir(&app)?;
    let paths = list_log_paths(&dir)?;
    let mut cleared = 0;
    for path in paths {
        if path.file_name().and_then(|name| name.to_str()) == Some("coolapk-diagnostics.log") {
            fs::OpenOptions::new().write(true).open(&path)
                .and_then(|file| file.set_len(0))
                .map_err(|error| format!("清空当前日志失败：{error}"))?;
        } else {
            fs::remove_file(&path).map_err(|error| format!("清理旧日志失败：{error}"))?;
        }
        cleared += 1;
    }
    Ok(cleared)
}

#[cfg(test)]
mod tests {
    use super::{create_session_marker, is_diagnostic_file, select_report_paths, write_report, CRASH_FILE, LOGIN_CHECKPOINT_FILE, FOREGROUND_FILE, FOREGROUND_PREVIOUS_FILE};
    use std::path::Path;

    #[test]
    fn only_reads_own_log_files() {
        assert!(is_diagnostic_file(Path::new("coolapk-diagnostics.log")));
        assert!(is_diagnostic_file(Path::new("coolapk-diagnostics.log.2026-09-26")));
        assert!(!is_diagnostic_file(Path::new("other-app.log")));
        assert!(!is_diagnostic_file(Path::new("coolapk-diagnostics.txt")));
    }

    #[test]
    fn export_keeps_crash_report_even_after_log_rotation() {
        let mut paths = vec![CRASH_FILE.into(), LOGIN_CHECKPOINT_FILE.into()];
        paths.extend((0..8).map(|index| format!("coolapk-diagnostics.log.{index}").into()));
        let selected = select_report_paths(&paths);
        assert_eq!(selected.len(), 7);
        assert!(selected.iter().any(|path| path.file_name().unwrap() == CRASH_FILE));
        assert!(selected.iter().any(|path| path.file_name().unwrap() == LOGIN_CHECKPOINT_FILE));
        assert!(!selected.iter().any(|path| path.file_name().unwrap() == "coolapk-diagnostics.log.0"));
    }

    #[test]
    fn export_keeps_native_foreground_logs_even_after_log_rotation() {
        // 黑屏恢复后再导出时，保留新旧原生记录，避免被后续大量接口日志挤掉。
        let mut paths = vec![FOREGROUND_PREVIOUS_FILE.into(), FOREGROUND_FILE.into()];
        paths.extend((0..8).map(|index| format!("coolapk-diagnostics.log.{index}").into()));
        let selected = select_report_paths(&paths);
        assert_eq!(selected.len(), 7);
        assert!(selected.iter().any(|path| path.file_name().unwrap() == FOREGROUND_FILE));
        assert!(selected.iter().any(|path| path.file_name().unwrap() == FOREGROUND_PREVIOUS_FILE));
        assert!(!selected.iter().any(|path| path.file_name().unwrap() == "coolapk-diagnostics.log.0"));
    }

    #[test]
    fn crash_report_is_bounded_valid_utf8_and_replaces_previous_report() {
        let path = std::env::temp_dir().join(format!("coolapk-crash-test-{}.log", std::process::id()));
        write_report(&path, &"异常".repeat(20_000)).unwrap();
        let report = std::fs::read_to_string(&path).unwrap();
        assert!(report.len() <= 64_000);
        assert!(report.ends_with('异') || report.ends_with('常'));
        write_report(&path, "新的报告").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "新的报告");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn session_marker_identifies_unclean_restart() {
        let path = std::env::temp_dir().join(format!("coolapk-session-test-{}.marker", std::process::id()));
        let _ = std::fs::remove_file(&path);
        assert!(!create_session_marker(&path).unwrap());
        assert!(create_session_marker(&path).unwrap());
        std::fs::remove_file(&path).unwrap();
        assert!(!create_session_marker(&path).unwrap());
        std::fs::remove_file(path).unwrap();
    }
}
