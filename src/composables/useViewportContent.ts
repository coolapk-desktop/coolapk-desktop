import { computed, nextTick, onActivated, onDeactivated, onUnmounted, ref, watch, type Ref } from 'vue';
import { getResourceScrollRoot } from '../utils/resourceVisibility';

type CardObserver = { visibility: (visible: boolean) => void; refreshPlaceholder: (width: number) => boolean };
const cards = new Map<Element, CardObserver & { reobserve: () => void }>();
const observers = new Map<Element | null, { observer: IntersectionObserver; count: number }>();
const RESIZE_SETTLE_MS = 120;
const PLACEHOLDERS_PER_FRAME = 8;
let lastViewportWidth = 0;
let resizeTimer: number | undefined;
let resizeFrame: number | undefined;

function cancelPlaceholderRefresh() {
  window.clearTimeout(resizeTimer);
  if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
  resizeTimer = resizeFrame = undefined;
}

function onResize() {
  const width = window.innerWidth;
  if (width === lastViewportWidth) return;
  lastViewportWidth = width;
  cancelPlaceholderRefresh();
  // 仅在宽度稳定后重测离屏占位。可见卡片继续跟随 CSS 布局即时调整。
  resizeTimer = window.setTimeout(() => {
    resizeTimer = undefined;
    const pending = [...cards];
    let index = 0;
    // 分帧重建离屏子树，避免拖动结束后长列表集中重测造成一帧停顿。
    function refreshBatch() {
      resizeFrame = undefined;
      const refreshed: Array<() => void> = [];
      while (index < pending.length && refreshed.length < PLACEHOLDERS_PER_FRAME) {
        const [element, callback] = pending[index++]!;
        if (cards.get(element) === callback && callback.refreshPlaceholder(width)) refreshed.push(callback.reobserve);
      }
      if (refreshed.length) void nextTick(() => {
        for (const reobserve of refreshed) reobserve();
      });
      if (index < pending.length) resizeFrame = window.requestAnimationFrame(refreshBatch);
    }
    resizeFrame = window.requestAnimationFrame(refreshBatch);
  }, RESIZE_SETTLE_MS);
}

function observeCard(element: Element, callback: CardObserver) {
  const root = getResourceScrollRoot(element);
  let group = observers.get(root);
  if (!group) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) cards.get(entry.target)?.visibility(entry.isIntersecting);
    }, { root, rootMargin: '2000px 0px' });
    group = { observer, count: 0 };
    observers.set(root, group);
  }
  const cardGroup = group;
  if (!cards.size) {
    lastViewportWidth = window.innerWidth;
    window.addEventListener('resize', onResize, { passive: true });
  }
  cardGroup.count += 1;
  let stopped = false;
  cards.set(element, { ...callback, reobserve() {
    if (stopped) return;
    cardGroup.observer.unobserve(element);
    cardGroup.observer.observe(element);
  } });
  cardGroup.observer.observe(element);
  return () => {
    if (stopped) return;
    stopped = true;
    cards.delete(element);
    cardGroup.observer.unobserve(element);
    if (--cardGroup.count === 0) {
      cardGroup.observer.disconnect();
      observers.delete(root);
    }
    if (!cards.size) {
      window.removeEventListener('resize', onResize);
      cancelPlaceholderRefresh();
    }
  };
}

/** 保留卡片本身的数据和事件接口；只回收未交互的离屏子树。 */
export function useViewportContent(element: Ref<HTMLElement | null>, protectedContent: Ref<boolean>, pageVisible: Ref<boolean> = ref(true)) {
  const nearViewport = ref(true);
  const retained = ref(false);
  const height = ref(0);
  const active = ref(true);
  let viewportWidth = window.innerWidth;
  let stop = () => {};
  // KeepAlive 或首页页签切走时保留当前视口内及未测高内容，仅暂停观察器，避免返回时整页卡片先塌陷再重建。
  const renderViewportContent = computed(() => retained.value || protectedContent.value
    || nearViewport.value || !height.value);
  const viewportPlaceholderStyle = computed(() => renderViewportContent.value || !height.value ? undefined
    : { height: `${height.value}px`, boxSizing: 'border-box' as const });

  function retainViewportContent() { retained.value = true; }
  function refreshPlaceholder(width: number) {
    if (viewportWidth === width) return false;
    viewportWidth = width;
    const wasRecycled = !renderViewportContent.value;
    height.value = 0;
    nearViewport.value = true;
    return wasRecycled;
  }

  function observe() {
    stop();
    stop = () => {};
    if (!active.value || !pageVisible.value || !element.value || retained.value || protectedContent.value || typeof IntersectionObserver === 'undefined') return;
    // 隐藏期间旋转手机/调整桌面窗口后，旧占位高度需要重新测量。
    refreshPlaceholder(window.innerWidth);
    stop = observeCard(element.value, {
      visibility(visible) {
        if (visible) nearViewport.value = true;
        else {
          const card = element.value;
          if (!card || !renderViewportContent.value) return;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed && selection.containsNode(card, true)) {
            retainViewportContent();
            return;
          }
          // 卡片使用 border-box。读取未缩放的布局高度，避免把路由转场中的视觉尺寸写回占位。
          const measured = Number.parseFloat(getComputedStyle(card).height);
          if (measured > 0) {
            viewportWidth = window.innerWidth;
            height.value = measured;
            nearViewport.value = false;
          }
        }
      },
      refreshPlaceholder,
    });
  }
  watch([element, retained, protectedContent, pageVisible], () => {
    if (retained.value || protectedContent.value) nearViewport.value = true;
    observe();
  }, { flush: 'post' });
  onDeactivated(() => { active.value = false; stop(); });
  // 返回缓存页面时沿用离屏占位；不能先重建整页卡片，再等观察器将它们卸载。
  onActivated(() => { if (!active.value) { active.value = true; observe(); } });
  onUnmounted(() => { active.value = false; stop(); });
  return { renderViewportContent, viewportPlaceholderStyle, retainViewportContent };
}
