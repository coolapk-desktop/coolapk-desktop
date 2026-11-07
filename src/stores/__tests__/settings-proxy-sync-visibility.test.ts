import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settings';

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

/** 让 invoke 对指定命令失败，其余命令保持成功，模拟后端 set_network_proxy 异常。 */
function failCommands(commands: string[]) {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (commands.includes(cmd)) throw new Error('backend unavailable');
    return undefined;
  });
}

describe('settings store 代理同步失败可见性', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fileStoreState.values.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { metadata: {} };
  });

  it('启动同步 set_network_proxy 失败时标记未生效，且不推翻已保存的代理地址', async () => {
    fileStoreState.values.set('networkProxyUrl', 'http://127.0.0.1:7890');
    failCommands(['set_network_proxy']);
    const store = useSettingsStore();
    await store.initializeSettings();
    expect(store.proxySyncFailed).toBe(true);
    // 失败只暴露状态，用户已保存的地址必须原样保留。
    expect(store.settings.networkProxyUrl).toBe('http://127.0.0.1:7890');
  });

  it('启动同步成功时标记已生效', async () => {
    fileStoreState.values.set('networkProxyUrl', 'http://127.0.0.1:7890');
    const store = useSettingsStore();
    await store.initializeSettings();
    expect(store.proxySyncFailed).toBe(false);
  });

  it('重新应用成功后失败状态清除，已保存地址不变', async () => {
    fileStoreState.values.set('networkProxyUrl', 'http://127.0.0.1:7890');
    failCommands(['set_network_proxy']);
    const store = useSettingsStore();
    await store.initializeSettings();
    expect(store.proxySyncFailed).toBe(true);

    failCommands([]);
    await expect(store.reapplyNetworkProxy()).resolves.toBe(true);
    expect(store.proxySyncFailed).toBe(false);
    expect(store.settings.networkProxyUrl).toBe('http://127.0.0.1:7890');
    // 重新应用使用的是已保存地址。
    const proxyCall = invokeMock.mock.calls.find(([cmd]) => cmd === 'set_network_proxy');
    expect(proxyCall?.[1]).toMatchObject({ proxyUrl: 'http://127.0.0.1:7890' });
  });

  it('重新应用仍失败时保持未生效标记', async () => {
    fileStoreState.values.set('networkProxyUrl', 'http://127.0.0.1:7890');
    failCommands(['set_network_proxy']);
    const store = useSettingsStore();
    await store.initializeSettings();
    await expect(store.reapplyNetworkProxy()).resolves.toBe(false);
    expect(store.proxySyncFailed).toBe(true);
    expect(store.settings.networkProxyUrl).toBe('http://127.0.0.1:7890');
  });
});
