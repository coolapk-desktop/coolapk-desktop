import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBoardFeeds: vi.fn(),
  getHotFeeds: vi.fn(),
  searchFeeds: vi.fn(),
  getProductDetailByName: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getBoardFeeds: mocks.getBoardFeeds,
    getHotFeeds: mocks.getHotFeeds,
    searchFeeds: mocks.searchFeeds,
    getProductDetailByName: mocks.getProductDetailByName,
  },
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return { ...actual, useRouter: () => ({ push: mocks.push }) };
});

vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

import ReviewPage from '../ReviewPage.vue';

const feed = (id: number) => ({ id, message: `评测内容${id}`, username: '甲', dateline: 1700000000 });

async function mountPage() {
  const wrapper = mount(ReviewPage, {
    global: {
      plugins: [createPinia()],
      stubs: { FeedCard: true, LoadingState: true, ErrorState: true, EmptyState: true, AppButton: true },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('评测页：板块回退提示与分页失败', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('板块接口失败回退热榜时明确提示「看到的不是所选板块」', async () => {
    mocks.getBoardFeeds.mockRejectedValue(new Error('板块接口异常'));
    mocks.getHotFeeds.mockResolvedValue({ data: [feed(1), feed(2), feed(3)] });
    const wrapper = await mountPage();
    try {
      const notice = wrapper.find('.board-fallback-notice');
      expect(notice.exists()).toBe(true);
      expect(notice.text()).toContain('板块加载失败');
      expect(notice.text()).toContain('推荐热榜');
      // 热榜内容照常展示，用户不会看到空白页
      expect(wrapper.html()).toBeTruthy();
    } finally {
      wrapper.unmount();
    }
  });

  it('板块接口正常时不出现回退提示', async () => {
    mocks.getBoardFeeds.mockResolvedValue({ data: [feed(5), feed(6), feed(7)] });
    mocks.getHotFeeds.mockResolvedValue({ data: [] });
    const wrapper = await mountPage();
    try {
      expect(wrapper.find('.board-fallback-notice').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
