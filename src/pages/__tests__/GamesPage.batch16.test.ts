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
  getApkCategories: vi.fn(),
  getApkCategoryItems: vi.fn(),
  searchFeeds: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }));
vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getGameList: mocks.getGameList,
    getApkCategories: mocks.getApkCategories,
    getApkCategoryItems: mocks.getApkCategoryItems,
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
  vi.resetAllMocks();
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
    expect(wrapper.findAll('.app-card').length).toBe(1);
  });

  it('快速切换分类：慢的旧响应先发后到，最终列表属于最后选中的分类', async () => {
    const slow = deferred<any>();
    const fast = deferred<any>();
    mocks.getGameList.mockReturnValueOnce(slow.promise);
    mocks.searchFeeds.mockReturnValueOnce(fast.promise);

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('.cat-tab:last-child').trigger('click');
    await flushPromises();

    fast.resolve({ data: [{ id: 's1', title: '游戏评测' }] });
    await flushPromises();
    slow.resolve({ data: [{ id: 'h1', packageName: 'com.h1', title: '热门游戏' }] });
    await flushPromises();

    expect(wrapper.get('.review-title').text()).toBe('游戏评测');
    expect(wrapper.find('.app-card').exists()).toBe(false);
  });

  it.each([
    { label: '游戏', card: '.app-card', fetchPage: mocks.getGameList, query: 'hot' },
    { label: '游评', card: '.review-card', fetchPage: mocks.searchFeeds, query: '游戏评测' },
  ])('$label 分页期间保留原卡片，失败后可以重试同一页', async ({ label, card, fetchPage, query }) => {
    const nextPage = deferred<{ data: { id: string; title: string }[] }>();
    mocks.getGameList.mockResolvedValue({ data: [] });
    fetchPage
      .mockResolvedValueOnce({ data: [{ id: '1', title: `${label}1` }] })
      .mockReturnValueOnce(nextPage.promise)
      .mockResolvedValueOnce({ data: [{ id: '2', title: `${label}2` }] });

    const wrapper = mountPage();
    await flushPromises();
    if (fetchPage === mocks.searchFeeds) {
      await wrapper.get('.cat-tab:last-child').trigger('click');
      await flushPromises();
    }
    const firstCard = wrapper.get(card).element;

    const el = wrapper.find('.page-container').element as HTMLElement;
    Object.defineProperty(el, 'scrollTop', { value: 1600, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
    await wrapper.find('.page-container').trigger('scroll');
    await flushPromises();
    // 原卡片保留在 DOM 中，避免分页请求使列表高度缩短并丢失滚动位置。
    expect(wrapper.get(card).element).toBe(firstCard);
    expect(wrapper.get('.pagination-footer loading-state-stub').attributes('text')).toBe(`正在加载更多${label}...`);

    nextPage.reject(new Error('网络错误'));
    await flushPromises();
    expect(wrapper.find('.pagination-footer .retry-inline').exists()).toBe(true);

    const calls = fetchPage.mock.calls.length;
    await wrapper.find('.pagination-footer .retry-inline').trigger('click');
    await flushPromises();

    expect(fetchPage.mock.calls.length).toBe(calls + 1);
    const paginationArgs = fetchPage === mocks.getGameList ? [query, 2, '1'] : [query, 2];
    expect(fetchPage).toHaveBeenLastCalledWith(...paginationArgs);
    expect(wrapper.findAll(card)).toHaveLength(2);
    expect(wrapper.get(card).element).toBe(firstCard);
  });

  it('游戏使用官方游戏分类，并可直接进入分类标签', async () => {
    mocks.getGameList.mockResolvedValue({ data: [] });
    mocks.getApkCategories.mockResolvedValue({ data: [{ id: 13, title: '休闲', tagList: ['冒险'] }] });
    mocks.getApkCategoryItems.mockResolvedValue({ data: [{ id: '1', title: '冒险游戏' }] });
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.findAll('.cat-tab')[1].trigger('click');
    await flushPromises();

    expect(mocks.getApkCategories).toHaveBeenCalledWith('2');
    await wrapper.get('.category-tag').trigger('click');
    await flushPromises();
    expect(mocks.getApkCategoryItems).toHaveBeenLastCalledWith({ apkType: '2', categoryId: '13', tag: '冒险', sort: 'default', page: 1, lastItem: '' });
    expect(wrapper.get('.app-name').text()).toBe('冒险游戏');
  });

  it('缺少 packageName/id 的条目点击：不跳转且给出提示', async () => {
    mocks.getGameList.mockResolvedValueOnce({ data: [{ title: '无名游戏' }] });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('.app-card').trigger('click');
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalled();
  });
});
