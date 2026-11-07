import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import FavoriteExportDialog from '../FavoriteExportDialog.vue';

const apiMocks = vi.hoisted(() => ({
  createExportDirectory: vi.fn(),
  exportJsonFile: vi.fn(),
  openApkDownloadDirectory: vi.fn(),
  getImageDataUrl: vi.fn(),
  saveImageDataUrl: vi.fn(),
  buildFavoriteExport: vi.fn(),
  saveFavoriteExportSnapshot: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    createExportDirectory: apiMocks.createExportDirectory,
    exportJsonFile: apiMocks.exportJsonFile,
    openApkDownloadDirectory: apiMocks.openApkDownloadDirectory,
    getImageDataUrl: apiMocks.getImageDataUrl,
    saveImageDataUrl: apiMocks.saveImageDataUrl,
  },
}));

vi.mock('../../../utils/favoriteExport', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildFavoriteExport: apiMocks.buildFavoriteExport,
  saveFavoriteExportSnapshot: apiMocks.saveFavoriteExportSnapshot,
}));

vi.mock('../../../utils/toast', () => ({ showToast: apiMocks.showToast }));

describe('FavoriteExportDialog', () => {
  it('默认选择 JSON，并只提供所有评论开关', async () => {
    const wrapper = mount(FavoriteExportDialog, {
      props: { isOpen: true },
      global: {
        plugins: [createPinia()],
        stubs: {
          Teleport: true,
        },
      },
    });

    const formatInputs = wrapper.findAll('.format-card input');
    expect((formatInputs[0].element as HTMLInputElement).checked).toBe(true);
    expect((formatInputs[1].element as HTMLInputElement).checked).toBe(false);
    const commentInputs = wrapper.findAll('.comment-option input');
    expect(commentInputs).toHaveLength(1);
    expect((commentInputs[0].element as HTMLInputElement).disabled).toBe(false);
    await commentInputs[0].setValue(true);
    expect((commentInputs[0].element as HTMLInputElement).checked).toBe(true);
  });

  it('收藏单模式支持选择一个或多个收藏单', async () => {
    const wrapper = mount(FavoriteExportDialog, {
      props: {
        isOpen: true,
        mode: 'collections',
        collections: [
          { id: '11', title: '摄影', itemNum: 8 },
          { id: '22', title: '旅行', itemNum: 12 },
        ],
      },
      global: {
        plugins: [createPinia()],
        stubs: { Teleport: true },
      },
    });

    expect(wrapper.text()).toContain('选择收藏单');
    expect(wrapper.text()).toContain('摄影');
    expect(wrapper.text()).toContain('12 条内容');
    const cards = wrapper.findAll('.collection-picker-card');
    await cards[0].find('input').setValue(true);
    await cards[1].find('input').setValue(true);
    expect(wrapper.text()).toContain('已选择 2 个');
    expect(cards.every(card => card.classes().includes('selected'))).toBe(true);
  });

  it('选择 HTML 后可选择高清图片或原图', async () => {
    const wrapper = mount(FavoriteExportDialog, {
      props: { isOpen: true },
      global: {
        plugins: [createPinia()],
        stubs: { Teleport: true },
      },
    });

    await wrapper.findAll('.format-card input')[2].setValue(true);
    const qualityInputs = wrapper.findAll('.image-quality-card input');
    expect(qualityInputs).toHaveLength(2);
    expect((qualityInputs[0].element as HTMLInputElement).checked).toBe(true);
    await qualityInputs[1].setValue(true);
    expect(wrapper.text()).toContain('images/photos');
    expect(wrapper.text()).toContain('images/avatars');
    expect(wrapper.text()).toContain('images/emojis');
  });

  it('支持全选和取消全选所有收藏单', async () => {
    const wrapper = mount(FavoriteExportDialog, {
      props: {
        isOpen: true,
        mode: 'collections',
        collections: [
          { id: '1', title: '收藏单A', itemNum: 5 },
          { id: '2', title: '收藏单B', itemNum: 10 },
        ],
      },
      global: {
        plugins: [createPinia()],
        stubs: { Teleport: true },
      },
    });

    const selectAllBtn = wrapper.find('.export-heading-actions button');
    expect(selectAllBtn.exists()).toBe(true);
    expect(selectAllBtn.text()).toBe('全选');

    await selectAllBtn.trigger('click');
    expect(selectAllBtn.text()).toBe('取消全选');
    expect(wrapper.text()).toContain('已选择 2 个');

    await selectAllBtn.trigger('click');
    expect(selectAllBtn.text()).toBe('全选');
    expect(wrapper.text()).toContain('已选择 0 个');
  });

  it('收藏单多于4个时支持搜索过滤', async () => {
    const wrapper = mount(FavoriteExportDialog, {
      props: {
        isOpen: true,
        mode: 'collections',
        collections: [
          { id: '1', title: '科技数码', itemNum: 1 },
          { id: '2', title: '旅行美景', itemNum: 2 },
          { id: '3', title: '日常吐槽', itemNum: 3 },
          { id: '4', title: '游戏攻略', itemNum: 4 },
          { id: '5', title: '好物推荐', itemNum: 5 },
        ],
      },
      global: {
        plugins: [createPinia()],
        stubs: { Teleport: true },
      },
    });

    const searchInput = wrapper.find('.collection-search-input');
    expect(searchInput.exists()).toBe(true);

    await searchInput.setValue('数码');
    const cards = wrapper.findAll('.collection-picker-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain('科技数码');

    await searchInput.setValue('不存在的内容');
    expect(wrapper.findAll('.collection-picker-card')).toHaveLength(0);
    expect(wrapper.text()).toContain('未找到相关收藏单');
  });

  it('未选择收藏单或格式时导出按钮为禁用状态', async () => {
    const wrapper = mount(FavoriteExportDialog, {
      props: {
        isOpen: true,
        mode: 'collections',
        collections: [{ id: '1', title: '我的收藏', itemNum: 1 }],
      },
      global: {
        plugins: [createPinia()],
        stubs: { Teleport: true },
      },
    });

    const exportBtn = wrapper.findAll('button').find(btn => btn.text().includes('开始导出'));
    expect(exportBtn?.attributes('disabled')).toBeDefined();

    // 选中收藏单
    const cardInput = wrapper.find('.collection-picker-card input');
    await cardInput.setValue(true);

    // 未登录时依然 disabled
    expect(exportBtn?.attributes('disabled')).toBeDefined();
  });

  it('分步视图状态机：支持从配置进入导出中并可取消或查看完成状态', async () => {
    const pinia = createPinia();
    const wrapper = mount(FavoriteExportDialog, {
      props: {
        isOpen: true,
        mode: 'collections',
        collections: [{ id: '1', title: '我的收藏', itemNum: 3 }],
      },
      global: {
        plugins: [pinia],
        stubs: { Teleport: true, Transition: false },
      },
    });

    // 初始状态处于配置视图
    expect(wrapper.find('.dialog-step-config').exists()).toBe(true);
    expect(wrapper.find('.dialog-step-exporting').exists()).toBe(false);
    expect(wrapper.find('.dialog-step-completed').exists()).toBe(false);

    // 模拟登录并选择收藏单
    const { useAuthStore } = await import('../../../stores/auth');
    const authStore = useAuthStore(pinia);
    authStore.isLoggedIn = true;
    authStore.user = { uid: 12345, username: 'tester' } as any;

    const cardInput = wrapper.find('.collection-picker-card input');
    await cardInput.setValue(true);

    const exportBtn = wrapper.findAll('button').find(btn => btn.text().includes('开始导出'));
    expect(exportBtn?.attributes('disabled')).toBeUndefined();
  });

  it('多收藏单导出中途失败：完成页展示已导出部分并提供仅重试剩余项', async () => {
    apiMocks.createExportDirectory.mockResolvedValue('/tmp/export');
    apiMocks.exportJsonFile.mockResolvedValue('/tmp/export/x.json');
    apiMocks.saveFavoriteExportSnapshot.mockResolvedValue(undefined);
    const bundleFor = (source: { id: string; title: string }) => ({
      exportedAt: new Date().toISOString(),
      accountId: '12345',
      source,
      complete: true,
      options: { includeAllComments: false, includeAuthorComments: false, includePinnedComments: false, includeAuthorReplies: false },
      summary: { total: 2, contentComplete: 2, contentFailed: 0, commentFailed: 0 },
      diff: {},
      items: [],
    });
    apiMocks.buildFavoriteExport.mockImplementation(async (_accountId: string, _options: unknown, _onProgress: unknown, source: { id: string; title: string }) => {
      if (source.id === '11') return bundleFor(source);
      throw new Error('网络错误');
    });

    const pinia = createPinia();
    const wrapper = mount(FavoriteExportDialog, {
      props: {
        isOpen: true,
        mode: 'collections',
        collections: [
          { id: '11', title: '摄影', itemNum: 2 },
          { id: '22', title: '旅行', itemNum: 2 },
        ],
      },
      global: { plugins: [pinia], stubs: { Teleport: true, Transition: false } },
    });
    const { useAuthStore } = await import('../../../stores/auth');
    const authStore = useAuthStore(pinia);
    authStore.isLoggedIn = true;
    authStore.user = { uid: 12345, username: 'tester' } as any;

    const cardInputs = wrapper.findAll('.collection-picker-card input');
    await cardInputs[0].setValue(true);
    await cardInputs[1].setValue(true);
    await wrapper.findAll('button').find(btn => btn.text().includes('开始导出'))!.trigger('click');
    await flushPromises();
    await flushPromises();

    // 第 2 个收藏单失败：不回退到配置页，而是进入完成页展示已完成部分。
    expect(wrapper.find('.dialog-step-completed').exists()).toBe(true);
    expect(wrapper.text()).toContain('已导出 1 个收藏单');
    expect(wrapper.text()).toContain('后续导出失败：网络错误');
    const retryBtn = wrapper.findAll('button').find(btn => btn.text().includes('重试失败的 1 个'));
    expect(retryBtn).toBeDefined();

    // 重试只重新导出失败的那个收藏单，成功后显示完整成功文案。
    apiMocks.buildFavoriteExport.mockImplementation(async (_a: unknown, _o: unknown, _p: unknown, source: { id: string; title: string }) => bundleFor(source));
    await retryBtn!.trigger('click');
    await flushPromises();
    await flushPromises();

    const lastCall = apiMocks.buildFavoriteExport.mock.calls.at(-1)!;
    expect((lastCall[3] as { id: string }).id).toBe('22');
    expect(wrapper.text()).toContain('成功备份 1 个收藏单');
    expect(wrapper.text()).not.toContain('后续导出失败');
  });
});
