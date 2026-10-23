<template>
  <div class="mobile-home-pager" :class="{ 'desktop-home-pager': !mobile, 'is-pager-moving': moving }">
    <div class="home-main-column">
    <div class="home-toolbar">
    <FeedTabs :active-key="activeKey" :tabs="tabs" :manager-tabs="serverTabs" :swipe-progress="position" :active-sub-tab-key="activePanel?.activeFollowSubChannelKey || ''" @update:active-key="select" @select-sub-tab="selectSubTab" />
    <FeedLayoutToggle v-if="!mobile" v-model="settings.settings.feedLayout" />
    </div>
    <div v-if="error" class="pager-warning" role="status"><span>{{ error }}</span><button type="button" @click="loadTabs">重试</button></div>
    <div v-if="!tabs.length" class="pager-state">正在加载栏目…</div>
    <div v-else ref="viewport" class="pager-viewport" @pointerdown="startDrag" @click.capture="blockSwipeClick" @wheel="wheel">
      <div class="pager-track" :style="{ transform: `translate3d(${-position * width}px,0,0)` }">
        <section v-for="(tab, index) in tabs" :key="getHomeTabKey(tab)" class="pager-page" :style="{ left: `${index * 100}%` }" :inert="index !== activeIndex || undefined" :aria-hidden="index !== activeIndex" :data-tab-key="getHomeTabKey(tab)">
          <HomeTabPanel v-if="visited.has(getHomeTabKey(tab)) || index === activeIndex || (mobile && Math.abs(index - activeIndex) <= 1)" :ref="el => setPanel(getHomeTabKey(tab), el)" embedded :tab-key="getHomeTabKey(tab)" :tabs="serverTabs" :selected="index === activeIndex" />
        </section>
      </div>
    </div>
    </div>
    <RightSidebar v-if="sidebarMounted && (settings.settings.showHomeHotNews || settings.settings.showHomeMonthlyRank || settings.settings.showHomeHotTopics)" v-show="!mobile && !desktopCommentsOpen" :show-hot-news="settings.settings.showHomeHotNews" :show-monthly-rank="settings.settings.showHomeMonthlyRank" :show-hot-topics="settings.settings.showHomeHotTopics" />
  </div>
</template>
<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, onActivated, onDeactivated, provide, reactive, ref, watch } from 'vue';
import FeedTabs from './FeedTabs.vue';
import FeedLayoutToggle from './FeedLayoutToggle.vue';
import RightSidebar from '../layout/RightSidebar.vue';
import HomeTabPanel from '../../pages/HomeTabPanel.vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { useSettingsStore } from '../../stores/settings';
import { getHomeTabKey, resolvePreferredHomeTab, type HomeSubChannelSelection } from '../../utils/homeTabs';
import type { ConfigPageTab } from '../../types/settings';
import { homePagerMovingKey } from '../../utils/feedPageVisibility';
import { observeResizeOnFrame } from '../../utils/observeResizeOnFrame';
import { logDiagnostic, summarizeDiagnosticError } from '../../utils/diagnosticLogger';
import { desktopFeedCommentsOpenKey } from '../../utils/desktopFeedComments';
import { mobileReadingNavigationKey } from '../../composables/useMobileReadingNavigation';

const props = withDefaults(defineProps<{ mobile?: boolean }>(), { mobile: true });
const desktopCommentsOpen = inject(desktopFeedCommentsOpenKey, ref(false));
const readingNavigation = inject(mobileReadingNavigationKey, undefined);
const sidebarMounted = ref(!props.mobile);
const settings = useSettingsStore();
const serverTabs = ref<ConfigPageTab[]>([]), activeKey = ref(''), error = ref('');
const position = ref(0), width = ref(1), viewport = ref<HTMLElement | null>(null);
const moving = ref(false);
watch(activeKey, () => readingNavigation?.reset());
provide(homePagerMovingKey, moving);
const visited = reactive(new Set<string>());
type Panel = { activeFollowSubChannelKey: string; handleHomeSubChannelSelected: (selection: HomeSubChannelSelection) => void };
const panels = reactive(new Map<string, Panel>());
const activePanel = computed(() => panels.get(activeKey.value));
function setPanel(key: string, el: unknown) {
  if (el) { panels.set(key, el as Panel); visited.add(key); }
  else panels.delete(key);
}
const tabs = computed(() => {
  const source = serverTabs.value, order = settings.settings.homeTabOrder || [];
  if (!order.length) return source;
  const visible = source.filter(tab => !order.includes(`__hidden__${getHomeTabKey(tab)}`));
  return (visible.length ? visible : source.slice(0, 1)).slice().sort((a, b) => {
    const ai = order.indexOf(getHomeTabKey(a)), bi = order.indexOf(getHomeTabKey(b));
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
});
const activeIndex = computed(() => Math.max(0, tabs.value.findIndex(tab => getHomeTabKey(tab) === activeKey.value)));
// 服务端异常时先提供可用频道，重试成功后恢复完整的动态栏目。
const fallbackHomeTabs: ConfigPageTab[] = [
  { title: '头条', page_name: 'V9_HOME_TAB_HEADLINE', url: '/main/headline' },
  { title: '热榜', page_name: 'V9_HOME_TAB_RANKING', url: 'V9_HOME_TAB_RANKING' },
  { title: '快讯', page_name: 'V11_HOME_TAB_NEWS', url: 'V11_HOME_TAB_NEWS' },
];
async function loadTabs() {
  error.value = '';
  try {
    const response = await CoolapkTauriAPI.getTabConfig();
    const data = response?.data;
    if (!Array.isArray(data)) throw new Error('首页栏目配置数据不是数组');
    const card = data.find((item: any) =>
      (String(item?.entityId) === '6390' ||
        (item?.entityTemplate === 'configCard' &&
          (item?.title === '首页' || String(item?.title || '').includes('TAB配置')))) &&
      Array.isArray(item?.entities) && item.entities.length > 0);
    if (!card) throw new Error(`未获取到首页栏目（配置卡片数：${data.length}）`);
    serverTabs.value = card.entities.filter((tab: ConfigPageTab) =>
      tab.page_name !== 'V9_HOME_TAB_TOPIC' && !tab.url?.includes('V9_HOME_TAB_TOPIC') && tab.title !== '话题');
    if (!serverTabs.value.length) throw new Error('首页栏目全部不可用');
  } catch (err) {
    const hadTabs = serverTabs.value.length > 0;
    if (!hadTabs) serverTabs.value = fallbackHomeTabs.map(tab => ({ ...tab }));
    error.value = hadTabs ? '栏目暂时无法更新，已保留当前栏目' : '栏目暂时无法加载，已启用基础栏目';
    logDiagnostic('warn', 'home', 'tab_config_fallback', summarizeDiagnosticError(err));
  }
  activeKey.value = resolvePreferredHomeTab(tabs.value, settings.settings.defaultHomeTab);
  position.value = activeIndex.value;
  visited.add(activeKey.value);
  await nextTick(); measure();
}
let frame = 0, clickUntil = 0;
let stopObservingResize: (() => void) | undefined;
type Drag = { id: number; x: number; y: number; origin: number; lastX: number; lastTime: number; velocity: number; axis: 'pending' | 'horizontal' };
let drag: Drag | null = null;
function stopAnimation() { cancelAnimationFrame(frame); frame = 0; }
function settle(target: number) {
  stopAnimation();
  target = Math.max(0, Math.min(tabs.value.length - 1, target));
  const from = position.value, start = performance.now();
  const finish = () => { position.value = target; activeKey.value = getHomeTabKey(tabs.value[target]!); visited.add(activeKey.value); frame = 0; moving.value = false; };
  if (!props.mobile || window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(target - from) < .001) { finish(); return; }
  moving.value = true;
  const animate = (now: number) => {
    const progress = Math.min(1, (now - start) / 260);
    position.value = from + (target - from) * (1 - Math.pow(1 - progress, 3));
    if (progress < 1) frame = requestAnimationFrame(animate); else finish();
  };
  frame = requestAnimationFrame(animate);
}
function select(key: string) {
  const index = tabs.value.findIndex(tab => getHomeTabKey(tab) === key);
  if (index < 0) return;
  drag = null;
  if (props.mobile) {
    for (let i = Math.min(Math.floor(position.value), index); i <= Math.max(Math.ceil(position.value), index); i++) {
      const tab = tabs.value[i]; if (tab) visited.add(getHomeTabKey(tab));
    }
  } else {
    visited.add(key);
  }
  settle(index);
}
async function selectSubTab(selection: HomeSubChannelSelection) {
  select(selection.parentKey);
  await nextTick();
  panels.get(selection.parentKey)?.handleHomeSubChannelSelected(selection);
}
function nestedScroller(target: EventTarget | null) {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== viewport.value) {
    const overflow = getComputedStyle(el).overflowX;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollWidth > el.clientWidth + 1) return true;
    el = el.parentElement;
  }
  return false;
}
function startDrag(event: PointerEvent) {
  if (!event.isPrimary || event.pointerType === 'mouse' || nestedScroller(event.target)) return;
  if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  stopAnimation();
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: position.value, lastX: event.clientX, lastTime: performance.now(), velocity: 0, axis: 'pending' };
}
function moveDrag(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (drag.axis === 'pending') {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
    if (Math.abs(dx) <= Math.abs(dy) * 1.25) { drag = null; settle(activeIndex.value); return; }
    drag.axis = 'horizontal'; viewport.value?.setPointerCapture(event.pointerId);
    moving.value = true;
  }
  const now = performance.now(), elapsed = now - drag.lastTime;
  if (elapsed > 0) drag.velocity = (event.clientX - drag.lastX) / elapsed;
  drag.lastX = event.clientX; drag.lastTime = now;
  const desired = drag.origin - dx / width.value, last = tabs.value.length - 1;
  // 首尾保留阻尼，松手回到边界。
  position.value = desired < 0 ? desired * .2 : desired > last ? last + (desired - last) * .2 : desired;
  clickUntil = now + 500;
  event.preventDefault();
}
function endDrag(event: PointerEvent, cancelled = false) {
  if (!drag || drag.id !== event.pointerId) return;
  const gesture = drag; drag = null;
  if (gesture.axis !== 'horizontal') { settle(activeIndex.value); return; }
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId);
  const dx = event.clientX - gesture.x;
  const velocity = performance.now() - gesture.lastTime > 100 ? 0 : gesture.velocity;
  const change = !cancelled && (Math.abs(dx) > width.value * .22 || (Math.abs(dx) > 12 && Math.abs(velocity) > .45));
  settle(change ? activeIndex.value + (dx < 0 ? 1 : -1) : activeIndex.value);
  clickUntil = performance.now() + 400;
}
function cancelDrag(event: PointerEvent) { endDrag(event, true); }
function pointerUp(event: PointerEvent) { endDrag(event); }
function blockSwipeClick(event: MouseEvent) {
  if (performance.now() < clickUntil) { event.preventDefault(); event.stopPropagation(); }
}
let wheelDelta = 0, wheelTimer: ReturnType<typeof setTimeout> | undefined;
function wheel(event: WheelEvent) {
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || nestedScroller(event.target)) return;
  event.preventDefault();
  if (frame) return;
  wheelDelta += event.deltaX;
  if (Math.abs(wheelDelta) >= 56) { settle(activeIndex.value + (wheelDelta > 0 ? 1 : -1)); wheelDelta = 0; }
  clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { wheelDelta = 0; }, 260);
}
function measure() { width.value = Math.max(1, viewport.value?.clientWidth || 1); }
watch(() => props.mobile, () => {
  // 改变布局时结束未完成的手势，保留已选栏目及其页面实例。
  resetGesture();
  clickUntil = 0;
  if (!props.mobile) sidebarMounted.value = true;
  void nextTick(measure);
});
function bind() {
  window.addEventListener('pointermove', moveDrag, { passive: false });
  window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', cancelDrag);
}
function unbind() {
  window.removeEventListener('pointermove', moveDrag); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', cancelDrag);
  resetGesture();
}
function resetGesture() {
  drag = null; stopAnimation(); position.value = activeIndex.value; moving.value = false; clearTimeout(wheelTimer); wheelDelta = 0;
}
watch(tabs, () => { if (tabs.value.length && !tabs.value.some(tab => getHomeTabKey(tab) === activeKey.value)) activeKey.value = getHomeTabKey(tabs.value[0]!); if (!drag && !frame) position.value = activeIndex.value; });
function observeViewport() {
  stopObservingResize?.();
  stopObservingResize = viewport.value ? observeResizeOnFrame(viewport.value, measure) : undefined;
  measure();
}
onMounted(() => { bind(); void loadTabs(); observeViewport(); });
watch(viewport, observeViewport);
onActivated(bind); onDeactivated(unbind);
onUnmounted(() => { unbind(); stopObservingResize?.(); });
</script>
<style scoped>
.mobile-home-pager { container-type: inline-size; container-name: home-layout; display: flex; width: 100%; height: 100%; min-height: 0; overflow: hidden; background: var(--surface); }
.home-main-column { position: relative; display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.home-toolbar { display: flex; flex: 0 0 auto; min-width: 0; }
.home-toolbar :deep(.feed-tabs-wrapper) { flex: 1; min-width: 0; }
.desktop-home-pager .home-main-column { border-right: 1px solid var(--border); }
@container home-layout (max-width: 960px) { :deep(.right-sidebar) { display: none !important; } }
.pager-viewport { position: relative; flex: 1; min-height: 0; overflow: hidden; touch-action: pan-y; }
.pager-track { position: relative; height: 100%; width: 100%; will-change: transform; }
.pager-page { position: absolute; top: 0; width: 100%; height: 100%; overflow: hidden; }
.pager-warning { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 8px 12px; font-size: 12px; color: var(--text-secondary); }
.pager-warning button { min-height: 32px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: inherit; cursor: pointer; }
.pager-state { padding: 24px; text-align: center; color: var(--text-secondary); }
.pager-state button { min-height: 44px; }
/* 移动首页栏目浮在动态上方，滚动内容进入玻璃背后；顶部留白保证首屏内容可见。 */
@media (max-width: 720px) {
  .mobile-home-pager:not(.desktop-home-pager) .home-toolbar { position: absolute; top: var(--mobile-glass-topbar-space, 0px); left: 0; right: 0; z-index: 2; height: 48px; background: var(--home-glass-tint, color-mix(in srgb, var(--surface) 45%, transparent)); border-radius: 0; box-shadow: 0 6px 18px #0000000a, inset 0 -1px 0 var(--home-glass-edge, #ffffffa6); -webkit-backdrop-filter: blur(24px) saturate(165%); backdrop-filter: blur(24px) saturate(165%); transition: top 200ms ease; }
  .mobile-home-pager:not(.desktop-home-pager) .home-toolbar :deep(.feed-tabs-wrapper) { background: transparent; border-bottom: 0; }
  .mobile-home-pager:not(.desktop-home-pager) .home-toolbar :deep(.tab-manage-btn) { background: transparent; border-radius: 0; }
  .mobile-home-pager:not(.desktop-home-pager) :deep(.feed-scroll-container) { padding-top: calc(var(--mobile-glass-topbar-space, 0px) + 48px); scroll-padding-top: calc(var(--mobile-glass-topbar-space, 0px) + 48px); transition: padding-top 200ms ease; }
  /* 关注子栏目位于滚动容器外，先为悬浮主栏目让位，动态区不再重复留白。 */
  .mobile-home-pager:not(.desktop-home-pager) :deep(.has-follow-subchannels .main-feed-column) { box-sizing: border-box; padding-top: calc(var(--mobile-glass-topbar-space, 0px) + 48px); transition: padding-top 200ms ease; }
  .mobile-home-pager:not(.desktop-home-pager) :deep(.has-follow-subchannels .feed-scroll-container) { padding-top: 0; scroll-padding-top: 0; }
  @media (prefers-reduced-motion: reduce) { .mobile-home-pager:not(.desktop-home-pager) .home-toolbar, .mobile-home-pager:not(.desktop-home-pager) :deep(.feed-scroll-container), .mobile-home-pager:not(.desktop-home-pager) :deep(.has-follow-subchannels .main-feed-column) { transition: none; } }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .mobile-home-pager:not(.desktop-home-pager) .home-toolbar { background: var(--surface); } }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) { .mobile-home-pager:not(.desktop-home-pager) .home-toolbar { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; } }
}
</style>
