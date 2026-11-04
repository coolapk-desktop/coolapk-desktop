import type { NotificationCategory } from './notificationCount';

export interface NotificationActor {
  username: string;
  avatar: string;
}

/** 官方 NotificationRightInfo 仅将独立的酷安图片地址作为右侧缩略图。 */
export function getNotificationImage(item: any): string {
  const value = item?.addition_info || item?.additionInfo;
  if (typeof value !== 'string') return '';
  const text = value.trim();
  try {
    const url = new URL(text);
    return /^https?:$/.test(url.protocol) && url.hostname === 'image.coolapk.com' && !/\s/.test(text) ? text : '';
  } catch { return ''; }
}

/**
 * 点赞通知同时包含动态作者和点赞人，必须优先显示 like 字段，避免把自己显示成点赞人。
 */
export function getNotificationActor(
  item: any,
  category: NotificationCategory
): NotificationActor {
  if (category === 'like') {
    return {
      username: item?.likeUsername || item?.likeUserInfo?.username || '酷友',
      avatar: item?.likeAvatar || item?.likeUserInfo?.userAvatar || '',
    };
  }
  return {
    username: item?.fromusername
      || item?.fromUserInfo?.username
      || item?.username
      || item?.userInfo?.username
      || item?.title
      || '酷友',
    avatar: item?.fromUserAvatar
      || item?.fromUserInfo?.userAvatar
      || item?.userAvatar
      || item?.userInfo?.userAvatar
      || item?.pic
      || '',
  };
}
