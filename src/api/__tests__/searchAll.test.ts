import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { CoolapkTauriAPI } from '../coolapk';

// 清单选帖/选商品走的是「全站搜索」：/v6/search?type=all 返回动态、用户、商品等混合实体，
// 页面再在本地按 entityType 过滤。它与搜索页按 APK searchType 请求的 searchByType 不是同一个接口，
// 这里锁定该行为，避免被误改成 searchByType 而丢掉混合实体结果。
describe('全站搜索 searchAll', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({ code: 200, data: [] });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  });

  it('走原生 search_all 命令并按页返回混合实体', async () => {
    await CoolapkTauriAPI.searchAll('小米 13', 2);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('search_all', { query: '小米 13', page: 2 });
  });

  it('与按 searchType 请求的 searchByType 使用不同命令', async () => {
    await CoolapkTauriAPI.searchAll('小米', 1);
    await CoolapkTauriAPI.searchByType({ searchType: 'all', query: '小米', page: 1 });
    expect(invoke).toHaveBeenNthCalledWith(1, 'search_all', { query: '小米', page: 1 });
    expect(vi.mocked(invoke).mock.calls[1]![0]).toBe('search_by_type');
  });

  it('未传页码时默认请求第一页', async () => {
    await CoolapkTauriAPI.searchAll('耳机');
    expect(invoke).toHaveBeenCalledWith('search_all', { query: '耳机', page: 1 });
  });
});
