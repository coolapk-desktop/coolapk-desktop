import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  /** 前 N 次读盘强制失败，用于复现「瞬时读失败」场景。 */
  failReads: 0,
  getCollectionList: vi.fn(),
  getCollectionItemList: vi.fn(),
  getPublicFeedDetail: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getCollectionList: mocks.getCollectionList,
    getCollectionItemList: mocks.getCollectionItemList,
    getPublicFeedDetail: mocks.getPublicFeedDetail,
  },
}));

vi.mock('../tauriStore', () => ({
  readTauriStoreValue: vi.fn(async (_fileName: string, key: string) => {
    if (mocks.failReads > 0) {
      mocks.failReads -= 1;
      throw new Error('store 读取失败');
    }
    return mocks.values.get(key);
  }),
  writeTauriStoreValue: vi.fn(async (_fileName: string, key: string, value: unknown) => { mocks.values.set(key, value); }),
}));

import {
  clearFavoriteContentIndexMemoryCache,
  removeFavoriteContentIndexEntry,
  searchFavoriteContentIndex,
  syncFavoriteContentIndex,
} from '../favoriteContentIndex';

describe('favorite content index', () => {
  beforeEach(() => {
    mocks.values.clear();
    mocks.failReads = 0;
    mocks.getCollectionList.mockReset();
    mocks.getCollectionItemList.mockReset();
    mocks.getPublicFeedDetail.mockReset();
    mocks.getCollectionList.mockImplementation(async (_uid: string, page: number) => ({
      data: page === 1 ? [{ id: 'default', entityId: 'collection-default' }] : [],
    }));
    mocks.getCollectionItemList.mockResolvedValue({ data: [] });
    clearFavoriteContentIndexMemoryCache();
  });

  it('在更新标记变化时重新抓取旧收藏的完整正文', async () => {
    let version = 1;
    mocks.getCollectionItemList.mockImplementation(async (_collectionId: string, page: number) => {
      if (page !== 1) return { data: [] };
      return { data: [{ id: '100', entityId: '100', message: '摘要…查看更多', lastupdate: String(version) }] };
    });
    mocks.getPublicFeedDetail.mockImplementation(async () => ({
      data: { id: '100', title: '旧收藏', message: version === 1 ? '初版正文' : '编辑后的正文', lastupdate: String(version) },
    }));

    await syncFavoriteContentIndex('42');
    expect(await searchFavoriteContentIndex('42', '初版正文')).toHaveLength(1);

    version = 2;
    const result = await syncFavoriteContentIndex('42');
    expect(result.updated).toBe(1);
    expect(await searchFavoriteContentIndex('42', '编辑后的正文')).toHaveLength(1);
    expect(await searchFavoriteContentIndex('42', '初版正文')).toHaveLength(0);
    expect(mocks.getPublicFeedDetail).toHaveBeenCalledTimes(2);
  });

  function seedIndexWithDiskEntry() {
    mocks.values.set('account:42', {
      version: 1,
      lastSyncAt: 1,
      entries: {
        '100': {
          feedId: '100',
          title: '旧收藏',
          message: '磁盘上的正文',
          searchText: '磁盘上的正文',
          contentHash: 'hash',
          updatedMarker: '',
          indexedAt: 1,
          checkedAt: 1,
          contentComplete: true,
          feed: { id: '100', message: '磁盘上的正文' },
        },
      },
    });
  }

  it('读盘失败时不得用空索引覆盖磁盘上已有的正文索引', async () => {
    seedIndexWithDiskEntry();
    mocks.failReads = 1;

    await removeFavoriteContentIndexEntry('42', '999');

    const onDisk = mocks.values.get('account:42') as any;
    expect(Object.keys(onDisk.entries)).toEqual(['100']);
    expect(onDisk.entries['100'].message).toBe('磁盘上的正文');
  });

  it('读盘恢复后写入路径继续生效，且仍以磁盘数据为基准', async () => {
    seedIndexWithDiskEntry();
    mocks.failReads = 1;
    await removeFavoriteContentIndexEntry('42', '999');
    expect(Object.keys((mocks.values.get('account:42') as any).entries)).toEqual(['100']);

    await removeFavoriteContentIndexEntry('42', '100');
    expect(Object.keys((mocks.values.get('account:42') as any).entries)).toEqual([]);
  });

  it('多页同步时收藏单分页始终使用第一页首项作为 firstItem', async () => {
    mocks.getCollectionItemList.mockImplementation(async (_collectionId: string, page: number) => {
      if (page === 1) return { data: [{ id: '300', entityId: '300', message: '摘要' }, { id: '290', entityId: '290', message: '摘要' }] };
      if (page === 2) return { data: [{ id: '280', entityId: '280', message: '摘要' }] };
      return { data: [] };
    });
    mocks.getPublicFeedDetail.mockImplementation(async (id: string) => ({ data: { id, message: `完整正文 ${id}` } }));

    const result = await syncFavoriteContentIndex('42');

    expect(result.total).toBe(3);
    expect(result.complete).toBe(true);
    expect(mocks.getCollectionItemList.mock.calls).toEqual([
      ['default', 1, '', ''],
      ['default', 2, '300', '290'],
      ['default', 3, '300', '280'],
    ]);
  });
});
