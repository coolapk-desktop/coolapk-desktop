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
  showToast: vi.fn(),
  requestConfirmation: vi.fn(),
  removeFavoriteContentIndexEntry: vi.fn(),
  syncFavoriteContentIndex: vi.fn(async () => null),
  syncFavoriteContentIndexIfNeeded: vi.fn(async () => null),
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
    removeCollectionItem: mocks.removeCollectionItem,
  },
}));

vi.mock('../../utils/favoriteContentIndex', () => ({
  normalizeFavoriteSearchText: (text: string) => text,
  searchFavoriteContentIndex: () => [],
  removeFavoriteContentIndexEntry: mocks.removeFavoriteContentIndexEntry,
  syncFavoriteContentIndex: mocks.syncFavoriteContentIndex,
  syncFavoriteContentIndexIfNeeded: mocks.syncFavoriteContentIndexIfNeeded,
}));

import FavoritesPage from '../FavoritesPage.vue';
import { useAuthStore } from '../../stores/auth';

const collection = { id: 'A', title: '测试收藏单', itemNum: 20, favnum: 11, follownum: 21, uid: '10001' };

function items(ids: string[]) {
  return ids.map(id => ({ id, entityId: id, message: '内容 ' + id, collectionItem: { id: 'ci-' + id } }));
}

const FavoriteExportDialogStub = {
  name: 'FavoriteExportDialog',
  props: ['isOpen', 'mode', 'collections'],
  template: '<div class="export-dialog-stub"></div>',
};

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore(pinia);
  authStore.isLoggedIn = true;
  authStore.user = { uid: '10001', username: '测试用户' } as any;

  const wrapper = mount(FavoritesPage, {
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
        FavoriteExportDialog: FavoriteExportDialogStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

async function openDetail(wrapper: Awaited<ReturnType<typeof mountPage>>, itemIds: string[]) {
  // 必须先就位 mock 响应再切路由，否则 activateCollection 触发的请求会撞上未就绪的 mock。
  mocks.getCollectionDetail.mockResolvedValue({ data: { id: 'A', title: '测试收藏单', uid: '10001', item_num: 20 } });
  mocks.getCollectionItemList.mockResolvedValue({ data: items(itemIds) });
  mocks.route.query = { collectionId: 'A', collectionTitle: '测试收藏单' };
  // 不按固定 tick 次数等待：路由 watch 触发的加载链在慢机器上需要更多次调度，
  // 以「详情列表已渲染出条目」为就绪条件，避免并发跑时偶发取不到元素。
  await vi.waitFor(() => {
    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(itemIds.length);
  }, { timeout: 5000, interval: 20 });
  await flushPromises();
}

describe('FavoritesPage 收藏单详情多选批量移除', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.query = { collectionId: '', collectionTitle: '' };
    mocks.removeFavoriteContentIndexEntry.mockResolvedValue(undefined);
    mocks.getCollectionList.mockResolvedValue({ data: [collection] });
    mocks.getCollectionDetail.mockResolvedValue({ data: { id: 'A', title: '测试收藏单', uid: '10001', item_num: 20 } });
    mocks.removeCollectionItem.mockResolvedValue({ code: 200 });
  });

  it('勾选 2 条移除后：头部条目数 20→18、列表剩 1 条、正文索引清理各调用一次', async () => {
    const wrapper = await mountPage();
    await openDetail(wrapper, ['f1', 'f2', 'f3']);

    expect(wrapper.findAll('.stat-value')[0].text()).toBe('20');
    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(3);

    // 进入多选：3 条时显示「全选 3 条」
    await wrapper.get('.btn-multi-select').trigger('click');
    expect(wrapper.get('.multi-select-toggle-all').text()).toContain('全选 3 条');

    // 点击卡片勾选前 2 条
    const hitboxes = wrapper.findAll('.multi-select-hitbox');
    expect(hitboxes).toHaveLength(3);
    await hitboxes[0].trigger('click');
    await hitboxes[1].trigger('click');

    // 勾选后显示「已选 2 项」
    expect(wrapper.get('.multi-select-selected-count').text()).toBe('已选 2 项');

    await wrapper.get('.btn-batch-remove').trigger('click');
    await flushPromises();

    expect(mocks.removeCollectionItem).toHaveBeenCalledTimes(2);
    expect(mocks.removeCollectionItem).toHaveBeenCalledWith('ci-f1');
    expect(mocks.removeCollectionItem).toHaveBeenCalledWith('ci-f2');
    expect(mocks.removeFavoriteContentIndexEntry).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenCalledWith('已移除 2 条', 'success');

    // 头部条目数从 20 变 18，列表剩 1 条（f3；FeedCard 为 stub，条数用多选入口验证）
    expect(wrapper.findAll('.stat-value')[0].text()).toBe('18');
    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(1);

    // 处理完成自动退出多选
    expect(wrapper.find('.multi-select-hitbox').exists()).toBe(false);
    // 重进多选确认只剩 1 条
    await wrapper.get('.btn-multi-select').trigger('click');
    expect(wrapper.get('.multi-select-toggle-all').text()).toContain('全选 1 条');
    wrapper.unmount();
  });

  it('移除 1 条成功、1 条失败时提示失败并保留失败项的勾选与多选模式', async () => {
    const wrapper = await mountPage();
    await openDetail(wrapper, ['f1', 'f2', 'f3']);

    mocks.removeCollectionItem.mockImplementation(async (itemId: string) => {
      if (itemId === 'ci-f1') return { code: 200 };
      throw new Error('网络失败');
    });

    await wrapper.get('.btn-multi-select').trigger('click');
    const hitboxes = wrapper.findAll('.multi-select-hitbox');
    await hitboxes[0].trigger('click');
    await hitboxes[1].trigger('click');
    await wrapper.get('.btn-batch-remove').trigger('click');
    await flushPromises();

    expect(mocks.showToast).toHaveBeenCalledWith('已移除 1 条，失败 1 条', 'error', 5000, expect.anything());
    // 失败那条（f2）与未选的 f3 仍在列表
    expect(wrapper.findAll('.collection-feed-item')).toHaveLength(2);
    // 失败项保持勾选、多选模式未退出：用户可直接重试，不必重新逐条勾选。
    expect(wrapper.findAll('.multi-select-hitbox')).toHaveLength(2);
    expect(wrapper.get('.multi-select-selected-count').text()).toBe('已选 1 项');
    wrapper.unmount();
  });

  it('部分失败后点击 toast 里的「重试失败项」仅重发失败条目，成功后退出多选', async () => {
    const wrapper = await mountPage();
    await openDetail(wrapper, ['f1', 'f2', 'f3']);

    mocks.removeCollectionItem.mockImplementation(async (itemId: string) => {
      if (itemId === 'ci-f1') return { code: 200 };
      throw new Error('网络失败');
    });
    await wrapper.get('.btn-multi-select').trigger('click');
    const hitboxes = wrapper.findAll('.multi-select-hitbox');
    await hitboxes[0].trigger('click');
    await hitboxes[1].trigger('click');
    await wrapper.get('.btn-batch-remove').trigger('click');
    await flushPromises();

    const failureToast = mocks.showToast.mock.calls.find(([message]) => String(message).includes('失败'));
    expect(failureToast).toBeDefined();
    const actions = failureToast![3] as Array<{ label: string; onClick: () => void }>;
    expect(actions[0].label).toContain('重试失败项');

    // 恢复网络后重试：只有失败的那条被重新提交，成功后自动退出多选。
    mocks.removeCollectionItem.mockResolvedValue({ code: 200 });
    actions[0].onClick();
    await flushPromises();

    expect(mocks.removeCollectionItem).toHaveBeenLastCalledWith('ci-f2');
    expect(mocks.showToast).toHaveBeenCalledWith('已移除 1 条', 'success');
    expect(wrapper.find('.multi-select-hitbox').exists()).toBe(false);
    wrapper.unmount();
  });

  it('全选后按钮变「取消全选」，点击取消全选清空选择；底部「移出收藏单」在 0 项时禁用', async () => {
    const wrapper = await mountPage();
    await openDetail(wrapper, ['f1', 'f2', 'f3']);

    await wrapper.get('.btn-multi-select').trigger('click');
    const toggleAll = wrapper.get('.multi-select-toggle-all');
    await toggleAll.trigger('click');
    expect(toggleAll.text()).toContain('取消全选');
    expect(wrapper.get('.multi-select-selected-count').text()).toBe('已选 3 项');
    await toggleAll.trigger('click');
    expect(toggleAll.text()).toContain('全选 3 条');
    expect(wrapper.get('.multi-select-selected-count').text()).toBe('已选 0 项');
    expect(wrapper.get('.btn-batch-remove').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('点击「取消」退出多选并清空选择；切换收藏单/刷新同样清空多选状态', async () => {
    const wrapper = await mountPage();
    await openDetail(wrapper, ['f1', 'f2', 'f3']);

    // 进入多选并勾选后点「取消」
    await wrapper.get('.btn-multi-select').trigger('click');
    await wrapper.findAll('.multi-select-hitbox')[0].trigger('click');
    expect(wrapper.get('.multi-select-selected-count').text()).toBe('已选 1 项');
    await wrapper.get('.btn-batch-cancel').trigger('click');
    expect(wrapper.find('.multi-select-hitbox').exists()).toBe(false);
    expect(wrapper.find('.collection-multi-select-actionbar').exists()).toBe(false);

    // 再次进入并勾选，然后切换收藏单（B）→ 多选与选择被清空
    await wrapper.get('.btn-multi-select').trigger('click');
    await wrapper.findAll('.multi-select-hitbox')[1].trigger('click');
    mocks.getCollectionItemList.mockResolvedValue({ data: [] });
    mocks.getCollectionDetail.mockResolvedValue({ data: { id: 'B', title: '收藏单B', uid: '10001', item_num: 0 } });
    mocks.route.query = { collectionId: 'B', collectionTitle: '收藏单B' };
    await flushPromises();
    await flushPromises();
    expect(wrapper.find('.multi-select-hitbox').exists()).toBe(false);
    expect(wrapper.find('.collection-multi-select-actionbar').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('FavoritesPage 收藏单详情内导出', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.query = { collectionId: '', collectionTitle: '' };
    mocks.getCollectionList.mockResolvedValue({ data: [collection, { id: 'B', title: '收藏单B', itemNum: 2, uid: '10001' }] });
    mocks.getCollectionDetail.mockResolvedValue({ data: { id: 'A', title: '测试收藏单', uid: '10001', item_num: 20 } });
    mocks.getCollectionItemList.mockResolvedValue({ data: items(['f1']) });
  });

  it('详情内「导出此收藏单」只把当前收藏单传给导出弹窗，且与列表页导出互不污染', async () => {
    const wrapper = await mountPage();

    // 列表页入口（收藏单列表视图）：导出来源为全部收藏单
    await wrapper.get('.favorite-export-trigger').trigger('click');
    await flushPromises();
    let dialog = wrapper.findComponent(FavoriteExportDialogStub);
    expect(dialog.props('collections')).toHaveLength(2);
    await dialog.vm.$emit('close');
    await flushPromises();

    // 进入收藏单 A 详情，详情页入口：只传当前收藏单 A
    await openDetail(wrapper, ['f1']);
    await wrapper.get('.btn-more').trigger('click');
    const menuItems = wrapper.findAll('.dropdown-menu-item');
    const exportItem = menuItems.find(node => node.text().includes('导出此收藏单'));
    expect(exportItem).toBeDefined();
    await exportItem!.trigger('click');
    await flushPromises();
    dialog = wrapper.findComponent(FavoriteExportDialogStub);
    const exported = dialog.props('collections') as any[];
    expect(exported).toHaveLength(1);
    expect(String(exported[0].id)).toBe('A');
    expect(exported[0].title).toBe('测试收藏单');
    expect(exported[0].itemNum).toBe(20);
    wrapper.unmount();
  });
});
