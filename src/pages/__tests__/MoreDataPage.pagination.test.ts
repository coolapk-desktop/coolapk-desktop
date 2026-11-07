import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFollowedTopics: vi.fn(),
  getFollowedCollections: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getFollowedTopics: mocks.getFollowedTopics,
    getFollowedCollections: mocks.getFollowedCollections,
  },
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return { ...actual, useRoute: () => ({ query: {}, meta: {} }), useRouter: () => ({ push: mocks.push }) };
});

vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ isLoggedIn: true, user: { uid: '10001' } }),
}));

vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

import MoreDataPage from '../MoreDataPage.vue';

const topic = (id: number) => ({ id, title: `话题${id}`, description: '描述' });

async function mountPage() {
  const wrapper = mount(MoreDataPage, {
    props: { mode: 'topics' },
    global: {
      plugins: [createPinia()],
      stubs: { AppAvatar: true, AppImage: true, FeedCard: true, LoadingState: true, EmptyState: true, ErrorState: true, AppButton: true },
    },
  });
  await flushPromises();
  return wrapper;
}

function setScrollable(wrapper: any) {
  const page = wrapper.get('.page-container').element as HTMLElement;
  Object.defineProperty(page, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(page, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(page, 'scrollTop', { value: 900, configurable: true });
  return page;
}

describe('更多数据页：翻页失败可见与重试', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getFollowedTopics.mockResolvedValue({ data: [topic(1)] });
  });

  it('加载更多失败时 footer 显示错误与重试，点重试只补当前页且保留已加载内容', async () => {
    const wrapper = await mountPage();
    try {
      expect(wrapper.findAll('.entity-row')).toHaveLength(1);
      expect(wrapper.text()).not.toContain('加载失败，点击重试');

      // 基线：首屏加载后可能已有一次补页请求，后续断言用相对次数。
      const baseline = mocks.getFollowedTopics.mock.calls.length;
      mocks.getFollowedTopics.mockRejectedValue(new Error('网络中断'));
      await wrapper.get('.page-container').trigger('scroll');
      await flushPromises();
      expect(mocks.getFollowedTopics.mock.calls.length).toBe(baseline + 1);
      expect(wrapper.text()).toContain('加载失败，点击重试');
      // 已有内容不能被清空
      expect(wrapper.findAll('.entity-row')).toHaveLength(1);

      // 失败态下继续滚动不应继续发请求（由 handleScroll 的错误守卫拦住）
      await wrapper.get('.page-container').trigger('scroll');
      await flushPromises();
      expect(mocks.getFollowedTopics.mock.calls.length).toBe(baseline + 1);

      mocks.getFollowedTopics.mockResolvedValueOnce({ data: [topic(2)] });
      const retry = wrapper.findAll('button').find((b) => b.text().includes('加载失败，点击重试'));
      expect(retry).toBeDefined();
      await retry!.trigger('click');
      await flushPromises();
      expect(mocks.getFollowedTopics.mock.calls.length).toBe(baseline + 2);
      expect(wrapper.findAll('.entity-row')).toHaveLength(2);
      expect(wrapper.text()).not.toContain('加载失败，点击重试');
    } finally {
      wrapper.unmount();
    }
  });
});
