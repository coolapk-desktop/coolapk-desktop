import type { RouteLocationNormalizedLoaded, RouteLocationNormalized } from 'vue-router';
import { isFeedReportUrl } from './feedReport';
import { HOME_TAB_REFRESH_EVENT } from './homeTab';

export type TabRoute = Pick<RouteLocationNormalizedLoaded, 'fullPath' | 'name' | 'path' | 'params' | 'query'> | Pick<RouteLocationNormalized, 'fullPath' | 'name' | 'path' | 'params' | 'query'>;

export interface PageTabDescriptor {
  id: string;
  route: string;
  title: string;
  icon: string;
  closable: boolean;
}

function decodeRouteText(value: unknown): string {
  const text = Array.isArray(value) ? String(value[0] || '') : String(value || '');
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function firstParam(route: TabRoute): string {
  return Object.values(route.params).map(decodeRouteText).find(Boolean) || '';
}

function allParams(route: TabRoute): string {
  return Object.values(route.params).map(decodeRouteText).filter(Boolean).join(':');
}

function shorten(text: string, maxLength = 28): string {
  const normalized = text.trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

const structuralQueryKeys: Partial<Record<string, string[]>> = {
  My: ['section'],
  Following: ['category'],
  Goods: ['tab'],
  User: ['tab', 'ratingTarget'],
  Product: ['tab'],
  Favorites: ['collectionId'],
  Messages: ['targetUid'],
  // 产品对比按对比项区分页签与 keep-alive 实例：不同入口的对比组合各自占一个标签，
  // 互不覆盖；ids/productIds 参与身份但不直接展示在标题里（标题只显示项数）。
  ProductCompare: ['ids', 'productIds'],
  // 搜索标签按搜索范围区分（全局搜索 / 话题内搜索 / 用户动态搜索），
  // 关键词、页签和排序变化继续复用同一个搜索标签。
  Search: ['pageType', 'pageParam'],
};

function structuralQuerySuffix(route: TabRoute): string {
  const keys = structuralQueryKeys[String(route.name || '')] || [];
  const values = keys.map((key) => [key, decodeRouteText(route.query[key])] as const).filter(([, value]) => Boolean(value));
  return values.length ? `:${values.map(([key, value]) => `${key}=${value}`).join('&')}` : '';
}

/**
 * 搜索页组件实例的范围 key：只由搜索词和搜索范围决定。
 * 页签、排序、问答筛选属于同一实例内部状态，切换时不能重建整页（否则页签缓存与滚动位置全部失效）。
 */
export function getSearchPageScopeKey(route: TabRoute): string {
  const keyword = decodeRouteText(route.query.q).trim();
  const pageType = decodeRouteText(route.query.pageType);
  const pageParam = decodeRouteText(route.query.pageParam);
  return `/search:${keyword}|${pageType}|${pageParam}`;
}

/** 搜索页组件 key：`/search:<刷新代数>:<关键词>|<范围>`，代数放在固定位置便于还原实例范围。 */
export function getSearchPageComponentKey(route: TabRoute, generation: number): string {
  const scope = getSearchPageScopeKey(route).replace(/^\/search:/, '');
  return `/search:${generation}:${scope}`;
}

/**
 * 页面实例身份：同一实体（含结构性查询）只占一个 keep-alive 槽位。
 * 排序、筛选、页签、定位、入口定位（replyId/scrollTo）、对比项、私信预填文本等临时 query
 * 全部由页面自身响应式跟随地址更新，不再按 query 区分实例。
 * 结构性查询（见 structuralQueryKeys）仍按页面语义区分，例如我的栏目、搜索范围。
 */
export function getPageInstanceKey(route: TabRoute): string {
  return getPageTabId(route);
}

/**
 * keep-alive 组件 key：`<页面实例身份>:<刷新代数>`。
 * /topics 仍保持单实例常驻；/search 仍按「搜索词 + 范围」复用实例；
 * 代数只由 Ctrl+R 刷新与关标签递增，因此刷新语义不变。
 */
export function getPageComponentKey(route: TabRoute, generation: number): string {
  // 话题聚合页保持单实例常驻，内部子话题切换不触发父页面销毁重建与闪烁。
  if (route.path === '/topics') return `/topics:${generation}`;
  if (route.path === '/search') return getSearchPageComponentKey(route, generation);
  // 设置页共用一个页签，但不同子页面分别保留滚动位置。
  if (isSettingsPagePath(route.path)) return `${route.path}:${generation}`;
  return `${getPageInstanceKey(route)}:${generation}`;
}

/** keep-alive 槽位上限：至少 15 个，并随已开页签数量增长，长浏览不会把仍在使用的列表挤出缓存。 */
export function getKeepAliveMax(tabCount: number): number {
  const count = Number.isFinite(tabCount) ? Math.max(0, Math.floor(tabCount)) : 0;
  return Math.max(15, count + 5);
}

/** 从搜索页组件 key 还原实例所属的搜索范围（去掉 Ctrl+R 刷新的代数）；非搜索页 key 返回空串。 */
export function getSearchScopeFromComponentKey(key: unknown): string {
  const text = typeof key === 'string' ? key : '';
  const match = /^\/search:\d+:(.*)$/.exec(text);
  return match ? `/search:${match[1]}` : '';
}

const mySectionTitles: Record<string, string> = {
  my_likes: '我的赞', my_comments: '我的评论', my_feeds: '我的动态', followed_nodes: '关注的论坛', followed_topics: '关注的话题', followed_collections: '关注的收藏单', followed_questions: '关注的问题', followed_products: '关注的数码吧', recent_contacts: '最近联系人', recycle_bin: '内容回收站', hidden_replies: '隐藏的回复', my_devices: '我的设备', my_albums: '我的专辑', my_votes: '我的投票', my_recent: '我的常去',
};

/** 设置中心的子菜单共用一个标签，保留地址以便返回最近访问的菜单。 */
export function isSettingsPagePath(path: string): boolean {
  return path === '/settings' || path.startsWith('/settings/');
}

/**
 * 为路由生成稳定的标签页身份。同一详情实体只保留一个标签；筛选、分页等查询变化更新原标签地址。
 */
export function getPageTabId(route: TabRoute): string {
  if (route.path === '/') return 'home';
  if (isSettingsPagePath(route.path)) return 'settings';
  if (route.path === '/page') return `page:${decodeRouteText(route.query.url) || route.fullPath}`;
  if (route.path === '/external') return `external:${decodeRouteText(route.query.url) || 'current'}`;
  const params = allParams(route);
  if (params) return `${String(route.name || route.path)}:${params}${structuralQuerySuffix(route)}`;
  return `${String(route.name || route.path)}${structuralQuerySuffix(route)}`;
}

/** 递增当前路由标签的视图代数，让页面内容重新挂载并保留应用外壳。 */
export function refreshPageTabGeneration(tabs: Array<{ id: string; generation: number }>, route: TabRoute): void {
  // 首页刷新当前栏目，保留栏目选择、子筛选和其他已访问列表的实例。
  if (route.path === '/') { window.dispatchEvent(new Event(HOME_TAB_REFRESH_EVENT)); return; }
  const tab = tabs.find((item) => item.id === getPageTabId(route));
  if (tab) tab.generation += 1;
}

/** 根据已有路由信息生成无需等待接口的标签标题和图标。 */
export function describePageTab(route: TabRoute): PageTabDescriptor {
  const param = firstParam(route);
  const queryTitle = decodeRouteText(route.query.title);
  const name = String(route.name || '');
  const staticPages: Record<string, [string, string]> = {
    UserPlugins: ['挂件管理', 'fas fa-shirt'],
    UserPluginStore: ['挂件商店', 'fas fa-store'],
    Home: ['首页', 'fas fa-house'], Discover: ['发现', 'fas fa-compass'], Apps: ['应用', 'fas fa-mobile-screen-button'], Games: ['游戏', 'fas fa-gamepad'], Downloads: ['下载', 'fas fa-download'], Topics: ['话题', 'fas fa-hashtag'], Favorites: ['收藏', 'far fa-bookmark'], MyLikes: ['我的赞', 'far fa-thumbs-up'], More: ['更多', 'fas fa-ellipsis'], My: ['我的', 'fas fa-user'], History: ['浏览历史', 'far fa-clock'], Following: ['关注', 'fas fa-user-group'], Reviews: ['点评', 'fas fa-star'], SecondHand: ['闲置', 'fas fa-recycle'], Events: ['活动', 'fas fa-calendar-days'], AnyList: ['酷安清单', 'fas fa-list'], MyDyh: ['我的看看号', 'fas fa-rss'], Center: ['创作中心', 'fas fa-pen'], Goods: ['好物', 'fas fa-bag-shopping'], Digital: ['数码', 'fas fa-laptop'], MyProducts: ['我的产品', 'fas fa-mobile-screen'], ProductCompare: ['产品对比', 'fas fa-code-compare'], Search: ['搜索', 'fas fa-magnifying-glass'], Notifications: ['通知', 'far fa-bell'], Messages: ['私信', 'far fa-comment-dots'], BlackList: ['黑名单', 'fas fa-ban'], Albums: ['专辑', 'fas fa-images'], Pictures: ['图片', 'far fa-image'], Headline: ['头条', 'far fa-newspaper'], LiveDetail: ['直播', 'fas fa-video'], ProductSelector: ['选择产品', 'fas fa-mobile-screen-button'], AnyListCreate: ['新建清单', 'fas fa-plus'], SecondHandBrands: ['闲置品牌', 'fas fa-tags'], SecondHandList: ['闲置列表', 'fas fa-recycle'], AuthCallback: ['登录', 'fas fa-right-to-bracket'], External: ['网页', 'fas fa-globe'],
  };
  let title = staticPages[name]?.[0] || queryTitle || '页面';
  if (name === 'External' && isFeedReportUrl(route.query.url)) title = String(route.query.url).includes('type=reply') ? '举报回复' : '举报动态';
  let icon = staticPages[name]?.[1] || 'far fa-file-lines';

  if (name === 'Downloads') [title, icon] = ['下载管理', 'fas fa-download'];
  else if (name === 'Topic') [title, icon] = [param.trim().startsWith('#') && param.trim().endsWith('#') ? param.trim().slice(1, -1).trim() || '话题' : param.trim() || '话题', 'fas fa-hashtag'];
  else if (name === 'FeedDetail') [title, icon] = [`动态 ${param}`, 'far fa-comment-alt'];
  else if (name === 'QuestionDetail') [title, icon] = [`问题 ${param}`, 'far fa-circle-question'];
  else if (name === 'User') [title, icon] = [param === 'me' ? '个人主页' : `用户 ${param}`, 'far fa-user'];
  else if (name === 'UserRelations') [title, icon] = ['用户关系', 'fas fa-user-group'];
  else if (name === 'AppDetail') [title, icon] = [param || '应用详情', 'fas fa-cube'];
  else if (name === 'Product') [title, icon] = [`产品 ${param}`, 'fas fa-mobile-screen-button'];
  else if (name === 'Dyh') [title, icon] = [`看看号 ${param}`, 'fas fa-rss'];
  else if (name === 'AlbumDetail') [title, icon] = [`专辑 ${param}`, 'fas fa-images'];
  else if (name === 'PageDataList') [title, icon] = [queryTitle || '页面', 'fas fa-list-ul'];
  else if (name === 'EventDetail') [title, icon] = [`活动 ${param}`, 'fas fa-calendar-day'];
  else if (name === 'Node') [title, icon] = ['讨论区', 'fas fa-comments'];
  else if (name === 'AnyListDetail') [title, icon] = [`清单 ${param}`, 'fas fa-list'];
  else if (name === 'GoodsListDetail' || name === 'GoodsRankingDetail') [title, icon] = ['好物详情', 'fas fa-bag-shopping'];
  // 产品对比标题只体现对比项数量，不展示长 id 串；无参数时保持通用标题。
  else if (name === 'ProductCompare') {
    // ids 是产品配置 id、productIds 是对应的产品 id，两者一一对应，数量不能相加；
    // 只按对比项个数展示，取有值的那个列表长度。
    const listOf = (key: string) => decodeRouteText(route.query[key]).split(',').map((id) => id.trim()).filter(Boolean);
    const count = listOf('ids').length || listOf('productIds').length;
    if (count) title = `产品对比 · ${count} 项`;
  }
  else if (isSettingsPagePath(route.path)) [title, icon] = ['设置', 'fas fa-gear'];

  const section = decodeRouteText(route.query.section);
  const category = decodeRouteText(route.query.category);
  const tab = decodeRouteText(route.query.tab);
  if (name === 'My' && section && mySectionTitles[section]) title = mySectionTitles[section];
  else if (name === 'Following' && category) title = category === 'users' ? '关注的用户' : category === 'topics' ? '关注的话题' : '关注的动态';
  else if (name === 'Goods' && tab) title = ({ search: '好物搜索', mine: '我的好物', lists: '好物清单', ranking: '好物榜' } as Record<string, string>)[tab] || title;
  else if (name === 'User' && tab) title = `${title} · ${({ home: '主页', feed: '动态', like: '赞过', reply: '回复', rating: '点评', album: '图集', developer_apps: '开发者应用', apk_follow: '关注的应用', discovery: '发现', goods_store: '商品店铺' } as Record<string, string>)[tab] || tab}`;
  else if (name === 'Product' && tab) title = `${title} · ${({ feed: '讨论', answer: '问答', article: '图文', video: '视频', trade: '交易', config: '参数', media: '媒体', rating: '评分' } as Record<string, string>)[tab] || tab}`;
  else if (name === 'Favorites' && decodeRouteText(route.query.collectionId)) title = '收藏单';
  else if (name === 'Messages' && decodeRouteText(route.query.targetUid)) title = '私信会话';

  return { id: getPageTabId(route), route: route.fullPath, title: shorten(title), icon, closable: route.path !== '/' };
}
