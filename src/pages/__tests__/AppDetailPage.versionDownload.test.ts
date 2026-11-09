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
  getDownloadVersionList: vi.fn(),
}));
const downloadMocks = vi.hoisted(() => ({ enqueue: vi.fn(), initialize: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));
vi.mock('../../stores/downloads', () => ({ useDownloadStore: () => downloadMocks }));
vi.mock('../../utils/toast', () => ({ showToast: toast }));

import AppDetailPage from '../AppDetailPage.vue';

beforeEach(() => {
  vi.clearAllMocks();
  api.getAppDetail.mockResolvedValue({ data: { id: '42', title: '示例应用', packageName: 'com.test.app' } });
  api.getApkRecommendList.mockResolvedValue({ data: [] });
  api.getApkFeeds.mockResolvedValue({ data: [] });
  api.getApkComments.mockResolvedValue({ data: [] });
  api.getApkCollectionStatus.mockResolvedValue({ code: 200, data: [] });
  downloadMocks.enqueue.mockReturnValue({
    task: { id: 't1', title: '示例应用', status: 'queued' },
    reused: false, resumed: false, previousStatus: null,
  });
});

async function setup() {
  const pinia = createPinia();
  useAuthStore(pinia).isLoggedIn = false;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/app/:packageName', component: AppDetailPage }] });
  await router.push('/app/com.test.app');
  const wrapper = mount(AppDetailPage, { global: {
    plugins: [pinia, router],
    stubs: {
      AppButton: { props: ['loading', 'disabled'], template: '<button :disabled="loading || disabled"><slot /></button>' },
      AppImage: true, AppDialog: true, LoadingState: true, EmptyState: true, ErrorState: true,
      FeedCard: true, FeedCommentSection: true,
    },
  } });
  await flushPromises();
  return wrapper;
}

describe('版本历史的直接下载入口', () => {
  it('点击某条版本的下载按钮：用该版本的 versionCode/apkId 入队，而不是当前 appInfo 的', async () => {
    api.getDownloadVersionList.mockResolvedValue({ data: [
      { versionName: '1.7.3', versioncode: 173, apkid: '111' },
      { versionName: '1.6.0', versioncode: 160, apkid: '111' },
    ] });
    const wrapper = await setup();
    try {
      const tab = wrapper.findAll('button').find((b) => b.text() === '版本历史');
      expect(tab, '缺少版本历史 Tab').toBeDefined();
      await tab!.trigger('click');
      await flushPromises();

      const buttons = wrapper.findAll('button').filter((b) => b.text() === '下载');
      expect(buttons.length).toBe(2);
      await buttons[1]!.trigger('click');
      await flushPromises();

      expect(downloadMocks.enqueue).toHaveBeenCalledTimes(1);
      const options = downloadMocks.enqueue.mock.calls[0]![0];
      expect(options.versionName).toBe('1.6.0');
      expect(options.versionCode).toBe('160');
      expect(options.apkId).toBe('111');
      expect(options.packageName).toBe('com.test.app');
      expect(toast.mock.calls[0]![0]).toBe('已加入下载队列：示例应用');
    } finally { wrapper.unmount(); }
  });
});
