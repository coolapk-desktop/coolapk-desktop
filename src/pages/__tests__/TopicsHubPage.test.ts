import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import TopicsHubPage from '../TopicsHubPage.vue';
import { useSettingsStore } from '../../stores/settings';
import { useTopicHubStore } from '../../stores/topicHub';

const mocks = vi.hoisted(() => ({
  getTopicHubData: vi.fn(),
  getTopicDetail: vi.fn(),
  getTopicDetailV7: vi.fn(),
  getTopicFeeds: vi.fn(),
  searchByType: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));

describe('TopicsHubPage 三栏/双栏/单栏响应式与过渡', () => {
  it.each([[400, 'mobile'], [767, 'mobile'], [768, 'card'], [1200, 'card']])('目录在 %s 像素使用 %s 布局，桌面保留网格卡片', async (width, mode) => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    mocks.getTopicHubData.mockResolvedValue({ data: [{ id: '1', entityType: 'topic', title: '今日热点', follower_num: 57000, commentnum: 132000, hot_num: 1897000 }] });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/topics', component: TopicsHubPage }] });
    await router.push('/topics');
    const wrapper = mount(TopicsHubPage, { global: { plugins: [router], stubs: { AppImage: true, TopicPage: true, TopicFeedCommentAside: true } } });
    try {
      await flushPromises();
      expect(wrapper.get('.topics-grid .topic-card').classes()).toContain(`mode-${mode}`);
      expect(wrapper.find('.topic-stats .fa-fire-flame-curved').exists()).toBe(mode === 'mobile');
      expect(wrapper.text()).toContain('今日热点');
    } finally { wrapper.unmount(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); }
  });
  it.each([390, 1280])('宽度 %s 下标题条与吸顶导航合并玻璃，回到话题头部后恢复', async (width) => {
    const previousWidth = window.innerWidth;
    const previousCollapsed = localStorage.getItem('coolapk_topic_hub_left_collapsed');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    localStorage.setItem('coolapk_topic_hub_left_collapsed', '1');
    mocks.getTopicHubData.mockResolvedValue({ data: [] });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/topics', component: TopicsHubPage }] });
    await router.push('/topics?tag=今日热点');
    const wrapper = mount(TopicsHubPage, { global: { plugins: [router], stubs: { TopicPage: { template: '<div class="page-container"><div class="topic-sticky-controls">讨论</div></div>' }, AppImage: true, TopicFeedCommentAside: true } } });
    try {
      await flushPromises();
      vi.spyOn(wrapper.get('.single-column-top-nav').element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, 48));
      let top = 48;
      vi.spyOn(wrapper.get('.topic-sticky-controls').element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, top, width, 104));
      await wrapper.get('.page-container').trigger('scroll');
      expect(wrapper.get('.split-center-main').classes()).toContain('topic-glass-joined');
      top = 200;
      await wrapper.get('.page-container').trigger('scroll');
      expect(wrapper.get('.split-center-main').classes()).not.toContain('topic-glass-joined');
    } finally {
      wrapper.unmount(); vi.restoreAllMocks(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
      if (previousCollapsed === null) localStorage.removeItem('coolapk_topic_hub_left_collapsed'); else localStorage.setItem('coolapk_topic_hub_left_collapsed', previousCollapsed);
    }
  });

  it('切到私信再返回保留话题实例、内容和滚动位置，不重新请求', async () => {
    mocks.getTopicHubData.mockResolvedValue({ data: [] });
    mocks.getTopicDetail.mockResolvedValue({ data: { title: '今日热点', tabList: [{ pageName: 'feed', title: '讨论' }] } });
    mocks.getTopicDetailV7.mockResolvedValue({ data: null });
    mocks.getTopicFeeds.mockResolvedValue({ data: [{ id: 'feed-keep', entityType: 'feed', message: '保留的话题动态', uid: '123', username: '酷友' }] });
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/topics', component: TopicsHubPage },
      { path: '/messages', component: { template: '<div class="messages-stub">私信</div>' } },
    ] });
    const host = defineComponent({ template: '<router-view v-slot="{ Component, route }"><keep-alive><component :is="Component" :key="route.path" /></keep-alive></router-view>' });
    await router.push('/topics?tag=今日热点');
    const wrapper = mount(host, { global: { plugins: [router], stubs: { FeedCard: { props: ['feed'], template: '<article>{{ feed.message }}</article>' }, AppImage: true, AppAvatar: true, TopicFeedCommentAside: true } } });
    try {
      await flushPromises();
      const topic = wrapper.findComponent({ name: 'TopicPage' });
      expect(topic.exists()).toBe(true);
      const scroll = topic.get('.page-container').element as HTMLElement;
      Object.defineProperties(scroll, { clientHeight: { value: 600 }, scrollHeight: { value: 4000 } });
      scroll.scrollTop = 180;
      await topic.get('.page-container').trigger('scroll');
      const requestCount = mocks.getTopicFeeds.mock.calls.length;
      const headerCount = mocks.getTopicDetail.mock.calls.length;
      expect(requestCount).toBe(1);
      expect(topic.text()).toContain('保留的话题动态');
      await router.push('/messages');
      await flushPromises();
      expect(wrapper.text()).toBe('私信');
      expect(useTopicHubStore().activeTopicTag).toBe('今日热点');
      await router.push('/topics?tag=今日热点');
      await flushPromises();
      const restored = wrapper.findComponent({ name: 'TopicPage' });
      expect(restored.get('.page-container').element).toBe(scroll);
      expect(restored.text()).toContain('保留的话题动态');
      expect((restored.get('.page-container').element as HTMLElement).scrollTop).toBe(180);
      expect(mocks.getTopicFeeds).toHaveBeenCalledTimes(requestCount);
      expect(mocks.getTopicDetail).toHaveBeenCalledTimes(headerCount);
      // 在话题页内明确返回目录时，仍正常退出分屏。
      await router.push('/topics');
      await flushPromises();
      expect(useTopicHubStore().viewMode).toBe('grid');
    } finally { wrapper.unmount(); }
  });

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    mocks.getTopicHubData.mockReset();
    mocks.getTopicDetail.mockReset();
    mocks.getTopicFeeds.mockReset();
  });

  it('初始加载显示大网格与分类 tabs，点击卡片切换至分屏模式', async () => {
    mocks.getTopicHubData.mockResolvedValue({
      tabs: [
        { title: '值得买', url: '/page?url=BUY' },
        { title: '摄影', url: '/page?url=PHOTO' },
      ],
      data: [
        { id: 't1', title: '好物安利', follower_num: 106000, logo: 'https://example.com/logo1.png' },
        { id: 't2', title: '小风扇', follower_num: 3200, logo: 'https://example.com/logo2.png' },
      ],
    });

    mocks.getTopicDetail.mockResolvedValue({
      data: {
        title: '好物安利',
        tabList: [{ pageName: 'feed', title: '讨论' }],
      },
    });

    mocks.getTopicFeeds.mockResolvedValue({
      data: [
        { id: 'feed-101', message: '夏日小风扇评测', username: '酷友小明', replynum: 5 },
      ],
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/topics', component: TopicsHubPage }],
    });
    await router.push('/topics');
    await router.isReady();

    const wrapper = mount(TopicsHubPage, {
      global: {
        plugins: [router],
        stubs: {
          TopicPage: {
            props: ['tagParam', 'embedded', 'activeFeedId'],
            template: '<div class="topic-page-stub">{{ tagParam }}</div>',
          },
          TopicFeedCommentAside: {
            props: ['feed'],
            template: '<div class="topic-feed-comment-aside-stub"></div>',
          },
          FeedCommentSection: true,
          LoadingState: true,
          EmptyState: true,
          AppImage: true,
        },
      },
    });

    await flushPromises();

    // 验证分类 tabs
    const tabs = wrapper.findAll('.cat-tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0].text()).toBe('值得买');

    // 验证网格卡片
    const cards = wrapper.findAll('.topic-card');
    expect(cards.length).toBe(2);

    const store = useTopicHubStore();
    expect(store.viewMode).toBe('grid');

    // 点击第一个话题卡片进入分屏模式
    await cards[0].trigger('click');
    await flushPromises();

    expect(store.viewMode).toBe('split');
    expect(store.activeTopicTag).toBe('好物安利');

    // 验证左侧栏与中间栏存在
    expect(wrapper.find('.split-left-sidebar').exists()).toBe(true);
    expect(wrapper.find('.split-center-main').exists()).toBe(true);

    // 点击返回大网格
    await wrapper.find('.btn-back-grid').trigger('click');
    expect(store.viewMode).toBe('grid');
    wrapper.unmount();
  });

  it('总开关关闭时点击动态也不显示右栏，重新开启后允许临时收起和展开', async () => {
    const previousInnerWidth = window.innerWidth;
    const previousRightWidth = localStorage.getItem('coolapk_topic_hub_right_width');
    useSettingsStore().settings.desktopCommentsOnRight = false;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    mocks.getTopicHubData.mockResolvedValue({ tabs: [], data: [{ id: 't1', title: '小米13Pro', follower_num: 3200 }] });
    let mountedWrapper: ReturnType<typeof mount> | null = null;

    try {
      const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/topics', component: TopicsHubPage }] });
      await router.push('/topics');
      await router.isReady();
      const wrapper = mountedWrapper = mount(TopicsHubPage, {
        global: {
          plugins: [router],
          stubs: {
            TopicPage: { name: 'TopicPage', props: ['tagParam', 'embedded', 'activeFeedId', 'disableInlineComments'], template: '<div class="topic-page-stub">{{ tagParam }}</div>' },
            TopicFeedCommentAside: { name: 'TopicFeedCommentAside', props: ['feed'], template: '<div class="topic-feed-comment-aside-stub"></div>' },
            LoadingState: true,
            EmptyState: true,
            AppImage: true,
          },
        },
      });

      await flushPromises();
      const pageRoot = wrapper.find('.topics-page').element as HTMLElement;
      Object.defineProperty(pageRoot, 'clientWidth', { configurable: true, value: 1230 });
      window.dispatchEvent(new Event('resize'));
      await nextTick();
      await wrapper.find('.topic-card').trigger('click');
      await flushPromises();

      expect(wrapper.find('.split-right-wrapper').exists()).toBe(false);
      expect(wrapper.find('.floating-expand-aside-btn').exists()).toBe(false);
      const topicPage = wrapper.findComponent({ name: 'TopicPage' });
      expect(topicPage.props('disableInlineComments')).toBe(false);
      topicPage.vm.$emit('select-feed', { id: 'selected', message: '正文' });
      await nextTick();
      expect(wrapper.find('.split-right-wrapper').exists()).toBe(false);
      useSettingsStore().settings.desktopCommentsOnRight = true;
      await nextTick();
      expect(wrapper.find('.split-right-wrapper').exists()).toBe(true);
      wrapper.findComponent({ name: 'TopicFeedCommentAside' }).vm.$emit('close');
      await nextTick();
      expect(wrapper.find('.split-right-wrapper').exists()).toBe(false);
      await wrapper.find('.floating-expand-aside-btn').trigger('click');
      expect(wrapper.find('.split-right-wrapper').exists()).toBe(true);
      useSettingsStore().settings.desktopCommentsOnRight = false;
      await nextTick();
      expect(wrapper.find('.split-right-wrapper').exists()).toBe(false);
      expect(wrapper.find('.floating-expand-aside-btn').exists()).toBe(false);
    } finally {
      mountedWrapper?.unmount();
      if (previousRightWidth === null) localStorage.removeItem('coolapk_topic_hub_right_width');
      else localStorage.setItem('coolapk_topic_hub_right_width', previousRightWidth);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousInnerWidth });
    }
  });

  it('右栏宽度超过可用空间时自动收缩，避免评论被窗口裁切', async () => {
    const previousInnerWidth = window.innerWidth;
    const previousRightWidth = localStorage.getItem('coolapk_topic_hub_right_width');
    // 此用例验证开启右侧评论后的宽度适配，不能依赖默认关闭的设置。
    useSettingsStore().settings.desktopCommentsOnRight = true;
    localStorage.setItem('coolapk_topic_hub_right_width', '640');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    let mountedWrapper: ReturnType<typeof mount> | null = null;

    mocks.getTopicHubData.mockResolvedValue({
      tabs: [],
      data: [{ id: 't1', title: '好物安利', follower_num: 106000 }],
    });
    mocks.getTopicDetail.mockResolvedValue({
      data: { title: '好物安利', tabList: [{ pageName: 'feed', title: '讨论' }] },
    });
    mocks.getTopicFeeds.mockResolvedValue({
      data: [{ id: 'feed-101', message: '动态', username: '酷友小明', replynum: 5 }],
    });

    try {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/topics', component: TopicsHubPage }],
      });
      await router.push('/topics');
      await router.isReady();

      const wrapper = mountedWrapper = mount(TopicsHubPage, {
        global: {
          plugins: [router],
          stubs: {
            TopicPage: {
              props: ['tagParam', 'embedded', 'activeFeedId', 'disableInlineComments'],
              template: '<div class="topic-page-stub" :data-disable-inline-comments="disableInlineComments"></div>',
            },
            TopicFeedCommentAside: {
              props: ['feed'],
              template: '<div class="topic-feed-comment-aside-stub"></div>',
            },
            FeedCommentSection: true,
            LoadingState: true,
            EmptyState: true,
            AppImage: true,
          },
        },
      });

      await flushPromises();
      const pageRoot = wrapper.find('.topics-page').element as HTMLElement;
      Object.defineProperty(pageRoot, 'clientWidth', { configurable: true, value: 1230 });
      window.dispatchEvent(new Event('resize'));
      await nextTick();

      await wrapper.find('.topic-card').trigger('click');
      await flushPromises();

      expect(wrapper.find('.split-right-wrapper').exists()).toBe(true);
      expect(wrapper.find('.split-right-wrapper').attributes('style')).toContain('width: 450px');
      expect(wrapper.find('.topic-page-stub').attributes('data-disable-inline-comments')).toBe('true');

      Object.defineProperty(pageRoot, 'clientWidth', { configurable: true, value: 1000 });
      window.dispatchEvent(new Event('resize'));
      await nextTick();

      expect(wrapper.find('.split-right-wrapper').exists()).toBe(false);
      expect(wrapper.find('.topic-page-stub').attributes('data-disable-inline-comments')).toBe('false');
    } finally {
      mountedWrapper?.unmount();
      if (previousRightWidth === null) {
        localStorage.removeItem('coolapk_topic_hub_right_width');
      } else {
        localStorage.setItem('coolapk_topic_hub_right_width', previousRightWidth);
      }
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousInnerWidth });
    }
  });
});
