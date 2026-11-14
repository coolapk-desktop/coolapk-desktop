<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy || !authStore.isLoggedIn }" class="page-container custom-scrollbar">
    <!-- 未登录引导视图 -->
    <DemoLoginState v-if="authStore.isWebDemo && !authStore.isLoggedIn" />
    <div v-else-if="!authStore.isLoggedIn" class="empty-wrapper login-guide-wrapper">
      <div class="login-guide-card">
        <i class="fas fa-user-lock guide-icon"></i>
        <h3>解锁关注动态与酷友动态</h3>
        <p>登录酷安账号后，在此处可实时查看您关注的所有酷友的最新动态与信息。</p>
        <AppButton variant="primary" icon="fas fa-sign-in-alt" @click="authStore.openLoginModal()">
          一键调起登录酷安账号
        </AppButton>
      </div>
    </div>

    <!-- 登录后的关注工作区，动态与其它关注内容共用同一入口 -->
    <div v-else class="following-workspace" :class="{ 'following-workspace--category': selectedFollowCategory !== 'feeds' }">
      <nav class="following-category-tabs" aria-label="关注分类">
        <button
          v-for="category in followCategoryOptions"
          :key="category.key"
          type="button"
          :class="['following-category-tab', { active: selectedFollowCategory === category.key }]"
          :aria-pressed="selectedFollowCategory === category.key"
          @click="selectFollowCategory(category.key)"
        >
          <i :class="category.icon"></i>
          {{ category.label }}
        </button>
        <button v-if="selectedFollowCategory === 'feeds' && updatedFollowUsers?.available && updatedFollowUsers.collapsed" type="button" class="follow-updates-expand" aria-label="展开最近更新酷友" title="展开最近更新酷友" @click="updatedFollowUsers.expand()"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>
      </nav>

      <UpdatedFollowUsers ref="updatedFollowUsers" v-if="selectedFollowCategory === 'feeds'" :feeds="followingUpdateFeeds" />

      <div v-if="selectedFollowCategory !== 'feeds'" class="following-category-panel">
        <MoreDataPage :key="`${selectedFollowCategory}:${authStore.user?.uid ?? ''}`" :mode="selectedFollowCategory" />
      </div>

      <!-- 关注动态与关注用户仍保留原有双列布局 -->
      <div v-else class="following-layout">
      <!-- 左栏：关注动态列表 -->
      <div class="following-main">
        <!-- 筛选提示条（如果选中了特定酷友） -->
        <div v-if="selectedUser" class="user-filter-bar">
          <div class="filter-user-info">
            <AppAvatar :src="selectedUser.userInfo?.userAvatar || selectedUser.fUserInfo?.userAvatar || selectedUser.fUserAvatar || selectedUser.userAvatar" size="sm" />
            <span class="filter-text">正在查看 <strong>{{ selectedUser.userInfo?.username || selectedUser.fUserInfo?.username || selectedUser.fusername || selectedUser.username }}</strong> 的动态</span>
          </div>
          <button class="clear-filter-btn" @click="selectUserFilter(null)">
            查看全部动态 <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- 加载中 -->
        <div v-if="loading && feeds.length === 0" class="loading-wrapper">
          <LoadingState text="正在获取关注动态..." />
        </div>

        <!-- 空状态 -->
        <div v-else-if="feeds.length === 0" class="empty-wrapper">
          <EmptyState title="暂无关注动态" description="关注列表中酷友暂未更新动态，去关注更多有趣的酷友吧！" />
        </div>

        <!-- 动态卡片列表 -->
        <div v-else class="feed-list-wrapper">
          <div class="feed-list">
            <FeedCard v-for="item in feeds" :key="item.id" :feed="item" @deleted="handleFeedDeleted" />
          </div>
          <div v-if="loadingMore" class="loading-more-footer">
            <i class="fas fa-circle-notch fa-spin"></i> 正在读取下一页动态...
          </div>
          <div v-else-if="noMore && feeds.length > 5" class="no-more-footer">
            已加载全部关注动态
          </div>
        </div>
      </div>

      <!-- 右栏：已关注酷友/粉丝 侧边栏 -->
      <div class="following-sidebar">
        <div class="sidebar-card">
          <div class="sidebar-header">
            <!-- 酷友 / 粉丝 切换切页 -->
            <div class="sidebar-tabs">
              <button
                :class="['sidebar-tab-btn', { active: sidebarTab === 'users' }]"
                @click="switchSidebarTab('users')"
              >
                已关注 ({{ users.length }})
              </button>
              <button
                :class="['sidebar-tab-btn', { active: sidebarTab === 'fans' }]"
                @click="switchSidebarTab('fans')"
              >
                我的粉丝 ({{ fansUsers.length }})
              </button>
            </div>

            <div class="sidebar-search">
              <i class="fas fa-search search-icon"></i>
              <input
                v-model="userSearchQuery"
                type="text"
                :placeholder="sidebarTab === 'fans' ? '搜索粉丝...' : '搜索已关注酷友...'"
                class="sidebar-search-input"
              />
              <button v-if="userSearchQuery" class="clear-btn" @click="userSearchQuery = ''">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>

          <div v-if="(sidebarTab === 'users' ? usersLoading : fansLoading) && currentSourceList.length === 0" class="loading-wrapper">
            <LoadingState text="加载酷友中..." />
          </div>

          <div v-else-if="filteredUsers.length === 0" class="empty-wrapper">
            <EmptyState :title="sidebarTab === 'fans' ? '暂无粉丝' : '未找到匹配酷友'" />
          </div>

          <div v-else class="sidebar-user-list custom-scrollbar" @scroll="onSidebarScroll">
            <!-- 全部动态 汇总 -->
            <div
              v-if="sidebarTab === 'users'"
              :class="['sidebar-user-item', { active: !selectedUid }]"
              @click="selectUserFilter(null)"
            >
              <div class="all-icon-badge"><i class="fas fa-layer-group"></i></div>
              <div class="user-item-meta">
                <span class="user-item-name">全部动态</span>
                <span class="user-item-desc">汇总全部关注酷友动态</span>
              </div>
            </div>

            <!-- 用户列表项 -->
            <div
              v-for="u in filteredUsers"
              :key="getTargetUid(u)"
              :class="['sidebar-user-item', { active: String(selectedUid) === String(getTargetUid(u)) }]"
              role="link"
              tabindex="0"
              @click="navigateToUser(getTargetUid(u))"
              @keydown.enter.self.prevent="navigateToUser(getTargetUid(u))"
            >
              <AppAvatar
                :src="u.userInfo?.userAvatar || u.fUserInfo?.userAvatar || u.fUserAvatar || u.userAvatar || u.avatar"
                :plugin-url="u.avatar_plugin_url"
                size="sm"
              />
              <div class="user-item-meta">
                <span class="user-item-name">{{ u.userInfo?.username || u.fUserInfo?.username || u.displayUsername || u.fusername || u.username || '酷友' }}</span>
                <span v-if="relationUserBio(u, sidebarTab === 'fans' ? 'fans' : 'follow')" class="user-item-desc">{{ relationUserBio(u, sidebarTab === 'fans' ? 'fans' : 'follow') }}</span>
              </div>
              <button
                type="button"
                class="user-feed-btn"
                :aria-pressed="String(selectedUid) === String(getTargetUid(u))"
                @click.stop="selectUserFilter(getTargetUid(u))"
              >
                看动态
              </button>
              <button
                class="user-profile-btn"
                title="进入酷友主页"
                @click.stop="navigateToUser(getTargetUid(u))"
              >
                <i class="fas fa-chevron-right"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import DemoLoginState from '../components/common/DemoLoginState.vue';
import { vPullRefresh } from '../directives/pullRefresh';
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { shouldHideFeed } from '../utils/feedFilter';
import FeedCard from '../components/feed/FeedCard.vue';
import UpdatedFollowUsers from '../components/feed/UpdatedFollowUsers.vue';
import { isFollowUpdateCard } from '../utils/followUpdates';
import AppAvatar from '../components/common/AppAvatar.vue';
import AppButton from '../components/common/AppButton.vue';
import LoadingState from '../components/common/LoadingState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import MoreDataPage from './MoreDataPage.vue';
import { relationUserBio } from '../types/userSpace';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();

const followCategoryOptions = [
  { key: 'feeds', label: '关注动态', icon: 'fas fa-stream' },
  { key: 'nodes', label: '关注论坛', icon: 'fas fa-comments' },
  { key: 'topics', label: '关注话题', icon: 'fas fa-hashtag' },
  { key: 'apps', label: '应用', icon: 'fas fa-cube' },
  { key: 'collections', label: '收藏单', icon: 'fas fa-folder-open' },
  { key: 'questions', label: '问题', icon: 'fas fa-circle-question' },
  { key: 'products', label: '数码吧', icon: 'fas fa-mobile-screen-button' },
] as const;
type FollowCategory = typeof followCategoryOptions[number]['key'];

function followCategoryFromRoute(value: unknown): FollowCategory {
  const category = Array.isArray(value) ? value[0] : value;
  return followCategoryOptions.some(item => item.key === category) ? category as FollowCategory : 'feeds';
}

const selectedFollowCategory = ref<FollowCategory>(followCategoryFromRoute(route.query.category));

function selectFollowCategory(category: string) {
  if (!followCategoryOptions.some(item => item.key === category)) return;
  const nextCategory = category as FollowCategory;
  if (selectedFollowCategory.value === nextCategory) return;
  selectedFollowCategory.value = nextCategory;
  void router.push({ path: '/following', query: nextCategory === 'feeds' ? {} : { category: nextCategory } });
}

watch(() => route.query.category, value => {
  selectedFollowCategory.value = followCategoryFromRoute(value);
});

const loading = ref(false);
const usersLoading = ref(false);
const fansLoading = ref(false);
const feeds = ref<any[]>([]);
// 单个酷友筛选不覆盖关注动态汇总，避免将粉丝的动态混入更新名单。
const followingUpdateFeeds = ref<any[]>([]);
const updatedFollowUsers = ref<InstanceType<typeof UpdatedFollowUsers> | null>(null);
const users = ref<any[]>([]);
const fansUsers = ref<any[]>([]);
const selectedUid = ref<string | null>(null);
const userSearchQuery = ref('');
/** 侧栏页签由地址栏 `?tab=fans` 决定（顶栏「我的粉丝」入口），切换 query 时在同一实例内跟随。 */
function sidebarTabFromRoute(value: unknown): 'users' | 'fans' {
  const tab = Array.isArray(value) ? value[0] : value;
  return tab === 'fans' ? 'fans' : 'users';
}
const sidebarTab = ref<'users' | 'fans'>(sidebarTabFromRoute(route.query.tab));

function switchSidebarTab(tab: 'users' | 'fans') {
  sidebarTab.value = tab;
  // 手动切换也写回 ?tab=，保持地址栏与界面一致；保留其它 query（如 category）。
  // watch(route.query.tab) 在 nextTab === sidebarTab 时直接返回，不会触发重复加载。
  void router.replace({ path: route.path, query: { ...route.query, tab } });
  if (tab === 'fans' && fansUsers.value.length === 0) {
    void loadFansUsers(true);
  }
}

const currentSourceList = computed(() => {
  return sidebarTab.value === 'fans' ? fansUsers.value : users.value;
});

const filteredUsers = computed(() => {
  const list = currentSourceList.value;
  if (!userSearchQuery.value.trim()) return list;
  const q = userSearchQuery.value.trim().toLowerCase();
  return list.filter((u: any) => {
    const name = (u.userInfo?.username || u.fUserInfo?.username || u.displayUsername || u.fusername || u.username || '').toLowerCase();
    const bio = relationUserBio(u, sidebarTab.value === 'fans' ? 'fans' : 'follow').toLowerCase();
    return name.includes(q) || bio.includes(q);
  });
});

const selectedUser = computed(() => {
  if (!selectedUid.value) return null;
  const allKnown = [...users.value, ...fansUsers.value];
  return allKnown.find((u: any) => String(getTargetUid(u)) === String(selectedUid.value));
});

function getTargetUid(u: any): string {
  if (!u) return '';
  const myUid = String(authStore.user?.uid || '');
  const fuidStr = String(u.fuid || '');
  const uidStr = String(u.uid || u.id || u.target_id || '');

  if (fuidStr && fuidStr !== myUid) return fuidStr;
  if (uidStr && uidStr !== myUid) return uidStr;
  return fuidStr || uidStr;
}

async function selectUserFilter(uid: string | null) {
  if (selectedUid.value === uid) return;
  selectedUid.value = uid;

  // 点击后立即瞬间重置到顶部（不带动画）
  const container = document.querySelector('.page-container') as HTMLElement;
  if (container) {
    container.scrollTop = 0;
  }

  await loadFollowingFeeds(true);
}

function extractList(res: any): any[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.rows)) return res.rows;
  if (Array.isArray(res.data?.rows)) return res.data.rows;
  if (Array.isArray(res.data?.list)) return res.data.list;
  return [];
}

const page = ref(1);
const loadingMore = ref(false);
const noMore = ref(false);

async function loadFollowingFeeds(isRefresh: boolean = false) {
  if (loading.value || (loadingMore.value && !isRefresh)) return;
  const requestedUid = selectedUid.value;

  if (isRefresh) {
    page.value = 1;
    noMore.value = false;
    feeds.value = [];
    loading.value = true;
  } else {
    if (noMore.value) return;
    loadingMore.value = true;
  }

  try {
    const res = requestedUid
      ? await CoolapkTauriAPI.getUserFeeds(requestedUid, page.value, 'feed')
      : await CoolapkTauriAPI.getFollowingFeeds(page.value);

    const rawItems = extractList(res);
    // 卡片使用官方原始实体，动态列表排除卡片以免生成空白动态。
    const list = rawItems.filter((i: any) => !isFollowUpdateCard(i) && !shouldHideFeed(i, settingsStore.settings));
    if (!requestedUid && (isRefresh || rawItems.some(isFollowUpdateCard))) followingUpdateFeeds.value = rawItems.filter(isFollowUpdateCard);
    if (list.length < 3) {
      noMore.value = true;
    }

    if (isRefresh) {
      feeds.value = list;
    } else {
      const existingIds = new Set(feeds.value.map(i => i.id));
      const uniqueNew = list.filter(i => !existingIds.has(i.id));
      feeds.value.push(...uniqueNew);
    }
    page.value++;
  } catch (err) {
    console.error('获取关注动态失败:', err);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

const usersPage = ref(1);
const usersHasMore = ref(true);
const fansPage = ref(1);
const fansHasMore = ref(true);

async function loadFollowUsers(isRefresh: boolean = true) {
  if (usersLoading.value) return;
  if (isRefresh) {
    usersPage.value = 1;
    usersHasMore.value = true;
    users.value = [];
  }
  if (!usersHasMore.value) return;
  const myUid = String(authStore.user?.uid ?? '').trim();
  if (!myUid) return;

  usersLoading.value = true;
  try {
    let p = usersPage.value;
    // 自动连续翻页获取（单次最多同步读取 10 页 / 200 人，确保用户拥有的 50+ 关注酷友全部完整呈现）
    while (p <= 10) {
      const res = await CoolapkTauriAPI.getFollowUserList(myUid, p);
      const list = extractList(res);
      if (list.length === 0) {
        usersHasMore.value = false;
        break;
      }
      const existingUids = new Set(users.value.map(u => getTargetUid(u)));
      const uniqueNew = list.filter(u => !existingUids.has(getTargetUid(u)));
      users.value.push(...uniqueNew);
      p++;
      if (list.length < 20) {
        usersHasMore.value = false;
        break;
      }
    }
    usersPage.value = p;
  } catch (err) {
    console.error('获取关注用户列表失败:', err);
  } finally {
    usersLoading.value = false;
  }
}

async function loadFansUsers(isRefresh: boolean = true) {
  if (fansLoading.value) return;
  if (isRefresh) {
    fansPage.value = 1;
    fansHasMore.value = true;
    fansUsers.value = [];
  }
  if (!fansHasMore.value) return;
  const myUid = String(authStore.user?.uid ?? '').trim();
  if (!myUid) return;

  fansLoading.value = true;
  try {
    let p = fansPage.value;
    while (p <= 10) {
      const res = await CoolapkTauriAPI.getFansList(myUid, p);
      const list = extractList(res);
      if (list.length === 0) {
        fansHasMore.value = false;
        break;
      }
      const existingUids = new Set(fansUsers.value.map(u => getTargetUid(u)));
      const uniqueNew = list.filter(u => !existingUids.has(getTargetUid(u)));
      fansUsers.value.push(...uniqueNew);
      p++;
      if (list.length < 20) {
        fansHasMore.value = false;
        break;
      }
    }
    fansPage.value = p;
  } catch (err) {
    console.error('获取粉丝用户列表失败:', err);
  } finally {
    fansLoading.value = false;
  }
}

function onSidebarScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) {
    if (sidebarTab.value === 'users' && usersHasMore.value && !usersLoading.value) {
      loadFollowUsers(false);
    } else if (sidebarTab.value === 'fans' && fansHasMore.value && !fansLoading.value) {
      loadFansUsers(false);
    }
  }
}

/** 地址栏页签变化（顶栏「我的关注 / 我的粉丝」入口）时复用同一实例切换侧栏，不重建整页。 */
watch(() => route.query.tab, value => {
  const nextTab = sidebarTabFromRoute(value);
  // 地址未指定页签（如切换关注分类）时保留用户手动选择的侧栏页签。
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return;
  if (nextTab === sidebarTab.value) return;
  switchSidebarTab(nextTab);
});

function navigateToUser(uid: string | number) {
  if (!uid) return;
  router.push(`/user/${uid}`);
}

function onScrollEvent(e: Event) {
  if (selectedFollowCategory.value !== 'feeds') return;
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
      loadFollowingFeeds(false);
    }
  }
}

const onRefreshFeeds = () => {
  if (!loading.value && !loadingMore.value) {
    loadFollowingFeeds(true);
  }
};

function handleFeedDeleted(id: string | number) {
  feeds.value = feeds.value.filter((f: any) => String(f.id) !== String(id));
  followingUpdateFeeds.value = followingUpdateFeeds.value.filter((f: any) => String(f.id) !== String(id));
}

function bindGlobalListeners() {
  window.addEventListener('scroll', onScrollEvent, true);
  window.addEventListener('refresh-feeds', onRefreshFeeds);
}

function unbindGlobalListeners() {
  window.removeEventListener('scroll', onScrollEvent, true);
  window.removeEventListener('refresh-feeds', onRefreshFeeds);
}

onMounted(() => {
  if (authStore.isLoggedIn) {
    void loadFollowUsers();
    void loadFollowingFeeds(true);
    // 直接以 ?tab=fans 进入时首个实例的侧栏页签由 setup 快照决定，这里补上粉丝列表。
    if (sidebarTab.value === 'fans') switchSidebarTab('fans');
  }
});

onActivated(bindGlobalListeners);
onDeactivated(unbindGlobalListeners);
onUnmounted(unbindGlobalListeners);

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => selectedFollowCategory.value !== 'feeds' || loading.value || loadingMore.value);
async function refreshMobilePage() { await loadFollowingFeeds(true); }
</script>

<style scoped>
/* 利用现有分类栏恢复头像列表，不增加独立占位。 */
.follow-updates-expand { display: flex; align-items: center; justify-content: center; flex: 0 0 32px; margin-left: auto; border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); font-size: 11px; cursor: pointer; }
.follow-updates-expand:hover { background: var(--surface-hover); color: var(--text-secondary); }
.follow-updates-expand:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }

.page-container {
  width: 100%;
  max-width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: 0;
  margin: 0;
  background-color: var(--surface);
}

.following-workspace {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 100%;
}

.following-workspace--category {
  height: 100%;
}

.following-category-tabs {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4) 0;
}

.following-category-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  transition: all var(--duration-fast);
}

.following-category-tab:hover,
.following-category-tab.active {
  border-color: var(--brand-primary);
  background: var(--brand-soft);
  color: var(--brand-primary);
}

.following-category-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.following-category-panel :deep(.page-container) {
  height: 100%;
}

.following-layout {
  display: flex;
  gap: var(--space-5);
  align-items: flex-start;
  width: 100%;
}

.following-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.user-filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background-color: var(--brand-soft);
  border: 1px solid var(--brand-primary);
  border-radius: var(--radius-card);
}

.filter-user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
}

.clear-filter-btn {
  border: none;
  background: transparent;
  color: var(--brand-primary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

.clear-filter-btn:hover {
  text-decoration: underline;
}

.feed-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.following-sidebar {
  width: 320px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
}

.sidebar-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100vh - 120px);
}

.sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sidebar-tabs {
  display: flex;
  background-color: var(--background);
  border-radius: var(--radius-pill);
  padding: 3px;
  gap: 4px;
  border: 1px solid var(--border);
}

.sidebar-tab-btn {
  flex: 1;
  border: none;
  background: transparent;
  padding: 5px 8px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast);
}

.sidebar-tab-btn.active {
  background-color: var(--brand-primary);
  color: white;
  font-weight: 700;
}

.sidebar-search {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.sidebar-search .search-icon {
  position: absolute;
  left: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
  pointer-events: none;
}

.sidebar-search-input {
  width: 100%;
  height: 32px;
  padding: 0 28px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background-color: var(--background);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  transition: all var(--duration-fast);
}

.sidebar-search-input:focus {
  border-color: var(--brand-primary);
}

.clear-btn {
  position: absolute;
  right: 8px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 11px;
}

.sidebar-user-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 4px;
}

.sidebar-user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast);
  border: 1px solid transparent;
}

.sidebar-user-item:hover {
  background-color: var(--surface-hover);
}

.sidebar-user-item.active {
  background-color: var(--brand-soft);
  border-color: var(--brand-primary);
}

.all-icon-badge {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background-color: var(--brand-soft);
  color: var(--brand-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}

.user-item-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-user-item.active .user-item-name {
  color: var(--brand-primary);
}

.user-item-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-profile-btn {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  padding: 4px;
  transition: color var(--duration-fast);
}

.user-profile-btn:hover {
  color: var(--brand-primary);
}

.user-feed-btn {
  flex-shrink: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--brand-primary);
  font-size: 12px;
  cursor: pointer;
}

.user-feed-btn:hover,
.user-feed-btn[aria-pressed="true"] {
  background: var(--brand-soft);
}

.login-guide-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
}

.login-guide-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 420px;
  padding: 40px 30px;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border-light, #e5e7eb);
  border-radius: var(--radius-lg, 16px);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.04);
}

.guide-icon {
  font-size: 42px;
  color: var(--brand-primary, #10b981);
  margin-bottom: 16px;
}

.login-guide-card h3 {
  margin: 0 0 10px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.login-guide-card p {
  margin: 0 0 24px 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.loading-more-footer,
.no-more-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 0 24px;
  font-size: 12px;
  color: var(--text-tertiary, rgba(0, 0, 0, 0.35));
  user-select: none;
}

.no-more-footer::before,
.no-more-footer::after {
  content: '';
  width: 48px;
  height: 1px;
  background: var(--border-light, rgba(0, 0, 0, 0.08));
}

@media (max-width: 900px) {
  .following-layout {
    flex-direction: column-reverse;
  }
  .following-sidebar {
    width: 100%;
    position: static;
  }
  .sidebar-card {
    max-height: none;
  }
}
</style>
