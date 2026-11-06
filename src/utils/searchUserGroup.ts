/** 综合搜索里“相关用户”分组的折叠状态，记住用户选择并跨会话保持。 */
const STORAGE_KEY = 'coolapk-desktop-search-users-collapsed';

export function readSearchUsersCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // 浏览器存储不可用时按默认展开处理，不影响搜索。
    return false;
  }
}

export function writeSearchUsersCollapsed(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // 忽略存储失败，仅本次会话内生效。
  }
}
