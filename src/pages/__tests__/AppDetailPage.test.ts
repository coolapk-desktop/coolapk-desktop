import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth';

const api = vi.hoisted(() => ({
  getAppDetail: vi.fn(), getApkRecommendList: vi.fn(),
  getApkFeeds: vi.fn(), getApkComments: vi.fn(),
  favoriteApk: vi.fn(), unfavoriteApk: vi.fn(),
  getApkCollectionStatus: vi.fn(),
}));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));
vi.mock('../../stores/downloads', () => ({ useDownloadStore: () => ({ initialize: vi.fn() }) }));

import AppDetailPage from '../AppDetailPage.vue';

beforeEach(() => {
  vi.clearAllMocks();
  api.getAppDetail.mockResolvedValue({ data: { id: '42', title: '应用', packageName: 'com.test.app' } });
  api.getApkRecommendList.mockResolvedValue({ data: [] });
  api.getApkFeeds.mockReset().mockResolvedValue({ data: [{ id: 'discussion', message: '讨论' }] });
  api.getApkComments.mockReset().mockResolvedValue({ data: [{ id: 'comment', message: '评论' }] });
  api.favoriteApk.mockReset().mockResolvedValue({ code: 200, data: { collect: 1 } });
  api.unfavoriteApk.mockReset().mockResolvedValue({ code: 200, data: { collect: 0 } });
  api.getApkCollectionStatus.mockReset().mockResolvedValue({ code: 200, data: [] });
});

async function setup(loggedIn = false) {
  const pinia = createPinia();
  useAuthStore(pinia).isLoggedIn = loggedIn;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/app/:packageName', component: AppDetailPage }] });
  await router.push('/app/com.test.app');
  const wrapper = mount(AppDetailPage, { global: {
    plugins: [pinia, router],
    stubs: {
      FeedCard: { props: ['feed'], template: '<div class="feed-stub">{{ feed.id }}</div>' },
      FeedCommentSection: { props: ['comments'], template: '<div class="comments-stub">{{ comments.map(c => c.id).join(",") }}</div>' },
      AppButton: { props: ['loading', 'disabled'], template: '<button :disabled="loading || disabled"><slot /></button>' }, AppImage: true, AppDialog: true, LoadingState: true, EmptyState: true, ErrorState: true,
    },
  } });
  await flushPromises();
  return wrapper;
}

describe('应用动态排序', () => {
  it('收藏只在服务器成功后更新，等待期间禁止重复点击', async () => {
    let finish!: (value: unknown) => void;
    api.favoriteApk.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = await setup();
    try {
      useAuthStore().isLoggedIn = true;
      const button = wrapper.findAll('button').find(item => item.text() === '收藏应用')!;
      await button.trigger('click');
      expect(button.text()).toBe('收藏应用');
      expect(button.attributes('disabled')).toBeDefined();
      await button.trigger('click');
      expect(api.favoriteApk).toHaveBeenCalledTimes(1);
      finish({ code: 200, data: { collect: 1 } }); await flushPromises();
      expect(button.text()).toBe('已收藏');
    } finally { wrapper.unmount(); }
  });

  it('收藏失败保留未收藏状态，并显示后端返回的具体原因', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    api.favoriteApk.mockRejectedValue('服务端拒绝收藏');
    const wrapper = await setup();
    try {
      useAuthStore().isLoggedIn = true;
      const button = wrapper.findAll('button').find(item => item.text() === '收藏应用')!;
      await button.trigger('click'); await flushPromises();
      expect(button.text()).toBe('收藏应用');
      expect(button.attributes('disabled')).toBeUndefined();
      expect(alert).toHaveBeenCalledWith('收藏操作失败：服务端拒绝收藏');
    } finally { wrapper.unmount(); alert.mockRestore(); }
  });

  it('旧详情 follow 为零时仍从真实收藏单恢复状态，点击已收藏时调用取消入口', async () => {
    api.getAppDetail.mockResolvedValue({ data: { id: '42', title: '应用', packageName: 'com.test.app', userAction: { follow: 0 } } });
    api.getApkCollectionStatus.mockResolvedValue({ code: 200, data: [{ id: '9', isBeCollected: 1 }] });
    const wrapper = await setup(true);
    try {
      const auth = useAuthStore(); auth.isLoggedIn = true;
      const button = wrapper.findAll('button').find(item => item.text() === '已收藏');
      expect(api.getApkCollectionStatus).toHaveBeenCalledWith('42');
      expect(button, '详情已有收藏，但页面仍显示收藏应用').toBeDefined();
      await button!.trigger('click'); await flushPromises();
      expect(api.unfavoriteApk).toHaveBeenCalledWith('com.test.app');
      expect(api.favoriteApk).not.toHaveBeenCalled();
      expect(wrapper.findAll('button').some(item => item.text() === '收藏应用')).toBe(true);
    } finally { wrapper.unmount(); }
  });
  it('讨论切换最新和热门时重置第一页、替换旧列表，并保持后续分页排序', async () => {
    const wrapper = await setup();
    await wrapper.findAll('.detail-tab-item').find(b => b.text() === '讨论')!.trigger('click');
    await flushPromises();
    expect(api.getApkFeeds).toHaveBeenLastCalledWith('com.test.app', 'lastupdate_desc', 1);
    api.getApkFeeds.mockResolvedValue({ data: [{ id: 'latest' }] });
    await wrapper.findAll('.app-feed-sort button')[1].trigger('click');
    await flushPromises();
    expect(api.getApkFeeds).toHaveBeenLastCalledWith('com.test.app', 'dateline_desc', 1);
    expect(wrapper.find('.feed-stub').text()).toBe('latest');
    await wrapper.get('.page-container').trigger('scroll');
    await flushPromises();
    expect(api.getApkFeeds).toHaveBeenLastCalledWith('com.test.app', 'dateline_desc', 2);
    api.getApkFeeds.mockResolvedValue({ data: [{ id: 'hot' }] });
    await wrapper.findAll('.app-feed-sort button')[2].trigger('click');
    await flushPromises();
    expect(api.getApkFeeds).toHaveBeenLastCalledWith('com.test.app', 'popular', 1);
    expect(wrapper.findAll('.feed-stub').map(f => f.text())).toEqual(['hot']);
    wrapper.unmount();
  });

  it('评论排序独立于讨论，并在加载期间禁止重复切换', async () => {
    const wrapper = await setup();
    await wrapper.findAll('.detail-tab-item').find(b => b.text() === '评论')!.trigger('click');
    await flushPromises();
    expect(api.getApkComments).toHaveBeenLastCalledWith('com.test.app', 'dateline_desc', 1);
    let resolve!: (data: any) => void;
    api.getApkComments.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await wrapper.findAll('.app-feed-sort button')[2].trigger('click');
    expect(api.getApkComments).toHaveBeenLastCalledWith('com.test.app', 'popular', 1);
    expect(wrapper.findAll('.app-feed-sort button').every(b => b.attributes('disabled') !== undefined)).toBe(true);
    resolve({ data: [{ id: 'popular-comment' }] });
    await flushPromises();
    expect(wrapper.find('.comments-stub').text()).toBe('popular-comment');
    await wrapper.findAll('.detail-tab-item').find(b => b.text() === '讨论')!.trigger('click');
    await flushPromises();
    expect(api.getApkFeeds).toHaveBeenLastCalledWith('com.test.app', 'lastupdate_desc', 1);
    wrapper.unmount();
  });
});
