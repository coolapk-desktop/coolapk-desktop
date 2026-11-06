import { reactive, readonly } from 'vue';
import { logDiagnostic, logDiagnosticLimited, classifyDiagnosticRequestError, summarizeDiagnosticError } from './diagnosticLogger';
let diagnosticRequestId = 0;
const failureStats = new Map<string, { total: number; consecutive: number }>();
let hiddenSince = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? Date.now() : undefined;
let hiddenMs = 0;
let lastResumeAt: number | undefined;
const totalHiddenMs = () => hiddenMs + (hiddenSince === undefined ? 0 : Math.max(0, Date.now() - hiddenSince));

export type RequestKind = 'feed' | 'comment' | 'default';

export interface RequestPolicy {
  retry?: boolean;
  maxAttempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  kind?: RequestKind;
  /**
   * 标记该请求是「写操作」（发动态、发评论、点赞、上传、改资料、登录等）。
   * 写操作默认不重试（retry 默认 false、maxAttempts 默认 1）：外层超时并不会取消原生任务，
   * 重试只会在原生任务仍然成功时重复提交评论/动态，或重复上传留下孤儿文件。
   * 仍然可以通过显式 retry: true 覆盖（主要用于幂等的写入补偿）。
   */
  mutation?: boolean;
}

/** 限流退避：服务端限流窗口通常是秒级，密集合计重试只会加重限流。 */
const RATE_LIMIT_BASE_DELAY_MS = 2_000;
/** 限流最多 2 次尝试（首次 + 1 次退避重试）。 */
const RATE_LIMIT_MAX_ATTEMPTS = 2;

const requestState = reactive({
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  lastError: '',
  lastErrorAt: 0,
  lastSuccessAt: 0,
});

export const requestCenterState = readonly(requestState);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { requestState.isOnline = true; });
  window.addEventListener('offline', () => { requestState.isOnline = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenSince ??= Date.now();
    else if (hiddenSince !== undefined) {
      hiddenMs += Math.max(0, Date.now() - hiddenSince);
      hiddenSince = undefined;
      lastResumeAt = Date.now();
    }
  });
}

function getErrorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message || '');
  return String(error || '请求失败');
}

/**
 * 判断错误是否属于「可安全重试」的瞬时故障。
 * 注意：429（限流）不在这里——限流需要更长的退避，由 isRateLimitedRequest 单独处理，
 * 避免被 350ms 起步的默认退避打成更严重的限流。
 */
export function shouldRetryRequest(error: unknown): boolean {
  const message = getErrorText(error).toLowerCase();
  return /timeout|timed out|aborted|network|fetch|连接|网络|超时|502|503|504|temporar|暂时/.test(message);
}

/** 判断错误是否为服务端限流（429 / too many requests / 请求过于频繁）。 */
export function isRateLimitedRequest(error: unknown): boolean {
  const message = getErrorText(error).toLowerCase();
  return /\b429\b|too many requests|rate[\s_-]?limit|请求过于频繁|限流|访问频繁/.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string, lateSettlement: (outcome: string) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; reject(new Error(`${label}请求超时`)); }, timeoutMs);
    task.then((value) => {
      window.clearTimeout(timer);
      if (timedOut) lateSettlement('resolved');
      resolve(value);
    }, (error) => {
      window.clearTimeout(timer);
      if (timedOut) lateSettlement('rejected');
      reject(error);
    });
  });
}

export async function requestWithPolicy<T>(label: string, task: () => Promise<T>, policy: RequestPolicy = {}): Promise<T> {
  const requestId = ++diagnosticRequestId;
  const started = Date.now();
  const hiddenAtStart = totalHiddenMs();
  const timing = () => {
    const elapsed = Math.max(0, Date.now() - started);
    const background = Math.min(elapsed, Math.max(0, totalHiddenMs() - hiddenAtStart));
    return `elapsed_ms=${elapsed} background_ms=${background} foreground_wall_ms=${elapsed - background} since_resume_ms=${lastResumeAt === undefined ? 'unavailable' : Math.max(0, Date.now() - lastResumeAt)}`;
  };
  const mutation = policy.mutation === true;
  // 写操作默认不重试；读操作保持原来的「默认重试」行为，避免读接口变脆。
  const retry = policy.retry ?? !mutation;
  const maxAttempts = retry ? Math.max(1, policy.maxAttempts ?? (mutation ? RATE_LIMIT_MAX_ATTEMPTS : 3)) : 1;
  // timeoutMs 为 0 表示不设 UI 超时（长任务上传）。它只解除外层超时，不会取消原生任务本身。
  const timeoutMs = policy.timeoutMs ?? 15_000;
  const retryDelayMs = policy.retryDelayMs ?? 350;
  requestState.pending += 1;
  const context = `request_id=${requestId} command=${label} kind=${policy.kind || 'default'} mutation=${mutation}`;
  logDiagnostic('debug', 'request', 'started', `${context} max_attempts=${maxAttempts} timeout_ms=${timeoutMs} pending=${requestState.pending}`);
  try {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const request = Promise.resolve().then(task);
        // A long-running native command (for example a file upload) can opt out of
        // the UI timeout. Timing out this wrapper does not cancel the native future.
        const result = timeoutMs === 0 ? await request : await withTimeout(request, timeoutMs, label, outcome => {
          logDiagnosticLimited('info', 'request', 'settled_after_timeout', `${context} attempt=${attempt} outcome=${outcome} ${timing()}`,
            60_000, `request:late:${label}`);
        });
        requestState.lastError = '';
        requestState.lastSuccessAt = Date.now();
        const stats = failureStats.get(label);
        if (stats?.consecutive) {
          logDiagnosticLimited('info', 'request', 'recovered', `${context} failures_since_success=${stats.consecutive} total_failures=${stats.total} ${timing()}`,
            60_000, `request:recovered:${label}`);
          stats.consecutive = 0;
        }
        logDiagnostic('debug', 'request', 'completed', `${context} attempt=${attempt} elapsed_ms=${Date.now() - started}`);
        return result;
      } catch (error) {
        lastError = error;
        requestState.lastError = getErrorText(error);
        requestState.lastErrorAt = Date.now();
        // 限流（429）单独处理：读操作最多再退避重试一次（2s 起步的指数退避），
        // 写操作一律不重试，避免被限流时重复提交。
        const rateLimited = isRateLimitedRequest(error);
        const willRetry = attempt < maxAttempts && (rateLimited
          ? !mutation && attempt < RATE_LIMIT_MAX_ATTEMPTS
          : shouldRetryRequest(error));
        const delayMs = rateLimited ? RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1) : retryDelayMs * attempt;
        const stats = failureStats.get(label) || { total: 0, consecutive: 0 };
        stats.total++; stats.consecutive++;
        failureStats.set(label, stats);
        if (failureStats.size > 100) failureStats.delete(failureStats.keys().next().value!);
        const event = willRetry ? 'retry_scheduled' : 'failed';
        const category = classifyDiagnosticRequestError(error);
        logDiagnosticLimited('warn', 'request', event, `${context} attempt=${attempt} ${timing()} timeout_ms=${timeoutMs} retry_delay_ms=${willRetry ? delayMs : 0} rate_limited=${rateLimited} total_failures=${stats.total} failures_since_success=${stats.consecutive} pending=${requestState.pending} category=${category} reason=${summarizeDiagnosticError(error)}`,
          60_000, `request:${event}:${label}:${category}`);
        if (!willRetry) throw error;
        await wait(delayMs);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(getErrorText(lastError));
  } finally {
    requestState.pending = Math.max(0, requestState.pending - 1);
  }
}
