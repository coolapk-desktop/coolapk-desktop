import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  fetchExternalPage: vi.fn(),
  push: vi.fn(),
}));

// 选机页的请求参数改为响应式读取，因此路由 query 必须是响应式的。
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  mocks.query = reactive({ callFunction: 'indexSearch' });
  return {
    useRoute: () => ({ get query() { return mocks.query; } }),
    useRouter: () => ({ push: mocks.push }),
  };
});

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    fetchExternalPage: mocks.fetchExternalPage,
    getProductDetail: vi.fn(),
    getProductCategoryList: vi.fn(),
  },
}));

vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

import ProductSelectorPage from '../ProductSelectorPage.vue';

function htmlFor(prefix: string) {
  const items = [1, 2].map((index) => `<div class="phone-item" data-product-id="${prefix}${index}">
      <div class="phone-name">${prefix}机型${index}</div>
      <div class="phone-specs">规格${index}</div>
      <div class="phone-price">¥${1000 + index}</div>
    </div>`).join('');
  return `<html><body>${items}</body></html>`;
}

class StubIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe('选机页随地址栏数据源更新', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.callFunction = 'indexSearch';
    mocks.query.mode = 'compare';
    delete mocks.query.brandId;
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
    mocks.fetchExternalPage.mockImplementation((url: string) => Promise.resolve({ data: { html: htmlFor(url.includes('brandId=77') ? '品牌' : '全部') } }));
  });

  it('同一实例内换数据源 query 后按新参数重新请求，列表与选择状态一起更新', async () => {
    const wrapper = mount(ProductSelectorPage, { global: { stubs: { AppImage: true, LoadingState: true, ErrorState: true, EmptyState: true } } });
    await flushPromises();
    expect(mocks.fetchExternalPage).toHaveBeenCalledTimes(1);
    expect(mocks.fetchExternalPage.mock.calls[0][0]).toContain('callFunction=indexSearch');
    expect(wrapper.text()).toContain('全部机型1');

    // 对比模式下已选机型在数据源变化后清空，避免拿旧列表的机型去对比。
    await wrapper.get('.model-card').trigger('click');
    expect(wrapper.findAll('.model-card.is-compare-selected')).toHaveLength(1);

    mocks.query.callFunction = 'brandList';
    mocks.query.brandId = '77';
    await flushPromises();
    expect(mocks.fetchExternalPage).toHaveBeenCalledTimes(2);
    expect(mocks.fetchExternalPage.mock.calls[1][0]).toContain('brandId=77');
    expect(wrapper.text()).toContain('品牌机型1');
    expect(wrapper.text()).not.toContain('全部机型1');
    expect(wrapper.find('.model-card.is-compare-selected').exists()).toBe(false);

    wrapper.unmount();
  });
});
