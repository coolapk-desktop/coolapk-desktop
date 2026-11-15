import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isPointInsideSelection,
  handleSelectionClearOnPointerDown,
  registerGlobalSelectionClear,
  hasActiveTextSelection,
  recordSelectionPointerStart,
  isSelectionDragClick,
  shouldSkipClickForSelection,
  TEXT_SELECTION_DRAG_TOLERANCE,
} from '../selection';

describe('selection utils', () => {
  let removeAllRangesMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    removeAllRangesMock = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return false for isPointInsideSelection when point is outside selection rects', () => {
    const mockSelection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({
        getClientRects: () => [
          { left: 100, top: 100, right: 200, bottom: 120 },
        ],
      }),
      removeAllRanges: removeAllRangesMock,
    } as unknown as Selection;

    expect(isPointInsideSelection(mockSelection, 50, 50)).toBe(false);
    expect(isPointInsideSelection(mockSelection, 150, 110)).toBe(true);
  });

  it('should clear selection when pointer down outside selection', () => {
    const mockSelection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({
        getClientRects: () => [
          { left: 100, top: 100, right: 200, bottom: 120 },
        ],
      }),
      removeAllRanges: removeAllRangesMock,
    } as unknown as Selection;

    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

    const div = document.createElement('div');
    const event = new MouseEvent('pointerdown', {
      button: 0,
      clientX: 300,
      clientY: 300,
    });
    Object.defineProperty(event, 'target', { value: div });

    handleSelectionClearOnPointerDown(event);
    expect(removeAllRangesMock).toHaveBeenCalledTimes(1);
  });

  it('should not clear selection when clicking inside selection rects', () => {
    const mockSelection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({
        getClientRects: () => [
          { left: 100, top: 100, right: 200, bottom: 120 },
        ],
      }),
      removeAllRanges: removeAllRangesMock,
    } as unknown as Selection;

    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

    const div = document.createElement('div');
    const event = new MouseEvent('pointerdown', {
      button: 0,
      clientX: 150,
      clientY: 110,
    });
    Object.defineProperty(event, 'target', { value: div });

    handleSelectionClearOnPointerDown(event);
    expect(removeAllRangesMock).not.toHaveBeenCalled();
  });

  it('should not clear selection on non-left-click', () => {
    const mockSelection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({
        getClientRects: () => [
          { left: 100, top: 100, right: 200, bottom: 120 },
        ],
      }),
      removeAllRanges: removeAllRangesMock,
    } as unknown as Selection;

    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

    const div = document.createElement('div');
    const event = new MouseEvent('pointerdown', {
      button: 2, // 右键
      clientX: 300,
      clientY: 300,
    });
    Object.defineProperty(event, 'target', { value: div });

    handleSelectionClearOnPointerDown(event);
    expect(removeAllRangesMock).not.toHaveBeenCalled();
  });

  it('should not clear selection when target is an INPUT element', () => {
    const mockSelection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({
        getClientRects: () => [
          { left: 100, top: 100, right: 200, bottom: 120 },
        ],
      }),
      removeAllRanges: removeAllRangesMock,
    } as unknown as Selection;

    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

    const input = document.createElement('input');
    const event = new MouseEvent('pointerdown', {
      button: 0,
      clientX: 300,
      clientY: 300,
    });
    Object.defineProperty(event, 'target', { value: input });

    handleSelectionClearOnPointerDown(event);
    expect(removeAllRangesMock).not.toHaveBeenCalled();
  });

  it('should register and unregister pointerdown event listener', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const unregister = registerGlobalSelectionClear();
    expect(addEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);

    unregister();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
  });

  it('should correctly detect active text selection with hasActiveTextSelection', () => {
    // 无选区
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
    expect(hasActiveTextSelection()).toBe(false);

    // 空折叠选区
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: true,
      toString: () => '',
    } as unknown as Selection);
    expect(hasActiveTextSelection()).toBe(false);

    // 有选中文本
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      toString: () => '选中的文字内容',
    } as unknown as Selection);
    expect(hasActiveTextSelection()).toBe(true);
  });

  describe('选字拖动与零星选区的区分', () => {
    const stubSelection = () => {
      const removeAllRanges = vi.fn();
      const spy = vi.spyOn(window, 'getSelection').mockReturnValue({
        isCollapsed: false,
        rangeCount: 1,
        toString: () => '正文',
        removeAllRanges,
        containsNode: () => false,
      } as unknown as Selection);
      return { removeAllRanges, restore: () => spy.mockRestore() };
    };
    // jsdom 没有 PointerEvent：用同名 MouseEvent 转型即可，被测逻辑只读 button/clientX/clientY。
    const pointerDown = (x: number, y: number, button = 0) => new MouseEvent('pointerdown', { button, clientX: x, clientY: y }) as unknown as PointerEvent;
    const click = (x: number, y: number) => new MouseEvent('click', { button: 0, clientX: x, clientY: y });

    it('只记录主键按下的起点', () => {
      expect(recordSelectionPointerStart(pointerDown(10, 20))).toEqual({ x: 10, y: 20 });
      expect(recordSelectionPointerStart(pointerDown(10, 20, 2))).toBeNull();
    });

    it('位移在阈值内不算选字拖动，超过阈值才算', () => {
      const start = { x: 100, y: 100 };
      expect(isSelectionDragClick(click(100 + TEXT_SELECTION_DRAG_TOLERANCE, 100), start)).toBe(false);
      expect(isSelectionDragClick(click(100 + TEXT_SELECTION_DRAG_TOLERANCE + 1, 100), start)).toBe(true);
      // 没有按下记录时保守判定为拖动（键盘/脚本触发的点击）。
      expect(isSelectionDragClick(click(100, 100), null)).toBe(true);
    });

    it('没有选区时不介入点击', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true, rangeCount: 1, toString: () => '' } as unknown as Selection);
      expect(shouldSkipClickForSelection(click(100, 100), { x: 100, y: 100 })).toBe(false);
    });

    it('抖动产生的零星选区清掉后继续点击，真正的拖动才放弃点击', () => {
      const selection = stubSelection();
      try {
        expect(shouldSkipClickForSelection(click(101, 102), { x: 100, y: 100 })).toBe(false);
        expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
        expect(shouldSkipClickForSelection(click(160, 118), { x: 100, y: 100 })).toBe(true);
        // 真正的拖动保留选区，不做清除。
        expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
      } finally {
        selection.restore();
      }
    });
  });
});
