import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue';
import {
  getSecondHandViewerUid,
  resetSecondHandListCache,
  resetSecondHandPageCache,
  secondHandListCache,
  secondHandPageCache,
} from '../../utils/secondHandCache';

const api = vi.hoisted(() => ({
  getDiscoveryPageData: vi.fn(),
  openUrl: vi.fn(),
  getSecondHandBrandList: vi.fn(),
  getSecondHandProductList: vi.fn(),
}));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));

const routeState = vi.hoisted(() => ({ route: {} as Record<string, unknown> }));
const push = vi.hoisted(() => vi.fn());
vi.mock('../../router', () => ({
  router: {
    options: { history: { listen: () => () => {} } },
    beforeEach: () => () => {},
    afterEach: () => () => {},
    push: () => {},
    resolve: () => ({ href: '' }),
  },
}));
vi.mock('vue-router', () => ({
  useRoute: () => routeState.route,
  useRouter: () => ({ push, resolve: () => ({ matched: [] }) }),
  createRouter: () => ({}),
  createWebHashHistory: () => ({}),
}));

import SecondHandListPage from '../SecondHandListPage.vue';
import SecondHandPage from '../SecondHandPage.vue';
import SecondHandBrandsPage from '../SecondHandBrandsPage.vue';

const CACHE_KEY = '/feed/ershouList?productId=123&dataListType=staggered';

const stubs = {
  DiscoverySecondHandGrid: { props: ['items'], template: '<div class="grid"><span v-for="i in items" :key="i.id">{{ i.title }}</span></div>' },
  DiscoveryEntityCard: { props: ['entity'], emits: ['open'], template: "<div class='card' @click=\"$emit('open', entity)\">{{ entity.title }}</div>" },
  DiscoverySkeleton: { template: '<div class="skeleton" />' },
  LoadingState: { template: '<div />' },
  ErrorState: { template: '<div class="error" />' },
  EmptyState: { template: '<div />' },
  AppImage: { template: '<div />' },
};

/** KeepAlive 挂载：切换 show 触发 deactivated/activated（模拟页面离开/回来）。 */
function mountKept(component: unknown) {
  return mount(defineComponent({
    setup() {
      const show = ref(true);
      return () => h('div', [h(KeepAlive, () => (show.value ? h(component as never) : null)), h('button', { class: 'toggle', onClick: () => { show.value = !show.value; } })]);
    },
  }), { global: { stubs } });
}

function setViewer(uid: string) {
  localStorage.setItem('coolapk_user', JSON.stringify({ uid }));
}

function listRoute() {
  routeState.route = reactive({ path: '/secondhand/list', query: { productId: '123' }, fullPath: '/secondhand/list?productId=123' });
}

function homeRoute() {
  routeState.route = reactive({ path: '/secondhand', query: {}, fullPath: '/secondhand' });
}

function brandsRoute() {
  routeState.route = reactive({ path: '/secondhand/brands', query: {}, fullPath: '/secondhand/brands' });
}

describe('批次16 · 二手市场五条', () => {
  beforeEach(() => {
    resetSecondHandListCache();
    resetSecondHandPageCache();
    api.getDiscoveryPageData.mockReset();
    api.getSecondHandBrandList.mockReset();
    api.getSecondHandProductList.mockReset();
    push.mockReset();
    setViewer('42');
    listRoute();
  });

  afterEach(() => {
    localStorage.removeItem('coolapk_user');
  });

  it('条目1：换号后进入同一路由，不先渲染上一账号的条目，直接重新加载', async () => {
    secondHandListCache.set(CACHE_KEY, {
      initialized: true,
      items: [{ id: 'old', title: '账号A的闲置' }],
      page: 2,
      firstItem: 'f',
      lastItem: 'l',
      pageContext: 'c',
      noMore: false,
      scrollTop: 0,
      updatedAt: Date.now(),
      viewerUid: '999',
    });
    let resolve!: (value: unknown) => void;
    api.getDiscoveryPageData.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));

    const wrapper = mount(SecondHandListPage, { global: { stubs } });
    await flushPromises();

    // 首次渲染前已重新请求（page 1、无旧游标），且未上屏上一账号条目。
    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(1);
    expect(api.getDiscoveryPageData.mock.calls[0][0]).toMatchObject({ page: 1, firstItem: '', lastItem: '' });
    expect(wrapper.text()).not.toContain('账号A的闲置');
    expect(wrapper.find('.skeleton').exists()).toBe(true);

    resolve({ data: [{ id: 'b1', title: '账号B的闲置' }], hasMore: false });
    await flushPromises();
    expect(wrapper.text()).toContain('账号B的闲置');
    expect(secondHandListCache.get(CACHE_KEY)).toMatchObject({ viewerUid: getSecondHandViewerUid() });
    wrapper.unmount();
  });

  it('条目2：普通滚动不写缓存，离开页面时才同步滚动位置', async () => {
    api.getDiscoveryPageData.mockResolvedValue({ data: [{ id: 'a', title: '第一条' }], hasMore: true });
    const wrapper = mount(SecondHandListPage, { global: { stubs } });
    await flushPromises();
    expect(secondHandListCache.get(CACHE_KEY)).toBeTruthy();
    const snapshot = JSON.stringify(secondHandListCache.get(CACHE_KEY));

    // 模拟远离底部的滚动（不触发触底加载）。
    const el = wrapper.find('.page-container').element as HTMLElement;
    Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true });
    el.scrollTop = 800;
    await wrapper.find('.page-container').trigger('scroll');
    await wrapper.find('.page-container').trigger('scroll');
    await wrapper.find('.page-container').trigger('scroll');
    await flushPromises();

    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(1);
    // 滚动期间缓存未被改写。
    expect(JSON.stringify(secondHandListCache.get(CACHE_KEY))).toBe(snapshot);

    // 卸载（离开页面）时才落盘滚动位置。
    wrapper.unmount();
    expect(secondHandListCache.get(CACHE_KEY)?.scrollTop).toBe(800);
  });

  it('条目3：无稳定 id 的分页用内容键去重，重复内容不产生重复卡片', async () => {
    homeRoute();
    const duplicated = { entityType: 'feed', title: '同款闲置', description: '一样的描述', price: '99' };
    api.getDiscoveryPageData
      .mockResolvedValueOnce({ data: [duplicated], hasMore: true })
      .mockResolvedValueOnce({ data: [{ ...duplicated }], hasMore: false });

    const wrapper = mountKept(SecondHandPage);
    await flushPromises();
    expect(wrapper.findAll('.card')).toHaveLength(1);

    // 离开再回来（激活绑定滚动监听），然后触底加载。
    await wrapper.find('.toggle').trigger('click');
    await nextTick();
    await wrapper.find('.toggle').trigger('click');
    await nextTick();
    window.dispatchEvent(new Event('scroll'));
    await flushPromises();

    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('.card')).toHaveLength(1);
    expect(wrapper.text()).toContain('同款闲置');
    wrapper.unmount();
  });

  it('条目4：静默刷新失败后退避，短时间内再次激活页面不重复请求', async () => {
    homeRoute();
    secondHandPageCache.initialized = true;
    secondHandPageCache.items = [{ id: 'cached', title: '缓存条目' }];
    secondHandPageCache.updatedAt = Date.now() - 10 * 60 * 1000;
    secondHandPageCache.viewerUid = '42';

    api.getDiscoveryPageData.mockRejectedValue(new Error('网络异常'));
    const wrapper = mountKept(SecondHandPage);
    await flushPromises();
    expect(wrapper.text()).toContain('缓存条目');
    const firstCalls = api.getDiscoveryPageData.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);

    // 离开再回来（退避窗口内）：不再发请求，旧列表保留。
    await wrapper.find('.toggle').trigger('click');
    await nextTick();
    await wrapper.find('.toggle').trigger('click');
    await flushPromises();
    expect(api.getDiscoveryPageData.mock.calls.length).toBe(firstCalls);
    expect(wrapper.text()).toContain('缓存条目');
    wrapper.unmount();
  });

  it('条目5：openProduct 点击跳转走 normalizeProduct 归一化口径', async () => {
    brandsRoute();
    api.getSecondHandBrandList.mockResolvedValue({ data: [{ id: 'brand-1', title: '品牌一' }] });
    // 原始实体缺 brandId/entityTemplate：未归一化时 resolveDiscoveryRoute 返回 null（不跳转），
    // 归一化后按闲置型号列表路由（ershouList + productId）跳转，与卡片渲染口径一致。
    api.getSecondHandProductList.mockResolvedValue({
      data: [{ id: 'p-9', title: '型号九' }],
      hasMore: false,
    });

    const wrapper = mount(SecondHandBrandsPage, { global: { stubs } });
    await flushPromises();
    expect(wrapper.text()).toContain('型号九');

    // 派发原始实体（无 brandId/entityTemplate），openProduct 内部归一化后按闲置型号列表路由跳转。
    await wrapper.find('.card').trigger('click');
    await flushPromises();

    expect(push).toHaveBeenCalledTimes(1);
    const arg = push.mock.calls[0][0];
    const url = typeof arg === 'string' ? arg : String(arg?.query?.url ?? arg?.path ?? '');
    expect(url).toContain('/feed/ershouList');
    expect(url).toContain('productId=p-9');
    wrapper.unmount();
  });
});
