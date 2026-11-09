import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

// 路由历史状态需要是响应式的，才能像真实路由那样驱动按钮状态变化。
const state = vi.hoisted(() => ({
  route: {} as { fullPath: string },
  history: {} as { back: string | null; forward: string | null },
  back: vi.fn(),
  forward: vi.fn(),
}));

vi.mock('vue-router', async (importOriginal) => {
  const { reactive } = await import('vue');
  state.route = reactive({ fullPath: '/feed/42' });
  state.history = reactive({ back: null, forward: null });
  return {
    ...(await importOriginal<typeof import('vue-router')>()),
    useRoute: () => state.route,
    useRouter: () => ({ options: { history: { state: state.history } }, back: state.back, forward: state.forward, push: vi.fn(), replace: vi.fn() }),
  };
});
vi.mock('../../../stores/app', () => ({ useAppStore: () => ({ openSearch: vi.fn(), openPublish: vi.fn() }) }));
vi.mock('../../../stores/auth', () => ({ useAuthStore: () => ({ isLoggedIn: false, user: null, openLoginModal: vi.fn(), logout: vi.fn() }) }));
vi.mock('../../../stores/notifications', () => ({
  useNotificationStore: () => ({ notificationCount: 0, messageCount: 0, unreadCount: 0, categoryCounts: {}, notificationStateVersion: 0, reset: vi.fn(), applyServerResponse: vi.fn(), suppressMessageCount: vi.fn() }),
}));
vi.mock('../../../stores/pageTabs', () => ({ usePageTabsStore: () => ({ tabs: [] }) }));
vi.mock('../../../stores/settings', () => ({
  useSettingsStore: () => ({
    settings: { theme: 'light', sidebarCollapsed: false, desktopNotifications: false, notificationPollInterval: 1, notifyReplies: false, notifyAt: false, notifyPm: false, notificationSound: false },
    resolvedTheme: 'light',
    setTheme: vi.fn(),
  }),
}));
vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: { getNotificationCount: vi.fn(), openUrl: vi.fn() } }));
vi.mock('../../../composables/useDesktopWindow', () => ({
  useDesktopWindow: () => ({ isMaximized: ref(false), usesMacOverlay: ref(false), showWindowControls: ref(false), minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }),
}));
vi.mock('../../../composables/useShortcutHints', () => ({ useShortcutHints: () => ref(false) }));
vi.mock('../../../utils/shortcuts', () => ({ usePlatformShortcuts: () => ({ formatShortcut: (value: string) => value }) }));
vi.mock('../../../utils/taskbarNotificationDot', () => ({ syncWindowsNotificationIcons: vi.fn() }));

import TopBar from '../TopBar.vue';

describe('顶部导航按钮状态', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    state.route.fullPath = '/feed/42';
    state.history.back = '/';
    state.history.forward = null;
  });

  it('前进目标就是当前路由时禁用前进按钮，与后退使用同一判据', async () => {
    state.history.back = '/feed/42';
    state.history.forward = '/feed/42';
    const wrapper = mount(TopBar);
    try {
      expect(wrapper.get('[aria-label="后退"]').attributes('disabled')).toBeDefined();
      expect(wrapper.get('[aria-label="前进"]').attributes('disabled')).toBeDefined();

      state.history.forward = '/feed/43';
      await wrapper.vm.$nextTick();
      expect(wrapper.get('[aria-label="前进"]').attributes('disabled')).toBeUndefined();

      state.history.back = '/';
      await wrapper.vm.$nextTick();
      expect(wrapper.get('[aria-label="后退"]').attributes('disabled')).toBeUndefined();
    } finally { wrapper.unmount(); }
  });
});
