import { nextTick, ref } from 'vue';
import type { RouteLocationNormalized } from 'vue-router';
import { getPageComponentKey, type TabRoute } from './pageTabs';
import { usePageTabsStore } from '../stores/pageTabs';

/** 浏览器/原生返回和前进应恢复阅读位置，不重放卡片入口的定位。 */
export const routeNavigationIsHistory = ref(false);

type ScrollPosition = {
  top: number;
  left: number;
};

type RouteScrollRecord = {
  /** 容器槽位 → 位置；槽位是相对 .app-main-content 的元素路径。 */
  slots: Map<string, ScrollPosition>;
  at: number;
};

// 位置按「页面实例 key + 容器槽位」保存：KeepAlive 淘汰或页面重建后仍能找回原来的容器，
// 也不会像 WeakMap 那样随旧节点一起回收；用 TTL 与数量上限避免记录无限增长。
const routeScrollRecords = new Map<string, RouteScrollRecord>();
// 页面缓存上限随页签增长（至少 15、页签数 + 5），位置记录留出更多余量。
const MAX_ROUTE_RECORDS = 80;
const POSITION_TTL_MS = 30 * 60 * 1000;
const SCROLL_CONTAINER_SELECTOR = '[data-route-scroll], .custom-scrollbar';
// 外框虽然禁止用户滚动，scrollIntoView/输入聚焦仍可能改变其滚动偏移。
const SCROLL_FRAME_SELECTOR = '.app-page-content, .route-transition-stage';
const LEAVING_ROUTE_SELECTOR = '.feed-detail-forward-leave-active, .feed-detail-back-leave-active, .feed-detail-desktop-leave-active';
const CONTENT_ROOT_CLASS = 'app-main-content';
const CONTENT_ROOT_SELECTOR = `.${CONTENT_ROOT_CLASS}`;
const ROOT_SLOT = '#root';
let restoreGeneration = 0;
let firstRestoreFrame: number | null = null;
let secondRestoreFrame: number | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 滚动位置与 App.vue 的 keep-alive 组件 key 使用同一个「页面实例身份」：
 * 同一实体（含结构化查询）共用一份位置，实例被淘汰重建后仍能恢复。
 */
export function getRouteScrollKey(route: TabRoute): string {
  let generation = 0;
  try {
    generation = usePageTabsStore().getGeneration(route as RouteLocationNormalized);
  } catch {
    // 路由可能在 Pinia 就绪前完成首次导航，此时按初始代数记录即可。
    generation = 0;
  }
  return getPageComponentKey(route, generation);
}

/** 路由切换或新恢复开始时，使已排队的旧页面回调失效。 */
function cancelPendingRestore() {
  ++restoreGeneration;
  if (firstRestoreFrame !== null) { cancelAnimationFrame(firstRestoreFrame); firstRestoreFrame = null; }
  if (secondRestoreFrame !== null) { cancelAnimationFrame(secondRestoreFrame); secondRestoreFrame = null; }
  if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
}

/**
 * 收集页面级滚动容器。
 *
 * 不能遍历全部后代节点再读取 getComputedStyle：动态流页面常有数千节点，
 * 高速切路由时这会迫使渲染线程反复进行整页样式计算。
 */
function getScrollContainers(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  const root = document.querySelector<HTMLElement>(CONTENT_ROOT_SELECTOR);
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

  // 记录声明的容器（含零位置）即可；保存位置时查询 scrollHeight/clientHeight
  // 会在 popstate 的同步导航处理中强制完成整页布局。
  return [...new Set([...candidates, ...frames])];
}

/** 转场时旧页面仍可能留在舞台内，保存和恢复时都按当前页面计算下标。 */
function slotChildren(parent: Element): HTMLCollection | Element[] {
  if (!parent.classList.contains('route-transition-stage')) return parent.children;
  return Array.from(parent.children).filter(child => !child.matches(LEAVING_ROUTE_SELECTOR));
}

/**
 * 用元素路径代替节点身份：同一路由的页面重建后 DOM 结构一致，就能把位置写回对应容器。
 * 只取标签名与元素下标，避免动态 class 变化导致槽位漂移。
 */
function containerSlot(element: HTMLElement): string {
  if (element.classList.contains(CONTENT_ROOT_CLASS)) return ROOT_SLOT;
  const parts: string[] = [];
  let node: HTMLElement | null = element;
  while (node && !node.classList.contains(CONTENT_ROOT_CLASS)) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) return '';
    const index = Array.prototype.indexOf.call(slotChildren(parent), node);
    if (index < 0) return '';
    parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
    node = parent;
  }
  return node ? parts.join('>') : '';
}

/** 按槽位找回当前 DOM 中的容器；结构不符时返回 null，交给重试判定。 */
function findSlotElement(slot: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const root = document.querySelector<HTMLElement>(CONTENT_ROOT_SELECTOR);
  if (!root) return null;
  if (slot === ROOT_SLOT) return root;
  let node: Element = root;
  for (const part of slot.split('>')) {
    const match = /^([a-z0-9-]+)\[(\d+)\]$/.exec(part);
    if (!match) return null;
    const child = slotChildren(node)[Number(match[2])];
    if (!child || child.tagName.toLowerCase() !== match[1]) return null;
    node = child;
  }
  return node instanceof HTMLElement ? node : null;
}

/** 过期与超量的记录在下一次保存时清理，避免长会话里无限增长。 */
function pruneRecords(now: number) {
  for (const [key, record] of routeScrollRecords) {
    if (now - record.at > POSITION_TTL_MS) routeScrollRecords.delete(key);
  }
  while (routeScrollRecords.size > MAX_ROUTE_RECORDS) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, record] of routeScrollRecords) {
      if (record.at < oldestAt) { oldestAt = record.at; oldestKey = key; }
    }
    if (oldestKey === null) break;
    routeScrollRecords.delete(oldestKey);
  }
}

/** 在路由离开前保存页面内各滚动容器的位置。 */
export function saveRouteScrollPosition(routeKey: string): void {
  // 评论入口有独立定位并跳过通用恢复，也要在离开旧页面时取消其待执行回调。
  cancelPendingRestore();
  if (!routeKey) return;
  const now = Date.now();
  let record = routeScrollRecords.get(routeKey);
  if (!record) {
    record = { slots: new Map(), at: now };
    routeScrollRecords.set(routeKey, record);
  }
  record.at = now;
  for (const element of getScrollContainers()) {
    const slot = containerSlot(element);
    if (!slot) continue;
    record.slots.set(slot, { top: element.scrollTop, left: element.scrollLeft });
  }
  pruneRecords(now);
}

/** 在缓存页面重新显示后恢复全部滚动位置。 */
export async function restoreRouteScrollPosition(routeKey: string): Promise<void> {
  // 新页面没有缓存位置也必须取消上一轮恢复，避免旧回调影响新页面。
  cancelPendingRestore();
  const generation = restoreGeneration;
  await nextTick();
  if (generation !== restoreGeneration) return;

  const record = routeKey ? routeScrollRecords.get(routeKey) : undefined;
  if (!record || !record.slots.size) return;
  record.at = Date.now();
  const entries = [...record.slots];
  let retried = false;

  // 返回写入位置；内容还没撑开（异步分页未到）时返回 true，交给一次重试。
  const restore = (): boolean => {
    if (generation !== restoreGeneration) return false;
    let insufficient = false;
    for (const [slot, { top, left }] of entries) {
      const element = findSlotElement(slot);
      if (!element || !element.isConnected) { insufficient = true; continue; }
      element.scrollTop = top;
      element.scrollLeft = left;
      // 内容高度不足时浏览器会把 scrollTop 截断到上限。
      if (top > 0 && Math.abs(element.scrollTop - top) > 1) insufficient = true;
    }
    return insufficient;
  };

  // 恢复到位的容器立即生效，避免首帧先显示列表顶部；后两帧只补偿布局调整。
  const needsRetry = restore();
  firstRestoreFrame = requestAnimationFrame(() => {
    firstRestoreFrame = null;
    if (generation !== restoreGeneration) return;
    secondRestoreFrame = requestAnimationFrame(() => {
      secondRestoreFrame = null;
      if (generation !== restoreGeneration) return;
      const stillInsufficient = restore() || needsRetry;
      if (!stillInsufficient || retried) return;
      retried = true;
      // 页面实例刚被淘汰重建时，已加载分页要等异步数据回填才会撑开内容，只补一次。
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (generation === restoreGeneration) restore();
      }, 120);
    });
  });
}
