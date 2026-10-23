// 每个滚动容器共用一个观察器；预加载区必须相对于真实滚动容器计算。
const callbacks = new Map<Element, (visible: boolean) => void>();
const observers = new Map<Element | null, { observer: IntersectionObserver; count: number }>();

export function getResourceScrollRoot(element: Element): Element | null {
  // 动态流/详情明确声明滚动边界，批量恢复图片和卡片时无需逐级读取计算样式。
  const boundary = element.parentElement?.closest('[data-resource-scroll-root], .custom-scrollbar, [data-route-scroll]');
  if (boundary?.hasAttribute('data-resource-scroll-root')) return boundary;
  let root: Element | null = element.parentElement;
  while (root && root !== document.body && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
  return root === document.body ? null : root;
}

export function observeResourceVisibility(element: Element, callback: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true);
    return () => {};
  }
  const root = getResourceScrollRoot(element);
  let group = observers.get(root);
  if (!group) {
    group = { observer: new IntersectionObserver(entries => {
      for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
    }, { root, rootMargin: '600px 0px' }), count: 0 };
    observers.set(root, group);
  }
  const resourceGroup = group;
  resourceGroup.count += 1;
  callbacks.set(element, callback);
  resourceGroup.observer.observe(element);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    callbacks.delete(element);
    resourceGroup.observer.unobserve(element);
    if (--resourceGroup.count === 0) {
      resourceGroup.observer.disconnect();
      observers.delete(root);
    }
  };
}
