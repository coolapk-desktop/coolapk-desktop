import { prefersReducedMotion } from './compositorMotion';
import { FLUID_MOTION_EASING } from './containerTransform';
import { parseUrlImageDimensions, parseUrlImageRatio } from './image';

export interface ImageMorphRect {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: number;
  aspectRatio: number;
  naturalWidth?: number;
  naturalHeight?: number;
  src: string;
  isLong?: boolean;
  element?: HTMLElement;
}

export interface ViewerFitOptions {
  mobile?: boolean;
  isLivePhoto?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface FittedViewerBox {
  left: number;
  top: number;
  width: number;
  height: number;
  readMode?: boolean;
}

const VIEWER_OPEN_MS = 260;
const VIEWER_CLOSE_MS = 220;
const ANCHOR_FRESH_MS = 1200;

interface PendingEnterReadyPayload {
  upgradedSrc: string;
  liveRect?: DOMRect | { left: number; top: number; width: number; height: number } | null;
  readMode?: boolean;
}

let pendingImageAnchor: (ImageMorphRect & { element: HTMLElement; capturedAt: number }) | null = null;
let lastClickedThumbEl: { element: HTMLElement; at: number } | null = null;
let activeViewerCleanup: (() => void) | null = null;
let settlePendingEnterProxy: ((payload: PendingEnterReadyPayload) => void) | null = null;

function readImageElementFromOrigin(origin: HTMLElement): HTMLImageElement | null {
  if (origin instanceof HTMLImageElement) return origin;
  return origin.querySelector('img');
}

function readBorderRadiusPx(element: HTMLElement): number {
  if (typeof getComputedStyle !== 'function') return 12;
  const raw = parseFloat(getComputedStyle(element).borderTopLeftRadius || '');
  return Number.isFinite(raw) ? Math.min(32, Math.max(0, raw)) : 12;
}

function measureThumbRect(
  origin: HTMLElement | null | undefined,
  sourceUrl = '',
): (ImageMorphRect & { element: HTMLElement }) | null {
  if (!origin || !origin.isConnected || typeof origin.getBoundingClientRect !== 'function') return null;
  const img = readImageElementFromOrigin(origin);
  // 必须读取缩略图容器（如 .grid-item）的裁剪可视边界，确保多图 1:1 裁切与圆角严格对齐。
  const rect = origin.getBoundingClientRect();
  if (rect.width < 12 || rect.height < 12) return null;
  const effectiveUrl = sourceUrl || origin.getAttribute('data-context-image-url') || '';
  const urlDims = parseUrlImageDimensions(effectiveUrl);
  const urlRatio = urlDims ? urlDims.width / urlDims.height : parseUrlImageRatio(effectiveUrl);
  const natRatio = urlRatio > 0
    ? urlRatio
    : img && img.naturalWidth > 0 && img.naturalHeight > 0
      ? img.naturalWidth / img.naturalHeight
      : rect.width / Math.max(1, rect.height);
  return {
    element: origin,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius: readBorderRadiusPx(origin),
    aspectRatio: natRatio,
    ...(urlDims ? { naturalWidth: urlDims.width, naturalHeight: urlDims.height } : {}),
    src: img?.currentSrc || img?.src || '',
    isLong: origin.classList.contains('is-long-image'),
  };
}

/** 显式记录即将打开大图查看器的缩略图节点。 */
export function captureImageViewerAnchor(origin: HTMLElement | null | undefined, sourceUrl = ''): void {
  const measured = measureThumbRect(origin, sourceUrl);
  if (!measured) return;
  pendingImageAnchor = { ...measured, capturedAt: Date.now() };
}

/** 根据当前展示的原图地址在页面中重新定位对应缩略图（支持翻页到其他图片后精确缩回）。 */
export function findMatchingImageThumb(
  sourceUrl: string,
  preferredScope?: ParentNode | null,
): (ImageMorphRect & { element: HTMLElement }) | null {
  if (typeof document === 'undefined' || !sourceUrl) return null;
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(sourceUrl)
    : sourceUrl.replace(/["\\]/g, '\\$&');
  const selector = `[data-context-image-url="${escaped}"]`;
  const roots: ParentNode[] = preferredScope && preferredScope !== document
    ? [preferredScope, document]
    : [document];
  for (const root of roots) {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const el of candidates) {
      if (el.closest('.image-viewer-backdrop, [aria-hidden="true"], [inert]')) continue;
      const measured = measureThumbRect(el, sourceUrl);
      if (measured) return measured;
    }
  }
  return null;
}

export function consumePendingImageViewerAnchor(): ImageMorphRect | null {
  const now = Date.now();
  const explicit = pendingImageAnchor;
  pendingImageAnchor = null;
  if (explicit && now - explicit.capturedAt <= ANCHOR_FRESH_MS) return explicit;
  if (lastClickedThumbEl && now - lastClickedThumbEl.at <= ANCHOR_FRESH_MS) {
    const attrUrl = lastClickedThumbEl.element.getAttribute('data-context-image-url') || '';
    const measured = measureThumbRect(lastClickedThumbEl.element, attrUrl);
    lastClickedThumbEl = null;
    if (measured) return measured;
  }
  return null;
}

export function trackImageViewerPointerCandidate(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const candidate = target.closest<HTMLElement>(
    '[data-context-image-url], .grid-item, .pic-thumb, .media-item, .screenshot-item, .msg-pic-only-card, .msg-pic-container, .notify-image, .message-image',
  );
  if (candidate) {
    lastClickedThumbEl = { element: candidate, at: Date.now() };
  }
}

export function computeFittedViewerImageBox(
  stageRect: DOMRect,
  aspectRatio: number,
  options: ViewerFitOptions = {},
): FittedViewerBox {
  const vw = typeof window !== 'undefined' ? window.innerWidth : stageRect.width;
  const vh = typeof window !== 'undefined' ? window.innerHeight : stageRect.height;
  const mobile = Boolean(options.mobile);
  const stageW = stageRect.width || vw;
  const stageH = stageRect.height || vh;
  const hasKnownDims = Number(options.naturalWidth) > 0 && Number(options.naturalHeight) > 0;
  const ratio = hasKnownDims
    ? Number(options.naturalWidth) / Number(options.naturalHeight)
    : aspectRatio > 0
      ? aspectRatio
      : 1;

  if (mobile) {
    const readMode = !options.isLivePhoto
      && ratio < 0.4090909
      && (stageW / Math.max(1, stageH) >= 0.75 || ratio < stageW / Math.max(1, stageH) / 1.2);
    if (readMode) {
      const width = stageW / Math.max(1, stageH) >= 0.75 ? stageH * 9 / 16 : stageW;
      return {
        left: stageRect.left + (stageW - width) / 2,
        top: stageRect.top,
        width: Math.max(1, width),
        height: Math.max(1, stageH),
        readMode: true,
      };
    }
    let width = stageW;
    let height = width / ratio;
    if (height > stageH) {
      height = stageH;
      width = height * ratio;
    }
    return {
      left: stageRect.left + (stageW - width) / 2,
      top: stageRect.top + (stageH - height) / 2,
      width: Math.max(1, width),
      height: Math.max(1, height),
      readMode: false,
    };
  }

  const maxW = Math.min(stageW, vw * 0.9);
  const maxH = Math.min(stageH, vh * 0.88);
  let width = maxW;
  let height = width / ratio;
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  if (hasKnownDims) {
    const natW = Number(options.naturalWidth);
    const natH = Number(options.naturalHeight);
    const scale = Math.min(1, maxW / natW, maxH / natH);
    width = natW * scale;
    height = natH * scale;
  }
  return {
    left: stageRect.left + (stageW - width) / 2,
    top: stageRect.top + (stageH - height) / 2,
    width: Math.max(1, width),
    height: Math.max(1, height),
    readMode: false,
  };
}

function safeCancel(anim: Animation | null | undefined) {
  if (!anim) return;
  try { anim.cancel(); } catch { /* ignore */ }
}

/** 通知正在接管入场末帧的代理图片卸载（高清大图解码完成后或用户操作时调用）。 */
export function notifyImageViewerImageReady(
  upgradedSrc = '',
  liveRect: DOMRect | { left: number; top: number; width: number; height: number } | null = null,
  readMode = false,
): void {
  if (!settlePendingEnterProxy) return;
  const fn = settlePendingEnterProxy;
  settlePendingEnterProxy = null;
  fn({ upgradedSrc, liveRect, readMode });
}

export function cancelActiveImageViewerMorph(): void {
  if (settlePendingEnterProxy) {
    const fn = settlePendingEnterProxy;
    settlePendingEnterProxy = null;
    fn({ upgradedSrc: '' });
  }
  if (activeViewerCleanup) {
    const fn = activeViewerCleanup;
    activeViewerCleanup = null;
    fn();
  }
}

interface ProxyBoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function createMorphClipProxy(
  baseWidth: number,
  baseHeight: number,
  borderRadius: number,
  initialRect: ProxyBoxRect,
  src: string,
  isLong = false,
): { wrap: HTMLElement; img: HTMLImageElement } {
  const safeBaseW = Math.max(1, baseWidth);
  const safeBaseH = Math.max(1, baseHeight);
  const initSx = Math.max(0.01, initialRect.width / safeBaseW);
  const initSy = Math.max(0.01, initialRect.height / safeBaseH);
  const initU = Math.max(initSx, initSy);
  const wrap = document.createElement('div');
  wrap.className = 'viewer-morph-proxy';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = [
    'position:fixed',
    'left:0px',
    'top:0px',
    `width:${safeBaseW}px`,
    `height:${safeBaseH}px`,
    `border-radius:${borderRadius}px`,
    'transform-origin:0 0',
    `transform:translate3d(${initialRect.left.toFixed(2)}px, ${initialRect.top.toFixed(2)}px, 0) scale(${initSx.toFixed(5)}, ${initSy.toFixed(5)})`,
    'will-change:transform',
    'overflow:hidden',
    'contain:layout style',
    'pointer-events:none',
    'z-index:3005',
  ].join(';');

  const img = document.createElement('img');
  img.className = 'viewer-morph-proxy-img';
  img.src = src;
  img.alt = '';
  img.style.cssText = [
    'width:100%',
    'height:100%',
    'display:block',
    'object-fit:cover',
    `object-position:${isLong ? 'top center' : 'center center'}`,
    `transform-origin:${isLong ? 'center top' : 'center center'}`,
    `transform:scale(${(initU / initSx).toFixed(5)}, ${(initU / initSy).toFixed(5)})`,
    'will-change:transform',
    'user-select:none',
    'pointer-events:none',
  ].join(';');
  wrap.appendChild(img);
  document.body.appendChild(wrap);
  return { wrap, img };
}

function formatProxyTransform(rect: ProxyBoxRect, baseW: number, baseH: number): {
  wrapTransform: string;
  imgTransform: string;
  needsImgComp: boolean;
} {
  const sx = Math.max(0.01, rect.width / Math.max(1, baseW));
  const sy = Math.max(0.01, rect.height / Math.max(1, baseH));
  const u = Math.max(sx, sy);
  const ix = u / sx;
  const iy = u / sy;
  return {
    wrapTransform: `translate3d(${rect.left.toFixed(2)}px, ${rect.top.toFixed(2)}px, 0) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`,
    imgTransform: `scale(${ix.toFixed(5)}, ${iy.toFixed(5)})`,
    needsImgComp: Math.abs(ix - 1) > 0.002 || Math.abs(iy - 1) > 0.002,
  };
}

function animateProxyMorph(
  wrap: HTMLElement,
  img: HTMLImageElement,
  from: ProxyBoxRect,
  to: ProxyBoxRect,
  baseW: number,
  baseH: number,
  duration: number,
): { boxAnim: Animation; imgAnim: Animation | null } {
  const steps = 8;
  const wrapFrames: Keyframe[] = [];
  const imgFrames: Keyframe[] = [];
  let needsImgComp = false;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sample: ProxyBoxRect = {
      left: from.left + (to.left - from.left) * t,
      top: from.top + (to.top - from.top) * t,
      width: Math.max(1, from.width + (to.width - from.width) * t),
      height: Math.max(1, from.height + (to.height - from.height) * t),
    };
    const formatted = formatProxyTransform(sample, baseW, baseH);
    wrapFrames.push({ transform: formatted.wrapTransform });
    imgFrames.push({ transform: formatted.imgTransform });
    if (formatted.needsImgComp) needsImgComp = true;
  }

  const timing: KeyframeAnimationOptions = { duration, easing: FLUID_MOTION_EASING, fill: 'both' };
  const boxAnim = wrap.animate(wrapFrames, timing);
  const imgAnim = needsImgComp && typeof img.animate === 'function'
    ? img.animate(imgFrames, timing)
    : null;
  if (!needsImgComp) img.style.transform = 'scale(1, 1)';
  return { boxAnim, imgAnim };
}

function clampRectToStage(
  rect: { left: number; top: number; width: number; height: number },
  stageRect: DOMRect,
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(stageRect.left, rect.left);
  const top = Math.max(stageRect.top, rect.top);
  const right = Math.min(stageRect.left + stageRect.width, rect.left + rect.width);
  const bottom = Math.min(stageRect.top + stageRect.height, rect.top + rect.height);
  if (right - left < 12 || bottom - top < 12) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

/** 运行大图打开时的缩略图容器展开动效；使用裁切容器盒 + cover 重采样，避免 scale 拉伸变形和低分辨率糊化。 */
export function runImageViewerEnterMorph(
  backdropEl: HTMLElement,
  anchor: ImageMorphRect | null,
  done: () => void,
  options: { preferredSrc?: string; mobile?: boolean; isLivePhoto?: boolean } = {},
): () => void {
  cancelActiveImageViewerMorph();
  if (prefersReducedMotion() || typeof backdropEl.animate !== 'function') {
    done();
    return () => {};
  }
  const stage = backdropEl.querySelector<HTMLElement>('.image-stage');
  const stageRect = stage?.getBoundingClientRect();
  const initialSrc = options.preferredSrc || anchor?.src || '';
  if (!stageRect || stageRect.width < 32 || stageRect.height < 32 || !anchor || !initialSrc) {
    const anim = backdropEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: FLUID_MOTION_EASING });
    let finished = false;
    const finish = () => { if (!finished) { finished = true; activeViewerCleanup = null; done(); } };
    anim.onfinish = finish;
    anim.oncancel = finish;
    const timer = setTimeout(finish, 260);
    activeViewerCleanup = () => { clearTimeout(timer); safeCancel(anim); finish(); };
    return activeViewerCleanup;
  }

  const viewerImg = backdropEl.querySelector<HTMLImageElement>('.viewer-img');
  const targetBox = computeFittedViewerImageBox(stageRect, anchor.aspectRatio, {
    mobile: options.mobile,
    isLivePhoto: options.isLivePhoto,
    naturalWidth: (viewerImg?.complete && viewerImg.naturalWidth > 0 ? viewerImg.naturalWidth : anchor.naturalWidth) || undefined,
    naturalHeight: (viewerImg?.complete && viewerImg.naturalHeight > 0 ? viewerImg.naturalHeight : anchor.naturalHeight) || undefined,
  });
  if (viewerImg) viewerImg.style.opacity = '0';

  const thumbEl = anchor.element && anchor.element.isConnected ? anchor.element : null;
  const prevThumbVisibility = thumbEl ? thumbEl.style.visibility : '';
  if (thumbEl) thumbEl.style.visibility = 'hidden';

  const { wrap, img } = createMorphClipProxy(
    targetBox.width,
    targetBox.height,
    4,
    anchor,
    initialSrc,
    Boolean(anchor.isLong || targetBox.readMode),
  );

  const bgAnim = backdropEl.animate(
    [{ backgroundColor: 'rgba(0, 0, 0, 0)' }, { backgroundColor: 'rgba(0, 0, 0, 0.92)' }],
    { duration: VIEWER_OPEN_MS, easing: FLUID_MOTION_EASING, fill: 'both' },
  );
  const topbar = backdropEl.querySelector<HTMLElement>('.viewer-topbar');
  const bottombar = backdropEl.querySelector<HTMLElement>('.viewer-bottombar');
  const chromeAnims: Animation[] = [];
  if (topbar) chromeAnims.push(topbar.animate([{ opacity: 0, transform: 'translate3d(0,-10px,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }], { duration: VIEWER_OPEN_MS, easing: FLUID_MOTION_EASING }));
  if (bottombar) chromeAnims.push(bottombar.animate([{ opacity: 0, transform: 'translate3d(-50%, 10px, 0)' }, { opacity: 1, transform: 'translate3d(-50%, 0, 0)' }], { duration: VIEWER_OPEN_MS, easing: FLUID_MOTION_EASING }));

  const { boxAnim, imgAnim } = animateProxyMorph(
    wrap,
    img,
    anchor,
    targetBox,
    targetBox.width,
    targetBox.height,
    VIEWER_OPEN_MS,
  );

  let morphEnded = false;
  let proxyRemoved = false;
  let cleaned = false;
  let doneCalled = false;
  let reconcileAnim: Animation | null = null;
  let reconcileImgAnim: Animation | null = null;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let readyWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let latestReadyRect: { left: number; top: number; width: number; height: number } | null = null;

  const callDone = () => {
    if (doneCalled) return;
    doneCalled = true;
    done();
  };

  const clearAnimHandlers = (anim: Animation | null | undefined) => {
    if (!anim) return;
    anim.onfinish = null;
    anim.oncancel = null;
  };

  const removeProxy = () => {
    if (proxyRemoved) return;
    proxyRemoved = true;
    if (reconcileTimer !== null) {
      clearTimeout(reconcileTimer);
      reconcileTimer = null;
    }
    clearAnimHandlers(reconcileAnim);
    clearAnimHandlers(reconcileImgAnim);
    safeCancel(reconcileAnim);
    safeCancel(reconcileImgAnim);
    reconcileAnim = null;
    reconcileImgAnim = null;
    wrap.remove();
    const currentViewerImg = backdropEl.querySelector<HTMLImageElement>('.viewer-img');
    if (currentViewerImg) currentViewerImg.style.opacity = '';
    if (settlePendingEnterProxy === handleReady) settlePendingEnterProxy = null;
    if (morphEnded && activeViewerCleanup === cleanup) activeViewerCleanup = null;
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    if (readyWaitTimer !== null) {
      clearTimeout(readyWaitTimer);
      readyWaitTimer = null;
    }
    if (activeViewerCleanup === cleanup) activeViewerCleanup = null;
    if (settlePendingEnterProxy === handleReady) settlePendingEnterProxy = null;
    clearAnimHandlers(bgAnim);
    clearAnimHandlers(boxAnim);
    clearAnimHandlers(imgAnim);
    safeCancel(bgAnim);
    safeCancel(boxAnim);
    safeCancel(imgAnim);
    chromeAnims.forEach((anim) => {
      clearAnimHandlers(anim);
      safeCancel(anim);
    });
    if (thumbEl) thumbEl.style.visibility = prevThumbVisibility;
    removeProxy();
    callDone();
  };

  const settleProxyIntoFinalBox = (finalRect: { left: number; top: number; width: number; height: number } | null) => {
    if (!finalRect) {
      removeProxy();
      return;
    }
    const diff = Math.max(
      Math.abs(finalRect.left - targetBox.left),
      Math.abs(finalRect.top - targetBox.top),
      Math.abs(finalRect.width - targetBox.width),
      Math.abs(finalRect.height - targetBox.height),
    );
    if (diff <= 2 || typeof wrap.animate !== 'function') {
      removeProxy();
      return;
    }
    clearAnimHandlers(reconcileAnim);
    clearAnimHandlers(reconcileImgAnim);
    safeCancel(reconcileAnim);
    safeCancel(reconcileImgAnim);
    const reconciled = animateProxyMorph(
      wrap,
      img,
      targetBox,
      finalRect,
      targetBox.width,
      targetBox.height,
      130,
    );
    reconcileAnim = reconciled.boxAnim;
    reconcileImgAnim = reconciled.imgAnim;
    reconcileTimer = setTimeout(removeProxy, 190);
    reconcileAnim.onfinish = removeProxy;
    reconcileAnim.oncancel = removeProxy;
  };

  const handleReady = (payload: PendingEnterReadyPayload) => {
    if (proxyRemoved || cleaned) return;
    if (!payload.upgradedSrc && !payload.liveRect) {
      if (readyWaitTimer !== null) {
        clearTimeout(readyWaitTimer);
        readyWaitTimer = null;
      }
      if (morphEnded) removeProxy();
      return;
    }
    const liveViewerImg = backdropEl.querySelector<HTMLImageElement>('.viewer-img');
    const nextSrc = payload.upgradedSrc || liveViewerImg?.src || '';
    if (nextSrc && img.src !== nextSrc) {
      img.src = nextSrc;
    }
    if (payload.readMode) {
      img.style.objectPosition = 'top center';
      img.style.transformOrigin = 'center top';
    }
    if (payload.liveRect && payload.liveRect.width >= 12 && payload.liveRect.height >= 12) {
      latestReadyRect = clampRectToStage(payload.liveRect, stageRect);
    }
    if (!morphEnded) return;
    if (readyWaitTimer !== null) {
      clearTimeout(readyWaitTimer);
      readyWaitTimer = null;
    }
    settleProxyIntoFinalBox(latestReadyRect);
  };

  const onMorphFinish = () => {
    if (morphEnded || cleaned) return;
    morphEnded = true;
    wrap.style.transform = `translate3d(${targetBox.left.toFixed(2)}px, ${targetBox.top.toFixed(2)}px, 0) scale(1, 1)`;
    img.style.transform = 'scale(1, 1)';
    // Detach WAAPI handlers before cancelling finished animations so Chromium does not queue spurious cancel cleanups.
    clearAnimHandlers(bgAnim);
    clearAnimHandlers(boxAnim);
    clearAnimHandlers(imgAnim);
    safeCancel(bgAnim);
    safeCancel(boxAnim);
    safeCancel(imgAnim);
    chromeAnims.forEach((anim) => {
      clearAnimHandlers(anim);
      safeCancel(anim);
    });
    if (thumbEl) thumbEl.style.visibility = prevThumbVisibility;

    const currentViewerImg = backdropEl.querySelector<HTMLImageElement>('.viewer-img');
    if (currentViewerImg && currentViewerImg.complete && currentViewerImg.naturalWidth > 0) {
      settlePendingEnterProxy = null;
      if (currentViewerImg.src && img.src !== currentViewerImg.src) img.src = currentViewerImg.src;
      let fallbackRect = latestReadyRect;
      if (!fallbackRect) {
        const rawRect = currentViewerImg.getBoundingClientRect();
        if (rawRect.width >= 12 && rawRect.height >= 12) {
          fallbackRect = clampRectToStage(rawRect, stageRect);
        }
      }
      settleProxyIntoFinalBox(fallbackRect);
    } else if (currentViewerImg || (backdropEl.isConnected && !backdropEl.querySelector('.viewer-load-error'))) {
      // 原图仍在异步解码/下载时先用定格在目标位置的封面平稳承接，避免闪烁黑屏；解码好即刻无缝切换。
      settlePendingEnterProxy = handleReady;
      readyWaitTimer = setTimeout(() => {
        readyWaitTimer = null;
        removeProxy();
      }, 1400);
    } else {
      removeProxy();
    }
    callDone();
  };

  const timer = setTimeout(onMorphFinish, VIEWER_OPEN_MS + 100);
  boxAnim.onfinish = () => { clearTimeout(timer); onMorphFinish(); };
  boxAnim.oncancel = cleanup;
  settlePendingEnterProxy = handleReady;
  activeViewerCleanup = cleanup;
  return cleanup;
}

/** 运行大图关闭时的容器收起动效；裁切回源缩略图方框且全程不透明，杜绝竖图上下溢出和重影糊化。 */
export function runImageViewerLeaveMorph(
  backdropEl: HTMLElement,
  snapshot: {
    displayRect: DOMRect | null;
    src: string;
    targetThumb: ImageMorphRect | null;
    closedBySwipe: boolean;
  },
  done: () => void,
): () => void {
  cancelActiveImageViewerMorph();
  if (prefersReducedMotion() || typeof backdropEl.animate !== 'function') {
    done();
    return () => {};
  }

  if (snapshot.closedBySwipe || !snapshot.displayRect || snapshot.displayRect.width < 12 || !snapshot.targetThumb || !snapshot.src) {
    const anim = backdropEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: FLUID_MOTION_EASING, fill: 'both' });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (activeViewerCleanup === finish) activeViewerCleanup = null;
      safeCancel(anim);
      done();
    };
    const timer = setTimeout(finish, 260);
    anim.onfinish = finish;
    anim.oncancel = finish;
    activeViewerCleanup = finish;
    return finish;
  }

  const from = snapshot.displayRect;
  const to = snapshot.targetThumb;
  const thumbEl = to.element && to.element.isConnected ? to.element : null;
  const prevThumbVisibility = thumbEl ? thumbEl.style.visibility : '';
  if (thumbEl) thumbEl.style.visibility = 'hidden';

  const { wrap, img } = createMorphClipProxy(
    from.width,
    from.height,
    4,
    from,
    snapshot.src,
    Boolean(to.isLong),
  );

  const stage = backdropEl.querySelector<HTMLElement>('.image-stage');
  const topbar = backdropEl.querySelector<HTMLElement>('.viewer-topbar');
  const bottombar = backdropEl.querySelector<HTMLElement>('.viewer-bottombar');
  if (stage) stage.style.opacity = '0';
  if (topbar) topbar.style.opacity = '0';
  if (bottombar) bottombar.style.opacity = '0';

  const bgAnim = backdropEl.animate(
    [{ backgroundColor: 'rgba(0, 0, 0, 0.92)' }, { backgroundColor: 'rgba(0, 0, 0, 0)' }],
    { duration: VIEWER_CLOSE_MS, easing: FLUID_MOTION_EASING, fill: 'both' },
  );
  const { boxAnim, imgAnim } = animateProxyMorph(
    wrap,
    img,
    from,
    to,
    from.width,
    from.height,
    VIEWER_CLOSE_MS,
  );

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    if (activeViewerCleanup === cleanup) activeViewerCleanup = null;
    safeCancel(bgAnim);
    safeCancel(boxAnim);
    safeCancel(imgAnim);
    wrap.remove();
    if (thumbEl) thumbEl.style.visibility = prevThumbVisibility;
    done();
  };

  const timer = setTimeout(cleanup, VIEWER_CLOSE_MS + 100);
  boxAnim.onfinish = cleanup;
  boxAnim.oncancel = cleanup;
  activeViewerCleanup = cleanup;
  return cleanup;
}
