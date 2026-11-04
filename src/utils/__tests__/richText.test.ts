import { describe, it, expect } from 'vitest';
import { renderCoolapkRichText, renderNotificationRichText } from '../richText';

describe('renderCoolapkRichText', () => {
  it('渲染表情代码并保留站内链接', () => {
    const input =
      '懂了，厂商可以远程云控[受虐滑稽][受虐滑稽]' +
      '<a href="/feed/72852407?rid=1&amp;pRid=2">查看详情</a>';
    const html = renderCoolapkRichText(input);
    expect(html).toContain('coolapk_emotion_64_shounuehuaji.png');
    expect(html).toContain('<a href="/feed/72852407?rid=1&amp;pRid=2"');
    expect(html.match(/coolapk_emotion_64_shounuehuaji\.png/g)).toHaveLength(2);
  });

  it('不渲染未知标签内容', () => {
    const html = renderCoolapkRichText('<script>alert(1)</script>[doge]');
    expect(html).not.toContain('alert');
    expect(html).toContain('doge.png');
  });

  it('空输入返回空字符串', () => {
    expect(renderCoolapkRichText('')).toBe('');
  });
});

// 覆盖用户截图中的纯文本分享地址，并确认已有链接不会嵌套或恢复危险标签。
it('通知按官方规则还原实体编码的动态标题链接，并过滤解码后的危险内容', () => {
  const html = renderNotificationRichText('回复[doge] &lt;a href=&quot;/feed/72357393?s=share&amp;amp;x=1&quot;&gt;【动态】#微信# 稳了俩月&lt;/a&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;a href=&quot;javascript:alert(2)&quot;&gt;危险链接&lt;/a&gt;');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelectorAll('a')).toHaveLength(1);
  expect(doc.querySelector('a')?.textContent).toBe('【动态】#微信# 稳了俩月');
  expect(doc.querySelector('a')?.getAttribute('href')).toBe('/feed/72357393?s=share&x=1');
  expect(html).not.toContain('alert');
  expect(html).toContain('doge.png');
});

it('通知纯文本 URL 转为独立链接并保留安全化和表情', () => {
  const html = renderNotificationRichText('6 月没躲过[doge] https://www.coolapk.com/feed/72357393?s=abc&x=1 <a href="/u/555">用户</a><script>alert(1)</script>');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelectorAll('a')).toHaveLength(2);
  expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://www.coolapk.com/feed/72357393?s=abc&x=1');
  expect(doc.querySelector('a a')).toBeNull();
  expect(html).not.toContain('alert');
  expect(html).toContain('doge.png');
});
