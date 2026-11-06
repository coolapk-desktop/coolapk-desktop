import type { Router } from 'vue-router';

/**
 * 主栏目入口（首页 / 数码 / 发现 / 我的）的单击 / 双击行为。
 *
 * 侧边栏、移动端底栏和顶部页面标签栏三处入口共用同一套判据，避免出现
 * 「底栏能回顶、侧边栏不能」「数码页再点一次没反应」这类不一致。
 *
 * - 单击：回到顶部；
 * - 双击：回到顶部并刷新当前栏目（刷新沿用首页的既有语义，取该栏目第一页最新内容）。
 */

/** 双击判定的时间窗口（毫秒）。 */
export const HOME_TAB_DOUBLE_CLICK_MS = 360;

/** 单击主栏目：让当前页面滚动到顶部。 */
export const HOME_TAB_SCROLL_TOP_EVENT = 'home-tab-scroll-top';

/** 双击主栏目：回到顶部后刷新当前栏目。 */
export const HOME_TAB_REFRESH_EVENT = 'home-tab-refresh';

export type HomeTabClickResult = 'single' | 'double' | 'navigate';

let lastHomeTabClickAt = 0;

/** 纯判据：上一次点击时间与本次点击时间是否构成双击。 */
export function isHomeTabDoubleClick(previousClickAt: number, currentClickAt: number): boolean {
  return previousClickAt > 0 && currentClickAt - previousClickAt < HOME_TAB_DOUBLE_CLICK_MS;
}

/** 清空双击判定状态；离开主栏目或测试之间隔离时调用。 */
export function resetHomeTabClickState(): void {
  lastHomeTabClickAt = 0;
}

/**
 * 非首页栏目没有页面级「回到顶部」监听器（首页由 HomeTabPanel 处理以保留栏目状态），
 * 这里直接把当前主内容区里已经滚动过的容器滚回顶部。
 */
function scrollCurrentPageToTop(): void {
  if (typeof document === 'undefined') return;
  const main = document.querySelector<HTMLElement>('.app-main-content');
  const candidates: HTMLElement[] = main ? [main, ...Array.from(main.querySelectorAll<HTMLElement>('*'))] : [];
  candidates.forEach((element) => {
    if (element && element.scrollTop > 0) element.scrollTop = 0;
  });
}

/**
 * 处理一次主栏目入口点击。
 *
 * - 不在该栏目：跳转到该栏目。此时清空双击状态，否则「从子页返回」加上紧接着的一次点击
 *   会被误判成双击，导致刚返回就发一次刷新请求；
 * - 已在该栏目：派发回到顶部事件；360 毫秒内的第二次点击再派发一次刷新事件。
 *
 * 回到顶部在每次点击时立即派发，不为等待双击而延迟，所以单击没有手感延迟。
 */
export function activateRootTab(
  router: Router | undefined,
  path = '/',
  options: { replace?: boolean } = {}
): HomeTabClickResult {
  if (!router) return 'navigate';

  if (router.currentRoute.value.path !== path) {
    resetHomeTabClickState();
    if (options.replace) void router.replace(path);
    else void router.push(path);
    return 'navigate';
  }

  const now = Date.now();
  const isDouble = isHomeTabDoubleClick(lastHomeTabClickAt, now);
  // 双击命中后清空状态，避免第三击再次触发刷新。
  lastHomeTabClickAt = isDouble ? 0 : now;

  window.dispatchEvent(new Event(HOME_TAB_SCROLL_TOP_EVENT));
  if (isDouble) window.dispatchEvent(new Event(HOME_TAB_REFRESH_EVENT));
  // 首页由 HomeTabPanel 自己处理回顶，其余栏目在这里兜底滚动。
  if (path !== '/') scrollCurrentPageToTop();

  return isDouble ? 'double' : 'single';
}

/** 「首页」入口的旧接口，等价于 {@link activateRootTab} 的默认栏目。 */
export function activateHomeTab(
  router: Router | undefined,
  options: { replace?: boolean } = {}
): HomeTabClickResult {
  return activateRootTab(router, '/', options);
}
