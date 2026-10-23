import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNotificationStore } from '../notifications';

describe('官方通知状态', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('普通通知和点赞组成通知角标，关注独立显示且私信单独计数', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 2, feedlike: 3, contacts_follow: 4, message: 1, badge_v18: 99, dateline: 100 } });
    expect(store.notificationCount).toBe(5);
    expect(store.unreadCount).toBe(6);
    expect(store.categoryCounts.follow).toBe(4);
    expect(store.messageCount).toBe(1);
  });

  it('官方 all 包含私信，清除后新通知正常计入', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ notification_v18: 2, feedlike: 1, message: 2, dateline: 100 });
    store.markNotificationsCleared(true);
    expect(store.unreadCount).toBe(0);
    expect(Object.values(store.categoryCounts).every(count => count === 0)).toBe(true);
    store.applyServerResponse({ notification_v18: 1, message: 1, dateline: 101 });
    expect(store.notificationCount).toBe(1);
    expect(store.messageCount).toBe(1);
  });

  it('按服务端时间戳拒绝旧快照和旧版响应，列表只采用第一份 NotifyCount', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ notification_v18: 4, dateline: 100 });
    store.applyNotifyCount({ data: [{ notifyCount: { notification_v18: 1, dateline: 102 } }, { notifyCount: { notification_v18: 20, dateline: 103 } }] });
    expect(store.notificationCount).toBe(1);
    store.applyServerResponse({ notification_v18: 4, dateline: 101 });
    store.applyServerResponse({ badge_v18: 20 });
    expect(store.notificationCount).toBe(1);
    // 官方使用小于判断，同一时间戳的后到快照仍有效。
    store.applyServerResponse({ notification_v18: 2, dateline: 102 });
    expect(store.notificationCount).toBe(2);
  });

  it('点赞关注首屏只更新内存，不抵消下一份服务端快照的新通知', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ notification_v18: 2, feedlike: 1, contacts_follow: 3, dateline: 100 });
    expect(store.markCategoryViewed('like')).toBe(1);
    expect(store.notificationCount).toBe(2);
    expect(store.markCategoryViewed('follow')).toBe(3);
    expect(store.notificationCount).toBe(2);
    store.applyNotifyCount({ data: { notifyCount: { notification_v18: 1, feedlike: 2, dateline: 101 } } });
    expect(store.notificationCount).toBe(3);
    expect(store.markViewed('notification')).toBe(false);
    expect(store.markCategoryViewed('notification')).toBe(0);
    expect(store.notificationCount).toBe(3);
  });

  it('私信会话已读保持独立，不能扣除普通通知', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ notification_v18: 2, message: 2, dateline: 100 });
    expect(store.markViewed('message')).toBe(true);
    expect(store.notificationCount).toBe(2);
    expect(store.messageCount).toBe(1);
    store.applyServerResponse({ notification_v18: 2, message: 2, dateline: 101 });
    expect(store.messageCount).toBe(1);
    store.applyServerResponse({ notification_v18: 2, message: 1, dateline: 102 });
    expect(store.messageCount).toBe(1);
    expect(store.notificationCount).toBe(2);
  });

  it('自己发送的私信校正只限私信余额，不影响通知或后续新的消息', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ notification_v18: 1, message: 1, dateline: 100 });
    expect(store.suppressMessageCount(10)).toBe(1);
    expect(store.messageCount).toBe(0);
    expect(store.notificationCount).toBe(1);
    store.applyServerResponse({ notification_v18: 1, message: 0, dateline: 101 });
    store.applyServerResponse({ notification_v18: 1, message: 1, dateline: 102 });
    expect(store.messageCount).toBe(1);
  });

  it('账号重置后清除旧时间戳、计数和私信抵消', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ notification_v18: 1, message: 2, dateline: 100 });
    store.markViewed('message');
    const version = store.notificationStateVersion;
    store.reset();
    expect(store.notificationStateVersion).toBeGreaterThan(version);
    expect(store.unreadCount).toBe(0);
    const applied = store.applyServerResponse({ notification_v18: 4, message: 2, dateline: 1 });
    expect(applied.previous).toBeNull();
    expect(store.notificationCount).toBe(4);
    expect(store.messageCount).toBe(2);
  });
});
