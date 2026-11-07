<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy }" :class="['page-container', { 'is-embedded': embedded }]" class="custom-scrollbar" @scroll="handleScroll">
    <div v-if="!embedded" class="page-header">
      <div class="header-main">
        <div class="header-titles">
          <h2 class="page-title"><i :class="[meta.icon, 'icon']"></i> {{ meta.title }}</h2>
          <span class="page-subtitle">{{ meta.subtitle }}</span>
        </div>
        <AppButton v-if="requiresLogin && authStore.isLoggedIn && !isPlaceholder && !embedded" variant="secondary" size="sm" icon="fas fa-sync-alt" :loading="loading" @click="load(true)">刷新</AppButton>
      </div>
    </div>

    <div v-if="requiresLogin && !authStore.isLoggedIn" class="empty-wrapper">
      <EmptyState title="登录后查看此内容" description="该页面需要酷安账号的真实数据" />
      <AppButton variant="primary" size="sm" @click="authStore.openLoginModal()">立即登录</AppButton>
    </div>
    <EmptyState v-else-if="isPlaceholder" :title="meta.title + '暂不支持'" :description="meta.placeholder" />
    <template v-else>
      <LoadingState v-if="loading && !items.length" text="正在读取真实数据..." />
      <ErrorState v-else-if="error && !items.length" title="加载失败" :message="error" @retry="load(true)" />
      <EmptyState v-else-if="!items.length" :title="'暂无' + meta.title" :description="meta.empty" />

      <div v-else-if="isFeedMode" class="feed-list">
        <FeedCard v-for="item in items" :key="item.id || item.entityId" :feed="item" />
        <div class="pagination-footer">
          <LoadingState v-if="loadingMore" text="正在加载更多..." />
          <button v-else-if="error" class="retry-inline" type="button" @click="retryLoadMore">加载失败，点击重试</button>
          <span v-else-if="noMore">已加载全部内容</span>
        </div>
      </div>

      <div v-else class="entity-list">
        <div v-for="(item, index) in items" :key="entityKey(item, index)" class="entity-row" role="button" tabindex="0" @click="openEntity(item)" @keydown.enter.prevent="openEntity(item)">
          <AppAvatar :src="entityImage(item)" size="md" :alt="entityTitle(item)" />
          <span class="entity-main"><strong>{{ entityTitle(item) }}</strong><small>{{ entitySubtitle(item) }}</small></span>
          <button v-if="canUnfollow" class="row-action" type="button" :disabled="unfollowPendingKey === entityKey(item, index)" @click.stop="unfollowItem(item, index)">{{ unfollowPendingKey === entityKey(item, index) ? '处理中...' : '取消关注' }}</button>
          <i v-else class="fas fa-chevron-right row-arrow"></i>
        </div>
        <div class="pagination-footer">
          <LoadingState v-if="loadingMore" text="正在加载更多..." />
          <button v-else-if="error" class="retry-inline" type="button" @click="retryLoadMore">加载失败，点击重试</button>
          <span v-else-if="noMore">已加载全部内容</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FeedCard from '../components/feed/FeedCard.vue';
import AppAvatar from '../components/common/AppAvatar.vue';
import AppButton from '../components/common/AppButton.vue';
import LoadingState from '../components/common/LoadingState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import { CoolapkTauriAPI } from '../api/coolapk';
import { useAuthStore } from '../stores/auth';
import { getErrorMessage } from '../utils/errors';
import { showToast } from '../utils/toast';

const props = defineProps<{ mode?: string; embedded?: boolean }>();
const embedded = props.embedded === true;
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const mode = computed(() => String(props.mode || route.meta.mode || 'contacts'));
const items = ref<any[]>([]);
const page = ref(1);
const loading = ref(false);
const loadingMore = ref(false);
const noMore = ref(false);
const error = ref('');

const catalog: Record<string, { title: string; icon: string; subtitle: string; empty: string; placeholder?: string }> = {
  nodes: { title: '我关注的论坛', icon: 'fas fa-comments', subtitle: '同步账号关注的论坛与节点', empty: '关注的论坛会显示在这里' },
  topics: { title: '我关注的话题', icon: 'fas fa-hashtag', subtitle: '真实读取关注话题，可直接取消关注', empty: '暂无关注话题' },
  collections: { title: '我关注的收藏单', icon: 'fas fa-folder-open', subtitle: '同步账号关注的收藏单，可直接取消关注', empty: '暂无关注的收藏单' },
  questions: { title: '我关注的问题', icon: 'fas fa-circle-question', subtitle: '同步账号关注的问题，可直接取消关注', empty: '暂无关注的问题' },
  products: { title: '我关注的数码吧', icon: 'fas fa-mobile-screen-button', subtitle: '同步账号关注的数码产品，可直接取消关注', empty: '暂无关注的数码产品' },
  contacts: { title: '最近联系人', icon: 'far fa-address-book', subtitle: '同步最近私信联系人，点击进入会话', empty: '暂无最近联系人' },
  recycle: { title: '内容回收站', icon: 'fas fa-trash-can', subtitle: '仅账号具备审核权限时可读取被删/垃圾动态', empty: '暂无回收站内容' },
  devices: { title: '我的设备', icon: 'fas fa-mobile-screen-button', subtitle: '读取账号拥有的数码设备；官方未公开桌面端增删改接口', empty: '暂无已拥有设备' },
  hidden: { title: '隐藏的回复', icon: 'far fa-eye-slash', subtitle: '酷安接口需要指定动态 ID，无法提供全局隐藏回复列表', empty: '', placeholder: '反编译确认隐藏回复使用 /v6/feed/replyList?id=动态ID&feedType=feed_reply。当前侧栏入口保留说明，打开具体动态后才能按动态读取隐藏回复。' },
  votes: { title: '我的投票', icon: 'fas fa-square-poll-vertical', subtitle: '酷安暂无可确认的“我的投票记录”接口', empty: '', placeholder: '反编译接口清单未发现个人投票记录端点，因此暂不展示猜测数据。' },
};
const meta = computed(() => catalog[mode.value] || catalog.contacts);
const hiddenFeedId = computed(() => String(route.query.feedId || '').trim());
const requiresLogin = computed(() => mode.value !== 'votes');
const isPlaceholder = computed(() => Boolean(meta.value.placeholder) && !hiddenFeedId.value);
const isFeedMode = computed(() => mode.value === 'recycle' || (mode.value === 'hidden' && Boolean(hiddenFeedId.value)));
const canUnfollow = computed(() => ['topics', 'collections', 'questions', 'products'].includes(mode.value));
const unfollowPendingKey = ref('');

function entityKey(item: any, index: number) { return String(item?.id || item?.entityId || item?.collectionId || item?.questionId || item?.productId || item?.uid || item?.ukey || index); }
function entityTitle(item: any) { return item?.title || item?.name || item?.collectionTitle || item?.questionTitle || item?.productName || item?.tag || item?.topicName || item?.username || item?.userInfo?.username || item?.deviceTitle || '未命名'; }
function entitySubtitle(item: any) { return item?.description || item?.intro || item?.subTitle || item?.message || item?.brandName || item?.model || item?.ukey || item?.packageName || ''; }
function entityImage(item: any) { return item?.cover || item?.coverPic || item?.cover_pic || item?.logo || item?.icon || item?.pic || item?.userAvatar || item?.userInfo?.userAvatar || ''; }

function extractList(response: any): any[] {
  const data = response?.data;
  const flatten = (items: any[]): any[] => items.flatMap(item => {
    if (item && typeof item === 'object' && Array.isArray(item.entities) && !item.entityTemplate) return flatten(item.entities);
    return [item];
  });
  if (Array.isArray(data)) return flatten(data);
  for (const key of ['entities', 'list', 'rows', 'items', 'data']) {
    if (Array.isArray(data?.[key])) return flatten(data[key]);
  }
  return [];
}

async function load(refresh = false) {
  if (loading.value || loadingMore.value || isPlaceholder.value) return;
  if (refresh) { page.value = 1; items.value = []; noMore.value = false; error.value = ''; loading.value = true; }
  else { if (noMore.value) return; loadingMore.value = true; error.value = ''; }
  try {
    let res: any;
    if (mode.value === 'nodes') {
      const uid = String(authStore.user?.uid || '');
      const forumRes = await CoolapkTauriAPI.getUserForumFollowList(uid, page.value);
      res = { data: Array.isArray(forumRes?.data) ? forumRes.data : [] };
    } else if (mode.value === 'topics') res = await CoolapkTauriAPI.getFollowedTopics(page.value);
    else if (mode.value === 'contacts') res = await CoolapkTauriAPI.getRecentChatUsers(page.value);
    else if (mode.value === 'recycle') res = await CoolapkTauriAPI.getSpamFeedList(page.value);
    else if (mode.value === 'hidden') res = await CoolapkTauriAPI.getHiddenReplies(hiddenFeedId.value, page.value);
    else if (mode.value === 'devices') res = await CoolapkTauriAPI.getMyProductList(String(authStore.user?.uid), 'owner', page.value);
    else if (mode.value === 'collections') res = await CoolapkTauriAPI.getFollowedCollections(page.value);
    else if (mode.value === 'questions') res = await CoolapkTauriAPI.getFollowedQuestions(page.value);
    else if (mode.value === 'products') res = await CoolapkTauriAPI.getFollowedProducts(page.value);
    const incoming = extractList(res);
    if (!incoming.length || mode.value === 'nodes') noMore.value = true;
    const ids = new Set(items.value.map((item, index) => entityKey(item, index)));
    items.value.push(...incoming.filter((item: any, index: number) => !ids.has(entityKey(item, index))));
    if (incoming.length && mode.value !== 'nodes') page.value++;
  } catch (err: any) { error.value = err?.message || '加载失败，请检查网络'; }
  finally { loading.value = false; loadingMore.value = false; }
}

function followedTargetId(item: any): string {
  if (mode.value === 'topics') return String(item?.tag || item?.title || item?.name || '').trim();
  if (mode.value === 'collections') return String(item?.collectionId || item?.id || item?.entityId || '').trim();
  if (mode.value === 'questions') return String(item?.questionId || item?.id || item?.entityId || '').trim();
  return String(item?.productId || item?.id || item?.entityId || '').trim();
}

async function unfollowItem(item: any, index: number) {
  if (!canUnfollow.value) return;
  const targetId = followedTargetId(item);
  const pendingKey = entityKey(item, index);
  if (!targetId || unfollowPendingKey.value) return;
  unfollowPendingKey.value = pendingKey;
  try {
    if (mode.value === 'topics') await CoolapkTauriAPI.unfollowTag(targetId);
    else if (mode.value === 'collections') await CoolapkTauriAPI.unfollowCollection(targetId);
    else if (mode.value === 'questions') await CoolapkTauriAPI.unfollowQuestion(targetId);
    else await CoolapkTauriAPI.changeProductFollowStatus(targetId, 0);
    items.value = items.value.filter((current, currentIndex) => entityKey(current, currentIndex) !== pendingKey);
    showToast('已取消关注', 'success');
  } catch (err) {
    error.value = getErrorMessage(err, '取消关注失败');
    showToast(error.value, 'error');
  } finally {
    unfollowPendingKey.value = '';
  }
}

function openEntity(item: any) {
  if (mode.value === 'contacts') {
    const uid = item?.uid || item?.userInfo?.uid || item?.messageUid || item?.id;
    if (uid) void router.push({ path: '/messages', query: { uid: String(uid) } });
  } else if (mode.value === 'topics') {
    const tag = item?.tag || item?.title || item?.name;
    if (tag) void router.push(`/topic/${encodeURIComponent(String(tag))}`);
  } else if (mode.value === 'collections') {
    const id = item?.collectionId || item?.id || item?.entityId;
    if (id) void router.push({ path: '/favorites', query: { collectionId: String(id), collectionTitle: entityTitle(item) } });
  } else if (mode.value === 'questions') {
    const id = item?.questionId || item?.id || item?.entityId;
    if (id) void router.push(`/question/${encodeURIComponent(String(id))}`);
  } else if (mode.value === 'products') {
    const id = item?.productId || item?.id || item?.entityId;
    if (id) void router.push(`/product/${encodeURIComponent(String(id))}`);
  } else if (mode.value === 'devices') {
    const id = item?.id || item?.entityId;
    if (id) void router.push(`/product/${encodeURIComponent(String(id))}`);
  }
}

function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  // 失败后停在错误态等用户点 footer 的重试，避免滚动一次打一次接口。
  if (error.value) return;
  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 180) void load(false);
}

onMounted(() => { if (requiresLogin.value ? authStore.isLoggedIn : true) void load(true); });

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
/** 翻页失败后的重试入口：清掉错误态再补当前页，不清空已加载内容。 */
function retryLoadMore() {
  if (loading.value || loadingMore.value) return;
  error.value = '';
  void load(false);
}

const mobileRefreshBusy = computed(() => loading.value || loadingMore.value);
async function refreshMobilePage() { await load(true); }
</script>

<style scoped>
.page-container { width: 100%; height: 100%; overflow-y: auto; padding: var(--space-5); box-sizing: border-box; }
.page-container.is-embedded { height: auto; overflow: visible; padding: 0; }
.page-header { margin-bottom: var(--space-5); }
.header-main { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
.header-titles { display: flex; flex-direction: column; gap: 4px; }
.page-title { margin: 0; display: flex; align-items: center; gap: var(--space-3); color: var(--text-primary); font-size: var(--font-size-title-lg); }
.page-title .icon { color: var(--brand-primary); }
.page-subtitle { color: var(--text-tertiary); font-size: var(--font-size-sub); }
.empty-wrapper { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); padding: var(--space-10) 0; }
.entity-list { width: min(100%, 760px); margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-2); }
.entity-row { display: flex; align-items: center; gap: var(--space-3); min-height: 68px; padding: var(--space-3) var(--space-4); color: var(--text-primary); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); text-align: left; cursor: pointer; }
.entity-row:hover { border-color: var(--brand-primary); background: var(--surface-hover); }
.entity-row:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 2px; }
.entity-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.entity-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entity-main small { color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-arrow { color: var(--text-tertiary); }
.row-action { padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-control); color: var(--brand-primary); background: transparent; cursor: pointer; }
.row-action:hover { background: var(--brand-soft); }
.row-action:disabled { opacity: 0.6; cursor: wait; }
.feed-list { width: min(100%, var(--feed-max-width)); margin: 0 auto; }
.pagination-footer { padding: var(--space-5); text-align: center; color: var(--text-tertiary); font-size: var(--font-size-caption); }
.retry-inline { border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; font-size: var(--font-size-caption); }
</style>
