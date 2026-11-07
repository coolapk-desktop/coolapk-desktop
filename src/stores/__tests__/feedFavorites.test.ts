import { describe, it, expect, beforeEach } from 'vitest';
import {
  getFeedFavoriteState,
  setFeedFavoriteState,
  applyFeedFavorites,
  clearFeedFavorites,
  feedFavoriteId,
} from '../feedFavorites';
import { syncFavoriteToFeed } from '../../utils/feedFavorite';

describe('feedFavorites 注册表', () => {
  beforeEach(() => clearFeedFavorites());

  it('跨副本同步：A 副本收藏动作经 syncFavoriteToFeed 广播，B 副本初始化可读到覆盖值', () => {
    // 首页与收藏页各自持有一份内容相同但对象不同的 feed 副本。
    const homeCopy = { id: 42, favnum: 3, userAction: { collect: 0 } };
    const favPageCopy = { id: 42, favnum: 3, userAction: { collect: 0 } };
    syncFavoriteToFeed(homeCopy, { favorited: true, favnum: 4 });
    // B 副本实体字段没变，但注册表覆盖生效。
    expect(getFeedFavoriteState('42')?.favorited).toBe(true);
    expect(getFeedFavoriteState('42')?.favnum).toBe(4);
    expect(favPageCopy.userAction.collect).toBe(0);
    expect(getFeedFavoriteState(favPageCopy.id)?.favorited).toBe(true);
  });

  it('取消收藏回退：favorited=false 写入后注册表读到 false，计数钳 0', () => {
    setFeedFavoriteState('7', { favorited: true, favnum: 1 });
    syncFavoriteToFeed({ id: '7' }, { favorited: false, favnum: 0 });
    expect(getFeedFavoriteState('7')?.favorited).toBe(false);
    expect(getFeedFavoriteState('7')?.favnum).toBe(0);
    // 本地递减到负数也被钳回 0。
    setFeedFavoriteState('7', { favnum: -5 });
    expect(getFeedFavoriteState('7')?.favnum).toBe(0);
  });

  it('apply 只在有值时覆盖：缺省字段不清掉已有状态', () => {
    setFeedFavoriteState('9', { favorited: true, favnum: 8 });
    // 接口偶尔缺 favnum/userAction，不应把已有状态当 0 清掉。
    applyFeedFavorites({ id: '9' });
    expect(getFeedFavoriteState('9')?.favorited).toBe(true);
    expect(getFeedFavoriteState('9')?.favnum).toBe(8);
    applyFeedFavorites([{ id: '9', favnum: 10, userAction: { collect: 0 } }]);
    expect(getFeedFavoriteState('9')?.favnum).toBe(10);
    expect(getFeedFavoriteState('9')?.favorited).toBe(false);
  });

  it('与实体字段的优先级：注册表无覆盖时回落实体，有覆盖时以注册表为准', () => {
    const feed = { id: 'a1', favnum: 2, userAction: { collect: 1 } };
    // 无注册表记录：实体即真源。
    applyFeedFavorites(feed);
    expect(getFeedFavoriteState('a1')?.favorited).toBe(true);
    // 注册表被后续动作覆盖：读取以注册表为准（UI 层负责先查注册表）。
    syncFavoriteToFeed(feed, { favorited: false, favnum: 1 });
    expect(getFeedFavoriteState('a1')?.favorited).toBe(false);
    expect(getFeedFavoriteState('a1')?.favnum).toBe(1);
    expect(feed.userAction.collect).toBe(0); // 实体字段也同步，保持两套一致。
  });

  it('非法输入安全跳过', () => {
    setFeedFavoriteState('', { favorited: true });
    setFeedFavoriteState(undefined, { favorited: true });
    setFeedFavoriteState('x', { favnum: Number.NaN });
    expect(getFeedFavoriteState('x')).toBeUndefined();
    expect(feedFavoriteId(null)).toBe('');
    applyFeedFavorites(null as any);
    applyFeedFavorites([null, {}, { favnum: 1 }]);
    expect(getFeedFavoriteState('')).toBeUndefined();
  });
});
