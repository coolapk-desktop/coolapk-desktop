import { describe, expect, it, vi } from 'vitest';
import { listenMediaQuery } from '../mediaQuery';

describe('WebView 媒体查询订阅', () => {
  it.each([true, false])('新事件接口可用=%s 时正确订阅、响应和清理', modern => {
    let changed: (() => void) | undefined;
    const subscribe = vi.fn((...args: unknown[]) => { changed = args[modern ? 1 : 0] as () => void; });
    const unsubscribe = vi.fn();
    const media = (modern ? { addEventListener: subscribe, removeEventListener: unsubscribe } : { addListener: subscribe, removeListener: unsubscribe }) as unknown as MediaQueryList;
    const listener = vi.fn();
    const stop = listenMediaQuery(media, listener);
    changed?.();
    expect(listener).toHaveBeenCalledOnce();
    stop();
    expect(subscribe).toHaveBeenCalledWith(...(modern ? ['change', listener] : [listener]));
    expect(unsubscribe).toHaveBeenCalledWith(...(modern ? ['change', listener] : [listener]));
  });
});
