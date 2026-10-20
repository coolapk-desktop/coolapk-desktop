import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computed, defineComponent, inject, nextTick, onMounted, ref } from 'vue';
import { desktopFeedCommentsOpenKey, openDesktopFeedCommentsKey } from '../../../utils/desktopFeedComments';
import { routeNavigationIsHistory } from '../../../utils/routeScroll';

const routeState = vi.hoisted(() => ({ controls: false, value: null as any, back: vi.fn(), replace: vi.fn(), history: { back: '/' as string | null } }));
vi.mock('../../../composables/useDesktopWindow', () => ({ useDesktopWindow: () => ({ showWindowControls: computed(() => routeState.value.controls), usesMacOverlay: ref(false) }) }));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  const { reactive } = await import('vue');
  routeState.value = reactive({ path: '/', fullPath: '/' });
  return {
    ...actual,
    useRoute: () => routeState.value,
    useRouter: () => ({ push: vi.fn(), back: routeState.back, replace: routeState.replace, options: { history: { state: routeState.history } } }),
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

import AppShell from '../AppShell.vue';
import { useSettingsStore } from '../../../stores/settings';
import { useAppStore } from '../../../stores/app';

const TopBarStub = { template: '<div class="top-bar-stub"><slot name="narrow-navigation" /></div>' };
const MainSidebarStub = { template: '<div class="main-sidebar-stub" />' };
const PageTabBarStub = { template: '<div class="page-tab-bar-stub" />' };
const NetworkStatusBannerStub = { template: '<div class="network-status-banner-stub" />' };
const MobileTopBarStub = { template: '<div class="mobile-top-bar-stub" />' };
const MobileBottomNavStub = { template: '<div class="mobile-bottom-nav-stub" />' };

describe('AppShell', () => {
  it.each([['/', 'feed-scroll-container'], ['/digital', 'digital-content'], ['/discover', 'discover-scroll-container']])('%s 从详情返回时恢复离开前的导航高度，继续反向滚动仍能展开', async (path, listClass) => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    Object.assign(routeState.value, { path, fullPath: path });
    const settings = useSettingsStore(); settings.settings.disableAutoMobileMode = false; settings.settings.autoHideMobileNavigation = true;
    const wrapper = mount(AppShell, { slots: { default: `<div class="mobile-home-pager"><div class="${listClass}">阅读内容</div></div>` }, global: { stubs: { TopBar: TopBarStub, MainSidebar: MainSidebarStub, PageTabBar: PageTabBarStub, NetworkStatusBanner: NetworkStatusBannerStub, MobileTopBar: MobileTopBarStub, MobileBottomNav: MobileBottomNavStub } } });
    try {
      const list = wrapper.get(`.${listClass}`);
      await list.trigger('wheel', { deltaY: 100 });
      (list.element as HTMLElement).scrollTop = 100; await list.trigger('scroll');
      expect(wrapper.classes()).toContain('reading-navigation-hidden');
      Object.assign(routeState.value, { path: '/feed/42', fullPath: '/feed/42?scrollTo=comments' }); await nextTick();
      expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
      routeNavigationIsHistory.value = true;
      Object.assign(routeState.value, { path, fullPath: path }); await nextTick();
      expect(wrapper.classes()).toContain('reading-navigation-hidden');
      expect((list.element as HTMLElement).scrollTop).toBe(100);
      await list.trigger('wheel', { deltaY: -20 });
      (list.element as HTMLElement).scrollTop = 80; await list.trigger('scroll');
      expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
    } finally { wrapper.unmount(); window.innerWidth = previousWidth; window.dispatchEvent(new Event('resize')); routeNavigationIsHistory.value = false; }
  });
  it.each(['Android', 'iPhone'])('%s 话题栏目吸顶后合并玻璃，离开吸顶位置或页面后恢复', async (device) => {
    vi.stubGlobal('navigator', { userAgent: device, platform: device, maxTouchPoints: 5 });
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    setActivePinia(createPinia());
    Object.assign(routeState.value, { path: '/topic/iOS', fullPath: '/topic/iOS', controls: false });
    const wrapper = mount(AppShell, { slots: { default: '<div class="page-container"><div class="topic-sticky-controls">讨论</div></div>' }, global: { stubs: { TopBar: TopBarStub, MainSidebar: MainSidebarStub, PageTabBar: PageTabBarStub, NetworkStatusBanner: NetworkStatusBannerStub, MobileTopBar: MobileTopBarStub, MobileBottomNav: MobileBottomNavStub } } });
    try {
      vi.spyOn(wrapper.get('.mobile-reading-topbar').element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 80));
      let controlsTop = 160;
      vi.spyOn(wrapper.get('.topic-sticky-controls').element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, controlsTop, 390, 100));
      await wrapper.get('.page-container').trigger('scroll');
      expect(wrapper.classes()).not.toContain('topic-glass-joined');
      controlsTop = 80;
      await wrapper.get('.page-container').trigger('scroll');
      expect(wrapper.classes()).toContain('topic-glass-joined');
      controlsTop = 160;
      await wrapper.get('.page-container').trigger('scroll');
      expect(wrapper.classes()).not.toContain('topic-glass-joined');
      controlsTop = 80;
      await wrapper.get('.page-container').trigger('scroll');
      routeState.value.path = routeState.value.fullPath = '/';
      await nextTick();
      expect(wrapper.classes()).not.toContain('topic-glass-joined');
    } finally { wrapper.unmount(); Object.defineProperty(window, 'innerWidth', { value: previousWidth, configurable: true, writable: true }); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it.each([
    ['/', 'feed-scroll-container', '<div class="mobile-home-pager"><section aria-hidden="false"><div class="feed-scroll-container">阅读内容</div></section></div>'],
    ['/digital', 'digital-content', '<div class="digital-page"><nav class="digital-side-list">分类</nav><section aria-hidden="false"><div class="digital-content">阅读内容</div></section><section inert aria-hidden="true"><div class="digital-content background-list">后台栏目</div></section></div>'],
    ['/digital', 'digital-server-content', '<div class="digital-page"><div class="digital-server-content">阅读内容</div></div>'],
    ['/discover', 'discover-scroll-container', '<div class="discovery-pager"><section aria-hidden="false"><div class="discover-scroll-container">阅读内容</div></section><section inert aria-hidden="true"><div class="discover-scroll-container background-list">后台栏目</div></section></div>'],
  ])('%s 的 %s 滚动收起，反向滚动、浮层、设置和布局切换恢复导航', async (path, className, content) => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    setActivePinia(createPinia());
    routeState.value.path = routeState.value.fullPath = path;
    routeState.value.controls = true;
    const settings = useSettingsStore(), app = useAppStore();
    settings.settings.disableAutoMobileMode = false;
    const wrapper = mount(AppShell, { slots: { default: content }, global: { stubs: {
      TopBar: TopBarStub, MainSidebar: MainSidebarStub, PageTabBar: PageTabBarStub,
      NetworkStatusBanner: NetworkStatusBannerStub, MobileTopBar: MobileTopBarStub, MobileBottomNav: MobileBottomNavStub,
    } } });
    try {
      const list = wrapper.get(`.${className}`);
      const background = wrapper.find('.background-list');
      if (background.exists()) {
        await background.trigger('wheel', { deltaY: 100 });
        (background.element as HTMLElement).scrollTop = 100;
        await background.trigger('scroll');
        expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
      }
      const sidebar = wrapper.find('.digital-side-list');
      if (sidebar.exists()) {
        await sidebar.trigger('wheel', { deltaY: 100 });
        (sidebar.element as HTMLElement).scrollTop = 100;
        await sidebar.trigger('scroll');
        expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
      }
      const hide = async () => {
        (list.element as HTMLElement).scrollTop = 0;
        await list.trigger('scroll');
        await list.trigger('wheel', { deltaY: 100 });
        (list.element as HTMLElement).scrollTop = 100;
        await list.trigger('scroll');
        expect(wrapper.classes()).toContain('reading-navigation-hidden');
        expect(wrapper.get('.mobile-reading-topbar-content').attributes('aria-hidden')).toBe('true');
        expect(wrapper.find('.top-bar-stub').exists()).toBe(true);
      };
      await hide();
      await list.trigger('wheel', { deltaY: -30 });
      (list.element as HTMLElement).scrollTop = 70;
      await list.trigger('scroll');
      expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
      await hide(); app.isSearchOpen = true; await nextTick();
      expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
      expect(wrapper.get('.mobile-reading-topbar-content').attributes('inert')).toBeUndefined();
      app.isSearchOpen = false; await nextTick(); await hide();
      app.isPublishOpen = true; await nextTick(); expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
      app.isPublishOpen = false; await nextTick(); await hide();
      settings.settings.autoHideMobileNavigation = false; await nextTick(); expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
      settings.settings.autoHideMobileNavigation = true; await nextTick(); await hide();
      routeState.value.path = routeState.value.fullPath = '/me'; await nextTick();
      expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
      routeState.value.path = routeState.value.fullPath = path; await nextTick(); await hide();
      window.innerWidth = 1280; window.dispatchEvent(new Event('resize')); await nextTick();
      expect(wrapper.classes()).not.toContain('reading-navigation-hidden');
    } finally { wrapper.unmount(); window.innerWidth = previousWidth; window.dispatchEvent(new Event('resize')); }
  });

  it('桌面窄窗口在固定标题栏返回，宽窗口和移动平台不增加入口', async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true, writable: true });
    Object.assign(routeState.value, { path: '/feed/42', fullPath: '/feed/42', controls: true });
    const wrapper = mount(AppShell, { global: { stubs: { TopBar: TopBarStub, MainSidebar: MainSidebarStub, PageTabBar: PageTabBarStub, NetworkStatusBanner: NetworkStatusBannerStub, MobileTopBar: MobileTopBarStub, MobileBottomNav: MobileBottomNavStub } } });
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(wrapper.find('.top-bar-stub .narrow-titlebar-back').exists()).toBe(true);
    wrapper.get('main').element.scrollTop = 3000;
    await wrapper.get('.narrow-titlebar-back').trigger('click');
    expect(routeState.back).toHaveBeenCalledOnce();
    routeState.history.back = null;
    await wrapper.get('.narrow-titlebar-back').trigger('click');
    expect(routeState.replace).toHaveBeenCalledWith('/');
    routeState.value.controls = false;
    await nextTick();
    expect(wrapper.find('.narrow-titlebar-back').exists()).toBe(false);
    routeState.value.controls = true;
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true, writable: true });
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(wrapper.find('.narrow-titlebar-back').exists()).toBe(false);
    wrapper.unmount();
    Object.defineProperty(window, 'innerWidth', { value: previousWidth, configurable: true, writable: true });
  });
  it('普通列表打开右侧评论保留页面实例，关闭侧栏、设置与导航清除侧栏', async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true, writable: true });
    const Page = defineComponent({ setup() {
      const openComments = inject(openDesktopFeedCommentsKey)!;
      const commentsOpen = inject(desktopFeedCommentsOpenKey)!;
      return { openComments, commentsOpen };
    }, template: '<div :data-comments-open="commentsOpen"><button class="open-right-comments" @click="openComments({ id: \'42\', message: \'正文\' })">评论</button></div>' });
    const wrapper = mount(AppShell, { slots: { default: Page }, global: { stubs: {
      TopBar: TopBarStub, MainSidebar: MainSidebarStub, PageTabBar: PageTabBarStub,
      NetworkStatusBanner: NetworkStatusBannerStub, MobileTopBar: MobileTopBarStub, MobileBottomNav: MobileBottomNavStub,
      DesktopFeedCommentPanel: { props: ['feed'], template: '<aside class="right-comments-stub">{{ feed.id }}<button @click="$emit(\'close\')">关闭</button></aside>' },
    } } });
    const settings = useSettingsStore();
    settings.settings.desktopFeedDetailOnClick = false;
    settings.settings.desktopCommentsOnRight = true;
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    const page = wrapper.get('.open-right-comments').element;
    expect(wrapper.get('[data-comments-open]').attributes('data-comments-open')).toBe('false');
    await wrapper.get('.open-right-comments').trigger('click');
    expect(wrapper.get('[data-comments-open]').attributes('data-comments-open')).toBe('true');
    expect(wrapper.get('.right-comments-stub').text()).toContain('42');
    expect(wrapper.get('.open-right-comments').element).toBe(page);
    await wrapper.get('.right-comments-stub button').trigger('click');
    expect(wrapper.find('.right-comments-stub').exists()).toBe(false);
    expect(wrapper.get('[data-comments-open]').attributes('data-comments-open')).toBe('false');
    await wrapper.get('.open-right-comments').trigger('click');
    settings.settings.desktopCommentsOnRight = false;
    await nextTick();
    expect(wrapper.find('.right-comments-stub').exists()).toBe(false);
    expect(wrapper.get('[data-comments-open]').attributes('data-comments-open')).toBe('false');
    settings.settings.desktopCommentsOnRight = true;
    await nextTick();
    await wrapper.get('.open-right-comments').trigger('click');
    Object.assign(routeState.value, { path: '/discover', fullPath: '/discover' });
    await nextTick();
    expect(wrapper.find('.right-comments-stub').exists()).toBe(false);
    expect(wrapper.get('[data-comments-open]').attributes('data-comments-open')).toBe('false');
    Object.assign(routeState.value, { path: '/', fullPath: '/' });
    await nextTick();
    await wrapper.get('.open-right-comments').trigger('click');
    Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true, writable: true });
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(wrapper.find('.right-comments-stub').exists()).toBe(false);
    expect(wrapper.get('[data-comments-open]').attributes('data-comments-open')).toBe('false');
    wrapper.unmount();
    Object.defineProperty(window, 'innerWidth', { value: previousWidth, configurable: true, writable: true });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    routeNavigationIsHistory.value = false;
    setActivePinia(createPinia());
    vi.clearAllMocks();
    Object.assign(routeState.value, { path: '/', fullPath: '/', controls: false });
    routeState.history.back = '/';
  });

  it.each([['iPhone', true], ['Macintosh', true], ['Android', false], ['Windows', false]] as const)('%s 内容页返回手势按平台启用，浮层打开时不穿透', async (device, supported) => {
    vi.stubGlobal('navigator', { userAgent: device, platform: device, maxTouchPoints: 5 });
    Object.assign(routeState.value, { path: '/feed/42', fullPath: '/feed/42' });
    const wrapper = mount(AppShell, { global: { stubs: { TopBar: TopBarStub, MainSidebar: MainSidebarStub,
      PageTabBar: PageTabBarStub, NetworkStatusBanner: NetworkStatusBannerStub,
      MobileTopBar: MobileTopBarStub, MobileBottomNav: MobileBottomNavStub } } });
    await nextTick();
    const surface = wrapper.get('main').element;
    function swipe() {
      for (const [type, x] of [['touchstart', 10], ['touchmove', 110], ['touchend', 110]] as const) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        const point = { clientX: x, clientY: 100, identifier: 0 };
        Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } });
        surface.dispatchEvent(event);
      }
    }
    swipe();
    if (!supported) {
      expect(routeState.back).not.toHaveBeenCalled();
      expect(routeState.replace).not.toHaveBeenCalled();
      wrapper.unmount();
      return;
    }
    expect(routeState.back).toHaveBeenCalledOnce();
    useAppStore().openSearch();
    swipe();
    expect(routeState.back).toHaveBeenCalledOnce();
    useAppStore().closeSearch();
    const dialog = document.createElement('div');
    dialog.className = 'dialog-wrapper';
    document.body.appendChild(dialog);
    swipe();
    expect(routeState.back).toHaveBeenCalledOnce();
    dialog.remove();
    routeState.history.back = null;
    swipe();
    expect(routeState.replace).toHaveBeenCalledWith('/');
    Object.assign(routeState.value, { path: '/', fullPath: '/' });
    swipe();
    expect(routeState.back).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it.each(['/digital', '/discover', '/me', '/messages', '/feed/123', '/settings/appearance', '/favorites', '/user/123', '/search'])('%s 切换布局保留路由内容实例、输入和滚动状态', async path => {
    Object.assign(routeState.value, { path, fullPath: path });
    const load = vi.fn();
    const Page = defineComponent({ setup() { onMounted(load); }, template: '<div class="page-state"><input value="未发送的内容" /></div>' });
    const wrapper = mount(AppShell, {
      slots: { default: Page },
      global: { stubs: { TopBar: TopBarStub, MainSidebar: MainSidebarStub, PageTabBar: PageTabBarStub,
        NetworkStatusBanner: NetworkStatusBannerStub, MobileTopBar: MobileTopBarStub, MobileBottomNav: MobileBottomNavStub } },
    });
    const original = wrapper.find('.page-state').element;
    original.scrollTop = 320;
    const settings = useSettingsStore();
    for (const disabled of [true, false, true, false]) {
      settings.settings.disableAutoMobileMode = disabled;
      window.dispatchEvent(new Event('resize'));
      await nextTick();
      expect(wrapper.find('.page-state').element).toBe(original);
      expect(original.scrollTop).toBe(320);
      expect((wrapper.find('input').element as HTMLInputElement).value).toBe('未发送的内容');
      expect(load).toHaveBeenCalledTimes(1);
    }
    wrapper.unmount();
  });

  it('四个主栏目显示底栏，子页面隐藏，返回主栏目恢复', async () => {
    const wrapper = mount(AppShell, {
      global: { stubs: { TopBar: TopBarStub, MainSidebar: MainSidebarStub,
        PageTabBar: PageTabBarStub, NetworkStatusBanner: NetworkStatusBannerStub,
        MobileTopBar: MobileTopBarStub, MobileBottomNav: MobileBottomNavStub } },
    });
    for (const path of ['/digital', '/discover', '/me', '/', '/messages', '/messages?uid=123',
      '/feed/123', '/settings/appearance', '/my-plugins', '/my-plugins/store', '/favorites', '/user/123', '/search']) {
      Object.assign(routeState.value, { path: path.split('?')[0], fullPath: path });
      await nextTick();
      const visible = ['/', '/digital', '/discover', '/me'].includes(path);
      expect(wrapper.findComponent(MobileBottomNavStub).exists(), path).toBe(visible);
      expect(wrapper.classes().includes('has-mobile-bottom-nav'), path).toBe(visible);
    }
    Object.assign(routeState.value, { path: '/me', fullPath: '/me' });
    await nextTick();
    expect(wrapper.findComponent(MobileBottomNavStub).exists()).toBe(true);
    wrapper.unmount();
  });

  it('默认状态下渲染移动端顶栏和底栏，且不包含 prevent-mobile-layout 类名', () => {
    const wrapper = mount(AppShell, {
      global: {
        stubs: {
          TopBar: TopBarStub,
          MainSidebar: MainSidebarStub,
          PageTabBar: PageTabBarStub,
          NetworkStatusBanner: NetworkStatusBannerStub,
          MobileTopBar: MobileTopBarStub,
          MobileBottomNav: MobileBottomNavStub,
        },
      },
    });

    expect(wrapper.classes()).not.toContain('prevent-mobile-layout');
    expect(wrapper.findComponent(MobileTopBarStub).exists()).toBe(true);
    expect(wrapper.findComponent(MobileBottomNavStub).exists()).toBe(true);
  });

  it('开启 disableAutoMobileMode 时隐藏移动端顶栏和底栏，且添加 prevent-mobile-layout 类名', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const settingsStore = useSettingsStore(pinia);
    settingsStore.settings.disableAutoMobileMode = true;

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia],
        stubs: {
          TopBar: TopBarStub,
          MainSidebar: MainSidebarStub,
          PageTabBar: PageTabBarStub,
          NetworkStatusBanner: NetworkStatusBannerStub,
          MobileTopBar: MobileTopBarStub,
          MobileBottomNav: MobileBottomNavStub,
        },
      },
    });

    expect(wrapper.classes()).toContain('prevent-mobile-layout');
    expect(wrapper.findComponent(MobileTopBarStub).exists()).toBe(false);
    expect(wrapper.findComponent(MobileBottomNavStub).exists()).toBe(false);
  });
});
