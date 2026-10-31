import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { describePageTab, getPageTabId, refreshPageTabGeneration } from '../pageTabs';
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
