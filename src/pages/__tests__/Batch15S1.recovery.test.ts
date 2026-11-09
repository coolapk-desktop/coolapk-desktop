import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  routeParams: {} as Record<string, string>,
  getIndexV8FeedsPaged: vi.fn(),
  getEditorChoiceFeeds: vi.fn(),
  getEventList: vi.fn(),
  getEventDetail: vi.fn(),
  getBoardFeeds: vi.fn(),
  getDiscoveryConfig: vi.fn(),
  getDiscoveryPageData: vi.fn(),
  getLiveDetail: vi.fn(),
  getDyhDetail: vi.fn(),
  getDyhFeeds: vi.fn(),
  searchByType: vi.fn(),
  followDyh: vi.fn(),
  unfollowDyh: vi.fn(),
  getMyDyhFollowList: vi.fn(),
  getMyDyhSubscribeList: vi.fn(),
  getMyDyhEditorList: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useRoute: () => ({ path: '/test', params: mocks.routeParams, query: {} }),
    useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  };
});

vi.mock('../../router', () => ({ router: { push: mocks.push, replace: mocks.replace } }));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getIndexV8FeedsPaged: mocks.getIndexV8FeedsPaged,
    getEditorChoiceFeeds: mocks.getEditorChoiceFeeds,
    getEventList: mocks.getEventList,
    getEventDetail: mocks.getEventDetail,
    getBoardFeeds: mocks.getBoardFeeds,
    getDiscoveryConfig: mocks.getDiscoveryConfig,
    getDiscoveryPageData: mocks.getDiscoveryPageData,
    getLiveDetail: mocks.getLiveDetail,
    getDyhDetail: mocks.getDyhDetail,
    getDyhFeeds: mocks.getDyhFeeds,
    searchByType: mocks.searchByType,
    followDyh: mocks.followDyh,
    unfollowDyh: mocks.unfollowDyh,
    getMyDyhFollowList: mocks.getMyDyhFollowList,
    getMyDyhSubscribeList: mocks.getMyDyhSubscribeList,
    getMyDyhEditorList: mocks.getMyDyhEditorList,
  },
}));

vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));

function feed(id: number, title: string) {
  return { id, title, message: title, username: '酷友' };
}

const FeedCardStub = {
  props: ['feed', 'highlightKeyword'],
  template: '<div class="feed-card">F{{ feed.id }}</div>',
};
const ErrorStub = {
  props: ['title', 'message'],
  emits: ['retry'],
  template: '<div class="error"><span>{{ title }}</span><button class="error-retry" @click="$emit(\'retry\')">重试</button></div>',
};

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  mocks.routeParams = {};
});

// ---------------- R3-1.1 / R3-1.2 头条页 ----------------
import HeadlinePage from '../HeadlinePage.vue';

function mountHeadline() {
  return mount(HeadlinePage, {
    global: {
      stubs: { FeedCard: FeedCardStub, FeedSkeleton: true, LoadingState: true, EmptyState: true, ErrorState: ErrorStub },
    },
  });
}

describe('HeadlinePage 批次15', () => {
  it('翻页失败显示可见错误与重试按钮；失败后滚动不再自动发请求；重试只重试当前页且不清空列表', async () => {
    mocks.getIndexV8FeedsPaged
      .mockResolvedValueOnce({ data: [feed(1, '第一条'), feed(2, '第二条')] })
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce({ data: [feed(3, '第三条')] });
    const w = mountHeadline();
    await flushPromises();
    expect(w.findAll('.feed-card')).toHaveLength(2);

    // 滚到底触发翻页并失败
    await w.find('.page-container').trigger('scroll');
    await flushPromises();
    expect(w.text()).toContain('加载失败，点击重试');
    expect(w.findAll('.feed-card')).toHaveLength(2);

    // 失败后滚动不再自动重试
    const callsAfterError = mocks.getIndexV8FeedsPaged.mock.calls.length;
    await w.find('.page-container').trigger('scroll');
    await flushPromises();
    expect(mocks.getIndexV8FeedsPaged.mock.calls.length).toBe(callsAfterError);

    // 点击重试：只重试当前页（page 仍为 2），列表不清空
    await w.find('.pagination-footer .retry-inline').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('F1');
    expect(w.text()).toContain('F2');
    expect(mocks.getIndexV8FeedsPaged.mock.calls[callsAfterError][0]).toMatchObject({ page: 2 });
    expect(w.findAll('.feed-card')).toHaveLength(3);
    w.unmount();
  });

  it('翻页在途时切 Tab/刷新，旧 loadMore 响应被丢弃，不污染新列表', async () => {
    mocks.getIndexV8FeedsPaged.mockResolvedValueOnce({ data: [feed(1, '头条一')] });
    let resolveMore!: (v: unknown) => void;
    mocks.getIndexV8FeedsPaged.mockImplementationOnce(() => new Promise((r) => { resolveMore = r; }));
    mocks.getEditorChoiceFeeds.mockResolvedValueOnce({ data: [feed(9, '精选一')] });
    const w = mountHeadline();
    await flushPromises();
    expect(w.text()).toContain('F1');

    await w.find('.page-container').trigger('scroll');
    // 翻页在途时切换到"编辑精选"（触发刷新路径，清空列表）
    await w.findAll('.tab-item')[1].trigger('click');
    await flushPromises();
    expect(w.text()).toContain('F9');

    // 旧翻页响应此时才返回：必须整体丢弃
    resolveMore({ data: [feed(2, '过期头条')] });
    await flushPromises();
    expect(w.text()).toContain('F9');
    expect(w.text()).not.toContain('过期头条');
    expect(w.findAll('.feed-card')).toHaveLength(1);
    w.unmount();
  });
});

// ---------------- R3-1.3 / R3-1.4 活动列表 ----------------
import EventsPage from '../EventsPage.vue';

function mountEvents() {
  return mount(EventsPage, {
    global: { stubs: { AppImage: true, LoadingState: true, EmptyState: true, ErrorState: ErrorStub } },
  });
}

describe('EventsPage 批次15', () => {
  it('翻页失败后点 footer 重试只重试当前页，不清空已有列表；失败后滚动不再自动发请求', async () => {
    mocks.getEventList
      .mockResolvedValueOnce({ data: [{ id: 'e1', title: '活动一' }] })
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce({ data: [{ id: 'e2', title: '活动二' }] });
    const w = mountEvents();
    await flushPromises();
    expect(w.text()).toContain('活动一');

    await w.find('.page-container').trigger('scroll');
    await flushPromises();
    expect(w.text()).toContain('加载失败，点击重试');

    const callsAfterError = mocks.getEventList.mock.calls.length;
    await w.find('.page-container').trigger('scroll');
    await flushPromises();
    expect(mocks.getEventList.mock.calls.length).toBe(callsAfterError);

    await w.find('.pagination-footer .retry-inline').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('活动一');
    expect(w.text()).toContain('活动二');
    expect(mocks.getEventList.mock.calls[callsAfterError][0]).toBe(2);
    w.unmount();
  });
});

// ---------------- R3-1.4 / R3-1.5 活动详情 ----------------
import EventDetailPage from '../EventDetailPage.vue';

function mountEventDetail() {
  mocks.routeParams = { eventId: 'e1' };
  return mount(EventDetailPage, {
    global: {
      stubs: { AppImage: true, FeedCard: FeedCardStub, LoadingState: true, EmptyState: true, ErrorState: ErrorStub },
    },
  });
}

function eventDetailPayload() {
  return { data: { id: 'e1', title: '测试活动', tabList: [{ url: 'board-u1', title: '动态' }] } };
}

describe('EventDetailPage 批次15', () => {
  it('分页失败后滚动不再自动发请求', async () => {
    mocks.getEventDetail.mockResolvedValue(eventDetailPayload());
    mocks.getBoardFeeds
      .mockResolvedValueOnce({ data: [feed(1, '动态一')] })
      .mockRejectedValueOnce(new Error('网络中断'));
    const w = mountEventDetail();
    await flushPromises();
    expect(w.text()).toContain('F1');

    await w.find('.page-container').trigger('scroll');
    await flushPromises();
    expect(w.text()).toContain('加载失败，点击重试');

    const calls = mocks.getBoardFeeds.mock.calls.length;
    await w.find('.page-container').trigger('scroll');
    await flushPromises();
    expect(mocks.getBoardFeeds.mock.calls.length).toBe(calls);
    w.unmount();
  });

  it('下拉刷新时详情失败则跳过动态重拉；详情成功才重拉动态', async () => {
    mocks.getEventDetail.mockResolvedValue(eventDetailPayload());
    mocks.getBoardFeeds.mockResolvedValue({ data: [feed(1, '动态一')] });
    const w = mountEventDetail();
    await flushPromises();
    expect(mocks.getBoardFeeds).toHaveBeenCalledTimes(1);

    // 详情请求失败：不得再用旧 tab 重拉动态
    mocks.getEventDetail.mockRejectedValueOnce(new Error('网络中断'));
    await (w.vm as any).refreshMobilePage();
    await flushPromises();
    expect(w.text()).toContain('加载失败');
    expect(mocks.getBoardFeeds).toHaveBeenCalledTimes(1);

    // 详情成功：恢复后重拉一次动态
    mocks.getEventDetail.mockResolvedValue(eventDetailPayload());
    await (w.vm as any).refreshMobilePage();
    await flushPromises();
    expect(mocks.getBoardFeeds).toHaveBeenCalledTimes(2);
    w.unmount();
  });
});

// ---------------- R3-1.6 发现页去重 ----------------
const EntityCardStub = {
  props: ['entity'],
  emits: ['open', 'filter'],
  template: '<div class="entity"><span>{{ entity.title }}</span></div>',
};
const PagerStub = { props: ['tabs'], template: '<div><slot v-for="tab in tabs" :key="tab.key" :tab="tab" /></div>' };

import DiscoverPage from '../DiscoverPage.vue';

function mountDiscover() {
  return mount(DiscoverPage, {
    global: { stubs: { DiscoveryPager: PagerStub, DiscoverySkeleton: true, ErrorState: ErrorStub, LoadingState: true, FeedTabs: true, DiscoveryEntityCard: EntityCardStub, DiscoverySecondHandGrid: true, EmptyState: true } },
  });
}

describe('DiscoverPage 批次15', () => {
  it('无 id 实体跨页重复时按内容键去重，不重复插入', async () => {
    mocks.getDiscoveryConfig.mockResolvedValue({ data: [{ id: 1, title: '发现', entities: [{ title: '生活', page_name: 'V11_FIND_LIFE', url: 'V11_FIND_LIFE' }] }] });
    mocks.getDiscoveryPageData
      .mockResolvedValueOnce({
        data: [
          { entityTemplate: 'iconMiniGridCard', title: '热门专区' },
          { id: 10, entityType: 'feed', title: '动态一' },
        ],
        hasMore: true,
        lastItem: '10',
      })
      .mockResolvedValueOnce({
        data: [
          { entityTemplate: 'iconMiniGridCard', title: '热门专区' },
          { id: 11, entityType: 'feed', title: '动态二' },
        ],
        hasMore: false,
      });
    const w = mountDiscover();
    await flushPromises();
    expect(w.text()).toContain('动态一');

    await w.find('.discover-scroll-container').trigger('scroll');
    await flushPromises();
    expect(w.text()).toContain('动态二');
    const headerCount = w.findAll('.entity').filter(e => e.text() === '热门专区').length;
    expect(headerCount).toBe(1);
    w.unmount();
  });
});

// ---------------- R3-5.1 直播播放失败重试 ----------------
import LiveDetailPage from '../LiveDetailPage.vue';

function mountLive() {
  return mount(LiveDetailPage, {
    props: { liveId: 'l1' },
    global: { stubs: { AppImage: true, EmptyState: true, ErrorState: ErrorStub, LoadingState: true } },
  });
}

function liveDetailPayload() {
  return { data: { live: { id: 'l1', title: '测试直播', liveStatus: 1, videoLiveUrl: 'https://cdn.example/live.m3u8', url: 'https://www.coolapk.com/live/l1' } } };
}

describe('LiveDetailPage 批次15', () => {
  it('播放失败显示「重新加载」入口，点击后重新请求直播地址并重建播放器', async () => {
    mocks.getLiveDetail.mockResolvedValue(liveDetailPayload());
    const w = mountLive();
    await flushPromises();
    expect(w.find('video').exists()).toBe(true);
    expect(mocks.getLiveDetail).toHaveBeenCalledTimes(1);

    await w.find('video').trigger('error');
    expect(w.find('video').exists()).toBe(false);
    const retry = w.find('.live-retry-button');
    expect(retry.exists()).toBe(true);
    expect(retry.text()).toBe('重新加载');

    await retry.trigger('click');
    await flushPromises();
    expect(mocks.getLiveDetail).toHaveBeenCalledTimes(2);
    expect(w.find('video').exists()).toBe(true);
    w.unmount();
  });
});

// ---------------- R3-5.2 / R3-5.3 / R3-5.4 看看号 ----------------
const FilterBarStub = {
  props: ['searchKeyword', 'targetTitle', 'scopeType', 'scopeParam', 'showSort', 'autoNavigateSearch'],
  emits: ['update:searchKeyword', 'search', 'clear'],
  template: `<div>
    <button class="do-search" @click="$emit('search', { keyword: '关键词' })">搜索</button>
    <button class="do-clear" @click="$emit('clear')">清除</button>
  </div>`,
};

import DyhPage from '../DyhPage.vue';
import { useAuthStore } from '../../stores/auth';

function mountDyh() {
  const authStore = useAuthStore();
  authStore.isLoggedIn = true;
  authStore.user = { uid: 10001, username: '测试用户' } as any;
  mocks.routeParams = { dyhId: 'd1' };
  return mount(DyhPage, {
    global: {
      stubs: { AppImage: true, FeedCard: FeedCardStub, LoadingState: true, EmptyState: true, ErrorState: ErrorStub, EntityFilterBar: FilterBarStub },
    },
  });
}

function dyhHeaderPayload() {
  return { data: { dyhId: 'd1', dyhName: '测试看看号', isFollow: false, follownum: 10 } };
}

describe('DyhPage 批次15', () => {
  it('搜索在途时清除关键词：清除请求不被 loading 短路，过期搜索响应被丢弃', async () => {
    mocks.getDyhDetail.mockResolvedValue(dyhHeaderPayload());
    mocks.getDyhFeeds.mockResolvedValue({ data: [feed(1, '精选动态')] });
    let resolveSearch!: (v: unknown) => void;
    mocks.searchByType.mockImplementationOnce(() => new Promise((r) => { resolveSearch = r; }));

    const w = mountDyh();
    await flushPromises();
    expect(w.text()).toContain('F1');

    await w.find('.do-search').trigger('click');
    expect(mocks.searchByType).toHaveBeenCalledTimes(1);

    // 搜索在途时点清除
    await w.find('.do-clear').trigger('click');
    await flushPromises();
    expect(mocks.getDyhFeeds).toHaveBeenCalled();

    // 过期的搜索响应返回：不得写进列表
    resolveSearch({ data: [feed(99, '搜索结果')] });
    await flushPromises();
    expect(w.text()).toContain('F1');
    expect(w.text()).not.toContain('搜索结果');
    w.unmount();
  });

  it('搜索态下切 Tab 清空搜索并按 Tab 重新加载', async () => {
    mocks.getDyhDetail.mockResolvedValue(dyhHeaderPayload());
    mocks.searchByType.mockResolvedValue({ data: [feed(99, '搜索结果')] });
    mocks.getDyhFeeds.mockResolvedValue({ data: [feed(2, '广场动态')] });
    const w = mountDyh();
    await flushPromises();

    await w.find('.do-search').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('F99');

    mocks.getDyhFeeds.mockClear();
    await w.findAll('.dyh-tab-item')[1].trigger('click');
    await flushPromises();
    expect(mocks.getDyhFeeds).toHaveBeenCalledWith('d1', 'square', 1);
    expect(mocks.searchByType).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('F2');
    expect(w.text()).not.toContain('F99');
    w.unmount();
  });

  it('关注失败时弹出 error toast 且状态回滚', async () => {
    mocks.getDyhDetail.mockResolvedValue(dyhHeaderPayload());
    mocks.getDyhFeeds.mockResolvedValue({ data: [feed(1, '动态')] });
    mocks.followDyh.mockRejectedValueOnce(new Error('网络中断'));
    const w = mountDyh();
    await flushPromises();
    const btn = w.find('.btn-follow-dyh');
    expect(btn.text()).toContain('关注');

    await btn.trigger('click');
    await flushPromises();
    expect(mocks.followDyh).toHaveBeenCalledWith('d1');
    expect(mocks.showToast).toHaveBeenCalledWith('网络中断', 'error');
    expect(w.find('.btn-follow-dyh').text()).not.toContain('已关注');
    w.unmount();
  });
});

// ---------------- R3-5.5 我的动态号 ----------------
import MyDyhPage from '../MyDyhPage.vue';

function mountMyDyh() {
  const authStore = useAuthStore();
  authStore.isLoggedIn = true;
  authStore.user = { uid: 10001, username: '测试用户' } as any;
  return mount(MyDyhPage, {
    global: {
      stubs: { AppImage: true, LoadingState: true, EmptyState: true, ErrorState: ErrorStub },
    },
  });
}

describe('MyDyhPage 批次15', () => {
  it('切 Tab 时旧 Tab 在途响应被丢弃，新 Tab 数据不被污染', async () => {
    let resolveFollow!: (v: unknown) => void;
    mocks.getMyDyhFollowList.mockImplementationOnce(() => new Promise((r) => { resolveFollow = r; }));
    mocks.getMyDyhSubscribeList.mockResolvedValue({ data: [{ id: 2, dyhName: '订阅号' }] });
    const w = mountMyDyh();

    await w.findAll('.dyh-tab-item')[1].trigger('click');
    await flushPromises();
    expect(w.text()).toContain('订阅号');

    resolveFollow({ data: [{ id: 1, dyhName: '关注号' }] });
    await flushPromises();
    expect(w.text()).toContain('订阅号');
    expect(w.text()).not.toContain('关注号');
    w.unmount();
  });

  it('取消关注失败时弹出 error toast 且卡片保留', async () => {
    mocks.getMyDyhFollowList.mockResolvedValue({ data: [{ id: 1, dyhName: '关注号' }] });
    mocks.unfollowDyh.mockRejectedValueOnce(new Error('网络中断'));
    const w = mountMyDyh();
    await flushPromises();
    expect(w.text()).toContain('关注号');

    await w.find('.btn-unfollow').trigger('click');
    await flushPromises();
    expect(mocks.unfollowDyh).toHaveBeenCalledWith('1');
    expect(mocks.showToast).toHaveBeenCalledWith('网络中断', 'error');
    expect(w.text()).toContain('关注号');
    w.unmount();
  });
});
