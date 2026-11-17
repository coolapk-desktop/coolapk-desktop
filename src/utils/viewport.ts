/**
 * iOS / WKWebView 兼容视口适配。
 *
 * 软键盘弹出时布局视口（以及 100vh / 100dvh）不会变化，只有 visualViewport 会收缩，
 * 因此弹窗与全屏编辑页会把工具栏留在键盘下方。这里把实时可视高度同步到 CSS 变量，
 * 并在键盘弹出时把焦点所在的输入区域滚进可视范围。
 */
export const APP_VIEWPORT_HEIGHT_VAR = '--app-viewport-height';
export const APP_VIEWPORT_TOP_VAR = '--app-viewport-top';
export const KEYBOARD_INSET_VAR = '--keyboard-inset';

/** 判定"键盘刚刚弹出"的高度差阈值，小于它视为地址栏之类的常规抖动。 */
const KEYBOARD_OPEN_DELTA = 60;
/** 键盘动画期间布局还在变化，等一小段再滚动，避免滚到一半又被顶回去。 */
const KEYBOARD_SCROLL_DELAY_MS = 120;

export interface ViewportMetrics {
  /** 当前真正可见的高度（px）。 */
  height: number;
  /** 可视视口相对布局视口的纵向偏移（px）：iOS 键盘把整页顶上去时大于 0。 */
  top: number;
  /** 被软键盘遮住的高度（px），键盘未弹出时为 0。 */
  keyboardInset: number;
}

type ViewportHost = {
  innerHeight: number;
  visualViewport?: { height: number; offsetTop?: number } | null;
};

/**
 * 取布局视口与可视视口的较小值：
 * - iOS 只收缩 visualViewport，取小值得到键盘上方的真实高度；
 * - Android/桌面按需重排布局视口时两者一致，取小值同样正确。
 */
export function measureViewport(host: ViewportHost): ViewportMetrics {
  const layoutHeight = Math.max(0, Math.round(host.innerHeight || 0));
  const visualHeight = Math.max(0, Math.round(host.visualViewport?.height ?? layoutHeight));
  const height = Math.min(layoutHeight, visualHeight);
  const top = Math.max(0, Math.round(host.visualViewport?.offsetTop ?? 0));
  return { height, top, keyboardInset: Math.max(0, layoutHeight - height) };
}

export function applyViewportMetrics(
  metrics: ViewportMetrics,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root) return;
  root.style.setProperty(APP_VIEWPORT_HEIGHT_VAR, `${metrics.height}px`);
  root.style.setProperty(APP_VIEWPORT_TOP_VAR, `${metrics.top}px`);
  root.style.setProperty(KEYBOARD_INSET_VAR, `${metrics.keyboardInset}px`);
}

/** 持续同步 CSS 变量，返回取消订阅函数。 */
export function setupViewportHeight(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let lastHeight = Number.NaN;
  let lastTop = Number.NaN;
  let lastKeyboardInset = Number.NaN;
  const sync = () => {
    const next = measureViewport(window);
    if (next.height === lastHeight && next.top === lastTop && next.keyboardInset === lastKeyboardInset) return;
    lastHeight = next.height;
    lastTop = next.top;
    lastKeyboardInset = next.keyboardInset;
    applyViewportMetrics(next);
  };
  sync();

  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', sync, { passive: true });
  viewport?.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('orientationchange', sync, { passive: true });

  return () => {
    viewport?.removeEventListener('resize', sync);
    viewport?.removeEventListener('scroll', sync);
    window.removeEventListener('resize', sync);
    window.removeEventListener('orientationchange', sync);
  };
}

/**
 * 键盘弹出时，把焦点所在的输入区域（优先其组合框/弹窗正文）滚到可视范围中间，
 * 让表情、图片、发送这些在编辑框下方的按钮不会被键盘挡住。
 */
export function setupKeyboardScrollAssist(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;

  let lastHeight = viewport.height;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onResize = () => {
    const height = viewport.height;
    const shrunk = height < lastHeight - KEYBOARD_OPEN_DELTA;
    lastHeight = height;
    if (!shrunk) return;

    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!active.closest('input, textarea, [contenteditable="true"]')) return;

    const target = active.closest<HTMLElement>('.comment-composer-box, .dialog-body, form') ?? active;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      target.scrollIntoView({ block: 'center' });
    }, KEYBOARD_SCROLL_DELAY_MS);
  };

  viewport.addEventListener('resize', onResize);
  return () => {
    if (timer !== null) clearTimeout(timer);
    viewport.removeEventListener('resize', onResize);
  };
}
