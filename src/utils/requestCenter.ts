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
}

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

export function shouldRetryRequest(error: unknown): boolean {
  const message = getErrorText(error).toLowerCase();
  return /timeout|timed out|aborted|network|fetch|连接|网络|超时|502|503|504|429|temporar|暂时/.test(message);
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
  const retry = policy.retry ?? true;
  const maxAttempts = retry ? Math.max(1, policy.maxAttempts ?? 3) : 1;
  const timeoutMs = policy.timeoutMs ?? 15_000;
  const retryDelayMs = policy.retryDelayMs ?? 350;
  requestState.pending += 1;
  const context = `request_id=${requestId} command=${label} kind=${policy.kind || 'default'}`;
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
        const willRetry = attempt < maxAttempts && shouldRetryRequest(error);
        const stats = failureStats.get(label) || { total: 0, consecutive: 0 };
        stats.total++; stats.consecutive++;
        failureStats.set(label, stats);
        if (failureStats.size > 100) failureStats.delete(failureStats.keys().next().value!);
        const event = willRetry ? 'retry_scheduled' : 'failed';
        const category = classifyDiagnosticRequestError(error);
        logDiagnosticLimited('warn', 'request', event, `${context} attempt=${attempt} ${timing()} timeout_ms=${timeoutMs} retry_delay_ms=${willRetry ? retryDelayMs * attempt : 0} total_failures=${stats.total} failures_since_success=${stats.consecutive} pending=${requestState.pending} category=${category} reason=${summarizeDiagnosticError(error)}`,
          60_000, `request:${event}:${label}:${category}`);
        if (!willRetry) throw error;
        await wait(retryDelayMs * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(getErrorText(lastError));
  } finally {
    requestState.pending = Math.max(0, requestState.pending - 1);
  }
}
