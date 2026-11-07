
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNotificationStore } from '../notifications';

describe('私信角标按会话实际未读数扣减（markMessagesViewed）', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('整会话未读为 2 时一次扣减 2，而不是固定 -1', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 1, message: 3, dateline: 100 } });
    expect(store.messageCount).toBe(3);
    expect(store.markMessagesViewed(2)).toBe(true);
    expect(store.messageCount).toBe(1);
    expect(store.unreadCount).toBe(2);
  });

  it('扣减数量不会把角标扣成负数，0 或非法数量不生效', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 1, message: 1, dateline: 100 } });
    expect(store.markMessagesViewed(99)).toBe(true);
    expect(store.messageCount).toBe(0);
    expect(store.markMessagesViewed(1)).toBe(false);
    expect(store.markMessagesViewed(-3)).toBe(false);
    expect(store.messageCount).toBe(0);
  });

  it('扣减计入 locallyViewedMessages：下一次服务端快照仍按已读抵消', () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 0, message: 3, dateline: 100 } });
    store.markMessagesViewed(2);
    // 服务端尚未感知本地已读，快照仍是 3，应继续用 locallyViewed 抵消 2。
    store.applyServerResponse({ data: { notification_v18: 0, message: 3, dateline: 101 } });
    expect(store.messageCount).toBe(1);
  });
});
