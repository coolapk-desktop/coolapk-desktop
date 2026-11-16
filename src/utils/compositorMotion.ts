export const READING_MOTION_DURATION_MS = 220;
export const READING_MOTION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

const activeSlides = new WeakMap<HTMLElement, Animation>();

export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-reduce-motion') === 'true') {
    return true;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

export function readTranslateOffset(element: HTMLElement | null | undefined, axis: 'x' | 'y'): number {
  if (!element || typeof getComputedStyle !== 'function') return 0;
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none') return 0;
  if (typeof DOMMatrix !== 'undefined') {
    try {
      const matrix = new DOMMatrix(transform);
      return axis === 'x' ? matrix.m41 : matrix.m42;
    } catch {
      return 0;
    }
  }
  const match = transform.match(/^matrix\(([^)]+)\)$/);
  if (!match) return 0;
  const parts = match[1]!.split(',').map(Number);
  const value = axis === 'x' ? parts[4] : parts[5];
  return Number.isFinite(value) ? value! : 0;
}

export function cancelTransformSlide(element: HTMLElement | null | undefined): void {
  if (!element) return;
  const existing = activeSlides.get(element);
  if (!existing) return;
  activeSlides.delete(element);
  element.style.willChange = '';
  try {
    existing.cancel();
  } catch {
    // 忽略已销毁元素的动画取消异常。
  }
}

export function animateTransformSlide(
  element: HTMLElement | null | undefined,
  axis: 'x' | 'y',
  fromPx: number,
  toPx: number,
  options: {
    duration?: number;
    easing?: string;
    onFinish?: () => void;
    onCancel?: () => void;
  } = {},
): Animation | null {
  if (!element) {
    options.onFinish?.();
    return null;
  }
  cancelTransformSlide(element);
  if (prefersReducedMotion() || typeof element.animate !== 'function' || Math.abs(fromPx - toPx) < 0.5) {
    options.onFinish?.();
    return null;
  }
  const from = axis === 'x' ? `translate3d(${fromPx}px, 0, 0)` : `translate3d(0, ${fromPx}px, 0)`;
  const to = axis === 'x' ? `translate3d(${toPx}px, 0, 0)` : `translate3d(0, ${toPx}px, 0)`;
  element.style.willChange = 'transform';
  const animation = element.animate(
    [{ transform: from }, { transform: to }],
    {
      duration: options.duration ?? READING_MOTION_DURATION_MS,
      easing: options.easing ?? READING_MOTION_EASING,
      fill: 'none',
    },
  );
  activeSlides.set(element, animation);
  animation.onfinish = () => {
    if (activeSlides.get(element) === animation) {
      activeSlides.delete(element);
      element.style.willChange = '';
    }
    options.onFinish?.();
  };
  animation.oncancel = () => {
    if (activeSlides.get(element) === animation) {
      activeSlides.delete(element);
      element.style.willChange = '';
    }
    options.onCancel?.();
  };
  return animation;
}
