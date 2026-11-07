<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy }" class="page-container custom-scrollbar" @scroll="handleScroll">
    <!-- 顶栏工具条：左侧分类 Tab，右侧搜索模式切换 + 搜索框 -->
    <div class="apps-toolbar-bar">
      <div class="apps-tabs-wrapper">
        <button
          v-for="cat in categories"
          :key="cat.key"
          type="button"
          :class="['cat-tab', { active: activeCat === cat.key && !isSearching }]"
          @click="selectCategory(cat.key)"
        >
          <i :class="cat.icon"></i> {{ cat.name }}
        </button>
      </div>

      <div class="apps-actions-wrapper">
        <!-- 搜索模式切换（应用名 / 开发者 / 标签） -->
        <div class="search-mode-switch" role="group" aria-label="搜索方式">
          <button
            v-for="mode in searchModes"
            :key="mode.key"
            type="button"
            :class="['mode-btn', { 'is-active': searchMode === mode.key }]"
            @click="selectSearchMode(mode.key)"
          >
            <i :class="mode.icon"></i> {{ mode.label }}
          </button>
        </div>

        <!-- 应用搜索输入框 -->
        <div class="search-box">
          <i class="fas fa-search search-icon"></i>
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="searchPlaceholder"
            class="search-input"
            @keyup.enter="handleSearch"
          />
          <button v-if="searchQuery" class="clear-btn" @click="clearSearch">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- 加载中状态 -->
    <div v-if="loading" class="loading-wrapper">
      <LoadingState :text="loadingText" />
    </div>

    <!-- 加载失败状态（与空态严格区分） -->
    <div v-else-if="error" class="error-wrapper">
      <ErrorState :message="error" retryable @retry="retryInitial" />
    </div>

    <!-- 空数据状态 -->
    <div v-else-if="apps.length === 0" class="empty-wrapper">
      <EmptyState
        title="暂无相关应用数据"
        description="可尝试在上方搜索框直接查找应用名称或切换分类"
      />
    </div>

    <!-- 应用网格/列表区域 -->
    <div v-else class="apps-grid">
      <div
        v-for="app in apps"
        :key="app.id || app.packageName || app.title"
        class="app-card"
        @click="navigateToApp(app)"
      >
        <AppImage :src="getAppIcon(app)" alt="Logo" image-class="app-icon" />
        <div class="app-info">
          <div class="title-row">
            <span class="app-name">{{ app.title || app.shorttitle || '推荐应用' }}</span>
            <span v-if="app.version" class="version-tag">{{ app.version }}</span>
          </div>
          <span class="app-desc">{{ app.subTitle || app.description || app.packageName || '酷安精选推荐软件' }}</span>
          
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

      <!-- 底部分页状态 -->
      <div class="pagination-footer">
        <LoadingState v-if="loading && page > 1" text="正在加载更多应用..." />
        <button v-else-if="footerError" class="retry-inline" @click="retryLoadMore">加载失败，点击重试</button>
        <div v-else-if="noMore" class="no-more">已加载全部应用</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import AppImage from '../components/common/AppImage.vue';
import AppButton from '../components/common/AppButton.vue';
import LoadingState from '../components/common/LoadingState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import { showToast } from '../utils/toast';

const router = useRouter();
const activeCat = ref('recommend');
const searchQuery = ref('');
const searchMode = ref('name');
const isSearching = ref(false);
const loading = ref(false);
const error = ref('');
const footerError = ref('');
const page = ref(1);
const noMore = ref(false);
const apps = ref<any[]>([]);

// 请求序号：切分类/搜索发出的新请求使在途旧请求整体失效，
// 慢的旧响应到达时序号已过期，不得覆盖当前列表（对应 S4 请求版本保护）。
let fetchSequence = 0;

const searchModes = [
  { key: 'name', label: '应用名', icon: 'fas fa-magnifying-glass' },
  { key: 'developer', label: '开发者', icon: 'fas fa-user' },
  { key: 'tag', label: '标签', icon: 'fas fa-tags' },
];

const categories = [
  { key: 'recommend', name: '推荐榜', icon: 'fas fa-fire' },
  { key: 'newest', name: '酷酷新品', icon: 'fas fa-sparkles' },
  { key: 'tools', name: '系统工具', icon: 'fas fa-wrench' },
  { key: 'social', name: '社交通讯', icon: 'fas fa-comments' },
  { key: 'media', name: '影音播放', icon: 'fas fa-film' },
  { key: 'beauty', name: '美化手机', icon: 'fas fa-palette' },
];

const loadingText = computed(() => {
  if (isSearching.value) return `正在搜索 "${searchQuery.value}" 相关应用...`;
  return '正在探索酷安应用列表...';
});

const searchPlaceholder = computed(() => {
  if (searchMode.value === 'developer') return '输入开发者名称搜索...';
  if (searchMode.value === 'tag') return '输入标签名称搜索...';
  return '搜索指定应用或包名...';
});

function getAppIcon(app: any): string {
  return (
    app.icon ||
    app.apkRomIcon ||
    app.logo ||
    app.pic ||
    'https://c2.coolapk.com/coolmarket/apk/default_avatar.png'
  );
}

function resetList() {
  apps.value = [];
  page.value = 1;
  noMore.value = false;
  error.value = '';
  footerError.value = '';
}

async function loadApps(isLoadMore = false) {
  // 只有「加载更多」受 loading/noMore 守卫避免滚动重入；
  // 刷新类请求（首载/切分类/搜索）用序号作废旧响应，不被 loading 拦截。
  if (isLoadMore && (loading.value || noMore.value)) return;
  if (!isLoadMore) fetchSequence += 1;
  const sequence = fetchSequence;
  const snapCat = activeCat.value;
  const snapQuery = searchQuery.value.trim();
  const snapMode = searchMode.value;
  const snapSearching = isSearching.value;
  loading.value = true;
  if (!isLoadMore) {
    error.value = '';
    footerError.value = '';
    apps.value = [];
    page.value = 1;
  }

  try {
    let res: any;
    if (snapSearching && snapQuery) {
      if (snapMode === 'developer') {
        res = await CoolapkTauriAPI.searchApksByDeveloper(snapQuery, page.value);
      } else if (snapMode === 'tag') {
        res = await CoolapkTauriAPI.searchApksByTag(snapQuery, '1', page.value);
      } else {
        res = await CoolapkTauriAPI.searchApks(snapQuery, page.value);
      }
    } else {
      res = await CoolapkTauriAPI.getAppList(snapCat, page.value);
    }
    // 响应到达时校验请求版本与条件快照，过期则丢弃
    if (sequence !== fetchSequence || snapCat !== activeCat.value || snapQuery !== searchQuery.value.trim() || snapSearching !== isSearching.value) return;
    const list = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
    const filtered = list.filter((item: any) => item.title || item.packageName);
    if (filtered.length === 0) {
      noMore.value = true;
    } else if (isLoadMore) {
      const existingKeys = new Set(apps.value.map((a: any) => a.id || a.packageName || a.title));
      apps.value.push(...filtered.filter((i: any) => !existingKeys.has(i.id || i.packageName || i.title)));
      page.value++;
    } else {
      apps.value = filtered;
      page.value = 2;
    }
  } catch (err: any) {
    const msg = err?.message || '网络请求异常，请检查网络后重试';
    if (sequence !== fetchSequence) return;
    if (isLoadMore) footerError.value = msg;
    else error.value = msg;
  } finally {
    if (sequence === fetchSequence) loading.value = false;
  }
}

function retryInitial() {
  fetchSequence += 1;
  void loadApps(false);
}

function retryLoadMore() {
  footerError.value = '';
  void loadApps(true);
}

function handleScroll(e: Event) {
  const target = e.target as HTMLElement;
  const { scrollTop, clientHeight, scrollHeight } = target;
  if (scrollTop + clientHeight >= scrollHeight - 200) {
    if (!loading.value && !noMore.value) void loadApps(true);
  }
}

function selectCategory(catKey: string) {
  activeCat.value = catKey;
  if (isSearching.value) {
    isSearching.value = false;
    searchQuery.value = '';
  }
  resetList();
  void loadApps();
}

function handleSearch() {
  if (searchQuery.value.trim()) {
    isSearching.value = true;
    resetList();
    void loadApps();
  }
}

function selectSearchMode(mode: string) {
  if (searchMode.value === mode) return;
  searchMode.value = mode;
  if (isSearching.value && searchQuery.value.trim()) {
    resetList();
    void loadApps();
  }
}

function clearSearch() {
  searchQuery.value = '';
  isSearching.value = false;
  resetList();
  void loadApps();
}

// 只有 packageName/id 才能拼出 /app/{pkg} 详情路由；
// title 只是显示名，用它拼路由会得到无效页面。
function navigateToApp(app: any) {
  const pkg = app.packageName || app.id;
  if (pkg) {
    router.push(`/app/${pkg}`);
  } else {
    showToast('该条目缺少应用标识，无法打开详情');
  }
}

onMounted(() => loadApps());

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => loading.value);
async function refreshMobilePage() { await loadApps(); }
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

.apps-toolbar-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0 14px 0;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  flex-wrap: wrap;
}

.apps-tabs-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

.cat-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-pill, 20px);
  background-color: var(--surface);
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.08));
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.cat-tab:hover {
  background-color: var(--surface-hover);
  color: var(--text-primary);
}

.cat-tab.active {
  background-color: var(--brand-soft, rgba(16, 185, 129, 0.12));
  color: var(--brand-primary, #10b981);
  border-color: var(--brand-primary, #10b981);
  font-weight: 700;
}

.apps-actions-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.search-mode-switch {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background-color: var(--background-secondary, var(--surface-hover));
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.08));
  border-radius: var(--radius-pill, 16px);
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--radius-pill, 14px);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-btn:hover {
  color: var(--text-primary);
}

.mode-btn.is-active {
  background-color: var(--surface);
  color: var(--brand-primary);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
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

.apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: var(--space-4);
}

.pagination-footer {
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

@media (max-width: 720px) {
  .page-container {
    min-width: 0;
    padding: var(--space-3);
  }

  .apps-toolbar-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .apps-tabs-wrapper {
    width: 100%;
    flex: 0 0 auto;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .apps-tabs-wrapper::-webkit-scrollbar {
    display: none;
  }

  .apps-actions-wrapper {
    width: 100%;
    min-width: 0;
    flex-direction: column;
    align-items: stretch;
  }

  .search-mode-switch {
    width: 100%;
  }

  .mode-btn {
    min-width: 0;
    flex: 1 1 0;
    justify-content: center;
  }

  .search-box {
    width: 100%;
    min-width: 0;
  }

  .apps-grid {
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
