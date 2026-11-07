import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  getAlbumList: vi.fn(),
  searchAlbums: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }));
vi.mock('../../router', () => ({ router: mocks.router }));
vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: { getAlbumList: mocks.getAlbumList, searchAlbums: mocks.searchAlbums },
}));

import AlbumsPage from '../AlbumsPage.vue';

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(AlbumsPage, {
    global: {
      plugins: [pinia],
      stubs: { AppButton: true, AppImage: true, LoadingState: true, EmptyState: true, ErrorState: true },
    },
  });
}

function listOf(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, title: `${prefix}专辑${i + 1}` }));
}

describe('AlbumsPage 搜索/切分类与在途请求竞态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('搜索在途时切「最新」：新分类内容必须替换列表，慢的搜索响应不得覆盖', async () => {
    const searchResponse = deferred<{ data: unknown }>();
    const newTabResponse = deferred<{ data: unknown }>();
    mocks.getAlbumList.mockResolvedValueOnce({ data: listOf('hot', 2) });
    mocks.searchAlbums.mockReturnValueOnce(searchResponse.promise);
    mocks.getAlbumList.mockReturnValueOnce(newTabResponse.promise);

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.album-card').length).toBe(2);

    // 发起搜索（在途）
    await wrapper.find('.search-input').setValue('酷安');
    await wrapper.find('.search-input').trigger('keyup.enter');
    expect(mocks.searchAlbums).toHaveBeenCalledWith('酷安', 1);

    // 搜索未返回时切「最新」标签
    await wrapper.findAll('.cat-tab')[1]!.trigger('click');
    expect(mocks.getAlbumList).toHaveBeenLastCalledWith('new', 1);

    // 慢的搜索响应到达：不得覆盖「最新」分类
    searchResponse.resolve({ data: listOf('search', 3) });
    await flushPromises();
    const titlesAfterStale = wrapper.findAll('.album-card-title').map(n => n.text());
    expect(titlesAfterStale).not.toContain('search专辑1');

    // 新分类响应到达：列表替换为新分类内容
    newTabResponse.resolve({ data: listOf('new', 2) });
    await flushPromises();
    const titles = wrapper.findAll('.album-card-title').map(n => n.text());
    expect(titles).toEqual(['new专辑1', 'new专辑2']);
  });

  it('翻页在途时切分类：切分类的刷新请求不被 loading 守卫吞掉', async () => {
    const page2Response = deferred<{ data: unknown }>();
    mocks.getAlbumList
      .mockResolvedValueOnce({ data: listOf('hot', 2) })
      .mockReturnValueOnce(page2Response.promise);
    const newTabResponse = deferred<{ data: unknown }>();
    mocks.getAlbumList.mockReturnValueOnce(newTabResponse.promise);

    const wrapper = mountPage();
    await flushPromises();

    // 滚动触发「加载更多」（在途）
    const el = wrapper.find('.page-container').element as HTMLElement;
    Object.defineProperty(el, 'scrollTop', { value: 1600, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
    await wrapper.find('.page-container').trigger('scroll');
    expect(mocks.getAlbumList).toHaveBeenLastCalledWith('hot', 2);

    // 翻页在途时切「最新」：必须立即发出新分类请求
    await wrapper.findAll('.cat-tab')[1]!.trigger('click');
    expect(mocks.getAlbumList).toHaveBeenLastCalledWith('new', 1);

    // 旧翻页响应被序号作废，不得污染新分类列表
    page2Response.resolve({ data: listOf('hot', 2) });
    await flushPromises();
    newTabResponse.resolve({ data: listOf('new', 1) });
    await flushPromises();
    const titles = wrapper.findAll('.album-card-title').map(n => n.text());
    expect(titles).toEqual(['new专辑1']);
  });
});
