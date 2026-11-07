import { defineComponent, ref, type Component } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChangesGuard } from '../useUnsavedChangesGuard';
import { usePageTabsStore } from '../../stores/pageTabs';
import { requestConfirmation } from '../confirm';

// 确认弹窗与 UI 解耦：这里直接 mock，只关心守卫何时调用它、以及返回值如何驱动后续行为。
vi.mock('../confirm', () => ({ requestConfirmation: vi.fn() }));

function makeHarness(dirty: { value: boolean }) {
  const discard = vi.fn();
  const Comp = defineComponent({
    name: 'GuardHarness',
    setup() {
      const guard = useUnsavedChangesGuard({
        hasUnsavedChanges: () => dirty.value,
        title: '放弃修改？',
        message: '测试消息',
        onDiscard: discard
      });
      return { guard };
    },
    template: '<div />'
  });
  return { discard, Comp };
}

// onBeforeRouteLeave 只在 <router-view> 内的组件上生效，因此统一通过路由宿主挂载。
async function mountWithRouter(Comp: Component, existingPinia?: ReturnType<typeof createPinia>) {
  const pinia = existingPinia ?? createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/network', name: 'SettingsNetwork', component: Comp },
      { path: '/home', name: 'Home', component: { template: '<div />' } }
    ]
  });
  router.push('/settings/network');
  await router.isReady();
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return { router, wrapper, pinia };
}

beforeEach(() => {
  vi.mocked(requestConfirmation).mockReset();
});

describe('useUnsavedChangesGuard', () => {
  it('无脏状态时直接放行且不弹确认', async () => {
    const dirty = ref(false);
    const { Comp } = makeHarness(dirty);
    const { wrapper, router } = await mountWithRouter(Comp);
    try {
      await router.push('/home');
      await flushPromises();
      expect(router.currentRoute.value.name).toBe('Home');
      expect(requestConfirmation).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('有脏状态时弹确认：确认后丢弃草稿并放行', async () => {
    const dirty = ref(true);
    const { Comp, discard } = makeHarness(dirty);
    const { wrapper, router } = await mountWithRouter(Comp);
    try {
      vi.mocked(requestConfirmation).mockResolvedValue(true);
      await router.push('/home');
      await flushPromises();
      expect(requestConfirmation).toHaveBeenCalledTimes(1);
      expect(discard).toHaveBeenCalledTimes(1);
      expect(router.currentRoute.value.name).toBe('Home');
    } finally { wrapper.unmount(); }
  });

  it('有脏状态时弹确认：取消则留下且不丢弃', async () => {
    const dirty = ref(true);
    const { Comp, discard } = makeHarness(dirty);
    const { wrapper, router } = await mountWithRouter(Comp);
    try {
      vi.mocked(requestConfirmation).mockResolvedValue(false);
      await router.push('/home');
      await flushPromises();
      expect(requestConfirmation).toHaveBeenCalledTimes(1);
      expect(discard).not.toHaveBeenCalled();
      expect(router.currentRoute.value.name).toBe('SettingsNetwork');
    } finally { wrapper.unmount(); }
  });

  it('页签关闭守卫只注册一次，卸载时注销且不再拦截', async () => {
    const dirty = ref(true);
    const { Comp } = makeHarness(dirty);
    const { wrapper, router, pinia } = await mountWithRouter(Comp);
    try {
      const tabsStore = usePageTabsStore(pinia);
      // openSaved 只接受已保存页，这里直接注入一条待关闭标签以驱动 closeTab 守卫链路。
      tabsStore.tabs.push({ id: 'settings', route: '/settings/network', title: '设置', icon: '', closable: true, generation: 0, pinned: false, favorite: false });
      const registerSpy = vi.spyOn(tabsStore, 'registerTabCloseGuard');
      const unregisterSpy = vi.spyOn(tabsStore, 'unregisterTabCloseGuard');

      // 卸载后重挂（复用同一 pinia，store 才是同一实例）：同一标签同一时刻只应有一份守卫注册。
      wrapper.unmount();
      const second = await mountWithRouter(Comp, pinia);
      await flushPromises();
      expect(registerSpy).toHaveBeenCalledTimes(1);
      const registeredId = registerSpy.mock.calls[0][0];

      // 卸载后守卫被注销：再次关闭页签不会触发确认弹窗。
      vi.mocked(requestConfirmation).mockResolvedValue(false);
      second.wrapper.unmount();
      expect(unregisterSpy).toHaveBeenCalledWith(registeredId);
      await tabsStore.closeTab('settings');
      await flushPromises();
      expect(requestConfirmation).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('无路由环境（直接挂载）也安全：挂载/卸载不报错，页签守卫仍成对注册', async () => {
    const dirty = ref(false);
    const { Comp, discard } = makeHarness(dirty);
    const pinia = createPinia();
    setActivePinia(pinia);
    const tabsStore = usePageTabsStore(pinia);
    const registerSpy = vi.spyOn(tabsStore, 'registerTabCloseGuard');
    const unregisterSpy = vi.spyOn(tabsStore, 'unregisterTabCloseGuard');
    const wrapper = mount(Comp);
    await flushPromises();
    // 无路由时 useRoute 返回 undefined，走 'settings' 兜底 id；注册与注销仍成对发生。
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(requestConfirmation).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(unregisterSpy).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
  });
});
