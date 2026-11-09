import { isNavigationFailure, NavigationFailureType, type NavigationFailure, type Router } from 'vue-router';

/** 目标已经显示时，重复导航也视为打开成功。 */
export function didNavigate(failure: NavigationFailure | void): boolean {
  return !failure || isNavigationFailure(failure, NavigationFailureType.duplicated);
}

/** 当前是否存在应用内上一页。 */
export function canNavigateBack(router: Router): boolean {
  return Boolean(router.options.history.state.back);
}

/** 当前是否存在可以前进到的应用内页面。 */
export function canNavigateForward(router: Router): boolean {
  return Boolean(router.options.history.state.forward);
}

/**
 * 深链直接进入详情页时使用的语义兜底页面：
 * 优先回到当前页面所属的上级栏目，而不是一律回首页或按历史长度误退出应用。
 * 快捷键、根返回键、iOS 侧滑手势与标题栏返回按钮共用同一份口径。
 */
export function resolveBackFallback(path: string): string {
  const userMatch = path.match(/^\/user\/([^/]+)/);
  if (userMatch) return `/user/${userMatch[1]}`;
  if (path.startsWith('/topic/')) return '/topics';
  if (path.startsWith('/live/')) return '/discover';
  if (path.startsWith('/settings')) return '/settings';
  return '/';
}

/**
 * 返回应用内上一页；直接打开详情页时改为进入语义兜底页面，
 * 避免依据浏览器历史长度误退出应用。显式传入 fallback 时以传入值为准。
 */
export function navigateBack(router: Router, fallback?: string): void {
  if (canNavigateBack(router)) {
    router.back();
    return;
  }
  const path = router.currentRoute?.value?.path || '/';
  void router.replace(fallback ?? resolveBackFallback(path));
}

/** 撤销最近一次后退；没有前进记录时不执行任何操作。 */
export function navigateForward(router: Router): void {
  if (canNavigateForward(router)) {
    router.forward();
  }
}
