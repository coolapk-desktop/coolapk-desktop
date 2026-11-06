/**
 * 收藏态回写公共逻辑。
 *
 * 列表与详情拿到的是同一份 feed 实体（父级直接把数组里的对象当 prop 传下来），
 * 因此收藏/取消收藏成功后必须改实体字段，而不是只改组件内部的 isFav/favnum，
 * 否则同一条动态在列表、详情、收藏单里会各自显示不同状态。
 */
export interface FeedFavoriteState {
  favorited: boolean;
  /** 传入时同步 favnum；不传则保留实体原计数（用于只关心收藏态的场景）。 */
  favnum?: number | string | null;
}

/** 把收藏态写回 feed 实体；feed 为空或非对象时安全跳过。 */
export function syncFavoriteToFeed(feed: any, state: FeedFavoriteState): void {
  if (!feed || typeof feed !== 'object') return;

  const flag = state.favorited ? 1 : 0;
  const userAction = feed.userAction && typeof feed.userAction === 'object'
    ? { ...feed.userAction }
    : {};
  userAction.collect = flag;
  // 部分实体（提问回答等）用 favorite 表达同一语义；只在字段本来就存在时同步，
  // 避免给实体塞上接口没返回的多余字段。
  if ('favorite' in userAction) userAction.favorite = flag;
  feed.userAction = userAction;

  if (state.favnum === undefined || state.favnum === null) return;
  const count = Number(state.favnum);
  if (!Number.isFinite(count)) return;
  feed.favnum = Math.max(0, count);
}
