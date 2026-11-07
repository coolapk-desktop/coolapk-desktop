import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  fetchExternalPage: vi.fn(),
  getProductCategoryList: vi.fn(),
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
    getProductCategoryList: mocks.getProductCategoryList,
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

function htmlForRated() {
  const ratings = [8.5, 9.5, 9];
  const items = ratings.map((rating, index) => `<div class="phone-item" data-product-id="r${index}">
      <div class="phone-name">评分机型${index}</div>
      <div class="phone-specs-tags"><span class="tag-item">评分 ${rating}</span></div>
      <div class="phone-specs">规格${index}</div>
      <div class="phone-price">¥${1000 + index}</div>
    </div>`).join('');
  return `<html><body>${items}</body></html>`;
}

function htmlForCount(prefix: string, count: number, namePrefix = prefix) {
  const items = Array.from({ length: count }, (_, index) => `<div class="phone-item" data-product-id="${prefix}${index}">
      <div class="phone-name">${namePrefix}机型${index}</div>
      <div class="phone-specs">规格${index}</div>
      <div class="phone-price">¥${1000 + index}</div>
    </div>`).join('');
  return `<html><body>${items}</body></html>`;
}

describe('选机页兜底数据不编造、失败可见、排序真实生效', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.callFunction = 'indexSearch';
    delete mocks.query.mode;
    delete mocks.query.brandId;
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
  });

  it('数据源为空时走分类兜底：不出现编造的评分/价格/标签/新品，并提示数据可能不完整', async () => {
    mocks.fetchExternalPage.mockResolvedValue({ data: { html: '<html><body></body></html>' } });
    mocks.getProductCategoryList.mockResolvedValue({
      data: [
        { id: 1, title: '兜底机型A' },
        { entities: [{ id: 2, title: '兜底机型B', price: 4999, subTitle: '轻薄长续航' }] },
      ],
    });
    const wrapper = mount(ProductSelectorPage, { global: { stubs: { AppImage: true, LoadingState: true, ErrorState: true, EmptyState: true } } });
    await flushPromises();
    const text = wrapper.text();
    expect(text).not.toContain('9.2');
    expect(text).not.toContain('¥3999');
    expect(text).not.toContain('性能旗舰');
    expect(text).not.toContain('新品上市');
    expect(text).not.toContain('高性能处理器');
    expect(text).toContain('可能不完整');
    expect(text).toContain('暂无规格信息');
    expect(text).toContain('价格待公布');
    expect(text).toContain('兜底机型A');
    // 有真实字段的兜底项仍正常展示
    expect(text).toContain('轻薄长续航');
    wrapper.unmount();
  });

  it('排序 tab 只保留已实现项，点击「评分」后顺序真实变化', async () => {
    mocks.fetchExternalPage.mockResolvedValue({ data: { html: htmlForRated() } });
    const wrapper = mount(ProductSelectorPage, { global: { stubs: { AppImage: true, LoadingState: true, ErrorState: true, EmptyState: true } } });
    await flushPromises();
    const tabs = wrapper.findAll('.sort-tab-btn');
    expect(tabs.map((tab) => tab.text())).toEqual(['综合', '评分']);
    const textOf = () => wrapper.findAll('.model-title-row strong').map((node) => node.text()).join(',');
    expect(textOf()).toBe('评分机型0,评分机型1,评分机型2');
    await tabs.find((tab) => tab.text() === '评分')!.trigger('click');
    expect(textOf()).toBe('评分机型1,评分机型2,评分机型0');
    wrapper.unmount();
  });

  it('加载更多失败显示 footer 错误与重试，重试只发一次请求并恢复列表', async () => {
    mocks.fetchExternalPage
      .mockResolvedValueOnce({ data: { html: htmlForCount('p', 8, '第一页') } })
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { html: htmlForCount('q', 2, '第二页') } });
    const wrapper = mount(ProductSelectorPage, { global: { stubs: { AppImage: true, LoadingState: true, ErrorState: true, EmptyState: true } } });
    await flushPromises();
    Object.defineProperty(wrapper.element, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(wrapper.element, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(wrapper.element, 'scrollTop', { value: 1600, configurable: true });
    await wrapper.trigger('scroll');
    await flushPromises();
    expect(wrapper.find('.load-more-error').exists()).toBe(true);
    expect(wrapper.text()).toContain('加载更多机型失败');
    expect(wrapper.text()).not.toContain('已展示全部匹配机型');
    await wrapper.get('.load-more-retry-btn').trigger('click');
    await flushPromises();
    expect(mocks.fetchExternalPage).toHaveBeenCalledTimes(3);
    expect(wrapper.text()).toContain('第二页机型0');
    expect(wrapper.find('.load-more-error').exists()).toBe(false);
    wrapper.unmount();
  });
});
