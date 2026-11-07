import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  getProductDetail: vi.fn(),
  getProductConfig: vi.fn(),
  getProductFeeds: vi.fn(),
  push: vi.fn(),
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  const { reactive } = await import('vue');
  mocks.query = reactive({});
  return {
    ...actual,
    useRoute: () => ({ params: { productId: '123' }, get query() { return mocks.query; } }),
    useRouter: () => ({ push: mocks.push }),
  };
});

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getProductDetail: mocks.getProductDetail,
    getProductConfig: mocks.getProductConfig,
    getProductFeeds: mocks.getProductFeeds,
  },
}));

vi.mock('../../stores/app', () => ({ useAppStore: () => ({ openImageViewer: vi.fn() }) }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ isLoggedIn: false, openLoginModal: vi.fn() }) }));
vi.mock('../../stores/pageTabs', () => ({ usePageTabsStore: () => ({ updateTitle: vi.fn() }) }));
vi.mock('../../composables/usePageTabTitle', () => ({ usePageTabTitle: vi.fn() }));
vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

import ProductPage from '../ProductPage.vue';

function mountPage() {
  return mount(ProductPage, { shallow: true, global: { plugins: [createPinia()] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProductDetail.mockResolvedValue({ data: { title: '测试机型', configRows: [{ id: 1, title: '配置1' }, { id: 2, title: '配置2' }] } });
  mocks.getProductFeeds.mockResolvedValue({ data: [] });
});

describe('产品页配置详情竞态与动态去重', () => {
  it('快速切换配置：先发的慢响应不得覆盖后选中的配置详情', async () => {
    let resolveSlow!: (value: unknown) => void;
    mocks.getProductConfig.mockImplementation((configId: string) =>
      configId === '1'
        ? new Promise((resolve) => { resolveSlow = resolve; })
        : Promise.resolve({ data: { id: 2, title: '配置2详情' } }));
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as any;

    vm.selectConfig('1');
    await flushPromises();
    vm.selectConfig('2');
    await flushPromises();
    expect(vm.selectedConfigId).toBe('2');

    // 慢的配置 1 响应此刻才到达，不允许写回
    resolveSlow({ data: { id: 1, title: '配置1详情' } });
    await flushPromises();
    expect(vm.selectedConfigId).toBe('2');
    expect(String(vm.selectedConfig.id)).toBe('2');
    expect(vm.selectedConfig.title).toBe('配置2详情');
    wrapper.unmount();
  });

  it('动态加载更多按实体键去重，服务端游标重复时不出现重复卡片', async () => {
    mocks.getProductFeeds.mockImplementation((_productId: unknown, _tab: unknown, page: number) =>
      Promise.resolve(page === 1
        ? { data: [{ id: 1, title: '动态A' }, { id: 2, title: '动态B' }] }
        : { data: [{ id: 2, title: '动态B' }, { id: 3, title: '动态C' }] }));
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as any;
    vm.resetFeeds();
    await vm.fetchFeeds(false);
    await vm.fetchFeeds(true);
    const ids = (vm.productFeeds as any[]).map((feed) => String(feed.id));
    expect(ids).toEqual(['1', '2', '3']);
    wrapper.unmount();
  });
});