import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  getUserFeeds: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }));
vi.mock('../../router', () => ({ router: mocks.router }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: { getUserFeeds: mocks.getUserFeeds } }));

const FeedCardStub = {
  name: 'FeedCardStub',
  props: ['feed'],
  emits: ['pin-changed', 'deleted'],
  template: '<div class="feed-card-stub" :data-id="feed && feed.id">{{ feed && feed.message }}</div>',
};

import MyFeedsPage from '../MyFeedsPage.vue';
import { useAuthStore } from '../../stores/auth';

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore(pinia);
  authStore.isLoggedIn = true;
  authStore.user = { uid: '10001', username: '测试用户' } as any;
  return mount(MyFeedsPage, {
    global: {
      plugins: [pinia],
      stubs: { FeedCard: FeedCardStub, AppButton: true, AppImage: true, LoadingState: true, EmptyState: true, ErrorState: true },
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

describe('MyFeedsPage 去重键与置顶局部更新', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无 id/entityId 的条目不参与去重，两条同时保留（不得生成 undefined 键）', async () => {
    const keyless = (message: string) => ({ title: message, message });
    mocks.getUserFeeds.mockResolvedValue({ data: [keyless('无键A'), keyless('无键B')] });
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.feed-card-stub').length).toBe(2);
    expect(wrapper.text()).not.toContain('undefined');
  });

  it('加载 3 页后置顶不整表刷新：条目数不变、首条不变、不发新请求', async () => {
    mocks.getUserFeeds.mockImplementation((_uid: string, page: number) =>
      Promise.resolve({ data: [1, 2].map((n) => ({ id: `p${page}-${n}`, message: `动态${page}-${n}` })) }));
    const wrapper = mountPage();
    await flushPromises();
    await triggerScroll(wrapper);
    await triggerScroll(wrapper);
    const before = mocks.getUserFeeds.mock.calls.length;
    const cards = wrapper.findAll('.feed-card-stub');
    expect(cards.length).toBe(6);
    const firstMessage = cards[0]!.text();

    // 第 5 条（第 3 页第 1 条）置顶：FeedCard 原地更新字段后 emit pin-changed。
    await cards[4]!.trigger('pin-changed');
    await flushPromises();

    expect(mocks.getUserFeeds.mock.calls.length).toBe(before);
    const after = wrapper.findAll('.feed-card-stub');
    expect(after.length).toBe(6);
    expect(after[0]!.text()).toBe(firstMessage);
    expect((wrapper.find('.page-container').element as HTMLElement).scrollTop).toBe(1600);
  });
});
