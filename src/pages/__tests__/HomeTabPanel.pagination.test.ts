import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { expect, it, vi } from 'vitest';
import HomeTabPanel from '../HomeTabPanel.vue';

const api = vi.hoisted(() => ({
  getIndexV8EntitiesPaged: vi.fn(),
  getDiscoveryPageData: vi.fn(),
  getBoardFeeds: vi.fn(),
  getHotSearchKeywords: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));

const feed = (id: string) => ({ id, entityId: id, entityType: 'feed', message: `动态 ${id}`, uid: '123', username: '酷友' });
/** 无任何可渲染内容的实体：会被展示侧过滤掉，但服务端原始条数里仍然存在。 */
const hidden = (id: string) => ({ id, entityType: 'feed' });

function mountPanel(tabs: any[], stubs: Record<string, any>) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  return router.push('/').then(() => mount(HomeTabPanel, {
    props: { embedded: true, selected: true, tabKey: tabs[0].url || tabs[0].page_name, tabs },
    global: { plugins: [router, createPinia()], stubs: { AppImage: true, ...stubs } },
  }));
}

it('非头条栏目过滤后只剩 1 条但服务端还有下一页时，不显示「没有更多内容了」且能继续加载', async () => {
  const tab = { title: '科技圈', url: '/feed/tagBoard' };
  api.getBoardFeeds.mockReset();
  api.getBoardFeeds.mockResolvedValueOnce({ data: [feed('a1'), hidden('h1'), hidden('h2')] })
    .mockResolvedValueOnce({ data: [feed('b1'), feed('b2')] });
  const wrapper = await mountPanel([tab], {
    FeedCard: { props: ['feed'], template: '<article class="feed-card">{{ feed.id }}</article>' },
  });
  try {
    await flushPromises();
    // 旧逻辑 validItems.length(1) < 3 会误判 noMore；正确行为是继续加载。
    expect(wrapper.find('.feed-no-more').exists()).toBe(false);
    await wrapper.get('.feed-scroll-container').trigger('scroll');
    await flushPromises();
    expect(api.getBoardFeeds.mock.calls.filter((call: any[]) => call[1] === 2).length).toBeGreaterThanOrEqual(1);
    expect(wrapper.findAll('.feed-card').map(card => card.text())).toEqual(['a1', 'b1', 'b2']);
    expect(wrapper.find('.feed-no-more').exists()).toBe(false);
  } finally { wrapper.unmount(); vi.restoreAllMocks(); }
});

it('头条页末为被隐藏动态时，加载更多的游标取服务端原始末条而不是过滤后末条', async () => {
  const tab = { title: '头条', page_name: 'V9_HOME_TAB_HEADLINE', url: '/main/headline' };
  api.getIndexV8EntitiesPaged.mockReset();
  api.getIndexV8EntitiesPaged.mockResolvedValueOnce({ data: [feed('100'), hidden('h1')] })
    .mockResolvedValueOnce({ data: [feed('90'), hidden('h2')] });
  const wrapper = await mountPanel([tab], {
    FeedCard: { props: ['feed'], template: '<article class="feed-card">{{ feed.id }}</article>' },
  });
  try {
    await flushPromises();
    await wrapper.get('.feed-scroll-container').trigger('scroll');
    await flushPromises();
    // 旧逻辑用过滤断（只剩 100）会把 lastItem 传成 '100'，下一页从被隐藏动态之前重取。
    expect(api.getIndexV8EntitiesPaged).toHaveBeenLastCalledWith({ page: 2, firstItem: '', lastItem: 'h1' });
    expect(wrapper.findAll('.feed-card').map(card => card.text())).toEqual(['100', '90']);
    await wrapper.get('.feed-scroll-container').trigger('scroll');
    await flushPromises();
    expect(api.getIndexV8EntitiesPaged).toHaveBeenLastCalledWith({ page: 3, firstItem: '', lastItem: 'h2' });
  } finally { wrapper.unmount(); vi.restoreAllMocks(); }
});

it('页面实体栏目翻页时按稳定键去重，同一实体只出现一次', async () => {
  const tab = { title: '新机', url: '/page?url=V11_HOME_NEW' };
  api.getDiscoveryPageData.mockReset();
  api.getDiscoveryPageData.mockResolvedValueOnce({ data: [{ entityId: 'e1', entityTemplate: 'textCard', title: '实体A' }], hasMore: true })
    .mockResolvedValue({ data: [{ entityId: 'e1', entityTemplate: 'textCard', title: '实体A' }, { entityId: 'e2', entityTemplate: 'textCard', title: '实体B' }], hasMore: true });
  const wrapper = await mountPanel([tab], {
    DiscoveryEntityCard: { props: ['entity'], template: '<div class="entity-stub">{{ entity.entityId }}</div>' },
  });
  try {
    await flushPromises();
    expect(wrapper.findAll('.entity-stub').map(node => node.text())).toEqual(['e1']);
    await wrapper.get('.feed-scroll-container').trigger('scroll');
    await flushPromises();
    expect(wrapper.findAll('.entity-stub').map(node => node.text())).toEqual(['e1', 'e2']);
  } finally { wrapper.unmount(); vi.restoreAllMocks(); }
});
