import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

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

async function triggerScroll(wrapper: any) {
  const el = wrapper.find('.page-container').element as HTMLElement;
  Object.defineProperty(el, 'scrollTop', { value: 1600, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  await wrapper.find('.page-container').trigger('scroll');
  await flushPromises();
}

describe('AlbumsPage footer 重试参数语义', () => {
  let pages: Deferred<any>[];

  beforeEach(() => {
    vi.clearAllMocks();
    pages = [deferred<any>(), deferred<any>()];
    mocks.getAlbumList.mockImplementation((_tab: string, page: number) => pages[page - 1]!.promise);
  });

  it('footer 重试以「加载更多」语义补齐当前页：不清空已加载内容，页码未前进', async () => {
    mocks.getAlbumList
      .mockResolvedValueOnce({ data: [1, 2].map((n) => ({ id: `a${n}`, title: `专辑${n}` })) })
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({ data: [{ id: 'a3', title: '专辑3' }] });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.album-card').length).toBe(2);

    // 翻页失败：页码仍是 2，footer 出现重试。
    await triggerScroll(wrapper);
    await flushPromises();
    expect(wrapper.find('.pagination-footer .retry-inline').exists()).toBe(true);

    const callsBefore = mocks.getAlbumList.mock.calls.length;
    await wrapper.find('.pagination-footer .retry-inline').trigger('click');
    await flushPromises();

    // 只发一次请求，且请求的是当前页（第 2 页，热门 tab），不是重置回第 1 页。
    expect(mocks.getAlbumList.mock.calls.length).toBe(callsBefore + 1);
    expect(mocks.getAlbumList).toHaveBeenLastCalledWith('hot', 2);
    // 已加载内容未被清空，而是补齐了该页。
    expect(wrapper.findAll('.album-card').length).toBe(3);
  });
});
