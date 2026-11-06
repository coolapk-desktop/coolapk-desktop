import { afterEach, describe, expect, it } from 'vitest';
import { readSearchUsersCollapsed, writeSearchUsersCollapsed } from '../searchUserGroup';

describe('综合搜索相关用户折叠状态', () => {
  afterEach(() => localStorage.clear());

  it('默认折叠，并记住用户保存的状态', () => {
    expect(readSearchUsersCollapsed()).toBe(true);
    writeSearchUsersCollapsed(true);
    expect(readSearchUsersCollapsed()).toBe(true);
    writeSearchUsersCollapsed(false);
    expect(readSearchUsersCollapsed()).toBe(false);
    expect(localStorage.getItem('coolapk-desktop-search-users-collapsed')).toBe('0');
  });

  it('存储内容异常时不抛出，按默认折叠处理', () => {
    localStorage.setItem('coolapk-desktop-search-users-collapsed', 'broken');
    expect(readSearchUsersCollapsed()).toBe(true);
  });
});
