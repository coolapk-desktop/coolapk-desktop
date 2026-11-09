import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { normalizeNotificationCounts, reconcileViewedCount, type NotificationCategory } from '../utils/notificationCount';

const CATEGORY_NAMES: NotificationCategory[] = ['notification', 'comment', 'atMe', 'atComment', 'like', 'follow', 'message'];
function createCategoryCounts(): Record<NotificationCategory, number> {
  return { notification: 0, comment: 0, atMe: 0, atComment: 0, like: 0, follow: 0, message: 0 };
}

/** 通知采用官方完整快照；本地抵消仅保留给私信现有的会话已读流程。 */
export const useNotificationStore = defineStore('notifications', () => {
  const unreadCount = ref(0);
  const categoryCounts = reactive(createCategoryCounts());
  const notificationStateVersion = ref(0);
  const notificationClearVersion = ref(0);
  const notificationCount = computed(() => Math.max(0, unreadCount.value - categoryCounts.message));
  const messageCount = computed(() => categoryCounts.message);
  let serverTotal: number | null = null;
  let serverMessageCount: number | null = null;
  let locallyViewedMessages = 0;
  let notifyCountDateline = 0;
  let officialCounts = false;

  function applyServerResponse(response: unknown): { previous: number | null; count: number; increasedCategories: NotificationCategory[] } {
    const snapshot = normalizeNotificationCounts(response);
    const payload: any = (response as any)?.data ?? response;
    const dateline = Number(payload?.dateline) || 0;
    const previous = serverTotal === null ? null : unreadCount.value;
    // 对齐 AppNotification.update：旧时间戳快照不得覆盖新快照，旧版响应也不得覆盖 v18 状态。
    if ((officialCounts && !snapshot.categoryPresence.notification) || dateline < notifyCountDateline) return { previous, count: unreadCount.value, increasedCategories: [] };
    officialCounts ||= snapshot.categoryPresence.notification;
    notifyCountDateline = Math.max(notifyCountDateline, dateline);
    const oldCounts = { ...categoryCounts };
    const messages = reconcileViewedCount(serverMessageCount, snapshot.categories.message, locallyViewedMessages);
    locallyViewedMessages = messages.locallyViewedCount;
    serverMessageCount = snapshot.categories.message;
    for (const category of CATEGORY_NAMES) categoryCounts[category] = snapshot.categories[category];
    categoryCounts.message = messages.count;
    serverTotal = snapshot.total;
    unreadCount.value = Math.max(0, snapshot.total - locallyViewedMessages);
    return { previous, count: unreadCount.value, increasedCategories: previous === null ? [] : CATEGORY_NAMES.filter(category => categoryCounts[category] > oldCounts[category]) };
  }

  /** 官方使用第一份 NotifyCount，不按字段取最大值或从列表条数猜测未读。 */
  function applyNotifyCount(response: any): boolean {
    const data = response?.data ?? response;
    const rows = Array.isArray(data) ? data : [data];
    const count = rows.map(row => row?.notifyCount ?? row?.notify_count).find(value => value && typeof value === 'object');
    if (!count) return false;
    applyServerResponse(count);
    return true;
  }

  /** 仅供现有私信会话已读流程调用；站内通知必须经过服务端 v18/read。 */
  function markViewed(category: NotificationCategory): boolean {
    if (category !== 'message' || categoryCounts.message <= 0) return false;
    categoryCounts.message -= 1;
    locallyViewedMessages += 1;
    unreadCount.value = Math.max(0, unreadCount.value - 1);
    return true;
  }

  /**
   * 整会话置读时按实际未读数扣减：一个会话可能有 >1 条未读，旧 markViewed 固定 -1 会少扣。
   * readMessage 响应不一定带完整 NotifyCount（旧快照守卫也可能拒绝合并），所以本地扣减是必要兜底。
   */
  function markMessagesViewed(count: number): boolean {
    const parsed = Number(count);
    const viewed = Number.isFinite(parsed) ? Math.min(Math.max(0, Math.floor(parsed)), categoryCounts.message) : 0;
    if (viewed <= 0) return false;
    categoryCounts.message -= viewed;
    locallyViewedMessages += viewed;
    unreadCount.value = Math.max(0, unreadCount.value - viewed);
    return true;
  }

  /** 官方点赞/关注首屏成功后只清除对应内存计数，不保存跨启动抵消。 */
  function markCategoryViewed(category: NotificationCategory): number {
    if (!['like', 'follow', 'message'].includes(category)) return 0;
    const count = categoryCounts[category];
    categoryCounts[category] = 0;
    if (category === 'message') locallyViewedMessages += count;
    // 官方总数不包含独立关注数，清关注不能降低通知或私信角标。
    if (category !== 'follow') unreadCount.value = Math.max(0, unreadCount.value - count);
    return count;
  }

  // 按会话键记录已被抵消的自己发送未读水位，保证轮询重复刷新时只抵消一次。
  const suppressedSelfUnread = new Map<string, number>();

  /**
   * 按会话键幂等抵消自己发出的未读：同一会话在同一未读水位只扣一次，
   * 该会话未读数值增加时才再扣差值；会话未读回落时同步下调水位。
   * 仅校正会话列表已明确识别为自己发送的条目，不能用于站内通知。
   */
  function suppressMessageCounts(items: ReadonlyArray<{ key: string; count: number }>): number {
    let suppressed = 0;
    for (const item of items) {
      const key = String(item?.key || '').trim();
      if (!key) continue;
      const parsed = Number(item?.count);
      if (!Number.isFinite(parsed)) continue;
      const count = Math.max(0, Math.floor(parsed));
      const previous = suppressedSelfUnread.get(key) || 0;
      if (count <= previous) { suppressedSelfUnread.set(key, count); continue; }
      const delta = Math.min(count - previous, categoryCounts.message);
      suppressedSelfUnread.set(key, count);
      if (delta <= 0) continue;
      categoryCounts.message -= delta;
      locallyViewedMessages += delta;
      unreadCount.value = Math.max(0, unreadCount.value - delta);
      suppressed += delta;
    }
    return suppressed;
  }

  /** 旧的单值接口：无会话键，调用方应优先使用 suppressMessageCounts。 */
  function suppressMessageCount(count: number): number {
    const parsed = Number(count);
    const suppressed = Number.isFinite(parsed) ? Math.min(Math.max(0, Math.floor(parsed)), categoryCounts.message) : 0;
    categoryCounts.message -= suppressed;
    locallyViewedMessages += suppressed;
    unreadCount.value = Math.max(0, unreadCount.value - suppressed);
    return suppressed;
  }

  function beginNotificationClear(): void { notificationStateVersion.value += 1; }

  /** 仅在服务端全部已读请求成功后调用；官方 all 包含私信。 */
  function markNotificationsCleared(includeMessages = false): void {
    if (includeMessages) suppressedSelfUnread.clear();
    notificationClearVersion.value += 1;
    beginNotificationClear();
    const remainingMessages = includeMessages ? 0 : categoryCounts.message;
    for (const category of CATEGORY_NAMES) categoryCounts[category] = 0;
    categoryCounts.message = remainingMessages;
    unreadCount.value = remainingMessages;
    serverTotal = remainingMessages;
    serverMessageCount = remainingMessages;
    locallyViewedMessages = 0;
  }

  function reset(): void {
    suppressedSelfUnread.clear();
    notificationClearVersion.value += 1;
    beginNotificationClear();
    unreadCount.value = 0;
    for (const category of CATEGORY_NAMES) categoryCounts[category] = 0;
    serverTotal = serverMessageCount = null;
    locallyViewedMessages = notifyCountDateline = 0;
    officialCounts = false;
  }

  return { unreadCount, categoryCounts, notificationCount, messageCount, notificationStateVersion, notificationClearVersion, applyServerResponse, applyNotifyCount,
    markViewed, markMessagesViewed, markCategoryViewed, suppressMessageCount, suppressMessageCounts, beginNotificationClear, markNotificationsCleared, reset };
});
