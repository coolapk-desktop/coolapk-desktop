import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { expect, it, vi } from 'vitest';
import HomeTabPanel from '../HomeTabPanel.vue';
import { useSettingsStore } from '../../stores/settings';

const api = vi.hoisted(() => ({ getIndexV8EntitiesPaged: vi.fn(), getDiscoveryPageData: vi.fn(), getHotSearchKeywords: vi.fn().mockResolvedValue([]) }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));

it.each([390, 1280])('宽度 %s 下头条刷新保留首条锚点，分页只传末条游标', async (width) => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
  const feed = (id: string) => ({ id, entityId: id, entityType: 'feed', message: `动态 ${id}`, uid: '123', username: '酷友' });
  api.getIndexV8EntitiesPaged.mockReset();
  api.getIndexV8EntitiesPaged.mockResolvedValueOnce({ data: [feed('100'), feed('90')] })
    .mockResolvedValueOnce({ data: [feed('80'), feed('70')] })
    .mockResolvedValueOnce({ data: [feed('110'), feed('105')] })
    .mockResolvedValueOnce({ data: [feed('120'), feed('115')] })
    .mockRejectedValueOnce(new Error('网络暂时不可用'))
    .mockResolvedValueOnce({ data: [feed('130'), feed('125')] });
  const tab = { title: '头条', page_name: 'V9_HOME_TAB_HEADLINE', url: '/main/headline' };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  const wrapper = mount(HomeTabPanel, { props: { embedded: true, selected: true, tabKey: tab.page_name, tabs: [tab] }, global: { plugins: [router, createPinia()], stubs: { FeedCard: true, FeedVideoCard: true, AppImage: true } } });
  try {
    await flushPromises();
    expect(api.getIndexV8EntitiesPaged).toHaveBeenLastCalledWith({ page: 1, firstItem: '', lastItem: '' });
    await wrapper.get('.feed-scroll-container').trigger('scroll');
    await flushPromises();
    expect(api.getIndexV8EntitiesPaged).toHaveBeenLastCalledWith({ page: 2, firstItem: '', lastItem: '90' });
    // 翻页后刷新仍然使用列表首条，不能使用刚加载的旧动态。
    window.dispatchEvent(new Event('refresh-feeds'));
    await flushPromises();
    expect(api.getIndexV8EntitiesPaged).toHaveBeenLastCalledWith({ page: 1, firstItem: '100', lastItem: '' });
    window.dispatchEvent(new Event('refresh-feeds'));
    await flushPromises();
    expect(api.getIndexV8EntitiesPaged).toHaveBeenLastCalledWith({ page: 1, firstItem: '110', lastItem: '' });
    // 刷新失败后重试仍保留锚点，不能退回首次加载的请求。
    window.dispatchEvent(new Event('refresh-feeds'));
    await flushPromises();
    window.dispatchEvent(new Event('refresh-feeds'));
    await flushPromises();
    expect(api.getIndexV8EntitiesPaged).toHaveBeenLastCalledWith({ page: 1, firstItem: '120', lastItem: '' });
  } finally { wrapper.unmount(); vi.restoreAllMocks(); }
});

it.each(['scroll', 'load'])('双列通过 %s 提前按短列加载，不等待较长列滚到底', async (eventType) => {
  const feed = (id: number) => ({ id, entityId: id, entityType: 'feed', message: `动态 ${id}`, uid: '123', username: '酷友' });
  api.getIndexV8EntitiesPaged.mockReset().mockResolvedValueOnce({ data: [4, 3, 2, 1].map(feed) }).mockResolvedValueOnce({ data: [8, 7, 6, 5].map(feed) });
  const pinia = createPinia();
  useSettingsStore(pinia).settings.feedLayout = 'double';
  const tab = { title: '头条', page_name: 'V9_HOME_TAB_HEADLINE', url: '/main/headline' };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  const wrapper = mount(HomeTabPanel, { props: { embedded: true, selected: true, tabKey: tab.page_name, tabs: [tab] }, global: { plugins: [router, pinia], stubs: { FeedCard: { props: ['feed'], template: '<article class="feed-card"><img /><span>{{ feed.id }}</span></article>' }, AppImage: true } } });
  try {
    await flushPromises();
    const scroll = wrapper.get('.feed-scroll-container').element as HTMLElement;
    Object.defineProperties(scroll, { clientHeight: { value: 800 }, scrollHeight: { value: 6000 } });
    vi.spyOn(scroll, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 1000, 800));
    const columns = wrapper.findAll('.feed-waterfall-column');
    for (const [index, column] of columns.entries()) {
      (column.element as HTMLElement).style.display = 'flex';
      vi.spyOn(column.element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(index * 500, 0, 500, index === 0 ? 6000 : wrapper.findAll('.feed-card').length > 4 ? 2400 : 1400));
    }
    const originalParents = wrapper.findAll('.feed-card').map(card => card.element.parentElement);
    if (eventType === 'scroll') await wrapper.get('.feed-scroll-container').trigger('scroll');
    else wrapper.get('img').element.dispatchEvent(new Event('load'));
    await flushPromises();
    expect(api.getIndexV8EntitiesPaged).toHaveBeenCalledTimes(2);
    expect(api.getIndexV8EntitiesPaged).toHaveBeenLastCalledWith({ page: 2, firstItem: '', lastItem: '1' });
    expect(wrapper.findAll('.feed-card')).toHaveLength(8);
    // 预加载追加卡片时，两列原有卡片的归属保持不变。
    expect(wrapper.findAll('.feed-card').filter(card => Number(card.text()) <= 4).map(card => card.element.parentElement)).toEqual(originalParents);
    await wrapper.setProps({ selected: false });
    await wrapper.get('.feed-scroll-container').trigger('scroll');
    await flushPromises();
    expect(api.getIndexV8EntitiesPaged).toHaveBeenCalledTimes(2);
  } finally { wrapper.unmount(); vi.restoreAllMocks(); }
});


it.each([
  [false, 'flat'], [true, 'flat'], [true, 'string'], [true, 'object'],
] as const)('官方快捷入口分页配置 pagination=%s、来源=%s：每页一行五个并切换指示器', async (pagination, source) => {
  const channels = Array.from({ length: 10 }, (_, index) => ({ id: `link-${index}`, title: `入口${index}`, url: `/page?url=link-${index}`, logo: `https://example.com/${index}.png` }));
  api.getIndexV8EntitiesPaged.mockReset();
  const config = { column: 5, row: 1, pagination: String(pagination) };
  const metadata = source === 'flat' ? config : { extraData: source === 'string' ? JSON.stringify(config) : config };
  api.getIndexV8EntitiesPaged.mockResolvedValue({ data: [{ entityType: 'card', entityTemplate: 'iconLinkGridCard', ...metadata, entities: channels }] });
  const tab = { title: '头条', page_name: 'V9_HOME_TAB_HEADLINE', url: '/main/headline' };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  const wrapper = mount(HomeTabPanel, { props: { embedded: true, selected: true, tabKey: tab.page_name, tabs: [tab] }, global: { plugins: [router, createPinia()], stubs: { FeedCard: true, AppImage: true } } });
  try {
    await flushPromises();
    expect(wrapper.findAll('.icon-btn-item')).toHaveLength(10);
    expect(wrapper.findAll('.headline-icon-page')).toHaveLength(pagination ? 2 : 1);
    expect(wrapper.find('.headline-page-indicator').exists()).toBe(pagination);
    if (pagination) {
      expect(wrapper.findAll('.headline-icon-page').map(page => page.findAll('.icon-btn-item').length)).toEqual([5, 5]);
      const scroll = wrapper.get('.quick-icons-grid').element as HTMLElement;
      Object.defineProperty(scroll, 'clientWidth', { value: 360 });
      scroll.scrollLeft = 360;
      await wrapper.get('.quick-icons-grid').trigger('scroll');
      expect(wrapper.findAll('.headline-page-indicator button')[1].attributes('aria-current')).toBe('page');
      const scrollTo = vi.fn();
      scroll.scrollTo = scrollTo;
      await wrapper.findAll('.headline-page-indicator button')[0].trigger('click');
      expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
    }
  } finally { wrapper.unmount(); }
});


it('进入头条不自动选择快捷入口，离开后再进入恢复推荐流并收起子栏目', async () => {
  const feed = { id: '100', entityType: 'feed', message: '推荐动态', uid: '123', username: '酷友' };
  const quickLinks = { entityType: 'card', entityTemplate: 'iconLinkGridCard', extraData: JSON.stringify({ row: 1, column: 5, pagination: 'true' }), entities: [{ id: 'worth', title: '值得看', url: '/page?url=worth' }] };
  api.getIndexV8EntitiesPaged.mockReset();
  api.getIndexV8EntitiesPaged.mockResolvedValue({ data: [quickLinks, feed] });
  api.getDiscoveryPageData.mockResolvedValue({ data: [{ entityType: 'card', entityTemplate: 'iconTabLinkGridCard', entities: [{ title: '图文', url: '/page?url=worth-picture' }, { title: '全部', url: '/page?url=worth-all' }] }, feed] });
  const tab = { title: '头条', page_name: 'V9_HOME_TAB_HEADLINE', url: '/main/headline' };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  const wrapper = mount(HomeTabPanel, { props: { embedded: true, selected: true, tabKey: tab.page_name, tabs: [tab] }, global: { plugins: [router, createPinia()], stubs: { FeedCard: true, AppImage: true } } });
  try {
    await flushPromises();
    expect(wrapper.find('.icon-btn-item.selected').exists()).toBe(false);
    expect(wrapper.find('.headline-nested-tabs').exists()).toBe(false);
    expect(api.getDiscoveryPageData).not.toHaveBeenCalled();
    await wrapper.get('.icon-btn-item').trigger('click'); await flushPromises();
    expect(wrapper.find('.icon-btn-item.selected').exists()).toBe(true);
    expect(wrapper.find('.headline-nested-tabs').exists()).toBe(true);
    await wrapper.setProps({ selected: false });
    await wrapper.setProps({ selected: true }); await flushPromises();
    expect(wrapper.find('.icon-btn-item.selected').exists()).toBe(false);
    expect(wrapper.find('.headline-nested-tabs').exists()).toBe(false);
    expect(api.getIndexV8EntitiesPaged).toHaveBeenLastCalledWith({ page: 1, firstItem: '', lastItem: '' });
  } finally { wrapper.unmount(); }
});
