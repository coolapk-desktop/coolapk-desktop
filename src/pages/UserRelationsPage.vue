<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy }" class="relations-page-container custom-scrollbar" @scroll="handleScroll">
    <!-- 官方移动端使用独立标题栏和四个酷友分类。 -->
    <header class="relations-header">
      <button class="back-btn" title="返回" @click="goBack"><i class="fas fa-arrow-left"></i></button>
      <span class="header-title">酷友列表</span>
    </header>

    <nav class="header-tabs" aria-label="酷友分类">
      <button v-for="tab in tabs" :key="tab.key" :class="['tab-btn', { active: category === tab.key }]" :aria-current="category === tab.key ? 'page' : undefined" @click="switchCategory(tab.key)">{{ tab.label }}</button>
    </nav>

    <!-- 主体内容区 -->
    <main class="relations-content">
      <!-- 初始加载状态 -->
      <div v-if="loading && !users.length" class="state-wrapper">
        <LoadingState :text="`正在加载${currentTabLabel}列表...`" />
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error && !users.length" class="state-wrapper">
        <ErrorState title="列表加载失败" :message="error" @retry="load(true)" />
      </div>

      <!-- 空列表状态 -->
      <div v-else-if="!users.length" class="state-wrapper">
        <EmptyState
          :title="emptyTitle"
          :description="emptyDescription"
        />
      </div>

      <!-- 酷友用户列表 -->
      <div v-else class="user-list">
        <div
          v-for="(user, index) in users"
          :key="String(user.uid || user.id || index)"
          class="user-card"
          @click="openUser(user)"
        >
          <div class="user-card-main">
            <AppAvatar
              :src="getAvatarUrl(user)"
              :plugin-url="user.avatar_plugin_url || user.userInfo?.avatar_plugin_url"
              :size="40"
              class="user-avatar"
            />
            <div class="user-meta">
              <div class="user-title-row">
                <span class="user-name">{{ getUserName(user) }}</span>
                <span v-if="user.level || user.userInfo?.level" class="user-level-badge">
                  Lv.{{ user.level || user.userInfo?.level }}
                </span>
                <i v-if="isSpecial(user)" class="fas fa-star special-star" title="特别关注"></i>
              </div>
              <p v-if="getFollowCount(user) || getFansCount(user)" class="user-stats"><span v-if="getFollowCount(user)">关注 {{ getFollowCount(user) }}</span><span v-if="getFansCount(user)">粉丝 {{ getFansCount(user) }}</span></p>
              <p v-if="getBio(user)" class="user-bio">{{ getBio(user) }}</p>
            </div>
          </div>

          <!-- 关注 / 取消关注交互按钮 -->
          <div v-if="showFollowAction(user)" class="user-card-action" @click.stop>
            <button v-if="isFollowed(user) && category !== 'fans'" class="special-action-btn" :disabled="isSpecialPending(user)" :title="isSpecial(user) ? '取消特别关注' : '设为特别关注'" :aria-label="isSpecial(user) ? '取消特别关注' : '设为特别关注'" @click="handleSpecialToggle(user)"><i :class="isSpecial(user) ? 'fas fa-star' : 'far fa-star'"></i></button>
            <button
              :class="['follow-action-btn', { 'is-following': isFollowed(user) }]"
              :disabled="isFollowPending(user)"
              @click="handleFollowToggle(user)"
            >
              <i v-if="isFollowPending(user)" class="fas fa-circle-notch fa-spin"></i>
              <i v-else-if="isFollowed(user)" class="fas fa-check"></i>
              <i v-else class="fas fa-plus"></i>
              <span>{{ isFollowPending(user) ? '处理中' : (isFollowed(user) ? (isFriend(user) ? '互相关注' : '已关注') : '关注') }}</span>
            </button>
          </div>
        </div>

        <!-- 底部加载更多指示器 -->
        <div class="pagination-footer">
          <div v-if="loading && users.length" class="loading-more-text">
            <i class="fas fa-circle-notch fa-spin"></i> 正在加载更多...
          </div>
          <div v-else-if="!hasMore && users.length > 8" class="no-more-text">
            已无更多用户
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import { useAuthStore } from '../stores/auth';
import { useUserRelationsStore } from '../stores/userRelations';
import AppAvatar from '../components/common/AppAvatar.vue';
import EmptyState from '../components/common/EmptyState.vue';
import LoadingState from '../components/common/LoadingState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import { normalizeEntityPage, relationUserBio } from '../types/userSpace';
import { navigateBack } from '../utils/navigation';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const userRelations = useUserRelationsStore();

const users = ref<any[]>([]);
const page = ref(1);
const hasMore = ref(true);
const loading = ref(false);
const error = ref('');

const uid = computed(() => String(route.params.uid || ''));
/** 深链直接打开酷友列表时没有上一页，退回该用户主页而不是退出应用。 */
function goBack() { navigateBack(router, uid.value ? `/user/${uid.value}` : '/'); }
const relation = computed(() => route.params.relation === 'fans' ? 'fans' : 'follow');
type Category = 'follow' | 'special' | 'friend' | 'fans';
const isOwnList = computed(() => !!authStore.user?.uid && String(authStore.user.uid) === uid.value);
const tabs = computed<{ key: Category; label: string }[]>(() => isOwnList.value
  ? [{ key: 'follow', label: '关注' }, { key: 'special', label: '特别关注' }, { key: 'friend', label: '互相关注' }, { key: 'fans', label: '粉丝' }]
  : [{ key: 'follow', label: '关注' }, { key: 'fans', label: '粉丝' }]);
const category = computed<Category>(() => {
  if (relation.value === 'fans') return 'fans';
  const tab = String(route.query.tab || '');
  return isOwnList.value && (tab === 'special' || tab === 'friend') ? tab : 'follow';
});
const currentTabLabel = computed(() => tabs.value.find(tab => tab.key === category.value)?.label || '关注');
const emptyTitle = computed(() => `暂无${currentTabLabel.value}用户`);
const emptyDescription = computed(() => {
  if (category.value === 'fans') return isOwnList.value ? '分享你的想法和生活，吸引更多粉丝关注你！' : '还没有酷友关注该用户';
  if (category.value === 'special') return '还没有特别关注，设置后第一时间访问他们的最新动态';
  if (category.value === 'friend') return '互相关注是友谊的开始，去发现一些有趣的人吧！';
  return '还没有关注其他人，去关注一些有趣的酷友吧！';
});

function switchCategory(target: Category) {
  if (target === category.value) return;
  const path = `/user/${uid.value}/relations/${target === 'fans' ? 'fans' : 'follow'}`;
  void router.replace({ path, query: target === 'special' || target === 'friend' ? { tab: target } : {} });
}

function getUserName(user: any): string {
  const info = user.fUserInfo || user.userInfo || {};
  return String(
    user.fusername ||
    user.username ||
    info.username ||
    info.displayUserName ||
    user.displayUsername ||
    user.name ||
    '酷友'
  );
}

function getAvatarUrl(user: any): string {
  const info = user.fUserInfo || user.userInfo || {};
  const raw = user.fUserAvatar || user.userAvatar || info.userAvatar || info.avatar || user.avatar;
  if (raw && typeof raw === 'string') return raw;
  const targetUid = user.uid || user.fuid || info.uid;
  if (!targetUid) return '';
  const str = String(targetUid).padStart(9, '0');
  return `https://avatar.coolapk.com/data/${str.slice(0, 3)}/${str.slice(3, 5)}/${str.slice(5, 7)}/${String(targetUid).slice(-2)}_avatar_middle.jpg`;
}

function getBio(user: any): string {
  return relationUserBio(user, relation.value);
}

function visibleCount(value: unknown): string {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? String(value) : '';
}

function getFollowCount(user: any): string {
  const info = relation.value === 'fans' ? user.userInfo : (user.fUserInfo || user.userInfo);
  return visibleCount(info?.follow ?? info?.followNum);
}

function getFansCount(user: any): string {
  const info = relation.value === 'fans' ? user.userInfo : (user.fUserInfo || user.userInfo);
  return visibleCount(info?.fans ?? info?.fansNum);
}

function showFollowAction(user: any): boolean {
  return isOwnList.value && String(user.uid || user.fuid || '') !== uid.value;
}

/** 关系缓存键：优先 uid，其次列表接口里的目标 uid 字段。 */
function relationUid(user: any): string {
  return String(user?.uid || user?.fuid || user?.id || '').trim();
}

function isFollowPending(user: any): boolean {
  const targetUid = relationUid(user);
  return Boolean(targetUid) && userRelations.isPending(targetUid);
}

function isSpecialPending(user: any): boolean {
  const targetUid = relationUid(user);
  return Boolean(targetUid) && userRelations.isSpecialPending(targetUid);
}

function isFollowed(user: any): boolean {
  // store 缓存优先，缺失时回落到列表接口返回的关系字段。
  const relation = userRelations.getRelation(relationUid(user));
  if (relation) return relation.isFollow;
  const val = user.isFollow ?? user.is_follow ?? user.fUserInfo?.isFollow ?? user.userInfo?.isFollow;
  return val === 1 || val === '1' || val === true;
}

function isFriend(user: any): boolean {
  const val = user.isFriend ?? user.isfriend ?? user.fUserInfo?.isFriend ?? user.userInfo?.isFriend;
  return val === 1 || val === '1' || val === true;
}

function isSpecial(user: any): boolean {
  const relation = userRelations.getRelation(relationUid(user));
  if (relation && relation.isSpecialFollow !== undefined) return relation.isSpecialFollow;
  return [user.isSpecial, user.isSpecialFollow, user.is_special_follow, user.fUserInfo?.isSpecialFollow, user.userInfo?.isSpecialFollow].some(val => val === 1 || val === '1' || val === true);
}

async function handleSpecialToggle(user: any) {
  const targetUid = String(user.uid || user.fuid || '');
  if (!targetUid || isSpecialPending(user)) return;
  const next = !isSpecial(user);
  // 失败由 store 统一提示并回滚，这里只处理列表过滤。
  const ok = await userRelations.specialFollow(targetUid, next);
  if (!ok) return;
  user.isSpecial = next ? 1 : 0;
  user.isSpecialFollow = next ? 1 : 0;
  if (user.fUserInfo) user.fUserInfo.isSpecialFollow = next ? 1 : 0;
  if (user.userInfo) user.userInfo.isSpecialFollow = next ? 1 : 0;
  if (category.value === 'special' && !next) users.value = users.value.filter(item => item !== user);
}

async function handleFollowToggle(user: any) {
  if (!authStore.isLoggedIn) {
    authStore.openLoginModal();
    return;
  }
  const targetUid = String(user.uid || user.fuid || user.id || '');
  if (!targetUid || isFollowPending(user)) return;

  const current = isFollowed(user);
  // 关注状态由 store 统一维护，失败时已回滚并提示，这里只同步列表字段与过滤。
  const ok = await userRelations.toggle(targetUid, current);
  if (!ok) return;
  if (current) {
    user.isFollow = 0;
    user.isFriend = 0;
    user.isSpecial = 0;
    user.isSpecialFollow = 0;
    if (user.fUserInfo) user.fUserInfo.isFollow = 0;
    if (user.userInfo) user.userInfo.isFollow = 0;
    if (user.fUserInfo) user.fUserInfo.isSpecialFollow = 0;
    if (user.userInfo) user.userInfo.isSpecialFollow = 0;
    if (category.value !== 'fans') users.value = users.value.filter(item => item !== user);
  } else {
    user.isFollow = 1;
    if (relation.value === 'fans') user.isFriend = 1;
    if (user.fUserInfo) user.fUserInfo.isFollow = 1;
    if (user.userInfo) user.userInfo.isFollow = 1;
  }
}

let loadVersion = 0;
async function load(refresh = false) {
  if (!uid.value || loading.value || (!refresh && !hasMore.value)) return;
  if (refresh) {
    page.value = 1;
    users.value = [];
    hasMore.value = true;
    error.value = '';
  }
  loading.value = true;
  const version = ++loadVersion;
  try {
    const response: any = category.value === 'fans'
      ? await CoolapkTauriAPI.getFansList(uid.value, page.value)
      : await CoolapkTauriAPI.getFollowUserList(uid.value, page.value, category.value);
    if (version !== loadVersion) return;
    const normalized = normalizeEntityPage(response, page.value);
    const list = normalized.items;
    const known = new Set(users.value.map((user) => String(user.uid || user.fuid || user.id || '')));
    const incoming = list.filter((user: any) => !known.has(String(user.uid || user.fuid || user.id || '')));
    users.value = refresh ? incoming : [...users.value, ...incoming];
    page.value = Math.max(page.value + 1, normalized.page + 1);
    hasMore.value = normalized.hasMore;
  } catch (cause) {
    if (version !== loadVersion) return;
    error.value = cause instanceof Error ? cause.message : '用户列表加载失败';
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

function openUser(user: any) {
  const target = user.uid || user.fuid || user.id;
  if (target) void router.push(`/user/${target}`);
}

function handleScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
    if (!loading.value && hasMore.value) {
      void load(false);
    }
  }
}

watch([uid, category], () => {
  loading.value = false;
  void load(true);
}, { immediate: true });

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => loading.value);
async function refreshMobilePage() { await load(true); }
</script>

<style scoped>
.relations-page-container {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: var(--background, #f4f6f8);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.relations-header {
  position: sticky;
  top: 0;
  z-index: 10;
  width: 100%;
  max-width: var(--feed-max-width, 760px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--surface, #ffffff);
  border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  backdrop-filter: blur(16px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 16px;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.15s ease;
}

.back-btn:hover {
  background: var(--surface-hover, rgba(0, 0, 0, 0.05));
  transform: translateX(-2px);
}

.header-tabs {
  display: flex;
  gap: 8px;
}

.tab-btn {
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 6px 12px;
  border-radius: var(--radius-sm, 8px);
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  color: var(--text-primary);
  background: var(--surface-hover, rgba(0, 0, 0, 0.04));
}

.tab-btn.active {
  color: var(--brand-primary, #10b981);
  background: var(--brand-soft, rgba(16, 185, 129, 0.1));
}

.relations-content {
  width: 100%;
  max-width: var(--feed-max-width, 760px);
  padding: 16px;
  flex: 1;
}

.state-wrapper {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  border-radius: var(--radius-card, 12px);
  padding: 48px 24px;
  margin-top: 8px;
}

.user-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  border-radius: var(--radius-card, 12px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

.user-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  background: var(--surface-hover, #fafafa);
}

.user-card-main {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1;
}

.user-avatar {
  flex-shrink: 0;
}

.user-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.user-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.user-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-level-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--brand-soft, rgba(16, 185, 129, 0.12));
  color: var(--brand-primary, #10b981);
}

.relation-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.relation-badge.friend {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.relation-badge.special {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.user-bio {
  margin: 0;
  font-size: 13px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-uid-label {
  flex-shrink: 0;
  color: var(--text-quaternary, #9ca3af);
}

.bio-separator {
  flex-shrink: 0;
  color: var(--text-quaternary, #9ca3af);
}

.bio-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-card-action {
  flex-shrink: 0;
}

.follow-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--brand-primary, #10b981);
  color: #ffffff;
}

.follow-action-btn:hover {
  filter: brightness(1.06);
  transform: scale(1.02);
}

.follow-action-btn.is-following {
  background: var(--surface-hover, rgba(0, 0, 0, 0.06));
  color: var(--text-secondary);
  border-color: var(--border, rgba(0, 0, 0, 0.1));
}

.follow-action-btn.is-following:hover {
  color: var(--danger, #ef4444);
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
}

.pagination-footer {
  padding: 20px 0;
  text-align: center;
}

.loading-more-text,
.no-more-text {
  font-size: 13px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* 移动端按官方酷友列表的尺寸排列，桌面端增加列表宽度与间距。 */
.relations-header { flex: 0 0 auto; max-width: 920px; justify-content: flex-start; gap: 18px; padding: 8px 16px; backdrop-filter: none; }
.header-title { color: var(--text-primary); font-size: 18px; font-weight: 600; }
.header-tabs { position: sticky; top: 53px; z-index: 9; display: flex; flex: 0 0 auto; width: 100%; max-width: 920px; gap: 0; overflow-x: auto; background: var(--surface, #fff); border-bottom: 1px solid var(--border-light, #eee); }
.tab-btn { flex: 1; min-width: 0; border-radius: 0; padding: 13px 8px; font-size: 14px; white-space: nowrap; }
.tab-btn.active { background: transparent; border-bottom: 2px solid var(--brand-primary, #10b981); }
.relations-content { flex: 1 0 auto; max-width: 920px; padding: 20px 24px; }
.user-list { gap: 12px; }
.user-card { padding: 16px 20px; }
.user-title-row { flex-wrap: nowrap; }
.special-star { color: #f2b23e; font-size: 14px; }
.user-stats { display: flex; gap: 12px; margin: 0; color: var(--text-tertiary); font-size: 12px; }
.user-bio { display: block; overflow: hidden; }
.user-card-action { display: flex; align-items: center; gap: 8px; }
.special-action-btn { width: 28px; height: 28px; padding: 0; border: 0; background: transparent; color: #f2b23e; cursor: pointer; }
.follow-action-btn { min-width: 72px; min-height: 30px; }
@media (max-width: 600px) {
  .relations-page-container { align-items: stretch; }
  .relations-header { width: 100%; max-width: none; height: 52px; padding: 4px 8px; gap: 8px; }
  .back-btn { width: 40px; height: 40px; }
  .header-title { font-size: 18px; }
  .header-tabs { top: 52px; max-width: none; }
  .tab-btn { padding: 12px 2px; font-size: 14px; }
  .relations-content { max-width: none; padding: 0; }
  .user-list { gap: 0; }
  .user-card { padding: 10px 16px; gap: 8px; border-radius: 0; border-left: 0; border-right: 0; border-top: 0; box-shadow: none; }
  .user-card:hover { transform: none; box-shadow: none; }
  .user-card-main { gap: 16px; }
  .user-avatar { width: 40px; height: 40px; }
  .user-title-row { gap: 4px; }
  .user-name { font-size: 16px; }
  .user-level-badge { font-size: 10px; }
  .user-meta { gap: 6px; }
  .user-bio, .user-stats { font-size: 12px; }
  .follow-action-btn { min-width: 56px; min-height: 28px; padding: 4px 8px; font-size: 12px; }
  .state-wrapper { border: 0; border-radius: 0; margin-top: 0; }
}
</style>
