/** 补齐旧 WebView 缺少的并行请求接口，单个请求失败不能中断其余结果。 */
export function initializeWebViewCompatibility(): void {
  if (typeof Promise.allSettled === 'function') return;
  Object.defineProperty(Promise, 'allSettled', {
    configurable: true,
    writable: true,
    value: (values: Iterable<unknown>) => Promise.all(Array.from(values, value => Promise.resolve(value).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason })))),
  });
}
