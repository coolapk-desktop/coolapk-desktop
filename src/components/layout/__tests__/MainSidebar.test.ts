import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  currentRoute: { value: { path: '/' } },
}));
const apiMock = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: () => ({ path: '/' }),
    useRouter: () => routerMock,
  };
});

vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: apiMock }));

import MainSidebar from '../MainSidebar.vue';
import { useSettingsStore } from '../../../stores/settings';
import * as routeTransition from '../../../utils/routeTransition';
import {
  HOME_TAB_REFRESH_EVENT,
  HOME_TAB_SCROLL_TOP_EVENT,
  resetHomeTabClickState,
} from '../../../utils/homeTab';

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="to" class="nav-item"><slot /></a>',
};

describe('MainSidebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    routerMock.currentRoute.value.path = '/';
    resetHomeTabClickState();
  });

  it('点击导航项时触发 triggerSidebarTransition', async () => {
    const spy = vi.spyOn(routeTransition, 'triggerSidebarTransition');
    const wrapper = mount(MainSidebar, {
      global: {
        stubs: {
          'router-link': RouterLinkStub,
        },
      },
    });

    const homeLink = wrapper.find('a[href="/"]');
    expect(homeLink.exists()).toBe(true);

    await homeLink.trigger('click');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('点击底部操作按钮（如反馈/更新）时不触发 triggerSidebarTransition', async () => {
    const spy = vi.spyOn(routeTransition, 'triggerSidebarTransition');
    const wrapper = mount(MainSidebar, {
      global: {
        stubs: {
          'router-link': RouterLinkStub,
        },
      },
    });

    const feedbackButton = wrapper.find('.feedback-btn');
    expect(feedbackButton.exists()).toBe(true);

    await feedbackButton.trigger('click');
    expect(spy).not.toHaveBeenCalled();
  });

  it('存在一键反馈与更新按钮并正常展示', async () => {
    const wrapper = mount(MainSidebar, {
      global: {
        stubs: {
          'router-link': RouterLinkStub,
        },
      },
    });

    const feedbackButton = wrapper.find('.feedback-btn');
    expect(feedbackButton.exists()).toBe(true);
    expect(feedbackButton.text()).toContain('反馈');
    await feedbackButton.trigger('click');
    const [issueUrl, target] = apiMock.openUrl.mock.calls[0]!;
    const issue = new URL(String(issueUrl));
    expect(`${issue.origin}${issue.pathname}`).toBe('https://github.com/coolapk-desktop/coolapk-desktop/issues/new');
    expect(issue.searchParams.get('body')).toContain('客户端版本：');
    expect(target).toBe('system');

    const updateButton = wrapper.find('.check-update-btn');
    expect(updateButton.exists()).toBe(true);
    expect(updateButton.text()).toContain('更新');
  });

  it('应用和下载不再作为左侧独立入口展示', () => {
    const wrapper = mount(MainSidebar, {
      global: {
        stubs: {
          'router-link': RouterLinkStub,
        },
      },
    });

    expect(wrapper.find('a[href="/apps"]').exists()).toBe(false);
    expect(wrapper.find('a[href="/downloads"]').exists()).toBe(false);
    expect(wrapper.find('a[href="/more"]').exists()).toBe(true);
  });

  it('底部快捷开关与设置渠道同步，关闭测试版后保留其他实验性功能', async () => {
    const settings = useSettingsStore();
    settings.settings.updateChannel = 'stable';
    settings.settings.experimentalFeatures = false;
    const wrapper = mount(MainSidebar, {
      global: { stubs: { 'router-link': RouterLinkStub } },
    });
    const button = wrapper.find('.beta-toggle-btn');
    expect(button.attributes('aria-pressed')).toBe('false');
    await button.trigger('click');
    expect(settings.settings.updateChannel).toBe('beta');
    expect(settings.settings.experimentalFeatures).toBe(true);
    expect(button.text()).toContain('已开启');
    await button.trigger('click');
    expect(settings.settings.updateChannel).toBe('stable');
    expect(settings.settings.experimentalFeatures).toBe(true);
    settings.settings.updateChannel = 'beta';
    await wrapper.vm.$nextTick();
    expect(button.attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
  });

  it('保留边界上的小圆形收起按钮，并能切换侧边栏状态', async () => {
    const wrapper = mount(MainSidebar, {
      global: {
        stubs: {
          'router-link': RouterLinkStub,
        },
      },
    });

    const toggleButton = wrapper.find('.sidebar-floating-toggle-btn');
    const homeLink = wrapper.find('a[href="/"]');
    expect(toggleButton.exists()).toBe(true);
    expect(homeLink.exists()).toBe(true);
    expect(toggleButton.classes()).toContain('sidebar-floating-toggle-btn');
    expect(toggleButton.attributes('title')).toBe('收起侧边栏');

    await toggleButton.trigger('click');
    expect(toggleButton.attributes('title')).toBe('展开侧边栏');
  });

  it('已在首页时单击「首页」回到顶部，不重复导航', async () => {
    const scrollTopSpy = vi.fn();
    window.addEventListener(HOME_TAB_SCROLL_TOP_EVENT, scrollTopSpy);
    const wrapper = mount(MainSidebar, {
      global: { stubs: { 'router-link': RouterLinkStub } },
    });

    await wrapper.find('a[href="/"]').trigger('click');

    expect(scrollTopSpy).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
    window.removeEventListener(HOME_TAB_SCROLL_TOP_EVENT, scrollTopSpy);
  });

  it('已在数码栏目时单击「数码」回到顶部，不重复导航', async () => {
    routerMock.currentRoute.value.path = '/digital';
    const scrollTopSpy = vi.fn();
    window.addEventListener(HOME_TAB_SCROLL_TOP_EVENT, scrollTopSpy);
    const main = document.createElement('div');
    main.className = 'app-main-content';
    const scroller = document.createElement('div');
    scroller.scrollTop = 520;
    main.appendChild(scroller);
    document.body.appendChild(main);
    const wrapper = mount(MainSidebar, {
      global: { stubs: { 'router-link': RouterLinkStub } },
    });
    try {
      await wrapper.find('a[href="/digital"]').trigger('click');
      expect(scrollTopSpy).toHaveBeenCalledTimes(1);
      expect(routerMock.push).not.toHaveBeenCalled();
      expect(scroller.scrollTop).toBe(0);
    } finally {
      wrapper.unmount();
      main.remove();
      window.removeEventListener(HOME_TAB_SCROLL_TOP_EVENT, scrollTopSpy);
    }
  });

  it('不在数码栏目时点击「数码」不接管导航', async () => {
    const scrollTopSpy = vi.fn();
    window.addEventListener(HOME_TAB_SCROLL_TOP_EVENT, scrollTopSpy);
    const wrapper = mount(MainSidebar, {
      global: { stubs: { 'router-link': RouterLinkStub } },
    });
    try {
      await wrapper.find('a[href="/digital"]').trigger('click');
      expect(scrollTopSpy).not.toHaveBeenCalled();
      expect(routerMock.push).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
      window.removeEventListener(HOME_TAB_SCROLL_TOP_EVENT, scrollTopSpy);
    }
  });

  it('已在首页时双击「首页」回到顶部并刷新当前栏目', async () => {
    const refreshSpy = vi.fn();
    window.addEventListener(HOME_TAB_REFRESH_EVENT, refreshSpy);
    const wrapper = mount(MainSidebar, {
      global: { stubs: { 'router-link': RouterLinkStub } },
    });

    const homeLink = wrapper.find('a[href="/"]');
    await homeLink.trigger('click');
    await homeLink.trigger('click');

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener(HOME_TAB_REFRESH_EVENT, refreshSpy);
  });
});
