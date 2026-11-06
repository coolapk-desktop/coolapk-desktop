import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSearchSuggestionsApp: vi.fn(),
  getSearchSuggestions: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));

import { fetchSearchSuggestions } from '../searchSuggestions';

describe('共用搜索联想', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('优先使用官方 App 变体，并过滤赞助与无标题条目', async () => {
    mocks.getSearchSuggestionsApp.mockResolvedValue({ data: [
      { entityType: 'topic', title: 'MIUI' },
      { entityType: 'sponsorCard', title: '广告' },
      { entityType: 'user' },
    ] });
    await expect(fetchSearchSuggestions('miui')).resolves.toHaveLength(1);
    expect(mocks.getSearchSuggestions).not.toHaveBeenCalled();
  });

  it('App 变体为空或失败时回退通用联想', async () => {
    mocks.getSearchSuggestionsApp.mockResolvedValue({ data: [] });
    mocks.getSearchSuggestions.mockResolvedValue({ data: [{ entityType: 'searchWord', title: 'miui14' }] });
    await expect(fetchSearchSuggestions('miui')).resolves.toHaveLength(1);

    mocks.getSearchSuggestionsApp.mockRejectedValue(new Error('boom'));
    await expect(fetchSearchSuggestions('miui')).resolves.toHaveLength(1);
  });

  it('空关键词不发请求', async () => {
    await expect(fetchSearchSuggestions('   ')).resolves.toEqual([]);
    expect(mocks.getSearchSuggestionsApp).not.toHaveBeenCalled();
  });
});
