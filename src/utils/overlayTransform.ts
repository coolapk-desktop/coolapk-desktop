import { isAndroidWebView, prefersReducedMotion } from './compositorMotion';
import {
  buildCompositorCenterMorphKeyframes,
  buildContainerMorphKeyframes,
  FLUID_MOTION_EASING,
  type RectBox,
} from './containerTransform';

const OVERLAY_ENTER_MS = 260;
const OVERLAY_ENTER_ANDROID_MS = 190;
const OVERLAY_LEAVE_MS = 210;
const OVERLAY_LEAVE_ANDROID_MS = 150;
const OVERLAY_ANCHOR_TTL_MS = 1600;

interface OverlayAnchorEntry {
  element: HTMLElement | null;
  rect: RectBox;
  capturedAt: number;
}

const pendingOverlayAnchors = new Map<string, OverlayAnchorEntry>();
const lastOverlayAnchors = new Map<string, OverlayAnchorEntry>();
const activeOverlayCleanups = new WeakMap<HTMLElement, () => void>();
const recentEnterAnchors = new WeakMap<HTMLElement, { key: string; anchor: OverlayAnchorEntry; at: number }>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readTriggerRadius(element: HTMLElement, rect: DOMRect): number {
  if (typeof getComputedStyle !== 'function') return Math.min(rect.width, rect.height) / 2;
  const raw = parseFloat(getComputedStyle(element).borderTopLeftRadius || '');
  if (!Number.isFinite(raw)) return Math.min(rect.width, rect.height) / 2;
  return clamp(raw, 0, Math.min(rect.width, rect.height) / 2);
}

function measureTriggerBox(element: HTMLElement | null | undefined): OverlayAnchorEntry | null {
  if (!element || !element.isConnected || typeof element.getBoundingClientRect !== 'function') return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 12 || rect.height < 12) return null;
  return {
    element,
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      borderRadius: readTriggerRadius(element, rect),
    },
    capturedAt: Date.now(),
  };
}

/** 显式记录浮层（发布面板 / 搜索命令窗等）触发控件的位置快照。 */
export function captureOverlayTriggerAnchor(key: string, element: HTMLElement | null | undefined): void {
  if (!key) return;
  const entry = measureTriggerBox(element);
  if (!entry) return;
  pendingOverlayAnchors.set(key, entry);
  lastOverlayAnchors.set(key, entry);
}

/** 从全局指针按下事件追踪带 `data-overlay-trigger` 标记的触发源。 */
export function trackOverlayTriggerPointerCandidate(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const trigger = target.closest<HTMLElement>('[data-overlay-trigger]');
  const key = trigger?.getAttribute('data-overlay-trigger')?.trim();
  if (!trigger || !key) return;
  captureOverlayTriggerAnchor(key, trigger);
}

function resolveEnterAnchor(key: string): OverlayAnchorEntry | null {
  const entry = pendingOverlayAnchors.get(key);
  pendingOverlayAnchors.delete(key);
  if (!entry || Date.now() - entry.capturedAt > OVERLAY_ANCHOR_TTL_MS) {
    lastOverlayAnchors.delete(key);
    return null;
  }
  return entry;
}

function resolveLeaveAnchor(key: string): OverlayAnchorEntry | null {
  const saved = lastOverlayAnchors.get(key);
  lastOverlayAnchors.delete(key);
  if (!saved) return null;
  const live = measureTriggerBox(saved.element);
  return live || saved;
}

function readSurfaceBox(surfaceEl: HTMLElement): RectBox {
  const rect = surfaceEl.getBoundingClientRect();
  let radius = 16;
  if (typeof getComputedStyle === 'function') {
    const raw = parseFloat(getComputedStyle(surfaceEl).borderTopLeftRadius || '');
    if (Number.isFinite(raw)) radius = clamp(raw, 0, 32);
  }
  return {
    left: rect.left,
    top: rect.top,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
    borderRadius: radius,
  };
}

function safeCancel(anim: Animation | null | undefined) {
  if (!anim) return;
  try { anim.cancel(); } catch { /* ignore */ }
}

/** 运行浮层入场动效：存在源触发按钮时从源圆角形变展开，否则按流体弹簧从居中微缩放出现。 */
export function runOverlayEnterMorph(
  wrapperEl: HTMLElement,
  surfaceSelector: string,
  triggerKey: string,
  done: () => void,
): () => void {
  activeOverlayCleanups.get(wrapperEl)?.();
  const surfaceEl = wrapperEl.querySelector<HTMLElement>(surfaceSelector);
  if (!surfaceEl || prefersReducedMotion() || typeof surfaceEl.animate !== 'function') {
    done();
    return () => {};
  }

  let anchor = triggerKey ? resolveEnterAnchor(triggerKey) : null;
  if (!anchor && triggerKey) {
    // 兼容 `<Transition appear>` 与 `v-show` 首次同帧双触发 `onEnter` 的场景
    const recent = recentEnterAnchors.get(wrapperEl);
    if (recent && recent.key === triggerKey && Date.now() - recent.at < 120) {
      anchor = measureTriggerBox(recent.anchor.element) || recent.anchor;
    }
  }
  if (anchor && triggerKey) {
    recentEnterAnchors.set(wrapperEl, { key: triggerKey, anchor, at: Date.now() });
    lastOverlayAnchors.set(triggerKey, anchor);
  }
  const modalBox = readSurfaceBox(surfaceEl);
  const animations: Animation[] = [];
  const prevOrigin = surfaceEl.style.transformOrigin;
  const prevWillChange = surfaceEl.style.willChange;
  const androidFast = isAndroidWebView();
  const enterDuration = androidFast ? OVERLAY_ENTER_ANDROID_MS : OVERLAY_ENTER_MS;

  if (anchor && modalBox.width >= 32 && modalBox.height >= 32) {
    if (androidFast) {
      surfaceEl.style.transformOrigin = 'center center';
      surfaceEl.style.willChange = 'transform, opacity';
      animations.push(surfaceEl.animate(
        buildCompositorCenterMorphKeyframes(anchor.rect, modalBox, 'enter'),
        { duration: enterDuration, easing: FLUID_MOTION_EASING, fill: 'both' },
      ));
    } else {
      surfaceEl.style.transformOrigin = '0 0';
      surfaceEl.style.willChange = 'transform, clip-path, opacity';
      const localFrom: RectBox = {
        left: anchor.rect.left - modalBox.left,
        top: anchor.rect.top - modalBox.top,
        width: anchor.rect.width,
        height: anchor.rect.height,
        borderRadius: anchor.rect.borderRadius,
      };
      const localTo: RectBox = {
        left: 0,
        top: 0,
        width: modalBox.width,
        height: modalBox.height,
        borderRadius: modalBox.borderRadius,
      };
      animations.push(surfaceEl.animate(
        buildContainerMorphKeyframes(localFrom, localTo, modalBox.width, modalBox.height, {
          steps: 12,
          opacityRange: [0.35, 1, 0, 0.38],
        }),
        { duration: enterDuration, easing: FLUID_MOTION_EASING, fill: 'both' },
      ));
    }
  } else {
    surfaceEl.style.transformOrigin = 'center center';
    surfaceEl.style.willChange = 'transform, opacity';
    animations.push(surfaceEl.animate(
      [
        { opacity: 0, transform: 'translate3d(0, 12px, 0) scale3d(0.94, 0.94, 1)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)' },
      ],
      { duration: androidFast ? 170 : 220, easing: FLUID_MOTION_EASING },
    ));
  }

  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (activeOverlayCleanups.get(wrapperEl) === cleanup) activeOverlayCleanups.delete(wrapperEl);
    animations.forEach(safeCancel);
    surfaceEl.style.transformOrigin = prevOrigin;
    surfaceEl.style.willChange = prevWillChange;
    done();
  };

  timer = setTimeout(cleanup, enterDuration + 90);
  animations[0]!.onfinish = cleanup;
  animations[0]!.oncancel = cleanup;
  activeOverlayCleanups.set(wrapperEl, cleanup);
  return cleanup;
}

/** 运行浮层退场动效：如果本次是从触发按钮打开且按钮仍在视口中，顺滑缩回原触发按钮。 */
export function runOverlayLeaveMorph(
  wrapperEl: HTMLElement,
  surfaceSelector: string,
  triggerKey: string,
  done: () => void,
): () => void {
  activeOverlayCleanups.get(wrapperEl)?.();
  const surfaceEl = wrapperEl.querySelector<HTMLElement>(surfaceSelector);
  if (!surfaceEl || prefersReducedMotion() || typeof surfaceEl.animate !== 'function') {
    done();
    return () => {};
  }

  const anchor = triggerKey ? resolveLeaveAnchor(triggerKey) : null;
  const modalBox = readSurfaceBox(surfaceEl);
  const animations: Animation[] = [];
  const prevOrigin = surfaceEl.style.transformOrigin;
  const prevWillChange = surfaceEl.style.willChange;
  const androidFast = isAndroidWebView();
  const leaveDuration = androidFast ? OVERLAY_LEAVE_ANDROID_MS : OVERLAY_LEAVE_MS;

  if (anchor && modalBox.width >= 32 && modalBox.height >= 32) {
    if (androidFast) {
      surfaceEl.style.transformOrigin = 'center center';
      surfaceEl.style.willChange = 'transform, opacity';
      animations.push(surfaceEl.animate(
        buildCompositorCenterMorphKeyframes(anchor.rect, modalBox, 'leave'),
        { duration: leaveDuration, easing: FLUID_MOTION_EASING, fill: 'both' },
      ));
    } else {
      surfaceEl.style.transformOrigin = '0 0';
      surfaceEl.style.willChange = 'transform, clip-path, opacity';
      const localFrom: RectBox = {
        left: 0,
        top: 0,
        width: modalBox.width,
        height: modalBox.height,
        borderRadius: modalBox.borderRadius,
      };
      const localTo: RectBox = {
        left: anchor.rect.left - modalBox.left,
        top: anchor.rect.top - modalBox.top,
        width: anchor.rect.width,
        height: anchor.rect.height,
        borderRadius: anchor.rect.borderRadius,
      };
      animations.push(surfaceEl.animate(
        buildContainerMorphKeyframes(localFrom, localTo, modalBox.width, modalBox.height, {
          steps: 12,
          opacityRange: [1, 0, 0.55, 1],
        }),
        { duration: leaveDuration, easing: FLUID_MOTION_EASING, fill: 'both' },
      ));
    }
  } else {
    surfaceEl.style.transformOrigin = 'center center';
    surfaceEl.style.willChange = 'transform, opacity';
    animations.push(surfaceEl.animate(
      [
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)' },
        { opacity: 0, transform: 'translate3d(0, 8px, 0) scale3d(0.95, 0.95, 1)' },
      ],
      { duration: androidFast ? 140 : 160, easing: FLUID_MOTION_EASING, fill: 'both' },
    ));
  }

  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (activeOverlayCleanups.get(wrapperEl) === cleanup) activeOverlayCleanups.delete(wrapperEl);
    animations.forEach(safeCancel);
    surfaceEl.style.transformOrigin = prevOrigin;
    surfaceEl.style.willChange = prevWillChange;
    done();
  };

  timer = setTimeout(cleanup, leaveDuration + 90);
  animations[0]!.onfinish = cleanup;
  animations[0]!.oncancel = cleanup;
  activeOverlayCleanups.set(wrapperEl, cleanup);
  return cleanup;
}

export function cancelOverlayMorph(wrapperEl: Element): void {
  if (wrapperEl instanceof HTMLElement) {
    activeOverlayCleanups.get(wrapperEl)?.();
  }
}
