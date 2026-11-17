import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  triggerSidebarTransition,
  resetSidebarTransition,
  useSidebarTransition,
  getFeedDetailTransition,
  officialFeedDetailEasing,
  isDetailRoutePath,
  resolveRouteTransition,
} from '../routeTransition';

describe('routeTransition', () => {
  it('保留官方两段贝塞尔路径的衔接点和端点', () => {
    expect(officialFeedDetailEasing).toMatch(/^linear\(0 0%,/);
    expect(officialFeedDetailEasing).toContain('0.4 16.6666%');
    expect(officialFeedDetailEasing).toMatch(/1 100%\)$/);
  });
  it('详情打开、历史返回与桌面使用对应过渡，其他栏目和同路由不触发', () => {
    expect(getFeedDetailTransition('/', '/feed/42', false, true)).toBe('feed-detail-forward');
    expect(getFeedDetailTransition('/feed/42', '/', true, true)).toBe('feed-detail-back');
    expect(getFeedDetailTransition('/feed/42', '/feed/41', true, true)).toBe('feed-detail-back');
    expect(getFeedDetailTransition('/', '/feed/42', false, false)).toBe('feed-detail-desktop');
    expect(getFeedDetailTransition('/feed/42', '/external', false, true)).toBe('');
    expect(getFeedDetailTransition('/', '/digital', false, true)).toBe('');
    expect(getFeedDetailTransition('/feed/42', '/feed/42', false, true)).toBe('');
  });

  it('识别各类详情路由并排除聚合列表页', () => {
    expect(isDetailRoutePath('/feed/42')).toBe(true);
    expect(isDetailRoutePath('/question/9')).toBe(true);
    expect(isDetailRoutePath('/product/12')).toBe(true);
    expect(isDetailRoutePath('/app/com.coolapk.market')).toBe(true);
    expect(isDetailRoutePath('/dyh/3')).toBe(true);
    expect(isDetailRoutePath('/album/7')).toBe(true);
    expect(isDetailRoutePath('/apps')).toBe(false);
    expect(isDetailRoutePath('/albums')).toBe(false);
    expect(isDetailRoutePath('/')).toBe(false);
  });

  it('流畅模式在桌面端与移动端按场景分配容器展开收起、底栏并行横滑及侧栏/页签过渡', () => {
    expect(resolveRouteTransition({
      fromPath: '/',
      toPath: '/feed/42',
      backward: false,
      mobile: true,
      style: 'fluid',
    })).toBe('container-expand');
    expect(resolveRouteTransition({
      fromPath: '/feed/42',
      toPath: '/',
      backward: true,
      mobile: false,
      style: 'fluid',
    })).toBe('container-collapse');
    expect(resolveRouteTransition({
      fromPath: '/',
      toPath: '/me',
      backward: false,
      mobile: true,
      style: 'fluid',
    })).toBe('root-tab-next');
    expect(resolveRouteTransition({
      fromPath: '/me',
      toPath: '/digital',
      backward: false,
      mobile: true,
      style: 'fluid',
    })).toBe('root-tab-prev');
    expect(resolveRouteTransition({
      fromPath: '/',
      toPath: '/settings/appearance',
      backward: false,
      mobile: true,
      style: 'fluid',
    })).toBe('fluid-push');
    expect(resolveRouteTransition({
      fromPath: '/settings/appearance',
      toPath: '/',
      backward: true,
      mobile: true,
      style: 'fluid',
    })).toBe('fluid-pop');
    expect(resolveRouteTransition({
      fromPath: '/',
      toPath: '/discover',
      backward: false,
      mobile: false,
      style: 'fluid',
      sidebarTriggered: false,
      fromTabIndex: 0,
      toTabIndex: 2,
    })).toBe('desktop-tab-next');
    expect(resolveRouteTransition({
      fromPath: '/discover',
      toPath: '/',
      backward: false,
      mobile: false,
      style: 'fluid',
      sidebarTriggered: false,
      fromTabIndex: 2,
      toTabIndex: 0,
    })).toBe('desktop-tab-prev');
    expect(resolveRouteTransition({
      fromPath: '/',
      toPath: '/discover',
      backward: false,
      mobile: false,
      style: 'fluid',
      sidebarTriggered: true,
      fromTabIndex: 0,
      toTabIndex: 2,
    })).toBe('desktop-fluid');
  });

  it('官方原生模式保留既有详情过渡且减弱动态效时全部关闭', () => {
    expect(resolveRouteTransition({
      fromPath: '/',
      toPath: '/feed/42',
      backward: false,
      mobile: true,
      style: 'native',
    })).toBe('feed-detail-forward');
    expect(resolveRouteTransition({
      fromPath: '/',
      toPath: '/me',
      backward: false,
      mobile: true,
      style: 'native',
    })).toBe('');
    expect(resolveRouteTransition({
      fromPath: '/',
      toPath: '/feed/42',
      backward: false,
      mobile: false,
      style: 'fluid',
      reduceMotion: true,
    })).toBe('');
  });
  beforeEach(() => {
    vi.useFakeTimers();
    resetSidebarTransition();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSidebarTransition();
  });

  it('初始状态下侧边栏动效为未激活', () => {
    const { isSidebarTransitionActive } = useSidebarTransition();
    expect(isSidebarTransitionActive.value).toBe(false);
  });

  it('调用 triggerSidebarTransition 后激活动效并在超时后自动复位', () => {
    const { isSidebarTransitionActive } = useSidebarTransition();
    triggerSidebarTransition(500);
    expect(isSidebarTransitionActive.value).toBe(true);

    vi.advanceTimersByTime(499);
    expect(isSidebarTransitionActive.value).toBe(true);

    vi.advanceTimersByTime(2);
    expect(isSidebarTransitionActive.value).toBe(false);
  });

  it('手动调用 resetSidebarTransition 能立即复位状态并清理定时器', () => {
    const { isSidebarTransitionActive } = useSidebarTransition();
    triggerSidebarTransition(500);
    expect(isSidebarTransitionActive.value).toBe(true);

    resetSidebarTransition();
    expect(isSidebarTransitionActive.value).toBe(false);

    vi.advanceTimersByTime(600);
    expect(isSidebarTransitionActive.value).toBe(false);
  });
});
