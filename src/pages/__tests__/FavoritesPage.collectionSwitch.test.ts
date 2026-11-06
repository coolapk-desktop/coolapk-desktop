import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({
  // 由 vue-router mock 工厂在模块加载时创建，保证 route.query 是响应式的，能触发页面内 watch。
  route: null as any,
  router: { push: vi.fn(), replace: vi.fn() },
  getCollectionList: vi.fn(),
  getCollectionItemList: vi.fn(),
  getCollectionDetail: vi.fn(),
  showToast: vi.fn(),
  requestConfirmation: vi.fn(),
}));

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  mocks.route = reactive({ path: '/favorites', query: { collectionId: '', collectionTitle: '' } });
  return {
    useRoute: () => mocks.route,
    useRouter: () => mocks.router,
  };
});

vi.mock('../../router', () => ({
  router: mocks.router,
}));

vi.mock('../../utils/toast', () => ({
  showToast: mocks.showToast,
}));

vi.mock('../../utils/confirm', () => ({
  requestConfirmation: mocks.requestConfirmation,
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getCollectionList: mocks.getCollectionList,
    getCollectionItemList: mocks.getCollectionItemList,
    getCollectionDetail: mocks.getCollectionDetail,
  },
}));

import FavoritesPage from '../FavoritesPage.vue';
import { useAuthStore } from '../../stores/auth';

const collections = [
  { id: 'A', title: '收藏单A', itemNum: 1, favNum: 11, followNum: 21 },
  { id: 'B', title: '收藏单B', itemNum: 2, favNum: 12, followNum: 22 },
];

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
        FeedCard: true,
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

describe('FavoritesPage 收藏单快速切换', () => {
  let detailRequests: Map<string, Deferred<any>>;
  let itemRequests: Map<string, Deferred<any>>;

  beforeEach(() => {
    vi.clearAllMocks();
    detailRequests = new Map();
    itemRequests = new Map();
    for (const collection of collections) {
      detailRequests.set(collection.id, deferred<any>());
      itemRequests.set(collection.id, deferred<any>());
    }

    mocks.route.path = '/favorites';
    mocks.route.query = { collectionId: 'A', collectionTitle: '收藏单A' };
    mocks.getCollectionList.mockImplementation(async (_lastItem: string, page: number) => ({ data: page === 1 ? collections : [] }));
    mocks.getCollectionDetail.mockImplementation((id: string) => detailRequests.get(id)!.promise);
    mocks.getCollectionItemList.mockImplementation((id: string) => itemRequests.get(id)!.promise);
  });

  it('切换收藏单后旧收藏单的迟到响应不回填标题、条目数与列表', async () => {
    const wrapper = mountPage();
    await flushPromises();

    // 进入收藏单 A：详情与条目请求均已发出。
    expect(mocks.getCollectionDetail).toHaveBeenCalledWith('A');
    expect(mocks.getCollectionItemList.mock.calls.map(call => call[0])).toEqual(['A']);

    // A 还在加载中立刻切到 B，B 的请求不能被丢弃。
    mocks.route.query = { collectionId: 'B', collectionTitle: '收藏单B' };
    await nextTick();
    expect(mocks.getCollectionDetail).toHaveBeenCalledWith('B');
    expect(mocks.getCollectionItemList.mock.calls.map(call => call[0])).toEqual(['A', 'B']);
    // 切换瞬间不再展示上一个收藏单的内容。
    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(0);

    // A 的迟到响应（详情 + 条目）不能写进 B 的页面。
    detailRequests.get('A')!.resolve({ data: { id: 'A', title: '收藏单A的详情', item_num: 77 } });
    itemRequests.get('A')!.resolve({ data: [{ id: 'a1', entityId: 'a1', message: '来自收藏单A的内容' }] });
    await flushPromises();

    expect(wrapper.get('.hero-title').text()).toBe('收藏单B');
    expect(wrapper.findAll('.stat-value')[0].text()).toBe('2');
    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(0);

    // B 的响应正常回填。
    detailRequests.get('B')!.resolve({ data: { id: 'B', title: '收藏单B的详情', item_num: 5 } });
    itemRequests.get('B')!.resolve({ data: [{ id: 'b1', entityId: 'b1', message: '来自收藏单B的内容' }] });
    await flushPromises();

    expect(wrapper.get('.hero-title').text()).toBe('收藏单B的详情');
    expect(wrapper.findAll('.stat-value')[0].text()).toBe('5');
    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(1);

    wrapper.unmount();
  });

  it('旧收藏单的失败响应不会干扰新收藏单的错误提示', async () => {
    const wrapper = mountPage();
    await flushPromises();

    mocks.route.query = { collectionId: 'B', collectionTitle: '收藏单B' };
    await nextTick();

    detailRequests.get('A')!.reject(new Error('收藏单A详情失败'));
    itemRequests.get('A')!.reject(new Error('收藏单A条目失败'));
    await flushPromises();

    expect(wrapper.text()).not.toContain('收藏单A条目失败');
    expect(wrapper.get('.hero-title').text()).toBe('收藏单B');

    itemRequests.get('B')!.resolve({ data: [] });
    detailRequests.get('B')!.resolve({ data: { id: 'B', title: '收藏单B' } });
    await flushPromises();

    expect(wrapper.text()).not.toContain('收藏单A条目失败');

    wrapper.unmount();
  });
});
