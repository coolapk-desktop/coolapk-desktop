import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, KeepAlive, ref } from 'vue';
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
import { mobileReadingNavigationKey } from '../../composables/useMobileReadingNavigation';

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
    const readingHidden = ref(false);
    const wrapper = mount(host, { global: {
      plugins: [createPinia(), router],
      provide: { [mobileReadingNavigationKey as symbol]: { hidden: readingHidden, reset: () => { readingHidden.value = false; } } },
      stubs: { SearchResultItem: true, SearchHotListCard: true, LoadingState: true, EmptyState: true },
    } });
    await flushPromises();
    return { wrapper, router, readingHidden };
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

  it('窄屏搜索栏提供返回和提交，输入法确认期间不会发起搜索', async () => {
    const previousWidth = window.innerWidth;
    window.innerWidth = 390;
    const { wrapper, router, readingHidden } = await mountCachedSearch();
    try {
      const form = wrapper.get('form[role="search"]');
      expect(form.find('button[aria-label="返回"]').exists()).toBe(true);
      expect(form.find('button[type="submit"][aria-label="搜索"]').exists()).toBe(true);
      const toolbar = wrapper.get('.search-toolbar-frame');
      expect(wrapper.get('.search-scroll-container').attributes('data-reading-scroll')).toBe('');
      readingHidden.value = true;
      await flushPromises();
      expect(toolbar.classes()).toContain('is-collapsed');
      expect(toolbar.attributes('inert')).toBeDefined();
      readingHidden.value = false;
      await flushPromises();
      expect(toolbar.attributes('inert')).toBeUndefined();
      const input = wrapper.get('.search-field');
      await input.setValue('Android');
      await input.trigger('keydown.enter', { isComposing: true });
      await flushPromises();
      expect(router.currentRoute.value.query.q).toBe('nuke');
      await form.trigger('submit');
      await flushPromises();
      expect(router.currentRoute.value.query.q).toBe('Android');
    } finally {
      wrapper.unmount();
      window.innerWidth = previousWidth;
      window.dispatchEvent(new Event('resize'));
    }
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

  it('下拉刷新保留再次返回的实体，并显示更新后的内容', async () => {
    vi.stubGlobal('innerWidth', 390);
    vi.clearAllMocks();
    mocks.searchByType.mockReset()
      .mockResolvedValueOnce({ data: [{ entityType: 'feed', id: '1', message: '旧内容' }] })
      .mockResolvedValueOnce({ data: [{ entityType: 'feed', id: '1', message: '新内容' }] });
    const { wrapper } = await mountSearch();
    try {
      await flushPromises();
      expect(wrapper.findComponent({ name: 'SearchResultItem' }).props('entity')).toMatchObject({ id: '1', message: '旧内容' });
      const target = wrapper.get('.search-scroll-container').element;
      for (const [type, clientY] of [['touchstart', 100], ['touchmove', 280], ['touchend', 280]] as const) {
        const points = [{ identifier: 0, clientX: 100, clientY }];
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : points }, changedTouches: { value: points } });
        target.dispatchEvent(event);
      }
      await flushPromises();
      expect(mocks.searchByType.mock.calls.map(([request]) => request.page)).toEqual([1, 1]);
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      expect(wrapper.findComponent({ name: 'SearchResultItem' }).props('entity')).toMatchObject({ id: '1', message: '新内容' });
    } finally { wrapper.unmount(); vi.unstubAllGlobals(); }
  });

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
describe('搜索结果去重与筛选一致性', () => {
  function mountSearch() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/search', component: SearchPage }] });
    const wrapper = mount(SearchPage, { global: { plugins: [createPinia(), router], stubs: { SearchResultItem: true, SearchHotListCard: true, LoadingState: true, EmptyState: true } } });
    return { wrapper, router };
  }

  it('翻页返回同一实体时只保留一条', async () => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getTabConfig.mockResolvedValue({ data: [] });
    mocks.getHotSearches.mockResolvedValue({ data: [] });
    mocks.searchByType.mockReset();
    mocks.searchByType
      .mockResolvedValueOnce({ data: [{ id: '1', entityType: 'feed', message: '重复' }], firstItem: 'f1', lastItem: 'l1' })
      .mockResolvedValueOnce({ data: [{ id: '1', entityType: 'feed', message: '重复' }, { id: '1', entityType: 'product', title: '同 ID 的数码产品' }, { id: '2', entityType: 'feed', message: '新' }], firstItem: 'f2', lastItem: 'l2' });
    const { wrapper, router } = mountSearch();
    try {
      await router.push({ path: '/search', query: { q: '重复', tab: 'all' } });
      await flushPromises();
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      await wrapper.get('.search-scroll-container').trigger('scroll');
      await flushPromises();
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(3);
      expect(wrapper.findAllComponents({ name: 'SearchResultItem' }).map((item) => item.props('entity'))).toMatchObject([
        { id: '1', entityType: 'feed' },
        { id: '1', entityType: 'product' },
        { id: '2', entityType: 'feed' },
      ]);
    } finally { wrapper.unmount(); localStorage.clear(); }
  });

  it('综合页排序选回综合后恢复实体搜索，不再降级为动态接口', async () => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getTabConfig.mockResolvedValue({ data: [] });
    mocks.getHotSearches.mockResolvedValue({ data: [] });
    mocks.searchByType.mockReset().mockResolvedValue({ data: [{ entityType: 'feed', id: '1' }] });
    const { wrapper, router } = mountSearch();
    try {
      await router.push({ path: '/search', query: { q: '伪回锁', tab: 'all' } });
      await flushPromises();
      await wrapper.findAll('.search-feed-sort .filter-btn')[2].trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({ tab: 'all', sort: 'hot' });
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ searchType: 'feed', sort: 'hot' });
      await wrapper.findAll('.search-feed-sort .filter-btn')[0].trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query.sort).toBeUndefined();
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ searchType: 'all' });
    } finally { wrapper.unmount(); localStorage.clear(); }
  });

  it('切换页签时保留输入框里已输入但未提交的关键词', async () => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getTabConfig.mockResolvedValue({ data: [] });
    mocks.getHotSearches.mockResolvedValue({ data: [] });
    mocks.searchByType.mockReset().mockResolvedValue({ data: [{ entityType: 'feed', id: '1' }] });
    const { wrapper, router } = mountSearch();
    try {
      await router.push({ path: '/search', query: { q: '旧关键词', tab: 'all' } });
      await flushPromises();
      await wrapper.get('.search-field').setValue('新关键词');
      const feedTab = wrapper.findAll('.search-tab-item').find((tab) => tab.text() === '动态');
      await feedTab!.trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({ q: '新关键词', tab: 'feed' });
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ searchType: 'feed', query: '新关键词' });
      expect((wrapper.get('.search-field').element as HTMLInputElement).value).toBe('新关键词');
    } finally { wrapper.unmount(); localStorage.clear(); }
  });

  it('切回已加载过的页签复用结果，不重复请求', async () => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getTabConfig.mockResolvedValue({ data: [] });
    mocks.getHotSearches.mockResolvedValue({ data: [] });
    mocks.searchByType.mockReset().mockImplementation((request: any) => Promise.resolve({
      data: [{ id: request.searchType === 'apk' ? 'apk-1' : 'all-1', entityType: request.searchType === 'apk' ? 'apk' : 'topic', title: request.searchType }],
    }));
    const { wrapper, router } = mountSearch();
    try {
      await router.push({ path: '/search', query: { q: '缓存', tab: 'all' } });
      await flushPromises();
      const allRequests = () => mocks.searchByType.mock.calls.filter(([request]) => request.searchType === 'all').length;
      expect(allRequests()).toBe(1);
      const apkTab = wrapper.findAll('.search-tab-item').find((tab) => tab.text() === '应用');
      await apkTab!.trigger('click');
      await flushPromises();
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ searchType: 'apk' });
      const allTab = wrapper.findAll('.search-tab-item').find((tab) => tab.text() === '综合');
      await allTab!.trigger('click');
      await flushPromises();
      expect(allRequests()).toBe(1);
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
    } finally { wrapper.unmount(); localStorage.clear(); }
  });
});

describe('综合搜索相关用户分组', () => {
  function mountSearch() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/search', component: SearchPage }] });
    const wrapper = mount(SearchPage, { global: { plugins: [createPinia(), router], stubs: { SearchResultItem: true, SearchHotListCard: true, LoadingState: true, EmptyState: true } } });
    return { wrapper, router };
  }

  it('相关用户默认折叠，展开状态持久化', async () => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getTabConfig.mockResolvedValue({ data: [] });
    mocks.getHotSearches.mockResolvedValue({ data: [] });
    mocks.searchByType.mockResolvedValue({ data: [
      { entityType: 'user', uid: '11', username: '小米用户' },
      { entityType: 'feed', id: 'f1', message: '小米帖子' },
    ] });
    const { wrapper, router } = mountSearch();
    try {
      await router.push({ path: '/search', query: { q: '小米', tab: 'all' } });
      await flushPromises();
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      const toggle = wrapper.get('.search-user-group-toggle');
      expect(toggle.text()).toContain('相关用户');
      expect(toggle.text()).toContain('1');
      expect(toggle.attributes('aria-expanded')).toBe('false');
      await toggle.trigger('click');
      await flushPromises();
      expect(wrapper.find('.search-user-group-list').exists()).toBe(true);
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(2);
      expect(wrapper.get('.search-user-group-toggle').attributes('aria-expanded')).toBe('true');
      expect(localStorage.getItem('coolapk-desktop-search-users-collapsed')).toBe('0');
    } finally { wrapper.unmount(); }

    const { wrapper: second, router: secondRouter } = mountSearch();
    try {
      await secondRouter.push({ path: '/search', query: { q: '小米', tab: 'all' } });
      await flushPromises();
      expect(second.find('.search-user-group-list').exists()).toBe(true);
      expect(second.findAll('search-result-item-stub')).toHaveLength(2);
    } finally { second.unmount(); localStorage.clear(); }
  });

  it('没有用户结果或其他页签不显示分组', async () => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getTabConfig.mockResolvedValue({ data: [] });
    mocks.getHotSearches.mockResolvedValue({ data: [] });
    mocks.searchByType.mockResolvedValue({ data: [{ entityType: 'feed', id: 'f1', message: '小米帖子' }] });
    const { wrapper, router } = mountSearch();
    try {
      await router.push({ path: '/search', query: { q: '小米', tab: 'all' } });
      await flushPromises();
      expect(wrapper.find('.search-user-group-toggle').exists()).toBe(false);
      mocks.searchByType.mockReset()
        .mockResolvedValueOnce({ data: [{ entityType: 'user', uid: '11', username: '小米用户' }] })
        .mockResolvedValue({ data: [], noMore: true });
      await router.push({ path: '/search', query: { q: '小米', tab: 'user' } });
      await flushPromises();
      expect(wrapper.find('.search-user-group-toggle').exists()).toBe(false);
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      expect(mocks.searchByType.mock.calls.map(([request]) => request.page)).toEqual([1]);
    } finally { wrapper.unmount(); }
  });
  it('收起后首屏只有用户时自动补一页，避免整屏空白', async () => {
    localStorage.clear();
    localStorage.setItem('coolapk-desktop-search-users-collapsed', '0');
    vi.clearAllMocks();
    mocks.getTabConfig.mockResolvedValue({ data: [] });
    mocks.getHotSearches.mockResolvedValue({ data: [] });
    mocks.searchByType.mockReset();
    mocks.searchByType
      .mockResolvedValueOnce({ data: [{ entityType: 'user', uid: '11', username: '阿杰' }], firstItem: 'f', lastItem: 'l' })
      .mockResolvedValueOnce({ data: [{ entityType: 'feed', id: 'f2', message: '阿杰的帖子' }] });
    const { wrapper, router } = mountSearch();
    try {
      await router.push({ path: '/search', query: { q: '阿杰', tab: 'all' } });
      await flushPromises();
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      await wrapper.get('.search-user-group-toggle').trigger('click');
      await flushPromises();
      expect(mocks.searchByType.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);
      expect(wrapper.findAll('search-result-item-stub')).toHaveLength(1);
      expect((wrapper.findComponent({ name: 'SearchResultItem' }).props('entity') as { id: string }).id).toBe('f2');
      expect(mocks.searchByType.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2, firstItem: 'f', lastItem: 'l' });
    } finally { wrapper.unmount(); localStorage.clear(); }
  });
});
