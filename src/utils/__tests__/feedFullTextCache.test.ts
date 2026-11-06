import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFeedDetail: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getFeedDetail: mocks.getFeedDetail,
  },
}));

import {
  clearFeedFullTextCache,
  getCachedFeedFullText,
  getFeedFullTextRequestStats,
  invalidateFeedFullText,
  loadFeedFullText,
} from '../feedFullTextCache';

describe('动态全文请求缓存', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFeedFullTextCache();
  });

  it('同一条动态共享请求并复用已完成结果', async () => {
    mocks.getFeedDetail.mockResolvedValue({ data: { message: '完整正文' } });

    const first = loadFeedFullText('100');
    const second = loadFeedFullText('100');
    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual(['完整正文', '完整正文']);
    await expect(loadFeedFullText('100')).resolves.toBe('完整正文');
    expect(mocks.getFeedDetail).toHaveBeenCalledTimes(1);
  });

  it('并发全文请求最多同时发出三个', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mocks.getFeedDetail.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );

    const requests = Array.from({ length: 5 }, (_, index) => loadFeedFullText(index + 1));
    expect(mocks.getFeedDetail).toHaveBeenCalledTimes(3);
    expect(getFeedFullTextRequestStats()).toEqual({ active: 3, queued: 2 });

    resolvers[0]({ data: { message: '正文 1' } });
    await vi.waitFor(() => expect(mocks.getFeedDetail).toHaveBeenCalledTimes(4));

    for (let index = 1; index < 5; index += 1) {
      await vi.waitFor(() => expect(resolvers[index]).toBeTypeOf('function'));
      resolvers[index]({ data: { message: `正文 ${index + 1}` } });
    }
    await expect(Promise.all(requests)).resolves.toEqual([
      '正文 1',
      '正文 2',
      '正文 3',
      '正文 4',
      '正文 5',
    ]);
  });

  it('编辑或删除动态后失效缓存，再次展开重新请求详情', async () => {
    mocks.getFeedDetail.mockResolvedValue({ data: { message: '旧正文' } });
    await expect(loadFeedFullText('200')).resolves.toBe('旧正文');
    expect(getCachedFeedFullText('200')).toBe('旧正文');

    // 对应 updateFeed / deleteFeed 成功后的写后失效。
    invalidateFeedFullText('200');
    expect(getCachedFeedFullText('200')).toBe('');

    mocks.getFeedDetail.mockResolvedValue({ data: { message: '新正文' } });
    await expect(loadFeedFullText('200')).resolves.toBe('新正文');
    expect(getCachedFeedFullText('200')).toBe('新正文');
    expect(mocks.getFeedDetail).toHaveBeenCalledTimes(2);
  });

  it('失效发生在请求途中时，旧响应不写回缓存', async () => {
    let resolveDetail: (value: unknown) => void = () => {};
    mocks.getFeedDetail.mockImplementation(
      () => new Promise((resolve) => { resolveDetail = resolve; })
    );

    const pending = loadFeedFullText('300');
    invalidateFeedFullText('300');
    resolveDetail({ data: { message: '过期的旧正文' } });

    await expect(pending).resolves.toBe('过期的旧正文');
    expect(getCachedFeedFullText('300')).toBe('');
  });

  it('空动态编号不会触发失效逻辑', async () => {
    mocks.getFeedDetail.mockResolvedValue({ data: { message: '正文' } });
    await loadFeedFullText('400');
    invalidateFeedFullText('');
    invalidateFeedFullText(null);
    expect(getCachedFeedFullText('400')).toBe('正文');
  });
});
