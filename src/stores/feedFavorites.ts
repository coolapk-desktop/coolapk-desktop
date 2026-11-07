/**
 * 全局收藏态注册表（跨 feed 副本共享）。
 *
 * 收藏页与首页/榜单各自持有一份不同的 feed 实体副本，收藏动作只会回写
 * 「传入的那个对象」，另一份副本的初始收藏态/计数无法同步（与 goodsRows
 * 解决的好物清单问题同构）。这里用模块级 reactive Map 按 feed id 存最新的
 * { favorited, favnum, updatedAt }，作为「跨副本覆盖层」。
 *
 * 真源约定（谁写谁读）：
 * - 实体字段（feed.userAction.collect/favorite、feed.favnum）仍是既有真源：
 *   接口返回、详情页等场景直接读实体，不受本注册表影响。
 * - 注册表只由收藏动作的成功回写路径写入（utils/feedFavorite.ts 的
 *   syncFavoriteToFeed 是唯一写入口），任何宿主（列表/详情/收藏页）的收藏
 *   动作都会经它广播到全部副本。
 * - UI（如 FeedCard）读取时：注册表有值则以注册表为准（并保持
 *   cloudFavorite 语义最高优先），无值回落实体字段。
 * - 刻意不做全局收藏 store 重构：只共享这两个易陈旧的字段。
 */
import { reactive } from 'vue';

export interface FeedFavoriteRegistryState {
  favorited?: boolean;
  /** 收藏计数（feed.favnum）。 */
  favnum?: number;
  /** 写入时间，用于调试与未来按需过期。 */
  updatedAt: number;
}

/** feed 实体 → id 的取法；实体缺 id 时返回空串，调用方跳过。 */
export function feedFavoriteId(feed: any): string {
  const id = feed?.id ?? feed?.entityId;
  return id === undefined || id === null ? '' : String(id);
}

const states = reactive(new Map<string, FeedFavoriteRegistryState>());

/** 读某条 feed 的最新收藏态；无记录返回 undefined，调用方回落实体。 */
export function getFeedFavoriteState(id: string | number | undefined | null): FeedFavoriteRegistryState | undefined {
  const key = id === undefined || id === null ? '' : String(id);
  return key ? states.get(key) : undefined;
}

/**
 * 合并写入一条收藏态；id 为空或补丁为空时安全跳过。
 * 计数做下限钳 0：本地递减不应出现负数。
 */
export function setFeedFavoriteState(
  id: string | number | undefined | null,
  patch: Omit<FeedFavoriteRegistryState, 'updatedAt'> & { updatedAt?: number },
): void {
  const key = id === undefined || id === null ? '' : String(id);
  if (!key || !patch || typeof patch !== 'object') return;
  const prev = states.get(key);
  const next: FeedFavoriteRegistryState = { ...(prev || {}), ...patch, updatedAt: Date.now() };
  if (next.favnum !== undefined) {
    const count = Number(next.favnum);
    // 非法值直接丢弃，不覆盖已有合法状态。
    if (Number.isFinite(count)) next.favnum = Math.max(0, count);
    else delete next.favnum;
  }
  if (next.favorited !== undefined) next.favorited = Boolean(next.favorited);
  if (next.favorited === undefined && next.favnum === undefined) return;
  states.set(key, next);
}

/**
 * 把 feed 实体（或列表）灌入注册表：只在字段有值时覆盖，避免把接口偶尔
 * 缺省的 favnum/userAction 当成「未收藏/0」清掉已有状态。
 */
export function applyFeedFavorites(input: any | any[]): void {
  const list = Array.isArray(input) ? input : [input];
  for (const feed of list) {
    if (!feed || typeof feed !== 'object') continue;
    const id = feedFavoriteId(feed);
    if (!id) continue;
    const patch: Partial<FeedFavoriteRegistryState> = {};
    if (feed.favnum !== undefined && feed.favnum !== null) patch.favnum = Number(feed.favnum);
    if (feed.userAction && typeof feed.userAction === 'object') {
      const collect = feed.userAction.collect ?? feed.userAction.favorite;
      if (collect !== undefined && collect !== null) patch.favorited = Number(collect) === 1;
    }
    if (Object.keys(patch).length > 0) setFeedFavoriteState(id, patch);
  }
}

/** 主要供测试与极端重置场景使用。 */
export function clearFeedFavorites(): void {
  states.clear();
}
