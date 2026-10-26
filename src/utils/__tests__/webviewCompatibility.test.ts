import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeWebViewCompatibility } from '../webviewCompatibility';

describe('旧 WebView 并行请求兼容', () => {
  afterEach(() => vi.restoreAllMocks());

  it('保留现代内核的原生实现', () => {
    const native = Promise.allSettled;
    initializeWebViewCompatibility();
    expect(Promise.allSettled).toBe(native);
  });

  it('缺少接口时保留成功、失败、普通值的顺序，并支持空集合', async () => {
    vi.spyOn(Promise, 'allSettled').mockImplementation(undefined as never);
    Object.defineProperty(Promise, 'allSettled', { configurable: true, writable: true, value: undefined });
    initializeWebViewCompatibility();
    const reason = new Error('本地测试失败');
    expect(await Promise.allSettled([Promise.resolve('完成'), Promise.reject(reason), 7])).toEqual([{ status: 'fulfilled', value: '完成' }, { status: 'rejected', reason }, { status: 'fulfilled', value: 7 }]);
    expect(await Promise.allSettled([])).toEqual([]);
  });
});
