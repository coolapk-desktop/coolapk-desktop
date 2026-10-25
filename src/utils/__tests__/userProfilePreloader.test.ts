import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { getUserProfileCached, preloadUserProfile, getCachedUserProfileSync, reactiveUserProfileMap } from '../userProfilePreloader';
import * as diagnostics from '../diagnosticLogger';

describe('userProfilePreloader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('后台自动预加载使用游客用户空间', async () => {
    vi.useFakeTimers();
    const getUserSpace = vi.spyOn(CoolapkTauriAPI, 'getUserSpace');
    const getPublicUserSpace = vi.spyOn(CoolapkTauriAPI, 'getPublicUserSpace').mockResolvedValue({ data: { uid: 'background-user' } });

    preloadUserProfile('background-user');
    await vi.runAllTimersAsync();

    expect(getPublicUserSpace).toHaveBeenCalledWith('background-user');
    expect(getUserSpace).not.toHaveBeenCalled();
  });

  it('悬停即时读取也使用游客用户空间', async () => {
    const getUserSpace = vi.spyOn(CoolapkTauriAPI, 'getUserSpace').mockResolvedValue({ data: { uid: 'enabled-user' } });
    const getPublicUserSpace = vi.spyOn(CoolapkTauriAPI, 'getPublicUserSpace').mockResolvedValue({ data: { uid: 'hover-user' } });

    await getUserProfileCached('hover-user');

    expect(getPublicUserSpace).toHaveBeenCalledWith('hover-user');
    expect(getUserSpace).not.toHaveBeenCalled();
  });

  it('过期后同步读取不保留旧响应式资料，重新访问重新获取', async () => {
    vi.useFakeTimers();
    const request = vi.spyOn(CoolapkTauriAPI, 'getPublicUserSpace').mockResolvedValue({ data: { uid: 'expired-user' } });
    await getUserProfileCached('expired-user');
    expect(getCachedUserProfileSync('expired-user')).toBeTruthy();
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(getCachedUserProfileSync('expired-user')).toBeNull();
    expect(reactiveUserProfileMap['expired-user']).toBeUndefined();
    await getUserProfileCached('expired-user');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('浏览大量不同用户不会无限保留用户空间', async () => {
    vi.spyOn(CoolapkTauriAPI, 'getPublicUserSpace').mockImplementation(async uid => ({ data: { uid } }));
    for (let i = 0; i < 140; i++) await getUserProfileCached(`bounded-${i}`);
    expect(Object.keys(reactiveUserProfileMap).length).toBeLessThanOrEqual(128);
    expect(getCachedUserProfileSync('bounded-0')).toBeNull();
    expect(getCachedUserProfileSync('bounded-139')).toBeTruthy();
  });

  it('失败摘要记录重复次数与队列状态，不记录用户标识和错误凭据', async () => {
    const log = vi.spyOn(diagnostics, 'logDiagnosticLimited');
    vi.spyOn(CoolapkTauriAPI, 'getPublicUserSpace').mockRejectedValue('请求验证错误 token=private-token');
    await getUserProfileCached('private-profile-id');
    await getUserProfileCached('private-profile-id');
    const call = log.mock.calls.at(-1)!;
    expect(call[1]).toBe('user_profile');
    expect(call[2]).toBe('load_failed_summary');
    expect(call[3]).toContain('category=request_validation');
    expect(call[3]).toContain('repeated_failures=1');
    expect(call[3]).toContain('queued=0 active=0');
    expect(call[4]).toBe(60_000);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-profile-id');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-token');
  });
});
