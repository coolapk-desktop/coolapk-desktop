<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy }" class="page-container custom-scrollbar">
    <div class="page-header">
      <div class="header-main">
        <h2 class="page-title"><i class="fas fa-store icon"></i> 二手市场</h2>
        <span class="page-subtitle">酷友闲置数码好物流转</span>
      </div>
      <div class="header-actions">
        <button type="button" class="brand-list-button" @click="router.push('/secondhand/brands')"><i class="fas fa-tags"></i> 品牌/型号</button>
        <span class="warn-tip"><i class="fas fa-shield-alt"></i> 线上交易需谨慎，谨防上当受骗</span>
      </div>
    </div>

    <!-- APK 二手首页是服务端实体页面，不能只按普通动态处理。 -->
    <div v-if="loading && dynamicItems.length === 0" class="loading-wrapper">
      <DiscoverySkeleton />
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error && dynamicItems.length === 0" class="error-wrapper">
      <ErrorState title="加载二手市场失败" :message="error" @retry="loadFeeds(true)" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="dynamicItems.length === 0" class="empty-wrapper">
      <EmptyState title="暂无闲置物品" description="暂时没有新的闲置动态，稍后再来看看吧" />
    </div>

    <!-- 闲置实体列表：保留 APK 的分类、型号和动态卡片。 -->
    <div v-else class="feed-list-wrapper">
      <div class="feed-list discovery-page-list">
        <DiscoveryEntityCard v-for="(item, index) in dynamicItems" :key="getEntityKey(item, index)" :entity="item" @open="openEntity" />
      </div>
      <div v-if="loadingMore" class="loading-more-footer">
        <i class="fas fa-circle-notch fa-spin"></i> 正在加载更多闲置...
      </div>
      <div v-else-if="noMore && dynamicItems.length > 5" class="no-more-footer">
        已加载全部闲置物品
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, ref, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import DiscoveryEntityCard from '../components/discovery/DiscoveryEntityCard.vue';
import DiscoverySkeleton from '../components/discovery/DiscoverySkeleton.vue';
import ErrorState from '../components/common/ErrorState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { getEntityKey, parseDiscoveryPage, resolveDiscoveryRoute } from '../utils/discovery';
import { normalizeCoolapkRoute } from '../utils/coolapkRoute';
import { secondHandPageCache as pageCache } from '../utils/secondHandCache';
import type { DiscoveryEntity } from '../types/discovery';

const router = useRouter();
const SECOND_HAND_PAGE_URL = 'V11_FIND_GOOD_GOODS_HOME';
const dynamicItems = ref<DiscoveryEntity[]>(pageCache.initialized ? [...pageCache.items] : []);
const page = ref(pageCache.page);
const loading = ref(false);
const loadingMore = ref(false);
const noMore = ref(pageCache.noMore);
const dynamicFirstItem = ref(pageCache.firstItem);
const dynamicLastItem = ref(pageCache.lastItem);
const dynamicPageContext = ref(pageCache.pageContext);
const error = ref('');

function syncPageCache() {
  pageCache.initialized = true;
  pageCache.items = [...dynamicItems.value];
  pageCache.page = page.value;
  pageCache.firstItem = dynamicFirstItem.value;
  pageCache.lastItem = dynamicLastItem.value;
  pageCache.pageContext = dynamicPageContext.value;
  pageCache.noMore = noMore.value;
}

async function loadFeeds(isRefresh: boolean = false) {
  if (loading.value || loadingMore.value) return;
  if (!isRefresh && noMore.value) return;

  if (isRefresh) {
    page.value = 1;
    noMore.value = false;
    dynamicItems.value = [];
    dynamicFirstItem.value = '';
    dynamicLastItem.value = '';
    dynamicPageContext.value = '';
    loading.value = true;
  } else {
    loadingMore.value = true;
  }
  error.value = '';

  try {
    const response = await CoolapkTauriAPI.getDiscoveryPageData({ url: SECOND_HAND_PAGE_URL, title: '二手市场', page: page.value, firstItem: dynamicFirstItem.value, lastItem: dynamicLastItem.value, pageContext: dynamicPageContext.value || JSON.stringify({ source: 'desktop-secondhand' }) });
    const parsed = parseDiscoveryPage(response, page.value);
    const incoming = parsed.items;
    if (isRefresh) {
      dynamicItems.value = incoming;
    } else {
      const existingKeys = new Set(dynamicItems.value.map((item, index) => getEntityKey(item, index)));
      dynamicItems.value = [...dynamicItems.value, ...incoming.filter((item, index) => !existingKeys.has(getEntityKey(item, dynamicItems.value.length + index)))];
    }
    dynamicFirstItem.value = parsed.firstItem;
    dynamicLastItem.value = parsed.lastItem;
    dynamicPageContext.value = parsed.pageContext || dynamicPageContext.value;
    noMore.value = incoming.length === 0 || !parsed.hasMore;
    page.value++;
    syncPageCache();
  } catch (err: any) {
    error.value = err?.message || '加载失败，请检查网络';
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
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

function onScrollEvent(e: Event) {
  const el = e.target as HTMLElement;
  let scrollDiff = 999;
  if (el && el.scrollHeight) {
    scrollDiff = el.scrollHeight - el.scrollTop - el.clientHeight;
  } else {
    const docEl = document.documentElement;
    scrollDiff = docEl.scrollHeight - window.scrollY - window.innerHeight;
  }

  if (scrollDiff < 260) {
    if (!loading.value && !loadingMore.value && !noMore.value) {
      loadFeeds(false);
    }
  }
}

function bindGlobalListeners() {
  window.addEventListener('scroll', onScrollEvent, true);
}

function unbindGlobalListeners() {
  window.removeEventListener('scroll', onScrollEvent, true);
}

onMounted(() => {
  if (!pageCache.initialized) void loadFeeds(true);
});

onActivated(bindGlobalListeners);
onDeactivated(unbindGlobalListeners);
onUnmounted(unbindGlobalListeners);

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => loading.value || loadingMore.value);
async function refreshMobilePage() { await loadFeeds(true); }
</script>

<style scoped>
.page-container {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: var(--space-5);
  margin: 0 auto;
}

.page-header {
  margin-bottom: var(--space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.header-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.brand-list-button {
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--brand-primary);
  padding: 6px 12px;
  font-size: var(--font-size-caption);
  cursor: pointer;
}

.brand-list-button:hover {
  background: var(--brand-soft);
}

.header-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title {
  font-size: var(--font-size-title-lg);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.page-title .icon {
  color: var(--brand-primary);
}

.page-subtitle {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.warn-tip {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.loading-wrapper,
.error-wrapper,
.empty-wrapper {
  padding: var(--space-10) 0;
}

.loading-more-footer,
.no-more-footer {
  padding: var(--space-4);
  text-align: center;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}
</style>
