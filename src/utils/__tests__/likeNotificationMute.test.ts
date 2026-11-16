import { describe, expect, it } from 'vitest';
import {
  formatLikeNotificationMuteDescription,
  formatLikeNotificationMuteRemaining,
  formatLikeNotificationMuteTriggerLabel,
  getSelectedLikeMuteKey,
  isLikeNotificationItem,
  isLikeNotificationMuted,
  normalizeLikeNotificationMuteUntil,
  resolveLikeNotificationMuteUntil,
} from '../likeNotificationMute';

describe('点赞通知免打扰工具函数', () => {
  it('归一化合法与非法截止时间戳', () => {
    expect(normalizeLikeNotificationMuteUntil(0)).toBe(0);
    expect(normalizeLikeNotificationMuteUntil(-1)).toBe(0);
    expect(normalizeLikeNotificationMuteUntil(-100)).toBe(0);
    expect(normalizeLikeNotificationMuteUntil(1700000000123.9)).toBe(1700000000123);
    expect(normalizeLikeNotificationMuteUntil('invalid')).toBe(0);
    expect(normalizeLikeNotificationMuteUntil(NaN)).toBe(0);
  });

  it('按预设时长计算截止时间戳（最多 3 天）并生成简短文案', () => {
    const now = 1_000_000;
    expect(formatLikeNotificationMuteTriggerLabel(0, now)).toBe('忽略点赞');

    const oneHourUntil = resolveLikeNotificationMuteUntil('1h', now);
    expect(oneHourUntil).toBe(now + 60 * 60 * 1000);
    expect(isLikeNotificationMuted(oneHourUntil, now)).toBe(true);
    expect(isLikeNotificationMuted(oneHourUntil, oneHourUntil)).toBe(false);
    expect(getSelectedLikeMuteKey(oneHourUntil, now + 10_000)).toBe('1h');
    expect(formatLikeNotificationMuteRemaining(oneHourUntil, now)).toBe('1小时');
    expect(formatLikeNotificationMuteTriggerLabel(oneHourUntil, now)).toBe('已忽略 1小时');
    expect(formatLikeNotificationMuteDescription(oneHourUntil, now)).toContain('1小时后恢复');

    const oneDayUntil = resolveLikeNotificationMuteUntil('1d', now);
    expect(getSelectedLikeMuteKey(oneDayUntil, now + 60_000)).toBe('1d');
    expect(formatLikeNotificationMuteRemaining(oneDayUntil, now)).toBe('1天');
    expect(formatLikeNotificationMuteTriggerLabel(oneDayUntil, now)).toBe('已忽略 1天');

    const threeDayUntil = resolveLikeNotificationMuteUntil('3d', now);
    expect(getSelectedLikeMuteKey(threeDayUntil, now + 60_000)).toBe('3d');
    expect(formatLikeNotificationMuteRemaining(threeDayUntil, now)).toBe('3天');
    expect(formatLikeNotificationMuteTriggerLabel(threeDayUntil, now)).toBe('已忽略 3天');
  });

  it('准确识别普通通知流中的点赞通知条目', () => {
    expect(isLikeNotificationItem({ id: '1', url: '/feed/123?notificationV18Id=1&notificationV18Type=feedlike' })).toBe(true);
    expect(isLikeNotificationItem({ id: '2', note: '赞了你的评论' })).toBe(true);
    expect(isLikeNotificationItem({ id: '3', likeUid: '10086' })).toBe(true);
    expect(isLikeNotificationItem({ id: '4', note: '回复了你的评论', url: '/feed/123?notificationV18Id=4&notificationV18Type=reply' })).toBe(false);
  });
});
