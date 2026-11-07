/**
 * 未保存草稿离开守卫（路由离开 + 页签关闭）的统一 composable。
 *
 * 为什么统一：此前各脏状态页面各自实现两份守卫，行为容易漂移（有的只拦路由、
 * 有的漏了页签关闭）；抽到这里后「未修改放行 / 确认后丢弃 / 取消留下」三条路径
 * 由一处保证，移动端与桌面端的页签/返回交互共用同一份逻辑。
 */
import { getCurrentInstance, onMounted, onUnmounted } from 'vue';
import { onBeforeRouteLeave, useRoute } from 'vue-router';
import { usePageTabsStore } from '../stores/pageTabs';
import { getPageTabId } from './pageTabs';
import { requestConfirmation } from './confirm';

export interface UnsavedChangesGuardOptions {
  /** 是否存在未保存修改；每次离开时重新求值，允许传响应式 getter。 */
  hasUnsavedChanges: () => boolean;
  /** 确认弹窗标题与正文。 */
  title: string;
  message: string;
  /** 确认按钮文案，默认「放弃修改」。 */
  confirmText?: string;
  /** 用户确认放弃后回调（清草稿），避免下次离开被同一份脏状态再次拦截。 */
  onDiscard?: () => void;
}

/**
 * 挂载「未保存修改」离开守卫。必须在 setup 同步调用（内部注册路由守卫）。
 * 返回守卫函数本身，便于页面在其它场景（如自定义关闭流程）复用同一份确认。
 */
export function useUnsavedChangesGuard(options: UnsavedChangesGuardOptions): () => Promise<boolean> {
  const confirmLeave = async (): Promise<boolean> => {
    // 未修改直接放行，绝不弹窗。
    if (!options.hasUnsavedChanges()) return true;
    const confirmed = await requestConfirmation({
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? '放弃修改',
      danger: true
    });
    if (confirmed) options.onDiscard?.();
    return confirmed;
  };

  // 单测可能直接挂载组件（无路由环境），onBeforeRouteLeave 会告警但不应中断渲染，故吞掉异常。
  try {
    onBeforeRouteLeave(() => confirmLeave());
  } catch { /* 无路由环境：跳过路由守卫，页签守卫仍生效。 */ }

  const instance = getCurrentInstance();
  if (instance) {
    const pageTabsStore = usePageTabsStore();
    // useRoute 在无路由环境下返回 undefined，兜底 id 与原 NetworkSettingsPage 行为一致。
    const route = useRoute();
    let guardedTabId = '';
    // 页签关闭守卫是全局 Map，必须在挂载时恰好注册一次、卸载时注销，否则热更新/缓存页会残留旧守卫。
    onMounted(() => {
      guardedTabId = typeof route?.path === 'string' ? getPageTabId(route) : 'settings';
      pageTabsStore.registerTabCloseGuard(guardedTabId, confirmLeave);
    });
    onUnmounted(() => {
      if (guardedTabId) pageTabsStore.unregisterTabCloseGuard(guardedTabId);
    });
  }

  return confirmLeave;
}
