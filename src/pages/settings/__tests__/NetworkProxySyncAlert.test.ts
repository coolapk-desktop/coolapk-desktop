import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import NetworkSettingsPage from '../NetworkSettingsPage.vue';
import { useSettingsStore } from '../../../stores/settings';

const fileStoreState = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const store = {
    entries: async <T>() => Array.from(values.entries()) as Array<[string, T]>,
    keys: async () => Array.from(values.keys()),
    set: async (key: string, value: unknown) => { values.set(key, value); },
    delete: async (key: string) => values.delete(key),
    save: vi.fn(async () => undefined),
  };
  return { values, load: vi.fn(async () => store) };
});

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: fileStoreState.load } }));

const windowMocks = vi.hoisted(() => ({
  setAlwaysOnTop: vi.fn(async () => undefined),
  setTheme: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => windowMocks }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (_cmd: string, _args?: unknown) => undefined),
  isTauri: vi.fn(() => true),
}));

const invokeMock = vi.mocked(invoke);

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(NetworkSettingsPage, { global: { plugins: [pinia] } });
  return { wrapper, store: useSettingsStore(pinia) };
}

describe('网络设置页代理同步失败告警', () => {
  beforeEach(() => {
    fileStoreState.values.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { metadata: {} };
  });

  it('启动同步失败时显示告警与重新应用入口，且不误报未保存修改', async () => {
    fileStoreState.values.set('networkProxyUrl', 'http://127.0.0.1:7890');
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'set_network_proxy') throw new Error('backend unavailable');
      return undefined;
    });
    const { wrapper } = mountPage();
    await flushPromises();

    const alert = wrapper.find('.proxy-sync-alert');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('代理设置未能同步到后端');
    expect(alert.text()).toContain('重新应用');
    // 生效告警与未保存修改是两个语义：草稿为空时不应出现未保存提示。
    expect(wrapper.text()).not.toContain('有未保存的修改');
    wrapper.unmount();
  });

  it('点击重新应用成功后告警消失', async () => {
    fileStoreState.values.set('networkProxyUrl', 'http://127.0.0.1:7890');
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'set_network_proxy') throw new Error('backend unavailable');
      return undefined;
    });
    const { wrapper, store } = mountPage();
    await flushPromises();
    expect(wrapper.find('.proxy-sync-alert').exists()).toBe(true);

    invokeMock.mockResolvedValue(undefined);
    await wrapper.find('.proxy-sync-alert button').trigger('click');
    await flushPromises();
    expect(store.proxySyncFailed).toBe(false);
    expect(wrapper.find('.proxy-sync-alert').exists()).toBe(false);
    wrapper.unmount();
  });

  it('同步正常时不显示告警', async () => {
    fileStoreState.values.set('networkProxyUrl', 'http://127.0.0.1:7890');
    const { wrapper } = mountPage();
    await flushPromises();
    expect(wrapper.find('.proxy-sync-alert').exists()).toBe(false);
    wrapper.unmount();
  });
});
