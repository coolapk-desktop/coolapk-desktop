import { prefersReducedMotion } from './compositorMotion';
import { FLUID_MOTION_EASING } from './containerTransform';
import { parseUrlImageRatio } from './image';

export interface ImageMorphRect {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: number;
  aspectRatio: number;
  src: string;
  isLong?: boolean;
  element?: HTMLElement;
}

const VIEWER_OPEN_MS = 260;
const VIEWER_CLOSE_MS = 220;
const ANCHOR_FRESH_MS = 1200;

let pendingImageAnchor: (ImageMorphRect & { element: HTMLElement; capturedAt: number }) | null = null;
let lastClickedThumbEl: { element: HTMLElement; at: number } | null = null;
let activeViewerCleanup: (() => void) | null = null;
let settlePendingEnterProxy: (() => void) | null = null;

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
  const urlRatio = parseUrlImageRatio(sourceUrl);
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

export function computeFittedViewerImageBox(stageRect: DOMRect, aspectRatio: number): { left: number; top: number; width: number; height: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : stageRect.width;
  const vh = typeof window !== 'undefined' ? window.innerHeight : stageRect.height;
  const maxW = Math.min(stageRect.width || vw, vw * 0.9);
  const maxH = Math.min(stageRect.height || vh, vh * 0.88);
  const ratio = aspectRatio > 0 ? aspectRatio : 1;
  let width = maxW;
  let height = width / ratio;
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  return {
    left: stageRect.left + ((stageRect.width || vw) - width) / 2,
    top: stageRect.top + ((stageRect.height || vh) - height) / 2,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function safeCancel(anim: Animation | null | undefined) {
  if (!anim) return;
  try { anim.cancel(); } catch { /* ignore */ }
}

/** 通知正在接管入场末帧的代理图片卸载（高清大图解码完成后或用户操作时调用）。 */
export function notifyImageViewerImageReady(upgradedSrc = ''): void {
  if (!settlePendingEnterProxy) return;
  if (upgradedSrc) {
    const activeImg = document.querySelector<HTMLImageElement>('.viewer-morph-proxy-img');
    if (activeImg && activeImg.src !== upgradedSrc) activeImg.src = upgradedSrc;
  }
  const fn = settlePendingEnterProxy;
  settlePendingEnterProxy = null;
  fn();
}

export function cancelActiveImageViewerMorph(): void {
  if (settlePendingEnterProxy) {
    const fn = settlePendingEnterProxy;
    settlePendingEnterProxy = null;
    fn();
  }
  if (activeViewerCleanup) {
    const fn = activeViewerCleanup;
    activeViewerCleanup = null;
    fn();
  }
}

function createMorphClipProxy(
  box: { left: number; top: number; width: number; height: number; borderRadius: number },
  src: string,
  isLong = false,
): { wrap: HTMLElement; img: HTMLImageElement } {
  const wrap = document.createElement('div');
  wrap.className = 'viewer-morph-proxy';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = [
    'position:fixed',
    `left:${box.left}px`,
    `top:${box.top}px`,
    `width:${box.width}px`,
    `height:${box.height}px`,
    `border-radius:${box.borderRadius}px`,
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
    'user-select:none',
    'pointer-events:none',
  ].join(';');
  wrap.appendChild(img);
  document.body.appendChild(wrap);
  return { wrap, img };
}

/** 运行大图打开时的缩略图容器展开动效；使用裁切容器盒 + cover 重采样，避免 scale 拉伸变形和低分辨率糊化。 */
export function runImageViewerEnterMorph(
  backdropEl: HTMLElement,
  anchor: ImageMorphRect | null,
  done: () => void,
  options: { preferredSrc?: string } = {},
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

  const targetBox = computeFittedViewerImageBox(stageRect, anchor.aspectRatio);
  const viewerImg = backdropEl.querySelector<HTMLImageElement>('.viewer-img');
  if (viewerImg) viewerImg.style.opacity = '0';

  const thumbEl = anchor.element && anchor.element.isConnected ? anchor.element : null;
  const prevThumbVisibility = thumbEl ? thumbEl.style.visibility : '';
  if (thumbEl) thumbEl.style.visibility = 'hidden';

  const { wrap, img } = createMorphClipProxy(
    { left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height, borderRadius: anchor.borderRadius },
    initialSrc,
    Boolean(anchor.isLong),
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

  const boxAnim = wrap.animate(
    [
      {
        left: `${anchor.left}px`,
        top: `${anchor.top}px`,
        width: `${anchor.width}px`,
        height: `${anchor.height}px`,
        borderRadius: `${anchor.borderRadius}px`,
      },
      {
        left: `${targetBox.left}px`,
        top: `${targetBox.top}px`,
        width: `${targetBox.width}px`,
        height: `${targetBox.height}px`,
        borderRadius: '4px',
      },
    ],
    { duration: VIEWER_OPEN_MS, easing: FLUID_MOTION_EASING, fill: 'both' },
  );

  let morphEnded = false;
  let proxyRemoved = false;
  let cleaned = false;

  const removeProxy = () => {
    if (proxyRemoved) return;
    proxyRemoved = true;
    wrap.remove();
    const currentViewerImg = backdropEl.querySelector<HTMLImageElement>('.viewer-img');
    if (currentViewerImg) currentViewerImg.style.opacity = '';
  };

  let readyWaitTimer: ReturnType<typeof setTimeout> | null = null;

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
    safeCancel(bgAnim);
    safeCancel(boxAnim);
    chromeAnims.forEach(safeCancel);
    if (thumbEl) thumbEl.style.visibility = prevThumbVisibility;
    removeProxy();
    done();
  };

  const handleReady = () => {
    const liveViewerImg = backdropEl.querySelector<HTMLImageElement>('.viewer-img');
    if (liveViewerImg && liveViewerImg.src && img.src !== liveViewerImg.src) {
      img.src = liveViewerImg.src;
    }
    if (!morphEnded) return;
    if (readyWaitTimer !== null) {
      clearTimeout(readyWaitTimer);
      readyWaitTimer = null;
    }
    removeProxy();
  };

  const onMorphFinish = () => {
    morphEnded = true;
    if (activeViewerCleanup === cleanup) activeViewerCleanup = null;
    wrap.style.left = `${targetBox.left}px`;
    wrap.style.top = `${targetBox.top}px`;
    wrap.style.width = `${targetBox.width}px`;
    wrap.style.height = `${targetBox.height}px`;
    wrap.style.borderRadius = '4px';
    safeCancel(bgAnim);
    safeCancel(boxAnim);
    chromeAnims.forEach(safeCancel);
    if (thumbEl) thumbEl.style.visibility = prevThumbVisibility;

    const liveViewerImg = backdropEl.querySelector<HTMLImageElement>('.viewer-img');
    if (liveViewerImg && liveViewerImg.complete && liveViewerImg.naturalWidth > 0) {
      settlePendingEnterProxy = null;
      removeProxy();
    } else if (liveViewerImg || (backdropEl.isConnected && !backdropEl.querySelector('.viewer-load-error'))) {
      // 原图仍在异步解码/下载时先用定格在目标位置的封面平稳承接，避免闪烁黑屏；解码好即刻无缝切换。
      settlePendingEnterProxy = handleReady;
      readyWaitTimer = setTimeout(() => {
        readyWaitTimer = null;
        if (settlePendingEnterProxy === handleReady) settlePendingEnterProxy = null;
        removeProxy();
      }, 1400);
    } else {
      removeProxy();
    }
    done();
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

  const { wrap } = createMorphClipProxy(
    { left: from.left, top: from.top, width: from.width, height: from.height, borderRadius: 4 },
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
  const boxAnim = wrap.animate(
    [
      {
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        borderRadius: '4px',
      },
      {
        left: `${to.left}px`,
        top: `${to.top}px`,
        width: `${to.width}px`,
        height: `${to.height}px`,
        borderRadius: `${to.borderRadius}px`,
      },
    ],
    { duration: VIEWER_CLOSE_MS, easing: FLUID_MOTION_EASING, fill: 'both' },
  );

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    if (activeViewerCleanup === cleanup) activeViewerCleanup = null;
    safeCancel(bgAnim);
    safeCancel(boxAnim);
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
