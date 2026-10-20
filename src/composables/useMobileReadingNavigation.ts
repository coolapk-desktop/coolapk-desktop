import { ref, watch, type InjectionKey, type Ref } from 'vue';

export const mobileReadingNavigationKey: InjectionKey<{ hidden: Readonly<Ref<boolean>>; reset: () => void }> = Symbol('mobile-reading-navigation');
export const mobileDetailActionsHiddenKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('mobile-detail-actions-hidden');

/** 只响应指定阅读区域的纵向滚动，排除布局变化、后台栏目和横向手势。 */
export function useMobileReadingNavigation(enabled: Readonly<Ref<boolean>>, scrollContainer?: string | (() => string | undefined)) {
  const hidden = ref(false);
  let scroller: HTMLElement | null = null;
  let lastTop = 0, distance = 0, direction = 0, intent = 0, intentUntil = 0;
  let touch: { x: number; y: number; previousY: number; scroller: HTMLElement } | null = null;

  function reset() {
    hidden.value = false;
    scroller = null;
    distance = direction = intent = intentUntil = 0;
    touch = null;
  }
  watch(enabled, reset, { flush: 'sync' });
  function restoreHidden(value: boolean) { reset(); hidden.value = enabled.value && value; }

  function findScroller(target: EventTarget | null): HTMLElement | null {
    if (!enabled.value || !(target instanceof Element)) return null;
    // 主栏目切换后使用各自真正滚动的内容区，首页继续保留活动翻页校验。
    const selector = typeof scrollContainer === 'function' ? scrollContainer() : scrollContainer;
    if (target.closest('input, textarea, [contenteditable="true"]')) return null;
    if (!selector && target.closest('.feed-comment-section')) return null;
    const element = target.closest<HTMLElement>(selector || '.feed-scroll-container');
    if (!element || element.closest('[aria-hidden="true"], [inert]')) return null;
    // 详情正文和评论共用页面滚动区域；首页仍须校验当前活动栏目与翻页状态。
    if (selector) return element;
    const pager = element?.closest('.mobile-home-pager');
    if (!element || !pager || pager.classList.contains('is-pager-moving') || element.closest('[aria-hidden="true"]')) return null;
    return element;
  }
  function markIntent(element: HTMLElement, value: number) {
    if (scroller !== element) { scroller = element; lastTop = element.scrollTop; distance = direction = 0; }
    intent = Math.sign(value);
    intentUntil = performance.now() + 1500;
  }
  function onWheel(event: WheelEvent) {
    const element = findScroller(event.target);
    if (!element || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    markIntent(element, event.deltaY);
  }
  function onTouchStart(event: TouchEvent) {
    const element = findScroller(event.target);
    const point = event.touches.length === 1 ? event.touches[0] : null;
    touch = element && point ? { x: point.clientX, y: point.clientY, previousY: point.clientY, scroller: element } : null;
    if (touch) { scroller = element; lastTop = element!.scrollTop; distance = direction = intent = 0; }
  }
  function onTouchMove(event: TouchEvent) {
    if (!touch || event.touches.length !== 1) { intent = 0; return; }
    const point = event.touches[0];
    const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
    if (Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx) * 1.2) markIntent(touch.scroller, touch.previousY - point.clientY);
    else intent = 0;
    touch.previousY = point.clientY;
  }
  function onScroll(event: Event) {
    const element = findScroller(event.target);
    if (!element || event.target !== element) return;
    const top = Math.max(0, element.scrollTop);
    if (top <= 8) { reset(); return; }
    if (scroller !== element) { scroller = element; lastTop = top; return; }
    const delta = top - lastTop;
    lastTop = top;
    // 收起导航时列表会变高，底部可能自动修正 scrollTop；不能把这种变化当成反向滚动。
    if (!intent || performance.now() > intentUntil || Math.sign(delta) !== intent || Math.abs(delta) < 1) return;
    if (direction !== intent) { direction = intent; distance = 0; }
    distance += Math.abs(delta);
    if (direction > 0 && top > 64 && distance >= 48) hidden.value = true;
    if (direction < 0 && distance >= 12) hidden.value = false;
  }
  return { hidden, reset, restoreHidden, onWheel, onTouchStart, onTouchMove, onScroll };
}
