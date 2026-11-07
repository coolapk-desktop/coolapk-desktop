/**
 * 好物清单/好物榜的行状态注册表。
 *
 * 榜单页（GoodsRankingList）与详情页（GoodsListDetailBody）各自持有一份
 * goodsListInfo 副本，评论数/投票数/收藏数互不可见，切页回来就是旧值。
 * 这里用模块级 reactive Map 按「好物清单 id」存最新的行级统计，
 * 谁拿到更新谁写入（setGoodsRowState / applyGoodsRows），
 * 榜单渲染时优先读注册表，无覆盖再回落到行对象本身。
 * 刻意不做全局收藏 store 重构：只共享这几个易陈旧的数字字段。
 */
import { reactive } from 'vue';

export interface GoodsRowState {
  /** 详情页发表评论后本地累加的回复数。 */
  replynum?: number;
  /** 投票数（goodsListInfo.vote_num）。 */
  voteNum?: number;
  /** 关注数（goodsListInfo.follow_num）。 */
  followNum?: number;
  /** 收录好物数（goodsListInfo.item_num）。 */
  itemNum?: number;
  /** 收藏计数（feed.favnum）。 */
  favnum?: number;
  /** 收藏态（userAction.collect）。 */
  favorited?: boolean;
  /** 写入时间，用于调试与未来按需过期。 */
  updatedAt: number;
}

/** 行对象 → 清单 id 的取法，与 GoodsRankingList.listKey 保持一致。 */
export function goodsRowId(row: any): string {
  return String(row?.id ?? row?.entityId ?? '');
}

const rows = reactive(new Map<string, GoodsRowState>());

/** 读某行的最新状态；无记录返回 undefined，调用方回落到行对象。 */
export function getGoodsRowState(id: string): GoodsRowState | undefined {
  const key = String(id ?? '');
  return key ? rows.get(key) : undefined;
}

/** 合并写入一行状态；id 为空或补丁为空时安全跳过。 */
export function setGoodsRowState(id: string, patch: Omit<GoodsRowState, 'updatedAt'> & { updatedAt?: number }): void {
  const key = String(id ?? '');
  if (!key || !patch || typeof patch !== 'object') return;
  const prev = rows.get(key);
  const next: GoodsRowState = { ...(prev || {}), ...patch, updatedAt: Date.now() };
  // 显式数字字段做下限保护，负值对计数无意义。
  for (const field of ['replynum', 'voteNum', 'followNum', 'itemNum', 'favnum'] as const) {
    const v = next[field];
    if (v !== undefined && Number.isFinite(Number(v))) next[field] = Math.max(0, Number(v));
    else delete next[field];
  }
  rows.set(key, next);
}

/**
 * 把一行 goodsListInfo/feed 数据灌入注册表：有值才覆盖，避免把接口
 * 偶尔缺省的字段当成 0 清掉已有状态。用于榜单加载和详情页回写两个入口。
 */
export function applyGoodsRows(list: any[]): void {
  if (!Array.isArray(list)) return;
  for (const row of list) {
    const id = goodsRowId(row);
    if (!id) continue;
    const info = row?.goodsListInfo || row || {};
    const patch: Partial<GoodsRowState> = {};
    if (info.reply_num !== undefined || row?.replynum !== undefined) patch.replynum = Number(row?.replynum ?? info.reply_num);
    if (info.vote_num !== undefined) patch.voteNum = Number(info.vote_num);
    if (info.follow_num !== undefined) patch.followNum = Number(info.follow_num);
    if (info.item_num !== undefined) patch.itemNum = Number(info.item_num);
    if (row?.favnum !== undefined) patch.favnum = Number(row.favnum);
    if (row?.userAction && typeof row.userAction === 'object') {
      const collect = row.userAction.collect ?? row.userAction.favorite;
      if (collect !== undefined) patch.favorited = Number(collect) === 1;
    }
    if (Object.keys(patch).length > 0) setGoodsRowState(id, patch);
  }
}

/** 主要供测试与极端重置场景使用。 */
export function clearGoodsRows(): void {
  rows.clear();
}
