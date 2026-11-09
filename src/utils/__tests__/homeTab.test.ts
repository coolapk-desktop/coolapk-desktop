import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_TAB_DOUBLE_CLICK_MS,
  HOME_TAB_REFRESH_EVENT,
  HOME_TAB_SCROLL_TOP_EVENT,
  activateHomeTab,
  activateRootTab,
  isHomeTabDoubleClick,
  resetHomeTabClickState,
} from '../homeTab';

type RouterStub = {
  push: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
  currentRoute: { value: { path: string } };
};

function createRouterStub(path: string): RouterStub {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    currentRoute: { value: { path } },
  };
}

describe('首页单击 / 双击判据', () => {
  let now = 0;
  let scrollTopCount = 0;
  let refreshCount = 0;
  const onScrollTop = () => { scrollTopCount += 1; };
  const onRefresh = () => { refreshCount += 1; };

  beforeEach(() => {
    now = 10_000;
    scrollTopCount = 0;
    refreshCount = 0;
    resetHomeTabClickState();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    window.addEventListener(HOME_TAB_SCROLL_TOP_EVENT, onScrollTop);
    window.addEventListener(HOME_TAB_REFRESH_EVENT, onRefresh);
  });

  afterEach(() => {
    window.removeEventListener(HOME_TAB_SCROLL_TOP_EVENT, onScrollTop);
    window.removeEventListener(HOME_TAB_REFRESH_EVENT, onRefresh);
    resetHomeTabClickState();
    vi.restoreAllMocks();
  });

  it('双击窗口为 360ms，窗口内算双击、达到窗口不算', () => {
    expect(HOME_TAB_DOUBLE_CLICK_MS).toBe(360);
    expect(isHomeTabDoubleClick(0, 100)).toBe(false);
    expect(isHomeTabDoubleClick(1_000, 1_359)).toBe(true);
    expect(isHomeTabDoubleClick(1_000, 1_360)).toBe(false);
  });

  it('不在首页时只跳回首页，不派发任何首页事件', () => {
    const router = createRouterStub('/digital');
    expect(activateHomeTab(router as never)).toBe('navigate');
    expect(router.push).toHaveBeenCalledWith('/');
    expect(router.replace).not.toHaveBeenCalled();
    expect(scrollTopCount).toBe(0);
    expect(refreshCount).toBe(0);
  });

  it('顶部页面标签栏切换回首页时走 replace，不新增历史记录', () => {
    const router = createRouterStub('/discover');
    activateHomeTab(router as never, { replace: true });
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('在首页单击只回到顶部，不刷新', () => {
    const router = createRouterStub('/');
    expect(activateHomeTab(router as never)).toBe('single');
    expect(router.push).not.toHaveBeenCalled();
    expect(scrollTopCount).toBe(1);
    expect(refreshCount).toBe(0);
  });

  it('在首页双击先回到顶部再刷新当前栏目', () => {
    const router = createRouterStub('/');
    expect(activateHomeTab(router as never)).toBe('single');
    now += 200;
    expect(activateHomeTab(router as never)).toBe('double');
    expect(scrollTopCount).toBe(2);
    expect(refreshCount).toBe(1);
  });

  it('双击命中后清空状态，第三击只算新的一轮单击', () => {
    const router = createRouterStub('/');
    activateHomeTab(router as never);
    now += 200;
    activateHomeTab(router as never);
    now += 200;
    expect(activateHomeTab(router as never)).toBe('single');
    expect(refreshCount).toBe(1);
  });

  it('超过双击窗口的点击不刷新，只回到顶部', () => {
    const router = createRouterStub('/');
    activateHomeTab(router as never);
    now += HOME_TAB_DOUBLE_CLICK_MS;
    expect(activateHomeTab(router as never)).toBe('single');
    expect(refreshCount).toBe(0);
    expect(scrollTopCount).toBe(2);
  });

  it('从子页返回后的第一次点击不会沿用旧状态被判成双击', () => {
    const router = createRouterStub('/');
    activateHomeTab(router as never);
    // 进入子页：首页失活，此时点击「首页」只负责跳回。
    router.currentRoute.value.path = '/feed/1';
    expect(activateHomeTab(router as never)).toBe('navigate');
    // 立刻跳回首页：这一击必须重新起算，不能和失活前那一次拼成双击。
    router.currentRoute.value.path = '/';
    now += 20;
    expect(activateHomeTab(router as never)).toBe('single');
    expect(refreshCount).toBe(0);
  });

  it('拿不到路由器时安全降级，不抛异常', () => {
    expect(activateHomeTab(undefined)).toBe('navigate');
    expect(scrollTopCount).toBe(0);
  });

  it('数码 / 发现 / 我的 入口与首页共用同一套判据', () => {
    const digital = createRouterStub('/');
    expect(activateRootTab(digital as never, '/digital')).toBe('navigate');
    expect(digital.push).toHaveBeenCalledWith('/digital');
    expect(scrollTopCount).toBe(0);

    const active = createRouterStub('/discover');
    expect(activateRootTab(active as never, '/discover')).toBe('single');
    expect(active.push).not.toHaveBeenCalled();
    expect(scrollTopCount).toBe(1);
    expect(refreshCount).toBe(0);

    resetHomeTabClickState();
    const me = createRouterStub('/me');
    expect(activateRootTab(me as never, '/me')).toBe('single');
    expect(scrollTopCount).toBe(2);
    expect(me.push).not.toHaveBeenCalled();
  });

  it('非首页栏目已激活时把页面滚动容器滚回顶部', () => {
    const router = createRouterStub('/digital');
    const main = document.createElement('div');
    main.className = 'app-main-content';
    const scroller = document.createElement('div');
    scroller.className = 'digital-content';
    scroller.scrollTop = 480;
    main.appendChild(scroller);
    document.body.appendChild(main);
    try {
      expect(activateRootTab(router as never, '/digital')).toBe('single');
      expect(scroller.scrollTop).toBe(0);
    } finally {
      main.remove();
    }
  });

  it('activateHomeTab 作为首页别名保留旧行为', () => {
    const router = createRouterStub('/');
    expect(activateHomeTab(router as never)).toBe('single');
    expect(scrollTopCount).toBe(1);
  });
});
