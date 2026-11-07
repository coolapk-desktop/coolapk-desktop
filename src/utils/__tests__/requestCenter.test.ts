import { beforeEach, describe, expect, it, vi } from 'vitest';
const logging = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('../diagnosticLogger', async (original) => ({
  ...await original<typeof import('../diagnosticLogger')>(),
  logDiagnostic: logging.log,
  logDiagnosticLimited: logging.log,
  summarizeDiagnosticError: (error: Error) => error.message,
}));
import { isRateLimitedRequest, requestWithPolicy, shouldRetryRequest } from '../requestCenter';

describe('requestCenter', () => {
  beforeEach(() => logging.log.mockClear());
  it('只对可恢复的网络错误进行重试', () => {
    expect(shouldRetryRequest(new Error('请求超时'))).toBe(true);
    expect(shouldRetryRequest(new Error('HTTP 503'))).toBe(true);
    expect(shouldRetryRequest(new Error('账号权限不足'))).toBe(false);
  });

  it('限流 429 不算普通可重试错误，由独立的退避分支处理', () => {
    expect(shouldRetryRequest(new Error('HTTP 429 Too Many Requests'))).toBe(false);
    expect(isRateLimitedRequest(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isRateLimitedRequest(new Error('请求过于频繁，请稍后再试'))).toBe(true);
    expect(isRateLimitedRequest(new Error('网络连接失败'))).toBe(false);
  });

  it('写操作（mutation）默认不重试，只执行一次', async () => {
    let attempts = 0;
    await expect(requestWithPolicy('reply_feed', async () => {
      attempts += 1;
      throw new Error('请求超时');
    }, { mutation: true, timeoutMs: 100 })).rejects.toThrow('请求超时');
    expect(attempts).toBe(1);
    expect(logging.log.mock.calls.map(entry => entry[2])).toEqual(['started', 'failed']);
    expect(logging.log.mock.calls[0][3]).toContain('mutation=true');
    expect(logging.log.mock.calls[0][3]).toContain('max_attempts=1');
  });

  it('写操作显式 retry: true 时仍可按策略重试', async () => {
    let attempts = 0;
    const result = await requestWithPolicy('update_feed', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('网络连接失败');
      return 'ok';
    }, { mutation: true, retry: true, retryDelayMs: 0, timeoutMs: 100 });
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('读操作不传 retry 时保持默认的 3 次尝试', async () => {
    let attempts = 0;
    await expect(requestWithPolicy('get_feed_detail', async () => {
      attempts += 1;
      throw new Error('网络连接失败');
    }, { retryDelayMs: 0, timeoutMs: 0 })).rejects.toThrow('网络连接失败');
    expect(attempts).toBe(3);
    expect(logging.log.mock.calls[0][3]).toContain('mutation=false');
  });

  it('限流 429 在读操作上最多重试一次，且退避不少于 2s', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const request = requestWithPolicy('get_hot_feeds', async () => {
        attempts += 1;
        throw new Error('HTTP 429 Too Many Requests');
      }, { retry: true, maxAttempts: 3, timeoutMs: 0 });
      const failure = expect(request).rejects.toThrow('429');
      await vi.advanceTimersByTimeAsync(1_999);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await failure;
      expect(attempts).toBe(2);
      const scheduled = logging.log.mock.calls.find(entry => entry[2] === 'retry_scheduled')!;
      expect(scheduled[3]).toContain('retry_delay_ms=2000');
      expect(scheduled[3]).toContain('rate_limited=true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('写操作遇到限流 429 也不重试，避免重复提交', async () => {
    let attempts = 0;
    await expect(requestWithPolicy('create_feed', async () => {
      attempts += 1;
      throw new Error('HTTP 429 Too Many Requests');
    }, { mutation: true, retry: true, timeoutMs: 0 })).rejects.toThrow('429');
    expect(attempts).toBe(1);
  });

  it('请求失败后按策略重试并返回成功结果', async () => {
    let attempts = 0;
    const result = await requestWithPolicy('测试接口', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('网络连接失败');
      return 'ok';
    }, { retry: true, maxAttempts: 2, retryDelayMs: 0, timeoutMs: 100 });
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
    const entries = logging.log.mock.calls;
    expect(entries.map(entry => entry[2])).toEqual(['started', 'retry_scheduled', 'recovered', 'completed']);
    const ids = entries.map(entry => entry[3].match(/request_id=\d+/)?.[0]);
    expect(new Set(ids).size).toBe(1);
    expect(entries[3][3]).toContain('attempt=2');
  });

  it('关闭重试时只执行一次请求', async () => {
    let attempts = 0;
    await expect(requestWithPolicy('测试接口', async () => {
      attempts += 1;
      throw new Error('网络连接失败');
    }, { retry: false, timeoutMs: 100 })).rejects.toThrow('网络连接失败');
    expect(attempts).toBe(1);
    expect(logging.log.mock.calls.map(entry => entry[2])).toEqual(['started', 'failed']);
  });

  it('timeoutMs 为 0 时等待长请求完成而不重试', async () => {
    let attempts = 0;
    const result = await requestWithPolicy('长任务', async () => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return 'completed';
    }, { retry: false, timeoutMs: 0 });

    expect(result).toBe('completed');
    expect(attempts).toBe(1);
  });

  it('后台时间单独计数，UI 超时后的原生完成只记录状态而不记录返回内容', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    let finish!: (value: string) => void;
    try {
      const request = requestWithPolicy('background_timeout_probe', () => new Promise<string>(resolve => { finish = resolve; }), { retry: false, timeoutMs: 20 });
      const failure = expect(request).rejects.toThrow('请求超时');
      await vi.advanceTimersByTimeAsync(5);
      visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
      vi.setSystemTime(Date.now() + 120_000);
      visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(20);
      await failure;
      const failed = logging.log.mock.calls.find(entry => entry[2] === 'failed')!;
      expect(failed[3]).toContain('background_ms=120000');
      expect(failed[3]).toContain('foreground_wall_ms=20');
      expect(failed[3]).toContain('category=timeout');
      finish('private native result');
      await vi.advanceTimersByTimeAsync(0);
      const late = logging.log.mock.calls.find(entry => entry[2] === 'settled_after_timeout')!;
      expect(late[3]).toContain('outcome=resolved');
      expect(JSON.stringify(logging.log.mock.calls)).not.toContain('private native result');
    } finally {
      visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
      spy.mockRestore(); vi.useRealTimers();
    }
  });

  it('连续失败按命令累计，恢复时记录失败次数', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(requestWithPolicy('notification_failure_probe', async () => { throw new Error('DNS lookup address failed'); }, { retry: false })).rejects.toThrow();
    }
    const failed = logging.log.mock.calls.filter(entry => entry[2] === 'failed');
    expect(failed.at(-1)![3]).toContain('total_failures=3 failures_since_success=3');
    expect(failed.at(-1)![3]).toContain('category=dns');
    expect(failed.at(-1)![4]).toBe(60_000);
    await requestWithPolicy('notification_failure_probe', async () => 'ok');
    expect(logging.log.mock.calls.find(entry => entry[2] === 'recovered')![3]).toContain('failures_since_success=3');
  });
});
