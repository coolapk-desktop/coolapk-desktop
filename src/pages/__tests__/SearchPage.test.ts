import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, KeepAlive } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTabConfig: vi.fn().mockResolvedValue({ data: [] }),
  getHotSearches: vi.fn(),
  searchByType: vi.fn(),
  getSearchSuggestionsApp: vi.fn(),
  getSearchSuggestions: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));

import SearchPage from '../SearchPage.vue';
import { useSettingsStore } from '../../stores/settings';

describe('搜索联想弹层生命周期', () => {
  async function mountCachedSearch() {
    vi.clearAllMocks();
    mocks.getHotSearches.mockResolvedValue({ data: [] });
    mocks.searchByType.mockResolvedValue({ data: [{ id: '1', entityType: 'feed' }] });
    mocks.getSearchSuggestionsApp.mockReset().mockResolvedValue({ data: [{ entityType: 'searchWord', title: 'nuke' }] });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/search', component: SearchPage }, { path: '/feed/1', component: { render: () => h('div', '帖子') } }] });
    await router.push('/search?q=nuke');
    await router.isReady();
    // 与应用相同，按完整路由缓存页面，覆盖进入帖子后返回的流程。
    const host = defineComponent({ setup: () => () => h(RouterView, null, { default: ({ Component, route }: any) => h(KeepAlive, null, { default: () => Component ? h(Component, { key: route.fullPath }) : null }) }) });
    const wrapper = mount(host, { global: { plugins: [createPinia(), router], stubs: { SearchResultItem: true, SearchHotListCard: true, LoadingState: true, EmptyState: true } } });
    await flushPromises();
    return { wrapper, router };
  }

  it('进入帖子再返回时恢复关键词和结果，不自动请求或显示联想', async () => {
    const { wrapper, router } = await mountCachedSearch();
    try {
      const scroller = wrapper.get('.search-scroll-container').element;
      scroller.scrollTop = 650;
      const requests = mocks.searchByType.mock.calls.length;
      const result = wrapper.find('search-result-item-stub').element;
      await router.push('/feed/1');
      await flushPromises();
      expect(scroller.scrollTop).toBe(650);
      router.back();
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();
      expect((wrapper.get('.search-field').element as HTMLInputElement).value).toBe('nuke');
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      expect(wrapper.find('search-result-item-stub').element).toBe(result);
      expect(wrapper.get('.search-scroll-container').element).toBe(scroller);
      expect(scroller.scrollTop).toBe(650);
      expect(mocks.searchByType).toHaveBeenCalledTimes(requests);
      expect(mocks.getSearchSuggestionsApp).not.toHaveBeenCalled();
      expect(wrapper.find('.suggestions-dropdown').exists()).toBe(false);
      await wrapper.get('.search-field').setValue('nuke2');
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();
      expect(wrapper.get('.suggestion-item').text()).toBe('nuke');
    } finally { wrapper.unmount(); }
  });

  it('搜索不同关键词后返回，保留前一次搜索的结果实例和分页', async () => {
    const { wrapper, router } = await mountCachedSearch();
    try {
      const scroller = wrapper.get('.search-scroll-container').element;
      const result = wrapper.get('search-result-item-stub').element;
      scroller.scrollTop = 480;
      await router.push('/search?q=another');
      await flushPromises();
      const requests = mocks.searchByType.mock.calls.length;
      router.back();
      await new Promise(resolve => setTimeout(resolve, 0));
      await flushPromises();
      expect(wrapper.get('.search-scroll-container').element).toBe(scroller);
      expect(wrapper.get('search-result-item-stub').element).toBe(result);
      expect(scroller.scrollTop).toBe(480);
      expect(mocks.searchByType).toHaveBeenCalledTimes(requests);
    } finally { wrapper.unmount(); }
  });

  it.each(['submit', 'leave', 'blur', 'clear', 'edit'])('旧联想响应在 %s 后不能重新打开弹层', async (action) => {
    const { wrapper, router } = await mountCachedSearch();
    try {
      let resolveOld!: (value: unknown) => void;
      mocks.getSearchSuggestionsApp.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
      await wrapper.get('.search-field').setValue('旧关键词');
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (action === 'submit') await wrapper.get('.search-field').trigger('keydown.enter');
      if (action === 'leave') await router.push('/feed/1');
      if (action === 'blur') await wrapper.get('.search-field').trigger('blur');
      if (action === 'clear') await wrapper.get('.clear-btn').trigger('click');
      if (action === 'edit') await wrapper.get('.search-field').setValue('新关键词');
      await flushPromises();
      resolveOld({ data: [{ entityType: 'searchWord', title: '旧联想' }] });
      await flushPromises();
      if (action === 'leave') { router.back(); await flushPromises(); }
      expect(wrapper.find('.suggestions-dropdown').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
});

describe('搜索分类自定义排序', () => {
  it('应用可排在综合后，远端顺序不能覆盖偏好，切换仍查询应用类型', async () => {
    localStorage.clear();
    mocks.getTabConfig.mockResolvedValueOnce({ data: { 'search.tab': 'product,all,feed,apk' } });
    mocks.searchByType.mockResolvedValue({ data: [{ entityType: 'feed', id: 'order-result', message: '搜狗输入法' }] });
    const pinia = createPinia();
    const settings = useSettingsStore(pinia);
    settings.settings.searchTabOrder = ['apk', 'feed', 'product'];
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/search', component: SearchPage }] });
    await router.push({ path: '/search', query: { q: '搜狗输入法', tab: 'all' } });
    await router.isReady();
    const wrapper = mount(SearchPage, { global: { plugins: [pinia, router], stubs: { SearchResultItem: true, SearchHotListCard: true, LoadingState: true, EmptyState: true } } });
    try {
      await flushPromises();
      expect(wrapper.findAll('.search-tab-item').map(item => item.text())).toEqual(['综合', '应用', '动态', '数码']);
      await wrapper.findAll('.search-tab-item')[1].trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query.tab).toBe('apk');
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ searchType: 'apk', query: '搜狗输入法' });
      const requests = mocks.searchByType.mock.calls.length;
      settings.settings.searchTabOrder = ['product', 'apk', 'feed'];
      await flushPromises();
      expect(wrapper.findAll('.search-tab-item').map(item => item.text())).toEqual(['综合', '数码', '应用', '动态']);
      expect(wrapper.get('.search-tab-item.active').text()).toBe('应用');
      expect(mocks.searchByType).toHaveBeenCalledTimes(requests);
    } finally { wrapper.unmount(); localStorage.clear(); }
  });
});

describe('综合搜索空首页', () => {
  async function mountSearch() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/search', component: SearchPage }] });
    await router.push({ path: '/search', query: { q: '伪回锁', tab: 'all' } });
    await router.isReady();
    const wrapper = mount(SearchPage, { global: { plugins: [createPinia(), router], stubs: { SearchResultItem: true, SearchHotListCard: true, LoadingState: true, EmptyState: true } } });
    return { wrapper, router };
  }

  it('排序配置不显示为结果卡片，选择热度和精确时发送正确请求', async () => {
    vi.clearAllMocks();
    const menu = ['综合', '实时', '热度', '评论', '精确'].map((title) => ({ entityType: 'textLink', title }));
    mocks.searchByType.mockReset().mockResolvedValue({ data: [{ entityType: 'entityCard', entities: menu }, { entityType: 'feed', id: '1', message: '伪回锁' }] });
    const { wrapper, router } = await mountSearch();
    try {
      await flushPromises();
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      expect(wrapper.findAll('.search-feed-sort .filter-btn').map((option) => option.text())).toEqual(['综合', '实时', '热度', '评论', '精确']);
      await wrapper.findAll('.search-feed-sort .filter-btn')[2].trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({ q: '伪回锁', tab: 'all', sort: 'hot' });
      expect(wrapper.get('.search-tab-item.active').text()).toBe('综合');
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ searchType: 'feed', sort: 'hot', isStrict: 0, page: 1 });
      await wrapper.findAll('.search-feed-sort .filter-btn')[4].trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({ tab: 'all', sort: 'accurate' });
      expect(wrapper.get('.search-tab-item.active').text()).toBe('综合');
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ searchType: 'feed', sort: '', isStrict: 1, page: 1 });
      await wrapper.get('.search-field').setValue('新关键词');
      await wrapper.get('.search-field').trigger('keydown.enter');
      await flushPromises();
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ query: '新关键词', sort: '', isStrict: 1 });
      expect(wrapper.get('.search-tab-item.active').text()).toBe('综合');
    } finally { wrapper.unmount(); }
  });

  it('首页为空时继续第二页，并从第三页加载更多', async () => {
    vi.clearAllMocks();
    mocks.searchByType.mockReset();
    mocks.searchByType.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ id: '1', entityType: 'feed', message: '伪回锁' }], firstItem: 'first', lastItem: 'last' }).mockResolvedValue({ data: [] });
    const { wrapper } = await mountSearch();
    try {
      await flushPromises();
      expect(mocks.searchByType.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);
      expect(mocks.searchByType.mock.calls[1][0]).toMatchObject({ searchType: 'all', query: '伪回锁', firstItem: '', lastItem: '' });
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      await wrapper.get('.search-scroll-container').trigger('scroll');
      await flushPromises();
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ page: 3, firstItem: 'first', lastItem: 'last' });
      await wrapper.get('.search-scroll-container').trigger('scroll');
      await flushPromises();
      expect(mocks.searchByType).toHaveBeenCalledTimes(3);
    } finally { wrapper.unmount(); }
  });

  it('连续两页为空时停止，不无限请求', async () => {
    vi.clearAllMocks();
    mocks.searchByType.mockReset().mockResolvedValue({ data: [] });
    const { wrapper } = await mountSearch();
    try {
      await flushPromises();
      await wrapper.get('.search-scroll-container').trigger('scroll');
      await flushPromises();
      expect(mocks.searchByType.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);
      expect(wrapper.find('empty-state-stub').attributes('title')).toBe('未搜索到相关结果');
    } finally { wrapper.unmount(); }
  });

  it('第二页失败时显示失败并允许重新搜索', async () => {
    vi.clearAllMocks();
    mocks.searchByType.mockReset().mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce(new Error('网络错误')).mockResolvedValue({ data: [{ id: '2', entityType: 'feed' }] });
    const { wrapper } = await mountSearch();
    try {
      await flushPromises();
      expect(wrapper.find('empty-state-stub').attributes('title')).toBe('搜索失败');
      await wrapper.get('.retry-button').trigger('click');
      await flushPromises();
      expect(mocks.searchByType.mock.calls.map(([request]) => request.page)).toEqual([1, 2, 1]);
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
    } finally { wrapper.unmount(); }
  });

  it('切换关键词后忽略旧搜索的第二页', async () => {
    vi.clearAllMocks();
    let resolveOldPage!: (value: unknown) => void;
    mocks.searchByType.mockReset().mockResolvedValueOnce({ data: [] }).mockImplementationOnce(() => new Promise((resolve) => { resolveOldPage = resolve; })).mockResolvedValue({ data: [{ id: 'new', entityType: 'feed' }] });
    const { wrapper, router } = await mountSearch();
    try {
      await flushPromises();
      await router.push({ path: '/search', query: { q: '新关键词', tab: 'all' } });
      await flushPromises();
      resolveOldPage({ data: [{ id: 'old', entityType: 'feed' }] });
      await flushPromises();
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      expect((wrapper.findComponent({ name: 'SearchResultItem' }).props('entity') as { id: string }).id).toBe('new');
    } finally { wrapper.unmount(); }
  });
});

describe('话题内搜索', () => {
  it('个人动态搜索在重新输入、分页和切换用户后保留 UID 范围', async () => {
    vi.clearAllMocks();
    mocks.searchByType.mockResolvedValue({ code: 200, data: [{ id: '1', entityType: 'feed', message: '镜头' }] });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/search', component: SearchPage }] });
    await router.push({ path: '/search', query: { pageType: 'user', pageParam: '123', tab: 'all' } });
    await router.isReady();
    const wrapper = mount(SearchPage, { global: { plugins: [createPinia(), router], stubs: { SearchResultItem: true, SearchHotListCard: true, LoadingState: true, EmptyState: true } } });
    try {
      await flushPromises();
      expect(wrapper.get('.search-field').attributes('placeholder')).toBe('搜索TA的动态');
      expect(mocks.getHotSearches).not.toHaveBeenCalled();
      const input = wrapper.get('.search-field');
      await input.setValue('镜头');
      await input.trigger('keydown.enter');
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ q: '镜头', tab: 'feed', pageType: 'user', pageParam: '123', sort: 'default' });
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ searchType: 'feed', pageType: 'user', pageParam: '123', query: '镜头', page: 1 });
      expect(wrapper.find('.search-tabs').exists()).toBe(false);
      await wrapper.get('.search-scroll-container').trigger('scroll');
      await flushPromises();
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ pageType: 'user', pageParam: '123', page: 2 });
      await router.push({ path: '/search', query: { q: '镜头', pageType: 'user', pageParam: '456' } });
      await flushPromises();
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ pageType: 'user', pageParam: '456', page: 1 });
      expect(mocks.getSearchSuggestionsApp).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it('使用 feed 搜索并携带当前话题作用域', async () => {
    mocks.getHotSearches.mockResolvedValue({ code: 200, data: [] });
    mocks.searchByType.mockResolvedValue({ code: 200, data: [] });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/search', component: SearchPage }],
    });
    await router.push({
      path: '/search',
      query: { q: '镜头', tab: 'feed', pageType: 'tag', pageParam: '数码' },
    });
    await router.isReady();

    const wrapper = mount(SearchPage, {
      global: {
        plugins: [createPinia(), router],
        stubs: {
          SearchResultItem: true,
          SearchHotListCard: true,
          LoadingState: true,
          EmptyState: true,
        },
      },
    });

    await flushPromises();

    const request = mocks.searchByType.mock.calls.at(-1)?.[0];
    expect(request).toMatchObject({
      searchType: 'feed',
      query: '镜头',
      pageType: 'tag',
      pageParam: '数码',
      feedType: 'all',
      sort: 'none',
    });
    expect(wrapper.find('.search-tabs').exists()).toBe(false);
    expect(wrapper.find('.search-field').attributes('placeholder')).toContain('数码');
  });

  it('点击 searchTab 联想词时使用关键词并切换到对应页签', async () => {
    mocks.getHotSearches.mockResolvedValue({ code: 200, data: [] });
    mocks.searchByType.mockResolvedValue({ code: 200, data: [] });
    mocks.getSearchSuggestionsApp.mockResolvedValue({
      code: 200,
      data: [{ entityType: 'searchWord', title: '搜索用户：小米', url: 'searchTab://user?keyword=%E5%B0%8F%E7%B1%B3' }],
    });
    mocks.getSearchSuggestions.mockResolvedValue({ code: 200, data: [] });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/search', component: SearchPage }],
    });
    await router.push('/search');
    await router.isReady();

    const wrapper = mount(SearchPage, {
      global: {
        plugins: [createPinia(), router],
        stubs: {
          SearchResultItem: true,
          SearchHotListCard: true,
          LoadingState: true,
          EmptyState: true,
        },
      },
    });

    await flushPromises();
    const input = wrapper.find('.search-field');
    await input.setValue('小米');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();

    expect(wrapper.find('.suggestion-item').text()).toBe('搜索用户：小米');
    await wrapper.find('.suggestion-item').trigger('mousedown');
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({ q: '小米', tab: 'user' });
  });

  it('问答页签按 APK 提供全部、提问、回答筛选', async () => {
    mocks.getHotSearches.mockResolvedValue({ code: 200, data: [] });
    mocks.searchByType.mockResolvedValue({ code: 200, data: [] });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/search', component: SearchPage }],
    });
    await router.push({ path: '/search', query: { q: '小米', tab: 'ask' } });
    await router.isReady();

    const wrapper = mount(SearchPage, {
      global: {
        plugins: [createPinia(), router],
        stubs: {
          SearchResultItem: true,
          SearchHotListCard: true,
          LoadingState: true,
          EmptyState: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.findAll('.search-ask-filter-item').map((item) => item.text())).toEqual(['全部', '提问', '回答']);
    await wrapper.findAll('.search-ask-filter-item')[2].trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({ q: '小米', tab: 'ask', feedType: 'answer' });
    expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ searchType: 'ask', feedType: 'answer' });
  });
});
