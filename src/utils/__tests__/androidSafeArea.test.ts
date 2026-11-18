import { afterEach, expect, it, vi } from 'vitest';
import { initializeAndroidSafeArea } from '../androidSafeArea';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const edge of ['top', 'right', 'bottom', 'left']) document.documentElement.style.removeProperty(`--android-safe-area-${edge}`);
});

it('Android 在挂载前按像素比例设置安全区', async () => {
  native.isTauri.mockReturnValue(true);
  native.invoke.mockResolvedValue([84, 9, 72, 12]);
  vi.stubGlobal('navigator', { userAgent: 'Android' });
  vi.stubGlobal('devicePixelRatio', 3);
  await initializeAndroidSafeArea();
  expect(native.invoke).toHaveBeenCalledWith('get_android_safe_area');
  expect(document.documentElement.style.getPropertyValue('--android-safe-area-top')).toBe('28px');
  expect(document.documentElement.style.getPropertyValue('--android-safe-area-right')).toBe('3px');
  expect(document.documentElement.style.getPropertyValue('--android-safe-area-bottom')).toBe('24px');
  expect(document.documentElement.style.getPropertyValue('--android-safe-area-left')).toBe('4px');
});

it.each(['iPhone', 'iPad', 'Windows'])('%s 保留系统提供的安全区，不调用 Android 原生方法', async (platform) => {
  native.isTauri.mockReturnValue(true);
  vi.stubGlobal('navigator', { userAgent: platform });
  await initializeAndroidSafeArea();
  expect(native.invoke).not.toHaveBeenCalled();
  expect(document.documentElement.style.getPropertyValue('--android-safe-area-top')).toBe('');
});

it('浏览器中的 Android 页面不调用原生方法', async () => {
  native.isTauri.mockReturnValue(false);
  vi.stubGlobal('navigator', { userAgent: 'Android' });
  await initializeAndroidSafeArea();
  expect(native.invoke).not.toHaveBeenCalled();
});
