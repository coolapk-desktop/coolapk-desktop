import { CoolapkTauriAPI } from '../api/coolapk';
import { getNotificationActor } from './notificationItem';
import { getNotificationFeedId } from './notificationNavigation';
import { getMessageSenderUid, isMessageSentByCurrentUser } from './messageUnread';
import type { DesktopNotifyOptions } from './desktopNotify';
import type { NotificationCategory } from './notificationCount';

/** Read only: do not mark notifications read until the user opens their destination. */
export async function androidNotificationContent(categories: NotificationCategory[], uid: string, total: number): Promise<DesktopNotifyOptions> {
  const category = categories[0] || 'comment';
  const fallback = { title: '酷安新通知', body: `你有 ${total} 条未读通知，点击查看详情。`, category,
    route: category === 'message' ? '/messages' : '/notifications' };
  const types: Record<string, string> = { notification: 'list', comment: 'list', atMe: 'list', atComment: 'list', like: 'feedLikeList', follow: 'contactsFollowList' };
  if (!categories.length) return fallback;
  try {
    const response = category === 'message' ? await CoolapkTauriAPI.listMessages(1)
      : await CoolapkTauriAPI.getNotifications(types[category] || 'list', 1);
    const items = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
    const item = items.find((entry: any) => category !== 'message' || !isMessageSentByCurrentUser(entry, uid));
    if (!item) return fallback;
    const actor = getNotificationActor(item, category);
    const feedId = getNotificationFeedId(item);
    const partner = String(item.messageUid || getMessageSenderUid(item) || '');
    return { ...fallback, title: actor.username,
      body: String(item.note || item.message || item.lastMessage || fallback.body), avatar: actor.avatar,
      route: category === 'message' && /^\d+$/.test(partner) ? `/messages?uid=${partner}`
        : feedId ? `/feed/${feedId}` : fallback.route };
  } catch { return fallback; }
}
