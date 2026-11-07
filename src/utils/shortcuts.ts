import { onMounted, ref } from 'vue';
import { getPlatformInfo } from './platform';

const platformOs = ref<string>('windows');

export function formatShortcut(shortcut: string, os: string, macShortcut?: string): string {
  if (os !== 'macos') return shortcut;
  return (macShortcut ?? shortcut)
    .replace(/Control/gi, '⌃')
    .replace(/Ctrl/gi, '⌘')
    .replace(/Alt/gi, '⌥')
    .replace(/Shift/gi, '⇧')
    .replace(/\s*\+\s*/g, '')
    .replace(/\s*\/\s*/g, '/');
}

/**
 * 所有快捷键分支 id 的单一真源。
 * 新增 hotkeys.ts 的 keydown 分支时，必须先把 id 登记在这里（`ShortcutBranchId`
 * 只接受这些字面量，写别的值编译期就报错），再在 SHORTCUT_DEFINITIONS 里补一条
 * 帮助页文案——utils/__tests__/hotkeys.test.ts 会断言「每个 id 都有清单条目」，
 * 漏登记会直接测试失败，因此帮助页不会再与真实注册表漂移。
 */
export const SHORTCUT_BRANCH_IDS = [
  'search',
  'publish',
  'openSettings',
  'refresh',
  'quickRoutes',
  'tabCycle',
  'closeTab',
  'toggleSidebar',
  'zoomIn',
  'zoomOut',
  'navBack',
  'navForward',
  'feedNavNext',
  'feedNavPrev',
  'feedNavComment',
  'escape',
] as const;

export type ShortcutBranchId = (typeof SHORTCUT_BRANCH_IDS)[number];

/**
 * 快捷键帮助清单（由 ShortcutSettingsPage 直接渲染）。
 * branchId 对应 hotkeys.ts 内的一个 keydown 处理分支；个别快捷键由其它组件注册
 * （如 Ctrl+K 由 SearchCommand 处理），其 branchId 列在 hotkeys.ts 的
 * EXTERNAL_HOTKEY_IDS 中。不要在这里添加没有任何分支背书的条目。
 */
export interface ShortcutDefinition {
  /** 对应 hotkeys.ts 的注册分支 id（或外部注册方的 id）。 */
  branchId: ShortcutBranchId;
  label: string;
  desc: string;
  key: string;
  macKey?: string;
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { branchId: 'search', label: '全局搜索', desc: '快速唤起搜索框Command Palette', key: 'Ctrl+K' },
  { branchId: 'publish', label: '发布动态', desc: '打开动态发布弹窗', key: 'Ctrl+N' },
  { branchId: 'openSettings', label: '打开设置', desc: '快速进入桌面端设置中心', key: 'Ctrl+,' },
  { branchId: 'refresh', label: '刷新当前流', desc: '重新加载首页信息流', key: 'Ctrl+R' },
  { branchId: 'quickRoutes', label: '快速切换页面', desc: '使用数字键快速进入常用页面', key: 'Ctrl+1..9' },
  { branchId: 'tabCycle', label: '下一个标签页', desc: '按标签栏顺序循环切换；可映射到鼠标侧键或触控板自定义手势', key: 'Ctrl+Tab', macKey: 'Control+Tab' },
  { branchId: 'tabCycle', label: '上一个标签页', desc: '按标签栏顺序反向循环切换', key: 'Ctrl+Shift+Tab', macKey: 'Control+Shift+Tab' },
  { branchId: 'tabCycle', label: '上一个 / 下一个标签页（备用）', desc: '切换主窗口中已打开的标签页', key: 'Ctrl+PageUp / Ctrl+PageDown', macKey: '⌘+Shift+[ / ⌘+Shift+]' },
  { branchId: 'closeTab', label: '关闭当前标签页', desc: '关闭当前页面；首页和固定标签保留', key: 'Ctrl+W' },
  { branchId: 'toggleSidebar', label: '折叠侧边栏', desc: '切换侧边栏展开与折叠状态', key: 'Ctrl+Shift+B' },
  { branchId: 'zoomIn', label: '放大界面', desc: '增大界面缩放比例', key: 'Ctrl+= / Ctrl++' },
  { branchId: 'zoomOut', label: '缩小界面', desc: '减小界面缩放比例', key: 'Ctrl+-' },
  { branchId: 'navBack', label: '页面后退', desc: '返回上一个历史页面（桌面浏览习惯）', key: 'Alt+←' },
  { branchId: 'navForward', label: '页面前进', desc: '切换到下一个历史页面（桌面浏览习惯）', key: 'Alt+→' },
  { branchId: 'feedNavNext', label: '下一条动态', desc: '快速浏览卡片', key: 'J' },
  { branchId: 'feedNavPrev', label: '上一条动态', desc: '快速浏览卡片', key: 'K' },
  { branchId: 'feedNavComment', label: '展开/收起评论', desc: '浏览卡片时展开或收起评论区', key: 'C' },
  { branchId: 'escape', label: '关闭浮层/收起评论', desc: '关闭弹窗、抽屉、全屏图片或收起评论区（搜索、发布、看图等浮层自行处理）', key: 'Esc' },
];

export function usePlatformShortcuts() {
  onMounted(() => {
    if (!(window as any).__TAURI_INTERNALS__) return;
    void getPlatformInfo().then((platform) => {
      platformOs.value = platform.os;
    });
  });
  return {
    formatShortcut: (shortcut: string, macShortcut?: string) => formatShortcut(shortcut, platformOs.value, macShortcut),
  };
}
