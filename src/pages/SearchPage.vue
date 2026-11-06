<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: activeState.loading || activeState.loadingMore }" class="search-page-layout" :class="{ 'is-mobile-search': mobileLayout }">
    <div class="search-main-column">
      <div class="search-toolbar-frame" :class="{ 'is-collapsed': toolbarHidden }" :inert="toolbarHidden || undefined" :aria-hidden="toolbarHidden || undefined">
      <div class="search-toolbar-clip">
      <div class="search-toolbar">
        <div class="search-toolbar-content">
          <div ref="searchAreaRef" class="search-input-area">
            <form class="search-input-wrapper" role="search" @submit.prevent="doSearch(searchQuery)">
              <button v-if="mobileLayout" type="button" class="search-header-button" aria-label="返回" @click="navigateBack(router)"><img :src="backIcon" alt="" /></button>
              <i v-else class="fas fa-search search-input-icon" aria-hidden="true"></i>
              <input ref="searchInputRef" v-model="searchQuery" type="text" class="search-field" enterkeyhint="search" aria-label="搜索关键词" :placeholder="searchPlaceholder" @input="onSearchInput" @keydown.enter="handleSearchEnter" @focus="onInputFocus" @blur="closeSearchDropdowns" />
              <button v-if="searchQuery" type="button" class="clear-btn" :class="{ 'search-header-button': mobileLayout }" aria-label="清空搜索" @mousedown.prevent @click="clearSearch">
                <img v-if="mobileLayout" :src="clearIcon" alt="" /><i v-else class="fas fa-times" aria-hidden="true"></i>
              </button>
              <button v-if="mobileLayout" type="submit" class="search-header-button" aria-label="搜索" :disabled="!searchQuery.trim()"><img :src="searchIcon" alt="" /></button>
            </form>
            <div v-if="showHistory && !searchQuery.trim() && searchHistory.length" class="search-history-dropdown">
              <div class="search-history-header"><span>最近搜索</span><button type="button" @mousedown.prevent="clearHistory">清空</button></div>
              <button v-for="item in searchHistory" :key="item" type="button" class="search-history-item" @mousedown.prevent="selectHistory(item)">
                <i class="far fa-clock"></i><span>{{ item }}</span><i class="fas fa-times remove-history" @mousedown.stop.prevent="removeHistory(item)"></i>
              </button>
            </div>
            <div v-if="searchSuggestions.length && showSuggestions" class="suggestions-dropdown custom-scrollbar">
              <button v-for="(item, index) in searchSuggestions" :key="`${getSearchEntityTitle(item)}-${index}`" type="button" class="suggestion-item" @mousedown.prevent="selectSuggestion(item)">
                <i class="fas fa-search suggestion-icon"></i><span class="suggestion-text">{{ getSearchEntityTitle(item) }}</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="queryStr && !isScopedSearch" class="search-tabs custom-scrollbar">
          <button v-for="tab in searchTabs" :key="tab.key" type="button" :class="['search-tab-item', { active: activeTab === tab.key }]" @click="switchTab(tab.key)">
            <i v-if="tab.icon" :class="tab.icon"></i><span>{{ tab.label }}</span>
          </button>
        </div>

        <!-- 综合与动态共用官方动态排序，综合选择排序后查询动态结果。 -->
        <EntityFilterBar v-if="queryStr && (activeTab === 'all' || activeTab === 'feed')" class="search-feed-sort" v-model:sort="feedSearchSort" :sort-options="FEED_SEARCH_SORT_OPTIONS" :show-search="false" @change="switchFeedSearchSort" />

        <div v-if="queryStr && !isScopedSearch && isAskTab" class="search-ask-filter" role="tablist" aria-label="问答类型">
          <button
            v-for="option in askFeedTypeOptions"
            :key="option.key"
            type="button"
            role="tab"
            :class="['search-ask-filter-item', { active: askFeedType === option.key }]"
            :aria-selected="askFeedType === option.key"
            @click="switchAskFeedType(option.key)"
          >
            <i :class="option.icon" aria-hidden="true"></i>
            <span>{{ option.label }}</span>
          </button>
        </div>
      </div>
      </div>
      </div>

      <div class="search-scroll-container custom-scrollbar" :data-reading-scroll="queryStr ? '' : undefined" @scroll="handleScroll">
        <template v-if="queryStr">
          <section class="search-results-section">
            <div v-if="activeState.loading && !activeState.items.length" class="loading-wrapper"><LoadingState text="正在搜索..." /></div>
            <div v-else-if="activeState.error && !activeState.items.length" class="empty-wrapper"><EmptyState title="搜索失败" :description="activeState.error" /><button type="button" class="retry-button" @click="fetchTab(activeTab)">重试</button></div>
            <div v-else-if="!activeState.items.length" class="empty-wrapper"><EmptyState title="未搜索到相关结果" description="请尝试输入其他关键字重新搜索" /></div>
            <div v-else class="search-result-list">
              <!-- 综合页的用户名命中结果单独成组，可一键收起，避免干扰后面的相关帖子。 -->
              <section v-if="resultGroups.showUsers" class="search-user-group">
                <button type="button" class="search-user-group-toggle" :aria-expanded="!usersCollapsed" :title="usersCollapsed ? '展开相关用户' : '收起相关用户'" @click="toggleUserGroup">
                  <i class="fas fa-user-group search-user-group-icon" aria-hidden="true"></i>
                  <span class="search-user-group-label">相关用户</span>
                  <span class="search-user-group-count">{{ resultGroups.users.length }}</span>
                  <span class="search-user-group-action"><i :class="usersCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up'" aria-hidden="true"></i>{{ usersCollapsed ? '展开' : '收起' }}</span>
                </button>
                <div v-if="!usersCollapsed" class="search-user-group-list">
                  <SearchResultItem v-for="row in resultGroups.users" :key="entityKey(row.entity, row.index)" :entity="row.entity" :highlight-keyword="queryStr" :show-follow="false" :followed="isUserFollowed(row.entity)" @deleted="removeEntity" @search="doSearch" @toggle-follow="toggleFollow" />
                </div>
              </section>
              <SearchResultItem v-for="row in resultGroups.others" :key="entityKey(row.entity, row.index)" :entity="row.entity" :highlight-keyword="queryStr" :show-follow="activeTab === 'user' || activeTab === 'users'" :followed="isUserFollowed(row.entity)" @deleted="removeEntity" @search="doSearch" @toggle-follow="toggleFollow" />
              <div class="pagination-footer">
                <LoadingState v-if="activeState.loadingMore" text="加载更多中..." />
                <div v-else-if="activeState.cursor.noMore" class="no-more">没有更多结果了</div>
              </div>
            </div>
          </section>
        </template>

        <section v-else class="search-welcome">
          <p class="search-welcome-hint">{{ searchWelcomeHint }}</p>
          <template v-if="!isScopedSearch">
            <SearchHotListCard v-for="(item, index) in hotItems" :key="entityKey(item, index)" :entity="item" @search="doSearch" />
            <EmptyState v-if="!hotItems.length" title="开始搜索" description="热门搜索由酷安接口动态提供" />
          </template>
          <EmptyState v-else :title="scopedUserUid ? '搜索TA的动态' : '搜索话题帖子'" :description="searchWelcomeHint" />
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, getCurrentInstance, inject, onMounted, onUnmounted, onActivated, onDeactivated, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import EmptyState from '../components/common/EmptyState.vue';
import EntityFilterBar from '../components/common/EntityFilterBar.vue';
import LoadingState from '../components/common/LoadingState.vue';
import SearchHotListCard from '../components/search/SearchHotListCard.vue';
import SearchResultItem from '../components/search/SearchResultItem.vue';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { orderSearchTabs } from '../utils/searchTabOrder';
import type { SearchEntity, SearchTabDefinition, SearchTabState } from '../types/search';
import { DEFAULT_SEARCH_TABS } from '../types/search';
import { addSearchHistory, clearSearchHistory, loadSearchHistory, removeSearchHistory, searchHistory } from '../utils/searchHistory';
import { extractSearchEntities, extractSearchTabs, getSearchEntityId, getSearchEntityKind, getSearchEntitySearchTarget, getSearchEntityTitle, getSearchEntityUid, isSponsorSearchEntity, normalizeSearchEntityForTab } from '../utils/searchEntities';
import { fetchSearchSuggestions } from '../utils/searchSuggestions';
import { readSearchUsersCollapsed, writeSearchUsersCollapsed } from '../utils/searchUserGroup';
import { FEED_SEARCH_SORT_OPTIONS, resolveFeedSearchSort } from '../utils/coolapkFeedSearch';
import { useMobileLayout } from '../composables/useOfficialMobileFeedDetail';
import { mobileReadingNavigationKey } from '../composables/useMobileReadingNavigation';
import { navigateBack } from '../utils/navigation';
import backIcon from '../assets/icons/search/ic_back_gray_24dp.png';
import clearIcon from '../assets/icons/search/ic_clear_gray_24dp.png';
import searchIcon from '../assets/icons/search/ic_magnify_white_24dp.png';

const route = useRoute();
// App 按完整地址缓存搜索页；带路由键的旧实例不能响应另一组搜索条件。
const instanceKey = getCurrentInstance()?.vnode.key;
const cachedSearchPath = instanceKey === route.fullPath || String(instanceKey).startsWith(`${route.fullPath}:`) ? route.fullPath : '';
const router = useRouter();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const mobileLayout = useMobileLayout();
const readingNavigation = inject(mobileReadingNavigationKey, undefined);

function readQueryString(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '').trim() : String(value ?? '').trim();
}

const initialPageType = readQueryString(route.query.pageType);
const initialPageParam = readQueryString(route.query.pageParam);
const initialScopedSearch = ['tag', 'user'].includes(initialPageType) && initialPageParam;
const queryStr = ref(readQueryString(route.query.q));
const toolbarHidden = computed(() => Boolean(mobileLayout.value && queryStr.value && readingNavigation?.hidden.value));
const searchQuery = ref(queryStr.value);
const configuredSearchTabs = ref<SearchTabDefinition[]>(DEFAULT_SEARCH_TABS);
// 配置只改变展示顺序；当前分类、结果缓存和范围搜索继续使用原来的键。
const searchTabs = computed(() => isScopedSearch.value ? configuredSearchTabs.value : orderSearchTabs(configuredSearchTabs.value, settingsStore.settings.searchTabOrder));
const activeTab = ref(initialScopedSearch ? 'feed' : readQueryString(route.query.tab) || 'all');
const askFeedTypeOptions = [
  { key: 'all', label: '全部', icon: 'fas fa-layer-group' },
  { key: 'question', label: '提问', icon: 'fas fa-circle-question' },
  { key: 'answer', label: '回答', icon: 'fas fa-comment-dots' },
];
const askFeedType = ref(normalizeAskFeedType(readQueryString(route.query.feedType)));
const feedSearchSort = ref(normalizeFeedSearchSort(readQueryString(route.query.sort)));
const hotItems = ref<SearchEntity[]>([]);
// 搜索栏目名称来自外部配置，Map 可避免 __proto__ 等特殊键改变对象原型。
const tabStates = reactive(new Map<string, SearchTabState>());
const showSuggestions = ref(false);
const showHistory = ref(false);
const searchSuggestions = ref<SearchEntity[]>([]);
const searchAreaRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
let suggestTimer: ReturnType<typeof setTimeout> | null = null;
let suggestionSequence = 0;
let searchSequence = 0;
let configLoaded = false;

const scopedTopicTag = computed(() => {
  return readQueryString(route.query.pageType) === 'tag' ? readQueryString(route.query.pageParam) : '';
});

const scopedUserUid = computed(() => readQueryString(route.query.pageType) === 'user' ? readQueryString(route.query.pageParam) : '');
const isScopedSearch = computed(() => Boolean(scopedTopicTag.value || scopedUserUid.value));
const scopedPageType = computed(() => scopedUserUid.value ? 'user' : 'tag');
const scopedPageParam = computed(() => scopedUserUid.value || scopedTopicTag.value);

const searchPlaceholder = computed(() => {
  if (scopedUserUid.value) return '搜索TA的动态';
  return isScopedSearch.value
    ? (scopedTopicTag.value ? `搜索“${scopedTopicTag.value}”话题的内容` : '搜索此话题的内容')
    : '搜索应用、动态、用户、话题...';
});

const searchWelcomeHint = computed(() => {
  if (scopedUserUid.value) return '输入关键词，搜索TA发布的动态';
  return isScopedSearch.value
    ? `输入关键词，搜索“${scopedTopicTag.value}”吧里的帖子`
    : '输入关键词，搜索酷安的应用、游戏、动态、用户和话题';
});

function newTabState(): SearchTabState {
  return { items: [], loading: false, loadingMore: false, error: '', cursor: { page: 1, firstItem: '', lastItem: '', noMore: false }, requestVersion: 0 };
}

function ensureTabState(key: string): SearchTabState {
  if (!tabStates.has(key)) tabStates.set(key, newTabState());
  return tabStates.get(key)!;
}

const activeState = computed(() => ensureTabState(activeTab.value));

const isAskTab = computed(() => {
  const tab = searchTabs.value.find((item) => item.key === activeTab.value);
  return tab?.searchType === 'ask' || activeTab.value === 'ask';
});

function normalizeFeedSearchSort(value: string): string {
  return FEED_SEARCH_SORT_OPTIONS.some((option) => option.key === value) ? value : 'default';
}

function switchFeedSearchSort() {
  // 排序只更新筛选条件，保留用户当前选择的搜索页签，并带上输入框里尚未提交的关键词。
  const nextQuery = pendingSearchValue();
  const query: Record<string, string> = { ...(route.query as Record<string, string>), q: nextQuery, tab: activeTab.value };
  if (activeTab.value === 'all' && feedSearchSort.value === 'default') delete query.sort;
  else query.sort = feedSearchSort.value;
  if (nextQuery && nextQuery !== queryStr.value) addSearchHistory(nextQuery);
  void router.push({ path: '/search', query });
}

function normalizeAskFeedType(value: string): string {
  return ['all', 'question', 'answer'].includes(value.toLowerCase()) ? value.toLowerCase() : 'all';
}

function switchAskFeedType(value: string) {
  if (!isAskTab.value) return;
  const nextFeedType = normalizeAskFeedType(value);
  if (askFeedType.value === nextFeedType && readQueryString(route.query.feedType) === nextFeedType) return;
  askFeedType.value = nextFeedType;
  void router.push({
    path: '/search',
    query: { q: queryStr.value, tab: activeTab.value, feedType: nextFeedType },
  });
}

function entityKey(entity: SearchEntity, index: number): string {
  return `${getSearchEntityId(entity) || getSearchEntityTitle(entity) || 'entity'}-${index}`;
}

// 不同类型可能复用同一 ID，用户结果也可能只提供 UID。
function entityIdentity(entity: SearchEntity): string {
  const kind = getSearchEntityKind(entity);
  const id = (kind === 'user' ? getSearchEntityUid(entity) : '') || getSearchEntityId(entity);
  const title = getSearchEntityTitle(entity);
  return id ? JSON.stringify([kind, 'id', id]) : title ? JSON.stringify([kind, 'title', title]) : '';
}

const usersCollapsed = ref(readSearchUsersCollapsed());

// 综合页才把用户名命中的用户单独成组；其他页签和范围搜索保持服务端顺序。
const resultGroups = computed(() => {
  const rows = activeState.value.items.map((entity, index) => ({ entity, index }));
  const tab = searchTabs.value.find((item) => item.key === activeTab.value);
  if (isScopedSearch.value || tab?.searchType !== 'all') return { users: [], others: rows, showUsers: false };
  const users = rows.filter((row) => getSearchEntityKind(row.entity) === 'user');
  if (!users.length) return { users: [], others: rows, showUsers: false };
  return { users, others: rows.filter((row) => getSearchEntityKind(row.entity) !== 'user'), showUsers: true };
});

function toggleUserGroup() {
  usersCollapsed.value = !usersCollapsed.value;
  writeSearchUsersCollapsed(usersCollapsed.value);
  // 收起后若首屏只有用户，滚动区域会失去滚动空间，需主动补一页后续结果。
  if (usersCollapsed.value && !resultGroups.value.others.length) void fetchTab(activeTab.value, true);
}

function resetTabStates() {
  tabStates.clear();
  searchTabs.value.forEach((tab) => ensureTabState(tab.key));
}

function syncActiveTab(requested: string) {
  if (isScopedSearch.value) {
    activeTab.value = 'feed';
    return;
  }
  activeTab.value = searchTabs.value.some((tab) => tab.key === requested) ? requested : (searchTabs.value[0]?.key || 'all');
}

async function loadSearchConfig() {
  if (isScopedSearch.value) {
    configuredSearchTabs.value = DEFAULT_SEARCH_TABS.filter((tab) => tab.searchType === 'feed');
    configLoaded = true;
    activeTab.value = 'feed';
    resetTabStates();
    if (queryStr.value) void fetchTab('feed');
    return;
  }
  try {
    const response = await CoolapkTauriAPI.getTabConfig();
    configuredSearchTabs.value = extractSearchTabs(response);
  } catch (error) {
    console.warn('加载搜索页签配置失败，使用协议默认页签', error);
    configuredSearchTabs.value = DEFAULT_SEARCH_TABS;
  } finally {
    configLoaded = true;
    syncActiveTab(String(route.query.tab || activeTab.value || 'all'));
    resetTabStates();
    if (queryStr.value) void fetchTab(activeTab.value);
  }
}

async function loadHotItems() {
  if (isScopedSearch.value) return;
  try {
    const response = await CoolapkTauriAPI.getHotSearches(false);
    hotItems.value = extractSearchEntities(response).filter((item) => !isSponsorSearchEntity(item)).filter((item) => item.entities?.length || getSearchEntityTitle(item));
  } catch (error) {
    console.warn('加载热门搜索失败', error);
  }
}

function responseFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function fetchTab(tabKey: string, loadMore = false) {
  if (!queryStr.value) return;
  const scoped = isScopedSearch.value;
  const tab = scoped
    ? DEFAULT_SEARCH_TABS.find((item) => item.searchType === 'feed')
    : searchTabs.value.find((item) => item.key === tabKey) || DEFAULT_SEARCH_TABS.find((item) => item.key === tabKey);
  if (!tab) return;
  const state = ensureTabState(tab.key);
  if (loadMore && (state.loading || state.loadingMore || state.cursor.noMore)) return;
  if (!loadMore && state.loading) return;
  const requestVersion = ++state.requestVersion;
  const sequence = ++searchSequence;
  if (loadMore) state.loadingMore = true;
  else { state.loading = true; state.error = ''; }
  try {
    let requestedPage = loadMore ? state.cursor.page : 1;
    // 综合页的动态排序使用 feed 接口，结果仍保存在综合页，不改变页签。
    // “综合”排序等价于服务端实体搜索；只有选择实时/热度/评论/精确时才改用动态接口。
    const routeSort = readQueryString(route.query.sort);
    const searchType = tab.searchType === 'all' && routeSort && routeSort !== 'default' ? 'feed' : tab.searchType;
    const requestPage = () => CoolapkTauriAPI.searchByType({
      searchType,
      query: queryStr.value,
      page: requestedPage,
      firstItem: loadMore ? state.cursor.firstItem : '',
      lastItem: loadMore ? state.cursor.lastItem : '',
      pageType: scoped ? scopedPageType.value : searchType === 'feed' ? 'search' : '',
      pageParam: scoped ? scopedPageParam.value : '',
      feedType: searchType === 'ask' ? askFeedType.value : searchType === 'feed' ? 'all' : '',
      sort: searchType === 'feed' ? resolveFeedSearchSort(feedSearchSort.value).sort : '',
      isStrict: searchType === 'feed' ? resolveFeedSearchSort(feedSearchSort.value).isStrict : 0,
    });
    let response: any = await requestPage();
    if (requestVersion !== state.requestVersion || sequence !== searchSequence) return;
    const extractRows = (result: unknown) => extractSearchEntities(result)
      .map((item) => normalizeSearchEntityForTab(item, tab.searchType))
      .filter((item) => !isSponsorSearchEntity(item));
    let rows = extractRows(response);
    // 官方 APK 首屏没有结果时仍会请求第二页，避免服务端空首页截断搜索结果。
    if (requestedPage === 1 && rows.length === 0) {
      requestedPage = 2;
      response = await requestPage();
      if (requestVersion !== state.requestVersion || sequence !== searchSequence) return;
      rows = extractRows(response);
    }
    // 翻页追加时才与旧列表去重，刷新首页时应以新结果替换旧列表。
    const existing = new Set(loadMore ? state.items.map(entityIdentity) : []);
    const uniqueRows = rows.filter((item) => {
      const key = entityIdentity(item);
      if (key && existing.has(key)) return false;
      if (key) existing.add(key);
      return true;
    });
    if (loadMore) state.items.push(...uniqueRows);
    else state.items = uniqueRows;
    const first = uniqueRows[0] ? getSearchEntityId(uniqueRows[0]) : '';
    const last = uniqueRows[uniqueRows.length - 1] ? getSearchEntityId(uniqueRows[uniqueRows.length - 1]) : '';
    const responseFirst = String(response?.firstItem ?? response?.first_item ?? response?.data?.firstItem ?? response?.data?.first_item ?? '').trim();
    const responseLast = String(response?.lastItem ?? response?.last_item ?? response?.data?.lastItem ?? response?.data?.last_item ?? '').trim();
    state.cursor = {
      page: requestedPage + 1,
      firstItem: responseFirst || first || state.cursor.firstItem,
      lastItem: responseLast || last || state.cursor.lastItem,
      noMore: responseFlag(response?.noMore ?? response?.data?.noMore) || rows.length === 0,
    };
    // 用户组收起且当前只有用户结果时继续翻页，避免整屏空白且无法触发滚动加载。
    if (tab.searchType === 'all' && !isScopedSearch.value && usersCollapsed.value && !state.cursor.noMore && state.items.every((item) => getSearchEntityKind(item) === 'user')) {
      const nextTabKey = tab.key;
      queueMicrotask(() => void fetchTab(nextTabKey, true));
    }
  } catch (error) {
    if (requestVersion === state.requestVersion) state.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (requestVersion === state.requestVersion) { state.loading = false; state.loadingMore = false; }
  }
}

function onInputFocus() {
  showHistory.value = !searchQuery.value.trim();
  showSuggestions.value = !isScopedSearch.value && searchSuggestions.value.length > 0;
}

function handleClickOutside(event: MouseEvent) {
  if (searchAreaRef.value && !searchAreaRef.value.contains(event.target as Node)) closeSearchDropdowns();
}

// 关闭时同时作废防抖任务和在途请求，避免旧响应再次打开弹层。
function closeSearchDropdowns() {
  if (suggestTimer) clearTimeout(suggestTimer);
  suggestTimer = null;
  suggestionSequence += 1;
  searchSuggestions.value = [];
  showSuggestions.value = false;
  showHistory.value = false;
}

function clearSearch() {
  searchQuery.value = '';
  closeSearchDropdowns();
  if (mobileLayout.value) {
    searchInputRef.value?.focus();
    showHistory.value = true;
  }
}

function handleSearchEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  doSearch(searchQuery.value);
}

function selectHistory(value: string) {
  searchQuery.value = value;
  showHistory.value = false;
  doSearch(value);
}

function removeHistory(value: string) { removeSearchHistory(value); }
function clearHistory() { clearSearchHistory(); showHistory.value = false; }

function selectSuggestion(item: SearchEntity) {
  const searchTarget = getSearchEntitySearchTarget(item);
  if (searchTarget) {
    doSearch(searchTarget.keyword, searchTarget.searchType);
    return;
  }
  const title = getSearchEntityTitle(item);
  if (title) doSearch(title);
}

function doSearch(value: string, requestedSearchType = '') {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (mobileLayout.value) searchInputRef.value?.blur();
  closeSearchDropdowns();
  addSearchHistory(trimmed);
  const query: Record<string, string> = { q: trimmed };
  if (isScopedSearch.value) {
    query.tab = 'feed';
    query.pageType = scopedPageType.value;
    query.pageParam = scopedPageParam.value;
  } else {
    const requestedTab = searchTabs.value.find((tab) => tab.key === requestedSearchType || tab.searchType === requestedSearchType);
    const targetTab = requestedTab?.key || (requestedSearchType && DEFAULT_SEARCH_TABS.some((tab) => tab.key === requestedSearchType) ? requestedSearchType : activeTab.value);
    query.tab = targetTab;
    const targetDefinition = searchTabs.value.find((tab) => tab.key === targetTab);
    if (targetDefinition?.searchType === 'ask' || targetTab === 'ask') query.feedType = askFeedType.value;
  }
  if (query.tab === 'feed' || (query.tab === 'all' && feedSearchSort.value !== 'default')) query.sort = feedSearchSort.value;
  void router.push({ path: '/search', query });
}

function switchTab(key: string) {
  if (isScopedSearch.value) return;
  if (activeTab.value === key) return;
  const nextQuery = pendingSearchValue();
  activeTab.value = key;
  const targetTab = searchTabs.value.find((tab) => tab.key === key);
  const query: Record<string, string> = { q: nextQuery, tab: key };
  if (targetTab?.searchType === 'ask' || key === 'ask') query.feedType = askFeedType.value;
  if (key === 'feed' || (key === 'all' && feedSearchSort.value !== 'default')) query.sort = feedSearchSort.value;
  if (nextQuery && nextQuery !== queryStr.value) addSearchHistory(nextQuery);
  void router.push({ path: '/search', query });
}

// 页签、排序等切换动作应保留输入框里已经输入但尚未回车提交的关键词。
function pendingSearchValue(): string {
  return searchQuery.value.trim() || queryStr.value;
}

function removeEntity(id: string | number) {
  const state = ensureTabState(activeTab.value);
  state.items = state.items.filter((item) => String(getSearchEntityId(item)) !== String(id));
}

function isUserFollowed(user: SearchEntity): boolean {
  const value = user.follow ?? user.following;
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function toggleFollow(user: SearchEntity) {
  const uid = String(user.uid ?? user.userId ?? user.user_id ?? '');
  if (!uid) return;
  if (!authStore.isLoggedIn) { authStore.openLoginModal(); return; }
  const followed = isUserFollowed(user);
  try {
    if (followed) await CoolapkTauriAPI.unfollowUser(uid);
    else await CoolapkTauriAPI.followUser(uid);
    user.follow = !followed;
    user.following = !followed;
  } catch (error) {
    console.error('关注操作失败', error);
  }
}

function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 120) void fetchTab(activeTab.value, true);
}

async function fetchSuggestions(value: string, sequence: number) {
  if (isScopedSearch.value) return;
  const trimmed = value.trim();
  if (!trimmed) { searchSuggestions.value = []; return; }
  const rows = await fetchSearchSuggestions(trimmed);
  if (sequence !== suggestionSequence) return;
  searchSuggestions.value = rows;
  showSuggestions.value = rows.length > 0;
}

// 仅用户编辑触发联想，路由返回时恢复关键词不应遮挡已有结果。
function onSearchInput() {
  closeSearchDropdowns();
  const value = searchQuery.value;
  showHistory.value = !value.trim();
  if (isScopedSearch.value || !value.trim()) { searchSuggestions.value = []; showSuggestions.value = false; return; }
  const sequence = suggestionSequence;
  suggestTimer = setTimeout(() => void fetchSuggestions(value, sequence), 300);
}

let appliedSearchKey = '';
let appliedSearchContextKey = '';
let searchPageActive = true;
watch(() => [
  route.path,
  readQueryString(route.query.q),
  readQueryString(route.query.tab),
  readQueryString(route.query.pageType),
  readQueryString(route.query.pageParam),
  readQueryString(route.query.feedType),
  readQueryString(route.query.sort),
], ([path, nextQuery, nextTab, , , nextFeedType, nextSort]) => {
  // 缓存页仍能收到全局路由变化；离开搜索及返回相同条件时不能清空结果和分页。
  if (path !== '/search' || !searchPageActive || (cachedSearchPath && cachedSearchPath !== route.fullPath)) return;
  // 查询条件与页签分开记录：只切页签时保留各页签已加载的结果和分页，不重新请求。
  const contextKey = JSON.stringify([nextQuery, readQueryString(route.query.pageType), readQueryString(route.query.pageParam), nextFeedType, nextSort]);
  const routeKey = JSON.stringify([contextKey, nextTab]);
  if (routeKey === appliedSearchKey) return;
  const contextChanged = contextKey !== appliedSearchContextKey;
  appliedSearchKey = routeKey;
  appliedSearchContextKey = contextKey;
  const normalizedQuery = nextQuery;
  queryStr.value = normalizedQuery;
  searchQuery.value = normalizedQuery;
  askFeedType.value = normalizeAskFeedType(nextFeedType);
  feedSearchSort.value = normalizeFeedSearchSort(nextSort);
  if (isScopedSearch.value) {
    activeTab.value = 'feed';
  } else if (configLoaded) {
    syncActiveTab(nextTab || activeTab.value || 'all');
  }
  if (contextChanged) searchSequence += 1;
  closeSearchDropdowns();
  if (contextChanged) resetTabStates();
  // 等页签配置就绪再发起首次搜索，避免初始化重置使空首页补查失效；
  // 仅切换页签时只在目标页签还没有数据时补拉。
  if (normalizedQuery && configLoaded && (contextChanged || !ensureTabState(activeTab.value).items.length)) void fetchTab(activeTab.value);
}, { immediate: true });

function bindGlobalListeners() {
  document.addEventListener('click', handleClickOutside);
}

function unbindGlobalListeners() {
  document.removeEventListener('click', handleClickOutside);
}

onMounted(() => {
  void loadSearchHistory();
  void loadHotItems();
  void loadSearchConfig();
});

onActivated(() => { searchPageActive = true; bindGlobalListeners(); });
onDeactivated(() => { searchPageActive = false; closeSearchDropdowns(); unbindGlobalListeners(); });
onUnmounted(() => {
  closeSearchDropdowns();
  unbindGlobalListeners();
});

// 下拉仅刷新当前栏目，不切换筛选、路由或页面实例。
async function refreshMobilePage() { if (queryStr.value) await fetchTab(activeTab.value, false); else await loadHotItems(); }
</script>

<style scoped>
.search-page-layout { container-type: inline-size; container-name: search-layout; display: flex; width: 100%; height: 100%; overflow: hidden; }
.search-main-column { display: flex; flex: 1; flex-direction: column; min-width: 0; height: 100%; overflow: hidden; background: var(--surface); }
.search-toolbar-frame { position: relative; z-index: 2; display: grid; grid-template-rows: 1fr; flex: 0 0 auto; }
.search-toolbar-clip { min-height: 0; }
.search-toolbar { position: relative; z-index: 2; flex: 0 0 auto; background: var(--surface); border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, .06)); }
.search-toolbar-content { padding: 14px 20px 12px; }
.search-input-area { position: relative; margin: 0; }
.search-input-wrapper { display: flex; align-items: center; gap: 12px; height: 46px; box-sizing: border-box; padding: 0 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; transition: border-color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default); }
.search-input-wrapper:focus-within { border-color: var(--brand-primary); box-shadow: 0 0 0 3px var(--brand-soft); }
.search-input-icon { color: var(--text-secondary); font-size: 15px; }
.search-field { flex: 1; min-width: 0; color: var(--text-primary); font-size: var(--font-size-sub); outline: none; }
.search-field::placeholder { color: var(--text-tertiary); }
.clear-btn { display: grid; place-items: center; width: 26px; height: 26px; color: var(--text-tertiary); background: transparent; border: 0; border-radius: 50%; cursor: pointer; }
.clear-btn:hover { color: var(--text-primary); background: var(--surface-hover); }
.search-header-button { display: grid; place-items: center; flex: 0 0 36px; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
.search-header-button img { width: 20px; height: 20px; object-fit: contain; filter: brightness(0) invert(.35); }
:global([data-theme="dark"]) .search-header-button img { filter: brightness(0) invert(.75); }
.search-header-button:hover:not(:disabled) { background: var(--surface-hover); }
.search-header-button:disabled { opacity: .55; cursor: default; }
.suggestions-dropdown, .search-history-dropdown { position: absolute; top: calc(100% + 4px); right: 0; left: 0; z-index: 20; max-height: 260px; padding: 6px; overflow-y: auto; background: var(--surface-elevated); border: 1px solid var(--border); border-radius: var(--radius-control); box-shadow: var(--shadow-dialog); }
.suggestion-item, .search-history-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px; color: var(--text-secondary); text-align: left; background: transparent; border: 0; border-radius: var(--radius-xs); cursor: pointer; }
.suggestion-item:hover, .search-history-item:hover { color: var(--text-primary); background: var(--surface-hover); }
.suggestion-text, .search-history-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suggestion-icon, .search-history-item > .far { color: var(--text-tertiary); }
.search-history-header { display: flex; justify-content: space-between; padding: 5px 9px 8px; color: var(--text-tertiary); font-size: var(--font-size-caption); }
.search-history-header button { color: var(--brand-primary); background: transparent; border: 0; cursor: pointer; }
.remove-history { padding: 3px; color: var(--text-tertiary); }
.remove-history:hover { color: var(--danger); }
.search-tabs { display: flex; gap: clamp(8px, 2vw, 24px); min-width: 0; padding: 0 20px; overflow-x: auto; scrollbar-width: none; }
.search-tabs::-webkit-scrollbar { display: none; }
.search-feed-sort { margin: 0; padding: 8px 20px; }
.search-tab-item { display: inline-flex; align-items: center; gap: 7px; position: relative; flex: 0 0 auto; min-height: 44px; padding: 0 8px; color: var(--text-secondary); font-size: var(--font-size-sub); font-weight: var(--font-weight-medium); white-space: nowrap; background: transparent; border: 0; cursor: pointer; }
.search-tab-item.active { color: var(--brand-primary); font-weight: var(--font-weight-bold); }
.search-tab-item.active::after { position: absolute; right: 8px; bottom: 0; left: 8px; height: 3px; content: ''; background: var(--brand-primary); border-radius: 3px 3px 0 0; }
.search-ask-filter { display: flex; gap: 8px; padding: 8px 20px 10px; overflow-x: auto; background: var(--surface); border-top: 1px solid var(--border-light, rgba(0, 0, 0, .06)); scrollbar-width: none; }
.search-ask-filter::-webkit-scrollbar { display: none; }
.search-ask-filter-item { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 12px; color: var(--text-secondary); font-size: var(--font-size-caption); white-space: nowrap; background: transparent; border: 0; border-radius: 999px; cursor: pointer; }
.search-ask-filter-item.active { color: var(--brand-primary); font-weight: var(--font-weight-bold); background: var(--brand-soft); }
.search-scroll-container { flex: 1; min-height: 0; overflow-y: auto; background: var(--background-secondary); }
.search-results-section, .search-welcome { width: 100%; box-sizing: border-box; padding: 16px 20px 28px; }
.search-result-list { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.loading-wrapper, .empty-wrapper { padding: var(--space-6) 0; text-align: center; }
.retry-button { margin-top: 10px; padding: 6px 14px; color: var(--brand-primary); background: var(--brand-soft); border: 0; border-radius: var(--radius-control); cursor: pointer; }
.search-user-group { display: flex; flex-direction: column; gap: 12px; }
.search-user-group-toggle { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; box-sizing: border-box; padding: 0 14px; color: var(--text-secondary); font-size: var(--font-size-sub); font-weight: var(--font-weight-semibold); text-align: left; background: var(--surface); border: 1px solid var(--border-light, var(--border)); border-radius: var(--radius-control); cursor: pointer; transition: background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default); }
.search-user-group-toggle:hover { color: var(--text-primary); background: var(--surface-hover); }
.search-user-group-icon { color: var(--brand-primary); }
.search-user-group-count { padding: 1px 7px; color: var(--brand-primary); font-size: var(--font-size-caption); background: var(--brand-soft); border-radius: 999px; }
.search-user-group-action { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; color: var(--brand-primary); font-size: var(--font-size-caption); font-weight: var(--font-weight-medium); }
.search-user-group-list { display: flex; flex-direction: column; gap: 12px; }
.pagination-footer { padding: var(--space-4) 0; text-align: center; }
.no-more { color: var(--text-tertiary); font-size: var(--font-size-caption); }
.search-welcome { display: flex; flex-direction: column; gap: 12px; }
.search-welcome-hint { margin: 0 0 4px; padding: 0 2px; color: var(--text-secondary); font-size: var(--font-size-sub); }
@container search-layout (max-width: 640px) {
  .search-toolbar-content { padding: 14px 12px 10px; }
  .search-tabs { gap: 4px; padding: 0 12px; }
  .search-tab-item { min-height: 42px; padding: 0 7px; }
  .search-tab-item.active::after { right: 7px; left: 7px; }
  .search-ask-filter { padding: 8px 12px 10px; }
  .search-feed-sort { padding: 8px 12px; }
  .search-results-section, .search-welcome { padding: 12px 12px 24px; }
}
.is-mobile-search .search-toolbar-content { padding: 6px 16px; }
.is-mobile-search .search-input-wrapper { height: 36px; gap: 0; padding: 0 2px; border: 0; border-radius: 8px; background: var(--surface-hover); }
.is-mobile-search .search-field { height: 100%; font-size: 14px; }
.is-mobile-search .clear-btn { display: none; }
.is-mobile-search .search-input-wrapper:focus-within .clear-btn { display: grid; }
.is-mobile-search .search-toolbar-frame { transition: grid-template-rows 200ms ease; }
.is-mobile-search .search-toolbar { transition: transform 200ms ease; }
.search-toolbar-frame.is-collapsed { grid-template-rows: 0fr; pointer-events: none; }
.search-toolbar-frame.is-collapsed .search-toolbar-clip { overflow: hidden; }
.search-toolbar-frame.is-collapsed .search-toolbar { transform: translateY(-100%); }
@media (prefers-reduced-motion: reduce) {
  .is-mobile-search .search-toolbar-frame, .is-mobile-search .search-toolbar { transition: none; }
}
</style>
