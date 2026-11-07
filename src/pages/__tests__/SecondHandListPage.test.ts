import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { getSecondHandViewerUid, resetSecondHandListCache, secondHandListCache, type SecondHandListCache } from '../../utils/secondHandCache';

const api = vi.hoisted(() => ({ getDiscoveryPageData: vi.fn(), openUrl: vi.fn() }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));

const routeState = vi.hoisted(() => ({ route: {} as any }));
const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({
  useRoute: () => routeState.route,
  useRouter: () => ({ push, resolve: () => ({ matched: [] }) }),
}));

import SecondHandListPage from '../SecondHandListPage.vue';

const CACHE_KEY = '/feed/ershouList?productId=123&dataListType=staggered';
const LONG_AGO = Date.now() - 30 * 60 * 1000;

function seedListCache(overrides: Partial<SecondHandListCache> = {}) {
  secondHandListCache.set(CACHE_KEY, {
    initialized: true,
    items: [{ id: 'old', title: '旧闲置' } as any],
    page: 2,
    firstItem: 'first-old',
    lastItem: 'last-old',
    pageContext: 'ctx-old',
    noMore: false,
    scrollTop: 0,
    updatedAt: Date.now(),
    viewerUid: getSecondHandViewerUid(),
    ...overrides,
  });
}

function render() {
  return mount(SecondHandListPage, {
    global: {
      stubs: {
        DiscoverySecondHandGrid: {
          props: ['items'],
          template: '<div class="grid"><span v-for="item in items" :key="item.id" class="grid-item">{{ item.title }}</span></div>',
        },
        DiscoverySkeleton: { template: '<div class="skeleton" />' },
        LoadingState: { template: '<div class="loading-more" />' },
        ErrorState: { props: ['title', 'message'], template: '<div class="error" />' },
        EmptyState: { template: '<div class="empty" />' },
      },
    },
  });
}

describe('二手型号列表缓存', () => {
  beforeEach(() => {
    resetSecondHandListCache();
    api.getDiscoveryPageData.mockReset();
    push.mockReset();
    routeState.route = reactive({ path: '/secondhand/list', query: { productId: '123' }, fullPath: '/secondhand/list?productId=123' });
  });

  it('命中过期缓存时先渲染旧列表，再后台静默刷新且不显示骨架屏', async () => {
    seedListCache({ updatedAt: LONG_AGO });
    let resolve!: (value: unknown) => void;
    api.getDiscoveryPageData.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const wrapper = render();
    await flushPromises();

    // 旧列表已经渲染，且没有骨架屏/空状态遮罩。
    expect(wrapper.text()).toContain('旧闲置');
    expect(wrapper.find('.skeleton').exists()).toBe(false);
    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(1);
    // 静默刷新从第一页重拉：游标清空，pageContext 回落到本地默认上下文。
    expect(api.getDiscoveryPageData.mock.calls[0][0]).toMatchObject({ page: 1, firstItem: '', lastItem: '' });
    expect(api.getDiscoveryPageData.mock.calls[0][0].pageContext).toContain('desktop-secondhand-list');

    resolve({ data: [{ id: 'new', title: '新闲置' }], hasMore: true });
    await flushPromises();

    expect(wrapper.text()).toContain('新闲置');
    expect(wrapper.text()).not.toContain('旧闲置');
    expect(wrapper.find('.skeleton').exists()).toBe(false);
    // 刷新成功后缓存写入新的时间戳与账号维度。
    expect(secondHandListCache.get(CACHE_KEY)).toMatchObject({ viewerUid: getSecondHandViewerUid(), page: 2 });
    expect((secondHandListCache.get(CACHE_KEY)?.updatedAt || 0) > LONG_AGO).toBe(true);
    wrapper.unmount();
  });

  it('缓存新鲜（5 分钟内、同账号）时直接渲染，不发起请求', async () => {
    seedListCache();
    const wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain('旧闲置');
    expect(api.getDiscoveryPageData).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('加载更多遇到游标失效时清空列表并回到第一页重拉', async () => {
    seedListCache();
    const wrapper = render();
    await flushPromises();

    api.getDiscoveryPageData
      .mockRejectedValueOnce(new Error('lastItem 参数错误'))
      .mockResolvedValueOnce({ data: [{ id: 'first-page', title: '第一页闲置' }], hasMore: true });
    await wrapper.find('.page-container').trigger('scroll');
    await flushPromises();

    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(2);
    // 第一次是带旧游标的加载更多，失败后立刻清空列表重拉第一页。
    expect(api.getDiscoveryPageData.mock.calls[0][0]).toMatchObject({ page: 2, lastItem: 'last-old' });
    expect(api.getDiscoveryPageData.mock.calls[1][0]).toMatchObject({ page: 1, firstItem: '', lastItem: '' });
    expect(wrapper.text()).toContain('第一页闲置');
    expect(wrapper.text()).not.toContain('旧闲置');
    wrapper.unmount();
  });
});
