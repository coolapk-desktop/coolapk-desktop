import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import { CoolapkTauriAPI } from '../../api/coolapk';
import {
  setFeedFavoriteState,
  getFeedFavoriteState,
  feedFavoritesSizeForTests,
} from '../../stores/feedFavorites';
import {
  setGoodsRowState,
  getGoodsRowState,
  goodsRowsSizeForTests,
} from '../../stores/goodsRows';

describe('auth 清理覆盖层注册表（切号/登出防串号）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setActivePinia(createPinia());
    // 每个用例前清一次，避免用例间互相污染。
    setFeedFavoriteState('seed', { favorited: false, favnum: 0 });
    setGoodsRowState('seed', { favnum: 0 });
    useAuthStore();
  });

  function seedOverlays() {
    // 旧账号留下的覆盖层：收藏态/计数与好物行状态。
    setFeedFavoriteState('f1', { favorited: true, favnum: 42 });
    setGoodsRowState('g1', { favnum: 7, favorited: true });
    expect(feedFavoritesSizeForTests()).toBeGreaterThan(0);
    expect(goodsRowsSizeForTests()).toBeGreaterThan(0);
  }

  /** 复刻 FeedCard.resolveInitialFavorited 的读取优先级（不含 cloudFavorite）。 */
  function cardReadsFavorited(feed: { userAction?: { collect?: number } }): boolean {
    const override = getFeedFavoriteState('f1')?.favorited;
    if (override !== undefined) return override;
    return feed.userAction?.collect === 1;
  }

  it('logout 会清空收藏与好物覆盖层注册表', async () => {
    seedOverlays();
    const store = useAuthStore();
    vi.spyOn(CoolapkTauriAPI, 'clearCookie').mockResolvedValue(undefined as any);
    vi.spyOn(CoolapkTauriAPI, 'listAccounts').mockResolvedValue({ code: 200, data: [] } as any);
    await store.logout();
    expect(feedFavoritesSizeForTests()).toBe(0);
    expect(goodsRowsSizeForTests()).toBe(0);
    expect(getFeedFavoriteState('f1')).toBeUndefined();
    expect(getGoodsRowState('g1')).toBeUndefined();
  });

  it('loginAs 切号后注册表归零，FeedCard 回落到实体字段而不是旧覆盖层', async () => {
    seedOverlays();
    const store = useAuthStore();
    // 新账号登录后：旧覆盖层必须清空，让卡片按实体（未收藏、计数 0）渲染。
    vi.spyOn(CoolapkTauriAPI, 'loginAs').mockResolvedValue({
      code: 200,
      data: { uid: 'u2', username: '账号B' },
    } as any);
    vi.spyOn(CoolapkTauriAPI, 'listAccounts').mockResolvedValue({ code: 200, data: [] } as any);
    await store.loginAs('u2');
    expect(feedFavoritesSizeForTests()).toBe(0);
    expect(goodsRowsSizeForTests()).toBe(0);
    // 实体本身是未收藏：切号后卡片必须读到实体态 false，而不是旧账号的 true。
    const entity = { userAction: undefined };
    expect(cardReadsFavorited(entity)).toBe(false);
    // 计数同理：无覆盖层时回落到实体 favnum（缺省为 0）。
    expect(getFeedFavoriteState('f1')?.favnum).toBeUndefined();
  });

  it('loginAs 失败（凭据无效）时不误清前端状态', async () => {
    seedOverlays();
    const store = useAuthStore();
    vi.spyOn(CoolapkTauriAPI, 'loginAs').mockResolvedValue({ code: 200, data: {} } as any);
    await expect(store.loginAs('u2')).rejects.toThrow('切换账户失败');
    // 失败路径未动底层凭据，覆盖层与登录态保持原样。
    expect(feedFavoritesSizeForTests()).toBeGreaterThan(0);
    expect(goodsRowsSizeForTests()).toBeGreaterThan(0);
    expect(store.isLoggedIn).toBe(false);
  });
});
