import { ref } from 'vue';
import type { PageTransitionStyle } from '../types/settings';

const isSidebarTransitionActive = ref(false);

export const ROOT_TAB_PATHS = ['/', '/digital', '/discover', '/me'] as const;
export const FLUID_ROUTE_EASING = 'cubic-bezier(0.2, 0.9, 0.25, 1)';

export type RouteTransitionMode =
  | ''
  | 'feed-detail-forward'
  | 'feed-detail-back'
  | 'feed-detail-desktop'
  | 'container-expand'
  | 'container-collapse'
  | 'root-tab-next'
  | 'root-tab-prev'
  | 'fluid-push'
  | 'fluid-pop'
  | 'desktop-tab-next'
  | 'desktop-tab-prev'
  | 'desktop-fluid';

export interface ResolveRouteTransitionContext {
  fromPath: string;
  toPath: string;
  backward: boolean;
  mobile: boolean;
  style: PageTransitionStyle;
  reduceMotion?: boolean;
  sidebarTriggered?: boolean;
  fromTabIndex?: number;
  toTabIndex?: number;
}

// 官方 FeedDetailActivityV8 继承 AppTheme 的 Android 窗口动画。
// 来自在线设备 Android 14 framework-res.apk 的 activity_open/close_*：
// 450ms，±96dp，fast_out_extra_slow_in 的两段 PathInterpolator 曲线。
// CSS linear() 的百分比停靠点按原始路径采样，保留两段曲线，不替换成普通 ease。
export const officialFeedDetailEasing = (() => {
  const points: string[] = [];
  const cubic = (a: number, b: number, c: number, d: number, t: number) =>
    (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
  const segments = [
    [0, 0, 0.05, 0, 0.133333, 0.06, 0.166666, 0.4],
    [0.166666, 0.4, 0.208333, 0.82, 0.25, 1, 1, 1],
  ];
  segments.forEach((segment, index) => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = segment as [number, number, number, number, number, number, number, number];
    for (let step = index ? 1 : 0; step <= 200; step++) {
      const t = step / 200;
      points.push(`${Number(cubic(y0, y1, y2, y3, t).toFixed(6))} ${Number((100 * cubic(x0, x1, x2, x3, t)).toFixed(6))}%`);
    }
  });
  return `linear(${points.join(',')})`;
})();

/** 只对动态详情的打开和历史返回应用页面过渡，不影响其他栏目切换。 */
export function getFeedDetailTransition(from: string, to: string, backward: boolean, mobile: boolean): string {
  if (from === to) return '';
  const entersDetail = /^\/feed\//.test(to);
  const returnsFromDetail = /^\/feed\//.test(from) && backward;
  if (!entersDetail && !returnsFromDetail) return '';
  if (!mobile) return 'feed-detail-desktop';
  return backward ? 'feed-detail-back' : 'feed-detail-forward';
}

export function isDetailRoutePath(path: string): boolean {
  return /^\/(?:feed|question|live|product|app|dyh|album)\//.test(path);
}

/** 统一决策桌面端与移动端页面切换与详情展开/收起过场类型。 */
export function resolveRouteTransition(context: ResolveRouteTransitionContext): RouteTransitionMode {
  const { fromPath, toPath, backward, mobile, style, reduceMotion = false, sidebarTriggered = false, fromTabIndex = -1, toTabIndex = -1 } = context;
  if (reduceMotion || !fromPath || fromPath === toPath) return '';
  if (style === 'native') {
    return getFeedDetailTransition(fromPath, toPath, backward, mobile) as RouteTransitionMode;
  }

  const fromRootIndex = ROOT_TAB_PATHS.indexOf(fromPath as (typeof ROOT_TAB_PATHS)[number]);
  const toRootIndex = ROOT_TAB_PATHS.indexOf(toPath as (typeof ROOT_TAB_PATHS)[number]);
  if (mobile && fromRootIndex >= 0 && toRootIndex >= 0) {
    return toRootIndex > fromRootIndex ? 'root-tab-next' : 'root-tab-prev';
  }

  const fromDetail = isDetailRoutePath(fromPath);
  const toDetail = isDetailRoutePath(toPath);
  if (toDetail && !backward) return 'container-expand';
  if (fromDetail && !toDetail && backward) return 'container-collapse';
  if (fromDetail && toDetail) {
    if (!backward) return 'container-expand';
    return mobile ? 'fluid-pop' : 'desktop-fluid';
  }

  if (mobile) {
    return backward ? 'fluid-pop' : 'fluid-push';
  }

  if (!sidebarTriggered && fromTabIndex >= 0 && toTabIndex >= 0 && fromTabIndex !== toTabIndex) {
    return toTabIndex > fromTabIndex ? 'desktop-tab-next' : 'desktop-tab-prev';
  }
  return 'desktop-fluid';
}
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 触发侧边栏导航平滑过渡动效
 * @param durationMs 超时自动回退时间，默认 600ms（覆盖 out-in 动画时长）
 */
export function triggerSidebarTransition(durationMs = 600): void {
  isSidebarTransitionActive.value = true;
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
  }
  fallbackTimer = setTimeout(() => {
    isSidebarTransitionActive.value = false;
    fallbackTimer = null;
  }, durationMs);
}

/**
 * 重置侧边栏路由过渡动效状态
 */
export function resetSidebarTransition(): void {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  isSidebarTransitionActive.value = false;
}

/**
 * 侧边栏导航过渡动效状态组合函数
 */
export function useSidebarTransition() {
  return {
    isSidebarTransitionActive,
    triggerSidebarTransition,
    resetSidebarTransition,
  };
}
