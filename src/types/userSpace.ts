export type UserSpaceTabKey =
  | 'home'
  | 'feed'
  | 'reply'
  | 'rating'
  | 'article'
  | 'qa'
  | 'coolpic'
  | 'ershou'
  | 'goods'
  | 'goods_store'
  | 'goods_rank'
  | 'collection'
  | 'album'
  | 'developer_apps'
  | 'apk_follow'
  | 'discovery'
  | 'blacklist'
  | 'recycle';

export interface UserSpaceEntity {
  id?: string | number;
  entityId?: string | number;
  entityType?: string;
  entityTemplate?: string;
  entityTypeName?: string;
  title?: string;
  subTitle?: string;
  description?: string;
  message?: string;
  url?: string;
  pic?: string;
  logo?: string;
  uid?: string | number;
  username?: string;
  userAvatar?: string;
  dateline?: number | string;
  entities?: UserSpaceEntity[];
  [key: string]: unknown;
}

export interface UserSpaceProfile extends UserSpaceEntity {
  uid: string | number;
  username?: string;
  displayUserName?: string;
  userInfo?: Record<string, unknown>;
  signature?: string;
  cover?: string;
  level?: number | string;
  gender?: number | string;
  city?: string;
  province?: string;
  ipLocation?: string;
  zodiacSign?: string;
  loginTime?: number | string;
  isFollow?: number | boolean;
  isSpecialFollow?: number | boolean;
  isFans?: number | boolean;
  isInBlackList?: number | boolean;
  isBlackingLoginUser?: number | boolean;
  isInIgnoreList?: number | boolean;
  isDeveloper?: number | boolean;
  beLikeNum?: number;
  followNum?: number;
  fansNum?: number;
  feedNum?: number;
  replyNum?: number;
  homeTabCardRows?: UserSpaceEntity[];
  selectedTab?: string;
  topIds?: Array<string | number>;
  avatarPluginUrl?: string;
  avatar_plugin_url?: string;
  verifyTitle?: string;
  verify_title?: string;
  goodsCount?: number;
  productOwnerCount?: number;
  product_owner_count?: number;
}

export interface UserSpaceTab {
  key: UserSpaceTabKey;
  label: string;
  serverTab?: string;
  requiresSelf?: boolean;
}

export interface PaginationCursor {
  page: number;
  firstItem: string;
  lastItem: string;
  hasMore: boolean;
}

export interface EntityPage {
  items: UserSpaceEntity[];
  page: number;
  hasMore: boolean;
  firstItem: string;
  lastItem: string;
}

export type UserSpacePage = EntityPage;
export type Entity = UserSpaceEntity;

/** 粉丝接口的 fUserInfo 是当前账号的占位信息，不能作为粉丝简介的回退来源。 */
export function relationUserBio(user: any, relation: 'fans' | 'follow'): string {
  const info = relation === 'fans' ? user?.userInfo : (user?.fUserInfo || user?.userInfo);
  const topLevel = user?.bio || user?.signature || (relation === 'follow' ? user?.sign : '');
  return String(topLevel || info?.bio || info?.signature || info?.sign || '').trim();
}

export function asUserSpaceProfile(value: unknown, uid: string): UserSpaceProfile {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const userInfo = source.userInfo && typeof source.userInfo === 'object'
    ? source.userInfo as Record<string, unknown>
    : {};
  return {
    ...userInfo,
    ...source,
    uid: source.uid ?? userInfo.uid ?? uid,
    username: String(source.username ?? source.displayUserName ?? userInfo.username ?? '酷友'),
    signature: String(source.signature ?? source.bio ?? ''),
    cover: String(source.cover ?? ''),
    homeTabCardRows: Array.isArray(source.homeTabCardRows) ? source.homeTabCardRows as UserSpaceEntity[] : [],
  } as UserSpaceProfile;
}

export function extractUserSpaceItems(value: unknown): UserSpaceEntity[] {
  if (!Array.isArray(value)) return [];
  const result: UserSpaceEntity[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as UserSpaceEntity;
    if (Array.isArray(record.entities)) result.push(...record.entities);
    else if (Array.isArray((record as any).items)) result.push(...(record as any).items);
    else if (Array.isArray((record as any).list)) result.push(...(record as any).list);
    else result.push(record);
  }
  return result;
}

export function normalizeEntityPage(value: unknown, page = 1): EntityPage {
  const response = (value && typeof value === 'object' ? value : {}) as any;
  const payload = response.data ?? response;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entities) ? payload.entities
      : Array.isArray(payload?.items) ? payload.items
        : Array.isArray(payload?.list) ? payload.list : [];
  const items = extractUserSpaceItems(rows);
  const context = response.pageContext || response.context || payload?.pageContext || payload?.context || {};
  const firstItem = String(response.firstItem ?? payload?.firstItem ?? context.firstItem ?? (items[0] ? entityKey(items[0], 0) : ''));
  const lastItem = String(response.lastItem ?? payload?.lastItem ?? context.lastItem ?? (items.length ? entityKey(items[items.length - 1], items.length - 1) : ''));
  const explicitHasMore = response.hasMore ?? payload?.hasMore ?? context.hasMore ?? response.hasNext ?? payload?.hasNext;
  return {
    items,
    page: Math.max(page, Number(response.page ?? payload?.page ?? page)),
    hasMore: typeof explicitHasMore === 'boolean' ? explicitHasMore : items.length >= 10,
    firstItem,
    lastItem,
  };
}

/** 合并分页结果：加载更多时剔除已存在条目，并且一页全是重复条目不继续补页。 */
export function mergeEntityPageItems(existing: UserSpaceEntity[], page: EntityPage, options: { refresh?: boolean } = {}): { items: UserSpaceEntity[]; hasMore: boolean } {
  if (options.refresh) return { items: page.items, hasMore: page.hasMore };
  const keys = new Set(existing.map((item, index) => entityKey(item, index)));
  const incoming = page.items.filter((item, index) => !keys.has(entityKey(item, index)));
  return {
    items: [...existing, ...incoming],
    // 服务端仍报有下一页但本页无新增时停止补页，否则停在底部会反复请求同一分页。
    hasMore: page.hasMore && incoming.length > 0,
  };
}

export function entityKey(entity: UserSpaceEntity, index: number): string {
  return String(entity.entityId ?? entity.id ?? entity.url ?? `${entity.entityType ?? 'entity'}-${index}`);
}

export function entityImage(entity: UserSpaceEntity): string {
  const value = entity.pic ?? entity.logo ?? entity.userAvatar ?? entity.cover;
  return typeof value === 'string' ? value : '';
}

export function entityText(entity: UserSpaceEntity): string {
  return String(entity.message ?? entity.description ?? entity.subTitle ?? '');
}

export function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}
