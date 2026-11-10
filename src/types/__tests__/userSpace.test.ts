import { describe, expect, it } from 'vitest';
import {
  asUserSpaceProfile,
  entityKey,
  extractUserSpaceItems,
  isTruthy,
  mergeEntityPageItems,
  normalizeEntityPage,
  relationUserBio,
} from '../userSpace';

describe('user space data normalization', () => {
  it('merges profile userInfo without dropping server home cards', () => {
    const profile = asUserSpaceProfile({
      uid: 123,
      userInfo: { username: '酷友', userAvatar: 'avatar' },
      homeTabCardRows: [{ entityType: 'card', title: '动态' }],
    }, 'fallback');
    expect(profile.uid).toBe(123);
    expect(profile.username).toBe('酷友');
    expect(profile.homeTabCardRows).toHaveLength(1);
  });

  it('unwraps entity groups while preserving unknown entities', () => {
    const rows = extractUserSpaceItems([
      { entityType: 'card', entities: [{ entityType: 'future', title: '新模板' }] },
      { entityType: 'apk', id: 8 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].entityType).toBe('future');
    expect(entityKey(rows[1], 1)).toBe('8');
  });

  it('accepts the API boolean conventions', () => {
    expect(isTruthy(true)).toBe(true);
    expect(isTruthy(1)).toBe(true);
    expect(isTruthy('0')).toBe(false);
  });

  it('normalizes paged server rows and keeps cursor fields', () => {
    const page = normalizeEntityPage({
      data: [{ entities: [{ id: 11, entityType: 'future' }] }],
      firstItem: '11',
      lastItem: '11',
      hasMore: true,
    });
    expect(page.items).toHaveLength(1);
    expect(page.firstItem).toBe('11');
    expect(page.lastItem).toBe('11');
    expect(page.hasMore).toBe(true);
  });

  it('does not show the current account bio on fans without a bio', () => {
    const fan = { uid: '2', bio: '', signature: '', sign: '当前账号简介', userInfo: { uid: '2', bio: '' }, fUserInfo: { uid: '1', bio: '当前账号简介' } };
    expect(relationUserBio(fan, 'fans')).toBe('');
    expect(relationUserBio({ ...fan, userInfo: { uid: '2', bio: '粉丝本人简介' } }, 'fans')).toBe('粉丝本人简介');
    expect(relationUserBio({ bio: '', fUserInfo: { bio: '关注用户简介' } }, 'follow')).toBe('关注用户简介');
  });
});

describe('分页合并', () => {
  const feed = (id: number) => ({ id, entityId: id, entityType: 'feed', uid: 1603081 });
  const page = (items: any[], hasMore = true) => ({ items, page: 2, hasMore, firstItem: '', lastItem: '' });

  it('加载更多时追加新条目', () => {
    const merged = mergeEntityPageItems([feed(1)], page([feed(2), feed(3)]));
    expect(merged.items.map((item: any) => item.id)).toEqual([1, 2, 3]);
    expect(merged.hasMore).toBe(true);
  });

  it('刷新时整页替换并沿用服务端 hasMore', () => {
    const merged = mergeEntityPageItems([feed(1)], page([feed(9)], false), { refresh: true });
    expect(merged.items.map((item: any) => item.id)).toEqual([9]);
    expect(merged.hasMore).toBe(false);
  });

  it('剔除已存在条目', () => {
    const merged = mergeEntityPageItems([feed(1), feed(2)], page([feed(2), feed(3)]));
    expect(merged.items.map((item: any) => item.id)).toEqual([1, 2, 3]);
  });

  it('整页都是重复条目不继续补页', () => {
    const merged = mergeEntityPageItems([feed(1), feed(2)], page([feed(1), feed(2)]));
    expect(merged.items).toHaveLength(2);
    expect(merged.hasMore).toBe(false);
  });
});
