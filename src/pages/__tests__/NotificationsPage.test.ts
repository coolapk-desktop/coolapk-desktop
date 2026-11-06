import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, KeepAlive, ref } from 'vue';
import { routeNavigationIsHistory } from '../../utils/routeScroll';
import { createPinia, setActivePinia } from 'pinia';
import { useNotificationStore } from '../../stores/notifications';
import { useAppStore } from '../../stores/app';

const mocks = vi.hoisted(() => ({ notifications: vi.fn(), feedFullText: vi.fn(), reply: vi.fn(), likeReply: vi.fn(), unlikeReply: vi.fn(), unlikeFeed: vi.fn(), openFeed: vi.fn(), push: vi.fn(), anchor: vi.fn(), clear: vi.fn(), deleteAll: vi.fn(), confirm: vi.fn(), report: vi.fn(), read: vi.fn(), count: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: {
  getNotifications: mocks.notifications, getReplyDetail: mocks.reply, clearNotificationCount: mocks.clear, deleteAllNotifications: mocks.deleteAll, reportNotificationClick: mocks.report, readNotification: mocks.read, getNotificationCount: mocks.count,
  likeReply: mocks.likeReply, unlikeReply: mocks.unlikeReply, unlikeFeed: mocks.unlikeFeed,
} }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ isLoggedIn: true, user: { uid: 'notification-test' } }) }));
vi.mock('../../utils/confirm', () => ({ requestConfirmation: mocks.confirm }));
vi.mock('../../utils/feedFullTextCache', () => ({ loadFeedFullText: mocks.feedFullText }));
vi.mock('../../utils/feedNavigation', () => ({ openFeedDetail: mocks.openFeed }));
vi.mock('../../utils/anchorClick', () => ({ handleAnchorClick: mocks.anchor }));

import NotificationsPage from '../NotificationsPage.vue';

describe('通知评论点击入口', () => {
  it.each([false, true])('缓存通知页重新进入时，历史导航=%s 决定是否保留旧阅读位置', async historyNavigation => {
    mocks.notifications.mockResolvedValue({ data: [] });
    const shown = ref(true);
    const wrapper = mount(defineComponent({ components: { NotificationsPage, KeepAlive }, setup: () => ({ shown }), template: '<KeepAlive><NotificationsPage v-if="shown" /></KeepAlive>' }), {
      global: { stubs: { AppAvatar: true, AppImage: true, AppButton: true, LoadingState: true, ErrorState: true, EmptyState: true, FeedCommentSection: true } },
    });
    try {
      await flushPromises();
      const page = wrapper.get('.page-container').element as HTMLElement;
      page.scrollTop = 900;
      shown.value = false; await flushPromises();
      routeNavigationIsHistory.value = historyNavigation;
      shown.value = true; await flushPromises();
      expect(page.scrollTop).toBe(historyNavigation ? 900 : 0);
    } finally { wrapper.unmount(); routeNavigationIsHistory.value = false; }
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.feedFullText.mockRejectedValue(new Error('动态不可用')); localStorage.clear(); setActivePinia(createPinia()); mocks.clear.mockResolvedValue({}); mocks.report.mockResolvedValue({}); mocks.confirm.mockResolvedValue(false); mocks.read.mockResolvedValue({ data: { notifyCount: { notification_v18: 0, dateline: 101 } } }); });
  async function mountPage(item: any) {
    mocks.notifications.mockImplementation(async (_tab: string, page: number) => ({ data: page === 1 ? (Array.isArray(item) ? item : [item]) : [] }));
    const wrapper = mount(defineComponent({ components: { NotificationsPage, KeepAlive }, template: '<KeepAlive><NotificationsPage /></KeepAlive>' }), {
      global: { stubs: { AppAvatar: true, AppImage: true, AppButton: true, LoadingState: true, ErrorState: true, EmptyState: true, FeedCommentSection: true } },
    });
    await flushPromises();
    return wrapper;
  }

  it('针对通知的评论目标点赞和取消点赞，失败恢复状态', async () => {
    const wrapper = await mountPage({ id: '99', fromuid: '12345', target_type: 'feed_reply', target_id: '222', userAction: { like: 0 } });
    try {
      const button = wrapper.get('.notify-row-action[aria-pressed]');
      mocks.likeReply.mockRejectedValueOnce(new Error('网络失败'));
      await button.trigger('click');
      await flushPromises();
      expect(button.attributes('aria-pressed')).toBe('false');
      await button.trigger('click');
      await flushPromises();
      expect(mocks.likeReply).toHaveBeenLastCalledWith('222');
      expect(button.attributes('aria-pressed')).toBe('true');
      await button.trigger('click');
      await flushPromises();
      expect(mocks.unlikeReply).toHaveBeenCalledWith('222');
      expect(button.attributes('aria-pressed')).toBe('false');
      expect(mocks.openFeed).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it.each(['feed_reply', 'feed'])('直接打开 %s 通知的回复框', async type => {
    const isReply = type === 'feed_reply';
    const wrapper = await mountPage({ id: '99', fromuid: '12345', fromusername: '酷友甲', target_type: type, target_id: '222', userAction: { like: 1 } });
    try {
      if (isReply) mocks.reply.mockResolvedValueOnce({ data: { feedId: '333' } });
      if (!isReply) {
        await wrapper.get('.notify-row-action[aria-label="取消点赞"]').trigger('click');
        expect(mocks.unlikeFeed).toHaveBeenCalledWith('222');
      }
      await wrapper.get('.notify-row-action[aria-label="回复"]').trigger('click');
      await flushPromises();
      const composer = wrapper.getComponent({ name: 'FeedCommentSection' });
      expect(composer.props('feedId')).toBe(isReply ? '333' : '222');
      expect(composer.props('standaloneTarget')).toMatchObject({ rid: isReply ? '222' : undefined, username: '酷友甲' });
      expect(mocks.reply).toHaveBeenCalledTimes(isReply ? 1 : 0);
      expect(mocks.openFeed).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('点击官方 v18 通知后用服务端已读快照更新角标', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 2, feedlike: 1, message: 2, dateline: 100 } });
    const item = { id: 'row-id', feedId: '333', message: '通知内容', url: '/feed/333?notificationV18Id=9007199254740993&notificationV18Type=reply&reportSubItemId=123' };
    mocks.read.mockResolvedValue({ data: { notifyCount: { notification_v18: 1, feedlike: 1, message: 2, dateline: 101 } } });
    const wrapper = await mountPage(item);
    try {
      expect(store.notificationCount).toBe(3);
      expect(mocks.read).not.toHaveBeenCalled();
      await wrapper.get('.notify-message').trigger('click');
      await flushPromises();
      expect(mocks.read).toHaveBeenCalledWith('9007199254740993', 'reply');
      expect(mocks.report).toHaveBeenCalledWith('123');
      expect(store.notificationCount).toBe(2);
      expect(store.messageCount).toBe(2);
      // 旧列表或轮询响应不得恢复已读前的角标。
      store.applyNotifyCount({ data: [{ notifyCount: { notification_v18: 2, feedlike: 1, message: 2, dateline: 100 } }] });
      expect(store.notificationCount).toBe(2);
      expect(mocks.clear).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('未带官方已读参数时不猜测扣减总数，也不把通知自身 ID 当已读 ID', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 2, dateline: 100 } });
    const wrapper = await mountPage({ id: '123', message: '通知内容', isnew: 1 });
    try {
      await wrapper.get('.notify-message').trigger('click');
      await flushPromises();
      expect(store.notificationCount).toBe(2);
      expect(mocks.read).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('服务端已读请求失败时保留角标并允许用户重试', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 2, dateline: 100 } });
    mocks.read.mockRejectedValueOnce(new Error('网络失败'));
    const wrapper = await mountPage({ id: '123', message: '通知内容', url: '/feed/333?notificationV18Id=123&notificationV18Type=reply' });
    try {
      await wrapper.get('.notify-message').trigger('click');
      await flushPromises();
      expect(store.notificationCount).toBe(2);
      await wrapper.get('.notify-message').trigger('click');
      await flushPromises();
      expect(mocks.read).toHaveBeenCalledTimes(2);
      expect(store.notificationCount).toBe(0);
    } finally { wrapper.unmount(); }
  });

  it('普通列表按官方游标翻页，系统聚合卡片进入 noteType 子列表', async () => {
    const wrapper = await mountPage({ id: '9007199254740993', fromuid: '1', note_type: 'system', message: '系统通知' });
    try {
      expect(mocks.notifications).toHaveBeenCalledWith('list', 2, '9007199254740993', '9007199254740993', '');
      mocks.notifications.mockResolvedValue({ data: [] });
      await wrapper.get('.notify-message').trigger('click');
      await flushPromises();
      expect(mocks.notifications).toHaveBeenLastCalledWith('subList', 1, '', '', 'system');
      expect(wrapper.find('button[aria-label="返回通知中心"]').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });

  it.each(['点赞', '关注'])('打开%s首屏只清对应分类，包括空列表', async (label) => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { badge: 7, commentme: 2, feedlike: 2, contacts_follow: 1, message: 2 } });
    const wrapper = await mountPage({ id: 'unread-1', message: '评论内容', isNew: 1 });
    mocks.notifications.mockResolvedValue({ data: [] });
    try {
      await wrapper.findAll('.quick-nav-btn').find(button => button.text().includes(label))!.trigger('click');
      await flushPromises();
      expect(store.categoryCounts[label === '点赞' ? 'like' : 'follow']).toBe(0);
      expect(store.categoryCounts[label === '点赞' ? 'follow' : 'like']).toBe(label === '点赞' ? 1 : 2);
      expect(store.categoryCounts.comment).toBe(2);
      expect(store.messageCount).toBe(2);
      expect(mocks.clear).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('全部已读需确认，取消保持计数，确认后包含私信一起清除', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { badge: 4, commentme: 2, message: 2 } });
    const wrapper = await mountPage({ id: 'all-1', message: '通知内容', isNew: 1 });
    try {
      const button = wrapper.get('button[aria-label="全部已读"]');
      await button.trigger('click');
      await flushPromises();
      expect(mocks.confirm).toHaveBeenCalled();
      expect(mocks.clear).not.toHaveBeenCalled();
      expect(store.unreadCount).toBe(4);
      mocks.confirm.mockResolvedValue(true);
      await button.trigger('click');
      await flushPromises();
      expect(mocks.clear).toHaveBeenCalledWith('all');
      expect(store.unreadCount).toBe(0);
      expect(store.messageCount).toBe(0);
      expect(wrapper.find('.notify-card.unread').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('全部已读请求失败时保留全部未读状态', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { badge: 2, commentme: 1, message: 1 } });
    const wrapper = await mountPage({ id: 'fail-1', message: '通知内容', isNew: 1 });
    mocks.confirm.mockResolvedValue(true);
    mocks.clear.mockRejectedValueOnce(new Error('网络错误'));
    try {
      await wrapper.get('button[aria-label="全部已读"]').trigger('click');
      await flushPromises();
      expect(store.unreadCount).toBe(2);
      expect(store.messageCount).toBe(1);
      expect(wrapper.find('.notify-card.unread').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });

  it('全部删除需确认，成功后重载普通通知并保留其他分类计数', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 1, feedlike: 2, contacts_follow: 1, message: 3 } });
    const wrapper = await mountPage({ id: 'delete-1', message: '待删除通知' });
    try {
      const button = wrapper.get('button[aria-label="全部删除"]');
      await button.trigger('click');
      await flushPromises();
      expect(mocks.deleteAll).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('待删除通知');

      mocks.confirm.mockResolvedValue(true);
      mocks.deleteAll.mockResolvedValue({});
      mocks.count.mockResolvedValueOnce({ data: { notification_v18: 0, feedlike: 2, contacts_follow: 1, message: 3 } });
      mocks.notifications.mockResolvedValue({ data: [] });
      await button.trigger('click');
      await flushPromises();
      expect(mocks.deleteAll).toHaveBeenCalledTimes(1);
      expect(mocks.notifications).toHaveBeenLastCalledWith('list', 1, '', '', '');
      expect(wrapper.find('.notify-card').exists()).toBe(false);
      expect(store.categoryCounts).toMatchObject({ notification: 0, like: 2, follow: 1, message: 3 });
    } finally { wrapper.unmount(); }
  });

  it('点赞计数为零时不猜测扣减其他分类的总未读数', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { badge: 2, commentme: 2, feedlike: 0 } });
    const wrapper = await mountPage({ id: 'zero-like', message: '历史通知' });
    try {
      await wrapper.get('.quick-nav-btn.like').trigger('click');
      await flushPromises();
      expect(store.unreadCount).toBe(2);
      expect(store.categoryCounts.comment).toBe(2);
    } finally { wrapper.unmount(); }
  });

  it('快速切换分类时丢弃旧响应，不把点赞响应当成关注已读', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { badge: 3, feedlike: 2, contacts_follow: 1 } });
    const wrapper = await mountPage({ id: 'race-comment', message: '历史通知' });
    let resolveLike!: (value: unknown) => void;
    let resolveFollow!: (value: unknown) => void;
    mocks.notifications.mockImplementation((tab: string) => new Promise(resolve => {
      if (tab === 'feedLikeList') resolveLike = resolve;
      if (tab === 'contactsFollowList') resolveFollow = resolve;
    }));
    try {
      await wrapper.get('.quick-nav-btn.like').trigger('click');
      await wrapper.get('button[aria-label="返回通知中心"]').trigger('click');
      await wrapper.get('.quick-nav-btn.follow').trigger('click');
      resolveLike({ data: [{ id: 'old-like', message: '旧点赞响应' }] });
      await flushPromises();
      expect(store.categoryCounts.like).toBe(2);
      expect(store.categoryCounts.follow).toBe(1);
      resolveFollow({ data: [] });
      await flushPromises();
      expect(store.categoryCounts.follow).toBe(0);
      expect(store.categoryCounts.like).toBe(2);
      expect(wrapper.text()).not.toContain('旧点赞响应');
    } finally { wrapper.unmount(); }
  });

  it('点击评论正文仍能定位回复，列表不再显示查看原动态按钮', async () => {
    const item = { id: '99', target_type: 'feed_reply', target_id: '222',
      note: '评论了你的动态：<a href="/feed/333?rid=222">评论内容</a>' };
    const wrapper = await mountPage(item);
    await wrapper.get('.notify-action').trigger('click');
    await flushPromises();
    expect(mocks.openFeed).toHaveBeenLastCalledWith(expect.anything(), '333', item, '222');
    expect(wrapper.find('button[aria-label="查看原动态"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it.each(['addition_info', 'additionInfo'])('优先展示官方 %s 富文本摘要，不使用 message 中的裸分享地址', async field => {
    const url = 'https://www.coolapk.com/feed/72357393?s=share';
    const wrapper = await mountPage({ id: '99', feedId: '333', replyId: '222', note: '回复了你', message: `6 月没躲过 ${url}`,
      [field]: `6 月没躲过[doge] <a href="${url}">【动态】#微信# 稳了俩月，终究还是寄了</a>` });
    try {
      expect(wrapper.get('.notify-action').text()).toBe('回复了你');
      expect(wrapper.get('.notify-message a').text()).toBe('【动态】#微信# 稳了俩月，终究还是寄了');
      expect(wrapper.get('.notify-message').text()).not.toContain(url);
      expect(wrapper.find('.notify-message img.coolapk-emoji').exists()).toBe(true);
      expect(wrapper.get('.notify-message a').attributes('href')).toBe(url);
      await wrapper.get('.notify-message a').trigger('click'); await flushPromises();
      expect(mocks.openFeed).toHaveBeenCalledExactlyOnceWith(expect.anything(), '72357393');
      expect(mocks.reply).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it.each(['addition_info', 'additionInfo'])('官方 %s 图片附件显示缩略图并可预览，不把地址放进正文', async field => {
    const url = 'http://image.coolapk.com/feed/2026/10/14/example.png.xs.jpg';
    const wrapper = await mountPage({ id: '99', note: '这是回复内容', message: url, [field]: url });
    try {
      expect(wrapper.get('.notify-action').text()).toBe('这是回复内容');
      expect(wrapper.find('.notify-message').exists()).toBe(false);
      expect(wrapper.text()).not.toContain(url);
      await wrapper.get('.notify-image').trigger('click');
      expect(useAppStore().activeImageViewer).toMatchObject({ urls: [url], currentIndex: 0 });
      expect(mocks.openFeed).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('官方附加正文为空时仍展示已有通知内容', async () => {
    const wrapper = await mountPage({ id: '99', addition_info: ' ', message: '原有评论内容' });
    try { expect(wrapper.get('.notify-message').text()).toBe('原有评论内容'); } finally { wrapper.unmount(); }
  });

  it('通知附加正文中的实体编码链接显示动态标题并沿用链接点击处理', async () => {
    const wrapper = await mountPage({ id: '99', note: '回复了你', message: 'https://www.coolapk.com/feed/72357393', addition_info: '&lt;a href=&quot;/feed/72357393&quot;&gt;【动态】#微信# 稳了俩月&lt;/a&gt;' });
    try {
      expect(wrapper.get('.notify-message a').text()).toBe('【动态】#微信# 稳了俩月');
      expect(wrapper.get('.notify-message a').attributes('href')).toBe('/feed/72357393');
      await wrapper.get('.notify-message a').trigger('click'); await flushPromises();
      expect(mocks.openFeed).toHaveBeenCalledExactlyOnceWith(expect.anything(), '72357393');
    } finally { wrapper.unmount(); }
  });

  it('没有动态 ID 的评论通知先查询评论所属动态', async () => {
    const item = { id: '99', target_type: 'feed_reply', target_id: '222', message: '回复内容' };
    mocks.reply.mockResolvedValue({ data: { id: '222', feedId: '333' } });
    const wrapper = await mountPage(item);
    await wrapper.get('.notify-message').trigger('click');
    await flushPromises();
    expect(mocks.reply).toHaveBeenCalledWith('222');
    expect(mocks.openFeed).toHaveBeenCalledWith(expect.anything(), '333', item, '222');
    wrapper.unmount();
  });

  it('评论里的用户链接继续打开用户，不被评论定位覆盖', async () => {
    const wrapper = await mountPage({ id: '99', target_type: 'feed_reply', target_id: '222',
      message: '<a href="/u/555">@用户</a>' });
    await wrapper.get('.notify-message a').trigger('click');
    await flushPromises();
    expect(mocks.openFeed).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/user/555');
    wrapper.unmount();
  });
  it('通知正文打开所属评论，正文分享链接仅打开链接自身，人物入口独立导航', async () => {
    const item = { id: '99', fromuid: '555', fromusername: '回复者', feedId: '333', replyId: '222', message: 'https://www.coolapk.com/feed/72357393?s=share 111' };
    mocks.feedFullText.mockResolvedValueOnce('<a href="/t/topic">#抖音#</a> 有没有P版驻守的？');
    const wrapper = await mountPage(item);
    const shareLink = wrapper.get('.notify-message a');
    expect(shareLink.text()).toBe('【动态】#抖音# 有没有P版驻守的？');
    expect(wrapper.get('.notify-message').text()).toBe('【动态】#抖音# 有没有P版驻守的？ 111');
    expect(shareLink.attributes('href')).toBe('https://www.coolapk.com/feed/72357393?s=share');
    expect(mocks.feedFullText).toHaveBeenCalledWith('72357393');
    await wrapper.get('.notify-message').trigger('click'); await flushPromises();
    expect(mocks.openFeed).toHaveBeenLastCalledWith(expect.anything(), '333', item, '222');
    mocks.openFeed.mockClear();
    await wrapper.get('.notify-message a').trigger('click'); await flushPromises();
    expect(mocks.openFeed).toHaveBeenCalledExactlyOnceWith(expect.anything(), '72357393');
    await wrapper.get('.notify-avatar-wrap').trigger('click');
    await wrapper.get('.notify-user').trigger('click');
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenLastCalledWith('/user/555');
    wrapper.unmount();
  });

});
