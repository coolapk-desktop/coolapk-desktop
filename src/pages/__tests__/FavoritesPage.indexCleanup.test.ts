import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  route: null as any,
  router: { push: vi.fn(), replace: vi.fn() },
  getCollectionList: vi.fn(),
  getCollectionItemList: vi.fn(),
  getCollectionDetail: vi.fn(),
  removeCollectionItem: vi.fn(),
  followCollection: vi.fn(),
  showToast: vi.fn(),
  requestConfirmation: vi.fn(),
  removeFavoriteContentIndexEntry: vi.fn(),
  searchFavoriteContentIndex: vi.fn(),
}));

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  mocks.route = reactive({ path: '/favorites', query: { collectionId: '', collectionTitle: '' } });
  return { useRoute: () => mocks.route, useRouter: () => mocks.router };
});

vi.mock('../../router', () => ({ router: mocks.router }));
vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../../utils/confirm', () => ({ requestConfirmation: mocks.requestConfirmation }));

vi.mock('../../utils/favoriteContentIndex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/favoriteContentIndex')>();
  return {
    ...actual,
    removeFavoriteContentIndexEntry: mocks.removeFavoriteContentIndexEntry,
    searchFavoriteContentIndex: mocks.searchFavoriteContentIndex,
  };
});

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getCollectionList: mocks.getCollectionList,
    getCollectionItemList: mocks.getCollectionItemList,
    getCollectionDetail: mocks.getCollectionDetail,
    removeCollectionItem: mocks.removeCollectionItem,
    followCollection: mocks.followCollection,
  },
}));

const FeedCardStub = {
  name: 'FeedCardStub',
  props: ['feed'],
  template: '<div class="feed-card-stub">{{ feed && feed.message }}</div>',
};

import FavoritesPage from '../FavoritesPage.vue';
import { useAuthStore } from '../../stores/auth';

const collections = [{ id: 'A', title: '收藏单A', itemNum: 20, favNum: 11, followNum: 21 }];

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore(pinia);
  authStore.isLoggedIn = true;
  authStore.user = { uid: '10001', username: '测试用户' } as any;

  return mount(FavoritesPage, {
    global: {
      plugins: [pinia],
      stubs: {
        FeedCard: FeedCardStub,
        RatingCard: true,
        AppButton: true,
        AppDialog: true,
        AppImage: true,
        LoadingState: true,
        EmptyState: true,
        ErrorState: true,
        FavoriteExportDialog: true,
      },
    },
  });
}

function entityOnlyItem(n: number) {
  return { entityId: `e${n}`, collectionItemId: `c${n}`, message: `收藏内容${n}` };
}

async function mountWithItems(count: number) {
  mocks.getCollectionList.mockResolvedValue({ data: collections });
  mocks.getCollectionDetail.mockResolvedValue({ data: { id: 'A', title: '收藏单A', item_num: 20 } });
  mocks.getCollectionItemList.mockResolvedValue({ data: Array.from({ length: count }, (_, i) => entityOnlyItem(i + 1)) });
  const wrapper = mountPage();
  await flushPromises();
  return wrapper;
}

describe('FavoritesPage 正文索引清理失败可见性', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.path = '/favorites';
    mocks.route.query = { collectionId: 'A', collectionTitle: '收藏单A' };
    mocks.removeFavoriteContentIndexEntry.mockResolvedValue(undefined);
    mocks.searchFavoriteContentIndex.mockResolvedValue([]);
  });

  it('清理成功时只调用一次且不弹任何提示', async () => {
    const wrapper = await mountWithItems(1);
    await wrapper.findComponent(FeedCardStub).vm.$emit('favorite-changed', { id: 'e1', favorited: false });
    await flushPromises();

    expect(mocks.removeFavoriteContentIndexEntry).toHaveBeenCalledTimes(1);
    expect(mocks.removeFavoriteContentIndexEntry).toHaveBeenCalledWith('10001', 'e1');
    expect(mocks.showToast).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('清理失败时自动重试一次，重试成功则用户无感知', async () => {
    mocks.removeFavoriteContentIndexEntry.mockRejectedValueOnce(new Error('offline'));
    const wrapper = await mountWithItems(1);
    await wrapper.findComponent(FeedCardStub).vm.$emit('favorite-changed', { id: 'e1', favorited: false });
    await flushPromises();

    // 一次失败触发重试，共两次调用；重试成功，不给用户弹窗。
    expect(mocks.removeFavoriteContentIndexEntry).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('连续 3 条清理都失败时只聚合弹一次提示，批量删除不逐条刷屏', async () => {
    mocks.removeFavoriteContentIndexEntry.mockRejectedValue(new Error('offline'));
    const wrapper = await mountWithItems(4);
    for (const n of [1, 2, 3, 4]) {
      await wrapper.findComponent(FeedCardStub).vm.$emit('favorite-changed', { id: `e${n}`, favorited: false });
      await flushPromises();
    }

    // 每条都试了 2 次（失败重试 1 次）。
    expect(mocks.removeFavoriteContentIndexEntry).toHaveBeenCalledTimes(8);
    const cleanupToasts = mocks.showToast.mock.calls.filter(([msg]) => String(msg).includes('正文索引'));
    expect(cleanupToasts).toHaveLength(1);
    expect(cleanupToasts[0]![1]).toBe('warning');
    wrapper.unmount();
  });

  it('一次成功会复位计数，之后需要再次连续失败才会再次提示', async () => {
    // e1/e3/e4/e5 每次尝试都失败；e2 只在第二次尝试（重试）成功。
    const attempts = new Map<string, number>();
    mocks.removeFavoriteContentIndexEntry.mockImplementation(async (_acc: unknown, id: unknown) => {
      const key = String(id);
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (key === 'e2' && n >= 2) return;
      throw new Error('offline');
    });
    const wrapper = await mountWithItems(5);
    // 第 1 条：两次都失败（连续失败条目数 1，不弹）。
    await wrapper.findComponent(FeedCardStub).vm.$emit('favorite-changed', { id: 'e1', favorited: false });
    await flushPromises();
    // 第 2 条：先失败后成功 → 计数复位。
    await wrapper.findComponent(FeedCardStub).vm.$emit('favorite-changed', { id: 'e2', favorited: false });
    await flushPromises();
    // 第 3、4 条：连续失败条目数 1、2，未到阈值不弹。
    await wrapper.findComponent(FeedCardStub).vm.$emit('favorite-changed', { id: 'e3', favorited: false });
    await flushPromises();
    await wrapper.findComponent(FeedCardStub).vm.$emit('favorite-changed', { id: 'e4', favorited: false });
    await flushPromises();
    expect(mocks.showToast).not.toHaveBeenCalled();
    // 第 5 条：连续失败条目数到 3 → 弹一次。
    await wrapper.findComponent(FeedCardStub).vm.$emit('favorite-changed', { id: 'e5', favorited: false });
    await flushPromises();

    const cleanupToasts = mocks.showToast.mock.calls.filter(([msg]) => String(msg).includes('正文索引'));
    expect(cleanupToasts).toHaveLength(1);
    wrapper.unmount();
  });
});
