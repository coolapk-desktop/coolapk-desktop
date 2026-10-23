import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HomeTabPanel from '../HomeTabPanel.vue';
import type { DiscoveryEntity } from '../../types/discovery';

const api = vi.hoisted(() => ({ getDiscoveryPageData: vi.fn(), getRankFeeds: vi.fn() }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));

// 取自官方 V9_HOME_TAB_RANKING 的 selectorLinkCard，参数和栏目顺序必须原样传递。
const channels = [
  { title: '今日热门', url: '#/feed/statList?cacheExpires=300&statType=day&sortField=rank_score&filterRepeatQuestionAnswer=true&replyRowsLimit=1' },
  { title: '手机', url: '#/feed/digestList?message_status=all&ttype=7&tcat=1000&orderBy=rank_score&filterId=52&replyRowsLimit=101' },
  { title: '系统', url: '#/feed/digestList?message_status=all&tagKeywords=rom&orderBy=rank_score&filterId=52&replyRowsLimit=1' },
  { title: '平板', url: '#/feed/digestList?tcat=1001' },
  { title: '耳机', url: '#/feed/digestList?tcat=1037' },
  { title: '穿戴', url: '#/feed/digestList?tcat=1005' },
  { title: '其他数码', url: '#/feed/digestList?tcat=1009%2C1040%2C1006&filterId=43' },
  { title: '图文', url: '#/feed/digestList?type=12&message_status=all&filterTag=二手交易%2C二手' },
];
const feed = (id: string) => ({ id, entityId: id, entityType: 'feed', message: `动态 ${id}`, uid: '123', username: '酷友' });
const ranks = ['周榜', '月榜', '收藏榜', '酷安指数', '酷图榜'].map((title, index) => ({ title, url: `/page?url=RANK_${index}`, pic: 'https://image.coolapk.com/icon.png' }));
function homeResponse(selectedTab = '今日热门'): { data: DiscoveryEntity[]; lastItem: string; pageContext: string } {
  return { data: [
    { entityTemplate: 'iconLinkGridCard', entities: ranks },
    { entityTemplate: 'iconMiniGridCard', url: '#/topic/tagList?keywords=资讯热点', entities: Array.from({ length: 6 }, (_, index) => ({ title: `完整热点标题 ${index}`, entityType: 'topic', url: `/t/热点${index}` })) },
    { entityTemplate: 'capsuleListCard', entities: [{ title: '搜索词显示标题', url: 'searchTab://all?keyword=官方搜索词' }] },
    { entityTemplate: 'selectorLinkCard', extraDataArr: { selectedTab, rememberSelected: '0', cardFixedToTop: '1', cardLayoutStyle: 'transButton' }, entities: channels },
    feed('day-1'), feed('day-2'),
  ], lastItem: 'day-last', pageContext: 'day-context' };
}
async function setup() {
  const tab = { title: '热榜', page_name: 'V9_HOME_TAB_RANKING', url: 'V9_HOME_TAB_RANKING' };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/page', component: { template: '<div />' } }, { path: '/search', component: { template: '<div />' } }, { path: '/topic/:tag', component: { template: '<div />' } }] });
  await router.push('/');
  const wrapper = mount(HomeTabPanel, { props: { embedded: true, selected: true, tabKey: tab.page_name, tabs: [tab] }, global: { plugins: [router, createPinia()], stubs: { FeedCard: { props: ['feed', 'rankIndex'], template: '<article class="test-feed" :data-rank="rankIndex">{{ feed.id }}</article>' }, AppImage: true } } });
  await flushPromises();
  return { wrapper, router };
}
beforeEach(() => {
  api.getDiscoveryPageData.mockReset().mockImplementation(async options => options.url === 'V9_HOME_TAB_RANKING' ? homeResponse() : { data: [feed(`${options.title}-${options.page}`)], lastItem: `${options.title}-last`, pageContext: `${options.title}-context` });
  api.getRankFeeds.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it.each([390, 1280])('宽度 %s 使用官方默认栏目，切换保留完整 URL，分页和刷新使用当前分类', async width => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
  const { wrapper } = await setup();
  try {
    expect(wrapper.findAll('.hot-channel-tab').map(item => item.text())).toEqual(channels.map(item => item.title));
    expect(wrapper.get('.hot-channel-tab.active').text()).toBe('今日热门');
    expect(wrapper.get('.hot-channel-tabs').classes()).toContain('is-fixed');
    expect(wrapper.findAll('.hot-topic')).toHaveLength(6);
    expect(wrapper.find('.hot-topics-header').exists()).toBe(false);
    expect(wrapper.get('.hot-topic').attributes('title')).toBe('完整热点标题 0');
    expect(wrapper.findAll('.test-feed').map(item => item.text())).toEqual(['day-1', 'day-2']);
    expect(wrapper.get('.test-feed').attributes('data-rank')).toBeUndefined();
    expect(api.getRankFeeds).not.toHaveBeenCalled();
    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(1);
    await wrapper.get('.feed-scroll-container').trigger('scroll'); await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: channels[0].url, page: 2, firstItem: '', lastItem: 'day-last', pageContext: 'day-context' }));
    const scroll = wrapper.get('.feed-scroll-container').element as HTMLElement; scroll.scrollTop = 700;
    await wrapper.findAll('.hot-channel-tab')[1].trigger('click'); await flushPromises();
    expect(scroll.scrollTop).toBe(0);
    expect(wrapper.get('.hot-channel-tab.active').text()).toBe('手机');
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: channels[1].url, page: 1, lastItem: '', pageContext: '' }));
    expect(wrapper.findAll('.test-feed').map(item => item.text())).toEqual(['手机-1']);
    await wrapper.get('.feed-scroll-container').trigger('scroll'); await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: channels[1].url, page: 2, lastItem: '手机-last', pageContext: '手机-context' }));
    window.dispatchEvent(new Event('refresh-feeds')); await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: channels[1].url, page: 1, lastItem: '', pageContext: '' }));
    expect(wrapper.get('.hot-channel-tab.active').text()).toBe('手机');
    const calls = api.getDiscoveryPageData.mock.calls.length;
    await wrapper.findAll('.hot-channel-tab')[1].trigger('click'); await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(calls);
  } finally { wrapper.unmount(); }
});

it('栏目顺序和默认选中由服务端指定，兼容 JSON extraData', async () => {
  const response = homeResponse('系统');
  const selector = response.data.find(item => item.entityTemplate === 'selectorLinkCard')!;
  Object.assign(selector, { extraDataArr: undefined, extraData: JSON.stringify(selector.extraDataArr), entities: [...channels].reverse() });
  api.getDiscoveryPageData.mockResolvedValue(response);
  const { wrapper } = await setup();
  try {
    expect(wrapper.findAll('.hot-channel-tab')[0].text()).toBe('图文');
    expect(wrapper.get('.hot-channel-tab.active').text()).toBe('系统');
    window.dispatchEvent(new Event('refresh-feeds')); await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: channels[2].url, page: 1 }));
  } finally { wrapper.unmount(); }
});

it('快速切换时迟到的旧分类不会覆盖当前分类，也不会改写分页游标', async () => {
  const { wrapper } = await setup();
  let finishPhone!: (data: unknown) => void;
  api.getDiscoveryPageData.mockImplementation(async options => options.url === channels[1].url ? new Promise(resolve => { finishPhone = resolve; }) : { data: [feed('system-new')], lastItem: 'system-last', pageContext: 'system-context' });
  try {
    await wrapper.findAll('.hot-channel-tab')[1].trigger('click');
    await wrapper.findAll('.hot-channel-tab')[2].trigger('click'); await flushPromises();
    expect(wrapper.get('.hot-channel-tab.active').text()).toBe('系统');
    finishPhone({ data: [feed('phone-old')], lastItem: 'phone-old-last' }); await flushPromises();
    expect(wrapper.findAll('.test-feed').map(item => item.text())).toEqual(['system-new']);
    await wrapper.get('.feed-scroll-container').trigger('scroll'); await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: channels[2].url, page: 2, lastItem: 'system-last', pageContext: 'system-context' }));
  } finally { wrapper.unmount(); }
});

it('榜单打开官方独立页面，热搜使用 URL 中的实际关键词', async () => {
  const { wrapper, router } = await setup();
  try {
    await wrapper.findAll('.rank-action-item')[0].trigger('click'); await flushPromises();
    expect(router.currentRoute.value).toMatchObject({ path: '/page', query: { url: ranks[0].url, title: '周榜', renderer: 'discovery' } });
    await wrapper.get('.chip-btn').trigger('click'); await flushPromises();
    expect(router.currentRoute.value).toMatchObject({ path: '/search', query: { q: '官方搜索词' } });
    await wrapper.get('.hot-topic').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.params.tag).toBe('热点0');
  } finally { wrapper.unmount(); }
});
