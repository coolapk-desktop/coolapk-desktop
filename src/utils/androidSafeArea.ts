import { invoke, isTauri } from '@tauri-apps/api/core';

/** 首次挂载前读取安全区，后续旋转与系统区域变化由原生同步，避免状态栏覆盖首屏按钮。 */
export async function initializeAndroidSafeArea() {
  if (!isTauri() || !/android/i.test(navigator.userAgent)) return;
  try {
    const area = await invoke<[number, number, number, number]>('get_android_safe_area');
    const ratio = window.devicePixelRatio || 1;
    ['top', 'right', 'bottom', 'left'].forEach((edge, index) => {
      const pixels = area[index];
      if (Number.isFinite(pixels) && pixels >= 0) document.documentElement.style.setProperty(`--android-safe-area-${edge}`, `${pixels / ratio}px`);
    });
  } catch (error) { console.warn('读取 Android 安全区失败:', error); }
}
