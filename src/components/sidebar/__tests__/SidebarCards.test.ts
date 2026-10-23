import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia } from 'pinia';
import RightSidebar from '../../layout/RightSidebar.vue';
import TrendingList from '../TrendingList.vue';
import { useSettingsStore } from '../../../stores/settings';

const api = vi.hoisted(() => ({ getDiscoveryPageData: vi.fn(), getRankFeeds: vi.fn(), getHotTopics: vi.fn(), openUrl: vi.fn() }));
vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: api }));
const feed = (id: string) => ({ id, entityType: 'feed', username: '酷友', message: `动态 ${id}`, title: id });

beforeEach(() => {
  api.getDiscoveryPageData.mockReset().mockImplementation(async ({ url }) => url === 'V9_HOME_TAB_RANKING' ? { data: [{ entityTemplate: 'iconMiniGridCard', entities: Array.from({ length: 6 }, (_, i) => ({ title: `官方资讯${i}`, entityType: 'topic', url: `/t/资讯${i}` })) }, feed('忽略首页动态')] } : { data: [feed('今日')] });
  api.getRankFeeds.mockReset().mockImplementation(async period => ({ data: [feed(period)] }));
  api.getHotTopics.mockReset().mockResolvedValue({ data: [] });
});

async function setup(component: Parameters<typeof mount>[0] = RightSidebar, props: Record<string, unknown> = {}) {
  const pinia = createPinia();
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/topic/:tag', component: { template: '<div />' } }] });
  await router.push('/');
  const global = { plugins: [router, pinia], stubs: { AppImage: true } };
  const wrapper = mount(component, { props, global });
  await flushPromises();
  return { wrapper, router, settings: useSettingsStore(pinia), global };
}

it('热门资讯位于第一块，使用官方资讯标题与话题入口', async () => {
  const { wrapper, router } = await setup();
  try {
    expect(wrapper.findAll('.sidebar-card').map(card => card.find('h3').text())).toEqual(['热门资讯', '今日热榜', '热门话题']);
    expect(wrapper.findAll('.news-item')).toHaveLength(6);
    expect(wrapper.get('.news-item').text()).toBe('官方资讯0');
    await wrapper.get('.news-item').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/topic/%E8%B5%84%E8%AE%AF0');
  } finally { wrapper.unmount(); }
});

it('关闭热门资讯不会请求资讯，其他模块开关相互独立', async () => {
  const { wrapper } = await setup(RightSidebar, { showHotNews: false, showMonthlyRank: false, showHotTopics: true });
  try {
    expect(wrapper.find('.hot-news-card').exists()).toBe(false);
    expect(api.getDiscoveryPageData).not.toHaveBeenCalled();
    expect(api.getRankFeeds).not.toHaveBeenCalled();
    expect(api.getHotTopics).toHaveBeenCalledOnce();
  } finally { wrapper.unmount(); }
});

it('今日、本周、本月循环切换，重建组件恢复保存的范围', async () => {
  const { wrapper, settings, global } = await setup(TrendingList);
  try {
    expect(wrapper.get('h3').text()).toBe('今日热榜');
    expect(api.getDiscoveryPageData).toHaveBeenLastCalledWith(expect.objectContaining({ url: expect.stringContaining('statType=day'), page: 1 }));
    await wrapper.get('.period-next').trigger('click'); await flushPromises();
    expect(wrapper.get('h3').text()).toBe('本周热榜');
    expect(api.getRankFeeds).toHaveBeenLastCalledWith('week', 1);
    await wrapper.get('.period-next').trigger('click'); await flushPromises();
    expect(wrapper.get('h3').text()).toBe('本月热榜');
    expect(api.getRankFeeds).toHaveBeenLastCalledWith('month', 1);
    await wrapper.get('.period-next').trigger('click'); await flushPromises();
    expect(wrapper.get('h3').text()).toBe('今日热榜');
    await wrapper.get('.period-prev').trigger('click'); await flushPromises();
    expect(settings.settings.homeSidebarRankPeriod).toBe('month');
    wrapper.unmount();
    const restored = mount(TrendingList, { global });
    try { await flushPromises(); expect(restored.get('h3').text()).toBe('本月热榜'); }
    finally { restored.unmount(); }
  } finally { if (wrapper.exists()) wrapper.unmount(); }
});

it('快速切换时迟到的本周结果不能覆盖今日热榜', async () => {
  const { wrapper } = await setup(TrendingList);
  let finish!: (value: unknown) => void;
  api.getRankFeeds.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    await wrapper.get('.period-next').trigger('click');
    await wrapper.get('.period-prev').trigger('click'); await flushPromises();
    finish({ data: [feed('过期本周')] }); await flushPromises();
    expect(wrapper.get('h3').text()).toBe('今日热榜');
    expect(wrapper.get('.item-title').text()).toBe('今日');
    expect(wrapper.text()).not.toContain('过期本周');
  } finally { wrapper.unmount(); }
});
