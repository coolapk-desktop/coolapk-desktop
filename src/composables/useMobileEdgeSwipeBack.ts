import { ref, type Ref } from 'vue';
import type { Router } from 'vue-router';
import { setInteractiveBackHandoffBox, FLUID_MOTION_EASING } from '../utils/containerTransform';
import { isAndroidWebView, prefersReducedMotion } from '../utils/compositorMotion';
import { ROOT_TAB_PATHS } from '../utils/routeTransition';

const EDGE_SWIPE_ZONE_PX = 28;
const LOCK_DISTANCE_PX = 10;
const COMMIT_DISTANCE_RATIO = 0.28;
const COMMIT_MIN_DISTANCE_PX = 96;
const COMMIT_VELOCITY_PX_MS = 0.42;
const RESET_DURATION_MS = 220;

export interface MobileEdgeSwipeBackOptions {
  stageRef: Ref<HTMLElement | null>;
  router: Router;
  enabled: () => boolean;
}

/**
 * 移动端左边缘跟手右滑返回手势：
 * 仅在非主栏目页左边缘（<= 28px）向右拖拽时接管，实时微缩+圆角+右移页面；
 * 达到阈值后将浮窗矩形交接给 `container-collapse`（或 `--swipe-back-*` 退场变量）顺滑收口，不生硬跳变。
 */
export function useMobileEdgeSwipeBack(options: MobileEdgeSwipeBackOptions) {
  const isEdgeSwiping = ref(false);

  let activeTouchId: number | null = null;
  let tracking = false;
  let locked = false;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let lastDx = 0;
  let lastDy = 0;
  let activePageEl: HTMLElement | null = null;
  let scrimEl: HTMLDivElement | null = null;
  let stageWidth = 0;
  let stageHeight = 0;

  function canStartEdgeSwipe(target: EventTarget | null, path: string): boolean {
    if (!options.enabled() || prefersReducedMotion()) return false;
    if ((ROOT_TAB_PATHS as readonly string[]).includes(path)) return false;
    const historyPos = Number(window.history.state?.position || 0);
    if (historyPos <= 0 && window.history.length <= 1) return false;
    if (!(target instanceof Element)) return false;
    if (target.closest('[data-discovery-horizontal-scroll], input, textarea, [contenteditable="true"], .image-viewer-backdrop, .dialog-backdrop, .dialog-wrapper')) {
      return false;
    }
    return true;
  }

  function resolveActivePage(stage: HTMLElement): HTMLElement | null {
    const children = Array.from(stage.children) as HTMLElement[];
    return children.find((el) => !el.classList.contains('route-leaving-active') && !el.classList.contains('edge-swipe-scrim')) || null;
  }

  function clearVisualState() {
    isEdgeSwiping.value = false;
    if (scrimEl) {
      scrimEl.remove();
      scrimEl = null;
    }
    if (activePageEl) {
      activePageEl.style.transform = '';
      activePageEl.style.transformOrigin = '';
      activePageEl.style.borderRadius = '';
      activePageEl.style.boxShadow = '';
      activePageEl.style.overflow = '';
      activePageEl.style.willChange = '';
      activePageEl = null;
    }
  }

  function clearCssHandoffVars(el: HTMLElement) {
    el.style.removeProperty('--swipe-back-x');
    el.style.removeProperty('--swipe-back-y');
    el.style.removeProperty('--swipe-back-scale');
    el.style.removeProperty('--swipe-back-radius');
  }

  function computeVisualMetrics(dx: number, dy: number) {
    const progress = Math.min(1, Math.max(0, dx / Math.max(240, stageWidth * 0.72)));
    const translateX = Math.max(0, dx * 0.85);
    const translateY = dy * 0.08;
    const scale = 1 - 0.1 * progress;
    const radius = 24 * progress;
    const scrimOpacity = 0.22 * (1 - progress);
    return { progress, translateX, translateY, scale, radius, scrimOpacity };
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0]!;
    const stage = options.stageRef.value;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    if (touch.clientX - stageRect.left > EDGE_SWIPE_ZONE_PX) return;
    const path = options.router.currentRoute?.value?.path || '';
    if (!canStartEdgeSwipe(event.target, path)) return;

    const pageEl = resolveActivePage(stage);
    if (!pageEl) return;

    activeTouchId = touch.identifier;
    tracking = true;
    locked = false;
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = performance.now();
    lastDx = 0;
    lastDy = 0;
    activePageEl = pageEl;
    stageWidth = stageRect.width || window.innerWidth;
    stageHeight = stageRect.height || window.innerHeight;
  }

  function findTrackedTouch(touches: TouchList): Touch | null {
    if (activeTouchId === null) return null;
    for (let i = 0; i < touches.length; i++) {
      if (touches[i]!.identifier === activeTouchId) return touches[i]!;
    }
    return null;
  }

  function onTouchMove(event: TouchEvent) {
    if (!tracking || !activePageEl) return;
    const touch = findTrackedTouch(event.touches);
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (!locked) {
      if (Math.hypot(dx, dy) < LOCK_DISTANCE_PX) return;
      if (dx <= 0 || Math.abs(dy) > dx * 0.85) {
        tracking = false;
        activeTouchId = null;
        activePageEl = null;
        return;
      }
      locked = true;
      isEdgeSwiping.value = true;
      const stage = options.stageRef.value;
      if (stage) {
        scrimEl = document.createElement('div');
        scrimEl.className = 'edge-swipe-scrim';
        scrimEl.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,1);pointer-events:none;z-index:0;';
        stage.insertBefore(scrimEl, stage.firstChild);
      }
      const androidFast = isAndroidWebView();
      activePageEl.style.transformOrigin = 'center center';
      activePageEl.style.overflow = 'hidden';
      activePageEl.style.willChange = androidFast ? 'transform' : 'transform, border-radius';
      activePageEl.style.boxShadow = androidFast ? '-1px 0 0 rgba(0, 0, 0, 0.08)' : '0 14px 44px rgba(0, 0, 0, 0.2)';
    }

    if (event.cancelable) event.preventDefault();
    lastDx = Math.max(0, dx);
    lastDy = dy;
    const m = computeVisualMetrics(lastDx, lastDy);
    activePageEl.style.transform = `translate3d(${m.translateX.toFixed(1)}px, ${m.translateY.toFixed(1)}px, 0) scale(${m.scale.toFixed(4)})`;
    if (!isAndroidWebView()) activePageEl.style.borderRadius = `${m.radius.toFixed(1)}px`;
    if (scrimEl) scrimEl.style.opacity = m.scrimOpacity.toFixed(4);
  }

  function finishGesture(commitEligible: boolean) {
    if (!tracking) return;
    tracking = false;
    activeTouchId = null;
    if (!locked || !activePageEl) {
      activePageEl = null;
      return;
    }

    const pageEl = activePageEl;
    const androidFast = isAndroidWebView();
    const m = computeVisualMetrics(lastDx, lastDy);
    const elapsed = Math.max(16, performance.now() - startTime);
    const velocity = lastDx / elapsed;
    const commitThreshold = Math.min(COMMIT_MIN_DISTANCE_PX, stageWidth * COMMIT_DISTANCE_RATIO);
    const shouldCommit = commitEligible && (lastDx >= commitThreshold || velocity >= COMMIT_VELOCITY_PX_MS);

    if (shouldCommit) {
      const currentRect = pageEl.getBoundingClientRect();
      clearVisualState();
      // 同时为 container-collapse（卡片形变）与 CSS fluid-pop 写入衔接起点变量
      setInteractiveBackHandoffBox(
        {
          left: currentRect.left,
          top: currentRect.top,
          width: currentRect.width || stageWidth,
          height: currentRect.height || stageHeight,
          borderRadius: androidFast ? 0 : m.radius,
        },
        {
          bgScale: Math.min(0.996, 0.968 + 0.025 * m.progress),
          scrimOpacity: Math.max(0.15, 1 - m.progress * 0.72),
        },
      );
      pageEl.style.setProperty('--swipe-back-x', `${m.translateX.toFixed(1)}px`);
      pageEl.style.setProperty('--swipe-back-y', `${m.translateY.toFixed(1)}px`);
      pageEl.style.setProperty('--swipe-back-scale', m.scale.toFixed(4));
      pageEl.style.setProperty('--swipe-back-radius', androidFast ? '0px' : `${m.radius.toFixed(1)}px`);
      window.setTimeout(() => clearCssHandoffVars(pageEl), 400);
      void options.router.back();
      return;
    }

    // 未达到提交阈值：弹性吸回原位
    const anim = typeof pageEl.animate === 'function'
      ? pageEl.animate(
        androidFast
          ? [
              { transform: pageEl.style.transform || 'translate3d(0,0,0) scale(1)' },
              { transform: 'translate3d(0,0,0) scale(1)' },
            ]
          : [
              {
                transform: pageEl.style.transform || 'translate3d(0,0,0) scale(1)',
                borderRadius: pageEl.style.borderRadius || '0px',
              },
              { transform: 'translate3d(0,0,0) scale(1)', borderRadius: '0px' },
            ],
        { duration: RESET_DURATION_MS, easing: FLUID_MOTION_EASING },
      )
      : null;
    if (scrimEl && typeof scrimEl.animate === 'function') {
      scrimEl.animate([{ opacity: scrimEl.style.opacity || '0' }, { opacity: '0' }], { duration: RESET_DURATION_MS });
    }
    const finalize = () => clearVisualState();
    if (anim) {
      anim.onfinish = finalize;
      anim.oncancel = finalize;
      window.setTimeout(finalize, RESET_DURATION_MS + 60);
    } else {
      finalize();
    }
  }

  function onTouchEnd() { finishGesture(true); }
  function onTouchCancel() { finishGesture(false); }

  return {
    isEdgeSwiping,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    cleanup: clearVisualState,
  };
}
