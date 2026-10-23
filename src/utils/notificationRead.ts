import { CoolapkTauriAPI } from '../api/coolapk';
import { useNotificationStore } from '../stores/notifications';
import type { NotificationCategory } from './notificationCount';
import { useAuthStore } from '../stores/auth';
import { showToast } from './toast';
import { logDiagnostic } from './diagnosticLogger';

const pendingReads = new Map<string, Promise<void>>();

/** 对齐 AppLinkActivity：仅使用官方链接中的已读参数，角标以 read 返回的 NotifyCount 为准。 */
export function markNotificationRead(item: any, _category: NotificationCategory, uid?: string | number, _fromPreview = false): Promise<void> {
  const store = useNotificationStore();
  const auth = useAuthStore();
  // 官方 jeb 事件即时更新当前卡片；不把卡片状态当作全局未读数的减法依据。
  item.isnew = item.isNew = item.unread_count = item.unreadCount = 0;
  try {
    const url = new URL(String(item.url || '').replace(/&amp;/g, '&'), 'https://www.coolapk.com');
    const taskId = url.searchParams.get('reportSubItemId');
    if (taskId) void CoolapkTauriAPI.reportNotificationClick(taskId).catch(error => console.warn('上报通知点击失败:', error));
    const id = url.searchParams.get('notificationV18Id')?.trim();
    const type = url.searchParams.get('notificationV18Type')?.trim();
    if (!id || !type) {
      logDiagnostic('info', 'notification', 'read_skipped', 'reason=missing_official_link_parameters');
      return Promise.resolve();
    }
    const account = String(uid ?? auth.user?.uid ?? '');
    const clearVersion = store.notificationClearVersion;
    const isCurrent = () => String(auth.user?.uid ?? '') === account && auth.isLoggedIn && clearVersion === store.notificationClearVersion;
    const key = JSON.stringify([account, clearVersion, id, type]);
    const pending = pendingReads.get(key);
    if (pending) return pending;
    store.beginNotificationClear();
    const request = (async () => {
      try {
        const response = await CoolapkTauriAPI.readNotification(id, type);
        if (!isCurrent()) return;
        const applied = store.applyNotifyCount(response);
        // 官方正常返回 NotifyCount；缺少时重新查询服务端，不做本地猜测扣减。
        if (!applied) {
          const counts = await CoolapkTauriAPI.getNotificationCount();
          if (!isCurrent()) return;
          store.applyServerResponse(counts);
        }
        logDiagnostic('info', 'notification', 'read_succeeded', `notify_count_present=${applied}`);
      } catch {
        if (!isCurrent()) return;
        logDiagnostic('warn', 'notification', 'read_failed', 'reason=request_failed');
        showToast('通知已读同步失败，请稍后重新打开这条通知重试。', 'warning');
      } finally { pendingReads.delete(key); }
    })();
    pendingReads.set(key, request);
    return request;
  } catch { return Promise.resolve(); }
}
