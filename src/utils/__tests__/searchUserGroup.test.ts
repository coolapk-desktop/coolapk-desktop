import { afterEach, describe, expect, it } from 'vitest';
import { readSearchUsersCollapsed, writeSearchUsersCollapsed } from '../searchUserGroup';

describe('综合搜索相关用户折叠状态', () => {
  afterEach(() => localStorage.clear());

  it('默认展开，写入后读取到收起状态', () => {
    expect(readSearchUsersCollapsed()).toBe(false);
    writeSearchUsersCollapsed(true);
    expect(readSearchUsersCollapsed()).toBe(true);
    writeSearchUsersCollapsed(false);
    expect(readSearchUsersCollapsed()).toBe(false);
    expect(localStorage.getItem('coolapk-desktop-search-users-collapsed')).toBe('0');
  });

  it('存储内容异常时不抛出，按展开处理', () => {
    localStorage.setItem('coolapk-desktop-search-users-collapsed', 'broken');
    expect(readSearchUsersCollapsed()).toBe(false);
  });
});
