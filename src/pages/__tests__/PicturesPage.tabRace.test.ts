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
  getPictureList: vi.fn(),
  openImageViewer: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: { getPictureList: mocks.getPictureList },
}));
vi.mock('../../stores/app', () => ({
  useAppStore: () => ({ openImageViewer: mocks.openImageViewer }),
}));

import PicturesPage from '../PicturesPage.vue';

function picList(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    username: `${prefix}用户`,
    message: `${prefix}图片${i + 1}`,
    pics: [`https://img.example.com/${prefix}-${i + 1}.jpg`],
  }));
}

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(PicturesPage, {
    global: {
      plugins: [pinia],
      stubs: { AppImage: true, AppAvatar: true, LoadingState: true, EmptyState: true, ErrorState: true },
    },
  });
}

async function triggerScroll(wrapper: ReturnType<typeof mount>) {
  const el = wrapper.find('.pictures-page').element as HTMLElement;
  Object.defineProperty(el, 'scrollTop', { value: 1600, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  await wrapper.find('.pictures-page').trigger('scroll');
  await flushPromises();
}

describe('PicturesPage 切标签竞态 / footer 重试 / 到底判定', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('切标签：新标签内容必须替换旧内容，翻页在途时刷新请求不被 loading 吞掉', async () => {
    const page2Response = deferred<{ data: unknown }>();
    mocks.getPictureList
      .mockResolvedValueOnce({ data: picList('all', 2) })
      .mockReturnValueOnce(page2Response.promise);
    const photoResponse = deferred<{ data: unknown }>();
    mocks.getPictureList.mockReturnValueOnce(photoResponse.promise);

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.picture-card').length).toBe(2);

    // 滚动触发「加载更多」（在途）
    await triggerScroll(wrapper);
    expect(mocks.getPictureList).toHaveBeenLastCalledWith('', 2);

    // 翻页在途时切「摄影」：必须立即发出新标签请求
    await wrapper.findAll('.tab-item')[2]!.trigger('click');
    expect(mocks.getPictureList).toHaveBeenLastCalledWith('摄影', 1);

    // 切标签即清空旧内容等待新标签数据；旧翻页响应被作废，不得出现在「摄影」下
    expect(wrapper.findAll('.picture-card').length).toBe(0);
    page2Response.resolve({ data: picList('all', 2) });
    await flushPromises();
    expect(wrapper.text()).not.toContain('all图片1');

    // 新标签响应：列表替换为新标签内容
    photoResponse.resolve({ data: picList('photo', 1) });
    await flushPromises();
    expect(wrapper.findAll('.picture-card').length).toBe(1);
    expect(wrapper.text()).toContain('photo图片1');
    expect(wrapper.text()).not.toContain('all图片1');
  });

  it('footer 重试：走非刷新分支补齐当前页，不清空已加载的多页内容', async () => {
    mocks.getPictureList
      .mockResolvedValueOnce({ data: picList('p1', 2) })
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({ data: picList('p2', 1) });

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.picture-card').length).toBe(2);

    await triggerScroll(wrapper);
    expect(wrapper.find('.pagination-footer .retry-inline').exists()).toBe(true);

    const callsBefore = mocks.getPictureList.mock.calls.length;
    await wrapper.find('.pagination-footer .retry-inline').trigger('click');
    await flushPromises();

    // 只发一次请求，请求的是当前页（第 2 页、全部标签），不是重置回第 1 页
    expect(mocks.getPictureList.mock.calls.length).toBe(callsBefore + 1);
    expect(mocks.getPictureList).toHaveBeenLastCalledWith('', 2);
    // 已加载内容未被清空，而是补齐了该页
    expect(wrapper.findAll('.picture-card').length).toBe(3);
  });

  it('到底判定：只以空页判定 noMore，单页不足 10 条不提前截断', async () => {
    mocks.getPictureList
      .mockResolvedValueOnce({ data: picList('a', 5) })
      .mockResolvedValueOnce({ data: picList('b', 3) })
      .mockResolvedValueOnce({ data: [] });

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.picture-card').length).toBe(5);
    expect(wrapper.text()).not.toContain('已加载全部酷图');

    await triggerScroll(wrapper);
    expect(wrapper.findAll('.picture-card').length).toBe(8);
    expect(wrapper.text()).not.toContain('已加载全部酷图');

    await triggerScroll(wrapper);
    expect(wrapper.findAll('.picture-card').length).toBe(8);
    expect(wrapper.text()).toContain('已加载全部酷图');
  });
});
