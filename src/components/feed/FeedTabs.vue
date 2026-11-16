<template>
  <div class="feed-tabs-wrapper">
    <div :class="['feed-tabs', { 'is-wrap': props.wrap }, 'custom-scrollbar']" ref="tabsContainer" @wheel.passive="handleWheel">
      <button
        v-for="tab in tabs"
        :key="getTabKey(tab)"
        :class="['tab-item', { 'is-active': activeKey === getTabKey(tab) }]"
        @click="$emit('update:activeKey', getTabKey(tab))"
      >
        <span class="tab-label">{{ tab.title }}</span>
        <span v-if="props.wrap && activeKey === getTabKey(tab)" class="coolapk-tab-indicator" aria-hidden="true"></span>
      </button>
      <span ref="indicator" v-if="!props.wrap" class="coolapk-tab-indicator sliding-indicator" :class="{ 'follows-pager': props.swipeProgress !== undefined }" aria-hidden="true"></span>
    </div>

    <!-- 官方右侧 ☰ 频道管理按钮 -->
    <button
      v-if="props.showManage"
      class="tab-manage-btn"
      :title="props.managerMode === 'picker' ? '查看全部栏目' : '频道管理与排序'"
      @click="showTabManager = true"
    >
      <i class="fas fa-bars"></i>
    </button>

    <!-- 频道管理弹窗 (九宫格/磁贴网格) -->
    <!-- 玻璃导航会形成定位容器，弹窗挂到页面根节点以覆盖完整窗口。 -->
    <Teleport to="body">
    <TabManagerModal
      :visible="showTabManager"
      :tabs="props.managerTabs || tabs"
      :active-key="activeKey"
      :active-sub-tab-key="props.activeSubTabKey"
      :selection-only="props.managerMode === 'picker'"
      @close="showTabManager = false"
      @select-tab="$emit('update:activeKey', $event)"
      @select-sub-tab="$emit('selectSubTab', $event)"
      @updated="$emit('tabOrderUpdated')"
    />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { observeResizeOnFrame } from '../../utils/observeResizeOnFrame';
import { nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ConfigPageTab } from '../../types/settings';
import type { HomeSubChannelSelection } from '../../utils/homeTabs';
import TabManagerModal from './TabManagerModal.vue';

const props = withDefaults(defineProps<{
  activeKey: string;
  tabs: ConfigPageTab[];
  showManage?: boolean;
  managerMode?: 'editable' | 'picker';
  wrap?: boolean;
  activeSubTabKey?: string;
  managerTabs?: ConfigPageTab[];
  swipeProgress?: number;
}>(), {
  showManage: true,
  managerMode: 'editable',
  wrap: false,
  activeSubTabKey: '',
});

defineEmits<{
  (e: 'update:activeKey', key: string): void;
  (e: 'tabOrderUpdated'): void;
  (e: 'selectSubTab', selection: HomeSubChannelSelection): void;
}>();

const showTabManager = ref(false);
const tabsContainer = ref<HTMLElement | null>(null);
const indicator = ref<HTMLElement | null>(null);
let tabCenters: number[] = [];
let pagerProgress: number | undefined;
function setSwipeProgress(progress: number) {
  pagerProgress = progress;
  if (!indicator.value || !tabCenters.length) return;
  const value = Math.max(0, Math.min(tabCenters.length - 1, progress));
  const from = tabCenters[Math.floor(value)], to = tabCenters[Math.ceil(value)];
  if (!indicator.value.classList.contains('follows-pager')) indicator.value.classList.add('follows-pager');
  indicator.value.style.transform = `translate3d(${from + (to - from) * (value % 1)}px, 0, 0)`;
  indicator.value.style.opacity = '1';
}
defineExpose({ setSwipeProgress });
let stopObservingResize: (() => void) | undefined;
let disposed = false;

async function alignActiveTab() {
  await nextTick();
  if (disposed) return;
  const container = tabsContainer.value;
  const activeTab = container?.querySelector<HTMLElement>('.tab-item.is-active');
  if (!container || !activeTab || !container.clientWidth) return;
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('.tab-item'));
  const center = (button: HTMLElement) => button.offsetLeft + (button.offsetWidth - 22) / 2;
  tabCenters = buttons.map(center);
  const progress = props.swipeProgress ?? pagerProgress ?? buttons.indexOf(activeTab);
  if (props.swipeProgress !== undefined || pagerProgress !== undefined) setSwipeProgress(progress);
  else if (indicator.value) {
    indicator.value.style.transform = `translate3d(${tabCenters[buttons.indexOf(activeTab)]}px, 0, 0)`;
    indicator.value.style.opacity = '1';
  }
  if (props.wrap) return;
  const start = activeTab.offsetLeft - 12;
  const end = activeTab.offsetLeft + activeTab.offsetWidth + 12;
  let left = container.scrollLeft;
  if (start < left) left = start;
  else if (end > left + container.clientWidth) left = end - container.clientWidth;
  left = Math.max(0, Math.min(left, container.scrollWidth - container.clientWidth));
  if (Math.abs(left - container.scrollLeft) > 1) {
    container.scrollTo({ left, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

watch(() => [props.activeKey, props.tabs, props.wrap], () => { void alignActiveTab(); }, { immediate: true, deep: true });
watch(() => props.swipeProgress, value => { if (value !== undefined) setSwipeProgress(value); });
onMounted(() => {
  if (tabsContainer.value) stopObservingResize = observeResizeOnFrame(tabsContainer.value, () => { void alignActiveTab(); });
  void document.fonts?.ready.then(() => alignActiveTab());
});
onActivated(() => { void alignActiveTab(); });
onUnmounted(() => { disposed = true; stopObservingResize?.(); });

function getTabKey(tab: ConfigPageTab): string {
  return tab.page_name || tab.url || String(tab.id || tab.title);
}

function handleWheel(e: WheelEvent) {
  if (tabsContainer.value && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    tabsContainer.value.scrollLeft += e.deltaY;
  }
}
</script>

<style scoped>
.feed-tabs-wrapper {
  display: flex;
  align-items: center;
  background-color: var(--surface);
  border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  height: 48px;
  position: relative;
  flex-shrink: 0;
  width: 100%;
}

.feed-tabs-wrapper:has(.feed-tabs.is-wrap) {
  height: auto;
  min-height: 48px;
}

.feed-tabs {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  height: 100%;
  overflow-x: auto;
  flex: 1;
  user-select: none;
  scrollbar-width: none;
}

.feed-tabs::-webkit-scrollbar {
  display: none;
}

.feed-tabs.is-wrap {
  flex-wrap: wrap;
  height: auto;
  min-height: 48px;
  overflow-x: hidden;
  overflow-y: hidden;
  padding-top: 4px;
  padding-bottom: 4px;
}

.tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 6px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: color var(--duration-fast, 0.15s) var(--ease-default, ease);
  min-height: 44px;
  flex-shrink: 0;
  white-space: nowrap;
  background: transparent;
  cursor: pointer;
  border: none;
  outline: none;
}

.tab-item:hover {
  color: var(--text-primary);
}

.tab-item.is-active {
  color: var(--text-primary);
  font-weight: 700;
}

/* 酷安 APP 标志性绿色下划弧线/胶囊滑块指示器 */
.coolapk-tab-indicator {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 22px;
  height: 3.5px;
  background: linear-gradient(90deg, #10b981 0%, #059669 100%);
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4);
  pointer-events: none;
}

.sliding-indicator {
  left: 0;
  bottom: 6px;
  will-change: transform, opacity;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease;
}

.tab-manage-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 100%;
  background: linear-gradient(to right, transparent, var(--surface) 25%);
  border: none;
  color: var(--text-secondary);
  font-size: 15px;
  cursor: pointer;
  padding-right: 12px;
  transition: color 0.15s ease;
  flex-shrink: 0;
}

.tab-manage-btn:hover {
  color: var(--primary, #10b981);
}

@keyframes tabSlideIn {
  from {
    width: 0px;
    opacity: 0;
  }
  to {
    width: 22px;
    opacity: 1;
  }
}
.sliding-indicator.follows-pager { transition: none; }
</style>
