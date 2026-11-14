import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFollowedTopics: vi.fn(),
  getFollowedCollections: vi.fn(),
  getUserForumFollowList: vi.fn(),
  getUserTabData: vi.fn(),
  query: {} as Record<string, string>,
  push: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getFollowedTopics: mocks.getFollowedTopics,
    getFollowedCollections: mocks.getFollowedCollections,
    getUserForumFollowList: mocks.getUserForumFollowList,
    getUserTabData: mocks.getUserTabData,
  },
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return { ...actual, useRoute: () => ({ query: mocks.query, meta: {} }), useRouter: () => ({ push: mocks.push }) };
});

vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ isLoggedIn: true, user: { uid: '10001' } }),
}));

vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

import MoreDataPage from '../MoreDataPage.vue';
import MoreWorkspacePage from '../MoreWorkspacePage.vue';

const topic = (id: number) => ({ id, title: `话题${id}`, description: '描述' });

async function mountPage(mode = 'topics') {
  const wrapper = mount(MoreDataPage, {
    props: { mode },
    global: {
      plugins: [createPinia()],
      stubs: { AppAvatar: true, AppImage: true, FeedCard: true, LoadingState: true, EmptyState: true, ErrorState: true },
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
    mocks.query = {};
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

  it('关注论坛翻页使用论坛条目的首尾 ID，合并重叠条目并在空页停止', async () => {
    const first = { id: '1', entityType: 'appForum', title: '论坛一' };
    const second = { id: '2', entityType: 'appForum', title: '论坛二' };
    const card = { id: 'card', entityType: 'card', title: '提示' };
    mocks.getUserForumFollowList.mockReset()
      .mockResolvedValueOnce({ data: [card, first, second] })
      .mockResolvedValueOnce({ data: [second, { id: '3', entityType: 'appForum', title: '论坛三' }] })
      .mockResolvedValueOnce({ data: [] });
    const wrapper = await mountPage('nodes');
    try {
      expect(mocks.getUserForumFollowList).toHaveBeenNthCalledWith(1, '10001', 1, '', '');
      setScrollable(wrapper);
      await wrapper.get('.page-container').trigger('scroll');
      await flushPromises();
      expect(mocks.getUserForumFollowList).toHaveBeenNthCalledWith(2, '10001', 2, '1', '2');
      expect(wrapper.text().match(/论坛二/g)).toHaveLength(1);
      expect(wrapper.text()).toContain('论坛三');
      await wrapper.get('.pagination-footer button').trigger('click');
      await flushPromises();
      expect(mocks.getUserForumFollowList).toHaveBeenNthCalledWith(3, '10001', 3, '1', '3');
      expect(wrapper.text()).toContain('已加载全部内容');
      await wrapper.get('.page-container').trigger('scroll');
      expect(mocks.getUserForumFollowList).toHaveBeenCalledTimes(3);
    } finally {
      wrapper.unmount();
    }
  });

  it('显示当前账号关注的应用，支持翻页和打开应用详情', async () => {
    mocks.getUserTabData.mockReset()
      .mockResolvedValueOnce({ data: [{ id: '11', title: '应用一', packageName: 'com.example.first' }] })
      .mockResolvedValueOnce({ data: [{ id: '12', title: '应用二', url: '#/apk/detail?id=12' }] });
    const wrapper = await mountPage('apps');
    try {
      expect(mocks.getUserTabData).toHaveBeenNthCalledWith(1, '10001', 'apk_follow', 1, '', '');
      await wrapper.get('.catalog-app-grid .app-card').trigger('click');
      expect(mocks.push).toHaveBeenLastCalledWith('/app/com.example.first');
      await wrapper.get('.pagination-footer button').trigger('click');
      await flushPromises();
      expect(mocks.getUserTabData).toHaveBeenNthCalledWith(2, '10001', 'apk_follow', 2, '11', '11');
      mocks.push.mockClear();
      await wrapper.findAll('.app-card .action-btn')[1]!.trigger('click');
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/app/12');
    } finally {
      wrapper.unmount();
    }
  });

  it('从我的栏目弹窗选择关注的应用时加载同一个应用列表', async () => {
    mocks.getUserTabData.mockReset().mockResolvedValue({
      data: [{ id: '11', title: '关注的游戏', packageName: 'com.example.game', apkType: 2 }],
    });
    const wrapper = mount(MoreWorkspacePage, {
      global: {
        stubs: { teleport: true, MyLikesPage: true, AppImage: true },
      },
    });
    try {
      await wrapper.get('.tab-manage-btn').trigger('click');
      const appTile = wrapper.findAll('.channel-tile').find(tile => tile.text() === '关注的应用');
      expect(appTile).toBeDefined();
      await appTile!.trigger('click');
      await flushPromises();
      expect(mocks.getUserTabData).toHaveBeenCalledExactlyOnceWith('10001', 'apk_follow', 1, '', '');
      expect(wrapper.get('.catalog-app-grid .app-card').text()).toContain('关注的游戏');
    } finally {
      wrapper.unmount();
    }
  });

  it('直接打开我的关注应用栏目时显示应用分类卡片及查看按钮', async () => {
    mocks.query = { section: 'followed_apps' };
    mocks.getUserTabData.mockReset().mockResolvedValue({
      data: [{ id: '11', title: '滴滴', packageName: 'com.sdu.didi.psnger', apkversionname: '8.0.20' }],
    });
    const wrapper = mount(MoreWorkspacePage, {
      global: { stubs: { teleport: true, MyLikesPage: true, AppImage: true } },
    });
    try {
      await flushPromises();
      expect(wrapper.get('.tab-item.is-active').text()).toBe('关注的应用');
      const card = wrapper.get('.catalog-app-grid .app-card');
      expect(card.get('.app-name').text()).toBe('滴滴');
      expect(card.get('.version-tag').text()).toBe('8.0.20');
      await card.get('button[aria-label="查看 滴滴"]').trigger('click');
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/app/com.sdu.didi.psnger');
    } finally {
      wrapper.unmount();
    }
  });
});
