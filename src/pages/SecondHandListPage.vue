<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy }" ref="pageContainerRef" class="page-container custom-scrollbar" @scroll="handleScroll">
    <div class="page-header">
      <div class="header-main">
        <button type="button" class="back-button" @click="goBack">
          <i class="fas fa-arrow-left"></i>
          <span>二手市场</span>
        </button>
        <span class="page-subtitle">{{ listTitle }}</span>
      </div>
    </div>

    <div v-if="loading && items.length === 0" class="state-wrapper">
      <DiscoverySkeleton />
    </div>
    <div v-else-if="error && items.length === 0" class="state-wrapper">
      <ErrorState title="闲置列表加载失败" :message="error" @retry="reload" />
    </div>
    <div v-else-if="items.length === 0" class="state-wrapper">
      <EmptyState title="暂无闲置内容" description="这个型号暂时没有可展示的闲置动态" />
    </div>
    <div v-else class="feed-list discovery-page-list">
      <DiscoverySecondHandGrid :items="items" @open="openEntity" />
      <div class="pagination-footer">
        <LoadingState v-if="loadingMore" text="正在加载更多闲置内容..." />
        <button v-else-if="error" type="button" class="retry-inline" @click="loadPage(true)">加载失败，点击重试</button>
        <span v-else-if="noMore" class="no-more">没有更多闲置内容了</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import DiscoverySecondHandGrid from '../components/discovery/DiscoverySecondHandGrid.vue';
import DiscoverySkeleton from '../components/discovery/DiscoverySkeleton.vue';
import LoadingState from '../components/common/LoadingState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { getEntityKey, parseDiscoveryPage, resolveDiscoveryRoute } from '../utils/discovery';
import { normalizeCoolapkRoute } from '../utils/coolapkRoute';
import {
  getSecondHandViewerUid,
  isSecondHandCursorInvalidError,
  isSecondHandListCacheFresh,
  secondHandListCache,
  type SecondHandListCache,
} from '../utils/secondHandCache';
import type { DiscoveryEntity } from '../types/discovery';

const route = useRoute();
const router = useRouter();
const SECOND_HAND_ROUTE = '/feed/ershouList';
const SECOND_HAND_QUERY_KEYS = ['brand', 'productId', 'cityId', 'ershouType', 'dataListType'] as const;

const page = ref(1);
const items = ref<DiscoveryEntity[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const noMore = ref(false);
const firstItem = ref('');
const lastItem = ref('');
const pageContext = ref('');
const error = ref('');
const pageContainerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
// 后台静默刷新：保留旧列表继续展示，不显示骨架屏和加载更多提示。
const silentRefreshing = ref(false);
let requestVersion = 0;

function queryValue(key: string): string {
  const value = route.query[key];
  if (Array.isArray(value)) return String(value[0] || '');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

const listTarget = computed(() => {
  const params = new URLSearchParams();
  for (const key of SECOND_HAND_QUERY_KEYS) {
    const value = queryValue(key);
    if (value || key === 'dataListType') params.set(key, value || 'staggered');
  }
  return `${SECOND_HAND_ROUTE}?${params.toString()}`;
});

const listTitle = computed(() => queryValue('productId') ? `闲置交易 · 型号 ${queryValue('productId')}` : '闲置交易');

const listCacheKey = computed(() => listTarget.value);

function syncCache() {
  // 缓存带时间戳与账号维度，与首页 secondHandPageCache 的规则保持一致。
  secondHandListCache.set(listCacheKey.value, { initialized: true, items: [...items.value], page: page.value, firstItem: firstItem.value, lastItem: lastItem.value, pageContext: pageContext.value, noMore: noMore.value, scrollTop: scrollTop.value, updatedAt: Date.now(), viewerUid: getSecondHandViewerUid() });
}

function restoreCachedState(): SecondHandListCache | null {
  const cached = secondHandListCache.get(listCacheKey.value);
  if (!cached?.initialized) return null;
  page.value = cached.page;
  items.value = [...cached.items];
  noMore.value = cached.noMore;
  firstItem.value = cached.firstItem;
  lastItem.value = cached.lastItem;
  pageContext.value = cached.pageContext;
  scrollTop.value = cached.scrollTop;
  error.value = '';
  void restoreScrollPosition();
  return cached;
}

async function restoreScrollPosition() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (pageContainerRef.value) pageContainerRef.value.scrollTop = scrollTop.value;
}

function resetState() {
  requestVersion += 1;
  secondHandListCache.delete(listCacheKey.value);
  silentRefreshing.value = false;
  loading.value = false;
  loadingMore.value = false;
  page.value = 1;
  items.value = [];
  noMore.value = false;
  firstItem.value = '';
  lastItem.value = '';
  pageContext.value = '';
  error.value = '';
  scrollTop.value = 0;
}

function appendItems(incoming: DiscoveryEntity[]) {
  const existingKeys = new Set(items.value.map((item, index) => getEntityKey(item, index)));
  items.value = [...items.value, ...incoming.filter((item, index) => !existingKeys.has(getEntityKey(item, items.value.length + index)))];
}

async function loadPage(isLoadMore = false, options: { silent?: boolean } = {}) {
  const silent = !isLoadMore && options.silent === true;
  // 静默刷新不打断在途请求；加载更多则按原规则跳过。
  if (silent && (loading.value || loadingMore.value || silentRefreshing.value)) return;
  if (isLoadMore && (loading.value || loadingMore.value || silentRefreshing.value || noMore.value)) return;

  // 静默刷新失败时回滚游标，避免旧列表与新游标错位。
  const previousCursor = { page: page.value, firstItem: firstItem.value, lastItem: lastItem.value, pageContext: pageContext.value, noMore: noMore.value };

  if (isLoadMore) {
    loadingMore.value = true;
  } else if (silent) {
    // 先渲染旧列表：不清空 items、不出骨架屏，只重置分页游标。
    silentRefreshing.value = true;
    page.value = 1;
    noMore.value = false;
    firstItem.value = '';
    lastItem.value = '';
    pageContext.value = '';
  } else {
    silentRefreshing.value = false;
    loading.value = true;
  }
  error.value = '';
  const currentVersion = ++requestVersion;
  const currentPage = page.value;
  let cursorResetNeeded = false;
  try {
    const response = await CoolapkTauriAPI.getDiscoveryPageData({ url: `#${listTarget.value}`, title: listTitle.value, page: currentPage, firstItem: firstItem.value, lastItem: lastItem.value, pageContext: pageContext.value || JSON.stringify({ source: 'desktop-secondhand-list', target: listTarget.value }) });
    if (currentVersion !== requestVersion) return;
    const parsed = parseDiscoveryPage(response, currentPage);
    if (isLoadMore) appendItems(parsed.items);
    else items.value = parsed.items;
    firstItem.value = parsed.firstItem;
    lastItem.value = parsed.lastItem;
    pageContext.value = parsed.pageContext || pageContext.value;
    noMore.value = parsed.items.length === 0 || !parsed.hasMore;
    page.value += 1;
    syncCache();
  } catch (loadError: any) {
    if (currentVersion !== requestVersion) return;
    if (isLoadMore && currentPage > 1 && isSecondHandCursorInvalidError(loadError)) {
      // 加载更多时游标失效：清空列表回到第一页重拉，避免卡在半截。
      resetState();
      cursorResetNeeded = true;
    } else if (silent) {
      // 静默刷新失败时保留旧列表和旧游标，不把错误盖到已有内容上。
      page.value = previousCursor.page;
      firstItem.value = previousCursor.firstItem;
      lastItem.value = previousCursor.lastItem;
      pageContext.value = previousCursor.pageContext;
      noMore.value = previousCursor.noMore;
    } else {
      error.value = loadError?.message || '加载失败，请检查网络';
    }
  } finally {
    if (currentVersion === requestVersion) {
      loading.value = false;
      loadingMore.value = false;
      silentRefreshing.value = false;
    }
  }
  // 忙碌标记已复位，再重新拉第一页。
  if (cursorResetNeeded) void loadPage(false);
}

function reload() {
  resetState();
  void loadPage(false);
}

function handleRouteChange() {
  if (route.path !== '/secondhand/list') return;
  // 换号后缓存属于上一账号：不先渲染旧条目，直接清空缓存重新加载。
  const cached = secondHandListCache.get(listCacheKey.value);
  if (cached?.initialized && (cached.viewerUid || '') !== getSecondHandViewerUid()) {
    reload();
    return;
  }
  // 命中缓存（含过期）先渲染旧列表；新鲜就直接用，否则后台静默刷新。
  if (!restoreCachedState()) {
    reload();
    return;
  }
  if (!isSecondHandListCacheFresh(secondHandListCache.get(listCacheKey.value))) void loadPage(false, { silent: true });
}

function goBack() {
  void router.push('/secondhand');
}

function openEntity(entity: DiscoveryEntity) {
  const routeInfo = resolveDiscoveryRoute(entity);
  if (!routeInfo) return;
  if (routeInfo.kind === 'web') {
    void CoolapkTauriAPI.openUrl(routeInfo.target, 'internal');
    return;
  }
  const localRoute = normalizeCoolapkRoute(routeInfo.target);
  if (localRoute && router.resolve(localRoute).matched.length > 0) {
    void router.push(localRoute);
    return;
  }
  void router.push({ path: '/page', query: { url: routeInfo.target, title: routeInfo.title || String(entity.title || ''), renderer: 'discovery' } });
}

// 滚动只记录位置；缓存同步挂在数据变化（loadPage 成功后）与离开页面时，避免高频滚动反复展开整个列表。
function handleScroll(event: Event) {
  const element = event.currentTarget as HTMLElement;
  scrollTop.value = element.scrollTop;
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 360) void loadPage(true);
}

function persistCacheOnLeave() {
  if (items.value.length > 0) syncCache();
}

watch(() => route.fullPath, () => {
  if (route.path !== '/secondhand/list') {
    persistCacheOnLeave();
    return;
  }
  handleRouteChange();
}, { immediate: true });

onUnmounted(persistCacheOnLeave);

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => loading.value || loadingMore.value || silentRefreshing.value);
async function refreshMobilePage() { resetState(); await loadPage(false); }
</script>

<style scoped>
.page-container { width: 100%; max-width:1120px; height: 100%; overflow-y: auto; padding: 14px 16px; margin: 0 auto; box-sizing: border-box; background:var(--background-secondary); }
.page-header { margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.header-main { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.back-button { display: inline-flex; align-items: center; gap: 8px; border: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 18px; font-weight: 800; cursor: pointer; padding: 0; }
.back-button i { color: var(--brand-primary); font-size: 15px; }
.page-subtitle, .route-hint { color: var(--text-tertiary); font-size: 12px; }
.route-hint { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.route-hint i { color: var(--brand-primary); }
.state-wrapper { padding: 18px 0; }
.feed-list { display: flex; flex-direction: column; gap: 12px; }
.pagination-footer { padding: 16px 0; text-align: center; }
.no-more { color: var(--text-tertiary); font-size: 12px; }
.retry-inline { border: 0; background: transparent; color: var(--brand-primary, #10b981); font-size: 12px; cursor: pointer; }
@media(max-width:720px) { .page-container { padding:12px 8px max(24px,var(--mobile-bottom-overlay-space,0px)); } }
</style>
