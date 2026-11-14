/**
 * src/utils/selection.ts
 *
 * 全局文本选区辅助工具：
 * 解决因为全局 user-select: none 导致点击空白区域时浏览器不自动取消选中的问题。
 */

export function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  return selection.toString().trim().length > 0;
}

/**
 * 桌面 WebKit 在鼠标按下到抬起之间只要抖动 1–2px 就会真的建出一小段选区，
 * 于是 `hasActiveTextSelection()` 把整次点击误判成「正在选字」，点击被吞掉
 * （正文点击进不了详情、评论点击设不了回复对象）。只有超过阈值的位移才算选字拖动。
 */
export const TEXT_SELECTION_DRAG_TOLERANCE = 4;

/** 按下位置。`null` 表示这次按下不参与点击判定（右键/中键/未记录）。 */
export type SelectionDragStart = { x: number; y: number } | null;

/** 指针按下时记录起点；只有主键参与，右键/中键返回 null。 */
export function recordSelectionPointerStart(event: PointerEvent): SelectionDragStart {
  return !event.button ? { x: event.clientX, y: event.clientY } : null;
}

/**
 * 返回 true 表示这次点击来自真正的选字拖动，应当放弃点击。
 * 没有按下记录（键盘或脚本触发的点击）时沿用原有「有选区就不点击」的保守语义。
 */
export function isSelectionDragClick(
  e: MouseEvent,
  start: SelectionDragStart,
  tolerance = TEXT_SELECTION_DRAG_TOLERANCE,
): boolean {
  if (!start) return true;
  return Math.hypot(e.clientX - start.x, e.clientY - start.y) > tolerance;
}

/**
 * 点击前统一判定：true = 应放弃这次点击。
 * 抖动产生的零星选区不是用户的复制意图，顺手清掉后照常点击，避免界面留着半截高亮。
 */
export function shouldSkipClickForSelection(
  e: MouseEvent,
  start: SelectionDragStart,
  tolerance = TEXT_SELECTION_DRAG_TOLERANCE,
): boolean {
  if (!hasActiveTextSelection()) return false;
  if (isSelectionDragClick(e, start, tolerance)) return true;
  window.getSelection()?.removeAllRanges();
  return false;
}

export function isPointInsideSelection(selection: Selection, x: number, y: number): boolean {
  if (selection.rangeCount === 0) return false;
  try {
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      // 允许 2px 的边缘容差
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function handleSelectionClearOnPointerDown(e: MouseEvent): void {
  // 仅在鼠标左键按下时处理
  if (e.button !== 0) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

  const target = e.target as HTMLElement | null;
  if (!target) return;

  // 输入框、文本域或富文本编辑区保持原生选区和光标处理
  if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }

  // 点击在右键菜单内部时不清除选区
  if (target.closest?.('.app-context-menu')) {
    return;
  }

  // 点击在已有文字选区外时，主动清除选区
  if (!isPointInsideSelection(selection, e.clientX, e.clientY)) {
    selection.removeAllRanges();
  }
}

export function registerGlobalSelectionClear(): () => void {
  const handler = (e: MouseEvent) => handleSelectionClearOnPointerDown(e);
  // 使用捕获阶段确保即使子元素 stopPropagation 也能在点击空白时清除选区
  window.addEventListener('pointerdown', handler, true);
  return () => {
    window.removeEventListener('pointerdown', handler, true);
  };
}
