<template>
  <ProductCategoryBrowser v-if="isProductCategoryDirectory" :selected-id="productCategoryId" @open="openEntity" />
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: loading || loadingMore }" v-else ref="scrollContainer" class="page-container custom-scrollbar" @scroll="handleScroll">
    <div v-if="!isDynamicPage" class="page-header page-data-header">
      <div class="header-titles">
        <h2 class="page-title"><i class="fas fa-list-ul icon"></i>{{ pageTitle }}</h2>
      </div>
    </div>

    <nav v-if="dynamicTabs.length" class="dynamic-tabs" aria-label="内容分类">
      <button v-for="tab in dynamicTabs" :key="String(tab.url)" :class="{ active: selectedTabUrl === tab.url }" :disabled="loading || loadingMore" @click="selectDynamicTab(tab)">{{ tab.title }}</button>
    </nav>
    <template v-if="isDynamicPage">
      <div v-if="loading && dynamicItems.length === 0" class="state-wrapper">
        <FeedSkeleton :count="4" />
      </div>
      <div v-else-if="error && dynamicItems.length === 0" class="state-wrapper">
        <ErrorState title="加载页面内容失败" :message="error" @retry="loadCurrentPage(true)" />
      </div>
      <div v-else-if="dynamicItems.length === 0" class="state-wrapper">
        <EmptyState title="暂无内容" />
      </div>
      <div v-else :class="['feed-list', 'discovery-page-list', { 'topic-list-layout': isTopicListPage }]">
        <template v-for="(item, index) in dynamicItems" :key="getEntityKey(item, index)">
          <button v-if="isProductRankingPage && item.entityType === 'product'" class="ranking-row" @click="openEntity(item)">
            <span class="ranking-number">{{ String(index + 1).padStart(2, '0') }}</span><AppImage :src="getEntityImage(item)" fit="contain" class="ranking-image" />
            <span class="ranking-copy"><strong>{{ getDigitalEntityTitle(item) }}</strong><small>{{ getDigitalProductHot(item) }}热度<span v-if="item.feed_comment_num"> · {{ item.feed_comment_num }}讨论</span></small></span>
          </button>
          <DiscoveryEntityCard v-else :entity="item" @open="openEntity" />
        </template>
        <div v-if="loadingMore" class="loading-more"><LoadingState text="加载更多..." /></div>
        <div v-else-if="error" class="loading-more">
          <button class="retry-inline" type="button" @click="retryDynamicMore">加载失败，点击重试</button>
        </div>
      </div>
    </template>
    <template v-else>
      <div v-if="loading && feeds.length === 0" class="state-wrapper">
        <FeedSkeleton :count="4" />
      </div>
      <div v-else-if="error && feeds.length === 0" class="state-wrapper">
        <ErrorState title="加载页面内容失败" :message="error" @retry="loadFeeds(true)" />
      </div>
      <div v-else-if="feeds.length === 0" class="state-wrapper">
        <EmptyState title="暂无内容" />
      </div>
      <div v-else class="feed-list">
        <FeedCard
          v-for="(item, index) in feeds"
          :key="item.id || index"
          :feed="item"
          @deleted="handleFeedDeleted"
        />
        <div v-if="loadingMore" class="loading-more"><LoadingState text="加载更多..." /></div>
        <div v-else-if="error" class="loading-more">
          <button class="retry-inline" type="button" @click="retryFeedsMore">加载失败，点击重试</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import DiscoveryEntityCard from '../components/discovery/DiscoveryEntityCard.vue';
import ProductCategoryBrowser from '../components/digital/ProductCategoryBrowser.vue';
import AppImage from '../components/common/AppImage.vue';
import { getEntityImage } from '../utils/discovery';
import { getDigitalEntityTitle, getDigitalProductHot } from '../utils/digitalProduct';
import FeedCard from '../components/feed/FeedCard.vue';
import FeedSkeleton from '../components/feed/FeedSkeleton.vue';
import LoadingState from '../components/common/LoadingState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import { useSettingsStore } from '../stores/settings';
import { hasFeedRenderableContent, shouldHideFeed } from '../utils/feedFilter';
import { decodeDiscoveryRouteSegment, getEntityKey, parseDiscoveryPage, resolveDiscoveryRoute } from '../utils/discovery';
import { normalizeCoolapkRoute } from '../utils/coolapkRoute';
import type { DiscoveryEntity } from '../types/discovery';
import { productSortTarget, markProductSort, replaceSortedProducts } from '../utils/productSort';

// App.vue caches each route.fullPath separately. useRoute() continues to change
// even while this instance is leaving or deactivated, so bind its own query once.
const pageQuery = { ...useRoute().query };
const router = useRouter();
const settingsStore = useSettingsStore();
const pageUrl = computed(() => typeof pageQuery.url === 'string' ? pageQuery.url : '');
const pageTitle = computed(() => typeof pageQuery.title === 'string' && pageQuery.title.trim()
  ? pageQuery.title
  : '酷安内容');
const pageSubTitle = computed(() => typeof pageQuery.subTitle === 'string' ? pageQuery.subTitle
  : new URLSearchParams(pageUrl.value.split('?')[1] || '').get('subTitle') || '');

const page = ref(1);
const scrollContainer = ref<HTMLElement | null>(null);
const feeds = ref<any[]>([]);
const dynamicItems = ref<DiscoveryEntity[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const noMore = ref(false);
const dynamicNoMore = ref(false);
const dynamicFirstItem = ref('');
const dynamicLastItem = ref('');
const error = ref('');
const dynamicTabs = ref<DiscoveryEntity[]>([]);
const selectedTabUrl = ref('');
const selectedTab = computed(() => dynamicTabs.value.find(tab => tab.url === selectedTabUrl.value));
const contentTarget = ref('');
const contentPageContext = ref('');
const sortTarget = ref('');
function selectDynamicTab(tab: DiscoveryEntity) {
  if (loading.value || loadingMore.value || selectedTabUrl.value === tab.url) return;
  selectedTabUrl.value = String(tab.url || '');
  sortTarget.value = '';
  void loadDynamicPage(true);
}

function extractServerPageTarget(value: string): string {
  const raw = value.trim().replace(/^#/, '');
  const queryIndex = raw.indexOf('?');
  if (queryIndex < 0 || raw.slice(0, queryIndex).toLowerCase() !== '/page') return '';
  return new URLSearchParams(raw.slice(queryIndex + 1)).get('url')?.trim() || '';
}

const dynamicPageTarget = computed(() => extractServerPageTarget(pageUrl.value) || (pageQuery.renderer === 'discovery' ? pageUrl.value.trim() : ''));
const categoryTarget = computed(() => (dynamicPageTarget.value || pageUrl.value).replace(/^#/, ''));
const isProductCategoryDirectory = computed(() => /^\/product\/categoryList(?:\?|$)/i.test(categoryTarget.value));
const productCategoryId = computed(() => new URLSearchParams(categoryTarget.value.split('?')[1] || '').get('id') || '');
const isDynamicPage = computed(() => Boolean(dynamicPageTarget.value) && (pageQuery.renderer === 'discovery' || Boolean(extractServerPageTarget(pageUrl.value))));
const isTopicListPage = computed(() => /^\/?topic\/tagList(?:\?|$)/i.test(dynamicPageTarget.value.trim().replace(/^#\/?/, '')));
const isProductRankingPage = computed(() => /(?:JINRIREMEN|\/product\/(?:hotProductList|unreleasedProductList))(?:\?|$)/i.test(dynamicPageTarget.value.replace(/^#/, '')));

function extractList(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function handleFeedDeleted(id: string | number) {
  feeds.value = feeds.value.filter((feed) => String(feed.id) !== String(id));
}

async function loadFeeds(isRefresh = false) {
  if (!pageUrl.value || loading.value || (loadingMore.value && !isRefresh)) return;
  if (isRefresh) {
    page.value = 1;
    noMore.value = false;
    feeds.value = [];
    loading.value = true;
  } else {
    if (noMore.value) return;
    loadingMore.value = true;
  }
  error.value = '';

  try {
    const response = await CoolapkTauriAPI.getBoardFeeds(pageUrl.value, page.value);
    const nextFeeds = extractList(response)
      .filter((item) => hasFeedRenderableContent(item) && !shouldHideFeed(item, settingsStore.settings));
    if (nextFeeds.length < 3) noMore.value = true;

    if (isRefresh) {
      feeds.value = nextFeeds;
    } else {
      const existingIds = new Set(feeds.value.map((item) => item.id));
      feeds.value.push(...nextFeeds.filter((item) => !existingIds.has(item.id)));
    }
    page.value += 1;
  } catch (loadError: any) {
    error.value = loadError?.message || '加载失败，请检查网络';
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

/** 分页失败后的重试入口（动态页）：只补当前页，不清空已加载内容。 */
function retryDynamicMore() {
  if (loading.value || loadingMore.value) return;
  error.value = '';
  void loadDynamicPage(false);
}

/** 分页失败后的重试入口（动态流）：同上。 */
function retryFeedsMore() {
  if (loading.value || loadingMore.value) return;
  error.value = '';
  void loadFeeds(false);
}

async function loadDynamicPage(isRefresh = false) {
  if (!dynamicPageTarget.value || loading.value || (loadingMore.value && !isRefresh)) return;
  if (!isRefresh && dynamicNoMore.value) return;
  if (isRefresh) {
    page.value = 1;
    dynamicNoMore.value = false;
    dynamicFirstItem.value = '';
    dynamicLastItem.value = '';
    if (!sortTarget.value) dynamicItems.value = [];
    contentTarget.value = '';
    contentPageContext.value = '';
    loading.value = true;
  } else {
    loadingMore.value = true;
  }
  error.value = '';

  try {
    let response = await requestDynamicContent(contentTarget.value || sortTarget.value || selectedTabUrl.value || dynamicPageTarget.value);
    let parsed = parseDiscoveryPage(response, page.value);
    const tabs = parsed.items.find(item => String(item.entityTemplate).toLowerCase() === 'icontablinkgridcard');
    if (isRefresh && !sortTarget.value && !selectedTabUrl.value && tabs?.entities?.length) {
      dynamicTabs.value = tabs.entities;
      const extra = entityExtra(tabs);
      const configuredIndex = Number(extra.selectedTab ?? tabs.selectedTab ?? 0);
      const initialTab = tabs.entities.find(tab => tab.selected === 1 || tab.selected === '1' || tab.selected === true)
        || tabs.entities[Number.isInteger(configuredIndex) ? configuredIndex : 0] || tabs.entities[0]!;
      selectedTabUrl.value = String(initialTab.url || '');
      if (!selectedTabUrl.value) throw new Error('该分类缺少内容地址');
      response = await requestDynamicContent(selectedTabUrl.value);
      parsed = parseDiscoveryPage(response, 1);
    }
    // APK DataListFragment mounts flexList content separately after reading configCard.
    // Follow its server-supplied target rather than interpreting a configuration-only response as empty.
    const visited = new Set<string>([contentTarget.value || sortTarget.value || selectedTabUrl.value || dynamicPageTarget.value]);
    while (parsed.flexUrl) {
      if (visited.has(parsed.flexUrl) || visited.size >= 4) throw new Error('分类内容地址循环，请重试');
      visited.add(parsed.flexUrl);
      contentTarget.value = parsed.flexUrl;
      response = await requestDynamicContent(parsed.flexUrl);
      parsed = parseDiscoveryPage(response, page.value);
    }
    const incoming = markProductSort(parsed.items.filter(item => !sortTarget.value || String(item.entityTemplate).toLowerCase() !== 'icontablinkgridcard'), sortTarget.value);
    dynamicFirstItem.value = parsed.firstItem;
    dynamicLastItem.value = parsed.lastItem;
    contentPageContext.value = parsed.pageContext || '';
    dynamicNoMore.value = incoming.length === 0 || !parsed.hasMore;
    if (isRefresh) {
      dynamicItems.value = replaceSortedProducts(dynamicItems.value, incoming, sortTarget.value);
    } else {
      const existingKeys = new Set(dynamicItems.value.map((item, index) => getEntityKey(item, index)));
      const appended = incoming.filter((item, index) => !existingKeys.has(getEntityKey(item, dynamicItems.value.length + index)));
      // 服务端重复返回同一页时停止，避免未填满窗口的列表持续请求。
      if (appended.length === 0) dynamicNoMore.value = true;
      dynamicItems.value = [...dynamicItems.value, ...appended];
    }
    page.value += 1;
  } catch (loadError: any) {
    error.value = loadError?.message || '加载失败，请检查网络';
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
  // 网格首屏可能不足一屏，等待布局更新后主动补页，不依赖用户产生滚动事件。
  await nextTick();
  const element = scrollContainer.value;
  if (!error.value && element && element.clientHeight > 0 && element.scrollHeight - element.scrollTop - element.clientHeight < 480) void loadDynamicPage(false);
}

function entityExtra(entity: DiscoveryEntity): Record<string, unknown> {
  const raw = entity.extraData ?? entity.extra_data;
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try { return typeof raw === 'string' ? JSON.parse(raw) || {} : {}; } catch { return {}; }
}

async function requestDynamicContent(target: string) {
  const tab = selectedTab.value;
  const nestedTarget = extractServerPageTarget(target);
  const params = new URLSearchParams(target.replace(/^#/, '').split('?')[1] || '');
  const response = await CoolapkTauriAPI.getDiscoveryPageData({
    url: nestedTarget || target,
    title: (nestedTarget ? params.get('title') : '') || String(tab?.title || pageTitle.value),
    subTitle: (nestedTarget ? params.get('subTitle') : '') || String(tab?.subTitle || tab?.sub_title || pageSubTitle.value),
    page: page.value,
    firstItem: dynamicFirstItem.value,
    lastItem: dynamicLastItem.value,
    pageContext: contentPageContext.value || (tab ? '' : JSON.stringify({ source: 'desktop-page-data-list', url: dynamicPageTarget.value })),
  });
  return response;
}

function loadCurrentPage(isRefresh = false) {
  if (isProductCategoryDirectory.value) return;
  if (isDynamicPage.value) void loadDynamicPage(isRefresh);
  else void loadFeeds(isRefresh);
}

function handleScroll(event: Event) {
  if (!isDynamicPage.value) return;
  const element = event.currentTarget as HTMLElement;
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 480) void loadDynamicPage(false);
}

function navigateDataList(target: string, title: string, subTitle = '') {
  void router.push({ path: '/page', query: { url: target, title, subTitle, renderer: 'discovery' } });
}

function navigateNative(target: string, title: string) {
  const clean = target.replace(/^#/, '');
  const secondHand = clean.match(/^\/feed\/ershouList(?:\?|$)/i);
  const user = clean.match(/^\/user\/([^/?#]+)/);
  const feed = clean.match(/^\/feed\/([^/?#]+)/);
  const app = clean.match(/^\/apk\/([^/?#]+)/);
  // 列表地址与详情共用前缀，只有数字产品 ID 才打开详情。
  const product = clean.match(/^\/product\/(\d+)(?=[/?#]|$)/);
  const topic = clean.match(/^\/topic\/([^/?#]+)/);
  const dyh = clean.match(/^\/dyh\/([^/?#]+)/);
  const live = clean.match(/^\/live\/([^/?#]+)/);
  if (secondHand) {
    const localRoute = normalizeCoolapkRoute(clean);
    if (localRoute) void router.push(localRoute);
    else navigateDataList(target, title);
  } else if (user) void router.push(`/user/${user[1]}`);
  else if (feed) void router.push(`/feed/${feed[1]}`);
  else if (app) void router.push(`/app/${encodeURIComponent(decodeDiscoveryRouteSegment(app[1]))}`);
  else if (product) void router.push(`/product/${product[1]}`);
  else if (topic) void router.push(`/topic/${encodeURIComponent(decodeDiscoveryRouteSegment(topic[1]))}`);
  else if (dyh) void router.push(`/dyh/${dyh[1]}`);
  else if (live && !/^detail$/i.test(live[1])) void router.push(`/live/${live[1]}`);
  else navigateDataList(target, title);
}

function openEntity(entity: DiscoveryEntity) {
  const target = productSortTarget(dynamicItems.value, entity);
  if (target) {
    if (loading.value || loadingMore.value || sortTarget.value === target) return;
    sortTarget.value = target;
    void loadDynamicPage(true);
    return;
  }
  const routeInfo = resolveDiscoveryRoute(entity);
  if (!routeInfo) return;
  if (routeInfo.kind === 'web') void CoolapkTauriAPI.openUrl(routeInfo.target, 'internal');
  else if (routeInfo.kind === 'native') navigateNative(routeInfo.target, routeInfo.title || String(entity.title || ''));
  else navigateDataList(routeInfo.target, routeInfo.title || String(entity.title || ''), String(entity.subTitle || entity.sub_title || ''));
}

onMounted(() => { loadCurrentPage(true); });

// 下拉仅刷新当前栏目，不切换筛选、路由或页面实例。
async function refreshMobilePage() { if (isDynamicPage.value) await loadDynamicPage(true); else await loadFeeds(true); }
</script>

<style scoped>
.dynamic-tabs { position: sticky; top: 0; z-index: 2; display: flex; overflow-x: auto; scrollbar-width: none; background: var(--surface); border-bottom: 1px solid var(--border-light); }
.dynamic-tabs button { flex-shrink: 0; padding: 14px; border: 0; background: transparent; color: var(--text-secondary); font: inherit; }
.dynamic-tabs button.active { color: var(--brand-primary); font-weight: 700; box-shadow: inset 0 -3px var(--brand-primary); }
.ranking-row { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; min-height: 100px; padding: 14px; border: 0; border-bottom: 1px solid var(--border-light); background: var(--surface); color: var(--text-primary); text-align: left; }
.ranking-number { flex: 0 0 24px; font-size: 15px; color: var(--text-secondary); }
.ranking-image { width: 54px; height: 60px; flex: 0 0 54px; }
.ranking-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.ranking-copy strong { font-size: 16px; overflow-wrap: anywhere; }
.ranking-copy small { color: var(--text-secondary); font-size: 12px; }
.page-container { width: 100%; max-width: 100%; flex: 1 1 auto; min-width: 0; height: 100%; min-height: 0; box-sizing: border-box; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
.page-data-header { display: flex; align-items: center; padding-bottom: 18px; }
.loading-more { padding: 16px; text-align: center; }
.retry-inline { border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; font-size: var(--font-size-caption); }
.discovery-page-list.topic-list-layout { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; align-content: start; padding: 16px; }
.discovery-page-list.topic-list-layout > .loading-more { grid-column: 1 / -1; }

@media (max-width: 720px) {
  .discovery-page-list.topic-list-layout {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    padding: 12px;
  }

  .topic-list-layout :deep(.topic-card.mode-card) {
    padding: 12px 6px;
    border-radius: 12px;
  }

  .topic-list-layout :deep(.topic-card.mode-card .topic-icon-wrapper) {
    width: 48px;
    height: 48px;
    margin-bottom: 8px;
    border-radius: 12px;
  }

  .topic-list-layout :deep(.topic-card.mode-card .topic-title) {
    font-size: 12px;
  }

  .topic-list-layout :deep(.topic-card.mode-card .topic-stats) {
    display: -webkit-box;
    overflow: hidden;
    white-space: normal;
    text-overflow: ellipsis;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-height: 1.25;
    font-size: 10px;
  }
}
</style>
