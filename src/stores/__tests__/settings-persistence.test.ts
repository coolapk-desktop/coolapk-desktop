import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { normalizeSettings, useSettingsStore } from '../../stores/settings';
import { showToast } from '../../utils/toast';

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/toast', () => ({ showToast: toastMock }));

const fileStoreState = vi.hoisted(() => {
  const behavior = { rejectSave: false };
  const values = new Map<string, unknown>();
  const store = {
    entries: async <T>() => Array.from(values.entries()) as Array<[string, T]>,
    keys: async () => Array.from(values.keys()),
    set: async (key: string, value: unknown) => { values.set(key, value); },
    delete: async (key: string) => values.delete(key),
    save: vi.fn(async () => { if (behavior.rejectSave) throw new Error('disk full'); }),
  };
  return { values, store, behavior, load: vi.fn(async () => store) };
});
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: fileStoreState.load } }));

describe('settings 持久化失败可见性与设备信息防抖同步', () => {
  beforeEach(async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    delete (window as any).__TAURI_INTERNALS__;
    fileStoreState.values.clear();
    fileStoreState.behavior.rejectSave = false;
    fileStoreState.load.mockClear();
    fileStoreState.store.save.mockClear();
    vi.mocked(invoke).mockClear();
    toastMock.mockClear();
    // notifyPersistenceFailure 的去重标记是模块级状态：先做一次成功保存将其复位，
    // 避免上一个用例的失败周期影响当前用例。
    const warmup = useSettingsStore();
    // 用 light 复位去重标记，且不占用用例里要切换的 dark/light 值。
    warmup.settings.theme = 'light';
    await nextTick();
    setActivePinia(createPinia());
  });

  it('写盘失败提示只弹一次，恢复成功后再次失败才会重新提示', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    const store = useSettingsStore();
    await store.initializeSettings();
    fileStoreState.behavior.rejectSave = true;

    store.settings.theme = 'dark';
    await nextTick();
    await store.flushSettings();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('保存失败'), 'error', expect.any(Number));

    // 同一失败周期内的后续失败不重复提示（去重）。
    store.settings.theme = 'light';
    await nextTick();
    await store.flushSettings();
    expect(toastMock).toHaveBeenCalledTimes(1);

    // 写盘恢复成功后复位，下一次失败仍会提示。
    fileStoreState.behavior.rejectSave = false;
    store.settings.theme = 'dark';
    await nextTick();
    await store.flushSettings();
    fileStoreState.behavior.rejectSave = true;
    store.settings.theme = 'light';
    await nextTick();
    await store.flushSettings();
    expect(toastMock).toHaveBeenCalledTimes(2);
  });

  it('localStorage 兜底保存失败同样给出可见提示', async () => {
    const store = useSettingsStore();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      store.settings.theme = 'dark';
      await nextTick();
      expect(toastMock).toHaveBeenCalledTimes(1);
      // 恢复成功后不再提示
      setItem.mockRestore();
      store.settings.theme = 'light';
      await nextTick();
      expect(toastMock).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
    }
  });

  it('设备指纹输入防抖：只同步最终值，不逐键推送', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    vi.useFakeTimers();
    try {
      const store = useSettingsStore();
      await store.initializeSettings();
      vi.mocked(invoke).mockClear();
      const f = store.settings.deviceFingerprint;
      f.customFingerprint = true;
      // 模拟逐键输入型号
      f.model = '2';
      await nextTick();
      f.model = '23';
      await nextTick();
      f.model = '23127PN0CC';
      await nextTick();
      await vi.advanceTimersByTimeAsync(399);
      expect(invoke).not.toHaveBeenCalledWith('update_device_profile', expect.anything());
      await vi.advanceTimersByTimeAsync(1);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith('update_device_profile', {
        profile: expect.objectContaining({ model: '23127PN0CC' }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('防抖后型号为空（半成品输入）不推送到原生侧', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    vi.useFakeTimers();
    try {
      const store = useSettingsStore();
      await store.initializeSettings();
      vi.mocked(invoke).mockClear();
      const f = store.settings.deviceFingerprint;
      f.customFingerprint = true;
      f.model = '   ';
      await nextTick();
      await vi.advanceTimersByTimeAsync(500);
      expect(invoke).not.toHaveBeenCalledWith('update_device_profile', expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it('设备信息同步失败提示只弹一次且不静默丢弃', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    vi.useFakeTimers();
    try {
      const store = useSettingsStore();
      await store.initializeSettings();
      vi.mocked(invoke).mockClear();
      const f = store.settings.deviceFingerprint;
      f.customFingerprint = true;
      vi.mocked(invoke).mockRejectedValueOnce(new Error('boom'));
      f.model = 'SM-S9280';
      await nextTick();
      await vi.advanceTimersByTimeAsync(500);
      expect(toastMock).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('设备信息同步失败'), 'error', expect.any(Number));
      // 同一失败周期内去重
      vi.mocked(invoke).mockRejectedValueOnce(new Error('boom'));
      f.model = 'SM-S9281';
      await nextTick();
      await vi.advanceTimersByTimeAsync(500);
      expect(toastMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizeSettings 过滤超长关键词并限制总数', () => {
    const long = 'x'.repeat(51);
    const ok = 'y'.repeat(50);
    const many = Array.from({ length: 250 }, (_, i) => `kw${i}`);
    expect(normalizeSettings({ blockedKeywords: ['广告', long, ''] }).blockedKeywords).toEqual(['广告']);
    expect(normalizeSettings({ blockedKeywords: [ok] }).blockedKeywords).toEqual([ok]);
    const capped = normalizeSettings({ blockedKeywords: many });
    expect(capped.blockedKeywords).toHaveLength(200);
  });
});
