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

  /** 仅校正会话列表已明确识别的自己发出的私信，不能用于站内通知。 */
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
    notificationClearVersion.value += 1;
    beginNotificationClear();
    unreadCount.value = 0;
    for (const category of CATEGORY_NAMES) categoryCounts[category] = 0;
    serverTotal = serverMessageCount = null;
    locallyViewedMessages = notifyCountDateline = 0;
    officialCounts = false;
  }

  return { unreadCount, categoryCounts, notificationCount, messageCount, notificationStateVersion, notificationClearVersion, applyServerResponse, applyNotifyCount,
    markViewed, markCategoryViewed, suppressMessageCount, beginNotificationClear, markNotificationsCleared, reset };
});
