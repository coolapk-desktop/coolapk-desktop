import { CoolapkTauriAPI } from '../api/coolapk';
import { useNotificationStore } from '../stores/notifications';
import type { NotificationCategory } from './notificationCount';
import { countSeenNotificationItems, markNotificationItemsSeen, addSeenNotificationCount } from './notificationSeen';

/** 普通通知按条确认；复用已读记录，避免返回列表后重复扣减其他通知。 */
export function markNotificationRead(item: any, category: NotificationCategory, uid?: string | number, fromPreview = false): void {
  const count = Math.max(0, Math.floor(Number(item?.unread_count ?? item?.unreadCount) || 0));
  const isNew = Number(item?.isnew ?? item?.isNew ?? 0) > 0;
  const seen = uid ? countSeenNotificationItems(uid, category, [item]) > 0 : false;
  if (!seen && (count > 0 || isNew || fromPreview)) {
    const store = useNotificationStore();
    // 聚合通知可能包含多条未读，只扣除本条对应数量。
    let viewed = 0;
    const available = store.categoryCounts[category] || store.notificationCount;
    for (let index = 0; index < Math.min(count || 1, available); index += 1) {
      if (store.markViewed(category)) viewed += 1;
    }
    if (uid) {
      markNotificationItemsSeen(uid, category, [item], 1);
      if (category === 'like' && viewed > 0) addSeenNotificationCount(uid, category, viewed);
    }
  }
  item.isnew = item.isNew = item.unread_count = item.unreadCount = 0;
  // APK 仅在链接带 reportSubItemId 时上报点击，不能用全部清除代替单条已读。
  try {
    const taskId = new URL(String(item.url || ''), 'https://www.coolapk.com').searchParams.get('reportSubItemId');
    if (taskId) void CoolapkTauriAPI.reportNotificationClick(taskId).catch(error => console.warn('上报通知点击失败:', error));
  } catch { /* 无效链接不影响本地已读与正常导航。 */ }
}
