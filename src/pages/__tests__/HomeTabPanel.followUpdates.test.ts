import { mobilePull } from '../../test-utils/mobilePull';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { expect, it, vi } from 'vitest';
import HomeTabPanel from '../HomeTabPanel.vue';
import { useAuthStore } from '../../stores/auth';
import { HOME_TAB_REFRESH_EVENT } from '../../utils/homeTab';

const api = vi.hoisted(() => ({
  getFollowingFeeds: vi.fn(),
  getDiscoveryPageData: vi.fn().mockResolvedValue({ data: [] }),
  getHotSearchKeywords: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));

it.each([390, 1280])('宽度 %s 的首页全部关注展示更新名单，其他分组不混入', async width => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
  api.getFollowingFeeds.mockResolvedValue({ data: [{ entityType: 'card', entityTemplate: 'iconScrollCard', url: '/user/recentUpdateList', entities: [{ entityType: 'user', uid: '200', username: '关注酷友', url: '/u/200' }] }, { id: 1, entityType: 'feed', message: '新动态', uid: '200', username: '关注酷友', dateline: Math.floor(Date.now() / 1000) }] });
  const pinia = createPinia();
  useAuthStore(pinia).isLoggedIn = true;
  useAuthStore(pinia).user = { uid: '100', username: '自己' } as any;
  const tab = { title: '关注', page_name: 'V15_HOME_TAB_FOLLOW', url: 'V15_HOME_TAB_FOLLOW' };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  const wrapper = mount(HomeTabPanel, {
    props: { embedded: true, selected: true, tabKey: tab.page_name, tabs: [tab] },
    global: { plugins: [router, pinia], stubs: { FeedCard: true, FeedVideoCard: true, AppAvatar: true, AppImage: true } },
  });
  try {
    await flushPromises();
    expect(wrapper.get('.updated-follow-users').text()).toContain('关注酷友');
    await wrapper.get('.updates-toggle').trigger('click');
    expect(wrapper.find('.updated-follow-users').exists()).toBe(false);
    expect(wrapper.find('.updates-collapsed-entry').exists()).toBe(false);
    expect(wrapper.find('.follow-subchannel-bar .follow-updates-expand').exists()).toBe(true);
    await wrapper.get('.follow-updates-expand').trigger('click');
    expect(wrapper.get('.updated-follow-users').text()).toContain('关注酷友');
    expect(wrapper.find('.follow-updates-expand').exists()).toBe(false);
    const refreshCalls = api.getFollowingFeeds.mock.calls.length;
    mobilePull(wrapper.get('.feed-scroll-container').element as HTMLElement);
    await flushPromises();
    expect(api.getFollowingFeeds).toHaveBeenCalledTimes(refreshCalls + (width <= 720 ? 1 : 0));
    expect(wrapper.get('.follow-subchannel-item.active').text()).toBe('全部关注');
    const channels = wrapper.findAll('.follow-subchannel-item');
    await channels[2]!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.updated-follow-users').exists()).toBe(false);
    const activeChannel = wrapper.get('.follow-subchannel-item.active').element;
    const channelRequests = api.getDiscoveryPageData.mock.calls.length;
    const request = api.getDiscoveryPageData.mock.calls.at(-1)?.[0];
    window.dispatchEvent(new Event(HOME_TAB_REFRESH_EVENT));
    await flushPromises();
    expect(wrapper.get('.follow-subchannel-item.active').element).toBe(activeChannel);
    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(channelRequests + 1);
    expect(api.getDiscoveryPageData.mock.calls.at(-1)?.[0]).toEqual(request);
    await wrapper.setProps({ selected: false });
    window.dispatchEvent(new Event(HOME_TAB_REFRESH_EVENT));
    await flushPromises();
    expect(api.getDiscoveryPageData).toHaveBeenCalledTimes(channelRequests + 1);
    await wrapper.setProps({ selected: true });
    await channels[0]!.trigger('click');
    await flushPromises();
    expect(wrapper.get('.updated-follow-users').text()).toContain('关注酷友');
  } finally { wrapper.unmount(); vi.restoreAllMocks(); }
});
