import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
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

const toastMocks = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../../utils/toast', () => ({ showToast: toastMocks.showToast }));

const invokeMock = vi.mocked(invoke);

function failCommands(commands: string[]) {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (commands.includes(cmd)) throw new Error('backend unavailable');
    return undefined;
  });
}

describe('settings store 托盘/置顶/启动参数原生同步失败可见性', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fileStoreState.values.clear();
    toastMocks.showToast.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    windowMocks.setAlwaysOnTop.mockReset();
    windowMocks.setAlwaysOnTop.mockResolvedValue(undefined);
    (window as any).__TAURI_INTERNALS__ = { metadata: {} };
  });

  it('关闭到托盘同步失败时提示一次且标记未生效，恢复成功后复位、再失败可重新提示', async () => {
    failCommands(['set_close_to_tray']);
    const store = useSettingsStore();
    await store.initializeSettings();
    // 启动同步失败：用户可见一条告警，开关值不被回滚。
    expect(store.traySyncFailed).toBe(true);
    expect(toastMocks.showToast).toHaveBeenCalledTimes(1);
    expect(String(toastMocks.showToast.mock.calls[0]![0])).toContain('关闭到托盘');
    expect(toastMocks.showToast.mock.calls[0]![1]).toBe('warning');

    // 同一失败周期内再次失败（重试开关），不重复弹窗刷屏。
    store.settings.closeToTray = !store.settings.closeToTray;
    await flushPromises();
    expect(toastMocks.showToast).toHaveBeenCalledTimes(1);
    expect(store.traySyncFailed).toBe(true);

    // 恢复成功：失败标记复位。
    failCommands([]);
    store.settings.closeToTray = !store.settings.closeToTray;
    await flushPromises();
    expect(store.traySyncFailed).toBe(false);

    // 再次失败：可以重新提示（新失败周期）。
    failCommands(['set_close_to_tray']);
    store.settings.closeToTray = !store.settings.closeToTray;
    await flushPromises();
    expect(store.traySyncFailed).toBe(true);
    expect(toastMocks.showToast).toHaveBeenCalledTimes(2);
  });

  it('窗口置顶失败时提示一次且标记未生效', async () => {
    const store = useSettingsStore();
    await store.initializeSettings();
    expect(store.alwaysOnTopSyncFailed).toBe(false);

    windowMocks.setAlwaysOnTop.mockRejectedValueOnce(new Error('compositor denied'));
    store.settings.alwaysOnTop = !store.settings.alwaysOnTop;
    await flushPromises();

    expect(store.alwaysOnTopSyncFailed).toBe(true);
    const toasts = toastMocks.showToast.mock.calls.filter(([msg]) => String(msg).includes('置顶'));
    expect(toasts).toHaveLength(1);
    expect(toasts[0]![1]).toBe('warning');
  });

  it('窗口置顶成功后失败标记复位', async () => {
    const store = useSettingsStore();
    await store.initializeSettings();

    windowMocks.setAlwaysOnTop.mockRejectedValueOnce(new Error('compositor denied'));
    store.settings.alwaysOnTop = !store.settings.alwaysOnTop;
    await flushPromises();
    expect(store.alwaysOnTopSyncFailed).toBe(true);

    store.settings.alwaysOnTop = !store.settings.alwaysOnTop;
    await flushPromises();
    expect(store.alwaysOnTopSyncFailed).toBe(false);
  });

  it('启动参数同步失败时提示一次且标记未生效', async () => {
    failCommands(['set_startup_flags']);
    const store = useSettingsStore();
    await store.initializeSettings();
    expect(store.startupFlagsSyncFailed).toBe(true);
    const toasts = toastMocks.showToast.mock.calls.filter(([msg]) => String(msg).includes('启动参数'));
    expect(toasts).toHaveLength(1);
    expect(toasts[0]![1]).toBe('warning');

    // 同一失败周期内再次失败不重复提示。
    store.settings.rememberWindowState = !store.settings.rememberWindowState;
    await flushPromises();
    expect(toasts).toHaveLength(1);
  });
});
