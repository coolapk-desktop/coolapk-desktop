import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import DeviceSettingsPage from '../DeviceSettingsPage.vue';
import { useSettingsStore } from '../../../stores/settings';
import { confirmationState, settleConfirmation } from '../../../utils/confirm';
import type { UnsavedChangesGuardOptions } from '../../../utils/useUnsavedChangesGuard';

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

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setAlwaysOnTop: vi.fn(async () => undefined), setTheme: vi.fn(async () => undefined) }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => ({ code: 404 })),
  isTauri: vi.fn(() => false),
}));

vi.mock('../../../utils/devicePresets', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../utils/devicePresets')>(),
  loadDevicePresets: vi.fn().mockResolvedValue([]),
}));

// 页面侧只负责提供脏判断与丢弃回调，确认弹窗/路由/页签的接线由 useUnsavedChangesGuard
// 自身的测试覆盖；这里捕获 options 做精确断言。
const guardOptions = vi.hoisted(() => [] as UnsavedChangesGuardOptions[]);
vi.mock('../../../utils/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: vi.fn((options: UnsavedChangesGuardOptions) => {
    guardOptions.push(options);
    return vi.fn(async () => true);
  }),
}));

const invokeMock = vi.mocked(invoke);

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(DeviceSettingsPage, { global: { plugins: [pinia] } });
  return { wrapper, store: useSettingsStore(pinia) };
}

function lastGuard(): UnsavedChangesGuardOptions {
  return guardOptions[guardOptions.length - 1];
}

describe('设备信息页设备 ID 未保存守卫', () => {
  beforeEach(() => {
    guardOptions.length = 0;
    fileStoreState.values.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ code: 404 });
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { metadata: {} };
  });

  it('粘贴合法设备 ID 后守卫判定为有未保存修改，保存后不再拦截', async () => {
    const { wrapper, store } = mountPage();
    await flushPromises();
    const guard = lastGuard();
    // 空输入不算脏。
    expect(guard.hasUnsavedChanges()).toBe(false);

    const input = wrapper.find('.device-id-input-row input');
    await input.setValue('DU1234567890abcd');
    expect(guard.hasUnsavedChanges()).toBe(true);

    // 保存后输入与已保存值一致，不应再拦截用户离开。
    store.settings.deviceFingerprint.deviceId = 'DU1234567890abcd';
    await flushPromises();
    expect(guard.hasUnsavedChanges()).toBe(false);
    wrapper.unmount();
  });

  it('输入解析出的 ID 与已保存值一致时不视为脏状态', async () => {
    const { wrapper, store } = mountPage();
    await flushPromises();
    const guard = lastGuard();
    store.settings.deviceFingerprint.deviceId = 'DU1234567890abcd';
    await flushPromises();
    // 粘贴的是包含已保存 ID 的完整日志时，离开不会丢任何东西，不应弹确认。
    await wrapper.find('.device-id-input-row input').setValue('DU1234567890abcd');
    expect(guard.hasUnsavedChanges()).toBe(false);
    wrapper.unmount();
  });

  it('确认放弃后输入框回到已保存的设备 ID，而不是保留草稿', async () => {
    const { wrapper, store } = mountPage();
    await flushPromises();
    const guard = lastGuard();
    store.settings.deviceFingerprint.deviceId = 'DUsaved12345678';
    await flushPromises();
    await wrapper.find('.device-id-input-row input').setValue('DUchanged9876543');
    guard.onDiscard?.();
    await flushPromises();
    expect((wrapper.find('.device-id-input-row input').element as HTMLInputElement).value).toBe('DUsaved12345678');
    wrapper.unmount();
  });

  it('设备 ID 区标注需点击保存，机型区标注自动同步，保存时机不改', async () => {
    const { wrapper } = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('需点击【保存】按钮');
    expect(wrapper.text()).toContain('自动同步');
    // 行为不变：机型字段仍由用户直接编辑 store 值（即时同步），设备 ID 仍需显式保存。
    wrapper.unmount();
  });
});

describe('恢复默认设备指纹确认', () => {
  beforeEach(() => {
    guardOptions.length = 0;
    fileStoreState.values.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ code: 404 });
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { metadata: {} };
  });

  it('未确认时不重置任何字段，确认后重置机型但保留设备 ID', async () => {
    const { wrapper, store } = mountPage();
    await flushPromises();
    store.settings.deviceFingerprint.customFingerprint = true;
    store.settings.deviceFingerprint.model = 'MyCustomModel';
    store.settings.deviceFingerprint.deviceId = 'DUkeep123456789';
    await flushPromises();

    await wrapper.find('.reset-button').trigger('click');
    await flushPromises();
    expect(confirmationState.isOpen).toBe(true);
    expect(store.settings.deviceFingerprint.model).toBe('MyCustomModel');

    settleConfirmation(false);
    await flushPromises();
    expect(store.settings.deviceFingerprint.model).toBe('MyCustomModel');

    await wrapper.find('.reset-button').trigger('click');
    await flushPromises();
    settleConfirmation(true);
    await flushPromises();
    expect(store.settings.deviceFingerprint.model).toBe('23113RKC6C');
    expect(store.settings.deviceFingerprint.deviceId).toBe('DUkeep123456789');
    wrapper.unmount();
  });
});
