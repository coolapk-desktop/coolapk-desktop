import { invoke } from '@tauri-apps/api/core';
import { debug as writeDebug, error as writeError, info as writeInfo, warn as writeWarn } from '@tauri-apps/plugin-log';
import { APP_VERSION } from '../constants/version';
import { installPerformanceDiagnostics } from './performanceDiagnostics';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
let installed = false;
let writing = false;
let verbose = false;
const recentEvents = new Map<string, number>();
const CONSOLE_DEDUPLICATION_MS = 5_000;
const CLICK_DEDUPLICATION_MS = 1_000;
const MAX_RECENT_EVENTS = 500;
const session = Date.now().toString(36);
let sequence = 0;
let currentPage = 'startup';

export function setDiagnosticPage(page: string): void {
  currentPage = /^[a-zA-Z0-9_/:>.-]{1,160}$/.test(page) ? page : 'unnamed';
}

export function diagnosticViewport(): string {
  if (typeof window === 'undefined') return '';
  const viewport = window.visualViewport;
  return `page=${currentPage} viewport=${window.innerWidth}x${window.innerHeight} visible_height=${Math.round(viewport?.height ?? window.innerHeight)} visible_top=${Math.round(viewport?.offsetTop ?? 0)} dpr=${window.devicePixelRatio || 1} online=${navigator.onLine} visibility=${document.visibilityState}`;
}

/** 数值尺寸足以判断裁切；不记录 DOM 文本、图片地址或输入内容。 */
export function logDiagnosticLayout(module: string, element: HTMLElement): void {
  const width = element.clientWidth;
  const overflow = element.scrollWidth > width + 1;
  logDiagnosticLimited(overflow ? 'warn' : 'debug', module, 'layout_measured',
    `width=${width} scroll_width=${element.scrollWidth} height=${element.clientHeight} scroll_height=${element.scrollHeight} overflow_x=${overflow}`,
    2000, `${module}:layout:${width}:${element.scrollWidth}:${overflow}`);
}

function loggingAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
}

export async function setVerboseDiagnosticLogging(enabled: boolean): Promise<void> {
  await invoke('set_diagnostic_verbose', { enabled });
  verbose = enabled;
}

export async function getVerboseDiagnosticLogging(): Promise<boolean> {
  verbose = await invoke<boolean>('get_diagnostic_verbose');
  return verbose;
}

/** Only short, redacted summaries are persisted. Never serialize arbitrary objects. */
export function redactDiagnosticText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
      try {
        const url = new URL(match);
        return `${url.origin}${url.pathname}`;
      } catch {
        return '[url]';
      }
    })
    .replace(/"(?:SESSID|cookie|token|access[_-]?token|password|passwd|device[_-]?id|deviceCode|oaid|ddid|imei|imsi|idfa|client_secret|access_key_secret|security_token|(?:_v2_)?post_token|ck|code)"\s*:\s*"[^"]*"/gi, '"[credential]"')
    .replace(/\b(?:SESSID|cookie|token|access[_-]?token|password|passwd|device[_-]?id|deviceCode|oaid|ddid|imei|imsi|idfa|client_secret|access_key_secret|security_token|(?:_v2_)?post_token|ck|code)\s*[:=]\s*[^\s;,&]+/gi, '[credential]')
    .replace(/\b(?:Authorization\s*:\s*Bearer|Bearer)\s+[^\s]+/gi, '[credential]')
    .replace(/(?:[?&](?:code|ck|token|access_token|device_id|password)=)[^&#\s]+/gi, '[credential]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '[user-dir]')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '[user-dir]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 2000);
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (value instanceof Error) return redactDiagnosticText(`${value.name}: ${value.message}`);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '[object]';
}

function summarizeConsoleArguments(values: unknown[]): string {
  return values
    .map((value) => summarizeDiagnosticError(value))
    .filter((value) => value && value !== 'unknown')
    .join(' | ')
    .slice(0, 800) || 'unknown';
}

function consoleDedupeKey(level: 'warn' | 'error', summary: string): string {
  const stableSummary = summary
    .replace(/\b\d{3,}\b/g, '#')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#');
  return `console:${level}:${stableSummary}`;
}

/** Keep one source frame and a short, redacted message; never serialize rejection objects. */
export function summarizeDiagnosticError(value: unknown): string {
  if (typeof value === 'string') return redactDiagnosticText(value).slice(0, 800);
  if (!(value instanceof Error)) return 'unknown';
  const frame = value.stack?.split('\n').slice(1).find(line => /^\s*at |@(?:https?|tauri):/.test(line))?.trim() || '';
  return redactDiagnosticText(`${value.name}: ${value.message}${frame ? ` frame=${frame}` : ''}`).slice(0, 800);
}

/** 只保留脚本来源与路径，不记录查询凭据、片段或内联脚本内容。 */
function diagnosticScriptUrl(value: string): string {
  if (!value) return 'inline';
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? `${url.origin}${url.pathname}`.slice(0, 240) : url.protocol;
  } catch { return 'unknown'; }
}

/** 不透明的 Script error 无法恢复堆栈，额外保存运行环境与脚本清单供复现排查。 */
export function logWindowErrorDiagnostic(event: ErrorEvent): void {
  const opaque = /^Script error\.?$/i.test(event.message.trim()) && !event.filename && event.error == null;
  logDiagnostic('error', 'window', 'uncaught_exception', `${summarizeDiagnosticError(event.error || event.message)} source=${event.filename ? diagnosticScriptUrl(event.filename) : 'unknown'} line=${event.lineno || 0} column=${event.colno || 0} opaque=${opaque} error_present=${event.error != null} trusted=${event.isTrusted}`);
  logDiagnostic('error', 'window', 'exception_context', `ready_state=${document.readyState} user_agent=${navigator.userAgent} scripts=${document.scripts.length}`);
  // 清单只是排查线索，不能把最后加载的脚本认定为异常来源；逐条写入避免整行截断。
  Array.from(document.scripts).slice(-8).forEach((script, index) => {
    logDiagnostic('error', 'window', 'exception_script', `index=${index} source=${diagnosticScriptUrl(script.src)} type=${script.type || 'classic'} crossorigin=${script.crossOrigin || 'unset'} async=${script.async} defer=${script.defer}`);
  });
}

/** 固定错误类别用于节流键，不把用户 ID、错误正文或凭据放进键。 */
export function classifyDiagnosticRequestError(value: unknown): string {
  const text = summarizeDiagnosticError(value).toLowerCase();
  if (/captcha|验证码|err_request_captcha/.test(text)) return 'captcha';
  if (text.includes('请求验证错误')) return 'request_validation';
  if (/不存在|已被删除|已删除/.test(text)) return 'unavailable_content';
  if (/dns|lookup address|resolve host/.test(text)) return 'dns';
  if (/timeout|timed out|超时/.test(text)) return 'timeout';
  if (/connection closed|connection abort|连接中断|连接关闭/.test(text)) return 'connection_closed';
  if (/429|访问过于频繁|too many/.test(text)) return 'rate_limit';
  if (/未登录|没有登录|401|权限/.test(text)) return 'authentication';
  if (/network|fetch|sending request|网络|连接/.test(text)) return 'network';
  return 'other';
}

export function logDiagnostic(level: LogLevel, module: string, event: string, detail?: unknown): void {
  if (!loggingAvailable() || writing || (level === 'debug' && !verbose)) return;
  const message = `[frontend][${redactDiagnosticText(module)}] ${redactDiagnosticText(event)} time=${new Date().toISOString()} session=${session} seq=${++sequence} ${diagnosticViewport()}${detail === undefined ? '' : ` ${summarize(detail)}`}`;
  writing = true;
  try {
    const send = level === 'error' ? writeError : level === 'warn' ? writeWarn : level === 'debug' ? writeDebug : writeInfo;
    void Promise.resolve(send(message)).catch(() => undefined);
  } catch {
    // 日志插件失败不能影响原操作，也不能递归触发全局错误。
  } finally {
    writing = false;
  }
}

/** Persist repeated events at most once per interval so background retries cannot flood the log. */
export function logDiagnosticLimited(
  level: LogLevel,
  module: string,
  event: string,
  detail?: unknown,
  intervalMs = CONSOLE_DEDUPLICATION_MS,
  dedupeKey = `${module}:${event}:${detail === undefined ? '' : summarize(detail)}`,
): void {
  const now = Date.now();
  if (!loggingAvailable() || (level === 'debug' && !verbose)) return;
  const previous = recentEvents.get(dedupeKey);
  if (previous !== undefined && now - previous < intervalMs) return;
  recentEvents.set(dedupeKey, now);
  if (recentEvents.size > MAX_RECENT_EVENTS) {
    const oldest = recentEvents.keys().next().value;
    if (oldest) recentEvents.delete(oldest);
  }
  logDiagnostic(level, module, event, detail);
}

function installConsoleDiagnosticBridge(): void {
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      try {
        const summary = summarizeConsoleArguments(values);
        logDiagnosticLimited(level, 'console', level, summary, CONSOLE_DEDUPLICATION_MS, consoleDedupeKey(level, summary));
      } catch {
        // Diagnostics must never interfere with the original console call.
      }
      original(...values);
    };
  }
}

function safeElementToken(value: string | null | undefined): string {
  const token = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(token) ? token : '';
}

function describeClickTarget(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  const id = safeElementToken(element.id);
  const action = safeElementToken(element.dataset.diagnosticAction);
  const role = safeElementToken(element.getAttribute('role'));
  const type = element instanceof HTMLInputElement || element instanceof HTMLButtonElement
    ? safeElementToken(element.type)
    : '';
  const classes = Array.from(element.classList)
    .map((name) => safeElementToken(name))
    .filter(Boolean)
    .slice(0, 3)
    .join('.');
  let destination = '';
  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute('href') || '';
    destination = href.startsWith('#') ? 'hash' : href.startsWith('/') ? 'internal' : /^https?:\/\//i.test(href) ? 'external' : 'other';
  }
  return [
    `element=${tag}`,
    action ? `action=${action}` : '',
    id ? `id=${id}` : '',
    classes ? `class=${classes}` : '',
    role ? `role=${role}` : '',
    type ? `type=${type}` : '',
    destination ? `destination=${destination}` : '',
  ].filter(Boolean).join(' ');
}

function installClickDiagnosticBridge(): void {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('button, a, input, select, [role="button"], [data-diagnostic-action]')
      : null;
    if (!target) return;
    const detail = describeClickTarget(target);
    logDiagnosticLimited('info', 'interaction', 'click', detail, CLICK_DEDUPLICATION_MS, `interaction:click:${detail}`);
  }, { capture: true });
}

/** Initialize logging once. Only named events are persisted; console objects may contain private data. */
export function installDiagnosticLogging(): void {
  if (installed || !loggingAvailable()) return;
  installed = true;
  installConsoleDiagnosticBridge();
  installClickDiagnosticBridge();
  logDiagnostic('info', 'app', 'startup', `version=${APP_VERSION}`);
  // 只记录浏览器内核版本和图标显示方式，不采集完整 UA 中的设备型号。
  const webviewVersion = navigator.userAgent.match(/(?:Chrome|Version)\/([\d.]+)/)?.[1] || 'unknown';
  logDiagnostic('info', 'app', 'renderer', `webview_version=${webviewVersion} icons=${document.documentElement.dataset.iconRenderer || 'font'} svg_mask_supported=${typeof CSS !== 'undefined' && (CSS.supports('mask-image', 'url("data:image/svg+xml,<svg/>")') || CSS.supports('-webkit-mask-image', 'url("data:image/svg+xml,<svg/>")'))}`);
  if (/android/i.test(navigator.userAgent)) {
    void invoke('log_android_runtime_info').catch(() => {
      logDiagnostic('warn', 'app', 'android_environment_unavailable');
    });
  }
  installPerformanceDiagnostics((event, detail) => logDiagnostic('info', 'performance', event, detail));
  let viewportTimer: ReturnType<typeof setTimeout> | undefined;
  const logViewport = () => {
    clearTimeout(viewportTimer);
    viewportTimer = setTimeout(() => logDiagnosticLimited('info', 'viewport', 'changed', undefined, 1000, `viewport:${diagnosticViewport()}`), 250);
  };
  window.addEventListener('resize', logViewport);
  window.visualViewport?.addEventListener('resize', logViewport);
  window.addEventListener('orientationchange', logViewport);
  for (const event of ['online', 'offline', 'pageshow', 'pagehide']) {
    window.addEventListener(event, () => logDiagnostic('info', 'app', event));
  }
  document.addEventListener('visibilitychange', () => logDiagnostic('info', 'app', 'visibility_changed'));
  window.addEventListener('error', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !['IMG', 'VIDEO', 'AUDIO', 'SCRIPT', 'LINK'].includes(target.tagName)) return;
    const scriptSource = target instanceof HTMLScriptElement ? diagnosticScriptUrl(target.src) : '';
    logDiagnosticLimited('warn', 'resource', 'load_failed', `element=${target.tagName.toLowerCase()}${scriptSource ? ` source=${scriptSource}` : ''}`, 5000, `resource:${target.tagName}:${scriptSource}`);
  }, true);
}
