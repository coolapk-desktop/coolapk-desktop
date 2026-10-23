import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, KeepAlive } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useNotificationStore } from '../../stores/notifications';

const mocks = vi.hoisted(() => ({ notifications: vi.fn(), reply: vi.fn(), openFeed: vi.fn(), push: vi.fn(), anchor: vi.fn(), clear: vi.fn(), confirm: vi.fn(), report: vi.fn(), read: vi.fn(), count: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: {
  getNotifications: mocks.notifications, getReplyDetail: mocks.reply, clearNotificationCount: mocks.clear, reportNotificationClick: mocks.report, readNotification: mocks.read, getNotificationCount: mocks.count,
} }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ isLoggedIn: true, user: { uid: 'notification-test' } }) }));
vi.mock('../../utils/confirm', () => ({ requestConfirmation: mocks.confirm }));
vi.mock('../../utils/feedNavigation', () => ({ openFeedDetail: mocks.openFeed }));
vi.mock('../../utils/anchorClick', () => ({ handleAnchorClick: mocks.anchor }));
vi.mock('../../utils/richText', () => ({ renderCoolapkRichText: (text: string) => text }));
import NotificationsPage from '../NotificationsPage.vue';

describe('通知评论点击入口', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); setActivePinia(createPinia()); mocks.clear.mockResolvedValue({}); mocks.report.mockResolvedValue({}); mocks.confirm.mockResolvedValue(false); mocks.read.mockResolvedValue({ data: { notifyCount: { notification_v18: 0, dateline: 101 } } }); });
  async function mountPage(item: any) {
    mocks.notifications.mockImplementation(async (_tab: string, page: number) => ({ data: page === 1 ? (Array.isArray(item) ? item : [item]) : [] }));
    const wrapper = mount(defineComponent({ components: { NotificationsPage, KeepAlive }, template: '<KeepAlive><NotificationsPage /></KeepAlive>' }), {
      global: { stubs: { AppAvatar: true, AppButton: true, LoadingState: true, ErrorState: true, EmptyState: true } },
    });
    await flushPromises();
    return wrapper;
  }

  it.each(['.notify-message', '.original-feed-preview'])('官方 v18 通知点击 %s 后用服务端已读快照更新角标', async selector => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 2, feedlike: 1, message: 2, dateline: 100 } });
    const item = { id: 'row-id', feedId: '333', message: '通知内容', url: '/feed/333?notificationV18Id=9007199254740993&notificationV18Type=reply&reportSubItemId=123' };
    mocks.read.mockResolvedValue({ data: { notifyCount: { notification_v18: 1, feedlike: 1, message: 2, dateline: 101 } } });
    const wrapper = await mountPage(item);
    try {
      expect(store.notificationCount).toBe(3);
      expect(mocks.read).not.toHaveBeenCalled();
      await wrapper.get(selector).trigger('click');
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
      expect(wrapper.text()).toContain('返回通知列表');
    } finally { wrapper.unmount(); }
  });

  it.each(['收到的赞', '新关注'])('打开%s首屏只清对应分类，包括空列表', async (label) => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { badge: 7, commentme: 2, feedlike: 2, contacts_follow: 1, message: 2 } });
    const wrapper = await mountPage({ id: 'unread-1', message: '评论内容', isNew: 1 });
    mocks.notifications.mockResolvedValue({ data: [] });
    try {
      await wrapper.findAll('.tab-btn').find(button => button.text().includes(label))!.trigger('click');
      await flushPromises();
      expect(store.categoryCounts[label === '收到的赞' ? 'like' : 'follow']).toBe(0);
      expect(store.categoryCounts[label === '收到的赞' ? 'follow' : 'like']).toBe(label === '收到的赞' ? 1 : 2);
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
      const button = wrapper.findAll('.header-action-btn')[1];
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
      await wrapper.findAll('.header-action-btn')[1].trigger('click');
      await flushPromises();
      expect(store.unreadCount).toBe(2);
      expect(store.messageCount).toBe(1);
      expect(wrapper.find('.notify-card.unread').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });

  it('点赞计数为零时不猜测扣减其他分类的总未读数', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { badge: 2, commentme: 2, feedlike: 0 } });
    const wrapper = await mountPage({ id: 'zero-like', message: '历史通知' });
    try {
      await wrapper.findAll('.tab-btn')[1].trigger('click');
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
      await wrapper.findAll('.tab-btn')[1].trigger('click');
      await wrapper.findAll('.tab-btn')[2].trigger('click');
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

  it('评论正文携带目标回复，查看原动态单独打开完整动态', async () => {
    const item = { id: '99', target_type: 'feed_reply', target_id: '222',
      note: '评论了你的动态：<a href="/feed/333?rid=222">评论内容</a>' };
    const wrapper = await mountPage(item);
    await wrapper.get('.notify-action a').trigger('click');
    await flushPromises();
    expect(mocks.openFeed).toHaveBeenLastCalledWith(expect.anything(), '333', item, '222');
    await wrapper.get('.original-feed-preview').trigger('click');
    expect(mocks.openFeed).toHaveBeenLastCalledWith(expect.anything(), '333', item);
    wrapper.unmount();
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
});
