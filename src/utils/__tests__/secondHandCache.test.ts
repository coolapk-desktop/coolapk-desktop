import { beforeEach, describe, expect, it } from 'vitest';
import {
  SECOND_HAND_CACHE_TTL,
  getSecondHandViewerUid,
  isSecondHandCursorInvalidError,
  isSecondHandListCacheFresh,
  isSecondHandPageCacheFresh,
  resetSecondHandListCache,
  resetSecondHandPageCache,
  secondHandListCache,
  secondHandPageCache,
  type SecondHandListCache,
} from '../secondHandCache';

function seedCache(overrides: Partial<typeof secondHandPageCache> = {}) {
  secondHandPageCache.initialized = true;
  secondHandPageCache.items = [{ id: '1', title: '闲置' } as any];
  secondHandPageCache.page = 2;
  secondHandPageCache.firstItem = 'first';
  secondHandPageCache.lastItem = 'last';
  secondHandPageCache.pageContext = 'ctx';
  secondHandPageCache.noMore = false;
  secondHandPageCache.updatedAt = Date.now();
  secondHandPageCache.viewerUid = getSecondHandViewerUid();
  Object.assign(secondHandPageCache, overrides);
}

describe('secondHandCache', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecondHandPageCache();
  });

  it('未初始化的缓存不可复用', () => {
    expect(isSecondHandPageCacheFresh(secondHandPageCache, Date.now(), 'guest')).toBe(false);
  });

  it('5 分钟内同账号的缓存视为新鲜', () => {
    seedCache();
    expect(isSecondHandPageCacheFresh(secondHandPageCache, Date.now() + SECOND_HAND_CACHE_TTL - 1000, 'guest')).toBe(true);
  });

  it('超过 5 分钟必须后台刷新', () => {
    seedCache();
    expect(isSecondHandPageCacheFresh(secondHandPageCache, Date.now() + SECOND_HAND_CACHE_TTL + 1, 'guest')).toBe(false);
  });

  it('账号变化后缓存不再可信', () => {
    seedCache();
    expect(isSecondHandPageCacheFresh(secondHandPageCache, Date.now(), 'other-uid')).toBe(false);
  });

  it('从 localStorage 的登录快照读取账号维度，未登录为 guest', () => {
    expect(getSecondHandViewerUid()).toBe('guest');
    localStorage.setItem('coolapk_user', JSON.stringify({ uid: '12345' }));
    expect(getSecondHandViewerUid()).toBe('12345');
    localStorage.setItem('coolapk_user', '{损坏的 JSON');
    expect(getSecondHandViewerUid()).toBe('guest');
  });

  it('型号列表缓存按 5 分钟 + 账号维度判定新鲜度', () => {
    const key = '/feed/ershouList?productId=123&dataListType=staggered';
    const build = (overrides: Partial<SecondHandListCache> = {}): SecondHandListCache => ({
      initialized: true,
      items: [{ id: '1', title: '闲置' } as any],
      page: 2,
      firstItem: 'first',
      lastItem: 'last',
      pageContext: 'ctx',
      noMore: false,
      scrollTop: 120,
      updatedAt: Date.now(),
      viewerUid: 'guest',
      ...overrides,
    });

    expect(isSecondHandListCacheFresh(build(), Date.now() + 1000, 'guest')).toBe(true);
    expect(isSecondHandListCacheFresh(build(), Date.now() + SECOND_HAND_CACHE_TTL + 1, 'guest')).toBe(false);
    expect(isSecondHandListCacheFresh(build(), Date.now(), 'other-uid')).toBe(false);
    // 旧调用方只写游标不写时间戳/账号时视为不新鲜，需要后台刷新。
    expect(isSecondHandListCacheFresh(build({ updatedAt: 0 }), Date.now(), 'guest')).toBe(false);
    expect(isSecondHandListCacheFresh(build({ viewerUid: undefined }), Date.now(), 'guest')).toBe(false);
    expect(isSecondHandListCacheFresh(build({ initialized: false }), Date.now(), 'guest')).toBe(false);
    expect(isSecondHandListCacheFresh(undefined, Date.now(), 'guest')).toBe(false);

    secondHandListCache.set(key, build());
    secondHandListCache.set('/feed/ershouList?productId=456&dataListType=staggered', build());
    resetSecondHandListCache(key);
    expect(secondHandListCache.has(key)).toBe(false);
    expect(secondHandListCache.size).toBe(1);
    resetSecondHandListCache();
    expect(secondHandListCache.size).toBe(0);
  });

  it('只有分页游标相关错误才触发回第一页重拉', () => {
    expect(isSecondHandCursorInvalidError(new Error('pageContext 失效'))).toBe(true);
    expect(isSecondHandCursorInvalidError(new Error('lastItem 参数错误'))).toBe(true);
    expect(isSecondHandCursorInvalidError('分页失败')).toBe(true);
    expect(isSecondHandCursorInvalidError(new Error('network timeout'))).toBe(false);
    expect(isSecondHandCursorInvalidError(undefined)).toBe(false);
  });

  it('重置缓存回到第一页并清空游标', () => {
    seedCache();
    resetSecondHandPageCache();
    expect(secondHandPageCache).toMatchObject({
      initialized: false,
      items: [],
      page: 1,
      firstItem: '',
      lastItem: '',
      pageContext: '',
      noMore: false,
      updatedAt: 0,
      viewerUid: '',
    });
  });
});
