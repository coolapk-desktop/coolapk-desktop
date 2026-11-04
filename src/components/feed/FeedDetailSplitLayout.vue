<template>
  <!-- 分栏详情页容器：左栏动态卡片（detail 模式，互动列表交给宿主渲染），
       右栏评论/点赞/转发由 FeedDetailAside 自行取数维护。
       右栏按 feed.id 加 key：FeedDetailAside 内部不监听 feed.id 变化，
       父层跨动态复用时必须重新挂载，否则评论数据会串到上一条动态。 -->
  <div ref="container" class="feed-detail-split" :class="{ 'is-resizing': dragging }">
    <div class="feed-detail-split-left" :style="{ flexBasis: `${leftWidth}px` }">
      <FeedCard
        :feed="feed"
        detail-mode
        :disable-inline-comments="true"
        :external-interaction-lists="true"
        :auto-open-comments="false"
        @open-comment="activeTab = 'replies'"
        @open-like-list="activeTab = 'likes'"
        @open-forward-list="activeTab = 'forwards'"
      />
    </div>
    <!-- 分隔条支持拖动、方向键微调和双击复位，位置在所有动态详情间共用。 -->
    <div class="feed-detail-split-handle" role="separator" tabindex="0" aria-label="调节动态与评论分栏宽度" aria-orientation="vertical" :aria-valuemin="Math.round(limits.min / availableWidth * 100)" :aria-valuemax="Math.round(limits.max / availableWidth * 100)" :aria-valuenow="Math.round(leftWidth / availableWidth * 100)" title="拖动调节宽度，双击恢复默认" @pointerdown="startResize" @keydown="resizeWithKeyboard" @dblclick="resetWidth"></div>
    <div class="feed-detail-split-right">
      <FeedDetailAside :key="feed.id" v-model:active-tab="activeTab" :feed="feed" :target-reply-id="targetReplyId" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { observeResizeOnFrame } from '../../utils/observeResizeOnFrame';
import { usePersistedColumnResize } from '../../composables/usePersistedColumnResize';
import FeedCard from './FeedCard.vue';
import FeedDetailAside from './FeedDetailAside.vue';

const props = defineProps<{
  feed: any;
  targetReplyId?: string;
}>();

// 右栏当前 tab：左栏卡片点评论/点赞/转发入口时切换过来，
// 右栏自己点 tab 也会经 update:activeTab 同步回来。
const activeTab = ref<'replies' | 'likes' | 'forwards'>('replies');
// 缓存详情曾停在点赞或转发时，通知指定回复仍必须切回评论栏。
watch(() => props.targetReplyId, id => { if (id) activeTab.value = 'replies'; }, { immediate: true });

const container = ref<HTMLElement | null>(null);
const containerWidth = ref(1000);
const availableWidth = computed(() => Math.max(1, containerWidth.value - 8));
// 缩小窗口只限制显示宽度，不覆盖用户已经保存的位置。
const limits = computed(() => ({ min: Math.min(420, availableWidth.value * .5), max: availableWidth.value - Math.min(320, availableWidth.value * .4) }));
const { visibleWidth: leftWidth, dragging, startResize, resetWidth, restoreWidth, resizeWithKeyboard } = usePersistedColumnResize({ storageKey: 'coolapk_feed_detail_left_width', defaultWidth: () => availableWidth.value * .45, limits: () => limits.value });
let stopObserving: (() => void) | undefined;
function measureWidth() { containerWidth.value = container.value?.getBoundingClientRect().width || containerWidth.value; }
onMounted(() => {
  measureWidth();
  restoreWidth();
  if (container.value) stopObserving = observeResizeOnFrame(container.value, measureWidth);
});
onActivated(() => { measureWidth(); restoreWidth(); });
onUnmounted(() => { stopObserving?.(); });
</script>

<style scoped>
/* 高度约束完全来自 height: 100%：FeedDetailAside 根元素是 height:100% + overflow-y:auto，
   只有父层有确定高度时它才会独立滚动；两栏各自 overflow-y:auto，互不干扰。 */
.feed-detail-split {
  display: flex;
  height: 100%;
  min-width: 0;
}

.feed-detail-split-left {
  flex: 0 0 auto;
  min-width: 0;
  overflow-y: auto;
}

.feed-detail-split-handle { flex: 0 0 8px; position: relative; cursor: col-resize; touch-action: none; background: var(--surface); outline: none; }
.feed-detail-split-handle::after { content: ''; position: absolute; inset: 0 3px; background: transparent; transition: background var(--duration-fast); }
.feed-detail-split-handle:hover::after, .feed-detail-split-handle:focus-visible::after, .is-resizing .feed-detail-split-handle::after { background: var(--brand-primary); }
.is-resizing { user-select: none; }

.feed-detail-split-right {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
}
</style>
