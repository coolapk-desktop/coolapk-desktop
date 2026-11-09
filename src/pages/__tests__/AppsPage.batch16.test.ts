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
  getAppList: vi.fn(),
  searchApks: vi.fn(),
  searchApksByDeveloper: vi.fn(),
  searchApksByTag: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }));
vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getAppList: mocks.getAppList,
    searchApks: mocks.searchApks,
    searchApksByDeveloper: mocks.searchApksByDeveloper,
    searchApksByTag: mocks.searchApksByTag,
  },
}));
vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));

import AppsPage from '../AppsPage.vue';

function mountPage() {
  return mount(AppsPage, {
    global: {
      stubs: { AppButton: true, AppImage: true, LoadingState: true, EmptyState: true },
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AppsPage 批次16：失败可见 / 竞态 / 分页 / 导航兜底', () => {
  it('断网时显示错误态与重试，不得显示「暂无相关应用数据」；点重试只发一次请求', async () => {
    mocks.getAppList.mockRejectedValueOnce(new Error('网络请求失败'));
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('.error-state').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('暂无相关应用数据');
    const retryBtn = wrapper.find('.error-state .retry-btn');
    expect(retryBtn.exists()).toBe(true);

    const calls = mocks.getAppList.mock.calls.length;
    mocks.getAppList.mockResolvedValueOnce({ data: [{ id: 'a1', packageName: 'com.a1', title: '应用1' }] });
    await retryBtn.trigger('click');
    await flushPromises();

    expect(mocks.getAppList.mock.calls.length).toBe(calls + 1);
    expect(wrapper.findAll('.app-card').length).toBe(1);
  });

  it('快速切换分类：慢的旧响应先发后到，最终列表属于最后选中的分类', async () => {
    const slow = deferred<any>();
    const fast = deferred<any>();
    mocks.getAppList
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => fast.promise);

    const wrapper = mountPage();
    await flushPromises();
    // 慢请求（推荐榜）在途时切到「系统工具」
    await wrapper.findAll('.cat-tab')[2].trigger('click');
    await flushPromises();

    fast.resolve({ data: [{ id: 't1', packageName: 'com.t1', title: '工具应用' }] });
    await flushPromises();
    // 旧响应现在才到达，不得覆盖工具榜列表
    slow.resolve({ data: [{ id: 'r1', packageName: 'com.r1', title: '推荐应用' }] });
    await flushPromises();

    const titles = wrapper.findAll('.app-name').map((n: any) => n.text());
    expect(titles).toEqual(['工具应用']);
  });

  it('触底加载下一页；footer 加载失败时重试以当前页补齐、不清空已加载内容', async () => {
    mocks.getAppList
      .mockResolvedValueOnce({ data: [1, 2].map((n) => ({ id: `a${n}`, packageName: `com.a${n}`, title: `应用${n}` })) })
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({ data: [{ id: 'a3', packageName: 'com.a3', title: '应用3' }] });

    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.app-card').length).toBe(2);

    await triggerScroll(wrapper);
    expect(wrapper.find('.pagination-footer .retry-inline').exists()).toBe(true);

    const calls = mocks.getAppList.mock.calls.length;
    await wrapper.find('.pagination-footer .retry-inline').trigger('click');
    await flushPromises();

    expect(mocks.getAppList.mock.calls.length).toBe(calls + 1);
    expect(mocks.getAppList).toHaveBeenLastCalledWith('recommend', 2);
    expect(wrapper.findAll('.app-card').length).toBe(3);
  });

  it('缺少 packageName/id 的条目点击：不跳转且给出提示', async () => {
    mocks.getAppList.mockResolvedValueOnce({ data: [{ title: '无名应用' }] });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('.app-card').trigger('click');
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalled();
  });
});
