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
  getUserFeeds: vi.fn(),
  getMyComments: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }));
vi.mock('../../router', () => ({ router: mocks.router }));
vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: { getUserFeeds: mocks.getUserFeeds, getMyComments: mocks.getMyComments },
}));

// FeedCard / UserEntityCard 用可寻址 stub，便于从列表项上触发事件。
const FeedCardStub = {
  name: 'FeedCardStub',
  props: ['feed'],
  emits: ['pin-changed', 'deleted'],
  template: '<div class="feed-card-stub">{{ feed && feed.message }}</div>',
};
const EntityCardStub = {
  name: 'EntityCardStub',
  props: ['entity', 'tab'],
  emits: ['deleted'],
  template: '<div class="entity-card-stub">{{ entity && entity.message }}</div>',
};

import MyFeedsPage from '../MyFeedsPage.vue';
import MyCommentsPage from '../MyCommentsPage.vue';
import { useAuthStore } from '../../stores/auth';

function pageItems(page: number) {
  return [1, 2].map((n) => ({ id: `p${page}-${n}`, message: `动态${page}-${n}` }));
}

async function triggerScroll(wrapper: ReturnType<typeof mount>) {
  const el = wrapper.find('.page-container').element as HTMLElement;
  Object.defineProperty(el, 'scrollTop', { value: 1600, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  await wrapper.find('.page-container').trigger('scroll');
  await flushPromises();
}

function mountPage(component: any) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore(pinia);
  authStore.isLoggedIn = true;
  authStore.user = { uid: '10001', username: '测试用户' } as any;
  return mount(component, {
    global: {
      plugins: [pinia],
      stubs: {
        FeedCard: FeedCardStub,
        UserEntityCard: EntityCardStub,
        AppButton: true,
        AppImage: true,
        LoadingState: true,
        EmptyState: true,
        ErrorState: true,
      },
    },
  });
}

describe('我的动态/我的评论 翻页失败可见与重试', () => {
  let feedPages: Deferred<any>[];
  let commentPages: Deferred<any>[];

  beforeEach(() => {
    vi.clearAllMocks();
    feedPages = [deferred<any>(), deferred<any>(), deferred<any>()];
    commentPages = [deferred<any>(), deferred<any>(), deferred<any>()];
    mocks.getUserFeeds.mockImplementation((_uid: string, page: number) => feedPages[page - 1]!.promise);
    mocks.getMyComments.mockImplementation((_uid: string, page: number) => commentPages[page - 1]!.promise);
  });

  it('MyFeedsPage：首页失败走列表级 ErrorState，翻页失败在 footer 显示错误', async () => {
    const wrapper = mountPage(MyFeedsPage);
    feedPages[0]!.resolve({ data: pageItems(1) });
    await flushPromises();
    expect(wrapper.find('.feed-card-stub').exists()).toBe(true);

    await triggerScroll(wrapper);
    feedPages[1]!.reject(new Error('网络断开'));
    await flushPromises();
    const footer = wrapper.find('.pagination-footer');
    expect(footer.find('.retry-inline').exists()).toBe(true);
    expect(footer.text()).toContain('加载失败，点击重试');
  });

  it('MyFeedsPage：点重试只发一次请求并恢复翻页', async () => {
    mocks.getUserFeeds.mockReset();
    mocks.getUserFeeds
      .mockResolvedValueOnce({ data: pageItems(1) })
      .mockRejectedValueOnce(new Error('网络断开'))
      .mockResolvedValueOnce({ data: pageItems(2) });
    const wrapper = mountPage(MyFeedsPage);
    await flushPromises();

    await triggerScroll(wrapper);
    await flushPromises();
    const callsBefore = mocks.getUserFeeds.mock.calls.length;

    await wrapper.find('.pagination-footer .retry-inline').trigger('click');
    await flushPromises();

    expect(mocks.getUserFeeds.mock.calls.length).toBe(callsBefore + 1);
    expect(wrapper.find('.pagination-footer .retry-inline').exists()).toBe(false);
    expect(wrapper.findAll('.feed-card-stub').length).toBe(4);
  });

  it('MyCommentsPage：翻页失败 footer 显示错误，重试只发一次请求', async () => {
    mocks.getMyComments.mockReset();
    mocks.getMyComments
      .mockResolvedValueOnce({ data: [{ id: 'c1', message: '评论1' }] })
      .mockRejectedValueOnce(new Error('超时'))
      .mockResolvedValueOnce({ data: [{ id: 'c2', message: '评论2' }] });
    const wrapper = mountPage(MyCommentsPage);
    await flushPromises();

    await triggerScroll(wrapper);
    await flushPromises();
    expect(wrapper.find('.pagination-footer .retry-inline').exists()).toBe(true);
    const callsBefore = mocks.getMyComments.mock.calls.length;

    await wrapper.find('.pagination-footer .retry-inline').trigger('click');
    await flushPromises();

    expect(mocks.getMyComments.mock.calls.length).toBe(callsBefore + 1);
    expect(wrapper.find('.pagination-footer .retry-inline').exists()).toBe(false);
  });
});
