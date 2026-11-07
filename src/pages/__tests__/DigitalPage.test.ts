import { mobilePull } from '../../test-utils/mobilePull';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DigitalPage from '../DigitalPage.vue';
import DiscoveryPager from '../../components/discovery/DiscoveryPager.vue';

const api = vi.hoisted(() => ({ getTabConfig: vi.fn(), getDiscoveryPageData: vi.fn(), getProductCategoryList: vi.fn(), getProductBrandList: vi.fn(), getProductBrandProducts: vi.fn(), getProductList: vi.fn(), push: vi.fn() }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));
vi.mock('vue-router', async importOriginal => ({ ...await importOriginal<typeof import('vue-router')>(), useRouter: () => ({ push: api.push }) }));
vi.mock('../../utils/anchorClick', () => ({ handleAnchorClick: vi.fn() }));
vi.mock('../../stores/settings', () => ({ useSettingsStore: () => ({ settings: { disableAutoMobileMode: false } }) }));
vi.mock('../../utils/platform', () => ({ isTouchMobilePlatform: () => false }));

beforeEach(() => {
  localStorage.clear();
  api.push.mockReset();
  api.getProductCategoryList.mockReset();
  api.getProductBrandList.mockReset();
  api.getProductBrandProducts.mockReset();
  api.getProductList.mockReset();
  api.getTabConfig.mockReset().mockResolvedValue({ data: [{ entityTemplate: 'configCard', title: '数码', entities: ['PHONE', 'TABLET', 'PC'].map(key => ({ title: key, pageName: `V10_${key}`, url: `V10_${key}` })) }] });
  api.getDiscoveryPageData.mockReset().mockImplementation(({ url }) => Promise.resolve({ data: [{ id: url, title: url }], hasMore: false }));
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('ResizeObserver', undefined);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

it('移动路由器入口按官方目录查找子分类，保留 isSecondCategory 参数', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360);
  const route = { id: 1012, title: '路由器', url: '/product/categoryList?id=1012' };
  const actualUrl = `/page?url=${encodeURIComponent('/product/categoryDetailList?type=category&id=1012&isSecondCategory=1&showMode=0')}`;
  api.getProductCategoryList.mockResolvedValue({ data: [{ id: 1000, title: '网络设备', secondCategoryRows: [{ ...route, url: actualUrl, subTitle: '网络' }] }] });
  api.getDiscoveryPageData.mockResolvedValue({ data: [{ entityTemplate: 'iconLinkGridCard', entities: [route] }], hasMore: false });
  const wrapper = render();
  try {
    await flushPromises();
    wrapper.findComponent({ name: 'MobileDigitalCard' }).vm.$emit('open', route);
    await flushPromises();
    expect(api.getProductCategoryList).toHaveBeenCalledTimes(1);
    expect(api.push).toHaveBeenCalledWith({ path: '/page', query: { url: actualUrl, title: '路由器', subTitle: '网络', renderer: 'discovery' } });
  } finally { wrapper.unmount(); }
});

it('桌面路由器栏目同样使用官方目录的完整地址加载内容', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
  const route = { id: 1012, title: '路由器', url: '/product/categoryList?id=1012' };
  const actualUrl = `/page?url=${encodeURIComponent('/product/categoryDetailList?type=category&id=1012&isSecondCategory=1&showMode=0')}`;
  api.getProductCategoryList.mockResolvedValue({ data: [{ ...route, url: actualUrl }] });
  const rating = { title: '评分', url: '/product/categoryDetailList?id=1012&isSecondCategory=1&sortField=star_average_score' };
  api.getDiscoveryPageData.mockImplementation(({ url }) => Promise.resolve({ data: url === actualUrl
    ? [{ id: 'brands', title: '品牌', entityTemplate: 'iconGridHorizonCard' }, { id: 'sort', entityTemplate: 'sortSelectCard', entities: [rating] }, { id: 5457, entityType: 'product', title: '小米路由器BE7200 Pro' }]
    : url === rating.url ? [{ id: 123, entityType: 'product', title: '评分产品' }] : [{ entityTemplate: 'iconLinkGridCard', entities: [route] }], hasMore: false }));
  const wrapper = render();
  try {
    await flushPromises();
    wrapper.findComponent({ name: 'DiscoveryEntityCard' }).vm.$emit('open', route);
    await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: actualUrl, title: '路由器', page: 1 }));
    wrapper.findAllComponents({ name: 'DiscoveryEntityCard' }).find(card => card.props('entity').id === 'sort')!.vm.$emit('open', rating);
    await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: rating.url, title: '路由器', page: 1 }));
    const entities = wrapper.findAllComponents({ name: 'DiscoveryEntityCard' }).map(card => card.props('entity'));
    expect(entities.find(entity => entity.id === 'brands')?.title).toBe('品牌');
    expect(entities.find(entity => entity.id === 'sort')?.entities[0].selected).toBe(1);
    expect(wrapper.findComponent({ name: 'DigitalProductCard' }).props('product').title).toBe('评分产品');
    expect(api.push).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const render = () => mount(DigitalPage, { global: { stubs: { FeedTabs: { props: ['activeKey', 'swipeProgress'], template: '<nav :data-active="activeKey" />' }, MobileDigitalCard: { name: 'MobileDigitalCard', props: ['entity'], template: '<article>{{ entity.title }}</article>' }, DigitalProductCard: true, DiscoveryEntityCard: true } } });

it('移动数码复用滑动容器，切换后保留原栏目并且只获取一次配置', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
  const wrapper = render();
  try {
    await flushPromises();
    const pager = wrapper.findComponent(DiscoveryPager);
    Object.assign(pager.element, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    expect(pager.exists()).toBe(true);
    expect(api.getTabConfig).toHaveBeenCalledTimes(1);
    const firstPage = wrapper.findAll('.discovery-pager-page')[0].element;
    // 发送真实触摸指针序列，验证手势最终连通栏目选择与请求流程。
    for (const [type, x] of [['pointerdown', 280], ['pointermove', 100], ['pointerup', 100]] as const) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 100 });
      Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: 'touch' } });
      pager.element.dispatchEvent(event);
    }
    await flushPromises();
    expect(wrapper.get('nav').attributes('data-active')).toBe('V10_TABLET');
    expect(wrapper.findAll('.discovery-pager-page')[0].element).toBe(firstPage);
    pager.vm.$emit('select', 'V10_PHONE');
    await flushPromises();
    expect(api.getDiscoveryPageData.mock.calls.filter(([args]) => args.url === 'V10_PHONE')).toHaveLength(1);
    expect(api.getTabConfig).toHaveBeenCalledTimes(1);
  } finally { wrapper.unmount(); }
});

it('桌面数码继续直接展示当前栏目', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
  const wrapper = render();
  try {
    await flushPromises();
    expect(wrapper.findComponent(DiscoveryPager).exists()).toBe(false);
    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(1);
  } finally { wrapper.unmount(); }
});

it('下拉已到末页的数码栏目仍从第一页刷新并保留栏目', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
  const wrapper = mount(DigitalPage, { props: { channelOnly: true, channelActive: true, channelKey: 'V10_PHONE', channelTabs: [{ key: 'V10_PHONE', title: '手机', url: 'V10_PHONE', pageName: 'V10_PHONE', category: false, rawEntities: [] } as any] }, global: { stubs: { FeedTabs: true, MobileDigitalCard: true, DiscoveryEntityCard: true, DigitalProductCard: true } } });
  try {
    await flushPromises();
    const calls = api.getDiscoveryPageData.mock.calls.length;
    mobilePull(wrapper.element as HTMLElement);
    await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(calls + 1);
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'V10_PHONE', page: 1, firstItem: '', lastItem: '' }));
    expect(api.push).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});

it('legacy 品牌列表响应无分页字段时保留页大小启发式：不足 20 条判没有更多', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
  api.getTabConfig.mockResolvedValue({ data: [{ entityTemplate: 'configCard', title: '数码', entities: [{ title: '手机', pageName: 'V10_PHONE', url: 'V10_PHONE', category: true }] }] });
  api.getProductCategoryList.mockResolvedValue({ data: [{ id: 555, title: '分类A', url: '' }] });
  api.getProductBrandList.mockResolvedValue({ data: [{ id: 777, title: '品牌B' }] });
  api.getProductBrandProducts.mockResolvedValue([
    { id: 1, entityType: 'product', title: '品牌产品A' },
    { id: 2, entityType: 'product', title: '品牌产品B' },
    { id: 3, entityType: 'product', title: '品牌产品C' },
  ]);
  const wrapper = render();
  try {
    await flushPromises();
    const brandBtn = wrapper.findAll('.mode-button').find(btn => btn.text().includes('品牌'))!;
    await brandBtn.trigger('click');
    await flushPromises();
    expect(api.getProductBrandProducts).toHaveBeenCalled();
    expect(wrapper.text()).toContain('没有更多服务端内容了');
  } finally { wrapper.unmount(); }
});
