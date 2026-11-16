export const MAX_LIKE_MUTE_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

export const LIKE_MUTE_OPTIONS = [
  { key: '0', label: '正常提醒', shortLabel: '正常', durationMs: 0 },
  { key: '1h', label: '忽略 1 小时', shortLabel: '1小时', durationMs: 60 * 60 * 1000 },
  { key: '8h', label: '忽略 8 小时', shortLabel: '8小时', durationMs: 8 * 60 * 60 * 1000 },
  { key: '1d', label: '忽略 1 天', shortLabel: '1天', durationMs: 24 * 60 * 60 * 1000 },
  { key: '3d', label: '忽略 3 天', shortLabel: '3天', durationMs: MAX_LIKE_MUTE_DURATION_MS },
] as const;

export type LikeMuteOptionKey = (typeof LIKE_MUTE_OPTIONS)[number]['key'];

/**
 * 归一化点赞通知免打扰截止时间戳：
 * - `0`：正常显示提醒
 * - `> 0`：忽略至对应毫秒时间戳（最长不超过 3 天）
 */
export function normalizeLikeNotificationMuteUntil(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return 0;
}

/** 当前是否处于忽略点赞通知提醒期间。 */
export function isLikeNotificationMuted(muteUntil: unknown, now = Date.now()): boolean {
  const normalized = normalizeLikeNotificationMuteUntil(muteUntil);
  return normalized > now;
}

/** 根据预设时长 key 计算新的截止时间戳（最多 3 天）。 */
export function resolveLikeNotificationMuteUntil(optionKey: string, now = Date.now()): number {
  const option = LIKE_MUTE_OPTIONS.find((item) => item.key === optionKey);
  if (!option || option.durationMs <= 0) return 0;
  return Math.floor(now + Math.min(option.durationMs, MAX_LIKE_MUTE_DURATION_MS));
}

/** 根据当前截止时间戳反推最接近的预设项 key，供菜单高亮。 */
export function getSelectedLikeMuteKey(muteUntil: unknown, now = Date.now()): LikeMuteOptionKey {
  const normalized = normalizeLikeNotificationMuteUntil(muteUntil);
  if (!isLikeNotificationMuted(normalized, now)) return '0';
  const remaining = normalized - now;
  const timedOptions = LIKE_MUTE_OPTIONS.filter((item) => item.durationMs > 0);
  for (const option of timedOptions) {
    if (remaining <= option.durationMs) return option.key;
  }
  return '3d';
}

/** 格式化剩余忽略时长（如「59分钟」「2小时」「3天」）。 */
export function formatLikeNotificationMuteRemaining(muteUntil: unknown, now = Date.now()): string {
  const normalized = normalizeLikeNotificationMuteUntil(muteUntil);
  if (!isLikeNotificationMuted(normalized, now)) return '';
  const remainingMs = Math.max(0, normalized - now);
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const minuteMs = 60 * 1000;
  if (remainingMs >= dayMs) {
    const days = Math.min(3, Math.round(remainingMs / dayMs));
    return `${Math.max(1, days)}天`;
  }
  if (remainingMs >= hourMs) {
    const hours = Math.round(remainingMs / hourMs);
    return `${Math.max(1, hours)}小时`;
  }
  return `${Math.max(1, Math.ceil(remainingMs / minuteMs))}分钟`;
}

/** 通知页顶栏按钮简短文案。 */
export function formatLikeNotificationMuteTriggerLabel(muteUntil: unknown, now = Date.now()): string {
  if (!isLikeNotificationMuted(muteUntil, now)) return '忽略点赞';
  return `已忽略 ${formatLikeNotificationMuteRemaining(muteUntil, now)}`;
}

/** 设置页与空状态简短说明。 */
export function formatLikeNotificationMuteDescription(muteUntil: unknown, now = Date.now()): string {
  const normalized = normalizeLikeNotificationMuteUntil(muteUntil);
  if (!isLikeNotificationMuted(normalized, now)) {
    return '可设置最多 3 天不显示点赞提醒';
  }
  return `剩余约 ${formatLikeNotificationMuteRemaining(normalized, now)}后恢复提醒`;
}

/** 识别普通通知流中属于点赞类的通知条目。 */
export function isLikeNotificationItem(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  const noteType = String(record.note_type ?? record.noteType ?? '').trim().toLowerCase();
  if (noteType === 'like' || noteType === 'feedlike' || noteType === 'feed_like') return true;
  if (record.likeUid || record.like_uid || record.likeUsername || record.likeUserInfo || record.likeTime) return true;
  const url = String(record.url ?? record.targetUrl ?? record.target_url ?? '').replace(/&amp;/g, '&');
  if (/[?&]notificationV18Type=(?:feedlike|like)\b/i.test(url)) return true;
  const note = String(record.note ?? record.message_title ?? '').trim();
  return /^赞了你的/.test(note);
}
