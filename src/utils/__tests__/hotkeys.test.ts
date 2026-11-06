import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerGlobalHotkeys } from '../hotkeys';
import * as commentTracker from '../activeCommentTracker';
import { HOME_TAB_REFRESH_EVENT } from '../homeTab';

const { push, replace, back, cycle, historyState } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  cycle: vi.fn(),
  historyState: { state: { back: null as string | null, forward: null as string | null } },
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push,
    replace,
    back,
    forward: vi.fn(),
    options: { history: historyState },
    currentRoute: { value: { path: '/', fullPath: '/' } },
  }),
}));

vi.mock('../../stores/pageTabs', () => ({
  usePageTabsStore: () => ({
    tabs: [{ id: 'home', generation: 0 }],
    activeId: 'home',
    cycle,
    close: () => '/feed/123',
  }),
}));

vi.mock('../../stores/app', () => ({
  useAppStore: () => ({
    isSearchOpen: false,
    isPublishOpen: false,
    activeImageViewer: null,
    openPublish: vi.fn(),
  }),
}));

vi.mock('../../stores/settings', () => ({
  useSettingsStore: () => ({
    settings: { zoom: 100 },
    toggleSidebar: vi.fn(),
    setZoom: vi.fn(),
  }),
}));

describe('registerGlobalHotkeys', () => {
  it('Ctrl+R 刷新首页当前栏目', () => {
    const listener = vi.fn();
    window.addEventListener(HOME_TAB_REFRESH_EVENT, listener);
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true }));
      expect(listener).toHaveBeenCalledOnce();
    } finally { window.removeEventListener(HOME_TAB_REFRESH_EVENT, listener); }
  });
  let unregister: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    historyState.state.back = null;
    cycle.mockReturnValue('/feed/123');
    commentTracker.resetActiveComments();
    unregister = registerGlobalHotkeys();
  });

  afterEach(() => {
    unregister();
    commentTracker.resetActiveComments();
  });

  it.each([
    [{ key: 'Tab', ctrlKey: true }, 1],
    [{ key: 'Tab', ctrlKey: true, shiftKey: true }, -1],
    [{ key: 'PageDown', ctrlKey: true }, 1],
    [{ key: 'PageUp', ctrlKey: true }, -1],
    [{ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true }, 1],
    [{ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true }, -1],
    [{ key: ']', metaKey: true, shiftKey: true }, 1],
    [{ key: '[', metaKey: true, shiftKey: true }, -1],
  ] as const)('标签切换 %j 使用方向 %i 并入栈当前路由', (init, direction) => {
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true });
    window.dispatchEvent(event);
    expect(cycle).toHaveBeenCalledExactlyOnceWith(direction);
    // 切换页签用 push，保证随后后退能回到刚看过的那一页。
    expect(push).toHaveBeenCalledExactlyOnceWith('/feed/123');
    expect(replace).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    { key: 'Tab', metaKey: true },
    { key: 'Tab' },
    { key: 'Tab', ctrlKey: true, altKey: true },
    { key: '[', metaKey: true },
    { key: 'PageUp' },
    { key: 'Tab', ctrlKey: true, isComposing: true },
  ])('保留系统、输入法和其他按键 %j', (init) => {
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true });
    window.dispatchEvent(event);
    expect(cycle).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('输入框中也能切换标签，只有一个标签时不导航', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      cycle.mockReturnValueOnce(null);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true }));
      expect(cycle).toHaveBeenCalledExactlyOnceWith(1);
      expect(push).not.toHaveBeenCalled();
    } finally { input.remove(); }
  });

  it('关闭当前页签仍走 replace，历史里不留下已关闭的页面', () => {
    const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(replace).toHaveBeenCalledExactlyOnceWith('/feed/123');
    expect(push).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Alt+← 有应用内上一页时后退', () => {
    historyState.state.back = '/feed/1';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true }));
    expect(back).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it('Alt+← 深链进入且没有上一页时走语义兜底页面', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true }));
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('尊重已处理的键盘事件，注销后不再切换标签', () => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(cycle).not.toHaveBeenCalled();
    unregister();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }));
    expect(cycle).not.toHaveBeenCalled();
  });

  it('dispatches feed-nav-comment when pressing c in non-typing target', () => {
    const listener = vi.fn();
    window.addEventListener('feed-nav-comment', listener);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('feed-nav-comment', listener);
  });

  it('does not dispatch feed-nav-comment when pressing c in input target', () => {
    const listener = vi.fn();
    window.addEventListener('feed-nav-comment', listener);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('feed-nav-comment', listener);
    document.body.removeChild(input);
  });

  it('collapses active comments when pressing Escape', () => {
    const collapseFn = vi.fn();
    commentTracker.registerOpenComments('feed-1', collapseFn);

    expect(commentTracker.hasActiveComments()).toBe(true);

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(collapseFn).toHaveBeenCalledTimes(1);
    expect(commentTracker.hasActiveComments()).toBe(false);
  });

  it.each(['dialog-wrapper', 'image-viewer-backdrop', 'login-overlay', 'app-context-menu'])(
    '浮层 .%s 打开时 Esc 不再穿透收起背后评论区',
    (className) => {
      const collapseFn = vi.fn();
      commentTracker.registerOpenComments('feed-1', collapseFn);
      const overlay = document.createElement('div');
      overlay.className = className;
      document.body.appendChild(overlay);
      try {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        window.dispatchEvent(event);
        expect(collapseFn).not.toHaveBeenCalled();
        expect(commentTracker.hasActiveComments()).toBe(true);
        expect(event.defaultPrevented).toBe(false);
      } finally {
        overlay.remove();
        commentTracker.resetActiveComments();
      }
    }
  );

  it('连续两次 Esc 不会收起屏幕外先前展开的评论', () => {
    const oldCollapse = vi.fn();
    const currentCollapse = vi.fn();
    commentTracker.registerOpenComments('old-feed', oldCollapse, () => false);
    commentTracker.registerOpenComments('current-feed', currentCollapse, () => true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(currentCollapse).toHaveBeenCalledOnce();
    expect(oldCollapse).not.toHaveBeenCalled();
  });
});
