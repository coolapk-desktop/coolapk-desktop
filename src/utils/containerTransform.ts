import { nextTick, ref } from 'vue';
import { isAndroidWebView, prefersReducedMotion } from './compositorMotion';
import { trackImageViewerPointerCandidate } from './imageViewerTransform';
import { trackOverlayTriggerPointerCandidate } from './overlayTransform';

export const FLUID_MOTION_EASING = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
export const CONTAINER_EXPAND_DURATION_DESKTOP_MS = 270;
export const CONTAINER_EXPAND_DURATION_MOBILE_MS = 310;
export const CONTAINER_EXPAND_DURATION_ANDROID_MS = 210;
export const CONTAINER_COLLAPSE_DURATION_DESKTOP_MS = 230;
export const CONTAINER_COLLAPSE_DURATION_MOBILE_MS = 270;
export const CONTAINER_COLLAPSE_DURATION_ANDROID_MS = 180;
const ANCHOR_TTL_MS = 1800;
const HISTORY_ANCHOR_TTL_MS = 15 * 60 * 1000;
const MAX_HISTORY_ANCHORS = 40;
const MORPH_KEYFRAME_STEPS = 14;

/** 当前是否正在执行卡片容器展开/收起转场；供 AppShell 协调移动顶栏与底栏显隐。 */
export const isRouteContainerMorphing = ref(false);

export interface RectBox {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: number;
}

export interface LocalStageRect extends RectBox {
  stageWidth: number;
  stageHeight: number;
}

export interface AnchorSnapshot {
  key: string;
  rect: RectBox;
  backgroundColor: string;
  previewNode: HTMLElement | null;
  sourceElement: HTMLElement | null;
  originPath: string;
  capturedAt: number;
}

export interface RouteMorphStartOptions {
  mode: 'container-expand' | 'container-collapse';
  targetKey: string;
  mobile: boolean;
  fromPath: string;
  toPath: string;
}

const DETAIL_ROUTE_PATTERNS: Array<{ prefix: string; regex: RegExp }> = [
  { prefix: 'feed', regex: /^\/feed\/([^/?#]+)/ },
  { prefix: 'question', regex: /^\/question\/([^/?#]+)/ },
  { prefix: 'live', regex: /^\/live\/([^/?#]+)/ },
  { prefix: 'product', regex: /^\/product\/([^/?#]+)/ },
  { prefix: 'app', regex: /^\/app\/([^/?#]+)/ },
  { prefix: 'dyh', regex: /^\/dyh\/([^/?#]+)/ },
  { prefix: 'album', regex: /^\/album\/([^/?#]+)/ },
  { prefix: 'feed', regex: /^\/goods\/(?:lists|ranking)\/([^/?#]+)/ },
];

const ANCHOR_CARD_SELECTOR = [
  '[data-feed-id]',
  '[data-answer-id]',
  '[data-question-id]',
  '[data-product-id]',
  '[data-app-id]',
  '[data-transition-anchor]',
  '.feed-card',
  '.question-feed-card',
  '.question-answer-card',
  '.product-card',
  '.digital-product-card',
  '.app-card',
  '.discovery-secondhand-feed',
  '.discovery-user-row',
  '.discovery-special-card',
  '.discovery-text-card',
  '.discovery-image-card',
  '.discovery-generic-card',
  '.discovery-ranking-card',
  '.ranking-featured',
  '.discovery-goods-item',
  '.goods-ranking-card',
  '.trending-item',
  '.news-item',
  '.rating-card',
].join(', ');

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 从路由路径提取共享容器标识（例如 feed:123、question:45）；非详情页返回空串。 */
export function getDetailTransitionTargetKey(path: string): string {
  const cleanPath = String(path || '').split('?')[0] || '';
  for (const entry of DETAIL_ROUTE_PATTERNS) {
    const match = entry.regex.exec(cleanPath);
    if (match?.[1]) return `${entry.prefix}:${safeDecode(match[1])}`;
  }
  return '';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function readBorderRadius(element: HTMLElement): number {
  if (typeof getComputedStyle !== 'function') return 14;
  const raw = parseFloat(getComputedStyle(element).borderTopLeftRadius || '');
  return Number.isFinite(raw) ? clamp(raw, 0, 32) : 14;
}

function readOpaqueBackground(element: HTMLElement | null): string {
  if (!element || typeof getComputedStyle !== 'function') return 'var(--surface, #ffffff)';
  const bg = getComputedStyle(element).backgroundColor;
  if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return 'var(--surface, #ffffff)';
  return bg;
}

function resolveAnchorTargetKey(element: HTMLElement): string {
  const explicit = element.getAttribute('data-transition-anchor');
  if (explicit) return explicit.trim();
  const feedId = element.getAttribute('data-feed-id') || element.getAttribute('data-answer-id');
  if (feedId) return `feed:${feedId.trim()}`;
  const questionId = element.getAttribute('data-question-id');
  if (questionId) return `question:${questionId.trim()}`;
  const productId = element.getAttribute('data-product-id');
  if (productId) return `product:${productId.trim()}`;
  const appId = element.getAttribute('data-app-id');
  if (appId) return `app:${appId.trim()}`;
  return '';
}

function createCardPreviewClone(
  element: HTMLElement | null,
  width: number,
  height: number,
  backgroundColor?: string,
): HTMLElement | null {
  if (!element || typeof document === 'undefined' || width <= 0 || height <= 0) return null;
  if (element.querySelectorAll('*').length > 350) return null;
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.inline-comment-wrapper, [data-no-morph-ghost]').forEach(node => node.remove());
  clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  clone.querySelectorAll('video').forEach((video) => {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = 'width:100%;height:100%;background:rgba(0,0,0,0.08);border-radius:8px;';
    video.replaceWith(placeholder);
  });
  clone.removeAttribute('id');
  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('inert', '');
  clone.style.position = 'relative';
  clone.style.margin = '0';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.minWidth = `${width}px`;
  clone.style.maxWidth = `${width}px`;
  clone.style.minHeight = `${height}px`;
  clone.style.maxHeight = `${height}px`;
  clone.style.boxSizing = 'border-box';
  clone.style.overflow = 'hidden';
  clone.style.pointerEvents = 'none';
  clone.style.transform = 'none';
  clone.style.backgroundColor = backgroundColor || readOpaqueBackground(element);
  return clone;
}

/**
 * 构建纯合成层缩放关键帧（仅使用 translate3d + scale3d，避免动态 clip-path 触发重绘渲染通道）。
 */
export function buildCompositorScaleKeyframes(
  from: RectBox,
  to: RectBox,
  baseWidth: number,
  baseHeight: number,
  opacityRange?: [number, number],
): Keyframe[] {
  const safeW = Math.max(1, baseWidth);
  const safeH = Math.max(1, baseHeight);
  const fromSx = Math.max(0.05, from.width / safeW);
  const fromSy = Math.max(0.05, from.height / safeH);
  const toSx = Math.max(0.05, to.width / safeW);
  const toSy = Math.max(0.05, to.height / safeH);
  const fromFrame: Keyframe = {
    transform: `translate3d(${from.left.toFixed(2)}px, ${from.top.toFixed(2)}px, 0) scale3d(${fromSx.toFixed(5)}, ${fromSy.toFixed(5)}, 1)`,
  };
  const toFrame: Keyframe = {
    transform: `translate3d(${to.left.toFixed(2)}px, ${to.top.toFixed(2)}px, 0) scale3d(${toSx.toFixed(5)}, ${toSy.toFixed(5)}, 1)`,
  };
  if (opacityRange) {
    fromFrame.opacity = opacityRange[0];
    toFrame.opacity = opacityRange[1];
  }
  return [fromFrame, toFrame];
}

/**
 * 构建围绕中心等比缩放与中心偏移的轻量容器形变关键帧（用于 Android WebView 详情页与浮层无裁剪合成动画）。
 */
export function buildCompositorCenterMorphKeyframes(
  anchorRect: Pick<RectBox, 'left' | 'top' | 'width' | 'height'>,
  surfaceRect: Pick<RectBox, 'left' | 'top' | 'width' | 'height'>,
  direction: 'enter' | 'leave',
  handoffRect?: Pick<RectBox, 'left' | 'top' | 'width' | 'height'> | null,
): Keyframe[] {
  const surfaceW = Math.max(1, surfaceRect.width);
  const surfaceH = Math.max(1, surfaceRect.height);
  const anchorCx = anchorRect.left + anchorRect.width / 2;
  const anchorCy = anchorRect.top + anchorRect.height / 2;
  const surfaceCx = surfaceRect.left + surfaceW / 2;
  const surfaceCy = surfaceRect.top + surfaceH / 2;
  const dx = Math.max(-surfaceW * 0.45, Math.min(surfaceW * 0.45, (anchorCx - surfaceCx) * 0.36));
  const dy = Math.max(-surfaceH * 0.45, Math.min(surfaceH * 0.45, (anchorCy - surfaceCy) * 0.36));
  const ratio = Math.min(anchorRect.width / surfaceW, anchorRect.height / surfaceH);
  const edgeScale = Math.max(0.84, Math.min(0.94, Number.isFinite(ratio) ? 0.8 + ratio * 0.14 : 0.88));

  if (direction === 'enter') {
    return [
      { transform: `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale3d(${edgeScale.toFixed(4)}, ${edgeScale.toFixed(4)}, 1)`, opacity: 0.08, offset: 0 },
      { transform: `translate3d(${(dx * 0.18).toFixed(2)}px, ${(dy * 0.18).toFixed(2)}px, 0) scale3d(0.9700, 0.9700, 1)`, opacity: 1, offset: 0.45 },
      { transform: 'translate3d(0px, 0px, 0) scale3d(1, 1, 1)', opacity: 1, offset: 1 },
    ];
  }

  let startDx = 0;
  let startDy = 0;
  let startScale = 1;
  if (handoffRect) {
    startDx = handoffRect.left + handoffRect.width / 2 - surfaceCx;
    startDy = handoffRect.top + handoffRect.height / 2 - surfaceCy;
    startScale = Math.max(0.75, Math.min(1, handoffRect.width / surfaceW));
  }
  return [
    { transform: `translate3d(${startDx.toFixed(2)}px, ${startDy.toFixed(2)}px, 0) scale3d(${startScale.toFixed(4)}, ${startScale.toFixed(4)}, 1)`, opacity: 1, offset: 0 },
    { transform: `translate3d(${(startDx * 0.35 + dx * 0.65).toFixed(2)}px, ${(startDy * 0.35 + dy * 0.65).toFixed(2)}px, 0) scale3d(${(startScale * 0.94).toFixed(4)}, ${(startScale * 0.94).toFixed(4)}, 1)`, opacity: 0.72, offset: 0.45 },
    { transform: `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale3d(${edgeScale.toFixed(4)}, ${edgeScale.toFixed(4)}, 1)`, opacity: 0, offset: 1 },
  ];
}

function buildSnapshot(element: HTMLElement, key = '', originPath = ''): AnchorSnapshot | null {
  if (!element.isConnected || typeof element.getBoundingClientRect !== 'function') return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 16 || rect.height < 16) return null;
  const radius = readBorderRadius(element);
  const backgroundColor = readOpaqueBackground(element);
  const resolvedKey = key || resolveAnchorTargetKey(element);
  // 预览节点按元素自身的 CSS 布局宽高生成，外层缩放由 morph keyframes 统一映射。
  const layoutWidth = element.offsetWidth || rect.width;
  const layoutHeight = element.offsetHeight || rect.height;
  return {
    key: resolvedKey,
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      borderRadius: radius,
    },
    backgroundColor,
    previewNode: isAndroidWebView() ? null : createCardPreviewClone(element, layoutWidth, layoutHeight, backgroundColor),
    sourceElement: element,
    originPath,
    capturedAt: Date.now(),
  };
}

let pendingForwardAnchor: AnchorSnapshot | null = null;
let lastPointerAnchor: { element: HTMLElement; key: string; at: number } | null = null;
const historyAnchorMap = new Map<string, AnchorSnapshot>();

interface InteractiveHandoffState {
  box: RectBox;
  bgScale: number;
  scrimOpacity: number;
  capturedAt: number;
}
let pendingInteractiveHandoff: InteractiveHandoffState | null = null;

/** 记录移动端边缘滑动返回松手时的实时窗口浮层几何盒，便于 `container-collapse` 从半空态无缝顺延收口。 */
export function setInteractiveBackHandoffBox(
  box: RectBox,
  options: { bgScale?: number; scrimOpacity?: number } = {},
): void {
  pendingInteractiveHandoff = {
    box,
    bgScale: options.bgScale ?? 0.985,
    scrimOpacity: options.scrimOpacity ?? 0.65,
    capturedAt: Date.now(),
  };
}

export function consumeInteractiveBackHandoffBox(): InteractiveHandoffState | null {
  const entry = pendingInteractiveHandoff;
  pendingInteractiveHandoff = null;
  if (!entry || Date.now() - entry.capturedAt > 800) return null;
  return entry;
}

function pruneHistoryAnchors(now: number) {
  for (const [key, item] of historyAnchorMap) {
    if (now - item.capturedAt > HISTORY_ANCHOR_TTL_MS) {
      historyAnchorMap.delete(key);
    }
  }
  while (historyAnchorMap.size > MAX_HISTORY_ANCHORS) {
    const oldest = historyAnchorMap.keys().next().value;
    if (oldest === undefined) break;
    historyAnchorMap.delete(oldest);
  }
}

function historyKey(targetKey: string, originPath: string): string {
  return `${originPath}::${targetKey}`;
}

/** 显式记录即将打开详情页的源卡片锚点。 */
export function captureRouteTransitionAnchor(
  element: HTMLElement | null | undefined,
  targetKey = '',
  originPath = '',
): void {
  if (!element) return;
  const snapshot = buildSnapshot(element, targetKey, originPath);
  if (!snapshot) return;
  pendingForwardAnchor = snapshot;
  if (snapshot.key) {
    const mapKey = historyKey(snapshot.key, originPath);
    historyAnchorMap.set(mapKey, { ...snapshot, previewNode: snapshot.previewNode ? (snapshot.previewNode.cloneNode(true) as HTMLElement) : null });
    pruneHistoryAnchors(Date.now());
  }
}

/** 安装轻量全局指针锚点监听，为未显式传参的卡片跳转与浮层触发提供平滑起点。 */
export function installGlobalTransitionAnchorTracker(): () => void {
  if (typeof document === 'undefined') return () => {};
  const onPointerDown = (event: PointerEvent) => {
    trackImageViewerPointerCandidate(event.target);
    trackOverlayTriggerPointerCandidate(event.target);
    const target = event.target;
    if (!(target instanceof Element)) return;
    const card = target.closest<HTMLElement>(ANCHOR_CARD_SELECTOR);
    if (!card) {
      lastPointerAnchor = null;
      return;
    }
    lastPointerAnchor = {
      element: card,
      key: resolveAnchorTargetKey(card),
      at: Date.now(),
    };
  };
  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, { capture: true });
    lastPointerAnchor = null;
  };
}

/** 提取进入详情页时的锚点，并在合适时自动回退到最近点击的卡片元素。 */
export function consumeForwardTransitionAnchor(targetKey: string, fromPath = ''): AnchorSnapshot | null {
  const now = Date.now();
  const explicit = pendingForwardAnchor;
  pendingForwardAnchor = null;
  if (explicit && now - explicit.capturedAt <= ANCHOR_TTL_MS) {
    if (!targetKey || !explicit.key || explicit.key === targetKey) {
      const normalized: AnchorSnapshot = { ...explicit, key: targetKey || explicit.key, originPath: fromPath || explicit.originPath };
      if (normalized.key) {
        historyAnchorMap.set(historyKey(normalized.key, normalized.originPath), {
          ...normalized,
          previewNode: normalized.previewNode ? (normalized.previewNode.cloneNode(true) as HTMLElement) : null,
        });
        pruneHistoryAnchors(now);
      }
      return normalized;
    }
  }
  if (lastPointerAnchor && now - lastPointerAnchor.at <= ANCHOR_TTL_MS && lastPointerAnchor.element.isConnected) {
    if (!lastPointerAnchor.key || !targetKey || lastPointerAnchor.key === targetKey) {
      const snapshot = buildSnapshot(lastPointerAnchor.element, targetKey, fromPath);
      lastPointerAnchor = null;
      if (snapshot?.key) {
        historyAnchorMap.set(historyKey(snapshot.key, fromPath), {
          ...snapshot,
          previewNode: snapshot.previewNode ? (snapshot.previewNode.cloneNode(true) as HTMLElement) : null,
        });
        pruneHistoryAnchors(now);
      }
      return snapshot;
    }
  }
  return null;
}

function escapeSelectorAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

/** 在已恢复滚动位置的列表 DOM 中查找可见源卡片，找不到时返回 null 交由退化动效收口。 */
export function findVisibleAnchorElement(root: HTMLElement | null, targetKey: string): HTMLElement | null {
  if (!root || !targetKey) return null;
  const [prefix, ...rest] = targetKey.split(':');
  const id = rest.join(':');
  if (!id) return null;
  const escapedId = escapeSelectorAttr(id);
  const escapedKey = escapeSelectorAttr(targetKey);
  const selectors = [`[data-transition-anchor="${escapedKey}"]`];
  if (prefix === 'feed') selectors.push(`[data-feed-id="${escapedId}"]`, `[data-answer-id="${escapedId}"]`);
  else if (prefix === 'question') selectors.push(`[data-question-id="${escapedId}"]`, `[data-feed-id="${escapedId}"]`);
  else if (prefix === 'product') selectors.push(`[data-product-id="${escapedId}"]`);
  else if (prefix === 'app') selectors.push(`[data-app-id="${escapedId}"]`);

  const candidates = Array.from(root.querySelectorAll<HTMLElement>(selectors.join(', ')));
  for (const candidate of candidates) {
    if (candidate.closest('[aria-hidden="true"], [inert], .route-leaving-active')) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width >= 16 && rect.height >= 16) return candidate;
  }
  return null;
}

/** 将视口坐标换算到 `.route-transition-stage` 的未缩放逻辑像素坐标系（兼容 #app transform: scale）。 */
export function computeLocalStageRect(viewportRect: RectBox, stageEl: HTMLElement): LocalStageRect {
  const stageRect = stageEl.getBoundingClientRect();
  const stageWidth = stageEl.offsetWidth || stageRect.width || 1;
  const stageHeight = stageEl.offsetHeight || stageRect.height || 1;
  const scaleX = stageWidth > 0 && stageRect.width > 0 ? stageRect.width / stageWidth : 1;
  const scaleY = stageHeight > 0 && stageRect.height > 0 ? stageRect.height / stageHeight : 1;
  return {
    left: (viewportRect.left - stageRect.left) / scaleX,
    top: (viewportRect.top - stageRect.top) / scaleY,
    width: viewportRect.width / scaleX,
    height: viewportRect.height / scaleY,
    borderRadius: viewportRect.borderRadius / Math.min(scaleX, scaleY),
    stageWidth,
    stageHeight,
  };
}

export function isLocalRectVisibleInStage(box: LocalStageRect): boolean {
  if (box.width < 16 || box.height < 16 || box.stageWidth <= 0 || box.stageHeight <= 0) return false;
  return (
    box.left + box.width > 12
    && box.left < box.stageWidth - 12
    && box.top + box.height > 12
    && box.top < box.stageHeight - 12
  );
}

/**
 * 预计算等比例均匀缩放 + 精准矩形裁剪关键帧，确保外框形变与内层内容零拉伸、零漂移。
 */
export function buildContainerMorphKeyframes(
  fromBox: RectBox,
  toBox: RectBox,
  surfaceWidth: number,
  surfaceHeight: number,
  options: {
    steps?: number;
    opacityRange?: [number, number, number, number];
  } = {},
): Keyframe[] {
  const steps = Math.max(2, options.steps ?? MORPH_KEYFRAME_STEPS);
  const safeW = Math.max(1, surfaceWidth);
  const safeH = Math.max(1, surfaceHeight);
  const keyframes: Keyframe[] = [];
  const opacitySpec = options.opacityRange;

  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const x = lerp(fromBox.left, toBox.left, p);
    const y = lerp(fromBox.top, toBox.top, p);
    const w = Math.max(1, lerp(fromBox.width, toBox.width, p));
    const h = Math.max(1, lerp(fromBox.height, toBox.height, p));
    const r = Math.max(0, lerp(fromBox.borderRadius, toBox.borderRadius, p));
    const s = clamp(Math.max(w / safeW, h / safeH), 0.05, 8);
    const cropRight = Math.max(0, safeW - w / s);
    const cropBottom = Math.max(0, safeH - h / s);
    const scaledRadius = r / s;

    const frame: Keyframe = {
      offset: p,
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${s.toFixed(5)})`,
      clipPath: `inset(0px ${cropRight.toFixed(2)}px ${cropBottom.toFixed(2)}px 0px round ${scaledRadius.toFixed(2)}px)`,
    };

    if (opacitySpec) {
      const [startOpacity, endOpacity, fadeStart, fadeEnd] = opacitySpec;
      const fadeSpan = Math.max(0.01, fadeEnd - fadeStart);
      const localT = clamp((p - fadeStart) / fadeSpan, 0, 1);
      frame.opacity = Number(lerp(startOpacity, endOpacity, localT).toFixed(4));
    }

    keyframes.push(frame);
  }
  return keyframes;
}

/** 无源卡片锚点（如直接输入地址、跨页签或源卡片已滚出可视区域）时的居中圆角降级盒。 */
function createFallbackBox(stageWidth: number, stageHeight: number): RectBox {
  const scale = 0.93;
  const width = stageWidth * scale;
  const height = stageHeight * scale;
  return {
    left: (stageWidth - width) / 2,
    top: (stageHeight - height) / 2,
    width,
    height,
    borderRadius: 18,
  };
}

function safeCancelAnimation(animation: Animation | null | undefined) {
  if (!animation) return;
  try {
    animation.cancel();
  } catch {
    // 忽略已销毁元素的动画取消异常。
  }
}

export function createRouteMorphCoordinator() {
  let activeCleanup: (() => void) | null = null;
  let pendingSession: {
    options: RouteMorphStartOptions | null;
    enterEl: HTMLElement | null;
    leaveEl: HTMLElement | null;
    enterDone: (() => void) | null;
    leaveDone: (() => void) | null;
    started: boolean;
  } = {
    options: null,
    enterEl: null,
    leaveEl: null,
    enterDone: null,
    leaveDone: null,
    started: false,
  };

  function finishPendingCallbacks() {
    const enterDone = pendingSession.enterDone;
    const leaveDone = pendingSession.leaveDone;
    pendingSession.enterDone = null;
    pendingSession.leaveDone = null;
    enterDone?.();
    leaveDone?.();
  }

  function resetSession(runCleanup = true) {
    if (runCleanup && activeCleanup) {
      const cleanup = activeCleanup;
      activeCleanup = null;
      cleanup();
    }
    finishPendingCallbacks();
    pendingSession.options = null;
    pendingSession.enterEl = null;
    pendingSession.leaveEl = null;
    pendingSession.started = false;
    isRouteContainerMorphing.value = false;
  }

  function prepare(options: RouteMorphStartOptions) {
    resetSession(true);
    pendingSession.options = options;
  }

  function canRunWaapi(el: HTMLElement | null): el is HTMLElement {
    return Boolean(el && !prefersReducedMotion() && typeof el.animate === 'function');
  }

  function startAnimation() {
    if (pendingSession.started) return;
    const { options, enterEl, leaveEl } = pendingSession;
    if (!options) {
      finishPendingCallbacks();
      return;
    }

    const stageEl = (enterEl?.parentElement || leaveEl?.parentElement) as HTMLElement | null;
    const primaryEl = options.mode === 'container-expand' ? enterEl : leaveEl;
    if (!stageEl || !canRunWaapi(primaryEl)) {
      resetSession(true);
      return;
    }

    pendingSession.started = true;
    isRouteContainerMorphing.value = true;

    const stageRect = stageEl.getBoundingClientRect();
    const stageWidth = stageEl.offsetWidth || stageRect.width;
    const stageHeight = stageEl.offsetHeight || stageRect.height;
    if (stageWidth < 32 || stageHeight < 32) {
      resetSession(true);
      return;
    }

    const androidFast = isAndroidWebView();
    const isExpand = options.mode === 'container-expand';
    const duration = androidFast
      ? (isExpand ? CONTAINER_EXPAND_DURATION_ANDROID_MS : CONTAINER_COLLAPSE_DURATION_ANDROID_MS)
      : (isExpand
        ? (options.mobile ? CONTAINER_EXPAND_DURATION_MOBILE_MS : CONTAINER_EXPAND_DURATION_DESKTOP_MS)
        : (options.mobile ? CONTAINER_COLLAPSE_DURATION_MOBILE_MS : CONTAINER_COLLAPSE_DURATION_DESKTOP_MS));
    let cancelled = false;
    const animations: Animation[] = [];
    const createdNodes: HTMLElement[] = [];
    const restoredStyles: Array<() => void> = [];
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const saveStyle = (el: HTMLElement | null, props: Array<keyof CSSStyleDeclaration>) => {
      if (!el) return;
      const snapshot = props.map((prop) => [prop, el.style[prop]] as const);
      restoredStyles.push(() => {
        for (const [prop, val] of snapshot) {
          (el.style as any)[prop] = val;
        }
      });
    };

    const cleanup = () => {
      if (safetyTimer !== null) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      cancelled = true;
      for (const anim of animations) safeCancelAnimation(anim);
      animations.length = 0;
      for (const node of createdNodes) node.remove();
      createdNodes.length = 0;
      for (let i = restoredStyles.length - 1; i >= 0; i--) restoredStyles[i]!();
      restoredStyles.length = 0;
      if (leaveEl) leaveEl.classList.remove('route-leaving-active');
      isRouteContainerMorphing.value = false;
    };

    activeCleanup = cleanup;

    const completeTransition = () => {
      if (cancelled) return;
      if (activeCleanup === cleanup) activeCleanup = null;
      cleanup();
      finishPendingCallbacks();
    };

    const runWithAnchor = (anchor: AnchorSnapshot | null, hideSourceEl: HTMLElement | null, clonePreview = false) => {
      if (cancelled) return;

      // 读阶段集中前置：避免后续写入样式和插入合成层后再次触发强制样式重算。
      const detailEl = isExpand ? enterEl! : leaveEl!;
      const detailBackground = readOpaqueBackground(detailEl);
      const localStageBox: RectBox = { left: 0, top: 0, width: stageWidth, height: stageHeight, borderRadius: 0 };
      let cardBox: RectBox | null = null;
      if (anchor) {
        const local = computeLocalStageRect(anchor.rect, stageEl);
        if (isLocalRectVisibleInStage(local)) {
          cardBox = {
            left: local.left,
            top: local.top,
            width: local.width,
            height: local.height,
            borderRadius: local.borderRadius,
          };
        }
      }

      const fallbackUsed = !cardBox;
      const targetCardBox = cardBox || createFallbackBox(stageWidth, stageHeight);
      const handoff = !isExpand ? consumeInteractiveBackHandoffBox() : null;
      const handoffBox = handoff ? computeLocalStageRect(handoff.box, stageEl) : null;
      const fromBox = isExpand
        ? targetCardBox
        : (handoffBox ? { left: handoffBox.left, top: handoffBox.top, width: handoffBox.width, height: handoffBox.height, borderRadius: handoffBox.borderRadius } : localStageBox);
      const toBox = isExpand ? localStageBox : targetCardBox;

      if (hideSourceEl && !fallbackUsed) {
        saveStyle(hideSourceEl, ['visibility']);
        hideSourceEl.style.visibility = 'hidden';
      }

      // 1. 底层背景页 + 压暗 scrim，营造层次与深度感
      const bgPageEl = isExpand ? leaveEl : enterEl;
      if (bgPageEl) {
        saveStyle(bgPageEl, ['position', 'inset', 'width', 'height', 'zIndex', 'pointerEvents', 'transformOrigin', 'willChange', 'transform']);
        bgPageEl.style.position = 'absolute';
        bgPageEl.style.inset = '0';
        bgPageEl.style.width = '100%';
        bgPageEl.style.height = '100%';
        bgPageEl.style.zIndex = '1';
        bgPageEl.style.pointerEvents = 'none';
        bgPageEl.style.transformOrigin = 'center center';
        bgPageEl.style.willChange = 'transform';

        const bgScale = handoff ? handoff.bgScale : (options.mobile ? 0.968 : 0.992);
        if (!fallbackUsed && !androidFast) {
          animations.push(bgPageEl.animate(
            isExpand
              ? [{ transform: 'scale(1)' }, { transform: `scale(${bgScale})` }]
              : [{ transform: `scale(${bgScale})` }, { transform: 'scale(1)' }],
            { duration, easing: FLUID_MOTION_EASING, fill: 'both' },
          ));
        }
      }

      const scrimEl = document.createElement('div');
      scrimEl.className = 'route-container-scrim';
      const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
      scrimEl.style.background = isDark ? 'rgba(0, 0, 0, 0.34)' : 'rgba(0, 0, 0, 0.14)';
      stageEl.appendChild(scrimEl);
      createdNodes.push(scrimEl);
      animations.push(scrimEl.animate(
        isExpand ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: handoff ? handoff.scrimOpacity : 1 }, { opacity: 0 }],
        { duration, easing: FLUID_MOTION_EASING, fill: 'both' },
      ));

      // 2. 实体不透明圆角载体背板（阻止半透明交叉溶解期间透出暗色 scrim；Android 走纯合成层缩放避免 clip-path）
      const surfaceBgEl = document.createElement('div');
      surfaceBgEl.className = 'route-container-surface-bg';
      surfaceBgEl.style.width = `${stageWidth}px`;
      surfaceBgEl.style.height = `${stageHeight}px`;
      surfaceBgEl.style.backgroundColor = anchor?.backgroundColor || 'var(--surface, #ffffff)';
      stageEl.appendChild(surfaceBgEl);
      createdNodes.push(surfaceBgEl);
      if (androidFast) {
        surfaceBgEl.style.willChange = 'transform, opacity';
        animations.push(surfaceBgEl.animate(
          buildCompositorScaleKeyframes(
            fromBox,
            toBox,
            stageWidth,
            stageHeight,
            fallbackUsed ? (isExpand ? [0.25, 1] : [1, 0]) : undefined,
          ),
          { duration, easing: FLUID_MOTION_EASING, fill: 'both' },
        ));
      } else {
        animations.push(surfaceBgEl.animate(
          buildContainerMorphKeyframes(fromBox, toBox, stageWidth, stageHeight, {
            opacityRange: fallbackUsed
              ? (isExpand ? [0.25, 1, 0, 0.45] : [1, 0, 0.35, 1])
              : undefined,
          }),
          { duration, easing: FLUID_MOTION_EASING, fill: 'both' },
        ));
      }

      // 3. 源卡片轻量镜像（桌面/非 Android 端在原卡片尺度段交叉淡出/淡入；Android 跳过深层 DOM 克隆和额外裁剪通道）
      if (!androidFast && anchor?.previewNode && !fallbackUsed) {
        const ghostWrap = document.createElement('div');
        ghostWrap.className = 'route-container-ghost';
        const ghostW = parseFloat(anchor.previewNode.style.width) || targetCardBox.width;
        const ghostH = parseFloat(anchor.previewNode.style.height) || targetCardBox.height;
        ghostWrap.style.width = `${ghostW}px`;
        ghostWrap.style.height = `${ghostH}px`;
        ghostWrap.style.zIndex = isExpand ? '5' : '3';
        ghostWrap.appendChild(clonePreview ? anchor.previewNode.cloneNode(true) : anchor.previewNode);
        stageEl.appendChild(ghostWrap);
        createdNodes.push(ghostWrap);

        animations.push(ghostWrap.animate(
          buildContainerMorphKeyframes(fromBox, toBox, ghostW, ghostH, {
            opacityRange: isExpand ? [1, 0, 0.05, 0.52] : [0, 1, 0.35, 0.88],
          }),
          { duration, easing: FLUID_MOTION_EASING, fill: 'both' },
        ));
      }

      // 4. 详情页主体（Expand 为 enterEl，Collapse 为 leaveEl）
      // 不改动 detailEl 的 overflow，避免详情页滚动容器 scrollTop 归零跳闪。
      const savedDetailScrollTop = !isExpand ? detailEl.scrollTop : 0;
      saveStyle(detailEl, ['position', 'inset', 'top', 'left', 'width', 'height', 'zIndex', 'pointerEvents', 'transformOrigin', 'willChange', 'backgroundColor']);
      detailEl.style.position = 'absolute';
      detailEl.style.top = '0';
      detailEl.style.left = '0';
      detailEl.style.width = `${stageWidth}px`;
      detailEl.style.height = `${stageHeight}px`;
      detailEl.style.zIndex = '4';
      detailEl.style.pointerEvents = 'none';
      detailEl.style.transformOrigin = androidFast ? 'center center' : '0 0';
      detailEl.style.willChange = androidFast ? 'transform, opacity' : 'transform, clip-path, opacity';
      if (savedDetailScrollTop > 0) detailEl.scrollTop = savedDetailScrollTop;
      if (detailBackground === 'var(--surface, #ffffff)') {
        detailEl.style.backgroundColor = anchor?.backgroundColor || 'var(--surface, #ffffff)';
      }

      const detailKeyframes = androidFast
        ? buildCompositorCenterMorphKeyframes(
            targetCardBox,
            localStageBox,
            isExpand ? 'enter' : 'leave',
            !isExpand ? handoffBox : null,
          )
        : buildContainerMorphKeyframes(fromBox, toBox, stageWidth, stageHeight, {
            opacityRange: fallbackUsed
              ? (isExpand ? [0, 1, 0, 0.6] : [1, 0, 0.2, 0.95])
              : isExpand
                ? [0, 1, 0.08, 0.58]
                : [1, 0, 0.05, 0.68],
          });

      const detailAnim = detailEl.animate(
        detailKeyframes,
        { duration, easing: FLUID_MOTION_EASING, fill: 'both' },
      );
      animations.push(detailAnim);
      detailAnim.onfinish = completeTransition;
      detailAnim.oncancel = completeTransition;
      safetyTimer = setTimeout(completeTransition, duration + 120);
    };

    if (isExpand) {
      const anchor = consumeForwardTransitionAnchor(options.targetKey, options.fromPath);
      const hideSourceEl = anchor?.sourceElement && leaveEl?.contains(anchor.sourceElement)
        ? anchor.sourceElement
        : null;
      runWithAnchor(anchor, hideSourceEl);
      return;
    }

    // Collapse：先立刻用退场详情页完全覆盖舞台，等待一个微任务让 routeScroll 完成列表 scrollTop 恢复，
    // 再精确读取已滚回位置的源卡片坐标并收缩回去，彻底消除无滚动位置闪烁。
    if (leaveEl) {
      saveStyle(leaveEl, ['position', 'inset', 'top', 'left', 'width', 'height', 'zIndex', 'pointerEvents']);
      leaveEl.style.position = 'absolute';
      leaveEl.style.inset = '0';
      leaveEl.style.width = '100%';
      leaveEl.style.height = '100%';
      leaveEl.style.zIndex = '4';
      leaveEl.style.pointerEvents = 'none';
    }

    void nextTick().then(() => {
      if (cancelled) return;
      const liveCard = findVisibleAnchorElement(enterEl, options.targetKey);
      let anchor: AnchorSnapshot | null = liveCard ? buildSnapshot(liveCard, options.targetKey, options.toPath) : null;
      let clonePreview = false;
      const saved = historyAnchorMap.get(historyKey(options.targetKey, options.toPath));
      if (!anchor && saved) {
        anchor = saved;
        clonePreview = true;
      } else if (anchor && saved?.previewNode && liveCard) {
        // KeepAlive 激活后的首帧 <AppImage> 仍可能处于延迟载入占位态；若历史快照内已带有完整图片，复用历史预览镜像消除灰色占位闪烁。
        const liveImgs = Array.from(liveCard.querySelectorAll('img')).filter((img) => Boolean(img.getAttribute('src')));
        const savedImgs = Array.from(saved.previewNode.querySelectorAll('img')).filter((img) => Boolean(img.getAttribute('src')));
        if (savedImgs.length > liveImgs.length) {
          anchor.previewNode = saved.previewNode.cloneNode(true) as HTMLElement;
        }
      }
      runWithAnchor(anchor, liveCard, clonePreview);
    });
  }

  return {
    prepare,
    onBeforeLeave(el: Element) {
      if (!(el instanceof HTMLElement)) return;
      el.classList.add('route-leaving-active');
      pendingSession.leaveEl = el;
    },
    onBeforeEnter(el: Element) {
      if (!(el instanceof HTMLElement)) return;
      pendingSession.enterEl = el;
    },
    onLeave(el: Element, done: () => void) {
      if (el instanceof HTMLElement) pendingSession.leaveEl = el;
      pendingSession.leaveDone = done;
      if (pendingSession.enterDone || !pendingSession.options) {
        startAnimation();
        return;
      }
      queueMicrotask(() => {
        if (!pendingSession.started && pendingSession.leaveDone === done) startAnimation();
      });
    },
    onEnter(el: Element, done: () => void) {
      if (el instanceof HTMLElement) pendingSession.enterEl = el;
      pendingSession.enterDone = done;
      startAnimation();
    },
    onFinishHook() {
      // Transition afterEnter/afterLeave/cancelled 统一做收尾保护。
      if (activeCleanup || pendingSession.enterDone || pendingSession.leaveDone) {
        resetSession(true);
      }
    },
    cancel: () => resetSession(true),
  };
}
