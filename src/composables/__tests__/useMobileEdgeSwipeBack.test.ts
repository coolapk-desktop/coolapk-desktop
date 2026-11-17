import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useMobileEdgeSwipeBack } from '../useMobileEdgeSwipeBack';
import { consumeInteractiveBackHandoffBox } from '../../utils/containerTransform';

function mockRect(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
}

function makeTouchEvent(
  touches: Array<{ identifier: number; clientX: number; clientY: number }>,
  target: EventTarget,
  cancelable = true,
): TouchEvent {
  return {
    touches: Object.assign([...touches], { item: (i: number) => touches[i] ?? null }),
    target,
    cancelable,
    preventDefault: vi.fn(),
  } as unknown as TouchEvent;
}

describe('useMobileEdgeSwipeBack', () => {
  let stage: HTMLDivElement;
  let page: HTMLDivElement;
  let mockBack: ReturnType<typeof vi.fn>;
  let router: any;
  let currentPath: string;
  let cleanupHandle: (() => void) | null = null;

  beforeEach(() => {
    document.documentElement.removeAttribute('data-reduce-motion');
    window.history.replaceState({ position: 2 }, '', '/feed/42');
    currentPath = '/feed/42';

    stage = document.createElement('div');
    stage.className = 'route-transition-stage';
    mockRect(stage, { left: 0, top: 0, width: 390, height: 844 });

    page = document.createElement('div');
    page.className = 'feed-detail-page';
    mockRect(page, { left: 0, top: 0, width: 390, height: 844 });
    page.animate = vi.fn(() => ({
      onfinish: null,
      oncancel: null,
      cancel: vi.fn(),
    } as any));

    stage.appendChild(page);
    document.body.appendChild(stage);

    mockBack = vi.fn();
    router = {
      currentRoute: { get value() { return { path: currentPath }; } },
      back: mockBack,
    };
  });

  afterEach(() => {
    cleanupHandle?.();
    cleanupHandle = null;
    consumeInteractiveBackHandoffBox();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-reduce-motion');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('在详情页左边缘向右滑动越过阈值时触发 router.back 并交接实时坐标给收起过渡', () => {
    const stageRef = ref<HTMLElement | null>(stage);
    const gesture = useMobileEdgeSwipeBack({
      stageRef,
      router,
      enabled: () => true,
    });
    cleanupHandle = gesture.cleanup;

    gesture.onTouchStart(makeTouchEvent([{ identifier: 1, clientX: 14, clientY: 320 }], page));
    gesture.onTouchMove(makeTouchEvent([{ identifier: 1, clientX: 150, clientY: 332 }], page));

    expect(gesture.isEdgeSwiping.value).toBe(true);
    expect(page.style.transform).toContain('translate3d(');
    expect(page.style.borderRadius).not.toBe('');
    expect(stage.querySelector('.edge-swipe-scrim')).not.toBeNull();

    // 模拟移动后的页面当前视口矩形
    mockRect(page, { left: 115.6, top: 1.0, width: 372, height: 805 });
    gesture.onTouchEnd();

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(gesture.isEdgeSwiping.value).toBe(false);
    expect(stage.querySelector('.edge-swipe-scrim')).toBeNull();
    expect(page.style.getPropertyValue('--swipe-back-x')).toContain('px');

    const handoff = consumeInteractiveBackHandoffBox();
    expect(handoff).not.toBeNull();
    expect(handoff?.box.left).toBeCloseTo(115.6, 1);
    expect(handoff?.bgScale).toBeGreaterThan(0.96);
    expect(handoff?.scrimOpacity).toBeLessThan(1);
  });

  it('非左边缘起始、主栏目根目录、横向滚动区域及纵向滑动均不会误触返回', () => {
    const stageRef = ref<HTMLElement | null>(stage);
    const gesture = useMobileEdgeSwipeBack({
      stageRef,
      router,
      enabled: () => true,
    });
    cleanupHandle = gesture.cleanup;

    // 1) 超出左边缘热区 (>28px)
    gesture.onTouchStart(makeTouchEvent([{ identifier: 1, clientX: 48, clientY: 300 }], page));
    gesture.onTouchMove(makeTouchEvent([{ identifier: 1, clientX: 200, clientY: 300 }], page));
    expect(gesture.isEdgeSwiping.value).toBe(false);

    // 2) 主栏目根路由
    currentPath = '/discover';
    gesture.onTouchStart(makeTouchEvent([{ identifier: 2, clientX: 10, clientY: 300 }], page));
    gesture.onTouchMove(makeTouchEvent([{ identifier: 2, clientX: 160, clientY: 300 }], page));
    expect(gesture.isEdgeSwiping.value).toBe(false);

    // 3) 纵向滚动主导
    currentPath = '/feed/42';
    gesture.onTouchStart(makeTouchEvent([{ identifier: 3, clientX: 10, clientY: 300 }], page));
    gesture.onTouchMove(makeTouchEvent([{ identifier: 3, clientX: 18, clientY: 340 }], page));
    gesture.onTouchMove(makeTouchEvent([{ identifier: 3, clientX: 140, clientY: 340 }], page));
    expect(gesture.isEdgeSwiping.value).toBe(false);

    // 4) 横向滚动卡片区不抢手势
    const hScroll = document.createElement('div');
    hScroll.setAttribute('data-discovery-horizontal-scroll', '');
    page.appendChild(hScroll);
    gesture.onTouchStart(makeTouchEvent([{ identifier: 4, clientX: 12, clientY: 300 }], hScroll));
    gesture.onTouchMove(makeTouchEvent([{ identifier: 4, clientX: 160, clientY: 300 }], hScroll));
    expect(gesture.isEdgeSwiping.value).toBe(false);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('未达到提交阈值松手时弹性吸回并清理背景遮罩，关闭减弱动效则不拦截', () => {
    const stageRef = ref<HTMLElement | null>(stage);
    const gesture = useMobileEdgeSwipeBack({
      stageRef,
      router,
      enabled: () => true,
    });
    cleanupHandle = gesture.cleanup;

    const resetAnim = {
      onfinish: null as null | (() => void),
      oncancel: null as null | (() => void),
      cancel: vi.fn(),
    };
    const scrimResetAnim = { onfinish: null, oncancel: null, cancel: vi.fn() };
    page.animate = vi.fn(() => resetAnim as any);

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1000);
    gesture.onTouchStart(makeTouchEvent([{ identifier: 1, clientX: 10, clientY: 200 }], page));
    gesture.onTouchMove(makeTouchEvent([{ identifier: 1, clientX: 38, clientY: 202 }], page));
    expect(gesture.isEdgeSwiping.value).toBe(true);
    const scrim = stage.querySelector<HTMLElement>('.edge-swipe-scrim')!;
    scrim.animate = vi.fn(() => scrimResetAnim as any);

    // 慢速拖出 28px 不足阈值
    nowSpy.mockReturnValue(1600);
    gesture.onTouchEnd();
    expect(mockBack).not.toHaveBeenCalled();
    expect(page.animate).toHaveBeenCalledTimes(1);
    resetAnim.onfinish?.();
    expect(gesture.isEdgeSwiping.value).toBe(false);
    expect(stage.querySelector('.edge-swipe-scrim')).toBeNull();

    // 减弱动效时直接跳过
    document.documentElement.setAttribute('data-reduce-motion', 'true');
    gesture.onTouchStart(makeTouchEvent([{ identifier: 2, clientX: 10, clientY: 200 }], page));
    gesture.onTouchMove(makeTouchEvent([{ identifier: 2, clientX: 180, clientY: 200 }], page));
    expect(gesture.isEdgeSwiping.value).toBe(false);
  });

  it('Android WebView 下拖拽仅更新纯 transform，跳过 borderRadius 重算和大面积模糊阴影', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36' });
    const stageRef = ref<HTMLElement | null>(stage);
    const gesture = useMobileEdgeSwipeBack({
      stageRef,
      router,
      enabled: () => true,
    });
    cleanupHandle = gesture.cleanup;

    gesture.onTouchStart(makeTouchEvent([{ identifier: 1, clientX: 12, clientY: 320 }], page));
    gesture.onTouchMove(makeTouchEvent([{ identifier: 1, clientX: 150, clientY: 326 }], page));

    expect(gesture.isEdgeSwiping.value).toBe(true);
    expect(page.style.transform).toContain('translate3d(');
    expect(page.style.borderRadius).toBe('');
    expect(page.style.boxShadow).not.toContain('44px');

    gesture.onTouchEnd();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(page.style.getPropertyValue('--swipe-back-radius')).toBe('0px');
  });
});
