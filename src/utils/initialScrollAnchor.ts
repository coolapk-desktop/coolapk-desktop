/** 初次进入时跟随异步正文和图片的尺寸变化；用户开始操作后立即停止，避免拉回阅读位置。 */
export function trackInitialScrollAnchor(target: HTMLElement, align: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const ancestors: HTMLElement[] = [target];
  let container = target.parentElement;
  while (container) {
    ancestors.push(container);
    if (/(auto|scroll|overlay)/.test(getComputedStyle(container).overflowY)) break;
    container = container.parentElement;
  }
  const scrollRoot = ancestors[ancestors.length - 1]!;
  let stopped = false;
  let frame: number | null = null;
  const observer = new ResizeObserver(() => {
    if (stopped || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!stopped && target.isConnected) align();
    });
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    for (const event of ['wheel', 'touchmove', 'pointerdown']) scrollRoot.removeEventListener(event, stop, true);
    scrollRoot.removeEventListener('keydown', onKeyDown, true);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop();
  };
  for (const ancestor of ancestors) observer.observe(ancestor);
  for (const event of ['wheel', 'touchmove', 'pointerdown']) scrollRoot.addEventListener(event, stop, { capture: true, passive: true });
  scrollRoot.addEventListener('keydown', onKeyDown, true);
  return stop;
}
