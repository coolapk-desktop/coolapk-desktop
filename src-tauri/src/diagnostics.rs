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

/// Android 生命周期直接写入常规日志，不经过 WebView/页面脚本。
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_coolapk_desktop_MainActivity_logForegroundNative(
    mut env: jni::JNIEnv<'_>,
    _activity: jni::objects::JObject<'_>,
    detail: jni::objects::JString<'_>,
) {
    let Ok(message) = env.get_string(&detail) else { return; };
    log::info!(target: "android.foreground", "{}", message.to_string_lossy());
}

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
    /// 本次快照是否发生过截断（按字节或按行）；导出全文时恒为 false。
    #[serde(default)]
    truncated: bool,
    /// 按行截取模式下的行数上限；导出全文时为 None。
    #[serde(default)]
    line_limit: Option<usize>,
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

/// 取文本尾部最多 lines 行，返回（内容，是否截断）。
/// 注意：lines 按字符行计（split('\n')），UTF-8 多字节字符整行保留，不会切出半个字符。
fn tail_lines(content: &str, lines: usize) -> (String, bool) {
    if lines == 0 {
        return (String::new(), true);
    }
    let total = content.split('\n').count();
    if total <= lines {
        return (content.to_string(), false);
    }
    let tail: Vec<&str> = content.split('\n').skip(total - lines).collect();
    (tail.join("\n"), true)
}

/// 页面展示的总量语义：line_limit 是**所有文件合计**的行数上限，而不是每文件各取 n 行。
/// 这样前端 linesSummary 的「仅显示最近 n 行」文案才与实际返回量一致（否则多文件时是 n×文件数）。
/// 分配规则：从最新的文件往前分配行数预算，优先保留较新文件的尾部；
/// 每个被保留内容的文件都保留 ===== name ===== 头；预算耗尽后被整体挤出的旧文件
/// 保留头并标注「未显示」，让用户知道还有更早的文件（这些标记行不计入行数预算）。
/// 返回（拼接内容，是否发生行截断）。
fn tail_parts(parts: &[(String, String)], lines: usize) -> (String, bool) {
    if lines == 0 {
        return (String::new(), true);
    }
    let mut segments: Vec<String> = Vec::new();
    let mut remaining = lines;
    let mut was_truncated = false;
    // parts 按文件修改时间从旧到新排列，所以从末尾（最新）往前分配。
    for (header, body) in parts.iter().rev() {
        if remaining == 0 {
            // 预算耗尽：旧文件整体不显示，但保留文件头作占位说明。
            let mut segment = header.clone();
            segment.push_str("<已超出展示行数上限，本文件未显示>\n");
            segments.push(segment);
            // 整个文件被挤出预算同样是「发生了截断」，否则前端会声称「已显示全部」。
            was_truncated = true;
            continue;
        }
        let total = body.split('\n').count();
        let take = total.min(remaining);
        // 复用 tail_lines 取该文件正文尾部，保证行边界与 truncated 判定一致。
        let (tail, cut) = tail_lines(body, take);
        was_truncated |= cut;
        remaining -= take;
        let mut segment = header.clone();
        segment.push_str(&tail);
        segments.push(segment);
    }
    // segments 目前是「最新在前」，还原成旧到新的展示顺序。
    segments.reverse();
    (segments.concat(), was_truncated)
}

/// 两个命令共用的内部实现：line_limit 为 None 时导出全文（仅受字节尾部上限约束），
/// Some(n) 时对全部文件**合计**按行截取尾部 n 行（总量语义，见 tail_parts），用于页面展示。
fn collect_diagnostic_logs(app: &tauri::AppHandle, line_limit: Option<usize>) -> Result<DiagnosticSnapshot, String> {
    log::logger().flush();
    let dir = log_dir(app)?;
    let paths = list_log_paths(&dir)?;
    let mut files = Vec::new();
    let mut parts: Vec<(String, String)> = Vec::new();
    let mut truncated = false;
    for path in select_report_paths(&paths) {
        let metadata = path.metadata().map_err(|error| error.to_string())?;
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let tail = &bytes[bytes.len().saturating_sub(MAX_TAIL_BYTES)..];
        let header = format!("\n===== {name} =====\n");
        let mut body = String::from_utf8_lossy(tail).into_owned();
        // 超长文件只导出尾部，必须显式标注，避免把截断后的内容当成完整日志。
        if bytes.len() > MAX_TAIL_BYTES {
            truncated = true;
            body.insert_str(0, &format!("<文件前部已截断，仅保留最近 {}MB>\n", MAX_TAIL_BYTES / 1_000_000));
        }
        parts.push((header, body));
        files.push(DiagnosticFile {
            name,
            size: metadata.len(),
            modified_at: metadata.modified().ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |duration| duration.as_secs()),
        });
    }
    let content = match line_limit {
        None => parts.iter().map(|(header, body)| format!("{header}{body}")).collect::<String>(),
        Some(lines) => {
            let (limited, was_truncated) = tail_parts(&parts, lines);
            truncated |= was_truncated;
            limited
        }
    };
    Ok(DiagnosticSnapshot {
        files,
        content,
        directory: dir.to_string_lossy().to_string(),
        truncated,
        line_limit,
    })
}

/// 导出/复制用的全文快照（每文件最多保留尾部 2MB 字节）。
#[tauri::command]
pub fn get_diagnostic_logs(app: tauri::AppHandle) -> Result<DiagnosticSnapshot, String> {
    collect_diagnostic_logs(&app, None)
}

/// 页面展示用的尾部快照：Rust 侧把全部文件合计按行截取尾部 lines 行（总量语义），避免前端拉全量再裁剪。
#[tauri::command]
pub fn get_diagnostic_logs_tail(app: tauri::AppHandle, lines: usize) -> Result<DiagnosticSnapshot, String> {
    collect_diagnostic_logs(&app, Some(lines.max(1)))
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
    use super::{create_session_marker, is_diagnostic_file, select_report_paths, tail_lines, tail_parts, write_report, CRASH_FILE, LOGIN_CHECKPOINT_FILE, FOREGROUND_FILE, FOREGROUND_PREVIOUS_FILE};
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
    fn tail_lines_empty_content_is_not_truncated() {
        // 空内容没有可截的东西，不应误报 truncated。
        assert_eq!(tail_lines("", 5), (String::new(), false));
    }

    #[test]
    fn tail_lines_exactly_at_limit_is_not_truncated() {
        // 行数恰好等于上限：内容完整返回，不标截断。
        assert_eq!(tail_lines("a\nb\nc", 3), ("a\nb\nc".to_string(), false));
    }

    #[test]
    fn tail_lines_over_limit_keeps_tail_and_marks_truncated() {
        assert_eq!(tail_lines("a\nb\nc\nd", 2), ("c\nd".to_string(), true));
    }

    #[test]
    fn tail_lines_zero_returns_empty_and_truncated() {
        // lines=0 是调用方的边界错误兜底：返回空且标记截断，让前端能走「显示全部」。
        assert_eq!(tail_lines("a\nb", 0), (String::new(), true));
    }

    #[test]
    fn tail_lines_keeps_multibyte_lines_intact() {
        // 中文多字节字符必须整行保留，不得切出半个字符。
        let content = "错误一\n错误二\n错误三";
        assert_eq!(tail_lines(content, 2), ("错误二\n错误三".to_string(), true));
        assert_eq!(tail_lines(content, 10), (content.to_string(), false));
    }

    #[test]
    fn tail_lines_counts_trailing_empty_line() {
        // 结尾的空行也是一个独立行，截取时同样计入，避免行数统计不一致。
        assert_eq!(tail_lines("a\nb\n", 2), ("b\n".to_string(), true));
        assert_eq!(tail_lines("a\nb\n", 3), ("a\nb\n".to_string(), false));
    }

    #[test]
    fn tail_parts_prefers_newest_files_within_total_budget() {
        // 总量语义：多文件合计不超过 lines；预算优先给较新文件，旧文件保留头并标注未显示。
        let parts = vec![
            ("\n===== old.log =====\n".to_string(), "l1\nl2\nl3".to_string()),
            ("\n===== new.log =====\n".to_string(), "n1\nn2".to_string()),
        ];
        let (content, truncated) = tail_parts(&parts, 3);
        assert!(truncated);
        // 新文件的 2 行全保留，旧文件只剩预算 1 行（尾部）。
        assert!(content.contains("\n===== new.log =====\nn1\nn2"));
        assert!(content.contains("\n===== old.log =====\nl3"));
        assert!(!content.contains("l1"));
        assert!(!content.contains("n0"));
    }

    #[test]
    fn tail_parts_drops_exhausted_old_files_with_marker_header() {
        // 预算耗尽后的旧文件：不显示正文，但保留文件头和「未显示」标注，且不占预算。
        let parts = vec![
            ("\n===== old.log =====\n".to_string(), "l1\nl2\nl3\nl4".to_string()),
            ("\n===== new.log =====\n".to_string(), "n1\nn2".to_string()),
        ];
        let (content, truncated) = tail_parts(&parts, 2);
        assert!(truncated);
        assert!(content.contains("n1\nn2"));
        assert!(content.contains("\n===== old.log =====\n<已超出展示行数上限，本文件未显示>"));
        assert!(!content.contains("l1"));
    }

    #[test]
    fn tail_parts_within_budget_is_not_truncated() {
        // 合计行数不超过上限时不标截断，与前端「N 行结果」文案一致。
        let parts = vec![
            ("\n===== a.log =====\n".to_string(), "a1".to_string()),
            ("\n===== b.log =====\n".to_string(), "b1\nb2".to_string()),
        ];
        let (content, truncated) = tail_parts(&parts, 5);
        assert!(!truncated);
        assert_eq!(content, "\n===== a.log =====\na1\n===== b.log =====\nb1\nb2");
    }

    #[test]
    fn tail_parts_zero_lines_returns_empty_and_truncated() {
        let parts = vec![("\n===== a.log =====\n".to_string(), "a1".to_string())];
        assert_eq!(tail_parts(&parts, 0), (String::new(), true));
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
