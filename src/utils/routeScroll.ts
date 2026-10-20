import { nextTick, ref } from 'vue';

/** 浏览器/原生返回和前进应恢复阅读位置，不重放卡片入口的定位。 */
export const routeNavigationIsHistory = ref(false);

type ScrollPosition = {
  element: HTMLElement;
  top: number;
  left: number;
};

const routeScrollPositions = new Map<string, ScrollPosition[]>();
const SCROLL_CONTAINER_SELECTOR = '[data-route-scroll], .custom-scrollbar';
// 外框虽然禁止用户滚动，scrollIntoView/输入聚焦仍可能改变其滚动偏移。
const SCROLL_FRAME_SELECTOR = '.app-page-content, .route-transition-stage';
let restoreGeneration = 0;
let firstRestoreFrame: number | null = null;
let secondRestoreFrame: number | null = null;

/** 路由切换或新恢复开始时，使已排队的旧页面回调失效。 */
function cancelPendingRestore() {
  ++restoreGeneration;
  if (firstRestoreFrame !== null) { cancelAnimationFrame(firstRestoreFrame); firstRestoreFrame = null; }
  if (secondRestoreFrame !== null) { cancelAnimationFrame(secondRestoreFrame); secondRestoreFrame = null; }
}

/**
 * 收集页面级滚动容器。
 *
 * 不能遍历全部后代节点再读取 getComputedStyle：动态流页面常有数千节点，
 * 高速切路由时这会迫使渲染线程反复进行整页样式计算。
 */
function getScrollContainers(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  const root = document.querySelector<HTMLElement>('.app-main-content');
  if (!root) return [];

  const candidates = [
    root,
    ...Array.from(root.children).filter((element): element is HTMLElement => element instanceof HTMLElement),
    ...Array.from(root.querySelectorAll<HTMLElement>(SCROLL_CONTAINER_SELECTOR)),
  ];

  // 记录外框的零位置；否则进入评论后被程序带动的外框在返回时无法归零。
  const frames = new Set<HTMLElement>([
    root,
    ...Array.from(root.children).filter((element): element is HTMLElement => element instanceof HTMLElement),
    ...Array.from(root.querySelectorAll<HTMLElement>(SCROLL_FRAME_SELECTOR)),
  ]);

  return [...new Set([...candidates, ...frames])].filter((element) => (
    frames.has(element) || element.scrollHeight > element.clientHeight
    || element.scrollWidth > element.clientWidth
    || element.scrollTop !== 0
    || element.scrollLeft !== 0
  ));
}

/** 在路由离开前保存页面内各滚动容器的位置。 */
export function saveRouteScrollPosition(routeKey: string): void {
  // 评论入口有独立定位并跳过通用恢复，也要在离开旧页面时取消其待执行回调。
  cancelPendingRestore();
  if (!routeKey) return;
  const positions = getScrollContainers().map((element) => ({
    element,
    top: element.scrollTop,
    left: element.scrollLeft,
  }));
  routeScrollPositions.set(routeKey, positions);
}

/** 在缓存页面重新显示后恢复全部滚动位置。 */
export async function restoreRouteScrollPosition(routeKey: string): Promise<void> {
  // 新页面没有缓存位置也必须取消上一轮恢复，避免旧回调影响新页面。
  cancelPendingRestore();
  const generation = restoreGeneration;
  const positions = routeScrollPositions.get(routeKey);
  if (!positions) return;

  await nextTick();
  if (generation !== restoreGeneration) return;

  const restore = () => {
    if (generation !== restoreGeneration) return;
    positions.forEach(({ element, top, left }) => {
      // keep-alive 会暂时移出非活动页面；仅在节点重新挂载后恢复。
      if (!element.isConnected) return;
      element.scrollTop = top;
      element.scrollLeft = left;
    });
  };

  // 缓存节点接回后立即恢复，避免首帧先显示列表顶部；后两帧只补偿布局调整。
  restore();
  firstRestoreFrame = requestAnimationFrame(() => {
    firstRestoreFrame = null;
    restore();
    secondRestoreFrame = requestAnimationFrame(() => {
      secondRestoreFrame = null;
      restore();
    });
  });
}
