<template>
  <div ref="scroller" v-pull-refresh="{ refresh: refreshPage, disabled: loading || categoriesLoading }" class="page-container custom-scrollbar" @scroll="handleScroll">
    <!-- 窄窗口中搜索控件在导航下方，宽屏上与导航并排。 -->
    <div v-if="!developer" class="catalog-toolbar">
      <div class="catalog-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :class="['cat-tab', { active: activeTab === tab.key && !query }]"
          :aria-pressed="activeTab === tab.key && !query"
          @click="selectTab(tab.key)"
        >
          <i :class="tab.icon" aria-hidden="true"></i>
          {{ tab.label }}
        </button>
      </div>

      <div class="search-box">
        <i class="fas fa-search search-icon"></i>
        <input
          v-model="searchQuery"
          type="text"
          enterkeyhint="search"
          :placeholder="searchPlaceholder"
          :aria-label="searchPlaceholder"
          class="search-input"
          @keyup.enter="handleSearch"
        />
        <button v-if="searchQuery" class="clear-btn" type="button" aria-label="清除搜索" @click="clearSearch">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <header v-else class="developer-heading">
      <span class="developer-icon"><i class="far fa-building" aria-hidden="true"></i></span>
      <h2>{{ developer }}</h2>
    </header>

    <template v-if="isCategoryIndex">
      <LoadingState v-if="categoriesLoading" text="正在加载分类..." />
      <ErrorState v-else-if="categoriesError" :message="categoriesError" retryable @retry="loadCategories" />
      <EmptyState v-else-if="!categories.length" title="暂无分类" />
      <div v-else class="category-grid">
        <section v-for="category in categories" :key="category.id" class="category-group">
          <button type="button" class="category-title" @click="openCategory(category)">
            <span class="category-icon">
              <AppImage v-if="category.logo" :src="category.logo" alt="" image-class="category-logo" />
              <i v-else class="fas fa-layer-group" aria-hidden="true"></i>
            </span>
            <span class="category-name">{{ category.title }}</span>
            <i class="fas fa-chevron-right category-arrow" aria-hidden="true"></i>
          </button>
          <div v-if="category.tagList.length" class="category-tags">
            <button v-for="tag in category.tagList" :key="tag" type="button" class="category-tag" @click="openCategory(category, tag)">{{ tag }}</button>
          </div>
        </section>
      </div>
    </template>

    <template v-else>
      <section v-if="query || selectedCategory" class="catalog-refine">
        <div class="catalog-filters">
          <AppOptionMenu v-if="query" v-model="searchCategory" label="搜索分类" icon="fas fa-layer-group" :options="searchCategoryOptions" :highlighted="Boolean(searchCategory)" @change="loadItems()" />
          <button v-if="query && categoriesError" type="button" class="catalog-back" @click="loadCategories"><i class="fas fa-rotate-right" aria-hidden="true"></i> 重试加载分类</button>
          <button v-if="!query && selectedCategory" type="button" class="catalog-back" @click="returnToCategories">
            <i class="fas fa-arrow-left" aria-hidden="true"></i> 全部分类
          </button>
          <AppOptionMenu v-model="sort" label="排序方式" icon="fas fa-arrow-down-wide-short" :options="sortOptions" :highlighted="sort !== 'default'" align-end @change="loadItems()" />
        </div>

        <div v-if="selectedCategory && !query" class="category-tags detail-tags">
          <button type="button" class="category-tag category-all" :aria-pressed="!selectedTag" @click="openCategory(selectedCategory)">{{ selectedCategory.title }}</button>
          <button v-for="tag in selectedCategory.tagList" :key="tag" type="button" class="category-tag" :aria-pressed="selectedTag === tag" @click="openCategory(selectedCategory, tag)">{{ tag }}</button>
        </div>
      </section>

      <!-- 首次加载或刷新时显示整页加载状态，分页时保留列表和滚动位置。 -->
      <div v-if="loading && items.length === 0" class="loading-wrapper">
        <LoadingState :text="loadingText" />
      </div>

      <!-- 加载失败状态（与空态严格区分） -->
      <div v-else-if="error" class="error-wrapper">
        <ErrorState :message="error" retryable @retry="retryInitial" />
      </div>

      <!-- 空数据状态 -->
      <div v-else-if="items.length === 0" class="empty-wrapper">
        <EmptyState
          :title="isGames ? '暂无相关游戏或评测' : '暂无相关应用数据'"
          :description="`可尝试搜索${isGames ? '游戏' : '应用'}名称或切换分类`"
        />
      </div>

      <div v-else :class="isReviews ? 'reviews-feed' : 'catalog-grid'">
        <template v-if="isReviews">
          <div
            v-for="feed in items"
            :key="feed.id || feed.feedId || feed.title"
            class="review-card"
            @click="navigateToFeed(feed)"
          >
            <div class="review-header">
              <AppImage :src="getAvatar(feed)" image-class="user-avatar" alt="头像" />
              <div class="user-info">
                <span class="username">{{ feed.username || feed.userName || '酷友' }}</span>
                <span class="device-tag">{{ feed.deviceTitle || '手机游戏社区' }}</span>
              </div>
            </div>
            <div class="review-body">
              <h4 v-if="feed.title" class="review-title">{{ feed.title }}</h4>
              <p class="review-text">{{ plainReviewText(feed) }}</p>
            </div>
            <div class="review-footer">
              <span class="stat"><i class="far fa-thumbs-up"></i> {{ feed.likenum || 0 }}</span>
              <span class="stat"><i class="far fa-comment"></i> {{ feed.replynum || 0 }}</span>
            </div>
          </div>
        </template>

        <!-- 应用和游戏使用相同的安装包卡片。 -->
        <template v-else>
          <div
            v-for="(app, index) in items"
            :key="app.id || app.packageName || app.title"
            class="app-card"
            :class="{ 'rank-card': isRank }"
            @click="navigateToApp(app)"
          >
            <span v-if="isRank" class="rank-number" :class="{ 'rank-leading': index < 3 }" :aria-label="`第 ${index + 1} 名`">{{ index + 1 }}</span>
            <AppImage :src="getAppIcon(app)" alt="" image-class="app-icon" />
            <div class="app-info">
              <div class="title-row">
                <span class="app-name">{{ app.title || app.shorttitle || (isGames ? '精选游戏' : '推荐应用') }}</span>
                <span v-if="app.version" class="version-tag" :title="app.version">{{ app.version }}</span>
              </div>
              <span v-if="app.subTitle || app.description || app.packageName || app.category" class="app-desc">{{ app.subTitle || app.description || app.packageName || app.category }}</span>

              <div class="app-meta">
                <span v-if="app.score" class="score">
                  <i class="fas fa-star"></i> {{ app.score }}
                </span>
                <span v-if="app.apkSizeFormatted || app.size" class="meta-item">
                  <i class="fas fa-hdd"></i> {{ app.apkSizeFormatted || app.size }}
                </span>
                <span v-if="app.downCountFormatted || app.downnum" class="meta-item">
                  <i class="fas fa-download"></i> {{ app.downCountFormatted || app.downnum }}
                </span>
              </div>
            </div>

            <AppButton variant="secondary" size="sm" icon="fas fa-arrow-right" class="action-btn">
              查看
            </AppButton>
          </div>
        </template>

        <!-- 底部分页状态 -->
        <div class="pagination-footer">
          <LoadingState v-if="loading" :text="`正在加载更多${itemLabel}...`" />
          <button v-else-if="footerError" class="retry-inline" @click="retryLoadMore">加载失败，点击重试</button>
          <div v-else-if="noMore" class="no-more">已加载全部{{ itemLabel }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { vPullRefresh } from '../../directives/pullRefresh';
import { coolapkHtmlToPlainText } from '../../utils/sanitizeHtml';
import { showToast } from '../../utils/toast';
import AppButton from '../common/AppButton.vue';
import AppImage from '../common/AppImage.vue';
import AppOptionMenu from '../common/AppOptionMenu.vue';
import EmptyState from '../common/EmptyState.vue';
import ErrorState from '../common/ErrorState.vue';
import LoadingState from '../common/LoadingState.vue';

interface CatalogItem {
  id?: string | number;
  entityId?: string | number;
  entityType?: string;
  feedId?: string | number;
  title?: string;
  shorttitle?: string;
  subTitle?: string;
  description?: string;
  packageName?: string;
  apkname?: string;
  category?: string;
  version?: string;
  apkversionname?: string;
  score?: string | number;
  apkSizeFormatted?: string;
  apksize?: string;
  size?: string | number;
  downCountFormatted?: string | number;
  downCount?: string | number;
  downnum?: string | number;
  icon?: string;
  apkRomIcon?: string;
  logo?: string;
  pic?: string;
  message?: string;
  userAvatar?: string;
  user_avatar?: string;
  username?: string;
  userName?: string;
  deviceTitle?: string;
  likenum?: string | number;
  replynum?: string | number;
  entities?: CatalogItem[];
}

interface ApkCategory {
  id: string;
  title: string;
  logo?: string;
  tagList: string[];
}

const props = defineProps<{ kind: 'apps' | 'games'; developer?: string }>();
const router = useRouter();

const isGames = props.kind === 'games';
const apkType = isGames ? '2' : '1';
type CatalogTab = 'rank' | 'categories' | 'newest' | 'reviews';
const tabs: { key: CatalogTab; label: string; icon: string }[] = [
  { key: 'rank', label: '排行榜', icon: 'fas fa-ranking-star' },
  { key: 'categories', label: '分类', icon: 'fas fa-layer-group' },
  isGames ? { key: 'reviews', label: '酷友游评', icon: 'far fa-comments' } : { key: 'newest', label: '酷酷新品', icon: 'fas fa-wand-magic-sparkles' },
];
// 与官方应用和游戏搜索的排序菜单对应。
const sortOptions = [
  { key: 'default', label: '默认排序' },
  { key: 'follow', label: '按关注数排序' },
  { key: 'rating', label: '按评分排序' },
  { key: 'comment', label: '按评论数排序' },
  { key: 'download', label: '按下载数排序' },
  { key: 'pubdate', label: '按收录时间排序' },
  { key: 'lastupdate', label: '按更新时间排序' },
];
const activeTab = ref<CatalogTab>('rank');
const scroller = ref<HTMLElement>();
let categoryScrollTop = 0;
const categories = ref<ApkCategory[]>([]);
const searchCategoryOptions = computed(() => [{ key: '', label: '全部分类' }, ...categories.value.map(category => ({ key: category.id, label: category.title }))]);
const categoriesLoading = ref(false);
const categoriesError = ref('');
let categoriesLoaded = false;
const selectedCategory = ref<ApkCategory>();
const selectedTag = ref('');
const searchCategory = ref('');
const sort = ref('default');
const searchQuery = ref('');
// 翻页使用已提交的搜索词，编辑输入框时继续加载当前结果。
const query = ref('');
const isCategoryIndex = computed(() => activeTab.value === 'categories' && !query.value && !selectedCategory.value);
const isReviews = computed(() => activeTab.value === 'reviews' && !query.value);
const isRank = computed(() => !props.developer && activeTab.value === 'rank' && !query.value);
const itemLabel = computed(() => isReviews.value ? '游评' : isGames ? '游戏' : '应用');

const items = ref<CatalogItem[]>([]);
const loading = ref(false);
const error = ref('');
const footerError = ref('');
const noMore = ref(false);
let page = 1;
// 切换分类或搜索时废弃尚未返回的旧请求。
let fetchSequence = 0;

const loadingText = computed(() => {
  if (query.value) return `正在搜索“${query.value}”相关${itemLabel.value}...`;
  if (isReviews.value) return '正在加载酷友游戏体验评测...';
  return `正在加载酷安${itemLabel.value}列表...`;
});

const searchPlaceholder = isGames ? '搜索游戏' : '搜索应用';

function getAppIcon(app: CatalogItem): string {
  return app.icon || app.apkRomIcon || app.logo || app.pic || 'https://c2.coolapk.com/coolmarket/apk/default_avatar.png';
}

function getAvatar(feed: CatalogItem): string {
  return feed.userAvatar || feed.user_avatar || 'https://c2.coolapk.com/coolmarket/apk/default_avatar.png';
}

function plainReviewText(feed: CatalogItem): string {
  return coolapkHtmlToPlainText(feed.message || feed.description || feed.subTitle || '');
}

function requestPage(pageNumber: number) {
  const last = pageNumber > 1 ? items.value[items.value.length - 1] : undefined;
  const lastItem = String(last?.entityId || last?.id || '');
  if (props.developer) return CoolapkTauriAPI.searchApksByDeveloper(props.developer, pageNumber, lastItem);
  if (query.value) {
    return CoolapkTauriAPI.searchByType({ searchType: isGames ? 'game' : 'apk', query: query.value, page: pageNumber, category: searchCategory.value, sort: sort.value, lastItem });
  }
  if (selectedCategory.value) {
    return CoolapkTauriAPI.getApkCategoryItems({ apkType, categoryId: selectedCategory.value.id, tag: selectedTag.value, sort: sort.value, page: pageNumber, lastItem });
  }
  if (isReviews.value) return CoolapkTauriAPI.searchFeeds('游戏评测', pageNumber);
  if (isGames) return CoolapkTauriAPI.getGameList('hot', pageNumber, lastItem);
  return CoolapkTauriAPI.getAppList(activeTab.value === 'newest' ? 'newest' : 'recommend', pageNumber, lastItem);
}

async function loadCategories() {
  if (categoriesLoading.value || categoriesLoaded) return;
  categoriesLoading.value = true;
  categoriesError.value = '';
  try {
    const response = await CoolapkTauriAPI.getApkCategories(apkType);
    const list: { id?: number | string; title?: string; logo?: string; tagList?: unknown }[] = Array.isArray(response?.data) ? response.data : [];
    categories.value = list.flatMap(category => {
      if (!category?.id || !category.title) return [];
      const tags = Array.isArray(category.tagList) ? category.tagList.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '') : [];
      return [{ id: String(category.id), title: category.title, logo: category.logo, tagList: [...new Set(tags)] }];
    });
    categoriesLoaded = true;
  } catch (err: unknown) {
    categoriesError.value = err instanceof Error ? err.message : '加载分类失败';
  } finally {
    categoriesLoading.value = false;
  }
}

async function loadItems(loadMore = false) {
  if (isCategoryIndex.value) return;
  if (loadMore && (loading.value || noMore.value || items.value.length === 0)) return;
  const sequence = ++fetchSequence;
  loading.value = true;
  footerError.value = '';
  if (!loadMore) {
    items.value = [];
    page = 1;
    noMore.value = false;
    error.value = '';
  }

  try {
    const response = await requestPage(page);
    if (sequence !== fetchSequence) return;

    let list: CatalogItem[] = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
    if (query.value) {
      // 搜索接口可能用卡片包装 APK，提取真实应用行作为结果和分页游标。
      list = list.flatMap(row => Array.isArray(row?.entities) ? row.entities : [row])
        .filter(row => row?.entityType === 'apk')
        .map(row => ({ ...row, packageName: row.packageName || row.apkname, version: row.version || row.apkversionname, apkSizeFormatted: row.apkSizeFormatted || row.apksize, downCountFormatted: row.downCountFormatted || row.downCount }));
    }
    const reviews = isReviews.value;
    const filtered = list.filter(item => item && (reviews ? item.message || item.title : item.title || item.packageName));
    if (filtered.length === 0) {
      noMore.value = true;
      return;
    }

    if (loadMore) {
      const keyOf = (item: CatalogItem) => item.id || (reviews ? item.feedId : item.packageName) || item.title;
      const existing = new Set(items.value.map(keyOf));
      const nextItems = filtered.filter(item => !existing.has(keyOf(item)));
      if (!nextItems.length) noMore.value = true;
      items.value.push(...nextItems);
    } else {
      items.value = filtered;
    }
    page += 1;
  } catch (err: unknown) {
    if (sequence !== fetchSequence) return;
    const message = err instanceof Error ? err.message : '网络请求异常，请检查网络后重试';
    if (loadMore) footerError.value = message;
    else error.value = message;
  } finally {
    if (sequence === fetchSequence) loading.value = false;
  }
}

function retryInitial() {
  void loadItems();
}

function retryLoadMore() {
  void loadItems(true);
}

function handleScroll(event: Event) {
  const { scrollTop, clientHeight, scrollHeight } = event.currentTarget as HTMLElement;
  if (!footerError.value && scrollTop + clientHeight >= scrollHeight - 200) {
    void loadItems(true);
  }
}

function selectTab(key: CatalogTab) {
  activeTab.value = key;
  if (query.value) searchQuery.value = '';
  query.value = '';
  selectedCategory.value = undefined;
  selectedTag.value = '';
  sort.value = 'default';
  if (isCategoryIndex.value) {
    // 分类索引独立于 APK 分页，使上一个页面的迟到响应失效。
    fetchSequence += 1;
    loading.value = false;
    void loadCategories();
  } else {
    void loadItems();
  }
}

function openCategory(category: ApkCategory, tag = '') {
  if (isCategoryIndex.value) categoryScrollTop = scroller.value?.scrollTop || 0;
  if (selectedCategory.value?.id !== category.id) sort.value = 'default';
  selectedCategory.value = category;
  selectedTag.value = tag;
  void loadItems();
}

async function returnToCategories() {
  selectTab('categories');
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = categoryScrollTop;
}

function handleSearch() {
  const keyword = searchQuery.value.trim();
  if (!keyword) return;
  if (!query.value) {
    searchCategory.value = '';
    sort.value = 'default';
    void loadCategories();
  }
  query.value = keyword;
  void loadItems();
}

function clearSearch() {
  searchQuery.value = '';
  query.value = '';
  sort.value = 'default';
  if (isCategoryIndex.value) selectTab('categories');
  else void loadItems();
}

async function refreshPage() {
  if (isCategoryIndex.value) {
    categoriesLoaded = false;
    await loadCategories();
  } else {
    await loadItems();
  }
}

function navigateToApp(app: CatalogItem) {
  const packageName = app.packageName || app.id;
  if (packageName) router.push(`/app/${packageName}`);
  else showToast('该条目缺少应用标识，无法打开详情');
}

function navigateToFeed(feed: CatalogItem) {
  if (feed.id) router.push(`/feed/${feed.id}`);
}

onMounted(() => loadItems());
</script>

<style scoped>
.page-container {
  width: 100%;
  max-width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: var(--space-5);
  margin: 0;
}

.catalog-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.catalog-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
}

.cat-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
}

.cat-tab i {
  font-size: 0.9em;
}

.cat-tab:hover,
.catalog-back:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.cat-tab.active {
  background: var(--brand-soft);
  font-weight: var(--font-weight-bold);
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  gap: var(--space-4);
}

.category-group,
.catalog-refine,
.developer-heading {
  min-width: 0;
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
}

.category-group:hover {
  border-color: var(--brand-primary);
}

.category-title {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-bold);
  text-align: start;
  cursor: pointer;
}

.category-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.category-icon,
.developer-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-control);
  background: var(--brand-soft);
  color: var(--brand-primary);
}

.category-logo {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-control);
}

.category-arrow {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  margin-inline-start: auto;
  border-radius: var(--radius-pill);
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}

.category-title:hover .category-arrow {
  background: var(--brand-soft);
  color: var(--brand-primary);
}

.category-tags,
.catalog-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.category-group > .category-tags {
  margin-top: var(--space-3);
}

.catalog-refine {
  padding: var(--space-3);
  margin-bottom: var(--space-4);
}

.detail-tags {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}

.category-tag,
.catalog-back {
  min-height: 32px;
  max-width: 100%;
  padding: var(--space-1) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  overflow-wrap: anywhere;
  cursor: pointer;
}

.category-tag:hover,
.category-tag[aria-pressed="true"] {
  background: var(--brand-soft);
}

.category-tag[aria-pressed="true"] {
  border-color: currentColor;
}

.category-all {
  color: var(--text-primary);
  font-weight: var(--font-weight-bold);
}

.catalog-back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 34px;
  border-color: var(--border);
  background: var(--surface);
}

.cat-tab:focus-visible,
.category-title:focus-visible,
.category-tag:focus-visible,
.catalog-back:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
}

.rank-number {
  flex: 0 0 26px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-control);
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-bold);
  font-variant-numeric: tabular-nums;
}

.rank-leading {
  background: var(--brand-soft);
}

.cat-tab.active,
.category-tag:hover,
.category-tag[aria-pressed="true"],
.rank-leading {
  color: var(--brand-active);
  color: color-mix(in srgb, var(--brand-active) 88%, var(--text-primary));
}

.developer-heading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.developer-heading h2 {
  margin: 0;
  font-size: var(--font-size-title-sm);
  overflow-wrap: anywhere;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: 220px;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-tertiary);
  font-size: 12px;
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 32px;
  padding: 0 28px;
  border-radius: var(--radius-pill, 16px);
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.08));
  background-color: var(--surface-hover);
  color: var(--text-primary);
  font-size: 12.5px;
  outline: none;
  transition: all 0.15s ease;
}

.search-input:focus {
  background-color: var(--surface);
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 2px var(--brand-soft);
}

.clear-btn {
  position: absolute;
  right: 8px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px;
  font-size: 11px;
}

.clear-btn:hover {
  color: var(--text-primary);
}

.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: var(--space-4);
}

.pagination-footer {
  grid-column: 1 / -1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: var(--space-4) 0;
}

.retry-inline {
  border: none;
  background: transparent;
  color: var(--danger, #ef4444);
  cursor: pointer;
  font-size: var(--font-size-sub);
  padding: var(--space-2) var(--space-4);
}

.no-more {
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.app-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  cursor: pointer;
  transition: all var(--duration-fast);
}

.app-card:hover {
  border-color: var(--brand-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transform: translateY(-2px);
}

.app-icon {
  width: 58px;
  height: 58px;
  border-radius: var(--radius-control);
  object-fit: cover;
  flex-shrink: 0;
}

.app-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.app-name {
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.version-tag {
  min-width: 0;
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-tertiary);
  background-color: var(--surface-hover);
  padding: 1px 5px;
  border-radius: var(--radius-xs);
}

.app-desc {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.score {
  color: #f59e0b;
  font-weight: bold;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.action-btn {
  flex-shrink: 0;
}

.reviews-feed {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.review-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  cursor: pointer;
  transition: all var(--duration-fast);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.review-card:hover {
  border-color: var(--brand-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.review-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
}

.user-avatar :deep(img) {
  border-radius: 50%;
  object-fit: cover;
}

.user-info {
  display: flex;
  flex-direction: column;
}

.username {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.device-tag {
  font-size: 11px;
  color: var(--text-tertiary);
}

.review-title {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0 0 4px 0;
}

.review-text {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.review-footer {
  display: flex;
  gap: var(--space-4);
  font-size: 12px;
  color: var(--text-tertiary);
}

.stat {
  display: flex;
  align-items: center;
  gap: 4px;
}

@media (max-width: 720px) {
  .page-container {
    min-width: 0;
    padding: var(--space-3);
  }

  .catalog-toolbar {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .catalog-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .cat-tab {
    padding-inline: var(--space-1);
  }

  .search-box {
    width: 100%;
    min-width: 0;
  }

  .catalog-grid {
    min-width: 0;
    grid-template-columns: minmax(0, 1fr);
  }

  .app-card {
    width: 100%;
    min-width: 0;
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr) auto;
    gap: 10px;
    padding: 12px;
  }

  .rank-card {
    grid-template-columns: 26px 58px minmax(0, 1fr) auto;
  }

  .app-info,
  .title-row {
    min-width: 0;
  }

  .app-meta {
    flex-wrap: wrap;
    gap: 4px 8px;
  }
}
</style>
