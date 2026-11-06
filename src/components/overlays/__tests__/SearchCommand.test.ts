import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchByType: vi.fn(),
  // 旧的独立搜索接口：面板不应再调用它，避免与搜索页结果集不一致。
  searchAll: vi.fn(),
  getSearchSuggestionsApp: vi.fn(),
  getSearchSuggestions: vi.fn(),
  getHotSearches: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));

import SearchCommand from '../SearchCommand.vue';
import { useAppStore } from '../../../stores/app';

async function mountPalette() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/search', component: { render: () => null } }, { path: '/topic/:tag', component: { render: () => null } }] });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(SearchCommand, { global: { plugins: [pinia, router], stubs: { teleport: true } } });
  useAppStore(pinia).openSearch();
  await flushPromises();
  return { wrapper, router, pinia };
}

function typeQuery(wrapper: any, value: string) {
  return wrapper.get('.search-input').setValue(value);
}

describe('Ctrl+K 搜索面板', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getHotSearches.mockResolvedValue({ data: { data: ['热门词'] } });
    mocks.getSearchSuggestionsApp.mockResolvedValue({ data: [] });
    mocks.getSearchSuggestions.mockResolvedValue({ data: [] });
    mocks.searchByType.mockResolvedValue({ data: [] });
  });

  it('联想与即时结果合并展示时标注类型并去掉重复项', async () => {
    mocks.searchByType.mockResolvedValue({ data: [{ entityType: 'topic', title: 'MIUI', url: '/topic/MIUI' }] });
    mocks.getSearchSuggestionsApp.mockResolvedValue({ data: [
      { entityType: 'searchWord', title: 'miui' },
      { entityType: 'topic', title: 'MIUI' },
      { entityType: 'user', title: '阿杰' },
    ] });
    const { wrapper } = await mountPalette();
    try {
      await typeQuery(wrapper, 'miui');
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();
      const suggestions = wrapper.findAll('.suggestion-item');
      expect(suggestions.map((item) => item.get('.suggestion-text').text())).toEqual(['miui', '阿杰']);
      expect(suggestions[0].find('.suggestion-kind').exists()).toBe(false);
      expect(suggestions[1].get('.suggestion-kind').text()).toBe('用户');
      expect(wrapper.find('.suggestion-group-title').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });

  it('输入后立即进入加载态，不在防抖窗口内先闪“未找到相关结果”', async () => {
    const { wrapper } = await mountPalette();
    try {
      await typeQuery(wrapper, 'miui');
      await flushPromises();
      expect(wrapper.find('.loading-wrapper').exists()).toBe(true);
      expect(wrapper.find('.empty-wrapper').exists()).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();
      expect(wrapper.find('.loading-wrapper').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('关闭面板后不再发出残留的即时搜索请求', async () => {
    const { wrapper, pinia } = await mountPalette();
    try {
      await typeQuery(wrapper, 'miui');
      await flushPromises();
      useAppStore(pinia).closeSearch();
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 400));
      await flushPromises();
      expect(mocks.searchByType).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('结果区失败展示“搜索失败 + 重试”，联想区失败不影响结果区', async () => {
    mocks.searchByType.mockRejectedValue(new Error('network boom'));
    const { wrapper } = await mountPalette();
    try {
      await typeQuery(wrapper, 'miui');
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();
      expect(wrapper.get('.empty-wrapper').text()).toContain('搜索失败');
      expect(wrapper.find('.retry-button').exists()).toBe(true);

      // 重试成功后回到结果列表，错误态消失。
      mocks.searchByType.mockResolvedValue({ data: [{ entityType: 'feed', id: '1', message: 'MIUI 帖子' }] });
      await wrapper.get('.retry-button').trigger('click');
      await flushPromises();
      expect(wrapper.find('.empty-wrapper').exists()).toBe(false);
      expect(wrapper.findAll('.result-item')).toHaveLength(1);

      // 联想接口失败只降级联想，结果区保持正常。
      mocks.searchByType.mockResolvedValue({ data: [{ entityType: 'feed', id: '2', message: 'MIUI 帖子二' }] });
      mocks.getSearchSuggestionsApp.mockRejectedValue(new Error('suggest boom'));
      await typeQuery(wrapper, 'miui2');
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();
      expect(wrapper.findAll('.result-item')).toHaveLength(1);
      expect(wrapper.find('.empty-wrapper').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('Ctrl+K 与搜索页共用 searchByType(all) 接口，去重键含类型避免跨类型撞车', async () => {
    mocks.searchByType.mockResolvedValue({ data: [
      { entityType: 'feed', id: '1', message: '同一 ID 的动态' },
      { entityType: 'feedTopic', id: '1', title: 'MIUI', url: '/topic/MIUI' },
      // 同类型同 ID 才算重复，重复项被丢弃。
      { entityType: 'feed', id: '1', message: '同一 ID 的动态（重复）' },
    ] });
    const { wrapper } = await mountPalette();
    try {
      await typeQuery(wrapper, 'miui');
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();

      // 与 SearchPage 的“综合”页签请求参数一致，保证面板与落地页结果集相同。
      expect(mocks.searchByType).toHaveBeenCalledWith({ searchType: 'all', query: 'miui', page: 1 });
      expect(mocks.searchAll).not.toHaveBeenCalled();
      // 动态与话题共用一个 ID：都保留；重复的动态被去掉。
      expect(wrapper.findAll('.result-item')).toHaveLength(2);
    } finally { wrapper.unmount(); }
  });

  it('点击热门词直接发起搜索，而不是只填充输入框', async () => {
    const { wrapper, router } = await mountPalette();
    try {
      const tag = wrapper.findAll('.suggest-tag')[0];
      await tag.trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.path).toBe('/search');
      expect(router.currentRoute.value.query.q).toBe('热门词');
    } finally { wrapper.unmount(); }
  });
});
