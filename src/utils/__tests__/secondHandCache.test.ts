import { beforeEach, describe, expect, it } from 'vitest';
import {
  SECOND_HAND_CACHE_TTL,
  getSecondHandViewerUid,
  isSecondHandPageCacheFresh,
  resetSecondHandPageCache,
  secondHandPageCache,
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
