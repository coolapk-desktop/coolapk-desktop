import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  currentRoute: { value: { path: '/' } },
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: () => routerMock.currentRoute.value,
    useRouter: () => routerMock,
  };
});

import MobileBottomNav from '../MobileBottomNav.vue';
import { useAuthStore } from '../../../stores/auth';
import { useSettingsStore } from '../../../stores/settings';
import { nextTick } from 'vue';
import {
  HOME_TAB_REFRESH_EVENT,
  HOME_TAB_SCROLL_TOP_EVENT,
  resetHomeTabClickState,
} from '../../../utils/homeTab';

function mountNav() {
  return mount(MobileBottomNav);
}

function navButton(wrapper: ReturnType<typeof mountNav>, label: string) {
  const button = wrapper.findAll('.mobile-nav-item').find((item) => item.text().includes(label));
  if (!button) throw new Error(`未找到底栏按钮：${label}`);
  return button;
}

describe('MobileBottomNav 首页手势', () => {
  const scrollTopSpy = vi.fn();
  const refreshSpy = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    routerMock.currentRoute.value.path = '/';
    resetHomeTabClickState();
    window.addEventListener(HOME_TAB_SCROLL_TOP_EVENT, scrollTopSpy);
    window.addEventListener(HOME_TAB_REFRESH_EVENT, refreshSpy);
  });

  it.each(['digital', 'discover'] as const)('响应 %s 显隐设置且可恢复入口', async (key) => {
    const wrapper = mountNav();
    const settingsStore = useSettingsStore();
    const label = key === 'digital' ? '数码' : '发现';
    const otherLabel = key === 'digital' ? '发现' : '数码';
    settingsStore.toggleNavVisibility(key);
    await nextTick();
    expect(wrapper.findAll('.mobile-nav-item').map(item => item.text())).not.toContain(label);
    expect(navButton(wrapper, otherLabel).exists()).toBe(true);
    settingsStore.toggleNavVisibility(key);
    await nextTick();
    await navButton(wrapper, label).trigger('click');
    expect(routerMock.push).toHaveBeenCalledWith(`/${key}`);
    wrapper.unmount();
  });

  it('同时隐藏数码和发现仍保留首页、发布和我的', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.toggleNavVisibility('digital');
    settingsStore.toggleNavVisibility('discover');
    const wrapper = mountNav();
    expect(wrapper.findAll('.mobile-nav-item').map(item => item.text())).toEqual(['首页', '我的']);
    expect(wrapper.find('[aria-label="发布动态"]').exists()).toBe(true);
    await navButton(wrapper, '我的').trigger('click');
    expect(routerMock.push).toHaveBeenCalledWith('/me');
    wrapper.unmount();
  });

  afterEach(() => {
    window.removeEventListener(HOME_TAB_SCROLL_TOP_EVENT, scrollTopSpy);
    window.removeEventListener(HOME_TAB_REFRESH_EVENT, refreshSpy);
    resetHomeTabClickState();
  });

  it('已在首页时单击「首页」回到顶部，不发起重复导航', async () => {
    const wrapper = mountNav();
    await navButton(wrapper, '首页').trigger('click');

    expect(scrollTopSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('已在首页时双击「首页」回到顶部并刷新当前栏目', async () => {
    const wrapper = mountNav();
    const home = navButton(wrapper, '首页');

    await home.trigger('click');
    await home.trigger('click');

    expect(scrollTopSpy).toHaveBeenCalledTimes(2);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('不在首页时单击「首页」跳回首页，不派发首页事件', async () => {
    routerMock.currentRoute.value.path = '/digital';
    const wrapper = mountNav();
    await navButton(wrapper, '首页').trigger('click');

    expect(routerMock.push).toHaveBeenCalledWith('/');
    expect(scrollTopSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it.each([['数码', '/digital'], ['发现', '/discover'], ['我的', '/me']])(
    '已在%s栏目时单击回到顶部，不重复导航',
    async (label, path) => {
      routerMock.currentRoute.value.path = path;
      const main = document.createElement('div');
      main.className = 'app-main-content';
      const scroller = document.createElement('div');
      scroller.scrollTop = 640;
      main.appendChild(scroller);
      document.body.appendChild(main);
      const wrapper = mountNav();
      try {
        await navButton(wrapper, label).trigger('click');
        expect(routerMock.push).not.toHaveBeenCalled();
        expect(scrollTopSpy).toHaveBeenCalledTimes(1);
        expect(scroller.scrollTop).toBe(0);
      } finally {
        wrapper.unmount();
        main.remove();
      }
    }
  );

  it('其他底栏按钮只负责导航，不触发首页手势', async () => {
    const wrapper = mountNav();
    await navButton(wrapper, '发现').trigger('click');

    expect(routerMock.push).toHaveBeenCalledWith('/discover');
    expect(scrollTopSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('登录前后「我的」均进入个人中心，只有个人中心高亮', async () => {
    const anonymous = mountNav();
    await navButton(anonymous, '我的').trigger('click');
    expect(routerMock.push).toHaveBeenLastCalledWith('/me');
    useAuthStore().user = { uid: '12345', username: '自己' } as never;
    await navButton(mountNav(), '我的').trigger('click');
    expect(routerMock.push).toHaveBeenLastCalledWith('/me');
    routerMock.currentRoute.value.path = '/me';
    expect(navButton(mountNav(), '我的').classes()).toContain('active');
    routerMock.currentRoute.value.path = '/user/12345';
    expect(navButton(mountNav(), '我的').classes()).not.toContain('active');
    routerMock.currentRoute.value.path = '/user/99999';
    expect(navButton(mountNav(), '我的').classes()).not.toContain('active');
  });

  it('未登录时访问任何用户主页都不高亮「我的」', async () => {
    routerMock.currentRoute.value.path = '/user/99999';

    const wrapper = mountNav();
    const profileButton = wrapper.findAll('.mobile-nav-item').find((item) => item.text().includes('我的'));

    // 「我的」统一指向 /me，不会误命中 /user/ 路径。
    expect(profileButton?.classes()).not.toContain('active');
  });
});
