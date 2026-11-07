import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNotificationStore } from '../notifications';

function seedMessage(store: ReturnType<typeof useNotificationStore>, count: number, dateline = 100) {
  store.applyServerResponse({ data: { notification_v18: 1, message: count, dateline } });
}

describe('私信角标按会话键幂等抵消（suppressMessageCounts）', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('连续两轮轮询（同一服务端数据）只扣减一次', () => {
    const store = useNotificationStore();
    seedMessage(store, 5);
    const items = [{ key: 'k1', count: 2 }, { key: 'k2', count: 1 }];
    expect(store.suppressMessageCounts(items)).toBe(3);
    expect(store.messageCount).toBe(2);
    // 第二轮轮询：同一份服务端数据，不得再扣。
    expect(store.suppressMessageCounts(items)).toBe(0);
    expect(store.messageCount).toBe(2);
  });

  it('该会话 unread 从 1 变 3 后允许再扣差值 2', () => {
    const store = useNotificationStore();
    seedMessage(store, 5);
    expect(store.suppressMessageCounts([{ key: 'k1', count: 1 }])).toBe(1);
    expect(store.messageCount).toBe(4);
    // 新一轮轮询该会话未读涨到 3：补扣差值 2。
    expect(store.suppressMessageCounts([{ key: 'k1', count: 3 }])).toBe(2);
    expect(store.messageCount).toBe(2);
  });

  it('不同会话各自独立扣减，互不影响水位', () => {
    const store = useNotificationStore();
    seedMessage(store, 5);
    expect(store.suppressMessageCounts([{ key: 'k1', count: 1 }])).toBe(1);
    expect(store.suppressMessageCounts([{ key: 'k2', count: 2 }])).toBe(2);
    expect(store.messageCount).toBe(2);
    // k1 的水位不影响 k2 的重复轮询。
    expect(store.suppressMessageCounts([{ key: 'k1', count: 1 }, { key: 'k2', count: 2 }])).toBe(0);
    expect(store.messageCount).toBe(2);
  });

  it('会话未读回落时下调水位，再次出现新未读可重新抵消', () => {
    const store = useNotificationStore();
    seedMessage(store, 5);
    expect(store.suppressMessageCounts([{ key: 'k1', count: 2 }])).toBe(2);
    // 服务端已读后未读回落到 0，再出现 1 条新的自己发送未读：允许抵消。
    expect(store.suppressMessageCounts([{ key: 'k1', count: 0 }])).toBe(0);
    expect(store.suppressMessageCounts([{ key: 'k1', count: 1 }])).toBe(1);
    expect(store.messageCount).toBe(2);
  });

  it('reset（账号切换/注销）清理水位，同键未读重新允许抵消', () => {
    const store = useNotificationStore();
    seedMessage(store, 5);
    expect(store.suppressMessageCounts([{ key: 'k1', count: 2 }])).toBe(2);
    store.reset();
    seedMessage(store, 3, 200);
    expect(store.suppressMessageCounts([{ key: 'k1', count: 2 }])).toBe(2);
    expect(store.messageCount).toBe(1);
  });
});
