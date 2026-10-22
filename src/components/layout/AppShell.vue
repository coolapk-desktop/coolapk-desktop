<template>
  <div
    class="app-shell"
    :class="{
      'has-mobile-window-controls': showWindowControls,
      'is-android': isAndroidApp,
      'is-touch-mobile': isTouchMobilePlatform(),
      'prevent-mobile-layout': isMobileLayoutDisabled,
      'has-mobile-bottom-nav': showMobileBottomNav,
      'reading-navigation-hidden': reading.hidden.value,
      'has-topic-navigation': route.path.startsWith('/topic/'),
      'has-home-navigation': route.path === '/',
      'has-discovery-navigation': route.path === '/digital' || route.path === '/discover',
      'topic-glass-joined': topicGlassJoined,
    }"
    @scroll.capture="handleShellScroll"
    @wheel.capture.passive="reading.onWheel"
    @touchstart.capture.passive="reading.onTouchStart"
    @touchmove.capture.passive="reading.onTouchMove"
  >
    <NetworkStatusBanner />
    <TopBar>
      <!-- 桌面窄窗口的返回入口固定在原生窗口按钮所在的标题栏，不随帖子滚动。 -->
      <template #narrow-navigation>
        <button v-if="showWindowControls && !isMobileLayoutDisabled && mobileLayout && route.path !== '/'" type="button" class="narrow-titlebar-back" aria-label="返回" title="返回上一页" data-tauri-drag-region="false" @click="navigateBack(router)"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>
      </template>
    </TopBar>
    <div class="mobile-reading-topbar"><div class="mobile-reading-topbar-content" :inert="reading.hidden.value || undefined" :aria-hidden="reading.hidden.value || undefined">
    <MobileTopBar
      v-if="!isMobileLayoutDisabled && !route.path.startsWith('/my-plugins')"
      :navigation-open="mobileNavigationOpen"
      :mac-overlay="usesMacOverlay"
      @toggle-navigation="toggleMobileNavigation"
    />
    </div></div>
    <div class="app-body">
      <MainSidebar
        :mobile-open="isMobileLayoutDisabled ? false : mobileNavigationOpen"
        :mobile-window-controls="showWindowControls"
        @close-mobile="closeMobileNavigation"
      />
      <div class="app-content-column">
        <PageTabBar v-if="settingsStore.settings.showPageTabBar" />
        <main ref="mainContent" class="app-main-content">
          <div class="app-page-content"><slot></slot></div>
          <DesktopFeedCommentPanel v-if="showDesktopComments && desktopCommentFeed" :feed="desktopCommentFeed" @close="desktopCommentFeed = null" />
        </main>
      </div>
    </div>
    <MobileBottomNav v-if="showMobileBottomNav" :inert="reading.hidden.value || undefined" :aria-hidden="reading.hidden.value || undefined" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, shallowRef, watch } from 'vue';
import DesktopFeedCommentPanel from '../feed/DesktopFeedCommentPanel.vue';
import { desktopFeedCommentsOpenKey, openDesktopFeedCommentsKey } from '../../utils/desktopFeedComments';
import { useMobileLayout, useWideSplitLayout } from '../../composables/useOfficialMobileFeedDetail';
import type { FeedItem } from '../../types/feed';
import { isTauri } from '@tauri-apps/api/core';
import { useRoute, useRouter } from 'vue-router';
import TopBar from './TopBar.vue';
import MainSidebar from './MainSidebar.vue';
import NetworkStatusBanner from '../common/NetworkStatusBanner.vue';
import MobileTopBar from './MobileTopBar.vue';
import MobileBottomNav from './MobileBottomNav.vue';
import PageTabBar from './PageTabBar.vue';
import { useAndroidBackButton } from '../../utils/androidBackButton';
import { createAndroidRootBackHandler } from '../../utils/androidRootBack';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { showToast } from '../../utils/toast';
import { isTouchMobilePlatform } from '../../utils/platform';
import { useDesktopWindow } from '../../composables/useDesktopWindow';
import { useSettingsStore } from '../../stores/settings';
import { useAppStore } from '../../stores/app';
import { useIosBackGesture } from '../../composables/useIosBackGesture';
import { navigateBack } from '../../utils/navigation';
import { mobileReadingNavigationKey, useMobileReadingNavigation } from '../../composables/useMobileReadingNavigation';
import { routeNavigationIsHistory } from '../../utils/routeScroll';

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const appStore = useAppStore();
const mobileNavigationOpen = ref(false);
const readingViewportWidth = ref(window.innerWidth);
const topicGlassJoined = ref(false);
function updateReadingViewport() { readingViewportWidth.value = window.innerWidth; updateTopicGlass(); }
const mainContent = ref<HTMLElement | null>(null);
const desktopCommentFeed = shallowRef<FeedItem | null>(null);
const mobileLayout = useMobileLayout();
const wideSplitLayout = useWideSplitLayout();
const showDesktopComments = computed(() => settingsStore.settings.desktopCommentsOnRight && !mobileLayout.value && wideSplitLayout.value);
provide(desktopFeedCommentsOpenKey, computed(() => showDesktopComments.value && desktopCommentFeed.value !== null));
// 列表页共享右侧评论宿主，保留当前路由与列表滚动位置。
provide(openDesktopFeedCommentsKey, feed => {
  if (!showDesktopComments.value) return false;
  desktopCommentFeed.value = feed;
  return true;
});
watch(showDesktopComments, show => { if (!show) desktopCommentFeed.value = null; });
const isIos = isTouchMobilePlatform() && !/android/i.test(navigator.userAgent);
useIosBackGesture(mainContent, () => isIos
  && !['/', '/digital', '/discover', '/me'].includes(route.path)
  && !mobileNavigationOpen.value
  && !appStore.isSearchOpen && !appStore.isPublishOpen && !appStore.activeImageViewer
  && !document.querySelector('.dialog-wrapper, .more-menu, .login-overlay, .app-context-menu'),
  () => navigateBack(router));
const isAndroidApp = isTauri() && /android/i.test(navigator.userAgent);
const { showWindowControls, usesMacOverlay } = useDesktopWindow();
// disableAutoMobileMode 是桌面端语义（窄窗口仍保留桌面顶栏与侧边栏）。
// 手机上窗口永远是窄的，一旦生效会把整个移动外壳删掉，因此触摸移动端一律忽略它。
const isMobileLayoutDisabled = computed(() => {
  return !isTouchMobilePlatform() && Boolean(settingsStore.settings.disableAutoMobileMode);
});
// 仅四个主栏目保留底栏；子页面通过顶栏返回，避免遮挡内容。
const showMobileBottomNav = computed(() => !isMobileLayoutDisabled.value
  && ['/', '/digital', '/discover', '/me'].includes(route.path));

// 首页、数码和发现共用阅读收起；只跟随正文滚动，浮层打开或退出该布局时立即恢复。
const reading = useMobileReadingNavigation(computed(() => settingsStore.settings.autoHideMobileNavigation
  && mobileLayout.value && readingViewportWidth.value <= 720 && !isMobileLayoutDisabled.value && ['/', '/digital', '/discover'].includes(route.path)
  && !mobileNavigationOpen.value && !appStore.isSearchOpen && !appStore.isPublishOpen && !appStore.activeImageViewer),
  () => route.path === '/digital' ? '.digital-content, .digital-server-content' : route.path === '/discover' ? '.discover-scroll-container' : undefined);
provide(mobileReadingNavigationKey, { hidden: reading.hidden, reset: reading.reset });
// 返回列表要恢复离开时的导航高度，否则相同滚动值也会被重新展开的搜索栏遮挡。
const readingStates = new Map<string, boolean>();
let readingRoute = route.fullPath;
watch(reading.hidden, hidden => {
  if (route.fullPath === readingRoute && ['/', '/digital', '/discover'].includes(route.path)) readingStates.set(readingRoute, hidden);
}, { flush: 'sync' });

/** 话题栏目吸顶后由下方玻璃向上延伸，避免上下两次独立模糊在接缝处产生色差。 */
function updateTopicGlass(scroller?: Element) {
  const controls = (scroller || mainContent.value)?.querySelector('.topic-sticky-controls');
  const topbar = mainContent.value?.closest('.app-shell')?.querySelector('.mobile-reading-topbar');
  topicGlassJoined.value = route.path.startsWith('/topic/') && window.innerWidth <= 720 && Boolean(controls && topbar && controls.getBoundingClientRect().top <= topbar.getBoundingClientRect().bottom + 1);
}

function handleShellScroll(event: Event) {
  reading.onScroll(event);
  if (route.path.startsWith('/topic/') && event.target instanceof Element && event.target.classList.contains('page-container')) updateTopicGlass(event.target);
}

function toggleMobileNavigation() {
  mobileNavigationOpen.value = !mobileNavigationOpen.value;
}

function closeMobileNavigation() {
  mobileNavigationOpen.value = false;
}

const rootBack = createAndroidRootBackHandler(router, () => CoolapkTauriAPI.quitApp(), showToast);
useAndroidBackButton(() => true, rootBack.handle);
useAndroidBackButton(() => mobileNavigationOpen.value, closeMobileNavigation);

function handleMobileNavigationKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMobileNavigation();
}

watch(() => route.fullPath, next => {
  const restoreHidden = routeNavigationIsHistory.value && Boolean(readingStates.get(next));
  readingRoute = next;
  topicGlassJoined.value = false;
  desktopCommentFeed.value = null;
  closeMobileNavigation();
  reading.restoreHidden(restoreHidden);
  rootBack.reset();
});

onMounted(() => { window.addEventListener('keydown', handleMobileNavigationKeydown); window.addEventListener('resize', updateReadingViewport); });
onUnmounted(() => { window.removeEventListener('keydown', handleMobileNavigationKeydown); window.removeEventListener('resize', updateReadingViewport); });
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--background);
}

.mobile-reading-topbar, .mobile-reading-topbar-content { display: contents; }
.app-shell.has-topic-navigation { --topic-glass-tint: color-mix(in srgb, var(--surface) 45%, transparent); --topic-glass-edge: rgba(255, 255, 255, .65); }
:global([data-theme="dark"] .app-shell.has-topic-navigation) { --topic-glass-tint: color-mix(in srgb, var(--surface) 65%, transparent); --topic-glass-edge: rgba(255, 255, 255, .18); }

.app-body {
  --page-tabbar-height: 38px;
  display: flex;
  flex: 1;
  overflow: hidden;
}

.app-main-content {
  flex: 1;
  min-width: 0;
  /* clip 不会像 hidden 那样消除 flex 的内容最小高度，必须允许主区收缩到窗口内。 */
  min-height: 0;
  overflow: hidden;
  position: relative;
  display: flex;
}

.app-content-column {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.app-page-content { display: flex; flex: 1; min-width: 0; min-height: 0; height: 100%; overflow: hidden; position: relative; }
/* 裁切外框不参与程序滚动；正文各自的 overflow:auto 容器仍正常滚动。 */
@supports (overflow: clip) { .app-main-content, .app-page-content { overflow: clip; } }

.narrow-titlebar-back { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 36px; align-self: stretch; margin-left: 4px; padding: 0; border: 0; background: transparent; color: var(--text-primary); cursor: pointer; }
.narrow-titlebar-back:hover { background: var(--surface-hover); }
.narrow-titlebar-back:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: -3px; }

@media (min-width: 721px) {
  /* 触摸平板使用桌面顶栏时，给系统状态栏留出顶部安全区。 */
  .app-shell.is-touch-mobile::before {
    content: '';
    flex: 0 0 var(--app-safe-area-top, 0px);
    background: var(--titlebar-background);
  }

  .app-shell.is-touch-mobile :deep(.network-status-banner) {
    top: calc(var(--app-titlebar-height) + var(--app-safe-area-top, 0px));
  }
}

@media (max-width: 720px) {
  /* 首页搜索与栏目使用连续玻璃底色；只收起搜索，保留栏目与原有滚动状态。 */
  .app-shell:not(.prevent-mobile-layout).has-home-navigation { --home-glass-tint: color-mix(in srgb, var(--surface) 45%, transparent); --home-glass-edge: rgba(255, 255, 255, .65); }
  :global([data-theme="dark"] .app-shell:not(.prevent-mobile-layout).has-home-navigation) { --home-glass-tint: color-mix(in srgb, var(--surface) 65%, transparent); --home-glass-edge: rgba(255, 255, 255, .18); }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation .mobile-reading-topbar-content { background: var(--home-glass-tint); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); box-shadow: inset 0 1px 0 var(--home-glass-edge); }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation :deep(.mobile-top-bar) { background: transparent; border-bottom: 0; }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation :deep(.mobile-search-entry) { background: color-mix(in srgb, var(--surface) 28%, transparent); border: 1px solid color-mix(in srgb, var(--border) 45%, transparent); box-shadow: inset 0 1px 0 var(--home-glass-edge); }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .app-shell:not(.prevent-mobile-layout).has-home-navigation .mobile-reading-topbar-content { background: var(--surface); } }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) { .app-shell:not(.prevent-mobile-layout).has-home-navigation .mobile-reading-topbar-content { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; } }
  /* 话题标题栏和下方吸顶筛选共用底色与边缘，拼成连续的玻璃导航。 */
  .app-shell:not(.prevent-mobile-layout).has-topic-navigation .mobile-reading-topbar-content { background: var(--topic-glass-tint); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); box-shadow: inset 0 1px 0 var(--topic-glass-edge); }
  .app-shell:not(.prevent-mobile-layout).has-topic-navigation :deep(.mobile-top-bar) { background: transparent; border-bottom: 0; }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .app-shell:not(.prevent-mobile-layout).has-topic-navigation .mobile-reading-topbar-content { background: var(--surface); } }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) { .app-shell:not(.prevent-mobile-layout).has-topic-navigation .mobile-reading-topbar-content { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; } }
  /* 网格折叠同时释放高度，不能只把导航移出屏幕而留下占位。 */
  .app-shell:not(.prevent-mobile-layout) .mobile-reading-topbar { display: grid; grid-template-rows: 1fr; flex: 0 0 auto; transition: grid-template-rows 200ms ease, padding-top 200ms ease; }
  .app-shell:not(.prevent-mobile-layout) .mobile-reading-topbar-content { display: block; min-height: 0; overflow: hidden; }
  /* 数码、发现收起搜索栏后仍保留状态栏安全区，底色与下方栏目栏一致，收起动画中也不露出外壳底色。 */
  .app-shell:not(.prevent-mobile-layout).has-discovery-navigation .mobile-reading-topbar { background: var(--surface); }
  .app-shell:not(.prevent-mobile-layout).reading-navigation-hidden .mobile-reading-topbar { grid-template-rows: 0fr; padding-top: var(--app-safe-area-top, 0px); }
  .app-shell:not(.prevent-mobile-layout).reading-navigation-hidden.has-mobile-window-controls .mobile-reading-topbar { padding-top: 0; }
  .app-shell:not(.prevent-mobile-layout) :deep(.mobile-bottom-nav) { transition: transform 200ms ease, opacity 200ms ease; }
  .app-shell:not(.prevent-mobile-layout).reading-navigation-hidden :deep(.mobile-bottom-nav) { transform: translateY(calc(100% + max(20px, env(safe-area-inset-bottom)))); opacity: 0; pointer-events: none; }
  .app-shell:not(.prevent-mobile-layout).reading-navigation-hidden.has-mobile-bottom-nav { --mobile-bottom-overlay-space: env(safe-area-inset-bottom, 0px); }
  .app-shell:not(.prevent-mobile-layout) :deep(.feed-scroll-container) { transition: padding-bottom 200ms ease; }
  @media (prefers-reduced-motion: reduce) {
    .app-shell:not(.prevent-mobile-layout) .mobile-reading-topbar, .app-shell:not(.prevent-mobile-layout) :deep(.mobile-bottom-nav), .app-shell:not(.prevent-mobile-layout) :deep(.feed-scroll-container) { transition: none; }
  }

  .app-shell:not(.prevent-mobile-layout) {
    position: relative;
    --mobile-bottom-overlay-space: env(safe-area-inset-bottom, 0px);
    --mobile-navigation-top: calc(var(--mobile-topbar-height) + var(--app-safe-area-top, 0px) + 8px);
  }

  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls {
    --mobile-navigation-top: calc(var(--mobile-window-controls-height) + var(--mobile-topbar-height) + 8px);
  }

  .app-shell:not(.prevent-mobile-layout).has-mobile-bottom-nav {
    --mobile-bottom-overlay-space: calc(var(--mobile-bottom-nav-height) + max(20px, env(safe-area-inset-bottom)) + 8px);
  }

  /* 首页与话题的滚动区域延伸至屏幕顶部，玻璃顶栏覆盖其上；首屏按钮和正文分别预留安全区。 */
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-topic-navigation) { --mobile-glass-topbar-space: calc(var(--mobile-topbar-height) + var(--app-safe-area-top, 0px)); }
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-topic-navigation) .mobile-reading-topbar { position: absolute; top: 0; left: 0; right: 0; z-index: 30; background: var(--home-glass-tint, var(--topic-glass-tint)); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); }
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-topic-navigation) .mobile-reading-topbar-content { background: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation.reading-navigation-hidden { --mobile-glass-topbar-space: var(--app-safe-area-top, 0px); }
  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls:is(.has-home-navigation, .has-topic-navigation) .mobile-reading-topbar { top: var(--mobile-window-controls-height); }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-topic-navigation) .mobile-reading-topbar { background: var(--surface); } }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) { .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-topic-navigation) .mobile-reading-topbar { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; } }

  /* 状态栏、操作栏与栏目只采样一次背景；下方表面向上延伸，顶栏只承载按钮。 */
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .topic-glass-joined) .mobile-reading-topbar { background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation :deep(.home-toolbar),
  .app-shell:not(.prevent-mobile-layout).topic-glass-joined :deep(.topic-sticky-controls) { isolation: isolate; background: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation :deep(.home-toolbar::before),
  .app-shell:not(.prevent-mobile-layout).topic-glass-joined :deep(.topic-sticky-controls::before) { content: ''; position: absolute; inset: calc(-1 * var(--mobile-glass-topbar-space)) 0 0; z-index: -1; pointer-events: none; background: var(--home-glass-tint, var(--topic-glass-tint)); border-radius: inherit; box-shadow: 0 6px 18px #0000000a, inset 0 -1px 0 var(--home-glass-edge, var(--topic-glass-edge)); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .app-shell:not(.prevent-mobile-layout).has-home-navigation :deep(.home-toolbar::before), .app-shell:not(.prevent-mobile-layout).topic-glass-joined :deep(.topic-sticky-controls::before) { background: var(--surface); }
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .app-shell:not(.prevent-mobile-layout).has-home-navigation :deep(.home-toolbar::before), .app-shell:not(.prevent-mobile-layout).topic-glass-joined :deep(.topic-sticky-controls::before) { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.top-bar),
  .app-shell:not(.prevent-mobile-layout) :deep(.page-tab-bar) {
    display: none !important;
  }

  /* 无系统标题栏的桌面平台在窄窗口仍需要最小化、最大化和关闭按钮。 */
  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.top-bar.has-window-controls) {
    display: flex !important;
    flex: 0 0 var(--mobile-window-controls-height);
    height: var(--mobile-window-controls-height);
    min-height: var(--mobile-window-controls-height);
  }

  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.top-bar.has-window-controls > .titlebar-sidebar-offset),
  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.top-bar.has-window-controls > .top-bar-center),
  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.top-bar.has-window-controls > .top-bar-right) {
    display: none !important;
  }

  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.top-bar.has-window-controls > .window-controls) {
    height: var(--mobile-window-controls-height);
  }

  /* 标题栏已有固定返回入口，隐藏滚动内容和移动顶栏中的重复按钮。 */
  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.official-back),
  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.detail-fallback-back),
  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.mobile-top-bar button[aria-label="返回"]) { display: none; }

  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.network-status-banner) {
    top: calc(var(--mobile-window-controls-height) + var(--mobile-topbar-height));
  }

  /* 移动端顶栏自身会因为安全区变高（iPhone 上约 99px），横幅必须让开它。 */
  .app-shell:not(.prevent-mobile-layout):not(.has-mobile-window-controls) :deep(.network-status-banner) {
    top: calc(var(--mobile-topbar-height) + var(--app-safe-area-top, 0px) + 8px);
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar) {
    display: flex !important;
    position: absolute;
    top: var(--mobile-navigation-top);
    bottom: auto;
    left: 50%;
    z-index: 1001;
    width: min(460px, calc(100vw - 24px)) !important;
    height: max-content;
    max-height: calc(100% - var(--mobile-navigation-top) - var(--mobile-bottom-overlay-space) - 12px);
    transform: translate(-50%, -8px);
    visibility: hidden;
    pointer-events: none;
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-card);
    overflow: hidden;
    transition: transform var(--duration-normal) var(--ease-default), visibility var(--duration-normal), opacity var(--duration-normal);
    opacity: 0;
  }

  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.main-sidebar.has-window-controls) {
    top: var(--mobile-navigation-top);
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open) {
    transform: translate(-50%, 0);
    visibility: visible;
    pointer-events: auto;
    opacity: 1;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .mobile-navigation-header) {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 14px 16px 8px;
    color: var(--text-primary);
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .mobile-navigation-header strong) {
    font-size: 16px;
    font-weight: 700;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .mobile-navigation-header span) {
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .sidebar-nav) {
    display: grid !important;
    flex: 0 1 auto;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-content: start;
    gap: 8px;
    min-height: 0;
    width: 100%;
    padding: 12px;
    overflow-y: auto;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .nav-group) {
    display: contents;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .nav-item) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center !important;
    gap: 5px;
    width: 100%;
    height: 60px;
    padding: 6px 4px !important;
    border: 1px solid var(--border-light);
    border-radius: 13px;
    background: var(--surface-hover);
    font-size: 12px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .nav-label) {
    display: inline !important;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .nav-item.is-active::before) {
    display: none;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .nav-icon) {
    width: auto;
    margin: 0 !important;
    font-size: 18px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .nav-divider) {
    display: block;
    grid-column: 1 / -1;
    width: auto;
    height: 1px;
    margin: 2px 0;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .sidebar-footer) {
    display: flex !important;
    flex: 0 0 auto;
    padding: 12px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .app-info-card) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
    width: 100%;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .app-info-top) {
    grid-column: 1 / -1;
    justify-content: flex-start;
    gap: 8px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .app-info-actions) {
    min-width: 0;
    gap: 8px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .footer-action-btn) {
    min-width: 0;
    min-height: 44px;
    padding: 8px;
    border-radius: 10px;
    font-size: 12px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .beta-toggle-btn) {
    gap: 6px;
    flex-wrap: wrap;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar.is-mobile-open .nav-badge) {
    position: absolute;
    top: 3px;
    right: 6px;
    left: auto;
    margin: 0;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.sidebar-floating-toggle-btn) {
    display: none;
  }

  .app-body,
  .app-main-content {
    min-height: 0;
  }

  .app-main-content {
    width: 100%;
    overscroll-behavior: none;
  }
}
</style>
