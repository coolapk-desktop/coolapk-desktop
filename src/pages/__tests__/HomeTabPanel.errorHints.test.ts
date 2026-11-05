import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { expect, it, vi } from 'vitest';
import HomeTabPanel from '../HomeTabPanel.vue';
import { useAuthStore } from '../../stores/auth';

// 对应 issue #42 / #45：首页 403 时不能只把原生报错原文甩给用户。
const api = vi.hoisted(() => ({
  getFollowingFeeds: vi.fn(),
  getDiscoveryPageData: vi.fn().mockResolvedValue({ data: [] }),
  getHotSearchKeywords: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));

async function setup() {
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
  await flushPromises();
  return wrapper;
}

it('首页 403 显示风控提示并保留原始错误', async () => {
  api.getFollowingFeeds.mockRejectedValue(new Error('Coolapk API returned HTTP 403 Forbidden: empty response body'));
  const wrapper = await setup();
  try {
    expect(wrapper.get('.error-title').text()).toBe('酷安接口拒绝访问（403）');
    const desc = wrapper.get('.error-desc').text();
    expect(desc).toContain('更换网络');
    expect(desc).toContain('原始错误：Coolapk API returned HTTP 403');
  } finally { wrapper.unmount(); }
});

it('酷安业务信封里的验证码要求转成人工验证提示', async () => {
  api.getFollowingFeeds.mockRejectedValue(new Error(JSON.stringify({ code: 403, messageStatus: 'err_request_captcha_v2' })));
  const wrapper = await setup();
  try {
    expect(wrapper.get('.error-title').text()).toBe('需要完成人工验证');
    expect(wrapper.get('.error-desc').text()).toContain('在应用内完成验证');
  } finally { wrapper.unmount(); }
});

it('限流与超时分别给出可执行建议', async () => {
  api.getFollowingFeeds.mockRejectedValue(new Error('酷安接口返回错误：访问过于频繁'));
  let wrapper = await setup();
  expect(wrapper.get('.error-title').text()).toBe('请求过于频繁');
  wrapper.unmount();
  api.getFollowingFeeds.mockRejectedValue(new Error('请求超时'));
  wrapper = await setup();
  try {
    expect(wrapper.get('.error-title').text()).toBe('请求超时');
    expect(wrapper.get('.error-desc').text()).toContain('请检查网络或代理后重试');
  } finally { wrapper.unmount(); }
});
