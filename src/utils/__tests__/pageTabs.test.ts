import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { describePageTab, getKeepAliveMax, getPageComponentKey, getPageInstanceKey, getPageTabId, getSearchPageComponentKey, getSearchPageScopeKey, getSearchScopeFromComponentKey, refreshPageTabGeneration } from '../pageTabs';
import { HOME_TAB_REFRESH_EVENT } from '../homeTab';
import { usePageTabsStore } from '../../stores/pageTabs';

function route(path: string, name: string, params: Record<string, string> = {}, query: Record<string, string> = {}) {
  const queryString = new URLSearchParams(query).toString();
  return { path, name, params, query, fullPath: `${path}${queryString ? `?${queryString}` : ''}` } as unknown as RouteLocationNormalizedLoaded;
}

describe('页面标签身份', () => {
  it('首页刷新保留页面实例，其他页面刷新只重建当前标签', () => {
    const tabs = [{ id: 'home', generation: 0 }, { id: 'Search', generation: 0 }];
    const refresh = vi.fn();
    window.addEventListener(HOME_TAB_REFRESH_EVENT, refresh);
    try {
      refreshPageTabGeneration(tabs, route('/', 'Home'));
      expect(refresh).toHaveBeenCalledOnce();
      expect(tabs.map(tab => tab.generation)).toEqual([0, 0]);
      refreshPageTabGeneration(tabs, route('/search', 'Search'));
      expect(tabs.map(tab => tab.generation)).toEqual([0, 1]);
      expect(refresh).toHaveBeenCalledOnce();
    } finally { window.removeEventListener(HOME_TAB_REFRESH_EVENT, refresh); }
  });
  it.each(['', '/profile', '/account', '/notifications', '/privacy', '/content', '/downloads', '/proxy', '/appearance', '/shortcuts', '/startup', '/device', '/diagnostics', '/about'])('设置子页 %s 共用设置标签', (section) => {
    expect(describePageTab(route(`/settings${section}`, 'Settings'))).toMatchObject({ id: 'settings', title: '设置', icon: 'fas fa-gear', closable: true });
  });

  it('同一详情页的查询变化复用标签，不同实体分开显示', () => {
    const first = route('/topic/摄影', 'Topic', { tag: '摄影' }, { type: 'hot' });
    const sameTopic = route('/topic/摄影', 'Topic', { tag: '摄影' }, { type: 'latest' });
    const otherTopic = route('/topic/数码', 'Topic', { tag: '数码' });

    expect(getPageTabId(first)).toBe(getPageTabId(sameTopic));
    expect(getPageTabId(first)).not.toBe(getPageTabId(otherTopic));
    expect(describePageTab(first)).toMatchObject({ title: '摄影', icon: 'fas fa-hashtag', closable: true });
  });

  it('服务端页面按目标地址区分，并使用路由标题', () => {
    const page = route('/page', 'PageDataList', {}, { url: '/topic/tagList', title: '全部话题' });
    expect(getPageTabId(page)).toBe('page:/topic/tagList');
    expect(describePageTab(page).title).toBe('全部话题');
  });

  it('栏目子页和同栏目下的不同具体页面分别建立标签', () => {
    const followedNodes = route('/my', 'My', {}, { section: 'followed_nodes' });
    const followedTopics = route('/my', 'My', {}, { section: 'followed_topics' });
    const nodeA = route('/node/forum/100', 'Node', { nodeType: 'forum', nodeId: '100' });
    const nodeB = route('/node/forum/200', 'Node', { nodeType: 'forum', nodeId: '200' });

    expect(getPageTabId(followedNodes)).not.toBe(getPageTabId(followedTopics));
    expect(describePageTab(followedNodes).title).toBe('关注的论坛');
    expect(getPageTabId(nodeA)).not.toBe(getPageTabId(nodeB));
  });
});

describe('搜索页实例 key', () => {
  it('页签、排序、问答筛选不改变组件 key，只在同一实例内更新', () => {
    const base = route('/search', 'Search', {}, { q: '小米', tab: 'all' });
    const otherTab = route('/search', 'Search', {}, { q: '小米', tab: 'feed' });
    const sorted = route('/search', 'Search', {}, { q: '小米', tab: 'all', sort: 'hot' });
    const askFiltered = route('/search', 'Search', {}, { q: '小米', tab: 'ask', feedType: 'answer' });

    expect(getSearchPageComponentKey(otherTab, 0)).toBe(getSearchPageComponentKey(base, 0));
    expect(getSearchPageComponentKey(sorted, 0)).toBe(getSearchPageComponentKey(base, 0));
    expect(getSearchPageComponentKey(askFiltered, 0)).toBe(getSearchPageComponentKey(base, 0));
  });

  it('搜索词、搜索范围变化以及 Ctrl+R 刷新都会换 key', () => {
    const base = route('/search', 'Search', {}, { q: '小米', tab: 'all' });
    const otherKeyword = route('/search', 'Search', {}, { q: '红米', tab: 'all' });
    const scoped = route('/search', 'Search', {}, { q: '小米', tab: 'feed', pageType: 'tag', pageParam: '数码' });

    expect(getSearchPageComponentKey(otherKeyword, 0)).not.toBe(getSearchPageComponentKey(base, 0));
    expect(getSearchPageComponentKey(scoped, 0)).not.toBe(getSearchPageComponentKey(base, 0));
    expect(getSearchPageComponentKey(base, 1)).not.toBe(getSearchPageComponentKey(base, 0));
  });

  it('可从组件 key 还原实例范围，非搜索页 key 视为无范围', () => {
    const scoped = route('/search', 'Search', {}, { q: '小米', tab: 'feed', pageType: 'user', pageParam: '123' });
    const key = getSearchPageComponentKey(scoped, 3);
    expect(getSearchScopeFromComponentKey(key)).toBe(getSearchPageScopeKey(scoped));
    expect(getSearchScopeFromComponentKey('/topic/数码:0')).toBe('');
    expect(getSearchScopeFromComponentKey(undefined)).toBe('');
  });

  it('搜索标签按范围区分，关键词与页签变化复用同一标签', () => {
    const global = route('/search', 'Search', {}, { q: '小米', tab: 'all' });
    const globalOtherTab = route('/search', 'Search', {}, { q: '红米', tab: 'user', sort: 'hot' });
    const scoped = route('/search', 'Search', {}, { q: '小米', tab: 'feed', pageType: 'tag', pageParam: '数码' });

    expect(getPageTabId(global)).toBe(getPageTabId(globalOtherTab));
    expect(getPageTabId(global)).not.toBe(getPageTabId(scoped));
  });
});

describe('页面实例 key（keep-alive 槽位）', () => {
  it('同一实体的临时 query 不额外占槽位', () => {
    const base = route('/topic/摄影', 'Topic', { tag: '摄影' });
    const sorted = route('/topic/摄影', 'Topic', { tag: '摄影' }, { type: 'latest' });
    const titled = route('/topic/摄影', 'Topic', { tag: '摄影' }, { title: '摄影圈' });
    const rated = route('/topic/摄影', 'Topic', { tag: '摄影' }, { ratingDetail: '1' });

    expect(getPageComponentKey(sorted, 0)).toBe(getPageComponentKey(base, 0));
    expect(getPageComponentKey(titled, 0)).toBe(getPageComponentKey(base, 0));
    expect(getPageComponentKey(rated, 0)).toBe(getPageComponentKey(base, 0));
    expect(getPageComponentKey(rated, 0)).toBe(getPageInstanceKey(base) + ':0');
  });

  it('结构化 query 与不同实体照旧分开占槽位', () => {
    const likes = route('/my', 'My', {}, { section: 'my_likes' });
    const comments = route('/my', 'My', {}, { section: 'my_comments' });
    const topicA = route('/topic/摄影', 'Topic', { tag: '摄影' });
    const topicB = route('/topic/数码', 'Topic', { tag: '数码' });

    expect(getPageComponentKey(likes, 0)).not.toBe(getPageComponentKey(comments, 0));
    expect(getPageComponentKey(topicA, 0)).not.toBe(getPageComponentKey(topicB, 0));
  });

  it('Ctrl+R 刷新的代数仍改变 key，/topics 与 /search 保持既有实例范围', () => {
    const topic = route('/topic/摄影', 'Topic', { tag: '摄影' });
    expect(getPageComponentKey(topic, 1)).not.toBe(getPageComponentKey(topic, 0));
    expect(getPageComponentKey(route('/topics', 'Topics'), 4)).toBe('/topics:4');
    const search = route('/search', 'Search', {}, { q: '小米', tab: 'all' });
    expect(getPageComponentKey(search, 2)).toBe(getSearchPageComponentKey(search, 2));
  });

  it('产品对比按对比项区分页签：相同 ids/productIds 复用，不同组合分开', () => {
    const compareAB = route('/product-compare', 'ProductCompare', {}, { ids: '1,2', productIds: '9,10' });
    const compareABAgain = route('/product-compare', 'ProductCompare', {}, { ids: '1,2', productIds: '9,10' });
    const compareCD = route('/product-compare', 'ProductCompare', {}, { ids: '3,4', productIds: '11,12' });

    expect(getPageTabId(compareABAgain)).toBe(getPageTabId(compareAB));
    expect(getPageTabId(compareCD)).not.toBe(getPageTabId(compareAB));
    expect(getPageInstanceKey(compareABAgain)).toBe(getPageInstanceKey(compareAB));
    // 标题体现对比项数量，不展示长 id 串。
    // ids 与 productIds 一一对应，标题只显示对比项个数而不是两者之和。
    expect(describePageTab(compareAB).title).toBe('产品对比 · 2 项');
    expect(describePageTab(route('/product-compare', 'ProductCompare', {}, { productIds: '9,10,11' })).title).toBe('产品对比 · 3 项');
    expect(describePageTab(route('/product-compare', 'ProductCompare')).title).toBe('产品对比');
  });

  it('产品对比的 Ctrl+R 刷新代数仍只重建当前实例', () => {
    const compare = route('/product-compare', 'ProductCompare', {}, { ids: '1,2', productIds: '9,10' });
    expect(getPageComponentKey(compare, 1)).toBe(getPageInstanceKey(compare) + ':1');
    expect(getPageComponentKey(compare, 1)).not.toBe(getPageComponentKey(compare, 0));
  });

  it('历史遗留的旧对比页签（无 query 后缀）激活时不与新页签冲突', () => {
    // 旧版本生成的标签 id 是不带 ids/productIds 的 'ProductCompare'；
    // 新身份带结构化后缀，两者互不匹配，旧标签只是继续作为独立标签存在，不会报错。
    const legacy = route('/product-compare', 'ProductCompare');
    const withItems = route('/product-compare', 'ProductCompare', {}, { ids: '1,2' });
    expect(getPageTabId(legacy)).toBe('ProductCompare');
    expect(getPageTabId(withItems)).not.toBe(getPageTabId(legacy));
  });

  it('入口定位、私信预填与选机页数据源等临时 query 复用同一实例', () => {
    const detail = route('/feed/100', 'FeedDetail', { feedId: '100' });
    const replyEntry = route('/feed/100', 'FeedDetail', { feedId: '100' }, { replyId: '5' });
    const commentsEntry = route('/feed/100', 'FeedDetail', { feedId: '100' }, { scrollTo: 'comments' });
    const following = route('/following', 'Following', {}, { category: 'feeds' });
    const followingFans = route('/following', 'Following', {}, { category: 'feeds', tab: 'fans' });
    const messages = route('/messages', 'Messages', {}, { targetUid: '5' });
    const messagesPrefilled = route('/messages', 'Messages', {}, { targetUid: '5', initialText: 'hi' });
    const selector = route('/product-selector', 'ProductSelector', {}, { callFunction: 'indexSearch' });
    const otherSelector = route('/product-selector', 'ProductSelector', {}, { callFunction: 'brandList' });

    // 页面在 setup 后改为响应式跟随地址，因此这些 query 变化不再换 keep-alive 槽位。
    expect(getPageComponentKey(replyEntry, 0)).toBe(getPageComponentKey(detail, 0));
    expect(getPageComponentKey(commentsEntry, 0)).toBe(getPageComponentKey(detail, 0));
    expect(getPageInstanceKey(replyEntry)).toBe(getPageInstanceKey(detail));
    expect(getPageComponentKey(followingFans, 0)).toBe(getPageComponentKey(following, 0));
    expect(getPageComponentKey(messagesPrefilled, 0)).toBe(getPageComponentKey(messages, 0));
    expect(getPageComponentKey(otherSelector, 0)).toBe(getPageComponentKey(selector, 0));
    // 不同动态/不同结构性栏目仍必须是不同实例。
    expect(getPageComponentKey(route('/feed/200', 'FeedDetail', { feedId: '200' }), 0)).not.toBe(getPageComponentKey(detail, 0));
  });

  it('keep-alive 上限跟随已开页签数量', () => {
    expect(getKeepAliveMax(0)).toBe(15);
    expect(getKeepAliveMax(3)).toBe(15);
    expect(getKeepAliveMax(10)).toBe(15);
    expect(getKeepAliveMax(11)).toBe(16);
    expect(getKeepAliveMax(30)).toBe(35);
    expect(getKeepAliveMax(Number.NaN)).toBe(15);
  });
});

describe('页面标签状态', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('切换设置菜单只更新一个标签，返回时打开最近访问的菜单', () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/settings/profile', 'SettingsProfile'));
    store.syncRoute(route('/settings/account', 'SettingsAccount'));
    store.syncRoute(route('/settings/appearance', 'SettingsAppearance'));
    expect(store.tabs.map((tab) => tab.id)).toEqual(['home', 'settings']);
    expect(store.activeTab).toMatchObject({ title: '设置', route: '/settings/appearance' });
    store.syncRoute(route('/notifications', 'Notifications'));
    expect(store.activate('settings')).toBe('/settings/appearance');
    expect(store.close('settings')).toBe('/notifications');
  });

  it('旧版固定和收藏的设置子页合并，并保存最近访问菜单', () => {
    localStorage.setItem('coolapk_page_tabs_v1', JSON.stringify([
      { id: 'settings:profile', route: '/settings/profile', title: '个人资料设置', icon: 'fas fa-gear', pinned: true, favorite: false, order: 1 },
      { id: 'settings:account', route: '/settings/account', title: '账号设置', icon: 'fas fa-gear', pinned: true, favorite: true, order: 2 },
    ]));
    const store = usePageTabsStore();
    expect(store.tabs.map((tab) => tab.id)).toEqual(['home', 'settings']);
    expect(store.favoritePages).toHaveLength(1);
    expect(store.activeId).toBe('home');
    store.syncRoute(route('/settings/about', 'SettingsAbout'));
    expect(store.activeTab).toMatchObject({ id: 'settings', title: '设置', pinned: true, favorite: true, closable: false });

    setActivePinia(createPinia());
    const restored = usePageTabsStore();
    expect(restored.tabs.map((tab) => tab.id)).toEqual(['home', 'settings']);
    expect(restored.activate('settings')).toBe('/settings/about');
    expect(restored.favoritePages).toHaveLength(1);
  });

  it('重复进入同一页面只更新地址，不创建重复标签', () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/topic/摄影', 'Topic', { tag: '摄影' }, { type: 'hot' }));
    store.syncRoute(route('/topic/摄影', 'Topic', { tag: '摄影' }, { type: 'latest' }));

    expect(store.tabs).toHaveLength(2);
    expect(store.activeTab.route).toContain('type=latest');
  });

  it('关闭当前标签后回到最近使用的标签，首页不能关闭', () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/topic/摄影', 'Topic', { tag: '摄影' }));
    store.syncRoute(route('/feed/100', 'FeedDetail', { feedId: '100' }));
    store.activate('Topic:摄影');

    expect(store.close('Topic:摄影')).toBe('/feed/100');
    expect(store.activeId).toBe('FeedDetail:100');
    expect(store.close('home')).toBeNull();
    expect(store.tabs.some((tab) => tab.id === 'home')).toBe(true);
  });

  it('关闭守卫拒绝时标签和当前页都保留，通过后才真正关闭', async () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/settings/network', 'SettingsNetwork'));
    store.syncRoute(route('/feed/100', 'FeedDetail', { feedId: '100' }));
    store.activate('settings');
    const guard = vi.fn().mockResolvedValue(false);
    store.registerTabCloseGuard('settings', guard);

    expect(await store.closeTab('settings')).toBeNull();
    expect(guard).toHaveBeenCalledOnce();
    expect(store.tabs.some((tab) => tab.id === 'settings')).toBe(true);
    expect(store.activeId).toBe('settings');

    guard.mockResolvedValueOnce(true);
    expect(await store.closeTab('settings')).toBe('/feed/100');
    expect(store.tabs.some((tab) => tab.id === 'settings')).toBe(false);
  });

  it('没有守卫时带守卫的关闭入口与直接关闭行为一致', async () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/feed/100', 'FeedDetail', { feedId: '100' }));
    expect(await store.closeTab('home')).toBeNull();
    expect(await store.closeTab('FeedDetail:100')).toBe('/');
    expect(store.tabs.map((tab) => tab.id)).toEqual(['home']);
  });

  it('守卫抛错按拒绝处理，注销后不再询问', async () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/feed/100', 'FeedDetail', { feedId: '100' }));
    const guard = vi.fn().mockRejectedValue(new Error('broken'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      store.registerTabCloseGuard('FeedDetail:100', guard);
      expect(await store.closeTab('FeedDetail:100')).toBeNull();
      expect(store.tabs.some((tab) => tab.id === 'FeedDetail:100')).toBe(true);

      store.unregisterTabCloseGuard('FeedDetail:100');
      expect(await store.closeTab('FeedDetail:100')).toBe('/');
      expect(guard).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });

  it('关闭其他标签时任一个守卫拒绝就不关闭任何标签', async () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/topic/摄影', 'Topic', { tag: '摄影' }));
    store.syncRoute(route('/feed/100', 'FeedDetail', { feedId: '100' }));
    store.registerTabCloseGuard('Topic:摄影', vi.fn().mockResolvedValue(true));
    store.registerTabCloseGuard('FeedDetail:100', vi.fn().mockResolvedValue(false));

    // 目标是首页，两个可见标签都会被关闭；只要有一个拒绝就整体中止。
    expect(await store.closeOtherTabs('home')).toBeNull();
    expect(store.tabs.map((tab) => tab.id)).toEqual(['home', 'Topic:摄影', 'FeedDetail:100']);
  });

  it('关闭右侧标签同样经过守卫', async () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/topic/摄影', 'Topic', { tag: '摄影' }));
    store.syncRoute(route('/feed/100', 'FeedDetail', { feedId: '100' }));
    const guard = vi.fn().mockResolvedValue(false);
    store.registerTabCloseGuard('FeedDetail:100', guard);
    expect(await store.closeRightTabs('Topic:摄影')).toBeNull();
    expect(store.tabs.map((tab) => tab.id)).toEqual(['home', 'Topic:摄影', 'FeedDetail:100']);
  });

  it('关闭其他标签时保留首页和目标标签', () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/topic/摄影', 'Topic', { tag: '摄影' }));
    store.syncRoute(route('/feed/100', 'FeedDetail', { feedId: '100' }));

    expect(store.closeOthers('Topic:摄影')).toBe('/topic/摄影');
    expect(store.tabs.map((tab) => tab.id)).toEqual(['home', 'Topic:摄影']);
  });

  it('按显示顺序双向循环切换标签，包含固定标签并使用拖动后的顺序', () => {
    const store = usePageTabsStore();
    expect(store.cycle(1)).toBeNull();
    store.syncRoute(route('/topic/摄影', 'Topic', { tag: '摄影' }));
    store.syncRoute(route('/feed/100', 'FeedDetail', { feedId: '100' }));
    store.togglePin('Topic:摄影');
    expect(store.cycle(1)).toBe('/');
    expect(store.cycle(-1)).toBe('/feed/100');
    expect(store.cycle(-1)).toBe('/topic/摄影');
    store.move('FeedDetail:100', 'home', false);
    expect(store.cycle(1)).toBe('/feed/100');
    expect(store.activeId).toBe('FeedDetail:100');
  });

  it('拖动标签只调整顺序，不改变当前标签', () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/topic/摄影', 'Topic', { tag: '摄影' }));
    store.syncRoute(route('/feed/100', 'FeedDetail', { feedId: '100' }));

    store.move('FeedDetail:100', 'home', false);

    expect(store.tabs.map((tab) => tab.id)).toEqual(['FeedDetail:100', 'home', 'Topic:摄影']);
    expect(store.activeId).toBe('FeedDetail:100');
  });

  it('收藏页面长期保留，固定页面在新状态实例启动时直接恢复', () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/my', 'My', {}, { section: 'followed_nodes' }));
    expect(store.toggleFavorite('My:section=followed_nodes')).toBe(true);
    expect(store.togglePin('My:section=followed_nodes')).toBe(true);

    setActivePinia(createPinia());
    const restored = usePageTabsStore();
    expect(restored.tabs.map((tab) => tab.id)).toContain('My:section=followed_nodes');
    expect(restored.favoritePages.map((page) => page.id)).toContain('My:section=followed_nodes');
    expect(restored.tabs.find((tab) => tab.id === 'My:section=followed_nodes')).toMatchObject({ pinned: true, closable: false, title: '关注的论坛' });
  });

  it('固定标签拖动后的顺序在重新启动时保持不变', () => {
    const store = usePageTabsStore();
    store.syncRoute(route('/topic/摄影', 'Topic', { tag: '摄影' }));
    store.togglePin('Topic:摄影');
    store.move('Topic:摄影', 'home', false);

    setActivePinia(createPinia());
    expect(usePageTabsStore().tabs.map((tab) => tab.id)).toEqual(['Topic:摄影', 'home']);
  });
});
