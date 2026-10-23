<template>
  <div class="home-page-layout" :class="{ 'has-follow-subchannels': isFollowingTab && followSubChannels.length > 0 }">
    <div class="main-feed-column">
      <div v-if="!props.embedded" class="feed-toolbar-row">
        <FeedTabs
          v-model:active-key="activeTab"
          :tabs="orderedDynamicTabs"
          :manager-tabs="visibleServerTabs"
          @tab-order-updated="handleTabOrderUpdated"
          :active-sub-tab-key="activeFollowSubChannelKey"
          @select-sub-tab="handleHomeSubChannelSelected"
        />
        <FeedLayoutToggle v-model="feedLayout" />
      </div>

      <!-- APK ConfigPage 动态下发的关注子栏目。 -->
      <div v-if="isFollowingTab && followSubChannels.length" class="follow-subchannel-bar">
        <div
          ref="followSubChannelsContainer"
          class="follow-subchannel-list custom-scrollbar"
          data-discovery-horizontal-scroll
          aria-label="关注筛选"
          @wheel.passive="handleFollowSubChannelsWheel"
        >
          <button
            v-for="channel in followSubChannels"
            :key="channel.key"
            type="button"
            :class="['follow-subchannel-item', { active: isFollowSubChannelSelected(channel) }]"
            :title="channel.subTitle || channel.title"
            @click="selectFollowSubChannel(channel)"
          >
            <span>{{ channel.title }}</span>
          </button>
        </div>
        <button v-if="updatedFollowUsers?.available && updatedFollowUsers.collapsed" type="button" class="follow-updates-expand" aria-label="展开最近更新酷友" title="展开最近更新酷友" @click="updatedFollowUsers.expand()"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>
      </div>

      <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: loading || loadingMore || isPrefetching || !props.selected }"
        ref="feedScrollContainer"
        data-resource-scroll-root
        class="feed-scroll-container custom-scrollbar"
        @scroll="handleScroll"
        @load.capture="scheduleFeedEndCheck"
        @wheel="handleFeedHorizontalWheel"
        @pointerdown="handleFeedPointerDown"
        @click.capture="handleFeedClickCapture"
      >
        <UpdatedFollowUsers ref="updatedFollowUsers" v-if="isFollowingTab && (!selectedFollowSubChannel || isDefaultFollowSubChannel(selectedFollowSubChannel))" :feeds="followingUpdateFeeds" />
        <!-- 1. 头条 Tab 专属：服务端要闻与动态子栏目 -->
        <div v-if="isHeadlineTab" class="headline-header-section">
          <!-- APK ConfigPage.rawEntities 动态下发的头条子栏目 -->
          <div
            v-if="headlineSubChannels.length"
            ref="subChannelsContainer"
            class="quick-icons-grid custom-scrollbar"
            data-discovery-horizontal-scroll
            @wheel.passive="handleSubChannelsWheel"
          >
            <button
              v-for="channel in headlineSubChannels"
              :key="channel.key"
              type="button"
              :class="['icon-btn-item', { selected: isSubChannelSelected(channel) }]"
              :title="isSubChannelSelected(channel) ? `已选中 ${channel.title}（再次点击可取消）` : channel.title"
              @click="openHeadlineSubChannel(channel)"
            >
              <span class="icon-circle">
                <AppImage
                  v-if="channel.logo && !failedHeadlineSubChannelLogos.has(channel.key)"
                  :src="channel.logo"
                  fit="contain"
                  image-class="headline-sub-channel-logo"
                  @error="markHeadlineSubChannelLogoFailed(channel.key)"
                />
                <i v-else :class="channel.icon"></i>
              </span>
              <span class="channel-title">{{ channel.title }}</span>
            </button>
          </div>
          <div v-if="headlineNestedSubChannels.length" data-discovery-horizontal-scroll class="headline-nested-tabs" role="tablist" aria-label="头条子栏目">
            <button
              v-for="channel in headlineNestedSubChannels"
              :key="channel.key"
              type="button"
              :class="['headline-nested-tab', { active: selectedHeadlineNestedSubChannelUrl === channel.url }]"
              @click="openHeadlineNestedSubChannel(channel)"
            >
              {{ channel.title }}
            </button>
          </div>
        </div>

        <!-- APK 热榜首页：榜单入口、热点话题与热搜均使用服务端实体。 -->
        <div v-if="isHotTab" class="hot-header-section">
          <!-- 5 大榜单金刚组 -->
          <div class="hot-ranks-row">
            <button
              v-for="(rank, index) in hotRanks"
              :key="getEntityKey(rank, index)"
              type="button"
              class="rank-action-item"
              @click="openPageEntity(rank)"
            >
              <AppImage v-if="rank.pic" :src="rank.pic" class="rank-official-icon" fit="contain" />
              <span v-else class="rank-icon-bg bg-orange"><i class="fas fa-chart-line"></i></span>
              <span>{{ rank.title }}</span>
            </button>
          </div>

          <section v-for="(card, index) in hotTopicCards" :key="getEntityKey(card, index)" class="hot-topics">
            <header v-if="card.title" class="hot-topics-header"><span>{{ card.title }}</span><button v-if="card.url" type="button" aria-label="更多热点资讯" @click="openHotHeaderEntity(card)">更多 <i class="fas fa-chevron-right" aria-hidden="true"></i></button></header>
            <div class="hot-topics-grid">
              <button v-for="(topic, topicIndex) in card.entities" :key="getEntityKey(topic, topicIndex)" type="button" class="hot-topic" :title="topic.title" @click="openHotHeaderEntity(topic)">
                <AppImage v-if="getEntityImage(topic)" :src="getEntityImage(topic)" class="hot-topic-icon" fit="cover" />
                <span class="hot-topic-title">{{ topic.title }}</span>
              </button>
            </div>
          </section>
          <div v-if="hotSearches.length" data-discovery-horizontal-scroll class="hot-search-chips custom-scrollbar">
            <button
              v-for="(keyword, idx) in hotSearches"
              :key="idx"
              class="chip-btn"
              @click="openHotHeaderEntity(keyword)"
            >
              {{ keyword.title }}
            </button>
          </div>
        </div>

        <!-- SelectorLinkViewHolder：默认 selectedTab，点击替换当前列表，分类栏按 cardFixedToTop 吸顶。 -->
        <div v-if="isHotTab && hotChannels.length" class="hot-channel-tabs custom-scrollbar" role="tablist" aria-label="热榜分类" :class="{ 'is-fixed': hotChannelsFixed }">
          <button v-for="channel in hotChannels" :key="channel.url" type="button" role="tab" :aria-selected="selectedHotChannelUrl === channel.url" :class="['hot-channel-tab', { active: selectedHotChannelUrl === channel.url }]" @click="selectHotChannel(channel)">{{ channel.title }}</button>
        </div>

        <!-- 3. 快讯 Tab 专属：酷安快讯 Banner -->
        <div v-if="isNewsTab" class="express-banner">
          <div class="express-banner-content">
            <div class="banner-title"><i class="fas fa-bolt"></i> 酷安快讯</div>
            <div class="banner-sub">每日科技新鲜事 · 7x24小时不间断更新</div>
          </div>
        </div>

        <!-- 看看号 Tab 专属：看看号卡片网格 -->
        <div v-if="isDyhTab && loading && feeds.length === 0" class="skeleton-padding">
          <FeedSkeleton :count="4" />
        </div>

        <div v-else-if="isDyhTab && feeds.length === 0 && !loading" class="empty-padding">
          <EmptyState title="暂无看看号" />
        </div>

        <div v-if="isDyhTab && !loading" class="dyh-tab-grid">
          <div
            v-for="item in feeds"
            :key="item.id"
            class="dyh-tab-card"
            @click="openDyh(item.id)"
          >
            <AppImage v-if="item.logo" :src="item.logo" fit="cover" image-class="dyh-tab-logo" />
            <div v-else class="dyh-tab-logo-fallback"><i class="fas fa-building-columns"></i></div>
            <div class="dyh-tab-info">
              <strong class="dyh-tab-name">{{ item.title || item.dyhName }}</strong>
              <span class="dyh-tab-desc">{{ item.description }}</span>
              <span class="dyh-tab-follow"><i class="fas fa-user-plus"></i> {{ formatDyhCount(item.follownum) }} 关注</span>
            </div>
            <i class="fas fa-chevron-right dyh-tab-arrow"></i>
          </div>
          <div v-if="loadingMore" class="loading-more">
            <LoadingState text="加载更多看看号..." />
          </div>
          <div v-else-if="noMore && feeds.length > 0" class="dyh-tab-no-more">没有更多看看号了</div>
        </div>

        <!-- 选机中心子栏目专属：直接内嵌展示选机页面 -->
        <ProductSelectorPage v-if="isProductSelectorActive" />

        <!-- 服务端页面实体栏目：新机/直播返回的是卡片与实体，不能按动态流清洗和渲染 -->
        <div v-else-if="isPageEntityTab && loading && pageEntities.length === 0" class="skeleton-padding">
          <DiscoverySkeleton />
        </div>

        <div v-else-if="isPageEntityTab && error && pageEntities.length === 0" class="error-padding">
          <ErrorState title="加载页面内容失败" :message="error" @retry="loadFeeds(true)" />
        </div>

        <div v-else-if="isPageEntityTab && pageEntities.length === 0" class="empty-padding">
          <EmptyState title="暂无内容" />
        </div>

        <div v-else-if="isPageEntityTab" class="home-page-entity-list">
          <DiscoveryEntityCard
            v-for="(entity, index) in pageEntities"
            :key="getEntityKey(entity, index)"
            :entity="entity"
            @open="openPageEntity"
          />
          <div v-if="loadingMore" class="loading-more">
            <LoadingState text="加载更多..." />
          </div>
          <div v-else-if="noMore" class="page-entity-no-more">没有更多内容了</div>
        </div>

        <!-- 动态列表与 Loading/Error/Empty 状态 -->
        <div v-else-if="!isDyhTab && loading && feeds.length === 0" class="skeleton-padding">
          <FeedSkeleton :count="4" />
        </div>

        <div v-else-if="!isDyhTab && error && feeds.length === 0" class="error-padding">
          <ErrorState title="加载动态失败" :message="error" @retry="loadFeeds(true)" />
        </div>

        <div
          v-else-if="!isDyhTab && selectedHeadlineSubChannelUrl && headlineUserItems.length"
          class="headline-ranking-list"
          :style="{ '--headline-ranking-rows': headlineRankingRows }"
        >
          <article
            v-for="(item, index) in headlineUserItems"
            :key="item.uid || item.entityId || item.id || index"
            :class="['headline-ranking-card', { 'is-top-three': index < 3, [`rank-${index + 1}`]: index < 3 }]"
            role="button"
            tabindex="0"
            @click="openHeadlineUser(item)"
            @keydown.enter="openHeadlineUser(item)"
          >
            <div class="headline-rank-number">{{ index + 1 }}</div>
            <AppAvatar
              :src="item.userAvatar || item.userInfo?.userAvatar || item.avatar"
              size="lg"
              class="headline-ranking-avatar"
            />
            <div class="headline-ranking-info">
              <div class="headline-ranking-name-row">
                <strong>{{ getHeadlineUserName(item) }}</strong>
                <span v-if="getHeadlineUserVerify(item)" class="headline-ranking-verify">
                  <i class="fas fa-certificate"></i>{{ getHeadlineUserVerify(item) }}
                </span>
              </div>
              <div class="headline-ranking-tags">
                <span v-if="item.level" class="headline-ranking-level">Lv.{{ item.level }}</span>
                <span v-if="index < 3" class="headline-ranking-top-label">{{ index === 0 ? '榜首' : 'TOP ' + (index + 1) }}</span>
              </div>
              <div class="headline-ranking-stats">
                <span><i class="fas fa-users"></i> 粉丝 {{ formatDyhCount(item.fans || item.fansNum) }}</span>
                <span><i class="fas fa-user-plus"></i> 关注 {{ formatDyhCount(item.follow || item.followNum) }}</span>
              </div>
            </div>
            <i class="fas fa-chevron-right headline-ranking-arrow"></i>
          </article>
        </div>

        <div v-else-if="!isDyhTab && selectedHeadlineSubChannelUrl && headlineDiscoveryItems.length" class="headline-discovery-list">
          <DiscoveryEntityCard
            v-for="(item, index) in headlineDiscoveryItems"
            :key="item.entityId || item.id || item.url || index"
            :entity="item"
          />
        </div>

        <div v-else-if="!isDyhTab && feeds.length === 0" class="empty-padding">
          <EmptyState title="暂无动态内容" />
        </div>

        <div v-else-if="!isDyhTab" :class="['feed-list-padding', { 'is-double-column': isDoubleColumn }]">
          <template v-if="isDoubleColumn">
            <div v-for="(column, columnIndex) in feedColumns" :key="columnIndex" class="feed-waterfall-column">
            <template v-for="entry in column" :key="entry.item.id || entry.index">
              <QuestionAnswerCard
                v-if="isQuestionTab && isAnswerHomeItem(entry.item)"
                :answer="entry.item"
                :style="{ order: entry.index }"
                :class="{ 'feed-card-focused': entry.index === navIndex }"
                :ref="(el) => setCardRef(el, entry.index)"
              />
              <QuestionFeedCard
                v-else-if="isQuestionTab && isQuestionHomeItem(entry.item)"
                :question="entry.item"
                :style="{ order: entry.index }"
                :class="{ 'feed-card-focused': entry.index === navIndex }"
                :ref="(el) => setCardRef(el, entry.index)"
              />
              <RatingCard
                v-else-if="isRatingHomeItem(entry.item)"
                :feed="entry.item"
                :style="{ order: entry.index }"
                :class="{ 'feed-card-focused': entry.index === navIndex }"
                :ref="(el) => setCardRef(el, entry.index)"
              />
              <FeedCard
                v-else
                :feed="entry.item"
                :style="{ order: entry.index }"
                :class="{ 'feed-card-focused': entry.index === navIndex }"
                :ref="(el) => setCardRef(el, entry.index)"
                @deleted="handleFeedDeleted"
              />
            </template>
            </div>
          </template>
          <template v-else v-for="(item, idx) in feeds" :key="item.id || idx">
            <QuestionAnswerCard
              v-if="isQuestionTab && isAnswerHomeItem(item)"
              :answer="item"
              :class="{ 'feed-card-focused': idx === navIndex }"
              :ref="(el) => setCardRef(el, idx)"
            />
            <QuestionFeedCard
              v-else-if="isQuestionTab && isQuestionHomeItem(item)"
              :question="item"
              :class="{ 'feed-card-focused': idx === navIndex }"
              :ref="(el) => setCardRef(el, idx)"
            />
            <RatingCard
              v-else-if="isRatingHomeItem(item)"
              :feed="item"
              :class="{ 'feed-card-focused': idx === navIndex }"
              :ref="(el) => setCardRef(el, idx)"
            />
            <FeedCard
              v-else
              :feed="item"
              :class="{ 'feed-card-focused': idx === navIndex }"
              :ref="(el) => setCardRef(el, idx)"
              @deleted="handleFeedDeleted"
            />
          </template>

          <div v-if="loadingMore" class="loading-more">
            <LoadingState text="加载更多动态..." />
          </div>
          <div v-else-if="noMore && feeds.length > 0" class="feed-no-more">没有更多内容了</div>
        </div>
      </div>
    </div>

    <RightSidebar
      v-if="!props.embedded && (settingsStore.settings.showHomeHotNews || settingsStore.settings.showHomeMonthlyRank || settingsStore.settings.showHomeHotTopics)"
      v-show="!desktopCommentsOpen"
      :show-monthly-rank="settingsStore.settings.showHomeMonthlyRank"
      :show-hot-news="settingsStore.settings.showHomeHotNews"
      :show-hot-topics="settingsStore.settings.showHomeHotTopics"
    />
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { ref, computed, reactive, watch, nextTick, onMounted, onUnmounted, onActivated, onDeactivated, inject, provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FeedTabs from '../components/feed/FeedTabs.vue';
import FeedLayoutToggle from '../components/feed/FeedLayoutToggle.vue';
import FeedCard from '../components/feed/FeedCard.vue';
import UpdatedFollowUsers from '../components/feed/UpdatedFollowUsers.vue';
import { isFollowUpdateCard } from '../utils/followUpdates';
import RatingCard from '../components/feed/RatingCard.vue';
import QuestionAnswerCard from '../components/question/QuestionAnswerCard.vue';
import QuestionFeedCard from '../components/question/QuestionFeedCard.vue';
import DiscoveryEntityCard from '../components/discovery/DiscoveryEntityCard.vue';
import DiscoverySkeleton from '../components/discovery/DiscoverySkeleton.vue';
import FeedSkeleton from '../components/feed/FeedSkeleton.vue';
import RightSidebar from '../components/layout/RightSidebar.vue';
import LoadingState from '../components/common/LoadingState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import AppAvatar from '../components/common/AppAvatar.vue';
import AppImage from '../components/common/AppImage.vue';
import ProductSelectorPage from './ProductSelectorPage.vue';
import { CoolapkTauriAPI } from '../api/coolapk';
import { useSettingsStore } from '../stores/settings';
import { hasFeedRenderableContent, shouldHideFeed } from '../utils/feedFilter';
import { decodeDiscoveryRouteSegment, getEntityImage, getEntityKey, parseDiscoveryPage, resolveDiscoveryRoute } from '../utils/discovery';
import { normalizeCoolapkRoute } from '../utils/coolapkRoute';
import type { FeedLayout, ConfigPageTab } from '../types/settings';
import type { DiscoveryEntity } from '../types/discovery';
import { getHomeSubChannels, isFollowingHomeTab, resolvePreferredHomeTab, type HomeSubChannel, type HomeSubChannelSelection } from '../utils/homeTabs';
import { HOME_TAB_REFRESH_EVENT, HOME_TAB_SCROLL_TOP_EVENT } from '../utils/homeTab';
import { desktopFeedCommentsOpenKey } from '../utils/desktopFeedComments';
import { isAnswerSearchEntity } from '../utils/searchEntities';
import { isQuestionFeedEntity, isQuestionHomeTab } from '../utils/question';
import { isRatingFeedEntity } from '../utils/rating';
const props = withDefaults(defineProps<{ embedded?: boolean; tabKey?: string; tabs?: ConfigPageTab[]; selected?: boolean; preview?: boolean }>(), { embedded: false, selected: true, preview: false });
import { feedPageVisibleKey, feedPageRenderKey, homePagerMovingKey } from '../utils/feedPageVisibility';
const pagerMoving = inject(homePagerMovingKey, ref(false));
const desktopCommentsOpen = inject(desktopFeedCommentsOpenKey, ref(false));
provide(feedPageVisibleKey, computed(() => props.selected && !pagerMoving.value));
provide(feedPageRenderKey, computed(() => props.selected || props.preview));

const settingsStore = useSettingsStore();

const feedLayout = computed<FeedLayout>({
  get: () => settingsStore.settings.feedLayout,
  set: (value) => { settingsStore.settings.feedLayout = value; },
});
const feedEntries = computed(() => feeds.value.map((item, index) => ({ item, index })));
// 固定左右归属，追加动态或图片高度变化时只更新本列，不重新平衡已有卡片。
const feedColumns = computed(() => [feedEntries.value.filter(entry => entry.index % 2 === 0), feedEntries.value.filter(entry => entry.index % 2 === 1)]);

const route = useRoute();
const router = useRouter();
const activeTab = ref('');
let isInitializingHome = true;
const page = ref(1);
const feeds = ref<any[]>([]);
// 单独保存官方横向卡片，避免被动态过滤丢弃或重复渲染。
const followingUpdateFeeds = ref<any[]>([]);
const updatedFollowUsers = ref<InstanceType<typeof UpdatedFollowUsers> | null>(null);
const pageEntities = ref<DiscoveryEntity[]>([]);
const pageEntityCursor = reactive({ firstItem: '', lastItem: '', pageContext: '' });
const feedCursor = reactive({ firstItem: '', lastItem: '', pageContext: '' });
const feedScrollContainer = ref<HTMLElement | null>(null);
const subChannelsContainer = ref<HTMLElement | null>(null);
const followSubChannelsContainer = ref<HTMLElement | null>(null);
const loading = ref(false);
let feedRequestSequence = 0;
const homeTabSwipeThreshold = 56;
let feedPointerStart: { pointerId: number; x: number; y: number } | null = null;
let wheelGestureDelta = 0;
let wheelGestureHandled = false;
let wheelGestureIdleTimer: ReturnType<typeof setTimeout> | null = null;
let suppressNextFeedClick = false;

function handleSubChannelsWheel(e: WheelEvent) {
  if (subChannelsContainer.value && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    subChannelsContainer.value.scrollLeft += e.deltaY;
  }
}

function handleFollowSubChannelsWheel(e: WheelEvent) {
  if (followSubChannelsContainer.value && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    followSubChannelsContainer.value.scrollLeft += e.deltaY;
  }
}

function isInsideHorizontalScroller(target: EventTarget | null): boolean {
  const feedContainer = feedScrollContainer.value;
  let element = target instanceof Element ? target as HTMLElement : null;
  while (element && element !== feedContainer) {
    const overflowX = window.getComputedStyle(element).overflowX;
    if ((overflowX === 'auto' || overflowX === 'scroll') && element.scrollWidth > element.clientWidth + 1) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

function activateAdjacentHomeTab(direction: -1 | 1): boolean {
  const tabs = orderedDynamicTabs.value;
  const currentIndex = tabs.findIndex((tab) => getTabKey(tab) === activeTab.value);
  const nextTab = tabs[currentIndex + direction];
  if (!nextTab) return false;
  activeTab.value = getTabKey(nextTab);
  return true;
}

function handleFeedHorizontalWheel(event: WheelEvent) {
  if (props.embedded) return;
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || isInsideHorizontalScroller(event.target)) return;

  wheelGestureDelta += event.deltaX;
  if (!wheelGestureHandled && Math.abs(wheelGestureDelta) >= homeTabSwipeThreshold) {
    const changed = activateAdjacentHomeTab(wheelGestureDelta > 0 ? 1 : -1);
    wheelGestureHandled = changed;
    wheelGestureDelta = 0;
    if (changed) event.preventDefault();
  }

  if (wheelGestureIdleTimer) clearTimeout(wheelGestureIdleTimer);
  wheelGestureIdleTimer = setTimeout(() => {
    wheelGestureDelta = 0;
    wheelGestureHandled = false;
    wheelGestureIdleTimer = null;
  }, 260);
}

function handleFeedPointerDown(event: PointerEvent) {
  if (props.embedded) return;
  if (!event.isPrimary || event.pointerType === 'mouse' || isInsideHorizontalScroller(event.target)) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  feedPointerStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
}

function handleFeedPointerUp(event: PointerEvent) {
  const start = feedPointerStart;
  if (!start || event.pointerId !== start.pointerId) return;
  feedPointerStart = null;

  const deltaX = event.clientX - start.x;
  const deltaY = event.clientY - start.y;
  if (Math.abs(deltaX) < homeTabSwipeThreshold || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
  if (activateAdjacentHomeTab(deltaX < 0 ? 1 : -1)) {
    suppressNextFeedClick = true;
    window.setTimeout(() => { suppressNextFeedClick = false; }, 0);
    event.preventDefault();
  }
}

function handleFeedPointerCancel(event: PointerEvent) {
  if (feedPointerStart?.pointerId === event.pointerId) feedPointerStart = null;
}

function handleFeedClickCapture(event: MouseEvent) {
  if (!suppressNextFeedClick) return;
  suppressNextFeedClick = false;
  event.preventDefault();
  event.stopPropagation();
}

function resetHomeTabSwipeState() {
  feedPointerStart = null;
  suppressNextFeedClick = false;
  wheelGestureDelta = 0;
  wheelGestureHandled = false;
  if (wheelGestureIdleTimer) {
    clearTimeout(wheelGestureIdleTimer);
    wheelGestureIdleTimer = null;
  }
}
const loadingMore = ref(false);
const noMore = ref(false);
const error = ref('');
const headlineCursor = reactive({ firstItem: '', lastItem: '' });
const headlinePageContext = ref('');
const headlineResolvedUrl = ref('');
const selectedHeadlineSubChannelUrl = ref('');
const failedHeadlineSubChannelLogos = reactive(new Set<string>());
const headlineQuickLinks = ref<any[]>([]);
const headlineDiscoveryItems = ref<any[]>([]);
const headlineUserItems = ref<any[]>([]);
const headlineNestedSubChannels = ref<Array<{ key: string; title: string; url: string }>>([]);
const selectedHeadlineNestedSubChannelUrl = ref('');
const headlineRankingRows = computed(() => Math.max(1, Math.ceil(headlineUserItems.value.length / 2)));

// 动态服务端下发的 Tab 列表（完全对齐 APK ConfigPage 结构）
const serverTabs = ref<ConfigPageTab[]>([]);
const selectedFollowSubChannelKey = ref('');
const pendingFollowSubChannelKey = ref('');
const visibleServerTabs = computed<ConfigPageTab[]>(() => serverTabs.value.filter((tab) => !isHomeTopicConfigTab(tab)));

const orderedDynamicTabs = computed<ConfigPageTab[]>(() => {
  const source = visibleServerTabs.value;
  if (!source.length) return [];
  const order = settingsStore.settings.homeTabOrder || [];
  if (!order.length) return source;

  const visibleSource = source.filter(tab => {
    const key = tab.page_name || tab.url || String(tab.id || tab.title);
    return !order.includes(`__hidden__${key}`);
  });
  const visibleTabs = visibleSource.length > 0 ? visibleSource : source.slice(0, 1);

  return [...visibleTabs].sort((a, b) => {
    const aKey = a.page_name || a.url || String(a.id || a.title);
    const bKey = b.page_name || b.url || String(b.id || b.title);
    const aIndex = order.indexOf(aKey);
    const bIndex = order.indexOf(bKey);
    return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex);
  });
});

const currentActiveTabObj = computed<ConfigPageTab | undefined>(() => {
  return orderedDynamicTabs.value.find(
    t => (t.page_name || t.url || String(t.id || t.title)) === activeTab.value
  );
});

// 动态判断当前 Tab 呈现形态（根据服务端 page_name 或 url 路由）
const isHeadlineTab = computed(() => {
  const t = currentActiveTabObj.value;
  if (!t) return activeTab.value === 'digest' || activeTab.value === 'V9_HOME_TAB_HEADLINE' || activeTab.value === '/main/headline';
  return t.page_name === 'V9_HOME_TAB_HEADLINE' || t.url === '/main/headline' || t.title === '头条';
});

const isHotTab = computed(() => {
  const t = currentActiveTabObj.value;
  if (!t) return activeTab.value === 'hot' || activeTab.value === 'V9_HOME_TAB_RANKING';
  return t.page_name === 'V9_HOME_TAB_RANKING' || t.url.includes('RANKING') || t.title === '热榜';
});

const isNewsTab = computed(() => {
  const t = currentActiveTabObj.value;
  if (!t) return activeTab.value === 'latest' || activeTab.value === 'V11_HOME_TAB_NEWS';
  return t.page_name === 'V11_HOME_TAB_NEWS' || t.url.includes('NEWS') || t.title === '快讯';
});

const isDyhTab = computed(() => {
  const t = currentActiveTabObj.value;
  if (!t) return activeTab.value === 'dyh';
  return t.page_name === 'dyh' || t.url === '/user/dyhSubscribe' || t.title === '看看号';
});

const isTopicPageTab = computed(() => {
  const t = currentActiveTabObj.value;
  if (!t) return activeTab.value === 'V9_HOME_TAB_TOPIC';
  return t.page_name === 'V9_HOME_TAB_TOPIC' || t.url.includes('V9_HOME_TAB_TOPIC') || t.title === '话题';
});

const isNewDevicePageTab = computed(() => {
  const t = currentActiveTabObj.value;
  if (!t) return activeTab.value === 'V11_HOME_NEW';
  return t.page_name === 'V11_HOME_NEW' || t.url.includes('V11_HOME_NEW') || t.title === '新机';
});

const isLiveTab = computed(() => {
  const t = currentActiveTabObj.value;
  if (!t) return activeTab.value === 'V9_HOME_TAB_LIVE' || activeTab.value === 'live';
  return t.page_name === 'V9_HOME_TAB_LIVE' || t.url.includes('V9_HOME_TAB_LIVE') || t.title === '直播';
});

const isSecondHandPageTab = computed(() => {
  const t = currentActiveTabObj.value;
  if (!t) return /(?:ershou|secondhand|good_goods_home)/i.test(activeTab.value);
  const target = `${t.page_name || ''} ${t.url || ''} ${t.title || ''}`;
  return /(?:ershou|secondhand|good_goods_home|闲置|二手)/i.test(target);
});

const isPageEntityTab = computed(() => isTopicPageTab.value || isNewDevicePageTab.value || isLiveTab.value || isSecondHandPageTab.value);

// APK 的 HomeFollowV15Fragment 使用关注动态专用列表接口，不能按普通栏目处理。
const isFollowingTab = computed(() => isFollowingHomeTab(currentActiveTabObj.value, activeTab.value));

const followSubChannels = computed(() => getHomeSubChannels(currentActiveTabObj.value));
const selectedFollowSubChannel = computed(() => followSubChannels.value.find((channel) => channel.key === selectedFollowSubChannelKey.value));
const activeFollowSubChannelKey = computed(() => selectedFollowSubChannel.value?.key || followSubChannels.value[0]?.key || '');

// APK 的 DataListFragment 对 ConfigPage 使用 /page/dataList 分页，并携带 lastItem/pageContext。
// 视频栏目就是这类页面，但它仍然渲染成动态流，不能复用普通 getBoardFeeds 的页码分页。
const isCursorFeedTab = computed(() => {
  const tab = currentActiveTabObj.value;
  if (isHotTab.value) return true;
  if (isHeadlineTab.value || isPageEntityTab.value || isFollowingTab.value) return false;
  const pageName = String(tab?.page_name || activeTab.value).trim();
  const url = String(tab?.url || (tab ? '' : activeTab.value)).trim();
  return /^\/page\?url=/i.test(url) || /^V\d+_/i.test(pageName);
});

const isQuestionTab = computed(() => {
  return isQuestionHomeTab(currentActiveTabObj.value) || isQuestionHomeTab({ page_name: activeTab.value });
});

const isDoubleColumn = computed(() => feedLayout.value === 'double' && !isDyhTab.value);

const headlineSubChannels = computed(() => {
  const tab = currentActiveTabObj.value;
  const configuredEntities = Array.isArray(tab?.entities)
    ? tab.entities
    : Array.isArray(tab?.rawEntities)
      ? tab.rawEntities
      : Array.isArray(tab?.raw_entities)
        ? tab.raw_entities
      : [];
  const entities = headlineQuickLinks.value.length > 0
    ? headlineQuickLinks.value
    : configuredEntities;
  return entities
    .map((entity, index) => {
      const title = String(entity.title || '').trim();
      const url = String(entity.url || '').trim();
      if (!title || !url) return null;
      return {
        key: String(entity.entityId ?? entity.entity_id ?? entity.id ?? url ?? index),
        title,
        url,
        subTitle: String(entity.subTitle || '').trim(),
        logo: String(entity.logo || entity.pic || '').trim(),
        icon: resolveHeadlineSubChannelIcon(entity),
      };
    })
    .filter((channel): channel is {
      key: string;
      title: string;
      url: string;
      subTitle: string;
      logo: string;
      icon: string;
    } => Boolean(channel));
});

const isProductSelectorActive = computed(() => {
  if (!isHeadlineTab.value) return false;
  const current = selectedHeadlineSubChannelUrl.value;
  if (!current) return false;
  const channel = headlineSubChannels.value.find(isSubChannelSelected);
  return Boolean(
    channel && (
      channel.title.includes('选机')
      || channel.url.includes('productSelector')
      || channel.url.includes('filter')
      || channel.url.includes('/product/filter')
    )
  );
});

function updateHeadlineQuickLinks(items: any[]) {
  const card = items.find((item) =>
    item?.entityTemplate === 'iconLinkGridCard'
    || item?.entity_template === 'iconLinkGridCard'
  );
  const entities = Array.isArray(card?.entities) ? card.entities : [];
  if (entities.length > 0) {
    headlineQuickLinks.value = entities;
    failedHeadlineSubChannelLogos.clear();
  }
}

function resolveHeadlineSubChannelIcon(entity: any): string {
  const explicitIcon = String(entity.icon || '').trim();
  if (explicitIcon.startsWith('fa-')) return `fas ${explicitIcon}`;
  const value = `${entity.title || ''} ${entity.url || ''}`.toLowerCase();
  if (value.includes('ai') || value.includes('人工智能')) return 'fas fa-robot';
  if (value.includes('活动') || value.includes('gift')) return 'fas fa-gift';
  if (value.includes('摄影') || value.includes('picture') || value.includes('photo')) return 'fas fa-camera';
  if (value.includes('热') || value.includes('hot')) return 'fas fa-newspaper';
  if (value.includes('值得') || value.includes('recommend')) return 'fas fa-check-circle';
  return 'fas fa-layer-group';
}

function markHeadlineSubChannelLogoFailed(key: string) {
  failedHeadlineSubChannelLogos.add(key);
}

function updateHeadlineNestedSubChannels(items: any[]) {
  const card = items.find((item) => {
    const template = String(item?.entityTemplate || item?.entity_template || '').trim();
    return (template === 'iconTabLinkGridCard' || template === 'iconLinkGridCard')
      && Array.isArray(item?.entities)
      && item.entities.some((entity: any) => String(entity?.url || '').trim());
  });
  if (!card || !Array.isArray(card.entities)) return;

  const channels = card.entities
    .map((entity: any, index: number) => {
      const title = String(entity?.title || '').trim();
      const url = String(entity?.url || '').trim();
      if (!title || !url) return null;
      return {
        key: String(entity?.entityId ?? entity?.entity_id ?? entity?.id ?? url ?? index),
        title,
        url,
      };
    })
    .filter((channel: { key: string; title: string; url: string } | null): channel is { key: string; title: string; url: string } => Boolean(channel));

  if (channels.length > 0) {
    headlineNestedSubChannels.value = channels;
    if (!selectedHeadlineNestedSubChannelUrl.value) {
      selectedHeadlineNestedSubChannelUrl.value = channels[0].url;
    }
  }
}

const hotRanks = ref<DiscoveryEntity[]>([]);
const hotTopicCards = ref<DiscoveryEntity[]>([]);
const hotSearches = ref<DiscoveryEntity[]>([]);
const hotChannels = ref<DiscoveryEntity[]>([]);
const hotChannelsFixed = ref(false);
const selectedHotChannelUrl = ref('');

/** APK selectorLinkCard 的标题、顺序和请求地址由服务端决定，不拼接分类参数或持久化选择。 */
function updateHotNavigation(items: DiscoveryEntity[]) {
  const ranks = items.find(item => item.entityTemplate === 'iconLinkGridCard');
  if (ranks?.entities) hotRanks.value = ranks.entities;
  const topics = items.filter(item => item.entityTemplate === 'iconMiniGridCard');
  if (topics.length) hotTopicCards.value = topics;
  const searches = items.find(item => item.entityTemplate === 'capsuleListCard');
  if (searches?.entities) hotSearches.value = searches.entities;
  const selector = items.find(item => item.entityTemplate === 'selectorLinkCard');
  if (!selector?.entities?.length) return;
  hotChannels.value = selector.entities.filter(item => item.url && item.title);
  let extra: Record<string, unknown> = {};
  try { extra = selector.extraDataArr as Record<string, unknown> || (typeof selector.extraData === 'string' ? JSON.parse(selector.extraData) : selector.extraData) || {}; } catch { /* 缺失样式参数时仍显示服务端分类。 */ }
  hotChannelsFixed.value = String(extra.cardFixedToTop) === '1';
  if (!hotChannels.value.some(item => item.url === selectedHotChannelUrl.value)) {
    const selected = hotChannels.value.find(item => item.title === extra.selectedTab) || hotChannels.value[0];
    selectedHotChannelUrl.value = String(selected?.url || '');
  }
}

function openHotHeaderEntity(entity: DiscoveryEntity) {
  const url = String(entity.url || '');
  if (url.startsWith('searchTab://')) {
    const keyword = new URL(url).searchParams.get('keyword') || String(entity.title || '');
    quickSearch(keyword);
  } else if (/^#?\/topic\/tagList(?:\?|$)/.test(url)) {
    void router.push({ path: '/page', query: { url, title: String(entity.title || '热点话题'), renderer: 'discovery' } });
  } else openPageEntity(entity);
}

function getTabKey(tab: ConfigPageTab): string {
  return tab.page_name || tab.url || String(tab.id || tab.title);
}

// 首页及频道管理都隐藏服务端下发的独立话题入口。
function isHomeTopicConfigTab(tab: ConfigPageTab): boolean { return String(tab.page_name || '').trim() === 'V9_HOME_TAB_TOPIC' || String(tab.url || '').trim().includes('V9_HOME_TAB_TOPIC') || String(tab.title || '').trim() === '话题'; }

function isHeadlineConfigTab(tab: ConfigPageTab): boolean {
  return tab.page_name === 'V9_HOME_TAB_HEADLINE' || tab.url === '/main/headline' || tab.title === '头条';
}

function isHeadlineFeedSubChannel(url: string): boolean {
  return url.includes('/feed/digestList');
}

function isHotConfigTab(tab: ConfigPageTab): boolean {
  return tab.page_name === 'V9_HOME_TAB_RANKING' || tab.url.includes('RANKING') || tab.title === '热榜';
}

function isNewsConfigTab(tab: ConfigPageTab): boolean {
  return tab.page_name === 'V11_HOME_TAB_NEWS' || tab.url.includes('NEWS') || tab.title === '快讯';
}

function resolveInitialTab(): string {
  return resolvePreferredHomeTab(orderedDynamicTabs.value, settingsStore.settings.defaultHomeTab);
}

function syncTabFromRoute() {
  if (route.path === '/') {
    activeTab.value = resolveInitialTab();
  }
}

function getFeedEntityId(item: any): string {
  return String(item?.entityId ?? item?.entity_id ?? item?.id ?? '').trim();
}

function resetHeadlineCursor(options: { preserveNested?: boolean } = {}) {
  const preserveNested = options.preserveNested === true;
  headlineCursor.firstItem = '';
  headlineCursor.lastItem = '';
  headlinePageContext.value = '';
  if (!preserveNested) headlineResolvedUrl.value = '';
  headlineDiscoveryItems.value = [];
  headlineUserItems.value = [];
  if (!preserveNested) {
    headlineNestedSubChannels.value = [];
    selectedHeadlineNestedSubChannelUrl.value = '';
  }
}

function extractHeadlineUserItems(items: any[]): any[] {
  const users: any[] = [];
  const addUser = (item: any) => {
    const type = String(item?.entityType || item?.entity_type || item?.type || '').toLowerCase();
    // 动态实体也会带 uid；只有服务端明确标记为 user 的实体才进入排行榜，
    // 否则“值得看/热闻”等动态栏目会被误渲染成作者排行榜。
    if (!type.includes('user')) return;
    const uid = String(item?.uid || item?.userId || item?.user_id || '').trim();
    if (!item) return;
    if (!uid && !item.username) return;
    const sourceUrl = String(item.url || '').trim();
    const userUrl = /^#?\/u\/(\d+)/i.test(sourceUrl)
      ? `#/user/${sourceUrl.match(/^#?\/u\/(\d+)/i)?.[1]}`
      : sourceUrl || (uid ? `#/user/${encodeURIComponent(uid)}` : '');
    users.push({
      ...item,
      uid: uid || item.uid,
      url: userUrl,
    });
  };

  for (const item of items) {
    addUser(item);
    if (Array.isArray(item?.entities)) {
      for (const child of item.entities) addUser(child);
    }
  }
  return users;
}

function updateHeadlineCursor(items: any[], isFirstPage: boolean) {
  const ids = items.map(getFeedEntityId).filter(Boolean);
  if (!ids.length) return;
  // 第一页返回后更新刷新锚点；加载更多不能改变列表首条。
  if (isFirstPage || !headlineCursor.firstItem) headlineCursor.firstItem = ids[0];
  headlineCursor.lastItem = ids[ids.length - 1];
  const lastItem = items[items.length - 1];
  headlinePageContext.value = String(
    lastItem?.pageContext
      ?? lastItem?.page_context
      ?? lastItem?.extraData?.pageContext
      ?? lastItem?.extra_data?.pageContext
      ?? ''
  ).trim();
}

function normalizeHeadlinePageUrl(url: string): string {
  let trimmed = String(url || '').trim();
  if (!trimmed) return '';

  // 1. 去除 http/https 酷安域名
  const hostMatch = trimmed.match(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)*coolapk\.com(\/.*)?$/i);
  if (hostMatch) {
    trimmed = hostMatch[1] || '/';
  }

  // 2. 解析 /page?url=
  if (trimmed.startsWith('/page?url=')) {
    const encodedAction = trimmed.slice('/page?url='.length).split('&')[0];
    try {
      trimmed = decodeURIComponent(encodedAction);
    } catch {
      trimmed = encodedAction;
    }
  }

  // 3. 去除可能残留的协议头或首尾空白
  trimmed = trimmed.replace(/^https?:\/\/[^/]+/i, '');
  return trimmed || url;
}

function findDefaultHeadlineSubPage(items: any[]): string {
  const card = items.find((item) => {
    const template = String(item?.entityTemplate || item?.entity_template || '');
    return (template === 'iconTabLinkGridCard' || template === 'iconLinkGridCard')
      && Array.isArray(item?.entities)
      && item.entities.some((entity: any) => String(entity?.url || '').trim());
  });
  if (!card) return '';
  const entities = card.entities as any[];
  const preferred = entities.find((entity) => String(entity?.title || '').trim() === '全部')
    || entities.find((entity) => String(entity?.url || '').trim());
  return String(preferred?.url || '').trim();
}

async function getHeadlineSubChannelData(
  url: string,
  title: string,
  subTitle: string,
  page: number,
) {
  const targetUrl = normalizeHeadlinePageUrl(headlineResolvedUrl.value || url);
  const isProductSelector = targetUrl.includes('filter') || targetUrl.includes('product') || title.includes('选机');

  // 1. 如果是选机中心入口，优先请求酷安官方数码分类/选机数据
  if (isProductSelector) {
    try {
      const productPageRes: any = await CoolapkTauriAPI.getDiscoveryPageData({
        url: targetUrl.startsWith('#') ? targetUrl : '#/product/categoryList',
        title: title || '选机中心',
        subTitle: subTitle || '数码库',
        page,
        firstItem: headlineCursor.firstItem,
        lastItem: headlineCursor.lastItem,
        pageContext: headlinePageContext.value,
      });
      if (productPageRes && productPageRes.data && Array.isArray(productPageRes.data) && productPageRes.data.length > 0) {
        if (page === 1) updateHeadlineNestedSubChannels(productPageRes.data);
        return productPageRes;
      }
    } catch (e) {
      console.warn('选机中心 discovery 请求重定向:', e);
    }

    try {
      const catRes: any = await CoolapkTauriAPI.getProductCategoryList();
      if (catRes && catRes.data && Array.isArray(catRes.data) && catRes.data.length > 0) {
        return catRes;
      }
    } catch (e) {
      console.warn('getProductCategoryList 失败:', e);
    }
  }

  // 2. 通用发现页请求
  try {
    const res: any = await CoolapkTauriAPI.getDiscoveryPageData({
      url: targetUrl,
      title,
      subTitle,
      page,
      firstItem: headlineCursor.firstItem,
      lastItem: headlineCursor.lastItem,
      pageContext: headlinePageContext.value,
    });
    if (res && res.data && Array.isArray(res.data) && res.data.length > 0) {
      const items = res.data;
      if (page === 1) updateHeadlineNestedSubChannels(items);
      const nextUrl = page === 1 ? findDefaultHeadlineSubPage(items) : '';
      if (nextUrl && targetUrl !== normalizeHeadlinePageUrl(nextUrl)) {
        headlineResolvedUrl.value = normalizeHeadlinePageUrl(nextUrl);
        // 自动拉取默认子 Tab（如优质酷友）的榜单/动态数据
        try {
          const subRes: any = await CoolapkTauriAPI.getDiscoveryPageData({
            url: headlineResolvedUrl.value,
            title,
            subTitle,
            page,
            firstItem: headlineCursor.firstItem,
            lastItem: headlineCursor.lastItem,
            pageContext: headlinePageContext.value,
          });
          if (subRes && subRes.data && Array.isArray(subRes.data) && subRes.data.length > 0) {
            return subRes;
          }
        } catch (e) {
          console.warn('子 Tab 自动拉取异常:', e);
        }
      } else {
        headlineResolvedUrl.value = targetUrl;
      }
      return res;
    }
  } catch (err) {
    console.warn('getDiscoveryPageData 请求异常，尝试降级:', err);
  }

  // 3. 降级 1: 若涉及产品库，调用 getProductList
  if (targetUrl.includes('product')) {
    try {
      const productRes: any = await CoolapkTauriAPI.getProductList(targetUrl, title, subTitle, page);
      if (productRes && productRes.data && Array.isArray(productRes.data) && productRes.data.length > 0) {
        return productRes;
      }
    } catch (e) {
      console.warn('getProductList 降级失败:', e);
    }
  }

  // 4. 降级 2: 通用板块数据流 getBoardFeeds
  return await CoolapkTauriAPI.getBoardFeeds(targetUrl, page);
}

const prefetchBuffer = ref<any[]>([]);
const prefetchPage = ref(2);
const isPrefetching = ref(false);

/** 动态从 GET /v6/main/init 获取全量 Tab 配置（完全对齐 APK dt8.m45234 / Card 2） */
async function fetchTabConfig() {
  try {
    const res: any = await CoolapkTauriAPI.getTabConfig();
    const data = res?.data || [];
    // 官方 Card 2 首页配置实体（entityId: 6390 / entityTemplate: configCard / title: 首页）
    const configCard = data.find(
      (item: any) => item.entityId === '6390' || (item.entityTemplate === 'configCard' && (item.title === '首页' || (item.title || '').includes('TAB配置')))
    );

    if (configCard && configCard.entities && Array.isArray(configCard.entities)) {
      serverTabs.value = configCard.entities;

    }
  } catch (err) {
    console.warn('获取 Tab 配置失败', err);
  }
}

/** 动态依据 Tab 的 url / page_name 请求数据流 */
async function fetchTabApi(tabKey: string, p: number, background = false) {
  const matchedTab = orderedDynamicTabs.value.find(
    t => (t.page_name || t.url || String(t.id || t.title)) === tabKey
  );

  if (matchedTab ? isHeadlineConfigTab(matchedTab) : tabKey === 'digest' || tabKey === 'V9_HOME_TAB_HEADLINE' || tabKey === '/main/headline') {
    const selectedSubChannel = headlineSubChannels.value.find(
      channel => isSubChannelSelected(channel)
    );
    if (selectedSubChannel) {
      const selectedUrl = normalizeSubChannelUrl(selectedSubChannel.url);
      if (selectedUrl.startsWith('/t/')) {
        const tag = decodeURIComponent(selectedUrl.slice(3).split('?')[0]).trim();
        if (tag) {
          return await CoolapkTauriAPI.getTopicFeeds(tag, p);
        }
      }
      // 投票入口直接指向 feed/digestList；APK 返回的是带 vote.options 的动态列表，
      // 不经过 discovery page 的卡片解析，否则会被误识别成普通排行榜实体。
      if (isHeadlineFeedSubChannel(selectedUrl)) {
        return await CoolapkTauriAPI.getBoardFeeds(selectedUrl, p);
      }
      return await getHeadlineSubChannelData(
        selectedUrl,
        selectedSubChannel.title,
        selectedSubChannel.subTitle,
        p,
      );
    }
    return await CoolapkTauriAPI.getIndexV8EntitiesPaged({
      page: p,
      // 对齐 APK：刷新传首条，加载更多传末条，避免刷新退回无游标的旧推荐。
      firstItem: p === 1 ? headlineCursor.firstItem : '',
      lastItem: p > 1 ? headlineCursor.lastItem : '',
    });
  }

  if (matchedTab ? isHotConfigTab(matchedTab) : isHotTab.value) {
    // 首次读取官方热榜首页及默认今日热门，后续沿用选中实体的完整 URL 与分页游标。
    return await CoolapkTauriAPI.getDiscoveryPageData({ url: selectedHotChannelUrl.value || matchedTab?.page_name || matchedTab?.url || 'V9_HOME_TAB_RANKING', title: hotChannels.value.find(item => item.url === selectedHotChannelUrl.value)?.title || matchedTab?.title || '热榜', page: p, firstItem: '', lastItem: p > 1 ? feedCursor.lastItem : '', pageContext: p > 1 ? feedCursor.pageContext : '' });
  }

  const targetUrl = matchedTab ? (matchedTab.url || matchedTab.page_name || '') : tabKey;

  if (isFollowingTab.value) {
    const subChannel = selectedFollowSubChannel.value;
    if (!subChannel || isDefaultFollowSubChannel(subChannel)) {
      return await CoolapkTauriAPI.getFollowingFeeds(p);
    }
    return await CoolapkTauriAPI.getDiscoveryPageData({
      url: normalizeSubChannelUrl(subChannel.url) || targetUrl,
      title: subChannel.title || matchedTab?.title || '',
      subTitle: subChannel.subTitle || matchedTab?.subTitle || '',
      page: p,
      requestArgs: subChannel.requestArgs,
    });
  }

  if (isPageEntityTab.value) {
    return await CoolapkTauriAPI.getDiscoveryPageData({
      url: targetUrl,
      title: matchedTab?.title || '',
      subTitle: matchedTab?.subTitle || '',
      page: p,
      firstItem: p <= 1 ? pageEntityCursor.firstItem : '',
      lastItem: p <= 1 ? '' : pageEntityCursor.lastItem,
      pageContext: p <= 1 ? '' : pageEntityCursor.pageContext,
    });
  }

  if (isCursorFeedTab.value) {
    return await CoolapkTauriAPI.getDiscoveryPageData({
      url: targetUrl,
      title: matchedTab?.title || '',
      subTitle: matchedTab?.subTitle || '',
      page: p,
      // 官方 DataListFragment 的加载更多分支只传 lastItem/pageContext，firstItem 保持为空。
      firstItem: '',
      lastItem: p <= 1 ? '' : feedCursor.lastItem,
      pageContext: p <= 1 ? '' : feedCursor.pageContext,
    });
  }

  // 1. 如果匹配到具体 URL，调用通用板块/页面数据流
  if (targetUrl) {
    return await CoolapkTauriAPI.getBoardFeeds(targetUrl, p, background);
  }

  // 2. 默认保底请求
  return await CoolapkTauriAPI.getHeadlineFeeds(p);
}

async function prefetchNextPage() {
  if (isHeadlineTab.value || isPageEntityTab.value || isCursorFeedTab.value || isPrefetching.value || noMore.value) return;
  isPrefetching.value = true;
  const sequence = feedRequestSequence;
  try {
    const nextP = page.value;
    const res: any = await fetchTabApi(activeTab.value, nextP, true);
    if (sequence !== feedRequestSequence) return;
    if (res && res.data && Array.isArray(res.data)) {
      const validItems = res.data.filter((item: any) => !isFollowUpdateCard(item) && hasFeedRenderableContent(item) && !shouldHideFeed(item, settingsStore.settings));
      if (validItems.length > 0) {
        prefetchBuffer.value = validItems;
        prefetchPage.value = nextP + 1;
      }
    }
  } catch (e) {
    console.warn('首页静默预取下一页异常:', e);
  } finally {
    isPrefetching.value = false;
  }
}

async function loadFeeds(isRefresh: boolean = false) {
  if (loading.value || (loadingMore.value && !isRefresh)) return;
  if (!isRefresh && noMore.value) return;
  const sequence = ++feedRequestSequence;

  if (isRefresh) {
    // 清空列表前保留默认头条的刷新锚点，子栏目继续使用各自的重置逻辑。
    const headlineRefreshAnchor = isHeadlineTab.value && !selectedHeadlineSubChannelUrl.value ? headlineCursor.firstItem : '';
    page.value = 1;
    noMore.value = false;
    feeds.value = [];
    followingUpdateFeeds.value = [];
    pageEntities.value = [];
    pageEntityCursor.firstItem = '';
    pageEntityCursor.lastItem = '';
    pageEntityCursor.pageContext = '';
    feedCursor.firstItem = '';
    feedCursor.lastItem = '';
    feedCursor.pageContext = '';
    prefetchBuffer.value = [];
    if (isHeadlineTab.value) {
      resetHeadlineCursor({ preserveNested: Boolean(selectedHeadlineNestedSubChannelUrl.value) });
      headlineCursor.firstItem = headlineRefreshAnchor;
    }
    loading.value = true;
  } else {
    if (noMore.value) return;
    loadingMore.value = true;
  }
  error.value = '';

  try {
    let validItems: any[] = [];
    let rawItems: any[] = [];

    if (isPageEntityTab.value) {
      const res: any = await fetchTabApi(activeTab.value, page.value);
      if (sequence !== feedRequestSequence) return;
      const parsed = parseDiscoveryPage(res, page.value);
      const incoming = parsed.items;
      if (isRefresh) {
        pageEntities.value = incoming;
      } else {
        const existingKeys = new Set(pageEntities.value.map((item, index) => getEntityKey(item, index)));
        pageEntities.value = [...pageEntities.value, ...incoming.filter((item, index) => !existingKeys.has(getEntityKey(item, pageEntities.value.length + index)))];
      }
      pageEntityCursor.firstItem = parsed.firstItem;
      pageEntityCursor.lastItem = parsed.lastItem;
      pageEntityCursor.pageContext = parsed.pageContext || '';
      page.value += 1;
      noMore.value = incoming.length === 0 || !parsed.hasMore;
      return;
    }

    if (!isRefresh && !isHeadlineTab.value && prefetchBuffer.value.length > 0) {
      validItems = prefetchBuffer.value;
      prefetchBuffer.value = [];
      page.value = prefetchPage.value;
    } else {
      const res: any = await fetchTabApi(activeTab.value, page.value);
      if (sequence !== feedRequestSequence) return;
      if (isCursorFeedTab.value) {
        const parsed = parseDiscoveryPage(res, page.value);
        feedCursor.firstItem = parsed.firstItem;
        feedCursor.lastItem = parsed.lastItem;
        feedCursor.pageContext = parsed.pageContext || '';
      }
      if (res && res.data && Array.isArray(res.data)) {
        rawItems = res.data;
        if (isHotTab.value) updateHotNavigation(rawItems);
        if (isFollowingTab.value && rawItems.some(isFollowUpdateCard)) followingUpdateFeeds.value = rawItems.filter(isFollowUpdateCard);
        if (isHeadlineTab.value) updateHeadlineQuickLinks(rawItems);
        validItems = rawItems.filter((item: any) => !isFollowUpdateCard(item) && hasFeedRenderableContent(item) && !shouldHideFeed(item, settingsStore.settings));
        if (
          isHeadlineTab.value
          && selectedHeadlineSubChannelUrl.value
          && !isHeadlineFeedSubChannel(selectedHeadlineSubChannelUrl.value)
        ) {
          const incomingUsers = extractHeadlineUserItems(rawItems);
          const incomingDiscoveryItems = rawItems.filter((item: any) => {
            if (!item || typeof item !== 'object') return false;
            const template = String(item?.entityTemplate || item?.entity_template || '').trim();
            const entityType = String(item?.entityType || item?.entity_type || '').toLowerCase();
            const isNavCard = template === 'iconTabLinkGridCard'
              || template === 'iconLinkGridCard'
              || template === 'selectorLinkGridCard'
              || (Array.isArray(item?.entities) && item.entities.length > 0 && template.toLowerCase().includes('linkgrid'));
            return template !== 'configCard' && !isNavCard && !entityType.includes('user');
          });
          if (isRefresh) {
            headlineUserItems.value = incomingUsers;
            headlineDiscoveryItems.value = incomingDiscoveryItems;
          } else {
            const existingUsers = new Set(headlineUserItems.value.map((item) => String(item.uid || item.entityId || item.id)));
            headlineUserItems.value.push(...incomingUsers.filter((item) => !existingUsers.has(String(item.uid || item.entityId || item.id))));
            const existingDiscovery = new Set(headlineDiscoveryItems.value.map((item) => String(item.entityId || item.id || item.url)));
            headlineDiscoveryItems.value.push(...incomingDiscoveryItems.filter((item) => !existingDiscovery.has(String(item.entityId || item.id || item.url))));
          }
          if (headlineDiscoveryItems.value.length === 0 && headlineUserItems.value.length === 0 && validItems.length > 0) {
            if (isRefresh) feeds.value = validItems;
            else feeds.value.push(...validItems);
          }
        } else if (isRefresh) {
          feeds.value = validItems;
        } else {
          feeds.value.push(...validItems);
        }
      }
      page.value++;
    }

    if (isHeadlineTab.value) {
      if (rawItems.length === 0) noMore.value = true;
      else updateHeadlineCursor(validItems, page.value === 2);
    } else if (isHotTab.value) {
      noMore.value = !rawItems.some(hasFeedRenderableContent);
    } else if (validItems.length < 3) {
      noMore.value = true;
    }

    if (isRefresh) {
      feeds.value = validItems;
    } else {
      const existingIds = new Set(feeds.value.map(i => i.id));
      const uniqueNew = validItems.filter(i => !existingIds.has(i.id));
      feeds.value.push(...uniqueNew);
    }

    if (!isHeadlineTab.value && !isCursorFeedTab.value) {
      setTimeout(() => {
        prefetchNextPage();
      }, 200);
    }

  } catch (err: any) {
    if (sequence === feedRequestSequence) error.value = err?.message || '加载失败，请检查网络';
  } finally {
    if (sequence === feedRequestSequence) { loading.value = false; loadingMore.value = false; }
  }
  // 追加数据后重新检查短列，首屏不足或两列高度差较大时不必再滚动一次。
  if (sequence === feedRequestSequence && !error.value) scheduleFeedEndCheck();
}

function loadNearFeedEnd(el: HTMLElement) {
  if (!props.selected || pagerMoving.value || loading.value || loadingMore.value || noMore.value) return;
  let remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
  let threshold = 250;
  const columns = Array.from(el.querySelectorAll<HTMLElement>('.feed-waterfall-column'));
  // 单列布局中的容器使用 display: contents，只有实际双列才按较短一列提前一个可视屏加载。
  if (isDoubleColumn.value && columns.length === 2 && columns.every(column => getComputedStyle(column).display === 'flex')) {
    const viewportBottom = el.getBoundingClientRect().top + el.clientTop + el.clientHeight;
    remaining = Math.min(...columns.map(column => column.getBoundingClientRect().bottom)) - viewportBottom;
    threshold = Math.max(480, el.clientHeight);
  }
  if (remaining < threshold) void loadFeeds(false);
}

function scheduleFeedEndCheck() {
  void nextTick(() => {
    const el = feedScrollContainer.value;
    if (!error.value && el && el.clientHeight > 0) loadNearFeedEnd(el);
  });
}

function handleScroll(e: Event) { loadNearFeedEnd(e.currentTarget as HTMLElement); }

watch([() => props.selected, feedLayout], scheduleFeedEndCheck);

function resetFeedScroll() {
  if (!feedScrollContainer.value) return;
  feedScrollContainer.value.scrollTop = 0;
  feedScrollContainer.value.scrollLeft = 0;
}

function quickSearch(kw: string) {
  router.push({ path: '/search', query: { q: kw } });
}

function selectHotChannel(channel: DiscoveryEntity) {
  if (!channel.url || selectedHotChannelUrl.value === channel.url) return;
  selectedHotChannelUrl.value = channel.url;
  // 连续切换时允许立即发起新分类，迟到的旧结果不能覆盖当前选择。
  feedRequestSequence += 1;
  loading.value = loadingMore.value = false;
  resetFeedScroll();
  void loadFeeds(true);
}

function handleTabOrderUpdated() {
  serverTabs.value = [...serverTabs.value];
  if (!orderedDynamicTabs.value.some((tab) => getTabKey(tab) === activeTab.value)) {
    activeTab.value = resolveInitialTab();
  }
}

function isDefaultFollowSubChannel(channel: HomeSubChannel): boolean {
  if (Object.keys(channel.requestArgs).length > 0) return false;
  const firstChannel = followSubChannels.value[0];
  if (firstChannel?.key === channel.key) return true;
  const channelUrl = normalizeSubChannelUrl(channel.url).replace(/^#/, '');
  const parentUrl = normalizeSubChannelUrl(currentActiveTabObj.value?.url || activeTab.value).replace(/^#/, '');
  return !channelUrl
    || channelUrl === parentUrl
    || /\/user\/followFeedList(?:\?|$)/i.test(channelUrl);
}

function isFollowSubChannelSelected(channel: HomeSubChannel): boolean {
  return activeFollowSubChannelKey.value === channel.key;
}

function selectFollowSubChannel(channel: HomeSubChannel) {
  if (selectedFollowSubChannelKey.value === channel.key) return;
  selectedFollowSubChannelKey.value = channel.key;
  resetFeedScroll();
  void loadFeeds(true);
}

function handleHomeSubChannelSelected(selection: HomeSubChannelSelection) {
  pendingFollowSubChannelKey.value = selection.subChannel.key;
  if (activeTab.value !== selection.parentKey) {
    activeTab.value = selection.parentKey;
    return;
  }
  selectedFollowSubChannelKey.value = selection.subChannel.key;
  pendingFollowSubChannelKey.value = '';
  resetFeedScroll();
  void loadFeeds(true);
}

function normalizeSubChannelUrl(rawUrl: string): string {
  let url = String(rawUrl || '').trim();
  if (!url) return '';
  // 如果是 coolapk 站内 http/https 链接，去掉域名部分，转换为站内 API 相对路径
  const match = url.match(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)*coolapk\.com(\/.*)?$/i);
  if (match) {
    url = match[1] || '/';
  }
  return url;
}

function isSubChannelSelected(channel: { url: string }): boolean {
  const current = selectedHeadlineSubChannelUrl.value;
  if (!current) return false;
  const channelUrl = normalizeSubChannelUrl(channel.url);
  return current === channelUrl || current === channel.url.trim();
}

function openHeadlineSubChannel(channel: { title: string; url: string; subTitle: string }) {
  let url = normalizeSubChannelUrl(channel.url);
  if (!url) return;

  // 如果非酷安内部地址的纯外链，才调用外部浏览器
  if (/^https?:\/\//i.test(url)) {
    void CoolapkTauriAPI.openUrl(url, settingsStore.settings.externalLinkMode);
    return;
  }

  // 如果再次点击已选中的子栏目，则取消选中切回默认全部头条流
  if (isSubChannelSelected(channel)) {
    selectedHeadlineSubChannelUrl.value = '';
    headlineDiscoveryItems.value = [];
    headlineUserItems.value = [];
    headlineResolvedUrl.value = '';
    selectedHeadlineNestedSubChannelUrl.value = '';
    resetHeadlineCursor();
    void loadFeeds(true);
  } else {
    selectedHeadlineSubChannelUrl.value = url;
    headlineDiscoveryItems.value = [];
    headlineUserItems.value = [];
    headlineResolvedUrl.value = '';
    selectedHeadlineNestedSubChannelUrl.value = '';
    resetHeadlineCursor();
    if (!isProductSelectorActive.value) {
      void loadFeeds(true);
    }
  }
}

function openHeadlineNestedSubChannel(channel: { title: string; url: string }) {
  const url = channel.url.trim();
  if (!url) return;
  selectedHeadlineNestedSubChannelUrl.value = url;
  headlineResolvedUrl.value = normalizeHeadlinePageUrl(url);
  headlineCursor.firstItem = '';
  headlineCursor.lastItem = '';
  headlinePageContext.value = '';
  headlineDiscoveryItems.value = [];
  headlineUserItems.value = [];
  feeds.value = [];
  page.value = 1;
  noMore.value = false;
  void loadFeeds(true);
}

function getHeadlineUserName(item: any): string {
  return String(item?.displayUsername || item?.username || item?.userInfo?.username || '酷友').trim();
}

function getHeadlineUserVerify(item: any): string {
  const label = String(item?.verify_label || item?.verify_title || '').trim();
  return label.replace(/^酷安认证[:：]\s*/, '');
}

function openHeadlineUser(item: any) {
  const uid = String(item?.uid || item?.entityId || '').trim();
  if (uid) void router.push(`/user/${encodeURIComponent(uid)}`);
}

watch(activeTab, (nextTab, previousTab) => {
  if (nextTab !== previousTab) {
    // 首次初始化已在请求列表；只有真正离开一个栏目时才取消旧请求。
    if (previousTab) { feedRequestSequence += 1; loading.value = loadingMore.value = false; }
    // 切换主栏目后重新初始化，避免携带上一栏目留下的头条刷新锚点。
    resetHeadlineCursor();
    selectedHeadlineSubChannelUrl.value = '';
    const nextTabObj = orderedDynamicTabs.value.find((tab) => (tab.page_name || tab.url || String(tab.id || tab.title)) === nextTab);
    if (isFollowingHomeTab(nextTabObj, nextTab)) {
      selectedFollowSubChannelKey.value = pendingFollowSubChannelKey.value;
    } else {
      selectedFollowSubChannelKey.value = '';
    }
    pendingFollowSubChannelKey.value = '';
  }
  if (isInitializingHome) return;
  resetFeedScroll();
  loadFeeds(true);
});

const navIndex = ref(-1);
const cardEls: (HTMLElement | null)[] = [];
const cardInstances: any[] = [];

function setCardRef(el: unknown, idx: number) {
  cardInstances[idx] = el;
  const candidate = el as any;
  const element = candidate?.$el instanceof HTMLElement ? candidate.$el : candidate;
  cardEls[idx] = element instanceof HTMLElement ? element : null;
}

function isAnswerHomeItem(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const source = item as Record<string, unknown>;
  const explicitMarkers = [
    source.feedType,
    source.feed_type,
    source.entityType,
    source.entity_type,
    source.type,
    source.answerType,
    source.answer_type,
  ].map((value) => String(value ?? '').trim().toLowerCase());
  // 首页问答频道中的普通问题有时还会携带 answerId/回答统计字段，
  // 只有服务端明确把实体标成 answer 时才使用回答卡，避免把问题误画成“回答”。
  return explicitMarkers.some((value) => value === 'answer' || value === 'feed_answer' || value === 'question_answer')
    && isAnswerSearchEntity(source as any);
}

function isQuestionHomeItem(item: unknown): boolean {
  return isQuestionFeedEntity(item);
}

function isRatingHomeItem(item: unknown): boolean {
  return isRatingFeedEntity(item);
}

function handleFeedNav(delta: number) {
  if (feeds.value.length === 0) return;
  let next = navIndex.value + delta;
  if (next < 0) next = 0;
  if (next >= feeds.value.length) next = feeds.value.length - 1;
  if (next === navIndex.value && delta > 0) return;
  navIndex.value = next;
  const el = cardEls[next];
  if (el) {
    el.scrollIntoView({ behavior: settingsStore.settings.reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }
}

const onNavNext = () => handleFeedNav(1);
const onNavPrev = () => handleFeedNav(-1);
const onNavComment = () => {
  if (feeds.value.length === 0) return;
  if (navIndex.value < 0 || navIndex.value >= feeds.value.length) {
    navIndex.value = 0;
  }
  const inst = cardInstances[navIndex.value];
  if (inst && typeof inst.toggleComments === 'function') {
    void inst.toggleComments();
    return;
  }
  const el = cardEls[navIndex.value];
  if (el) {
    const commentBtn = el.querySelector('button[title="评论"], .action-btn[aria-label*="评论"], .btn-action-comment');
    if (commentBtn instanceof HTMLElement) commentBtn.click();
  }
};
const onRefreshFeeds = () => {
  if (!loading.value && !loadingMore.value) loadFeeds(true);
};

/** 单击「首页」：回到列表顶部。 */
const onHomeTabScrollTop = () => resetFeedScroll();

/**
 * 双击「首页」：回到顶部后按当前栏目重新拉取第一页。
 *
 * 直接复用栏目切换那条链路（resetFeedScroll + loadFeeds(true)），所以刷新拿到的是
 * 当前选中栏目（关注 / 热榜 / 快讯 / 服务端下发的任意频道）的最新内容，不会串到别的栏目。
 */
const onHomeTabRefresh = () => {
  resetFeedScroll();
  onRefreshFeeds();
};

function handleFeedDeleted(id: string | number) {
  feeds.value = feeds.value.filter((f: any) => String(f.id) !== String(id));
}

function formatDyhCount(n: any): string {
  const num = Number(n) || 0;
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  return String(num);
}

function openDyh(dyhId: any) {
  if (dyhId) router.push(`/dyh/${String(dyhId)}`);
}

function navigatePageEntity(target: string, title: string) {
  const clean = target.replace(/^#/, '');
  const secondHand = clean.match(/^\/feed\/ershouList(?:\?|$)/i);
  const user = clean.match(/^\/user\/([^/?#]+)/i);
  const feed = clean.match(/^\/feed\/([^/?#]+)/i);
  const app = clean.match(/^\/(?:app|apk)\/([^/?#]+)/i);
  // 产品列表接口也使用 /product/ 前缀，只有数字 ID 才能跳转产品详情。
  const product = clean.match(/^\/product\/(\d+)(?=[/?#]|$)/i);
  const topic = clean.match(/^\/topic\/([^/?#]+)/i);
  const dyh = clean.match(/^\/dyh\/([^/?#]+)/i);
  const live = clean.match(/^\/live\/([^/?#]+)/i);
  if (secondHand) {
    const localRoute = normalizeCoolapkRoute(clean);
    if (localRoute) void router.push(localRoute);
    else void router.push({ path: '/page', query: { url: target, title, renderer: 'discovery' } });
  } else if (user) void router.push(`/user/${user[1]}`);
  else if (feed) void router.push(`/feed/${feed[1]}`);
  else if (app) void router.push(`/app/${encodeURIComponent(decodeDiscoveryRouteSegment(app[1]))}`);
  else if (product) void router.push(`/product/${product[1]}`);
  else if (topic) void router.push(`/topic/${encodeURIComponent(decodeDiscoveryRouteSegment(topic[1]))}`);
  else if (dyh) void router.push(`/dyh/${dyh[1]}`);
  else if (live && !/^detail$/i.test(live[1])) void router.push(`/live/${live[1]}`);
  else void router.push({ path: '/page', query: { url: target, title, renderer: 'discovery' } });
}

function openPageEntity(entity: DiscoveryEntity) {
  const routeInfo = resolveDiscoveryRoute(entity);
  if (!routeInfo) return;
  if (routeInfo.kind === 'web') {
    void CoolapkTauriAPI.openUrl(routeInfo.target, settingsStore.settings.externalLinkMode);
    return;
  }
  navigatePageEntity(routeInfo.target, routeInfo.title || String(entity.title || ''));
}

async function initializeHome() {
  if (props.embedded) {
    serverTabs.value = props.tabs || [];
    activeTab.value = props.tabKey || '';
  } else {
    await fetchTabConfig();
    syncTabFromRoute();
  }
  isInitializingHome = false;
  await loadFeeds(true);
}

function bindGlobalListeners() {
  if (props.embedded && (!props.selected || route.path !== '/')) return;
  window.addEventListener('feed-nav-next', onNavNext);
  window.addEventListener('feed-nav-prev', onNavPrev);
  window.addEventListener('feed-nav-comment', onNavComment);
  window.addEventListener('refresh-feeds', onRefreshFeeds);
  window.addEventListener(HOME_TAB_SCROLL_TOP_EVENT, onHomeTabScrollTop);
  window.addEventListener(HOME_TAB_REFRESH_EVENT, onHomeTabRefresh);
  window.addEventListener('pointerup', handleFeedPointerUp);
  window.addEventListener('pointercancel', handleFeedPointerCancel);
}

function unbindGlobalListeners() {
  window.removeEventListener('feed-nav-next', onNavNext);
  window.removeEventListener('feed-nav-prev', onNavPrev);
  window.removeEventListener('feed-nav-comment', onNavComment);
  window.removeEventListener('refresh-feeds', onRefreshFeeds);
  window.removeEventListener(HOME_TAB_SCROLL_TOP_EVENT, onHomeTabScrollTop);
  window.removeEventListener(HOME_TAB_REFRESH_EVENT, onHomeTabRefresh);
  window.removeEventListener('pointerup', handleFeedPointerUp);
  window.removeEventListener('pointercancel', handleFeedPointerCancel);
  resetHomeTabSwipeState();
}

onMounted(() => {
  bindGlobalListeners();
  void initializeHome();
});

onActivated(bindGlobalListeners);
watch(() => props.selected, (selected) => { unbindGlobalListeners(); if (selected) bindGlobalListeners(); });
watch(() => props.tabs, (tabs) => { if (props.embedded && tabs) serverTabs.value = tabs; });
onDeactivated(unbindGlobalListeners);
onUnmounted(() => { feedRequestSequence += 1; unbindGlobalListeners(); });
defineExpose({ handleHomeSubChannelSelected, activeFollowSubChannelKey });

// 下拉仅刷新当前栏目，不切换筛选、路由或页面实例。
async function refreshMobilePage() { await loadFeeds(true); }
</script>

<style scoped>
.home-page-layout {
  container-type: inline-size;
  container-name: layout;
  display: flex;
  width: 100%;
  height: 100%;
  gap: 0;
  padding: 0;
  box-sizing: border-box;
  overflow: hidden;
}

@container layout (max-width: 960px) {
  :deep(.right-sidebar) {
    display: none !important;
  }
}

.main-feed-column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--surface);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.feed-toolbar-row {
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  min-width: 0;
  background: var(--surface);
  border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
}

.feed-toolbar-row :deep(.feed-tabs) {
  flex: 1 1 auto;
  min-width: 0;
  border-bottom: 0;
}

.follow-subchannel-bar {
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 16px;
  background: var(--surface, #fff);
  border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
}

/* 展开按钮复用分类栏高度，收起头像列表后不再占用一行。 */
.follow-updates-expand { display: flex; align-items: center; justify-content: center; flex: 0 0 32px; align-self: stretch; border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); font-size: 11px; cursor: pointer; }
.follow-updates-expand:hover { background: var(--surface-hover); color: var(--text-secondary); }
.follow-updates-expand:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }

.follow-subchannel-list {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.follow-subchannel-list::-webkit-scrollbar {
  display: none;
}

.follow-subchannel-item {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: 16px;
  padding: 6px 11px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: color .15s ease, background-color .15s ease;
}

.follow-subchannel-item:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}

.follow-subchannel-item.active {
  color: var(--brand-primary, #10b981);
  background: var(--brand-soft, rgba(16, 185, 129, .1));
  font-weight: 700;
}

.feed-scroll-container {
  flex: 1;
  overflow-y: auto;
  touch-action: pan-y;
  background-color: var(--background-secondary);
  /* 软键盘弹出时补出底部留白，否则评论框无法滚到键盘上方。 */
  padding-bottom: calc(var(--keyboard-inset, 0px) + var(--mobile-bottom-overlay-space, 0px));
}

/* 1. 头条 Tab 头部样式 */
.headline-header-section {
  padding: 14px 16px 4px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--surface, #fff);
  border-bottom: 1px solid var(--border);
}

.quick-icons-grid {
  display: flex;
  flex-wrap: nowrap;
  gap: 12px;
  padding: 4px 0 6px 0;
  overflow-x: auto;
  user-select: none;
  scrollbar-width: thin;
  scrollbar-color: var(--border, rgba(0, 0, 0, 0.15)) transparent;
}

.quick-icons-grid::-webkit-scrollbar {
  height: 5px;
}

.quick-icons-grid::-webkit-scrollbar-track {
  background: transparent;
}

.quick-icons-grid::-webkit-scrollbar-thumb {
  background-color: var(--border, rgba(0, 0, 0, 0.15));
  border-radius: 4px;
}

.quick-icons-grid::-webkit-scrollbar-thumb:hover {
  background-color: var(--border-hover, rgba(0, 0, 0, 0.3));
}

.headline-nested-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  padding-top: 10px;
  border-top: 1px solid var(--border-light, rgba(0, 0, 0, .06));
  scrollbar-width: none;
}

.headline-nested-tabs::-webkit-scrollbar {
  display: none;
}

.headline-nested-tab {
  position: relative;
  flex: 0 0 auto;
  border: 0;
  border-radius: 8px;
  padding: 7px 14px 9px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: color .15s ease, background-color .15s ease;
}

.headline-nested-tab:hover {
  color: var(--brand-primary, #10b981);
  background: var(--brand-soft, rgba(16, 185, 129, .08));
}

.headline-nested-tab.active {
  color: var(--brand-primary, #10b981);
  background: var(--brand-soft, rgba(16, 185, 129, .1));
  font-weight: 700;
}

.icon-btn-item {
  border: 0;
  background: transparent;
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 0 0 80px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary);
  transition: background-color 0.15s ease;
  padding: 8px 4px;
  border-radius: 12px;
}

.icon-btn-item:hover {
  background-color: var(--surface-hover);
}

.icon-btn-item.selected {
  background-color: var(--surface-hover);
  font-weight: 700;
}

.icon-circle {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--text-secondary);
  transition: transform 0.15s ease;
}

.headline-sub-channel-logo {
  width: 48px;
  height: 48px;
  border-radius: 14px;
}

.icon-btn-item:hover .icon-circle {
  transform: translateY(-2px);
}

.headline-discovery-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px;
}

.home-page-entity-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 16px;
}

.page-entity-no-more {
  padding: 12px 0;
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}

.feed-no-more {
  padding: var(--space-4) 0;
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}

.headline-ranking-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(var(--headline-ranking-rows, 10), minmax(92px, auto));
  grid-auto-flow: column;
  gap: 14px;
  padding: 16px;
}

.headline-ranking-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 92px;
  padding: 14px 16px 14px 12px;
  overflow: hidden;
  border: 1px solid var(--border-light, rgba(0, 0, 0, .08));
  border-radius: 14px;
  background: var(--surface);
  cursor: pointer;
  transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
}

.headline-ranking-card:hover,
.headline-ranking-card:focus-visible {
  border-color: var(--brand-primary, #10b981);
  box-shadow: 0 7px 20px rgba(16, 185, 129, .12);
  outline: none;
  transform: translateY(-1px);
}

.headline-ranking-card.is-top-three {
  background: linear-gradient(135deg, var(--surface) 0%, rgba(255, 249, 232, .9) 100%);
}

.headline-ranking-card.rank-2 { background: linear-gradient(135deg, var(--surface) 0%, rgba(243, 247, 251, .95) 100%); }
.headline-ranking-card.rank-3 { background: linear-gradient(135deg, var(--surface) 0%, rgba(255, 244, 235, .9) 100%); }

.headline-rank-number {
  display: grid;
  place-items: center;
  width: 28px;
  flex: 0 0 28px;
  color: var(--text-tertiary);
  font-size: 18px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.rank-1 .headline-rank-number { color: #e5a400; font-size: 24px; }
.rank-2 .headline-rank-number { color: #8b98a5; font-size: 22px; }
.rank-3 .headline-rank-number { color: #c77b4b; font-size: 21px; }

.headline-ranking-avatar {
  flex: 0 0 auto;
}

.headline-ranking-info {
  min-width: 0;
  flex: 1;
}

.headline-ranking-name-row,
.headline-ranking-stats {
  display: flex;
  align-items: center;
  min-width: 0;
}

.headline-ranking-name-row {
  gap: 7px;
}

.headline-ranking-name-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.headline-ranking-verify {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  color: #e69a16;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.headline-ranking-tags {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.headline-ranking-level,
.headline-ranking-top-label {
  border-radius: 5px;
  padding: 2px 6px;
  font-size: 11px;
  line-height: 1.2;
}

.headline-ranking-level {
  background: var(--brand-soft, rgba(16, 185, 129, .1));
  color: var(--brand-primary, #10b981);
}

.headline-ranking-top-label {
  background: rgba(235, 174, 37, .14);
  color: #b07800;
}

.headline-ranking-stats {
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  color: var(--text-tertiary);
  font-size: 11px;
}

.headline-ranking-stats span {
  white-space: nowrap;
}

.headline-ranking-stats i {
  margin-right: 3px;
  color: var(--text-secondary);
}

.headline-ranking-arrow {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 12px;
}

@container layout (max-width: 720px) {
  .headline-ranking-list {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    grid-auto-flow: row;
  }
}

/* 2. 热榜 Tab 头部样式 */
.hot-header-section {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--background-secondary);
}

.hot-ranks-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0;
  padding: 4px 12px;
  background: var(--surface);
}

.rank-official-icon { width: 36px; height: 36px; }

/* APK IconMiniGridCard：每行两条，20dp 图标、8dp 间距、单行标题，不额外生成标题栏。 */
.hot-topics { min-width: 0; background: var(--surface); }
.hot-topics-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px 0; color: var(--text-secondary); font-size: 14px; }
.hot-topics-header button { display: inline-flex; align-items: center; gap: 4px; padding: 2px 0 2px 8px; border: 0; background: transparent; color: var(--brand-primary); font: inherit; cursor: pointer; }
.hot-topics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; padding: 6px 16px; }
.hot-topic { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 36px; padding: 8px 0; border: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.hot-topic:hover { background: var(--brand-soft); }
.hot-topic:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: -2px; }
.hot-topic-icon { width: 20px; height: 20px; flex: 0 0 20px; border-radius: 4px; }
.hot-topic-title { min-width: 0; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 官方 transButton 单选栏：小屏横向滚动，吸顶时仍使用主题底色。 */
.hot-channel-tabs { display: flex; flex-shrink: 0; align-items: center; gap: 8px; padding: 8px 16px; overflow-x: auto; background: var(--surface); border-bottom: 1px solid var(--border); }
.hot-channel-tabs.is-fixed { position: sticky; top: 0; z-index: 5; }
.hot-channel-tabs, .hot-search-chips { scrollbar-width: none; }
.hot-channel-tabs::-webkit-scrollbar, .hot-search-chips::-webkit-scrollbar { display: none; }
.hot-channel-tab { flex-shrink: 0; border: 1px solid transparent; border-radius: 8px; padding: 5px 10px; font-size: 12px; line-height: 20px; color: var(--text-primary); background: transparent; white-space: nowrap; cursor: pointer; }
.hot-channel-tab:hover { color: var(--brand-primary); background: var(--brand-soft); }
.hot-channel-tab.active { color: var(--brand-primary); border-color: var(--brand-primary); background: var(--brand-soft); font-weight: 600; }
.hot-channel-tab:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: -2px; }

.rank-action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 9px 4px 8px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary);
}

.rank-action-item.active {
  color: var(--brand-primary);
  font-weight: 700;
  background: var(--brand-soft);
}

.rank-action-item:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
}

.rank-icon-bg {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #fff;
  transition: transform 0.2s ease;
}

.rank-action-item:hover .rank-icon-bg {
  transform: scale(1.05);
}

.bg-orange { background: linear-gradient(135deg, #f97316, #ea580c); }
.bg-cyan { background: linear-gradient(135deg, #06b6d4, #0284c7); }
.bg-yellow { background: linear-gradient(135deg, #eab308, #ca8a04); }
.bg-purple { background: linear-gradient(135deg, #a855f7, #7e22ce); }
.bg-red { background: linear-gradient(135deg, #f43f5e, #e11d48); }

.hot-search-chips {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 6px 12px;
  background: var(--surface);
}

.chip-btn {
  padding: 4px 12px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.chip-btn:hover {
  background: var(--brand-soft);
  color: var(--brand-primary);
  border-color: var(--brand-primary);
}

/* 3. 快讯 Banner 样式 */
.express-banner {
  margin: 14px 16px 4px 16px;
  background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
  border-radius: 12px;
  padding: 16px 20px;
  color: #fff;
}

.express-banner-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.banner-title {
  font-size: 18px;
  font-weight: 800;
}

.banner-sub {
  font-size: 12px;
  opacity: 0.85;
}

.skeleton-padding, .error-padding, .empty-padding {
  display: flex;
  flex-direction: column;
  gap: var(--feed-card-gap, 12px);
  padding: 12px;
}

.feed-list-padding {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 0;
}

.feed-list-padding :deep(.feed-card) {
  margin-bottom: 0;
  border-right: 0;
  border-left: 0;
  border-radius: 0;
}

.feed-list-padding.is-double-column {
  /* 两列内部各自垂直排布，保持瀑布流，不按行对齐或自动平衡已有卡片。 */
  display: grid;
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
  padding: 12px;
}

.feed-waterfall-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.feed-list-padding.is-double-column :deep(.feed-card) {
  display: block;
  width: 100%;
  margin-bottom: 0;
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.08));
  border-radius: 14px;
  overflow: hidden;
  break-inside: avoid;
}

.feed-list-padding.is-double-column > .loading-more,
.feed-list-padding.is-double-column > .feed-no-more {
  grid-column: 1 / -1;
  order: 2147483647;
}

@container layout (max-width: 760px) {
  .feed-list-padding.is-double-column {
    grid-template-columns: minmax(0, 1fr);
  }
  /* 单列时拆开两列容器，按动态原始顺序排列，保留卡片实例和展开状态。 */
  .feed-waterfall-column { display: contents; }
}

@media (max-width: 720px) {
  .home-page-layout {
    height: 100%;
  }

  .main-feed-column {
    border-right: 0;
  }

  .feed-toolbar-row :deep(.feed-layout-toggle) {
    display: none !important;
  }

  .feed-scroll-container {
    overscroll-behavior-y: contain;
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
  }

  .feed-list-padding,
  .feed-list-padding.is-double-column {
    display: flex;
    flex-direction: column;
    gap: var(--mobile-feed-gap);
    padding: var(--mobile-feed-gap) 0;
  }

  .feed-waterfall-column { display: contents; }

  .feed-list-padding.is-double-column :deep(.feed-card),
  .feed-list-padding :deep(.feed-card) {
    display: block;
    width: 100%;
    border-right: 0;
    border-left: 0;
    border-radius: 0;
  }

  .headline-header-section {
    padding-right: var(--mobile-page-padding);
    padding-left: var(--mobile-page-padding);
  }

  .home-page-entity-list,
  .headline-discovery-list,
  .dyh-tab-grid {
    grid-template-columns: 1fr;
    padding: var(--mobile-page-padding);
  }
}

.dyh-tab-grid {
  padding: var(--space-4);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.dyh-tab-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: 14px;
  background: var(--background);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default);
}

.dyh-tab-card:hover {
  border-color: var(--brand-primary);
  transform: translateY(-2px);
}

.dyh-tab-logo {
  width: 44px !important;
  height: 44px !important;
  max-width: none !important;
  max-height: none !important;
  border-radius: 12px !important;
  background: var(--brand-soft) !important;
}

.dyh-tab-logo-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: var(--brand-primary);
  background: var(--brand-soft);
  font-size: 18px;
}

.dyh-tab-info {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.dyh-tab-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dyh-tab-desc {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dyh-tab-follow {
  color: var(--text-secondary);
  font-size: 10px;
}

.dyh-tab-follow i {
  margin-right: 3px;
  color: var(--brand-primary);
}

.dyh-tab-arrow {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 11px;
}

.dyh-tab-no-more {
  grid-column: 1 / -1;
  padding: 12px 0;
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}

.feed-card-focused {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
  border-radius: var(--radius-card);
}

.loading-more {
  padding: var(--space-4) 0;
}
</style>
