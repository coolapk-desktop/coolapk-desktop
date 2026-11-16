import { invoke, isTauri } from '@tauri-apps/api/core';
import { watch } from 'vue';
import { ensureAndroidNotificationPermission } from './desktopNotify';
import type { AppSettings } from '../types/settings';
import { showToast } from './toast';

export function setupAndroidBackgroundNotifications(settings: () => AppSettings, uid: () => string): () => void {
  if (!isTauri() || !/android/i.test(navigator.userAgent)) return () => undefined;
  let queue = Promise.resolve();
  let revision = 0;
  const synchronize = () => {
    const current = ++revision;
    queue = queue.then(async () => {
      if (current !== revision) return;
      const value = settings();
      const enabled = Boolean(value.androidBackgroundNotifications && value.desktopNotifications && uid());
      if (enabled && !(await ensureAndroidNotificationPermission())) {
        value.androidBackgroundNotifications = false;
        showToast('后台消息检查需要允许通知权限', 'info');
        return;
      }
      if (current !== revision) return;
      const likeMuteUntil = Number(value.likeNotificationMuteUntil) || 0;
      await invoke('configure_android_background_notifications', { config: {
        enabled, uid: uid(), intervalMinutes: value.notificationPollInterval,
        notifyReplies: value.notifyReplies, notifyAt: value.notifyAt, notifyPm: value.notifyPm,
        ...(likeMuteUntil !== 0 ? { likeMuteUntil } : {}),
        sound: Boolean(value.notificationSound),
      } });
    }).catch((error) => {
      settings().androidBackgroundNotifications = false;
      showToast(`后台消息检查启动失败：${String(error)}`, 'error');
    });
  };
  const stop = watch(() => {
    const value = settings();
    return [uid(), value.androidBackgroundNotifications, value.desktopNotifications, value.notificationPollInterval, value.notifyReplies, value.notifyAt, value.notifyPm, value.likeNotificationMuteUntil, value.notificationSound];
  }, synchronize, { immediate: true });
  document.addEventListener('visibilitychange', handleVisibility);
  function handleVisibility() { if (document.visibilityState === 'visible') synchronize(); }
  return () => { revision++; stop(); document.removeEventListener('visibilitychange', handleVisibility); };
}
