import { describe, expect, it } from 'vitest';
import { resolveDesktopFeedDetailOnClick } from '../desktopFeedDetailPreference';

describe('点击动态进入详情页的默认值与迁移', () => {
  it('首次升级统一开启，不受旧版本写入的关闭状态影响', () => {
    expect(resolveDesktopFeedDetailOnClick(undefined, undefined)).toBe(true);
    expect(resolveDesktopFeedDetailOnClick(false, undefined)).toBe(true);
    expect(resolveDesktopFeedDetailOnClick(true, false)).toBe(true);
  });

  it('迁移完成后只尊重用户主动设置的值', () => {
    expect(resolveDesktopFeedDetailOnClick(true, true)).toBe(true);
    expect(resolveDesktopFeedDetailOnClick(false, true)).toBe(false);
    expect(resolveDesktopFeedDetailOnClick('yes', true)).toBe(false);
    expect(resolveDesktopFeedDetailOnClick(undefined, true)).toBe(false);
  });
});
