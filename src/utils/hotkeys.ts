import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { useSettingsStore } from '../stores/settings';
import { hasActiveComments, collapseActiveComments } from './activeCommentTracker';
import { usePageTabsStore } from '../stores/pageTabs';
import { refreshPageTabGeneration } from './pageTabs';

/**
 * 全局快捷键注册：
 *  - Ctrl+N 发布动态
 *  - Ctrl+, 打开设置
 *  - Ctrl+R 与工具栏一致，刷新当前页面或首页的当前栏目
 *  - Ctrl+ / Ctrl- 调整界面缩放
 *  - Ctrl+1..9 快速切换常用页面
 *  - Ctrl+Shift+B 折叠或展开侧边栏
 *  - Ctrl+W 关闭当前标签页，Ctrl+Tab / Ctrl+Shift+Tab 循环切换标签页
 *  - Ctrl+PageUp / PageDown、⌘⇧[ / ⌘⇧] 切换上一个 / 下一个标签页
 *  - Alt+Left / Alt+Right 前进后退页面
 *  - J / K 上下一条动态（派发 feed-nav-next / feed-nav-prev，由首页监听）
 *  - J / K / C 单键导航忽略修饰键，保留 Ctrl+C 等系统快捷键
 *  - Ctrl+K / Esc 由 SearchCommand 及各浮层组件自行处理
 * 焦点在输入框/文本域/下拉框时忽略 J/K 等单键快捷键。
 */
export function registerGlobalHotkeys() {
  const router = useRouter();
  const settingsStore = useSettingsStore();

  function isTypingTarget(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target.isContentEditable
    );
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const isAltArrow = e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight');

    if (isAltArrow && isTypingTarget(e)) return;

    if (ctrl && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      const tabsStore = usePageTabsStore();
      const route = tabsStore.close(tabsStore.activeId);
      if (route) void router.replace(route);
      return;
    }

    // macOS 的 ⌘Tab 由系统切换应用；标签切换使用真正的 Control 键。
    const controlTab = e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab';
    const controlPage = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      && (e.key === 'PageUp' || e.key === 'PageDown');
    // Shift 后 key 可能是花括号，code 则仍是方括号物理键。
    const commandBracket = e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey
      && (['[', ']', '{', '}'].includes(e.key) || ['BracketLeft', 'BracketRight'].includes(e.code));
    if (controlTab || controlPage || commandBracket) {
      e.preventDefault();
      const previous = controlTab ? e.shiftKey : controlPage ? e.key === 'PageUp'
        : e.code === 'BracketLeft' || e.key === '[' || e.key === '{';
      const route = usePageTabsStore().cycle(previous ? -1 : 1);
      if (route) void router.replace(route);
      return;
    }

    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      router.back();
      return;
    }

    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      router.forward();
      return;
    }

    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      settingsStore.toggleSidebar();
      return;
    }

    if (ctrl && !e.shiftKey && /^[1-9]$/.test(e.key)) {
      const quickRoutes = ['/', '/discover', '/apps', '/games', '/topics', '/favorites', '/history', '/notifications', '/messages'];
      const path = quickRoutes[Number(e.key) - 1];
      if (path) {
        e.preventDefault();
        router.push(path);
        return;
      }
    }

    if (ctrl && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      useAppStore().openPublish();
      return;
    }

    if (ctrl && e.key === ',') {
      e.preventDefault();
      router.push('/settings/startup');
      return;
    }

    if (ctrl && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      refreshPageTabGeneration(usePageTabsStore().tabs, router.currentRoute.value);
      return;
    }

    if (ctrl && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      settingsStore.setZoom(settingsStore.settings.zoom + 10);
      return;
    }

    if (ctrl && e.key === '-') {
      e.preventDefault();
      settingsStore.setZoom(settingsStore.settings.zoom - 10);
      return;
    }

    if (e.key === 'Escape' && !e.defaultPrevented) {
      const appStore = useAppStore();
      if (appStore.isSearchOpen || appStore.isPublishOpen || appStore.activeImageViewer) return;
      if (typeof document !== 'undefined' && document.querySelector('.app-dialog-container, .viewer-container, .login-modal-content')) return;
      if (hasActiveComments()) {
        e.preventDefault();
        collapseActiveComments();
        return;
      }
    }

    if (isTypingTarget(e) || ctrl || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key === 'j') {
      e.preventDefault();
      window.dispatchEvent(new Event('feed-nav-next'));
    } else if (key === 'k') {
      e.preventDefault();
      window.dispatchEvent(new Event('feed-nav-prev'));
    } else if (key === 'c') {
      e.preventDefault();
      window.dispatchEvent(new Event('feed-nav-comment'));
    }
  }

  window.addEventListener('keydown', handleKeydown);
  return () => window.removeEventListener('keydown', handleKeydown);
}
