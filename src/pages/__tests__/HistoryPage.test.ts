import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), resolve: vi.fn(() => ({ matched: [] })) },
  openUrl: vi.fn(),
  getHitHistory: vi.fn(),
  getPublicFeedDetail: vi.fn(),
  getRecentHistory: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => mocks.router,
}));

vi.mock('../../router', () => ({
  router: mocks.router,
}));

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
import { useAppStore } from '../../stores/app';

const feedItem = {
  title: 'TIGRECC的动态',
  description:
    '<a class="feed-link-tag" href="/t/%E6%95%B0%E7%A0%81%E6%97%A5%E5%B8%B8?type=0">#数码日常#</a> 在家用 Windows 刷酷安',
  logo: 'http://avatar.coolapk.com/data/x_avatar_middle.jpg',
  url: '/feed/72727311',
  historyType: 'feed',
  typeName: '',
  id: 'feed:72727311',
  entityType: 'history',
  dateline: 1786022084,
};

const userItem = {
  title: '测试用户',
  description: '',
  logo: 'http://avatar.coolapk.com/data/y_avatar_middle.jpg',
  url: '/u/123456',
  historyType: 'user',
  typeName: '用户',
  id: 'user:123456',
  entityType: 'history',
  dateline: 1786022084,
};

async function mountPage(historyData: any[] = [feedItem, userItem]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore(pinia);
  authStore.isLoggedIn = true;
  authStore.user = { uid: '123456', username: '测试用户', userAvatar: '' };
  mocks.getHitHistory.mockResolvedValue({ code: 200, data: historyData });
  mocks.getRecentHistory.mockResolvedValue({ code: 200, data: [] });
  mocks.router.push.mockClear();
  mocks.openUrl.mockClear();

  const wrapper = mount(HistoryPage, { global: { plugins: [pinia] } });
  await flushPromises();
  return { wrapper, appStore: useAppStore(pinia) };
}

describe('HistoryPage 点击行为', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHitHistory.mockReset();
    mocks.getPublicFeedDetail.mockReset().mockResolvedValue({ data: null });
  });

  it('有标题文章使用详情正文和首图，不重复显示历史中的标题摘要', async () => {
    const title = '你的手机系统，正偷偷泄漏你的一切';
    mocks.getPublicFeedDetail.mockResolvedValue({ data: {
      id: '72727311', username: '遗藏', message_title: title, message: '这是文章真实正文，介绍系统隐私设置。', picArr: ['//image.coolapk.com/feed/article.jpg'],
    } });
    const { wrapper } = await mountPage([{ ...feedItem, title, description: title }]);
    expect(wrapper.get('.history-post-title').text()).toBe(title);
    expect(wrapper.get('.history-desc').text()).toBe('这是文章真实正文，介绍系统隐私设置。');
    expect(wrapper.text().split(title)).toHaveLength(2);
    expect(wrapper.get('.card-thumb-wrap').getComponent({ name: 'AppImage' }).props('src')).toBe('https://image.coolapk.com/feed/article.jpg');
    wrapper.unmount();
  });

  it('详情不可访问时只显示一次重复标题，仍保留历史缩略图', async () => {
    mocks.getPublicFeedDetail.mockRejectedValue(new Error('不可访问'));
    const { wrapper } = await mountPage([{ ...feedItem, title: '文章标题', description: '<b>文章标题</b>', picArr: ['https://image.coolapk.com/feed/history.jpg'] }]);
    expect(wrapper.get('.history-post-title').text()).toBe('文章标题');
    expect(wrapper.find('.history-desc').exists()).toBe(false);
    expect(wrapper.get('.card-thumb-wrap').getComponent({ name: 'AppImage' }).props('src')).toBe('https://image.coolapk.com/feed/history.jpg');
    wrapper.unmount();
  });

  it('普通图文动态不把历史正文摘要当独立标题，缺图时沿用历史封面', async () => {
    mocks.getPublicFeedDetail.mockResolvedValue({ data: { id: '72727311', username: '作者', message: '完整图文正文' } });
    const { wrapper } = await mountPage([{ ...feedItem, title: '完整图文正文', cover: 'https://image.coolapk.com/feed/cover.jpg' }]);
    expect(wrapper.find('.history-post-title').exists()).toBe(false);
    expect(wrapper.get('.history-desc').text()).toBe('完整图文正文');
    expect(wrapper.find('.card-thumb-wrap').exists()).toBe(true);
    wrapper.unmount();
  });

  it('头像旁统一显示作者，正文首行展示独立标题，发布日期不影响浏览日期分组', async () => {
    const viewed = new Date();
    viewed.setHours(14, 30, 0, 0);
    const published = new Date(2025, 1, 3, 9, 15);
    mocks.getPublicFeedDetail.mockResolvedValue({ data: {
      id: '72727311', username: '真实作者', title: '<b>帖子标题</b>', dateline: published.getTime() / 1000,
    } });
    const { wrapper } = await mountPage([{ ...feedItem, title: '帖子标题', dateline: viewed.getTime() / 1000 }]);
    expect(wrapper.get('.feed-author-name').text()).toBe('真实作者');
    expect(wrapper.get('.history-post-title').text()).toBe('帖子标题');
    expect(wrapper.get('.history-post-title').find('b').exists()).toBe(false);
    expect(wrapper.get('.feed-time-text').text()).toContain('浏览 14:30');
    expect(wrapper.get('.feed-time-text').text()).toContain('发布 2025-02-03 09:15');
    expect(wrapper.get('.date-title').text()).toBe('今天');
    expect(mocks.getPublicFeedDetail).toHaveBeenCalledExactlyOnceWith('72727311');
    wrapper.unmount();
  });

  it('详情不可访问时保留摘要，不把帖子标题当作者或浏览时间当发布时间', async () => {
    mocks.getPublicFeedDetail.mockRejectedValue(new Error('不可访问'));
    const { wrapper } = await mountPage([{ ...feedItem, title: '有标题的帖子' }]);
    expect(wrapper.get('.feed-author-name').text()).toBe('未知用户');
    expect(wrapper.get('.history-post-title').text()).toBe('有标题的帖子');
    expect(wrapper.get('.history-desc').text()).toContain('在家用 Windows 刷酷安');
    expect(wrapper.get('.feed-time-text').text()).not.toContain('发布');
    expect(wrapper.find('.error-wrapper').exists()).toBe(false);
    wrapper.unmount();
  });

  it('普通动态的通用标题只用于提取作者，不重复放到正文首行', async () => {
    const { wrapper } = await mountPage([feedItem]);
    expect(wrapper.get('.feed-author-name').text()).toBe('TIGRECC');
    expect(wrapper.find('.history-post-title').exists()).toBe(false);
    wrapper.unmount();
  });

  it('公开详情最多并发两条，卸载后丢弃结果并停止队列', async () => {
    let finish!: (value: any) => void;
    mocks.getPublicFeedDetail.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { wrapper } = await mountPage([1, 2, 3].map(id => ({ ...feedItem, id: `feed:${id}`, url: `/feed/${id}` })));
    expect(mocks.getPublicFeedDetail).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    finish({ data: { id: 2, username: '过期结果' } });
    await flushPromises();
    expect(mocks.getPublicFeedDetail).toHaveBeenCalledTimes(2);
  });

  it('点击动态条目卡片 → 进入完整动态页并保存上下文', async () => {
    const { wrapper, appStore } = await mountPage();
    const items = wrapper.findAll('.history-item');
    expect(items).toHaveLength(1);
    expect(mocks.getHitHistory).toHaveBeenCalledWith(1, '', undefined, undefined);

    await items[0].trigger('click');
    expect(mocks.router.push).toHaveBeenCalledWith('/feed/72727311');
    expect(appStore.getFeedDetailContext('72727311')).toStrictEqual(feedItem);
  });

  it('点击描述区纯文本（非链接）→ 进入完整动态页', async () => {
    const { wrapper, appStore } = await mountPage();
    const desc = wrapper.find('.history-desc');
    expect(desc.exists()).toBe(true);

    // 点击描述里非链接的正文文字
    await desc.trigger('click');
    expect(mocks.router.push).toHaveBeenCalledWith('/feed/72727311');
  });

  it('点击描述区话题链接 → 走统一 anchor 处理并阻止卡片事件', async () => {
    const { wrapper, appStore } = await mountPage();
    const topicLink = wrapper.find('.history-desc a');
    expect(topicLink.exists()).toBe(true);

    await topicLink.trigger('click');
    expect(appStore.feedDetailContexts).toEqual({});
    expect(mocks.router.resolve).toHaveBeenCalled();
  });

  it('浏览历史只展示帖子，不混入用户和最近常逛记录', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.findAll('.history-item')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('测试用户');
    expect(mocks.getRecentHistory).not.toHaveBeenCalled();
  });

  it('兼容接口直接返回的 feed 实体及无 URL 的历史编号', async () => {
    const { wrapper } = await mountPage([
      { id: 'feed:88', historyType: 'feed', entityType: 'feed', title: '测试帖子', dateline: 1786022084 },
      userItem,
    ]);
    expect(wrapper.findAll('.history-item')).toHaveLength(1);
    expect(wrapper.get('.feed-time-text').text()).not.toContain('发布');
    await wrapper.find('.history-item').trigger('click');
    expect(mocks.router.push).toHaveBeenCalledWith('/feed/88');
  });

  it('历史接口字段为非字符串时仍能正常渲染', async () => {
    const nonStringItems = [
      { id: 1, title: 123, description: '', logo: '', url: '/feed/1', type: {}, entityType: {}, target_type: [], dateline: 1786022084 },
      { id: 2, title: '测试动态', description: '', logo: '', url: { path: '/feed/2' }, historyType: 'feed', type: 'feed', dateline: 1786022084 },
    ];
    const { wrapper } = await mountPage(nonStringItems);

    expect(wrapper.findAll('.history-item')).toHaveLength(2);
  });

  it('按历史接口的 dateline 将不同日期分成不同时间线', async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const historyData = [
      { ...feedItem, id: 'feed:today', dateline: Math.floor(today.getTime() / 1000) },
      { ...feedItem, id: 'feed:yesterday', url: '/feed/2', dateline: Math.floor(yesterday.getTime() / 1000) },
    ];

    const { wrapper } = await mountPage(historyData);

    expect(wrapper.findAll('.timeline-group')).toHaveLength(2);
    expect(wrapper.findAll('.date-title').map(node => node.text())).toEqual(['今天', '昨天']);
  });

  it('使用官方空 type 与完整列表游标，跳过只有用户和话题的页面后继续加载帖子', async () => {
    mocks.getHitHistory
      .mockResolvedValueOnce({ data: [{ ...userItem, id: 'user:1' }] })
      .mockResolvedValueOnce({ data: [
        { ...feedItem, id: 'feed:11', url: '/feed/11' },
        { ...userItem, id: 'topic:9', historyType: 'topic', url: '/t/测试' },
      ] })
      .mockResolvedValueOnce({ data: [{ ...feedItem, id: 'feed:12', url: '/feed/12' }] });
    const { wrapper } = await mountPage([]);
    expect(wrapper.findAll('.history-item')).toHaveLength(1);
    expect(mocks.getHitHistory).toHaveBeenNthCalledWith(1, 1, '', undefined, undefined);
    expect(mocks.getHitHistory).toHaveBeenNthCalledWith(2, 2, '', 'user:1', 'user:1');
    await wrapper.get('.page-container').trigger('scroll');
    await flushPromises();
    expect(mocks.getHitHistory).toHaveBeenNthCalledWith(3, 3, '', 'user:1', 'topic:9');
    expect(wrapper.findAll('.history-item')).toHaveLength(2);
    wrapper.unmount();
  });

  it('浏览先后决定时间线，发布时间相反也不重排帖子', async () => {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    mocks.getPublicFeedDetail.mockImplementation(async id => ({ data: {
      id, username: `作者${id}`, title: `标题${id}`,
      dateline: id === '11' ? 1600000000 : 1700000000,
    } }));
    const { wrapper } = await mountPage([
      { ...feedItem, id: 'feed:11', url: '/feed/11', dateline: now.getTime() / 1000 },
      { ...feedItem, id: 'feed:12', url: '/feed/12', dateline: yesterday.getTime() / 1000 },
    ]);
    expect(wrapper.findAll('.date-title').map(node => node.text())).toEqual(['今天', '昨天']);
    expect(wrapper.findAll('.feed-author-name').map(node => node.text())).toEqual(['作者11', '作者12']);
    const dates = wrapper.findAll('.feed-time-text').map(node => node.text());
    expect(dates[0]).toContain('发布 2020-');
    expect(dates[1]).toContain('发布 2023-');
    wrapper.unmount();
  });

  it('连续非帖子页有限加载，保留继续加载入口而不误报历史已结束', async () => {
    for (let page = 1; page <= 5; page++) {
      mocks.getHitHistory.mockResolvedValueOnce({ data: [{ ...userItem, id: `user:${page}` }] });
    }
    const { wrapper } = await mountPage([]);
    expect(mocks.getHitHistory).toHaveBeenCalledTimes(5);
    expect(wrapper.text()).toContain('继续加载帖子记录');
    expect(wrapper.text()).not.toContain('已加载全部历史记录');
    wrapper.unmount();
  });
});
