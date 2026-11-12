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
const downloadMocks = vi.hoisted(() => ({ enqueue: vi.fn(), initialize: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: api }));
vi.mock('../../stores/downloads', () => ({ useDownloadStore: () => downloadMocks }));
vi.mock('../../utils/toast', () => ({ showToast: toast }));

import AppDetailPage from '../AppDetailPage.vue';

beforeEach(() => {
  vi.clearAllMocks();
  api.getAppDetail.mockResolvedValue({ data: { id: '42', title: '应用', packageName: 'com.test.app' } });
  api.getApkRecommendList.mockResolvedValue({ data: [] });
  api.getApkFeeds.mockResolvedValue({ data: [] });
  api.getApkComments.mockResolvedValue({ data: [] });
  api.getApkCollectionStatus.mockResolvedValue({ code: 200, data: [] });
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

async function clickDownload(wrapper: Awaited<ReturnType<typeof setup>>) {
  const button = wrapper.findAll('button').find(item => item.text() === '下载到本地');
  expect(button, '详情页缺少「下载到本地」按钮').toBeDefined();
  await button!.trigger('click');
  await flushPromises();
}

function mockEnqueue(result: any) {
  downloadMocks.enqueue.mockReturnValue(result);
}

describe('应用详情页下载按钮提示', () => {
  it('新任务提示已加入下载队列，并带打开下载中心入口', async () => {
    mockEnqueue({ task: { id: 't1', title: '应用', status: 'queued' }, reused: false, resumed: false, previousStatus: null });
    const wrapper = await setup();
    try {
      await clickDownload(wrapper);
      expect(downloadMocks.enqueue).toHaveBeenCalledTimes(1);
      const [message, type, , action] = toast.mock.calls[0]!;
      expect(message).toBe('已加入下载队列：应用');
      expect(type).toBe('success');
      expect(action.label).toBe('打开下载中心');
    } finally { wrapper.unmount(); }
  });

  it('复用失败或暂停任务时提示已重新排队下载', async () => {
    mockEnqueue({ task: { id: 't1', title: '应用', status: 'queued' }, reused: true, resumed: true, previousStatus: 'failed' });
    const wrapper = await setup();
    try {
      await clickDownload(wrapper);
      expect(toast.mock.calls[0]![0]).toBe('已重新排队下载：应用');
    } finally { wrapper.unmount(); }
  });

  it('复用在下载中的任务时提示已在队列，不谎报新加入', async () => {
    mockEnqueue({ task: { id: 't1', title: '应用', status: 'downloading' }, reused: true, resumed: false, previousStatus: 'downloading' });
    const wrapper = await setup();
    try {
      await clickDownload(wrapper);
      expect(toast.mock.calls[0]![0]).toBe('该版本已在下载队列中：应用');
    } finally { wrapper.unmount(); }
  });

  it('复用已完成任务时提示该版本已下载完成', async () => {
    mockEnqueue({ task: { id: 't1', title: '应用', status: 'completed' }, reused: true, resumed: false, previousStatus: 'completed' });
    const wrapper = await setup();
    try {
      await clickDownload(wrapper);
      expect(toast.mock.calls[0]![0]).toBe('该版本已下载完成');
    } finally { wrapper.unmount(); }
  });
});
