import { describe, expect, it } from 'vitest';
import { getNotificationActor, getNotificationImage } from '../notificationItem';

it('仅将完整的官方图片地址识别为附件，富文本和普通链接仍走正文', () => {
  expect(getNotificationImage({ addition_info: ' http://image.coolapk.com/feed/a.png.xs.jpg ' })).toBe('http://image.coolapk.com/feed/a.png.xs.jpg');
  for (const value of ['https://www.coolapk.com/feed/123', '<a href="https://www.coolapk.com/feed/123">动态标题</a>', 'https://image.coolapk.com.evil.test/a.jpg', 'javascript:alert(1)', 'https://image.coolapk.com/a.jpg 其他文字']) {
    expect(getNotificationImage({ addition_info: value })).toBe('');
  }
});

describe('通知人物信息', () => {
  it('收到赞时显示点赞人，不显示动态作者本人', () => {
    const item = {
      username: '动态作者本人',
      userAvatar: 'self.png',
      likeUsername: '点赞的酷友',
      likeAvatar: 'liker.png',
    };

    expect(getNotificationActor(item, 'like')).toEqual({
      username: '点赞的酷友',
      avatar: 'liker.png',
    });
  });
});
