import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../stores/settings';
import { useAppStore } from '../../stores/app';
import { useAuthStore } from '../../stores/auth';

const mocks = vi.hoisted(() => ({
  getTopicDetail: vi.fn(),
  getTopicDetailV7: vi.fn(),
  getTopicFeeds: vi.fn(),
  getDeviceFeedList: vi.fn(),
  getTopicTabData: vi.fn(),
  followTag: vi.fn(),
  unfollowTag: vi.fn(),
  searchByType: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));

import TopicPage from '../TopicPage.vue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('话题发布快捷入口', () => {
  async function mountTopic(detail: Record<string, unknown>) {
    const pinia = createPinia();
    mocks.getTopicDetail.mockResolvedValue({ data: { id: 67, title: '摄影', ...detail } });
    mocks.getTopicDetailV7.mockResolvedValue({ data: {} });
    mocks.getTopicFeeds.mockResolvedValue({ code: 200, data: [] });
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/topic/:tag', component: TopicPage },
      { path: '/external', component: { template: '<div />' } },
    ] });
    await router.push('/topic/摄影');
    const wrapper = mount(TopicPage, { global: { plugins: [pinia, router], stubs: { teleport: true, AppImage: true, LoadingState: true, EmptyState: true } } });
    await flushPromises();
    return { wrapper, router, app: useAppStore(pinia), auth: useAuthStore(pinia) };
  }

  it.each([
    { width: 390, selector: '.topic-publish-fab', choice: 0, mode: 'feed', tagType: 0, type: 'tag' },
    { width: 1280, selector: '.topic-publish-inline', choice: 1, mode: 'article', tagType: 1, type: 'phone' },
  ])('在 $width px 打开 $mode 并关联当前话题', async ({ width, selector, choice, mode, tagType, type }) => {
    const previousWidth = window.innerWidth;
    window.innerWidth = width;
    const { wrapper, app, auth } = await mountTopic({ tagType });
    try {
      auth.isLoggedIn = true;
      await wrapper.get(selector).trigger('click');
      const options = wrapper.findAll('.topic-publish-options button');
      expect(options.map(button => button.text())).toEqual(['动态', '图文']);
      await options[choice].trigger('click');
      expect(app.isPublishOpen).toBe(true);
      expect(app.publishTopicContext).toMatchObject({ mode, target: { type, id: '67', title: '摄影' } });
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    } finally { wrapper.unmount(); window.innerWidth = previousWidth; }
  });

  it('发布受限时打开官方申请说明', async () => {
    const { wrapper, router, app } = await mountTopic({ publish_limit: 1 });
    try {
      await wrapper.get('.topic-actions button').trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.path).toBe('/external');
      const url = new URL(String(router.currentRoute.value.query.url));
      expect(url.origin + url.pathname).toBe('https://m.coolapk.com/mp/tag/PublishApplyTips');
      expect(url.searchParams.get('title')).toBe('摄影');
      expect(app.isPublishOpen).toBe(false);
    } finally { wrapper.unmount(); }
  });
});

describe('话题排序按钮', () => {
  it('点评排序卡片只呈现为顶部按钮，保留我的打分和真实点评', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    mocks.getTopicDetail.mockResolvedValue({ data: { title: 'iOS27', selectedTab: 'rating', tabList: [
      { pageName: 'feed', title: '讨论' },
      { pageName: 'rating', title: '点评', url: '#/topic/tagFeedList?type=rating&id=76' },
    ] } });
    mocks.getTopicDetailV7.mockResolvedValue({ data: {} });
    const options = [
      { title: '默认', url: '#/topic/tagFeedList?type=rating&id=76' },
      { title: '最新', url: '#/topic/tagFeedList?type=rating&id=76&listType=dateline_desc' },
      { title: '热度', url: '#/topic/tagFeedList?type=rating&id=76&listType=popular' },
    ];
    mocks.getTopicTabData.mockReset().mockResolvedValue({ code: 200, sortOptions: options, data: [
      { entityType: 'singleRatingCard', title: '我的打分' },
      { entityType: 'card', entities: [{ entityTemplate: 'sortSelectCard', entities: options }] },
      { entity_type: 'sortSelectCard', entities: options },
      // 原生端实际会把排序卡片展开为独立页面条目，丢失 sortSelectCard 类型。
      ...options.map(option => ({ entityType: 'page', ...option })),
      { entityType: 'feed', id: 'review', ...options[0], message: '真实点评' },
      { entityType: 'page', title: '最新', url: '/other-page' },
    ] });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/topic/:tag', component: TopicPage }] });
    await router.push('/topic/iOS27');
    const wrapper = mount(TopicPage, { global: { plugins: [pinia, router], stubs: {
      FeedCard: { props: ['feed'], template: '<div class="feed-card-stub">{{ feed.message }}</div>' },
      DiscoveryEntityCard: { props: ['entity'], template: '<div class="entity-card-stub">{{ entity.title }}</div>' },
      TopicMyRatingCard: { template: '<button class="my-rating-card-stub">我的打分</button>' },
      AppImage: true, LoadingState: true, EmptyState: true,
    } } });
    await flushPromises();
    expect(wrapper.findAll('.topic-rating-toolbar button').map(button => button.text())).toEqual(['默认', '最新', '热度']);
    expect(wrapper.find('.my-rating-card-stub').exists()).toBe(true);
    expect(wrapper.findAll('.entity-card-stub').map(card => card.text())).toEqual(['最新']);
    expect(wrapper.find('.feed-card-stub').text()).toBe('真实点评');
    await wrapper.findAll('.topic-rating-toolbar button')[1].trigger('click');
    await flushPromises();
    expect(mocks.getTopicTabData).toHaveBeenLastCalledWith(expect.objectContaining({ url: '#/topic/tagFeedList?type=rating&id=76&listType=dateline_desc' }));
    expect(wrapper.findAll('.entity-card-stub')).toHaveLength(1);
    wrapper.unmount();
  });

  it('有评分的话题显示官方详情入口，切换评分不请求普通动态', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    mocks.getTopicDetail.mockResolvedValue({ data: { id: 76, title: 'iOS27', open_rate: 1, star_average_score: 8.8,
      tabList: [{ pageName: 'feed', title: '讨论' }] } });
    mocks.getTopicDetailV7.mockResolvedValue({ data: {} });
    mocks.getTopicFeeds.mockReset().mockResolvedValue({ code: 200, data: [] });
    mocks.getTopicTabData.mockReset();
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/topic/:tag', component: TopicPage }] });
    await router.push('/topic/iOS27');
    const wrapper = mount(TopicPage, { global: { plugins: [pinia, router], stubs: {
      TopicRatingPanel: { props: ['detail'], template: '<div class="rating-panel-stub">{{ detail.id }}</div>' },
      AppImage: true, FeedCard: true, LoadingState: true, EmptyState: true,
    } } });
    await flushPromises();
    expect(wrapper.find('.topic-official-summary').text()).toContain('8.8');
    await wrapper.find('.topic-official-summary header button').trigger('click'); await flushPromises();
    expect(wrapper.find('.rating-panel-stub').text()).toBe('76');
    expect(wrapper.find('.topic-header-card').exists()).toBe(false);
    expect(mocks.getTopicFeeds).toHaveBeenCalledTimes(1);
    expect(mocks.getTopicTabData).not.toHaveBeenCalled();
    await router.push('/topic/iOS27'); await flushPromises();
    expect(wrapper.find('.topic-header-card').exists()).toBe(true);
    expect(wrapper.find('.rating-panel-stub').exists()).toBe(false);
    wrapper.unmount();
  });
  it('首次列表请求未完成时切换排序仍会加载新排序并丢弃旧响应', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useSettingsStore(pinia).settings.topicDiscussionDefaultSortMode = 'default';
    const firstRequest = deferred<any>();
    const sortedRequest = deferred<any>();
    const hotRequest = deferred<any>();
    mocks.getTopicDetail.mockResolvedValue({
      data: {
        title: '今日热点',
        tabList: [
          { pageName: 'feed', title: '讨论' },
          { pageName: 'news', title: '快讯' },
        ],
        selectedTab: 'feed',
      },
    });
    mocks.getTopicDetailV7.mockResolvedValue({ data: {} });
    mocks.getTopicFeeds.mockReset();
    mocks.getTopicFeeds
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(sortedRequest.promise)
      .mockReturnValueOnce(hotRequest.promise);

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/topic/:tag', component: TopicPage }],
    });
    await router.push('/topic/今日热点');
    await router.isReady();
    const wrapper = mount(TopicPage, {
      global: {
        plugins: [pinia, router],
        stubs: {
          FeedCard: { props: ['feed'], template: '<div class="feed-card-stub">{{ feed.id }}</div>' },
          DiscoveryEntityCard: { props: ['entity'], template: '<div class="entity-card-stub">{{ entity.id }}</div>' },
          AppImage: true,
          LoadingState: { props: ['text'], template: '<div class="loading-state-stub">{{ text }}</div>' },
          EmptyState: { props: ['title'], template: '<div class="empty-state-stub">{{ title }}</div>' },
        },
      },
    });

    await flushPromises();
    expect(mocks.getTopicFeeds).toHaveBeenCalledTimes(1);
    await wrapper.findAll('.filter-btn')[1].trigger('click');
    expect(mocks.getTopicFeeds).toHaveBeenCalledTimes(2);
    expect(mocks.getTopicFeeds.mock.calls[1][2]).toMatchObject({ listType: 'dateline_desc' });

    firstRequest.resolve({ code: 200, data: [{ id: 'default', message: '默认排序' }] });
    await flushPromises();
    expect(wrapper.find('.feed-card-stub').exists()).toBe(false);

    sortedRequest.resolve({ code: 200, data: [{ id: 'latest', message: '最新排序' }] });
    await flushPromises();
    expect(wrapper.find('.feed-card-stub').text()).toBe('latest');
    expect(wrapper.findAll('.filter-btn')[1].attributes('aria-pressed')).toBe('true');

    await wrapper.findAll('.filter-btn')[2].trigger('click');
    expect(mocks.getTopicFeeds).toHaveBeenCalledTimes(3);
    expect(mocks.getTopicFeeds.mock.calls[2][2]).toMatchObject({ listType: 'popular' });
    hotRequest.resolve({ code: 200, data: [{ id: 'hot', message: '热度排序' }] });
    await flushPromises();
    expect(wrapper.find('.feed-card-stub').text()).toBe('hot');
    expect(wrapper.findAll('.filter-btn')[2].attributes('aria-pressed')).toBe('true');
  });

  it('搜索按钮位于栏目右侧且在话题页内按 APK 参数搜索', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useSettingsStore(pinia).settings.topicDiscussionDefaultSortMode = 'default';
    mocks.getTopicDetail.mockResolvedValue({
      data: {
        title: '数码',
        tabList: [{ pageName: 'feed', title: '讨论' }],
        selectedTab: 'feed',
      },
    });
    mocks.getTopicDetailV7.mockResolvedValue({ data: {} });
    mocks.getTopicFeeds.mockReset();
    mocks.getTopicFeeds.mockResolvedValue({ code: 200, data: [] });
    mocks.searchByType.mockReset();
    mocks.searchByType.mockResolvedValue({ code: 200, data: [] });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/topic/:tag', component: TopicPage },
        { path: '/search', component: { template: '<div>Search</div>' } },
      ],
    });
    await router.push('/topic/数码');
    await router.isReady();
    const wrapper = mount(TopicPage, {
      global: {
        plugins: [pinia, router],
        stubs: {
          FeedCard: true,
          DiscoveryEntityCard: true,
          AppImage: true,
          LoadingState: true,
          EmptyState: true,
        },
      },
    });

    await flushPromises();
    // 顶部导航条已移除（避免与话题概况卡片标题重复）
    expect(wrapper.find('.top-nav-bar').exists()).toBe(false);

    // 栏目/筛选条中存在通用 EntityFilterBar 搜索输入框和放大镜图标
    const searchInput = wrapper.find('.entity-filter-bar .filter-search-input');
    const searchIcon = wrapper.find('.entity-filter-bar .filter-search-icon');
    expect(searchInput.exists()).toBe(true);
    expect(searchIcon.exists()).toBe(true);

    // 输入关键词并回车搜索
    await searchInput.setValue('镜头');
    await searchInput.trigger('keydown.enter');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/topic/数码');
    expect(mocks.searchByType).toHaveBeenCalledWith(expect.objectContaining({
      searchType: 'feed',
      query: '镜头',
      pageType: 'tag',
      pageParam: '数码',
      feedType: 'all',
      sort: 'none',
      isStrict: 0,
    }));

    await wrapper.find('.filter-type-trigger').trigger('click');
    const commentOption = wrapper.findAll('.filter-type-option').find((option) => option.text() === '评论');
    expect(commentOption).toBeDefined();
    await commentOption!.trigger('click');
    await flushPromises();
    expect(mocks.searchByType).toHaveBeenLastCalledWith(expect.objectContaining({
      feedType: 'comment',
      sort: 'none',
    }));

    await wrapper.findAll('.filter-btn')[1].trigger('click');
    await flushPromises();
    expect(mocks.searchByType).toHaveBeenLastCalledWith(expect.objectContaining({
      feedType: 'comment',
      sort: 'dateline',
      isStrict: 0,
    }));
  });

  it('机型列表标签按 APK 下发的 product/tagProductList 页面请求机型实体', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    mocks.getTopicDetail.mockResolvedValue({
      data: {
        title: 'LCD永不为奴',
        tabList: [
          { pageName: 'lastupdate_desc', title: '讨论', url: '#/topic/tagFeedList?type=feed&id=30087' },
          { pageName: 'Top', title: '机型列表', url: '/product/tagProductList?product_tag=LCD&category_id=1000' },
        ],
      },
    });
    mocks.getTopicDetailV7.mockResolvedValue({ data: {} });
    mocks.getTopicFeeds.mockReset().mockResolvedValue({ code: 200, data: [] });
    mocks.getDeviceFeedList.mockReset().mockResolvedValue({ code: 200, data: [{ id: 'wrong-device-feed', message: '不应显示' }] });
    mocks.getTopicTabData.mockReset().mockResolvedValue({ code: 200, data: [{ entityType: 'product', id: 5085, title: 'moto g100' }] });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/topic/:tag', component: TopicPage }],
    });
    await router.push('/topic/LCD永不为奴');
    await router.isReady();
    const wrapper = mount(TopicPage, {
      global: {
        plugins: [pinia, router],
        stubs: {
          FeedCard: { props: ['feed'], template: '<div class="feed-card-stub">{{ feed.id }}</div>' },
          DiscoveryEntityCard: { props: ['entity'], template: '<div class="entity-card-stub">{{ entity.title }}</div>' },
          AppImage: true,
          LoadingState: { props: ['text'], template: '<div class="loading-state-stub">{{ text }}</div>' },
          EmptyState: { props: ['title'], template: '<div class="empty-state-stub">{{ title }}</div>' },
        },
      },
    });

    await flushPromises();
    await wrapper.findAll('.topic-tab-item')[1].trigger('click');
    await flushPromises();
    expect(mocks.getDeviceFeedList).not.toHaveBeenCalled();
    expect(mocks.getTopicTabData).toHaveBeenCalledWith(expect.objectContaining({
      url: '#/product/tagProductList?product_tag=LCD&category_id=1000',
      title: '机型列表',
    }));
    expect(wrapper.find('.entity-card-stub').text()).toBe('moto g100');
    wrapper.unmount();
  });
});
