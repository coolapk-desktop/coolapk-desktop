<template>
  <div
    class="app-shell"
    :class="{
      'has-mobile-window-controls': showWindowControls,
      'is-android': isAndroidApp,
      'is-touch-mobile': isTouchMobilePlatform(),
      'prevent-mobile-layout': isMobileLayoutDisabled,
      'has-mobile-bottom-nav': showMobileBottomNav,
      'has-immersive-feed-detail': immersiveFeedDetail,
      'reading-navigation-hidden': reading.hidden.value,
      'has-topic-navigation': route.path.startsWith('/topic/'),
      'has-home-navigation': route.path === '/',
      'has-page-toolbar': hasPageToolbar,
      'has-topic-hub-detail': isTopicHubDetail,
      'has-web-desktop-navigation': useWebDesktopNavigation,
      'has-discovery-navigation': route.path === '/digital' || route.path === '/discover',
      'topic-glass-joined': topicGlassJoined,
      'is-reading-topbar-animating': isReadingTopbarAnimating,
      'is-route-container-morphing': isRouteContainerMorphing,
      'is-route-transitioning': isRouteTransitionActive,
    }"
    @scroll.capture="handleShellScroll"
    @wheel.capture="reading.onWheel"
    @touchstart.capture.passive="reading.onTouchStart"
    @touchmove.capture.passive="reading.onTouchMove"
  >
    <NetworkStatusBanner />
    <TopBar ref="topBar" v-show="!useWebDesktopNavigation" :sidebar-mode="useWebDesktopNavigation">
      <!-- 桌面窄窗口的返回入口固定在原生窗口按钮所在的标题栏，不随帖子滚动。 -->
      <template #narrow-navigation>
        <button v-if="showWindowControls && !isMobileLayoutDisabled && mobileLayout && route.path !== '/' && route.path !== '/search' && !isTopicHubDetail" type="button" class="narrow-titlebar-back" aria-label="返回" title="返回上一页" data-tauri-drag-region="false" @click="navigateBack(router)"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>
      </template>
    </TopBar>
    <div class="mobile-reading-topbar"><div class="mobile-reading-topbar-content" :inert="reading.hidden.value || undefined" :aria-hidden="reading.hidden.value || undefined">
    <div ref="readingTopbarStack" class="mobile-reading-topbar-stack">
    <MobileTopBar
      v-if="!isMobileLayoutDisabled && !hasPageToolbar && !route.path.startsWith('/my-plugins')"
      :navigation-open="mobileNavigationOpen"
      :mac-overlay="usesMacOverlay"
      @toggle-navigation="toggleMobileNavigation"
    />
    <div v-show="route.path === '/'" ref="homeToolbarTarget"></div>
    </div>
    </div></div>
    <div ref="appBody" class="app-body">
      <MainSidebar
        :web-desktop-navigation="useWebDesktopNavigation"
        @open-preview="(key, anchor, focus) => topBar?.openSidebarPreview(key, anchor, focus)"
        @close-preview="(key, event) => topBar?.closeSidebarPreview(key, event)"
        :mobile-open="isMobileLayoutDisabled ? false : mobileNavigationOpen"
        :mobile-window-controls="showWindowControls"
        @close-mobile="closeMobileNavigation"
      />
      <div class="app-content-column">
        <PageTabBar
          v-if="settingsStore.settings.showPageTabBar || useWebDesktopNavigation"
          :show-tabs="settingsStore.settings.showPageTabBar"
          :show-navigation="useWebDesktopNavigation"
        />
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
import { computed, nextTick, onMounted, onUnmounted, provide, ref, shallowRef, watch } from 'vue';
import DesktopFeedCommentPanel from '../feed/DesktopFeedCommentPanel.vue';
import { desktopFeedCommentsOpenKey, openDesktopFeedCommentsKey } from '../../utils/desktopFeedComments';
import { useMobileLayout, useOfficialMobileFeedDetail, useWideSplitLayout } from '../../composables/useOfficialMobileFeedDetail';
import type { FeedItem } from '../../types/feed';
import { isTauri } from '@tauri-apps/api/core';
import { isWebBuild } from '../../api/runtime';
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
import { mobileHomeToolbarTargetKey, mobileReadingNavigationKey, useMobileReadingNavigation } from '../../composables/useMobileReadingNavigation';
import { routeNavigationIsHistory } from '../../utils/routeScroll';
import { logDiagnostic } from '../../utils/diagnosticLogger';
import { animateTransformSlide, cancelTransformSlide, isRouteTransitionActive, readTranslateOffset } from '../../utils/compositorMotion';
import { isRouteContainerMorphing } from '../../utils/containerTransform';

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const appStore = useAppStore();
const mobileNavigationOpen = ref(false);
const readingViewportWidth = ref(window.innerWidth);
const topicGlassJoined = ref(false);
function updateReadingViewport() { readingViewportWidth.value = window.innerWidth; updateTopicGlass(); }
const mainContent = ref<HTMLElement | null>(null);
const topBar = ref<InstanceType<typeof TopBar> | null>(null);
const homeToolbarTarget = ref<HTMLElement | null>(null);
const readingTopbarStack = ref<HTMLElement | null>(null);
const appBody = ref<HTMLElement | null>(null);
const isReadingTopbarAnimating = ref(false);
provide(mobileHomeToolbarTargetKey, homeToolbarTarget);
const desktopCommentFeed = shallowRef<FeedItem | null>(null);
const mobileLayout = useMobileLayout();
const officialMobileFeedDetail = useOfficialMobileFeedDetail();
const immersiveFeedDetail = computed(() => route.name === 'FeedDetail' && officialMobileFeedDetail.value);
const isTopicHubDetail = computed(() => route.path === '/topics' && typeof route.query?.tag === 'string' && Boolean(route.query.tag.trim()));
const hasPageToolbar = computed(() => isTopicHubDetail.value || ['/notifications', '/search'].includes(route.path));
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
// 顶栏继续维护未读状态，桌面 Web 的可见入口由侧栏与页签栏提供。
const useWebDesktopNavigation = computed(() => isWebBuild && (readingViewportWidth.value > 720 || isMobileLayoutDisabled.value));
// 仅四个主栏目保留底栏；子页面通过顶栏返回，避免遮挡内容。
const showMobileBottomNav = computed(() => !isMobileLayoutDisabled.value
  && ['/', '/digital', '/discover', '/me'].includes(route.path));

// 主栏目继续使用已有滚动区域，其他页面可用 data-reading-scroll 接入同一策略。
const readingScrollSelectors = new Map([
  ['/', undefined],
  ['/digital', '.digital-content, .digital-server-content'],
  ['/discover', '.discover-scroll-container'],
]);
const reading = useMobileReadingNavigation(computed(() => settingsStore.settings.autoHideMobileNavigation
  && mobileLayout.value && readingViewportWidth.value <= 720 && !isMobileLayoutDisabled.value
  && !mobileNavigationOpen.value && !appStore.isSearchOpen && !appStore.isPublishOpen && !appStore.activeImageViewer),
  () => readingScrollSelectors.has(route.path) ? readingScrollSelectors.get(route.path) : '[data-reading-scroll]');
provide(mobileReadingNavigationKey, { hidden: reading.hidden, reset: reading.reset });
// 返回列表要恢复离开时的导航高度，否则相同滚动值也会被重新展开的搜索栏遮挡。
const readingStates = new Map<string, boolean>();
let readingRoute = route.fullPath;
watch(reading.hidden, hidden => {
  if (route.fullPath === readingRoute && readingScrollSelectors.has(route.path)) readingStates.set(readingRoute, hidden);
}, { flush: 'sync' });

const usesFlexTopbarAnimation = computed(() => !isMobileLayoutDisabled.value
  && mobileLayout.value
  && readingViewportWidth.value <= 720
  && !hasPageToolbar.value
  && route.path !== '/'
  && route.path !== '/digital'
  && route.path !== '/discover'
  && !route.path.startsWith('/topic/')
  && !route.path.startsWith('/my-plugins'));

let readingTopbarRouteTransition = false;
let pendingTopbarFlip: { next: boolean; wasAnimating: boolean; prevStackY: number; prevBodyY: number; barHeight: number } | null = null;
let topbarAnimationEpoch = 0;

function resetReadingTopbarAnimation() {
  topbarAnimationEpoch += 1;
  pendingTopbarFlip = null;
  cancelTransformSlide(readingTopbarStack.value);
  cancelTransformSlide(appBody.value);
  if (readingTopbarStack.value) readingTopbarStack.value.style.transform = '';
  if (appBody.value) appBody.value.style.transform = '';
  isReadingTopbarAnimating.value = false;
}

watch(usesFlexTopbarAnimation, active => {
  if (!active) resetReadingTopbarAnimation();
});

watch(() => reading.hidden.value, (next, previous) => {
  if (next === previous || readingTopbarRouteTransition || !usesFlexTopbarAnimation.value) {
    pendingTopbarFlip = null;
    return;
  }
  const stackEl = readingTopbarStack.value;
  const bodyEl = appBody.value;
  if (!stackEl || !bodyEl) return;
  const wasAnimating = isReadingTopbarAnimating.value;
  const prevStackY = wasAnimating ? readTranslateOffset(stackEl, 'y') : 0;
  const prevBodyY = wasAnimating ? readTranslateOffset(bodyEl, 'y') : 0;
  pendingTopbarFlip = { next, wasAnimating, prevStackY, prevBodyY, barHeight: 0 };
  isReadingTopbarAnimating.value = true;
}, { flush: 'pre' });

watch(() => reading.hidden.value, () => {
  const flip = pendingTopbarFlip;
  pendingTopbarFlip = null;
  if (!flip) return;
  const stackEl = readingTopbarStack.value;
  const bodyEl = appBody.value;
  if (!stackEl || !bodyEl) {
    isReadingTopbarAnimating.value = false;
    return;
  }
  const barHeight = stackEl.getBoundingClientRect().height;
  if (barHeight < 1) {
    isReadingTopbarAnimating.value = false;
    return;
  }
  const epoch = ++topbarAnimationEpoch;
  const { next, wasAnimating, prevStackY, prevBodyY } = flip;
  const fromStack = wasAnimating ? prevStackY : (next ? 0 : -barHeight);
  const toStack = next ? -barHeight : 0;
  const fromBody = wasAnimating ? prevBodyY : (next ? barHeight : 0);
  const toBody = next ? 0 : barHeight;
  stackEl.style.transform = toStack ? `translate3d(0, ${toStack}px, 0)` : '';
  bodyEl.style.transform = toBody ? `translate3d(0, ${toBody}px, 0)` : '';
  animateTransformSlide(stackEl, 'y', fromStack, toStack);
  animateTransformSlide(bodyEl, 'y', fromBody, toBody, {
    onFinish: () => {
      if (epoch === topbarAnimationEpoch) isReadingTopbarAnimating.value = false;
    },
  });
}, { flush: 'post' });

watch(isReadingTopbarAnimating, animating => {
  if (!animating) {
    if (readingTopbarStack.value) readingTopbarStack.value.style.transform = '';
    if (appBody.value) appBody.value.style.transform = '';
  }
}, { flush: 'post' });

let cachedTopicControls: HTMLElement | null = null;
let cachedMobileTopbar: HTMLElement | null = null;

/** 话题栏目吸顶后由下方玻璃向上延伸，避免上下两次独立模糊在接缝处产生色差。 */
function updateTopicGlass(scroller?: Element) {
  if (!route.path.startsWith('/topic/') || window.innerWidth > 720) {
    topicGlassJoined.value = false;
    return;
  }
  const controls = cachedTopicControls?.isConnected
    ? cachedTopicControls
    : (cachedTopicControls = (scroller || mainContent.value)?.querySelector<HTMLElement>('.topic-sticky-controls') || null);
  const topbar = cachedMobileTopbar?.isConnected
    ? cachedMobileTopbar
    : (cachedMobileTopbar = mainContent.value?.closest('.app-shell')?.querySelector<HTMLElement>('.mobile-reading-topbar') || null);
  topicGlassJoined.value = Boolean(controls && topbar && controls.getBoundingClientRect().top <= topbar.getBoundingClientRect().bottom + 1);
}

type LayoutSample = 'user_enter' | 'user_scroll' | 'home_return';
const lastLayoutSample = new Map<LayoutSample, number>();
let layoutSampleTimer: ReturnType<typeof setTimeout> | undefined;

function describeLayoutBox(element: Element | null | undefined): string {
  if (!element) return 'missing';
  const { top, bottom } = element.getBoundingClientRect();
  return `${Math.round(top)}:${Math.round(bottom)}:${getComputedStyle(element).overflowY}`;
}

/** #65：仅采集固定位置的命中类型及几何尺寸，不记录用户内容或路由参数。 */
function scheduleLayoutSample(reason: LayoutSample) {
  if (!isAndroidApp || layoutSampleTimer !== undefined || Date.now() - (lastLayoutSample.get(reason) ?? -Infinity) < 30_000) return;
  layoutSampleTimer = setTimeout(() => {
    layoutSampleTimer = undefined;
    const main = mainContent.value;
    if (!main || document.visibilityState === 'hidden') return;
    lastLayoutSample.set(reason, Date.now());
    const scroller = main.querySelector<HTMLElement>(reason === 'home_return'
      ? '.pager-page[aria-hidden="false"] .feed-scroll-container' : '.user-page-wrapper');
    const hitSamples = [0.55, 0.7, 0.9].map(fraction => {
      const y = Math.round((window.visualViewport?.height ?? window.innerHeight) * fraction);
      const hit = document.elementFromPoint(Math.floor(window.innerWidth / 2), y);
      const region = hit?.closest('.feed-card') && scroller?.contains(hit) ? 'feed'
        : hit && scroller?.contains(hit) ? 'list'
        : hit?.closest('.dialog-backdrop, .dialog-container, .more-menu-backdrop, .login-overlay') ? 'overlay'
        : hit && main.contains(hit) ? 'frame' : hit ? 'outside' : 'none';
      return `${y}:${region}:${hit?.localName ?? '-'}`;
    });
    const scroll = scroller ? `${Math.round(scroller.scrollTop)}:${scroller.clientHeight}:${scroller.scrollHeight}` : 'missing';
    logDiagnostic('info', 'layout', 'content_probe',
      `reason=${reason} main=${describeLayoutBox(main)} page=${describeLayoutBox(main.querySelector('.app-page-content'))} stage=${describeLayoutBox(main.querySelector('.route-transition-stage'))} list=${describeLayoutBox(scroller)} scroll=${scroll} hits=${hitSamples.join(',')}`);
  }, 500);
}

function handleShellScroll(event: Event) {
  reading.onScroll(event);
  if (route.path.startsWith('/topic/') && event.target instanceof Element && event.target.classList.contains('page-container')) updateTopicGlass(event.target);
  if (isAndroidApp && route.name === 'User' && event.target instanceof HTMLElement && event.target.classList.contains('user-page-wrapper')) scheduleLayoutSample('user_scroll');
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

watch(() => route.fullPath, (next, previous) => {
  clearTimeout(layoutSampleTimer);
  layoutSampleTimer = undefined;
  if (route.name === 'User') scheduleLayoutSample('user_enter');
  else if (route.path === '/' && previous.startsWith('/user/')) scheduleLayoutSample('home_return');
  const restoreHidden = routeNavigationIsHistory.value && Boolean(readingStates.get(next));
  readingRoute = next;
  topicGlassJoined.value = false;
  desktopCommentFeed.value = null;
  closeMobileNavigation();
  readingTopbarRouteTransition = true;
  resetReadingTopbarAnimation();
  reading.restoreHidden(restoreHidden);
  void nextTick(() => { readingTopbarRouteTransition = false; });
  rootBack.reset();
});

onMounted(() => {
  window.addEventListener('keydown', handleMobileNavigationKeydown);
  window.addEventListener('resize', updateReadingViewport);
  if (route.name === 'User') scheduleLayoutSample('user_enter');
});
onUnmounted(() => {
  clearTimeout(layoutSampleTimer);
  resetReadingTopbarAnimation();
  window.removeEventListener('keydown', handleMobileNavigationKeydown);
  window.removeEventListener('resize', updateReadingViewport);
});
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--background);
  --topic-glass-tint: color-mix(in srgb, var(--surface) 45%, transparent);
  --topic-glass-edge: rgba(255, 255, 255, .65);
}

/* 原生视口覆盖整块屏幕；普通页面仍在安全区内排列。 */
.app-shell.is-android { padding: 0 var(--app-safe-area-right) var(--app-safe-area-bottom) var(--app-safe-area-left); }

/* 移动端动态详情的正文滚动区延伸到屏幕底部。 */
.app-shell.has-immersive-feed-detail { background: var(--surface); }
.app-shell.is-android.has-immersive-feed-detail { padding-bottom: 0; }

.mobile-reading-topbar, .mobile-reading-topbar-content, .mobile-reading-topbar-stack { display: contents; }
.app-shell.has-web-desktop-navigation { --app-titlebar-height: 0px; }
:global([data-theme="dark"] .app-shell) { --topic-glass-tint: color-mix(in srgb, var(--surface) 65%, transparent); --topic-glass-edge: rgba(255, 255, 255, .18); }

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
  /* 主栏目正文可滚到透明导航栏背后，底栏和末尾内容各自预留安全区。 */
  .app-shell.is-android.has-mobile-bottom-nav { padding-bottom: 0; }
  .app-shell.is-android.has-home-navigation { background-color: var(--surface); }
  .app-shell.is-android.has-home-navigation :deep(.feed-scroll-container) { scrollbar-width: none; }
  .app-shell.is-android.has-home-navigation :deep(.feed-scroll-container::-webkit-scrollbar) { display: none; }
  /* 首页搜索和主栏目共用玻璃与折叠容器（变量局部挂载在顶栏容器，避免切页时在根容器改写 CSS 变量触发全树样式重算）。 */
  .app-shell:is(.has-home-navigation, .has-discovery-navigation) { --mobile-topbar-height: 44px; }
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-discovery-navigation) .mobile-reading-topbar { --home-glass-tint: color-mix(in srgb, var(--surface) 45%, transparent); --home-glass-edge: rgba(255, 255, 255, .65); }
  :global([data-theme="dark"] .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-discovery-navigation) .mobile-reading-topbar) { --home-glass-tint: color-mix(in srgb, var(--surface) 65%, transparent); --home-glass-edge: rgba(255, 255, 255, .18); }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation :deep(.mobile-top-bar) { background: transparent; border-bottom: 0; }
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-discovery-navigation) :deep(.mobile-search-entry) { background: color-mix(in srgb, var(--surface) 28%, transparent); border: 1px solid color-mix(in srgb, var(--border) 45%, transparent); box-shadow: inset 0 1px 0 var(--home-glass-edge, rgba(255, 255, 255, .65)); }
  /* 话题标题栏和下方吸顶筛选共用底色与边缘，拼成连续的玻璃导航。 */
  .app-shell:not(.prevent-mobile-layout).has-topic-navigation .mobile-reading-topbar-content { background: var(--topic-glass-tint); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); box-shadow: inset 0 1px 0 var(--topic-glass-edge); }
  .app-shell:not(.prevent-mobile-layout).has-topic-navigation :deep(.mobile-top-bar) { background: transparent; border-bottom: 0; }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .app-shell:not(.prevent-mobile-layout).has-topic-navigation .mobile-reading-topbar-content { background: var(--surface); } }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) { .app-shell:not(.prevent-mobile-layout).has-topic-navigation .mobile-reading-topbar-content { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; } }
  /* 网格折叠同时释放高度，不能只把导航移出屏幕而留下占位；过渡过程由 GPU transform 接管，避免逐帧重排。 */
  .app-shell:not(.prevent-mobile-layout) .mobile-reading-topbar { display: grid; grid-template-rows: 1fr; flex: 0 0 auto; }
  .app-shell:not(.prevent-mobile-layout) .mobile-reading-topbar-content { display: block; min-height: 0; overflow: hidden; }
  /* 页面自带工具栏时，外壳仅保留顶部安全区。 */
  .app-shell:not(.prevent-mobile-layout).has-page-toolbar .mobile-reading-topbar { padding-top: var(--app-safe-area-top, 0px); }
  .app-shell:not(.prevent-mobile-layout).has-page-toolbar.has-mobile-window-controls .mobile-reading-topbar { padding-top: 0; }
  /* Android 状态栏透明，话题标题栏上方的安全区也要使用导航底色。 */
  .app-shell.is-android:not(.prevent-mobile-layout).has-topic-hub-detail .mobile-reading-topbar { background: var(--surface); }
  /* 数码、发现收起搜索栏后仍保留状态栏安全区，底色与下方栏目栏一致，收起动画中也不露出外壳底色。 */
  .app-shell:not(.prevent-mobile-layout).has-discovery-navigation .mobile-reading-topbar { background: var(--surface); }
  .app-shell:not(.prevent-mobile-layout).reading-navigation-hidden .mobile-reading-topbar { grid-template-rows: 0fr; padding-top: var(--app-safe-area-top, 0px); }
  .app-shell:not(.prevent-mobile-layout).reading-navigation-hidden.has-mobile-window-controls .mobile-reading-topbar { padding-top: 0; }
  .app-shell:not(.prevent-mobile-layout).is-reading-topbar-animating .mobile-reading-topbar { position: relative; grid-template-rows: 0fr; padding-top: var(--app-safe-area-top, 0px); overflow: visible; z-index: 30; }
  .app-shell:not(.prevent-mobile-layout).is-reading-topbar-animating.has-mobile-window-controls .mobile-reading-topbar { padding-top: 0; }
  .app-shell:not(.prevent-mobile-layout).is-reading-topbar-animating .mobile-reading-topbar-content { position: absolute; top: var(--app-safe-area-top, 0px); left: 0; right: 0; overflow: hidden; z-index: 30; }
  .app-shell:not(.prevent-mobile-layout).is-reading-topbar-animating.has-mobile-window-controls .mobile-reading-topbar-content { top: 0; }
  .app-shell:not(.prevent-mobile-layout).is-reading-topbar-animating .mobile-reading-topbar-stack { display: block; background: var(--surface); }
  .app-shell:not(.prevent-mobile-layout).is-reading-topbar-animating :deep(.mobile-top-bar) { min-height: var(--mobile-topbar-height); padding-top: 0; }
  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls :deep(.top-bar.has-window-controls) { position: relative; z-index: 35; }
  .app-shell:not(.prevent-mobile-layout) :deep(.mobile-bottom-nav) { will-change: transform, opacity; transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease; }
  .app-shell:not(.prevent-mobile-layout).reading-navigation-hidden :deep(.mobile-bottom-nav) { transform: translate3d(0, calc(100% + var(--mobile-bottom-nav-offset, 8px) + 16px), 0); opacity: 0; pointer-events: none; }
  /* 仅更新阅读容器本身的内边距与定位属性，不改祖先节点的 CSS 变量，避免全树 3000+ 节点样式重算。 */
  .app-shell:not(.prevent-mobile-layout).reading-navigation-hidden.has-mobile-bottom-nav:not(.has-discovery-navigation) :deep(.feed-scroll-container) { padding-bottom: calc(var(--keyboard-inset, 0px) + var(--app-safe-area-bottom)); }
  .app-shell:not(.prevent-mobile-layout).reading-navigation-hidden.has-mobile-bottom-nav:not(.has-discovery-navigation) :deep(.mobile-sidebar-backdrop) { bottom: var(--app-safe-area-bottom); }
  @media (prefers-reduced-motion: reduce) {
    .app-shell:not(.prevent-mobile-layout) :deep(.mobile-bottom-nav) { transition: none; }
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
    --mobile-bottom-overlay-space: calc(var(--mobile-bottom-nav-height) + var(--mobile-bottom-nav-offset, 8px) + 8px);
  }

  /* 首页与话题的滚动区域延伸至屏幕顶部，玻璃顶栏覆盖其上；首屏按钮和正文分别预留安全区。 */
  .app-shell:not(.prevent-mobile-layout) {
    --mobile-glass-topbar-space: calc(var(--mobile-topbar-height) + var(--app-safe-area-top, 0px));
    --mobile-home-header-fixed-space: calc(var(--mobile-glass-topbar-space) + var(--mobile-section-tabs-height));
  }
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-topic-navigation, .has-discovery-navigation) .mobile-reading-topbar { position: absolute; top: 0; left: 0; right: 0; z-index: 30; grid-template-rows: 1fr; padding-top: 0; }
  .app-shell:not(.prevent-mobile-layout).has-topic-navigation .mobile-reading-topbar { background: var(--topic-glass-tint); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); }
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-discovery-navigation) .mobile-reading-topbar { background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; pointer-events: none; }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation:not(.has-mobile-window-controls) .mobile-reading-topbar::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: var(--app-safe-area-top, 0px); background: var(--home-glass-tint); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); opacity: 0; transition: opacity 180ms ease; pointer-events: none; z-index: 1; }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation:not(.has-mobile-window-controls).reading-navigation-hidden .mobile-reading-topbar::before { opacity: 1; }
  .app-shell:not(.prevent-mobile-layout).has-discovery-navigation:not(.has-mobile-window-controls) .mobile-reading-topbar::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: var(--app-safe-area-top, 0px); background: var(--surface); pointer-events: none; z-index: 1; }
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-topic-navigation, .has-discovery-navigation) .mobile-reading-topbar-content { background: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation .mobile-reading-topbar-stack { display: block; pointer-events: auto; background: var(--home-glass-tint); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); will-change: transform; transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1); }
  /* 数码与发现顶栏、正文区同步做纯合成层位移，避免收起/展开触发 flex 容器重排与布局偏移。 */
  .app-shell:not(.prevent-mobile-layout).has-discovery-navigation .mobile-reading-topbar-stack { display: block; pointer-events: auto; background: var(--surface); will-change: transform; transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1); }
  .app-shell:not(.prevent-mobile-layout).has-discovery-navigation:not(.has-mobile-window-controls) .app-body { margin-top: var(--app-safe-area-top, 0px); }
  .app-shell:not(.prevent-mobile-layout).has-discovery-navigation .app-body { will-change: transform; transform: translate3d(0, var(--mobile-topbar-height), 0); transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1); }
  .app-shell:not(.prevent-mobile-layout):is(.has-home-navigation, .has-discovery-navigation).reading-navigation-hidden .mobile-reading-topbar-stack { transform: translate3d(0, -100%, 0); pointer-events: none; }
  .app-shell:not(.prevent-mobile-layout).has-discovery-navigation.reading-navigation-hidden .app-body { transform: translate3d(0, 0, 0); }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation.reading-navigation-hidden :deep(.mobile-home-pager.has-joined-toolbar .feed-scroll-container) { scroll-padding-top: var(--app-safe-area-top, 0px); }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation.reading-navigation-hidden :deep(.mobile-home-pager.has-joined-toolbar .hot-channel-tabs.is-fixed) { top: var(--app-safe-area-top, 0px); }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation.reading-navigation-hidden :deep(.mobile-home-pager.has-joined-toolbar .has-follow-subchannels .main-feed-column) { padding-top: var(--app-safe-area-top, 0px); }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation.has-mobile-window-controls.reading-navigation-hidden :deep(.mobile-home-pager.has-joined-toolbar .feed-scroll-container) { scroll-padding-top: 0px; }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation.has-mobile-window-controls.reading-navigation-hidden :deep(.mobile-home-pager.has-joined-toolbar .hot-channel-tabs.is-fixed) { top: 0px; }
  .app-shell:not(.prevent-mobile-layout).has-home-navigation.has-mobile-window-controls.reading-navigation-hidden :deep(.mobile-home-pager.has-joined-toolbar .has-follow-subchannels .main-feed-column) { padding-top: 0px; }
  @media (prefers-reduced-motion: reduce) {
    .app-shell:not(.prevent-mobile-layout).has-home-navigation .mobile-reading-topbar-stack,
    .app-shell:not(.prevent-mobile-layout).has-discovery-navigation .mobile-reading-topbar-stack,
    .app-shell:not(.prevent-mobile-layout).has-discovery-navigation .app-body,
    .app-shell:not(.prevent-mobile-layout).has-home-navigation:not(.has-mobile-window-controls) .mobile-reading-topbar::before { transition: none; }
  }
  .app-shell:not(.prevent-mobile-layout).has-mobile-window-controls:is(.has-home-navigation, .has-topic-navigation, .has-discovery-navigation) .mobile-reading-topbar { top: var(--mobile-window-controls-height); }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .app-shell:not(.prevent-mobile-layout).has-topic-navigation .mobile-reading-topbar { background: var(--surface); }
    .app-shell:not(.prevent-mobile-layout).has-home-navigation .mobile-reading-topbar-stack,
    .app-shell:not(.prevent-mobile-layout).has-home-navigation:not(.has-mobile-window-controls) .mobile-reading-topbar::before { background: var(--surface); }
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .app-shell:not(.prevent-mobile-layout).has-topic-navigation .mobile-reading-topbar { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
    .app-shell:not(.prevent-mobile-layout).has-home-navigation .mobile-reading-topbar-stack,
    .app-shell:not(.prevent-mobile-layout).has-home-navigation:not(.has-mobile-window-controls) .mobile-reading-topbar::before { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
  }

  /* 话题仍由吸顶筛选向上延伸玻璃。 */
  .app-shell:not(.prevent-mobile-layout).topic-glass-joined .mobile-reading-topbar { background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .app-shell:not(.prevent-mobile-layout).topic-glass-joined :deep(.topic-sticky-controls) { isolation: isolate; background: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .app-shell:not(.prevent-mobile-layout).topic-glass-joined :deep(.topic-sticky-controls::before) { content: ''; position: absolute; inset: calc(-1 * var(--mobile-glass-topbar-space)) 0 0; z-index: -1; pointer-events: none; background: var(--home-glass-tint, var(--topic-glass-tint)); border-radius: inherit; box-shadow: 0 6px 18px #0000000a, inset 0 -1px 0 var(--home-glass-edge, var(--topic-glass-edge)); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .app-shell:not(.prevent-mobile-layout).topic-glass-joined :deep(.topic-sticky-controls::before) { background: var(--surface); }
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .app-shell:not(.prevent-mobile-layout).topic-glass-joined :deep(.topic-sticky-controls::before) { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
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
    /* WebView 77 不支持 min()，使用宽度上限避免退回折叠侧栏的 56px。 */
    width: calc(100vw - 24px) !important;
    max-width: 460px;
    height: max-content;
    max-height: calc(100% - var(--mobile-navigation-top) - var(--mobile-bottom-overlay-space) - 12px);
    transform: translate3d(-50%, -8px, 0);
    will-change: transform, opacity;
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
    transform: translate3d(-50%, 0, 0);
    visibility: visible;
    pointer-events: auto;
    opacity: 1;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .mobile-navigation-header) {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 14px 16px 8px;
    color: var(--text-primary);
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .mobile-navigation-header strong) {
    font-size: 16px;
    font-weight: 700;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .mobile-navigation-header span) {
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .sidebar-nav) {
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

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .sidebar-settings) {
    margin-top: 0;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .nav-group) {
    display: contents;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .nav-item) {
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

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .nav-label) {
    display: inline !important;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .nav-item.is-active::before) {
    display: none;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .nav-icon) {
    width: auto;
    margin: 0 !important;
    font-size: 18px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .nav-divider) {
    display: block;
    grid-column: 1 / -1;
    width: auto;
    height: 1px;
    margin: 2px 0;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .sidebar-footer) {
    display: flex !important;
    flex: 0 0 auto;
    padding: 12px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .app-info-card) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
    width: 100%;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .app-info-top) {
    grid-column: 1 / -1;
    justify-content: flex-start;
    gap: 8px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .app-info-actions) {
    min-width: 0;
    gap: 8px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .footer-action-btn) {
    min-width: 0;
    min-height: 44px;
    padding: 8px;
    border-radius: 10px;
    font-size: 12px;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .beta-toggle-btn) {
    gap: 6px;
    flex-wrap: wrap;
  }

  .app-shell:not(.prevent-mobile-layout) :deep(.main-sidebar .nav-badge) {
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

  /* 容器转场期间仅禁用导航栏误触，避免对其施加 opacity 动画触发 backdrop-filter 重算模糊掉帧。 */
  .app-shell:not(.prevent-mobile-layout).is-route-container-morphing :deep(.mobile-bottom-nav),
  .app-shell:not(.prevent-mobile-layout).is-route-container-morphing .mobile-reading-topbar-stack,
  .app-shell:not(.prevent-mobile-layout).is-route-container-morphing :deep(.mobile-top-bar) {
    pointer-events: none;
  }
}
</style>
