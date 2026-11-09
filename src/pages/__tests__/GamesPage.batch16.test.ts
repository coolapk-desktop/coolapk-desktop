import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  getGameList: vi.fn(),
  searchGames: vi.fn(),
  searchFeeds: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }));
vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getGameList: mocks.getGameList,
    searchGames: mocks.searchGames,
    searchFeeds: mocks.searchFeeds,
  },
}));
vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../../utils/sanitizeHtml', () => ({ coolapkHtmlToPlainText: (s: string) => s }));

import GamesPage from '../GamesPage.vue';

function mountPage() {
  return mount(GamesPage, {
    global: {
      stubs: { AppButton: true, AppImage: true, LoadingState: true, EmptyState: true },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GamesPage 批次16：失败可见 / 竞态 / 分页 / 导航兜底', () => {
  it('断网时显示错误态与重试，不得显示「暂无相关游戏或评测」；点重试只发一次请求', async () => {
    mocks.getGameList.mockRejectedValueOnce(new Error('网络请求失败'));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('.error-state').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('暂无相关游戏或评测');
    const retryBtn = wrapper.find('.error-state .retry-btn');
    expect(retryBtn.exists()).toBe(true);

    const calls = mocks.getGameList.mock.calls.length;
    mocks.getGameList.mockResolvedValueOnce({ data: [{ id: 'g1', packageName: 'com.g1', title: '游戏1' }] });
    await retryBtn.trigger('click');
    await flushPromises();

    expect(mocks.getGameList.mock.calls.length).toBe(calls + 1);
    expect(wrapper.findAll('.game-card').length).toBe(1);
  });

  it('快速切换分类：慢的旧响应先发后到，最终列表属于最后选中的分类', async () => {
    const slow = deferred<any>();
    const fast = deferred<any>();
    mocks.getGameList
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => fast.promise);

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.findAll('.cat-tab')[1].trigger('click');
    await flushPromises();

    fast.resolve({ data: [{ id: 's1', packageName: 'com.s1', title: '单机游戏' }] });
    await flushPromises();
    slow.resolve({ data: [{ id: 'h1', packageName: 'com.h1', title: '热门游戏' }] });
    await flushPromises();

    const titles = wrapper.findAll('.game-title').map((n: any) => n.text());
    expect(titles).toEqual(['单机游戏']);
  });

  it('触底加载下一页；footer 加载失败时重试以当前页补齐、不清空已加载内容', async () => {
    mocks.getGameList
      .mockResolvedValueOnce({ data: [1, 2].map((n) => ({ id: `g${n}`, packageName: `com.g${n}`, title: `游戏${n}` })) })
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({ data: [{ id: 'g3', packageName: 'com.g3', title: '游戏3' }] });

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.game-card').length).toBe(2);

    const el = wrapper.find('.page-container').element as HTMLElement;
    Object.defineProperty(el, 'scrollTop', { value: 1600, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
    await wrapper.find('.page-container').trigger('scroll');
    await flushPromises();
    expect(wrapper.find('.pagination-footer .retry-inline').exists()).toBe(true);

    const calls = mocks.getGameList.mock.calls.length;
    await wrapper.find('.pagination-footer .retry-inline').trigger('click');
    await flushPromises();

    expect(mocks.getGameList.mock.calls.length).toBe(calls + 1);
    expect(mocks.getGameList).toHaveBeenLastCalledWith('hot', 2);
    expect(wrapper.findAll('.game-card').length).toBe(3);
  });

  it('缺少 packageName/id 的条目点击：不跳转且给出提示', async () => {
    mocks.getGameList.mockResolvedValueOnce({ data: [{ title: '无名游戏' }] });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('.game-card').trigger('click');
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalled();
  });
});
