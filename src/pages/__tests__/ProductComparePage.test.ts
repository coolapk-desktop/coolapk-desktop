import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  query: { ids: '1,2', productIds: '9,10' } as Record<string, string>,
  getProductConfig: vi.fn(),
  getProductDetail: vi.fn(),
  push: vi.fn(),
}));

// 对比项改为随 query 响应式加载，因此路由 query 必须是响应式的。
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  mocks.query = reactive({ ids: '1,2', productIds: '9,10' });
  return {
    useRoute: () => ({ get query() { return mocks.query; } }),
    useRouter: () => ({ push: mocks.push }),
  };
});

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getProductConfig: mocks.getProductConfig,
    getProductDetail: mocks.getProductDetail,
  },
}));

import ProductComparePage from '../ProductComparePage.vue';

function config(id: string, productId: string) {
  return { data: { id, title: `配置${id}`, product_id: productId, release_time: '20240101' } };
}

function mountPage() {
  return mount(ProductComparePage, {
    global: { stubs: { LoadingState: true, ErrorState: true, EmptyState: true } },
  });
}

describe('产品对比页随地址栏对比项更新', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.ids = '1,2';
    mocks.query.productIds = '9,10';
    const productIdOf: Record<string, string> = { '1': '9', '2': '10', '3': '11', '4': '12' };
    mocks.getProductConfig.mockImplementation((id: string) => Promise.resolve(config(id, productIdOf[id])));
    mocks.getProductDetail.mockImplementation((productId: string) => Promise.resolve({ data: { title: `机型${productId}` } }));
  });

  it('同一实例内换 ids 重新加载对比项，不残留上一次的表格', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(mocks.getProductConfig.mock.calls.map(call => call[0])).toEqual(['1', '2']);
    expect(wrapper.get('.compare-table').text()).toContain('机型9');

    // 复用同一实例（不重建组件）时地址栏换成另一组对比项。
    mocks.query.ids = '3,4';
    mocks.query.productIds = '11,12';
    await flushPromises();
    expect(mocks.getProductConfig.mock.calls.map(call => call[0])).toEqual(['1', '2', '3', '4']);
    expect(wrapper.get('.compare-table').text()).toContain('机型11');
    expect(wrapper.get('.compare-table').text()).not.toContain('机型9');

    wrapper.unmount();
  });

  it('对比项不足两个时清空旧表格，回到空状态', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('.compare-table').exists()).toBe(true);

    mocks.query.ids = '1';
    await flushPromises();
    expect(wrapper.find('.compare-table').exists()).toBe(false);
    expect(wrapper.find('empty-state-stub').exists()).toBe(true);

    wrapper.unmount();
  });
});
