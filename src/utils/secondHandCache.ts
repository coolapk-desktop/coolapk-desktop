import type { DiscoveryEntity } from '../types/discovery';

/** 二手市场首页缓存在这之后必须后台刷新（5 分钟）。 */
export const SECOND_HAND_CACHE_TTL = 5 * 60 * 1000;
const GUEST_VIEWER_UID = 'guest';

/**
 * 读取当前账号 uid 作为缓存维度。
 * 这里直接读 auth store 同步维护的 localStorage 快照，避免 utils → pinia store 的循环依赖。
 */
export function getSecondHandViewerUid(): string {
  try {
    const parsed = JSON.parse(localStorage.getItem('coolapk_user') || 'null');
    const uid = String(parsed?.uid ?? '').trim();
    return uid && uid !== '0' && uid !== 'undefined' && uid !== 'null' ? uid : GUEST_VIEWER_UID;
  } catch {
    return GUEST_VIEWER_UID;
  }
}

/** 在路由切换或外部页面返回时保留 APK 闲置首页的实体和分页游标。 */
export type SecondHandPageCache = { initialized: boolean; items: DiscoveryEntity[]; page: number; firstItem: string; lastItem: string; pageContext: string; noMore: boolean; updatedAt: number; viewerUid: string };

export const secondHandPageCache: SecondHandPageCache = { initialized: false, items: [], page: 1, firstItem: '', lastItem: '', pageContext: '', noMore: false, updatedAt: 0, viewerUid: '' };

/**
 * 缓存是否仍然可信：未初始化、超时（默认 5 分钟）或账号变化都判定为需要刷新。
 * 命中不可信缓存时页面先渲染旧列表，再后台静默刷新。
 */
export function isSecondHandPageCacheFresh(
  cache: SecondHandPageCache = secondHandPageCache,
  now: number = Date.now(),
  viewerUid: string = getSecondHandViewerUid()
): boolean {
  if (!cache.initialized || !cache.updatedAt) return false;
  if (cache.viewerUid !== viewerUid) return false;
  return now - cache.updatedAt < SECOND_HAND_CACHE_TTL;
}

/** 清空首页缓存并回到第一页（分页游标失效或账号变化时使用）。 */
export function resetSecondHandPageCache() {
  secondHandPageCache.initialized = false;
  secondHandPageCache.items = [];
  secondHandPageCache.page = 1;
  secondHandPageCache.firstItem = '';
  secondHandPageCache.lastItem = '';
  secondHandPageCache.pageContext = '';
  secondHandPageCache.noMore = false;
  secondHandPageCache.updatedAt = 0;
  secondHandPageCache.viewerUid = '';
}

/**
 * 在型号列表与外部闲鱼页面之间切换时保留对应型号的实体、游标和滚动位置。
 * updatedAt / viewerUid 为可选字段，兼容只写实体游标的旧调用方。
 */
export type SecondHandListCache = { initialized: boolean; items: DiscoveryEntity[]; page: number; firstItem: string; lastItem: string; pageContext: string; noMore: boolean; scrollTop: number; updatedAt?: number; viewerUid?: string };

export const secondHandListCache = new Map<string, SecondHandListCache>();
