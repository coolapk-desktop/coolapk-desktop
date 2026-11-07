import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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

// FeedCard 用可寻址的 stub，方便从组件上触发 favorite-changed/deleted 事件。
const FeedCardStub = {
  name: 'FeedCardStub',
  props: ['feed'],
  // 渲染正文，便于断言「留下的是哪一条」。
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

// 构造只有 entityId 的实体包装条目（无 id 字段），这是游标分页用的真实结构。
function entityOnlyItem(n: number) {
  // 实体包装条目同时携带收藏单条目 id（collectionItemId），移除操作走它。
  return { entityId: `e${n}`, collectionItemId: `c${n}`, message: `收藏内容${n}` };
}

describe('FavoritesPage 收藏页翻页与联动一致性', () => {
  let itemRequests: Deferred<any>[];

  beforeEach(() => {
    vi.clearAllMocks();
    itemRequests = [deferred<any>(), deferred<any>(), deferred<any>()];
    mocks.route.path = '/favorites';
    mocks.route.query = { collectionId: 'A', collectionTitle: '收藏单A' };
    mocks.getCollectionList.mockResolvedValue({ data: collections });
    mocks.getCollectionDetail.mockResolvedValue({ data: { id: 'A', title: '收藏单A', item_num: 20 } });
    mocks.getCollectionItemList.mockImplementation((_id: string, page: number) => itemRequests[page - 1]!.promise);
    mocks.removeFavoriteContentIndexEntry.mockResolvedValue(undefined);
    mocks.searchFavoriteContentIndex.mockResolvedValue([]);
  });

  it('一页 20 条只有 entityId 的条目全部保留，不被按 id 去重误删', async () => {
    const wrapper = mountPage();
    await flushPromises();
    itemRequests[0]!.resolve({ data: Array.from({ length: 20 }, (_, i) => entityOnlyItem(i + 1)) });
    await flushPromises();

    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(20);
    wrapper.unmount();
  });

  it('翻页游标取本页原始末条，第二页请求携带上一页 entityId 末条', async () => {
    const wrapper = mountPage();
    await flushPromises();
    itemRequests[0]!.resolve({ data: Array.from({ length: 20 }, (_, i) => entityOnlyItem(i + 1)) });
    await flushPromises();

    // 触底加载第二页。
    await wrapper.trigger('scroll');
    await flushPromises();
    expect(mocks.getCollectionItemList).toHaveBeenCalledTimes(2);
    // firstItem 仍是第 1 页首条，lastItem 是第 1 页原始末条。
    expect(mocks.getCollectionItemList.mock.calls[1]).toEqual(['A', 2, 'e1', 'e20']);

    itemRequests[1]!.resolve({ data: Array.from({ length: 20 }, (_, i) => entityOnlyItem(i + 21)) });
    await flushPromises();
    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(40);
    wrapper.unmount();
  });

  it('取消收藏时按 entityId 命中实体包装条目并同步条目数', async () => {
    const wrapper = mountPage();
    await flushPromises();
    itemRequests[0]!.resolve({ data: [entityOnlyItem(1), entityOnlyItem(2), entityOnlyItem(3)] });
    await flushPromises();
    expect(wrapper.findAll('.stat-value')[0].text()).toBe('20');

    await wrapper.findComponent(FeedCardStub).vm.$emit('favorite-changed', { id: 'e2', favorited: false });
    await flushPromises();

    const remaining = wrapper.findAll('.collection-feed-item');
    expect(remaining).toHaveLength(2);
    expect(remaining.map(n => n.text()).join('|')).not.toContain('收藏内容2');
    // 条目数同步减 1：详情 item_num=20，移除后 19。
    expect(wrapper.findAll('.stat-value')[0].text()).toBe('19');
    expect(mocks.removeFavoriteContentIndexEntry).toHaveBeenCalledWith('10001', 'e2');
    wrapper.unmount();
  });

  it('删除动态时按 entityId 命中实体包装条目并同步条目数', async () => {
    const wrapper = mountPage();
    await flushPromises();
    itemRequests[0]!.resolve({ data: [entityOnlyItem(1), entityOnlyItem(2), entityOnlyItem(3)] });
    await flushPromises();
    expect(wrapper.findAll('.stat-value')[0].text()).toBe('20');

    await wrapper.findComponent(FeedCardStub).vm.$emit('deleted', 'e3');
    await flushPromises();

    const remaining = wrapper.findAll('.collection-feed-item');
    expect(remaining).toHaveLength(2);
    // 删除动态与取消收藏同口径：条目数必须一起减，不能只消失条目。
    expect(wrapper.findAll('.stat-value')[0].text()).toBe('19');
    expect(mocks.removeFavoriteContentIndexEntry).toHaveBeenCalledWith('10001', 'e3');
    wrapper.unmount();
  });

  it('收藏单内搜索命中正文索引时按 entityId 主键匹配实体包装条目', async () => {
    mocks.searchFavoriteContentIndex.mockResolvedValue([{ feedId: 'e2' }]);
    const wrapper = mountPage();
    await flushPromises();
    itemRequests[0]!.resolve({ data: [entityOnlyItem(1), entityOnlyItem(2)] });
    await flushPromises();

    await wrapper.get('.filter-search-input').setValue('独特词');
    // 搜索有 180ms 防抖。
    await new Promise((resolve) => setTimeout(resolve, 260));
    await flushPromises();

    // 关键词不在标题/摘要里，只有正文索引命中才能留下 e2。
    const remaining = wrapper.findAll('.collection-feed-item');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.text()).toContain('收藏内容2');
    wrapper.unmount();
  });

  it('从收藏单移除条目后清理正文索引并同步条目数', async () => {
    mocks.requestConfirmation.mockResolvedValue(true);
    mocks.removeCollectionItem.mockResolvedValue({ code: 200 });
    const wrapper = mountPage();
    await flushPromises();
    itemRequests[0]!.resolve({ data: [entityOnlyItem(1), entityOnlyItem(2)] });
    await flushPromises();

    await wrapper.get('.btn-remove-collection-item').trigger('click');
    await flushPromises();

    // 移除接口走收藏单条目主键 collectionItemId。
    expect(mocks.removeCollectionItem).toHaveBeenCalledWith('c1');
    // 正文索引清理被调用（feed 主键 entityId 优先）。
    expect(mocks.removeFavoriteContentIndexEntry).toHaveBeenCalledWith('10001', 'e1');
    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(1);
    expect(wrapper.findAll('.stat-value')[0].text()).toBe('19');
    wrapper.unmount();
  });

  it('关注操作失败时用 showToast 提示而非原生 alert', async () => {
    mocks.followCollection.mockResolvedValue({ code: 500 });
    const wrapper = mountPage();
    await flushPromises();
    itemRequests[0]!.resolve({ data: [] });
    await flushPromises();

    await wrapper.get('.btn-follow').trigger('click');
    await flushPromises();

    expect(mocks.showToast).toHaveBeenCalledWith('操作失败，请稍后重试', 'error');
    expect(wrapper.emitted()).not.toHaveProperty('alert');
    wrapper.unmount();
  });
});
