<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy }" class="feed-detail-page custom-scrollbar" :data-resource-scroll-root="!showSplit || undefined" :class="{ 'is-official-mobile': officialMobileDetail, 'is-split': showSplit, 'no-image-detail-enabled': detailImagesEnabled, 'reading-actions-hidden': detailReading.hidden.value }" @scroll.capture="detailReading.onScroll" @wheel.capture.passive="detailReading.onWheel" @touchstart.capture.passive="detailReading.onTouchStart" @touchmove.capture.passive="detailReading.onTouchMove">
    <button v-if="officialMobileDetail && (!feedDetail || isAnswerDetail)" type="button" aria-label="返回" class="detail-fallback-back" @click="navigateBack(router)"><i class="fas fa-arrow-left"></i> 返回</button>
    <div ref="detailShellRef" class="feed-detail-shell" :class="{ 'enter-at-comments': entryPosition === 'comments' }">
      <LoadingState v-if="loading && !feedDetail" text="正在加载原动态..." />
      <ErrorState
        v-else-if="error && !feedDetail"
        title="原动态加载失败"
        :message="error"
        @retry="fetchDetail"
      />
      <QuestionAnswerCard
        ref="refreshAnswerCard"
        v-else-if="feedDetail && isAnswerDetail"
        :answer="feedDetail"
        :official-mobile-detail="officialMobileDetail"
        detail-mode
        :auto-open-comments="!loading"
        :target-reply-id="targetReplyId"
        :question-id="answerQuestionId"
        :question-title="answerQuestionTitle"
        :show-related-content="false"
      />
      <!-- 分栏分支必须在 FeedCard 之前，否则永远命中不到。 -->
      <FeedDetailSplitLayout
        v-else-if="showSplit"
        :key="feedId"
        :feed="feedDetail"
      />
      <FeedCard
        ref="refreshFeedCard"
        v-else-if="feedDetail"
        :feed="feedDetail"
        :official-mobile-detail="officialMobileDetail"
        detail-mode
        :auto-open-comments="officialMobileDetail || !loading"
        :target-reply-id="targetReplyId"
      />
      <EmptyState v-else title="原动态不存在" description="这条动态可能已经被删除" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, inject, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { navigateBack } from '../utils/navigation';
import { CoolapkTauriAPI } from '../api/coolapk';
import { useAppStore } from '../stores/app';
import FeedCard from '../components/feed/FeedCard.vue';
import FeedDetailSplitLayout from '../components/feed/FeedDetailSplitLayout.vue';
import QuestionAnswerCard from '../components/question/QuestionAnswerCard.vue';
import LoadingState from '../components/common/LoadingState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { isAnswerSearchEntity } from '../utils/searchEntities';
import { useMobileLayout, useOfficialMobileFeedDetail, useWideSplitLayout } from '../composables/useOfficialMobileFeedDetail';
import { usePageTabTitle } from '../composables/usePageTabTitle';
import { useSettingsStore } from '../stores/settings';
import { provideDetailImageScope } from '../composables/useNoImageMode';
import { mobileDetailActionsHiddenKey, useMobileReadingNavigation } from '../composables/useMobileReadingNavigation';
import { feedPageVisibleKey } from '../utils/feedPageVisibility';
import { routeNavigationIsHistory } from '../utils/routeScroll';
import { observeResizeOnFrame } from '../utils/observeResizeOnFrame';

defineOptions({ name: 'FeedDetailPage' });
const detailImagesEnabled = provideDetailImageScope();

const props = defineProps<{
  feedId: string;
}>();

const router = useRouter();
const route = useRoute();
const targetReplyId = computed(() => {
  if (String(route.params.id || route.params.feedId || '') !== String(props.feedId)) return '';
  const id = String(route.query.replyId || '');
  return /^[1-9]\d*$/.test(id) ? id : '';
});
const appStore = useAppStore();
const settingsStore = useSettingsStore();
const officialMobileDetail = useOfficialMobileFeedDetail();
// 详情底栏沿用阅读导航设置；缓存页面和搜索、发布、大图浮层期间恢复状态。
const detailActive = ref(true);
const detailShellRef = ref<HTMLElement | null>(null);
const refreshFeedCard = ref<InstanceType<typeof FeedCard> | null>(null);
const refreshAnswerCard = ref<InstanceType<typeof QuestionAnswerCard> | null>(null);
let entryPositionApplied = false;
let stopHeaderResize: (() => void) | undefined;

/** 顶栏高度包含状态栏安全区及字体适配，评论吸顶与入口定位共用实际测量值。 */
function commentStickyHeader() {
  if (!officialMobileDetail.value) return null;
  // 回答详情使用页面返回栏，同样需要为它及安全区留出评论定位空间。
  return detailShellRef.value?.querySelector<HTMLElement>('.official-detail-author') || detailShellRef.value?.parentElement?.querySelector<HTMLElement>('.detail-fallback-back');
}
function updateCommentHeaderHeight() {
  const shell = detailShellRef.value;
  const header = commentStickyHeader();
  const height = header?.getBoundingClientRect().height || 0;
  if (height > 0) shell?.style.setProperty('--feed-detail-header-height', `${height}px`);
  else shell?.style.removeProperty('--feed-detail-header-height');
  return height;
}

async function observeCommentHeader() {
  await nextTick();
  // 多个数据变化可能在同一帧触发，挂载新观察器前先释放上一份订阅。
  stopHeaderResize?.();
  stopHeaderResize = undefined;
  if (!detailActive.value) return;
  updateCommentHeaderHeight();
  const header = commentStickyHeader();
  if (header) stopHeaderResize = observeResizeOnFrame(header, updateCommentHeaderHeight);
}
watch([detailShellRef, officialMobileDetail, detailActive], () => { void observeCommentHeader(); }, { flush: 'post' });
onUnmounted(() => stopHeaderResize?.());

const detailVisible = inject(feedPageVisibleKey, ref(true));
// Teleport 内容不随缓存页面一起隐藏，必须同时校验该详情实例所属的完整路由。
const ownerRoute = route.fullPath;
const detailInteractive = computed(() => detailActive.value && detailVisible.value && route.fullPath === ownerRoute);
provide(feedPageVisibleKey, detailInteractive);
const detailReading = useMobileReadingNavigation(computed(() => officialMobileDetail.value && detailInteractive.value
  && settingsStore.settings.autoHideMobileNavigation && !appStore.isSearchOpen && !appStore.isPublishOpen && !appStore.activeImageViewer), '.feed-detail-page.is-official-mobile');
provide(mobileDetailActionsHiddenKey, detailReading.hidden);
onActivated(() => { detailActive.value = true; entryPositionApplied = false; void applyEntryPosition(); });
onDeactivated(() => { detailActive.value = false; stopHeaderResize?.(); });
// 注意：判据用 `mobileLayout`（纯布局）而不是 `officialMobileDetail`。
// 后者是「布局 × officialMobileFeedDetail 开关」的合取 —— 用户关掉那个开关后，
// 触摸设备上它也是 false，于是平板会误入分栏。与点击侧（FeedCard 的
// opensDetailOnClick 同样用 mobileLayout）保持同一判据。
const mobileLayout = useMobileLayout();
const isWideEnoughForSplit = useWideSplitLayout();
// 右侧评论由总开关决定，与点击动态是否进入详情页无关；仍只在桌面宽窗口分栏。
const useSplitLayout = computed(() =>
  settingsStore.settings.desktopCommentsOnRight
  && !mobileLayout.value
  && isWideEnoughForSplit.value
);
// 路由缓存通常会为每个动态保留独立实例；同时监听参数可兼容热更新或组件复用。
const feedId = computed(() => String(props.feedId || ''));

function normalizeContextFeed(item: any): any {
  if (!item) return null;
  const candidates = [item.feedInfo, item.targetRow, item.targetFeed, item];
  return candidates.find((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    if (/reply|comment/i.test(String(candidate.entityType || candidate.entity_type || candidate.target_type || ''))) return false;
    // 必须有真实正文与发帖人信息，避免仅携带标题的历史记录外壳导致残缺首屏闪烁
    const hasMessage = Boolean(candidate.message || candidate.message_raw_output || candidate.note);
    const hasUser = Boolean(candidate.username || candidate.userInfo?.username || candidate.uid || candidate.userAvatar);
    return hasMessage && hasUser;
  }) || null;
}

const feedDetail = ref<any>(normalizeContextFeed(appStore.getFeedDetailContext(feedId.value)));
usePageTabTitle(computed(() => {
  const username = String(feedDetail.value?.username || feedDetail.value?.userInfo?.username || '').trim();
  return username ? `${username} 的动态` : null;
}));
const isAnswerDetail = computed(() => Boolean(feedDetail.value && isAnswerSearchEntity(feedDetail.value)));
// is-split 只能挂在真正渲染分栏的分支上：回答详情、加载中/出错/空态渲染的都是其它分支，
// 挂上 is-split 会把页面设成 overflow:hidden、shell 设成 height:100%，而这些分支没有
// 内部滚动容器（QuestionAnswerCard 根元素 overflow:hidden），首屏之外的内容会被裁掉且滚不动。
const showSplit = computed(() =>
  useSplitLayout.value && Boolean(feedDetail.value) && !isAnswerDetail.value
);
const answerQuestionId = computed(() => String(
  feedDetail.value?.questionId
    ?? feedDetail.value?.question_id
    ?? feedDetail.value?.fid
    ?? feedDetail.value?.feedId
    ?? feedDetail.value?.feed_id
    ?? feedDetail.value?.targetRow?.id
    ?? feedDetail.value?.target_row?.id
    ?? '',
).trim());
const answerQuestionTitle = computed(() => String(
  feedDetail.value?.questionTitle
    ?? feedDetail.value?.question_title
    ?? feedDetail.value?.question?.title
    ?? '',
).trim());
// 官方详情使用 normalizeContextFeed 校验过的完整正文立即加载评论，
// 与详情刷新并行；仅有通知摘要时仍等完整动态返回后才挂载卡片。
const loading = ref(Boolean(feedId.value));
const error = ref('');
let requestVersion = 0;

const entryPosition = computed(() => {
  if (String(route.params.id || route.params.feedId || '') !== feedId.value || targetReplyId.value) return '';
  return ['top', 'comments'].includes(String(route.query.scrollTo || '')) ? String(route.query.scrollTo) : '';
});

async function applyEntryPosition() {
  const position = entryPosition.value;
  if (routeNavigationIsHistory.value || !position || entryPositionApplied || !detailActive.value || !feedDetail.value) return;
  await nextTick();
  if (routeNavigationIsHistory.value || position !== entryPosition.value || !detailActive.value || entryPositionApplied) return;
  const page = detailShellRef.value?.parentElement;
  if (!page) return;
  if (position === 'comments') {
    const comments = detailShellRef.value?.querySelector<HTMLElement>('.comment-toolbar');
    if (!comments) return;
    // 留出仍在吸顶的作者栏，避免评论标题滚入状态栏或被顶栏覆盖。
    const headerHeight = updateCommentHeaderHeight();
    page.scrollTop += comments.getBoundingClientRect().top - page.getBoundingClientRect().top - headerHeight;
  } else {
    page.scrollTop = 0;
  }
  entryPositionApplied = true;
  detailReading.reset();
}

watch(entryPosition, () => { entryPositionApplied = false; });
watch([entryPosition, feedDetail, loading], () => { void observeCommentHeader(); void applyEntryPosition(); }, { flush: 'post' });

async function fetchDetail() {
  if (!feedId.value) return;
  const requestedFeedId = feedId.value;
  const currentRequest = ++requestVersion;
  loading.value = true;
  error.value = '';
  try {
    const response: any = await CoolapkTauriAPI.getFeedDetail(requestedFeedId);
    const detail = response?.data;
    if (!detail) throw new Error('接口没有返回原动态内容');
    if (currentRequest !== requestVersion || requestedFeedId !== feedId.value) return;
    feedDetail.value = detail;
    appStore.setFeedDetailContext(requestedFeedId, detail);
  } catch (requestError) {
    if (currentRequest === requestVersion) {
      error.value = requestError instanceof Error ? requestError.message : String(requestError);
    }
  } finally {
    if (currentRequest === requestVersion) loading.value = false;
  }
}

onMounted(() => {
  void applyEntryPosition();
  void fetchDetail();
});

watch(feedId, (nextFeedId) => {
  entryPositionApplied = false;
  detailReading.reset();
  feedDetail.value = normalizeContextFeed(appStore.getFeedDetailContext(nextFeedId));
  error.value = '';
  void fetchDetail();
});

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => loading.value);
async function refreshMobilePage() { await fetchDetail(); await refreshFeedCard.value?.refreshComments?.(); await refreshAnswerCard.value?.refreshComments?.(); }
</script>

<style scoped>
.detail-fallback-back { min-height: 44px; padding: 8px 16px; border: 0; background: var(--surface); color: var(--text-primary); font: inherit; }
@media (max-width: 720px) {
  .detail-fallback-back {
    position: sticky;
    top: 0;
    z-index: 20;
    width: 100%;
    text-align: left;
    padding-top: calc(8px + var(--app-safe-area-top, 0px));
    padding-left: max(16px, env(safe-area-inset-left, 0px));
  }
}
.feed-detail-page.is-official-mobile { background: var(--surface); }
/* 详情卡片不能创建内部裁切滚动容器，否则作者栏与评论栏的 sticky 会失效。 */
.is-official-mobile :deep(.feed-card.is-official-mobile-detail) { overflow: visible; }
.is-official-mobile :deep(.official-detail-comments .comment-toolbar) { top: var(--feed-detail-header-height, 60px); scroll-margin-top: var(--feed-detail-header-height, 60px); }
.is-official-mobile .feed-detail-shell { padding-bottom: calc(100px + env(safe-area-inset-bottom)); }
.is-official-mobile .feed-detail-shell { transition: padding-bottom 200ms ease; }
.is-official-mobile.reading-actions-hidden .feed-detail-shell { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
@media (prefers-reduced-motion: reduce) { .is-official-mobile .feed-detail-shell { transition: none; } }
.feed-detail-page {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background-color: var(--background-secondary);
}

.feed-detail-shell {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0 0 32px;
}

/* 评论很少或仍在加载时也留出定位空间，避免滚动范围不足而停在正文中间。 */
.feed-detail-shell.enter-at-comments :deep(.inline-comment-wrapper) {
  min-height: var(--app-viewport-height, 100dvh);
}

/* 分栏模式：滚动收进左右两栏，页面自身不再滚动。
   必须给 shell 一层确定高度（height: 100% 的 flex 链），否则
   FeedDetailSplitLayout 的 height: 100% 会退回内容高度，两栏的
   overflow-y: auto 全部失效、整页随内容撑高。 */
.feed-detail-page.is-split {
  overflow: hidden;
}

.feed-detail-page.is-split .feed-detail-shell {
  height: 100%;
  padding-bottom: 0;
}

.feed-detail-shell :deep(.feed-card) {
  width: 100%;
  max-width: 100%;
  border-radius: 0;
  border-left: none;
  border-right: none;
  border-top: none;
  box-shadow: none;
  margin-bottom: 0;
}

.feed-detail-shell :deep(.question-answer-card) {
  width: 100%;
  max-width: 100%;
  margin-bottom: 0;
  border-radius: 0;
  border-right: none;
  border-left: none;
  box-shadow: none;
}
</style>
