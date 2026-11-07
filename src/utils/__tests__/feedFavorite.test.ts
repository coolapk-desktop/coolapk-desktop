import { describe, expect, it } from 'vitest';
import { syncFavoriteToFeed } from '../feedFavorite';

describe('收藏态回写实体', () => {
  it('收藏/取消收藏写入 userAction.collect 并同步 favnum', () => {
    const feed: any = { id: '1', favnum: 3, userAction: { like: 1 } };

    syncFavoriteToFeed(feed, { favorited: true, favnum: 4 });
    expect(feed.userAction).toEqual({ like: 1, collect: 1 });
    expect(feed.favnum).toBe(4);

    syncFavoriteToFeed(feed, { favorited: false, favnum: 3 });
    expect(feed.userAction.collect).toBe(0);
    expect(feed.favnum).toBe(3);
  });

  it('实体原本用 favorite 字段表达收藏态时一并同步，不新增多余字段', () => {
    const withFavorite: any = { userAction: { favorite: 1 } };
    syncFavoriteToFeed(withFavorite, { favorited: false });
    expect(withFavorite.userAction).toEqual({ favorite: 0, collect: 0 });

    const plain: any = {};
    syncFavoriteToFeed(plain, { favorited: true });
    expect(plain.userAction).toEqual({ collect: 1 });
    // 未传 favnum 时保留实体原计数。
    expect('favnum' in plain).toBe(false);
  });

  it('计数做下限与非数字保护，空实体安全跳过', () => {
    const feed: any = { favnum: 1 };
    syncFavoriteToFeed(feed, { favorited: true, favnum: -5 });
    expect(feed.favnum).toBe(0);

    syncFavoriteToFeed(feed, { favorited: true, favnum: 'abc' as any });
    expect(feed.favnum).toBe(0);

    expect(() => syncFavoriteToFeed(null, { favorited: true, favnum: 1 })).not.toThrow();
    expect(() => syncFavoriteToFeed(undefined, { favorited: true })).not.toThrow();
    expect(() => syncFavoriteToFeed('feed' as any, { favorited: true })).not.toThrow();
  });

  it('不修改入参以外的字段，也保留原有 userAction 其它键', () => {
    const feed: any = { id: '9', favnum: 2, userAction: { like: 1, follow: 1 } };
    syncFavoriteToFeed(feed, { favorited: true, favnum: 3 });
    expect(feed).toEqual({ id: '9', favnum: 3, userAction: { like: 1, follow: 1, collect: 1 } });
  });
});
