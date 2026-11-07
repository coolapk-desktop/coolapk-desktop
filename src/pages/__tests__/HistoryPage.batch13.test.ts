import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { mobilePull } from '../../test-utils/mobilePull';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), resolve: vi.fn(() => ({ matched: [] })) },
  openUrl: vi.fn(),
  getHitHistory: vi.fn(),
  getPublicFeedDetail: vi.fn(),
  getRecentHistory: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }));
vi.mock('../../router', () => ({ router: mocks.router }));
vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getHitHistory: mocks.getHitHistory,
    getPublicFeedDetail: mocks.getPublicFeedDetail,
    getRecentHistory: mocks.getRecentHistory,
    openUrl: mocks.openUrl,
  },
}));

import HistoryPage from '../HistoryPage.vue';
import { useAuthStore } from '../../stores/auth';

const feedItem = {
  title: 'TIGRECC的动态',
  description: '正文摘要',
  url: '/feed/72727311',
  historyType: 'feed',
  id: 'feed:72727311',
  entityType: 'history',
  dateline: 1786022084,
};

async function mountPage(historyData: any[] = [feedItem]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore(pinia);
  authStore.isLoggedIn = true;
  authStore.user = { uid: '123456', username: '测试用户', userAvatar: '' };
  mocks.getHitHistory.mockResolvedValue({ code: 200, data: historyData });
  mocks.getRecentHistory.mockResolvedValue({ code: 200, data: [] });
  mocks.getPublicFeedDetail.mockResolvedValue({ data: null });
  mocks.router.push.mockClear();
  mocks.openUrl.mockClear();

  const wrapper = mount(HistoryPage, { global: { plugins: [pinia] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHitHistory.mockReset();
  mocks.getPublicFeedDetail.mockReset().mockResolvedValue({ data: null });
});

describe('浏览历史翻页失败可见与重试', () => {
  it('翻页请求失败时 footer 显示错误文案与重试按钮，点重试发起新请求且成功后错误消失', async () => {
    mocks.getHitHistory
      .mockResolvedValueOnce({ data: [{ ...feedItem }] })
      .mockRejectedValueOnce(new Error('网络中断'));
    const wrapper = await mountPage();
    expect(mocks.getHitHistory).toHaveBeenCalledTimes(1);

    await wrapper.get('.page-container').trigger('scroll');
    await flushPromises();
    expect(mocks.getHitHistory).toHaveBeenCalledTimes(2);
    const footerError = wrapper.get('.footer-error');
    expect(footerError.text()).toContain('网络中断');
    expect(footerError.text()).toContain('重试');

    // 错误未清空前，滚动触底不自动重刷循环。
    await wrapper.get('.page-container').trigger('scroll');
    await flushPromises();
    expect(mocks.getHitHistory).toHaveBeenCalledTimes(2);

    mocks.getHitHistory.mockResolvedValueOnce({ data: [{ ...feedItem, id: 'feed:72727312', url: '/feed/72727312' }] });
    await footerError.get('button').trigger('click');
    await flushPromises();
    expect(mocks.getHitHistory).toHaveBeenCalledTimes(3);
    expect(mocks.getHitHistory).toHaveBeenLastCalledWith(2, '', 'feed:72727311', 'feed:72727311');
    expect(wrapper.find('.footer-error').exists()).toBe(false);
    expect(wrapper.findAll('.history-item')).toHaveLength(2);
    wrapper.unmount();
  });
});

describe('浏览历史条目内部路由跳转', () => {
  it('/apk/ 前缀条目点击后跳转应用详情路由，不走外链', async () => {
    const wrapper = await mountPage([{ ...feedItem, url: '/apk/com.example.app', id: 'apk-item', title: '示例应用' }]);
    await wrapper.find('.history-item').trigger('click');
    expect(mocks.router.push).toHaveBeenCalledWith('/app/com.example.app');
    expect(mocks.openUrl).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('/product/ 前缀条目点击后跳转产品路由，不走外链', async () => {
    const wrapper = await mountPage([{ ...feedItem, url: '/product/123', id: 'apk-item', title: '示例应用' }]);
    await wrapper.find('.history-item').trigger('click');
    expect(mocks.router.push).toHaveBeenCalledWith('/product/123');
    expect(mocks.openUrl).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('无法解析的 URL 仍回退外链', async () => {
    const wrapper = await mountPage([{ ...feedItem, url: 'https://example.com/page', id: 'web-item', title: '外部页面' }]);
    await wrapper.find('.history-item').trigger('click');
    expect(mocks.openUrl).toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe('下拉刷新重新补全失败元数据', () => {
  it('详情补全失败后下拉刷新让该 feedId 再次进入补全队列，成功数据不闪烁', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    mocks.getPublicFeedDetail.mockRejectedValueOnce(new Error('不可访问'));
    const wrapper = await mountPage();
    expect(mocks.getPublicFeedDetail).toHaveBeenCalledTimes(1);

    mocks.getPublicFeedDetail.mockResolvedValue({ data: { id: '72727311', username: '真实作者' } });
    mobilePull(wrapper.element as HTMLElement);
    await flushPromises();
    await flushPromises();
    expect(mocks.getPublicFeedDetail).toHaveBeenCalledTimes(2);
    expect(mocks.getPublicFeedDetail).toHaveBeenLastCalledWith('72727311');
    expect(wrapper.findAll('.history-item')).toHaveLength(1);
    wrapper.unmount();
    vi.restoreAllMocks();
  });
});
