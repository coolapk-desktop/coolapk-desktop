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

  it('联想命令使用固定短超时且不重试', async () => {
    mocks.getSearchSuggestionsApp.mockResolvedValue({ data: [] });
    await fetchSearchSuggestions('miui');
    expect(mocks.getSearchSuggestionsApp).toHaveBeenCalledWith('miui', { retry: false, timeoutMs: 4000 });
  });

  it('App 变体为空时直接用本地兜底，不再串行追发第二个接口', async () => {
    mocks.getSearchSuggestionsApp.mockResolvedValue({ data: [] });
    const rows = await fetchSearchSuggestions('miui');
    expect(rows).toEqual([{ entityType: 'searchWord', title: 'miui' }]);
    expect(mocks.getSearchSuggestions).not.toHaveBeenCalled();
  });

  it('App 变体失败时也用本地兜底', async () => {
    mocks.getSearchSuggestionsApp.mockRejectedValue(new Error('boom'));
    await expect(fetchSearchSuggestions('miui')).resolves.toEqual([{ entityType: 'searchWord', title: 'miui' }]);
    expect(mocks.getSearchSuggestions).not.toHaveBeenCalled();
  });

  it('同一关键词的在途请求合并为一次', async () => {
    let resolveRequest!: (value: unknown) => void;
    mocks.getSearchSuggestionsApp.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const first = fetchSearchSuggestions('miui');
    const second = fetchSearchSuggestions('  miui  ');
    expect(mocks.getSearchSuggestionsApp).toHaveBeenCalledTimes(1);
    resolveRequest({ data: [{ entityType: 'topic', title: 'MIUI' }] });
    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
    expect(mocks.getSearchSuggestionsApp).toHaveBeenCalledTimes(1);
  });

  it('空关键词不发请求', async () => {
    await expect(fetchSearchSuggestions('   ')).resolves.toEqual([]);
    expect(mocks.getSearchSuggestionsApp).not.toHaveBeenCalled();
  });
});
