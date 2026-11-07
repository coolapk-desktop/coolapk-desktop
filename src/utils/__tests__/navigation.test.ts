import { describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';
import {
  canNavigateBack,
  canNavigateForward,
  navigateBack,
  navigateForward,
  resolveBackFallback,
} from '../navigation';

function createRouterState(back: unknown, forward: unknown, path = '/') {
  return {
    currentRoute: { value: { path } },
    options: {
      history: {
        state: { back, forward },
      },
    },
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn().mockResolvedValue(undefined),
  } as unknown as Router;
}

describe('全局页面导航', () => {
  it('根据历史状态判断后退和前进是否可用', () => {
    const router = createRouterState('/feeds', '/user/1');
    expect(canNavigateBack(router)).toBe(true);
    expect(canNavigateForward(router)).toBe(true);

    const emptyRouter = createRouterState(null, null);
    expect(canNavigateBack(emptyRouter)).toBe(false);
    expect(canNavigateForward(emptyRouter)).toBe(false);
  });

  it('后退与前进调用路由历史栈', () => {
    const router = createRouterState('/feeds', '/user/1');
    navigateBack(router);
    navigateForward(router);

    expect(router.back).toHaveBeenCalledOnce();
    expect(router.forward).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('没有上一页时使用兜底页面且不会错误前进', () => {
    const router = createRouterState(null, null);
    navigateBack(router, '/discover');
    navigateForward(router);

    expect(router.replace).toHaveBeenCalledWith('/discover');
    expect(router.forward).not.toHaveBeenCalled();
  });
});

describe('深链返回兜底页面', () => {
  it.each([
    ['/user/12345', '/user/12345'],
    ['/user/12345/feeds', '/user/12345'],
    ['/topic/摄影', '/topics'],
    ['/live/88', '/discover'],
    ['/settings/network', '/settings'],
    ['/feed/42', '/'],
    ['/', '/'],
  ])('%s 的语义上级栏目是 %s', (path, expected) => {
    expect(resolveBackFallback(path)).toBe(expected);
  });

  it('没有应用内上一页时按当前路由选择语义兜底，而不是一律回首页', () => {
    const detail = createRouterState(null, null, '/user/12345');
    navigateBack(detail);
    expect(detail.back).not.toHaveBeenCalled();
    expect(detail.replace).toHaveBeenCalledWith('/user/12345');

    const topic = createRouterState(null, null, '/topic/摄影');
    navigateBack(topic);
    expect(topic.replace).toHaveBeenCalledWith('/topics');
  });

  it('显式传入的兜底页面优先于语义兜底', () => {
    const router = createRouterState(null, null, '/user/12345');
    navigateBack(router, '/me');
    expect(router.replace).toHaveBeenCalledWith('/me');
  });
});
