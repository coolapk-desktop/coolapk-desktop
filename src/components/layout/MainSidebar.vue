<template>
  <button
    v-if="mobileOpen"
    type="button"
    class="mobile-sidebar-backdrop"
    aria-label="关闭导航菜单"
    @click="emit('closeMobile')"
  ></button>

  <aside :class="['main-sidebar', { 'is-collapsed': isCollapsed, 'is-mobile-open': mobileOpen, 'has-window-controls': mobileWindowControls }]">
    <div class="mobile-navigation-header">
      <strong>快捷入口</strong>
      <span>频道与常用功能</span>
    </div>

    <!-- 截图同款：吸附在侧边栏右侧分割线边缘的小圆形折叠手柄。 -->
    <button
      v-if="!mobileLayout && !mobileOpen"
      class="sidebar-floating-toggle-btn"
      :title="isCollapsed ? '展开侧边栏' : '收起侧边栏'"
      @click="settingsStore.toggleSidebar"
    >
      <svg class="dock-toggle-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
        <path v-if="isCollapsed" d="M9 6l6 6-6 6" />
        <path v-else d="M15 6l-6 6 6 6" />
      </svg>
    </button>

    <nav class="sidebar-nav custom-scrollbar">
      <div class="nav-group">
        <router-link
          v-for="item in primaryNavs"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          active-class="is-active"
          :title="item.label"
          @click="handleRootNavClick($event, item.path)"
        >
          <OfficialNavIcon class="nav-icon" :route="item.path" :active="isNavIconActive(item.path)" />
          <span v-if="!isCollapsed || mobileLayout || mobileOpen" class="nav-label">{{ item.label }}</span>
        </router-link>

        <button v-if="webDesktopNavigation" type="button" class="nav-item action-item" data-overlay-trigger="search" title="搜索" aria-label="搜索" @click="appStore.openSearch">
          <i class="fas fa-magnifying-glass nav-icon" aria-hidden="true"></i>
          <span v-if="!isCollapsed" class="nav-label">搜索</span>
        </button>

        <router-link
          v-if="moreVisible"
          to="/more"
          class="nav-item"
          :class="{ 'is-active': isMoreActive }"
          title="更多服务与专区"
          @click="handleNavSelection"
        >
          <OfficialNavIcon class="nav-icon" route="/more" :active="isMoreActive" />
          <span v-if="!isCollapsed || mobileLayout || mobileOpen" class="nav-label">更多</span>
        </router-link>

      </div>

      <div class="nav-divider"></div>

      <div class="nav-group">
        <button v-if="webDesktopNavigation && !authStore.isWebDemo" type="button" class="nav-item action-item" data-overlay-trigger="publish" title="写动态" aria-label="写动态" @click="appStore.openPublish">
          <i class="fas fa-pen nav-icon" aria-hidden="true"></i>
          <span v-if="!isCollapsed" class="nav-label">写动态</span>
        </button>

        <router-link
          v-for="item in secondaryNavs"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          active-class="is-active"
          :title="getNavTitle(item)"
          @click="handleNavSelection"
          @mouseenter="openSidebarPreview(item.key, $event)"
          @mouseleave="closeSidebarPreview(item.key)"
          @keydown.down="openSidebarPreview(item.key, $event, true)"
          @keydown.esc="closeSidebarPreview(item.key, $event)"
        >
          <OfficialNavIcon class="nav-icon" :route="item.path" :active="isNavIconActive(item.path)" />
          <span v-if="!isCollapsed || mobileLayout || mobileOpen" class="nav-label">{{ item.label }}</span>
          <span
            v-if="getNavBadge(item.key) > 0"
            :class="['nav-badge', { 'is-wide': getNavBadge(item.key) > 9 }]"
          >
            {{ getNavBadge(item.key) > 99 ? '99+' : getNavBadge(item.key) }}
          </span>
        </router-link>
      </div>

      <router-link
        v-if="myVisible"
        to="/my"
        class="nav-item"
        :class="{ 'is-active': isMyActive }"
        active-class="is-active"
        title="我的"
        @click="handleRootNavClick($event, '/my')"
      >
        <OfficialNavIcon class="nav-icon" route="/my" :active="isMyActive" />
        <span v-if="!isCollapsed || mobileLayout || mobileOpen" class="nav-label">我的</span>
      </router-link>

      <button v-if="webDesktopNavigation" type="button" class="nav-item action-item sidebar-account" :title="accountLabel" :aria-label="accountLabel" @click="openAccount($event)" @mouseenter="openSidebarPreview('account', $event)" @mouseleave="closeSidebarPreview('account')" @keydown.esc="closeSidebarPreview('account', $event)">
        <span class="sidebar-account-avatar" aria-hidden="true">
          <AppAvatar v-if="!authStore.isWebDemo && authStore.isLoggedIn && authStore.user?.userAvatar" :src="authStore.user.userAvatar" :size="34" />
          <i v-else class="fas fa-user"></i>
        </span>
        <span v-if="!isCollapsed" class="nav-label">{{ accountLabel }}</span>
      </button>

      <div class="sidebar-settings">
        <div class="nav-divider"></div>
        <div class="nav-group">
          <button v-if="webDesktopNavigation" type="button" class="nav-item action-item" :title="themeLabel" :aria-label="themeLabel" @click="settingsStore.setTheme(isDark ? 'light' : 'dark')">
            <i :class="[isDark ? 'fas fa-sun' : 'fas fa-moon', 'nav-icon']" aria-hidden="true"></i>
            <span v-if="!isCollapsed" class="nav-label">{{ isDark ? '日间' : '夜间' }}</span>
          </button>
          <router-link to="/settings" class="nav-item" active-class="is-active" title="设置" @click="handleNavSelection">
            <OfficialNavIcon class="nav-icon" route="/settings" :active="isNavIconActive('/settings')" />
            <span v-if="!isCollapsed || mobileLayout || mobileOpen" class="nav-label">设置</span>
          </router-link>
        </div>
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import OfficialNavIcon from './OfficialNavIcon.vue';
import AppAvatar from '../common/AppAvatar.vue';
import type { SidebarPreview } from './sidebarPreview';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSettingsStore } from '../../stores/settings';
import { useAuthStore } from '../../stores/auth';
import { useAppStore } from '../../stores/app';
import { useNotificationStore } from '../../stores/notifications';
import { useDownloadStore } from '../../stores/downloads';
import { triggerSidebarTransition } from '../../utils/routeTransition';
import { activateRootTab } from '../../utils/homeTab';
import { useMobileLayout } from '../../composables/useOfficialMobileFeedDetail';

const mobileLayout = useMobileLayout();

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const authStore = useAuthStore();
const appStore = useAppStore();
const accountLabel = computed(() => authStore.isWebDemo || authStore.isLoggedIn ? '资料' : '登录');

function openAccount(event: MouseEvent) {
  if (event.detail === 0 || authStore.isWebDemo) {
    openSidebarPreview('account', event, event.detail === 0);
    return;
  }
  if (authStore.isLoggedIn) void router.push('/user/me');
  else authStore.openLoginModal();
}

function openSidebarPreview(key: string, event: Event, focus = false) {
  if (!props.webDesktopNavigation || !(event.currentTarget instanceof HTMLElement)) return;
  if (key === 'notifications' || key === 'messages' || key === 'account') {
    if (focus) event.preventDefault();
    emit('openPreview', key, event.currentTarget, focus);
  }
}

function closeSidebarPreview(key: string, event?: KeyboardEvent) {
  if (props.webDesktopNavigation && (key === 'notifications' || key === 'messages' || key === 'account')) emit('closePreview', key, event);
}
const notificationStore = useNotificationStore();
const downloadStore = useDownloadStore();
const props = withDefaults(defineProps<{ mobileOpen?: boolean; mobileWindowControls?: boolean; webDesktopNavigation?: boolean }>(), { mobileOpen: false, mobileWindowControls: false, webDesktopNavigation: false });
const emit = defineEmits<{ closeMobile: []; openPreview: [key: SidebarPreview, anchor: HTMLElement, focus: boolean]; closePreview: [key: SidebarPreview, event?: KeyboardEvent] }>();

const mobileOpen = computed(() => props.mobileOpen);

function handleNavSelection() {
  emit('closeMobile');
  triggerSidebarTransition();
}

/**
 * 一级导航（首页 / 数码 / 发现 / 我的等根栏目）点击。
 *
 * 已经在该栏目时 router-link 的重复导航会被 vue-router 中止，页面停留原地；
 * 这里接管成「单击回到顶部、双击回到顶部并刷新当前栏目」，与移动端底栏一致。
 * 不在该栏目时仍交给 router-link 正常跳转。
 */
function handleRootNavClick(event: MouseEvent, path: string) {
  handleNavSelection();
  if (router.currentRoute.value.path !== path) return;
  event.preventDefault();
  activateRootTab(router, path);
}

function handleNavClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const link = target?.closest('.nav-item:not(.action-item)');
  if (link) {
    triggerSidebarTransition();
  }
}

const isCollapsed = computed(() => settingsStore.settings.sidebarCollapsed);

const isDark = computed(() => {
  return settingsStore.resolvedTheme === 'dark';
});
const themeLabel = computed(() => isDark.value ? '切换日间模式' : '切换夜间模式');

// 主侧边栏精简保留核心主干
const allPrimaryNavs = [
  { key: 'home', path: '/', label: '首页' },
  { key: 'digital', path: '/digital', label: '数码' },
  { key: 'discover', path: '/discover', label: '发现' },
  { key: 'topics', path: '/topics', label: '话题' },
  { key: 'pictures', path: '/pictures', label: '酷图' },
];

const allSecondaryNavs = [
  { key: 'notifications', path: '/notifications', label: '通知' },
  { key: 'messages', path: '/messages', label: '消息' },
  { key: 'history', path: '/history', label: '历史' },
  { key: 'favorites', path: '/favorites', label: '收藏' },
];

const primaryNavs = computed(() => {
  const vis = settingsStore.settings.navVisibility;
  if (!vis) return allPrimaryNavs;
  return allPrimaryNavs.filter((item) => vis[item.key as keyof typeof vis] !== false);
});

const secondaryNavs = computed(() => {
  const vis = settingsStore.settings.navVisibility;
  if (!vis) return allSecondaryNavs;
  return allSecondaryNavs.filter((item) => vis[item.key as keyof typeof vis] !== false);
});

// 属于“更多专区”的下属路由集合
const moreSubPaths = [
  '/more',
  '/apps',
  '/downloads',
  '/my-products',
  '/goods',
  '/center',
  '/albums',
  '/pictures',
  '/secondhand',
  '/reviews',
  '/digital',
  '/digital-library',
  '/games',
  '/events',
  '/event',
  '/anylist',
  '/my-dyh',
  '/product-compare',
  '/product-selector',
  '/headline',
  '/blacklist',
];

// 当处于 /more 或下属未在侧边栏独立展示的专区时，“更多”保持高亮
const isMoreActive = computed(() => {
  const currentPath = route.path;
  if (currentPath === '/more') return true;

  const currentVisiblePaths = [
    ...primaryNavs.value.map((n) => n.path),
    ...secondaryNavs.value.map((n) => n.path),
  ];

  // 如果当前路由已经在主侧边栏独立显示，则不重复高亮“更多”
  if (currentVisiblePaths.some((p) => p === currentPath || (p !== '/' && currentPath.startsWith(p)))) {
    return false;
  }

  // 属于更多子路由集合时高亮
  return moreSubPaths.some((sub) => currentPath === sub || (sub !== '/' && currentPath.startsWith(sub)));
});

const isMyActive = computed(() => {
  const currentPath = route.path;
  return currentPath === '/my'
    || currentPath === '/my-likes'
    || currentPath === '/followed-nodes'
    || currentPath === '/followed-topics'
    || currentPath === '/recent-contacts'
    || currentPath === '/recycle-bin'
    || currentPath === '/hidden-replies'
    || currentPath === '/my-devices'
    || currentPath === '/my-albums'
    || currentPath === '/my-votes';
});

const moreVisible = computed(() => settingsStore.settings.navVisibility?.more !== false);
const myVisible = computed(() => settingsStore.settings.navVisibility?.my !== false);
function getNavBadge(key: string): number {
  if (key === 'notifications') return notificationStore.notificationCount;
  if (key === 'messages') return notificationStore.messageCount;
  if (key === 'downloads') return downloadStore.activeCount;
  return 0;
}

function isNavIconActive(path: string): boolean {
  return route.path === path || route.path.startsWith(path + '/');
}

function getNavTitle(item: { key: string; label: string }): string {
  const count = getNavBadge(item.key);
  return count > 0 ? `${item.label}（${count} 条未读）` : item.label;
}

function toggleTheme() {
  const nextTheme = settingsStore.settings.theme === 'dark' ? 'light' : 'dark';
  settingsStore.setTheme(nextTheme);
}

function handleLogout() {
  authStore.logout();
}
</script>

<style scoped>
.mobile-navigation-header {
  display: none;
}

.main-sidebar {
  position: relative;
  width: var(--sidebar-width);
  background-color: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  height: 100%;
  /* 侧边栏切换宽度时直接单帧完成，避免 140ms 逐帧宽度变化带动右侧整栏重排与重绘 */
  /* 按钮会向内容区伸出少量空间，层级需要高于标签栏才能保证显示和点击。 */
  z-index: 750;
}

.main-sidebar.is-collapsed {
  width: var(--sidebar-collapsed-width);
}

.sidebar-floating-toggle-btn {
  position: absolute;
  top: 14px;
  right: -10px;
  z-index: 20;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background-color: var(--surface);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.1);
  transition: background-color var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default);
}

.sidebar-floating-toggle-btn:hover {
  background-color: var(--surface-hover);
  border-color: var(--brand-primary);
  color: var(--brand-primary);
}

.sidebar-floating-toggle-btn:active {
  transform: scale(0.94);
}

.dock-toggle-icon {
  display: block;
}

.sidebar-panel-icon {
  display: block;
}

.sidebar-nav {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--space-3) var(--space-3);
  overflow-y: auto;
}

.sidebar-nav > * {
  flex-shrink: 0;
}

/* 桌面侧栏将设置入口放在底部，空间不足时随菜单滚动。 */
.main-sidebar:not(.is-mobile-open) .sidebar-settings {
  margin-top: auto;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-control);
  color: var(--text-secondary);
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  transition: background-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default);
  text-decoration: none;
  border: none;
  background: transparent;
  width: 100%;
  box-sizing: border-box;
}

.nav-item:hover {
  background-color: var(--surface-hover);
  color: var(--text-primary);
}

.action-item .nav-icon {
  display: grid;
  flex: 0 0 20px;
  height: 20px;
  place-items: center;
}

.action-item .nav-label {
  min-width: 0;
  overflow: hidden;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-account {
  flex-direction: column;
  justify-content: center;
  gap: var(--space-1);
}

.sidebar-account-avatar {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--brand-soft);
  color: var(--brand-primary);
  font-size: 16px;
}

.sidebar-account .nav-label {
  font-weight: var(--font-weight-semibold);
}

@media (min-width: 1101px) {
  .main-sidebar:not(.is-collapsed) .sidebar-account {
    height: 68px;
    margin-top: var(--space-1);
    background: var(--background);
  }

  .main-sidebar:not(.is-collapsed) .sidebar-account:hover,
  .main-sidebar:not(.is-collapsed) .sidebar-account:focus-visible {
    background: var(--surface-hover);
  }
}

.action-item:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: -2px;
}

.nav-item.is-active {
  background-color: var(--brand-soft);
  color: var(--brand-primary);
  font-weight: var(--font-weight-semibold);
}

.nav-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3.5px;
  height: 18px;
  background-color: var(--brand-primary);
  border-radius: 0 4px 4px 0;
}

.nav-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
  margin-right: var(--space-3);
}

.nav-badge {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  margin-left: auto;
  padding: 0;
  border-radius: 50%;
  background-color: var(--danger);
  color: #ffffff;
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  line-height: 20px;
  text-align: center;
}

.nav-badge.is-wide {
  flex-basis: auto;
  width: auto;
  min-width: 20px;
  padding: 0 5px;
  border-radius: var(--radius-full);
}

.main-sidebar.is-collapsed .nav-badge {
  position: absolute;
  top: 4px;
  right: 5px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  line-height: 14px;
  border-radius: 50%;
}

.main-sidebar.is-collapsed .nav-icon {
  margin-right: 0;
}

.main-sidebar.is-collapsed .nav-item {
  justify-content: center;
  padding: 0;
}

.nav-divider {
  height: 1px;
  background-color: var(--divider);
  margin: var(--space-3) var(--space-2);
}

.nav-more-container {
  position: relative;
}

.more-toggle-item {
  cursor: pointer;
}

.more-chevron {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}

.more-inline-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.nav-sub-item {
  height: 36px;
  padding-left: calc(var(--space-4) + 20px + var(--space-3));
  font-size: var(--font-size-caption);
}

.nav-sub-item .nav-icon {
  font-size: 13px;
}

.more-popover {
  position: absolute;
  left: calc(100% + var(--space-3));
  top: 0;
  width: 190px;
  padding: var(--space-2);
  background: var(--surface-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lg);
  z-index: 120;
}

.more-popover-title {
  padding: var(--space-2) var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.more-popover-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 36px;
  padding: 0 var(--space-3);
  color: var(--text-secondary);
  border-radius: var(--radius-control);
  text-decoration: none;
  font-size: var(--font-size-sub);
}

.more-popover-item:hover,
.more-popover-item.router-link-active {
  color: var(--brand-primary);
  background: var(--brand-soft);
}

.action-item {
  cursor: pointer;
}

.primary-item:hover {
  color: var(--brand-primary);
  background-color: var(--brand-soft);
}

.danger-item:hover {
  color: var(--danger);
  background-color: rgba(240, 68, 68, 0.1);
}

@media (max-width: 1100px) {
  .main-sidebar {
    width: var(--sidebar-collapsed-width);
  }

  .nav-label {
    display: none !important;
  }

  .nav-icon {
    margin-right: 0 !important;
  }

  .nav-item {
    justify-content: center !important;
    padding: 0 !important;
  }

  .nav-badge {
    position: absolute;
    top: 4px;
    right: 5px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    line-height: 14px;
  }
}

@media (max-width: 720px) {
  .mobile-sidebar-backdrop {
    position: absolute;
    /* Keep this inside AppShell to share its floating-nav and safe-area space. */
    top: calc(var(--mobile-navigation-top) - 8px);
    right: 0;
    bottom: var(--mobile-bottom-overlay-space);
    left: 0;
    z-index: 1000;
    display: block;
    padding: 0;
    border: 0;
    background: rgba(15, 23, 42, 0.3);
    touch-action: manipulation;
  }

}
</style>
