/**
 * 桌面端点击动态是否直接进入详情页。
 *
 * 历史版本把该开关默认关闭，桌面端点击动态只就地展开评论，与"点正文进详情"的预期不符；
 * 首次升级（无迁移标记）统一开启，并写入迁移标记，此后只尊重用户主动设置的值。
 */
export function resolveDesktopFeedDetailOnClick(value: unknown, migrationCompleted: unknown): boolean {
  if (migrationCompleted !== true) return true;
  return value === true;
}
