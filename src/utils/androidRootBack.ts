import type { Router } from 'vue-router';
import { navigateBack, resolveBackFallback } from './navigation';

const EXIT_INTERVAL_MS = 2000;

/** 首页两次返回退出；详情页仍沿应用路由返回。仅由 Android 返回键调用。 */
export function createAndroidRootBackHandler(
  router: Router,
  quit: () => Promise<void>,
  toast: (message: string, type: 'info' | 'error') => void,
  now: () => number = Date.now,
) {
  let lastBack: number | null = null;
  let exiting = false;
  const reset = () => { lastBack = null; };
  const handle = () => {
    if (exiting) return;
    if (router.currentRoute.value.path !== '/') {
      reset();
      // 显式按语义兜底，不依赖 navigateBack 的默认参数；深链详情页无历史时回到上级栏目。
      navigateBack(router, resolveBackFallback(router.currentRoute.value.path));
      return;
    }
    const time = now();
    if (lastBack === null || time - lastBack > EXIT_INTERVAL_MS) {
      lastBack = time;
      toast('再按一次返回键退出', 'info');
      return;
    }
    reset();
    exiting = true;
    void quit().catch((error) => {
      console.warn('Android 返回键退出失败:', error);
      toast('退出失败，请重试', 'error');
    }).finally(() => { exiting = false; });
  };
  return { handle, reset };
}
