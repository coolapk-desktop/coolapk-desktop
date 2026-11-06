<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy }" ref="pageContainerRef" class="page-container custom-scrollbar" @scroll.passive="handlePageScroll">
    <div class="page-header">
      <div class="notification-title-row">
        <div class="notification-heading" :class="{ 'notification-tab-heading': !subNoteType }">
          <button type="button" class="header-action-btn" :aria-label="isNotificationRoot ? '返回' : '返回通知中心'" @click="goBack"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>
          <h2 class="page-title">{{ currentTabTitle }}</h2>
        </div>
        <div v-if="isNotificationRoot" class="notification-actions">
          <button type="button" class="header-action-btn" aria-label="全部已读" title="全部已读" :disabled="!authStore.isLoggedIn || clearingNotifications || deletingNotifications" @click="markAllViewed"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19,4C19,4.17 18.96,4.34 18.87,4.49L9.87,20.49C9.6,20.97 8.99,21.14 8.51,20.87C8.39,20.8 8.28,20.71 8.2,20.6L2.2,12.6C2.07,12.43 2,12.22 2,12C2,11.45 2.45,11 3,11C3.31,11 3.61,11.15 3.8,11.4L8.88,18.17L17.13,3.51C17.31,3.2 17.64,3 18,3C18.55,3 19,3.45 19,4ZM18,11C17.45,11 17,11.45 17,12C17,12.55 17.45,13 18,13L21,13C21.55,13 22,12.55 22,12C22,11.45 21.55,11 21,11L18,11ZM16,15C15.45,15 15,15.45 15,16C15,16.55 15.45,17 16,17L21,17C21.55,17 22,16.55 22,16C22,15.45 21.55,15 21,15L16,15ZM14,19C13.45,19 13,19.45 13,20C13,20.55 13.45,21 14,21L21,21C21.55,21 22,20.55 22,20C22,19.45 21.55,19 21,19L14,19Z" /></svg></button>
          <button type="button" class="header-action-btn notification-mobile-delete" aria-label="全部删除" title="全部删除" :disabled="!authStore.isLoggedIn || clearingNotifications || deletingNotifications" @click="deleteAllNotifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9,3V4H4V6H5V19A2,2 0,0 0,7 21H17A2,2 0,0 0,19 19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z" /></svg></button>
          <details ref="desktopActions" class="notification-desktop-actions" @focusout="closeDesktopActionsOnBlur" @keydown.esc.stop="closeDesktopActions">
            <summary class="header-action-btn" aria-label="更多操作" title="更多操作"><i class="fas fa-ellipsis" aria-hidden="true"></i></summary>
            <button type="button" class="notification-menu-delete" :disabled="!authStore.isLoggedIn || clearingNotifications || deletingNotifications" @click="closeDesktopActions(); deleteAllNotifications()">全部删除</button>
          </details>
        </div>
      </div>
      <nav v-if="!subNoteType" class="notification-quick-nav" :class="{ 'notification-nav-desktop-only': !isNotificationRoot }" aria-label="通知分类">
        <button type="button" class="quick-nav-btn notification-list-tab" :aria-current="currentTab === 'list' ? 'page' : undefined" @click="switchTab('list')">通知</button>
        <button v-for="entry in quickEntries" :key="entry.value" type="button" :class="['quick-nav-btn', entry.countKey]" :aria-current="currentTab === entry.value ? 'page' : undefined" @click="entry.value === 'messages' ? router.push('/messages') : switchTab(entry.value)">
          <span class="quick-nav-icon">
            <i v-if="entry.countKey === 'like'" class="fas fa-thumbs-up" aria-hidden="true"></i>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path :d="entry.path" /></svg>
          </span>
          {{ entry.label }}
          <span v-if="notificationStore.categoryCounts[entry.countKey] > 0" class="quick-nav-badge">{{ notificationStore.categoryCounts[entry.countKey] > 99 ? '99+' : notificationStore.categoryCounts[entry.countKey] }}</span>
        </button>
      </nav>
    </div>


    <div class="content-wrapper">
      <div v-if="!authStore.isLoggedIn" class="empty-wrapper">
        <EmptyState title="登录后查看通知" description="登录酷安账号后，可在这里查看评论回复、@ 提及、收到的赞和新关注提醒" />
        <div class="notification-login-hint">
          <AppButton variant="primary" size="sm" @click="authStore.openLoginModal()">立即登录</AppButton>
        </div>
      </div>

      <div v-else-if="loading && items.length === 0" class="loading-wrapper">
        <LoadingState text="正在获取通知..." />
      </div>

      <div v-else-if="notificationError && items.length === 0" class="empty-wrapper">
        <ErrorState title="通知加载失败" :message="notificationError" @retry="refreshNotifications" />
      </div>

      <div v-else-if="!loading && items.length === 0" class="empty-wrapper">
        <EmptyState title="暂无通知" description="当有新动态时会在这里提醒你" />
      </div>

      <div v-else class="notification-list">
        <div v-for="{ item, target, actionKey } in notificationCards" :key="getNotificationKey(item)" :class="['notify-card', { unread: isNotificationUnread(item) }]" @click="handleNotifyClick($event, item)">
          <button type="button" class="notify-avatar-wrap notify-profile" :disabled="!getActorUid(item)" :aria-label="`查看${getUsername(item)}的主页`" @click.stop="openActor(item)">
            <AppAvatar :src="getAvatar(item)" :size="40" />
          </button>
          <div class="notify-content">
            <div class="notify-body">
              <div class="notify-body-text">
                <div class="notify-header">
                  <button type="button" class="notify-user notify-profile" :disabled="!getActorUid(item)" @click.stop="openActor(item)">{{ getUsername(item) }}</button>
                  <span v-if="getNotificationUnreadCount(item) > 0" class="notify-unread-badge" aria-label="未读通知数">{{ getNotificationUnreadLabel(item) }}</span>
                  <span v-if="item.note_type_title || item.noteTypeTitle" class="notify-type">{{ item.note_type_title || item.noteTypeTitle }}</span>
                </div>
                <div v-if="getNote(item)" class="notify-action" v-html="renderNotificationText(getNote(item))"></div>
                <div v-if="getTarget(item)" class="notify-target" v-html="renderNotificationText(getTarget(item))"></div>
                <div v-if="getMessage(item)" class="notify-message" v-html="renderNotificationText(getMessage(item))"></div>
              </div>
              <button v-if="getNotificationImage(item)" type="button" class="notify-image" aria-label="查看通知图片" @click.stop="appStore.openImageViewer([getNotificationImage(item)], 0)">
                <AppImage :src="getNotificationImage(item)" alt="" />
              </button>
              <div v-else-if="getAdditionInfo(item)" class="notify-message notify-right-text" v-html="renderNotificationText(getAdditionInfo(item))"></div>
            </div>
            <div class="notify-meta" :class="{ 'with-actions': target }">
              <span class="notify-time">{{ formatTime(item.likeTime || item.dateline) }}</span>
              <div v-if="target" class="notify-row-actions">
                <button type="button" class="notify-row-action" :aria-pressed="likedTargets.get(actionKey) ?? target.liked" :aria-label="(likedTargets.get(actionKey) ?? target.liked) ? '取消点赞' : '点赞'" :title="(likedTargets.get(actionKey) ?? target.liked) ? '取消点赞' : '点赞'" :disabled="pendingLikes.has(actionKey)" @click.stop="toggleTargetLike(target, actionKey)">
                  <i :class="[(likedTargets.get(actionKey) ?? target.liked) ? 'fas' : 'far', 'fa-thumbs-up']" aria-hidden="true"></i>
                </button>
                <button type="button" class="notify-row-action" aria-label="回复" title="回复" :disabled="!!pendingReply" @click.stop="openReplyComposer(item, target)">
                  <i class="far fa-comment-dots" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="load-more-wrapper" v-if="items.length > 0">
          <div v-if="notificationError" class="notification-inline-error">{{ notificationError }} <button type="button" @click="refreshNotifications">重试</button></div>
          <button 
            v-if="hasMore" 
            class="load-more-btn" 
            @click="loadMore" 
            :disabled="loading"
          >
            {{ loading ? '加载中...' : '加载更多' }}
          </button>
          <div v-else class="no-more">
            — 到底了 —
          </div>
        </div>
      </div>
    </div>
    <FeedCommentSection
      v-if="replyComposer"
      :feed-id="replyComposer.feedId"
      :standalone-target="replyComposer"
      :official-detail="mobileReplyComposer"
      :comments="[]"
      @close-composer="closeReplyComposer"
      @send-comment="closeReplyComposer"
    />
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { formatCommentTime } from '../utils/commentList';
import { normalizeCoolapkRoute } from '../utils/coolapkRoute';
import { navigateBack } from '../utils/navigation';
import { loadFeedFullText } from '../utils/feedFullTextCache';
import { htmlToPlainText } from '../utils/htmlText';
import { routeNavigationIsHistory } from '../utils/routeScroll';
import { computed, nextTick, onActivated, onDeactivated, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import { useNotificationStore } from '../stores/notifications';
import type { NotificationCategory } from '../utils/notificationCount';
import { getNotificationActionTarget, getNotificationActor, getNotificationImage } from '../utils/notificationItem';
import { isCoarsePointer, isTouchMobilePlatform } from '../utils/platform';
import { renderCoolapkRichText, renderNotificationRichText } from '../utils/richText';
import { handleAnchorClick } from '../utils/anchorClick';
import { openFeedDetail } from '../utils/feedNavigation';
import { getNotificationExternalUrl, getNotificationFeedId, getNotificationReplyId, getNotificationProductName, resolveNotificationTargetRoute } from '../utils/notificationNavigation';
import { markNotificationRead } from '../utils/notificationRead';
import { requestConfirmation } from '../utils/confirm';
import { showToast } from '../utils/toast';
import AppButton from '../components/common/AppButton.vue';
import AppAvatar from '../components/common/AppAvatar.vue';
import AppImage from '../components/common/AppImage.vue';
import LoadingState from '../components/common/LoadingState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import FeedCommentSection from '../components/feed/FeedCommentSection.vue';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const appStore = useAppStore();
const notificationStore = useNotificationStore();

// 保留旧分类路由，通知中心使用官方的三个快捷入口。
const tabs: Array<{ label: string; value: string; countKey: NotificationCategory }> = [
  { label: '通知', value: 'list', countKey: 'notification' },
  { label: '收到的赞', value: 'feedLikeList', countKey: 'like' },
  { label: '好友关注', value: 'contactsFollowList', countKey: 'follow' }
];

const quickEntries = [
  { label: '点赞', value: 'feedLikeList', countKey: 'like' },
  { label: '关注', value: 'contactsFollowList', countKey: 'follow', path: 'M17 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM3 18a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z' },
  { label: '私信', value: 'messages', countKey: 'message', path: 'M20 8l-8 5-8-5V6l8 5 8-5ZM20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z' }
] as const;

const currentTab = ref('list');
const currentTabTitle = computed(() => currentTab.value === 'list' ? '通知' : tabs.find(tab => tab.value === currentTab.value)?.label);
const subNoteType = ref('');
const isNotificationRoot = computed(() => currentTab.value === 'list' && !subNoteType.value);
const loading = ref(false);
const clearingNotifications = ref(false);
const deletingNotifications = ref(false);
let notificationRequestId = 0;
const items = ref<any[]>([]);
const feedSummaries = ref(new Map<string, string>());
const page = ref(1);
const hasMore = ref(true);
const notificationError = ref('');
const desktopActions = ref<HTMLDetailsElement | null>(null);
type NotificationActionTarget = NonNullable<ReturnType<typeof getNotificationActionTarget>>;
const likedTargets = ref(new Map<string, boolean>());
const pendingLikes = ref(new Set<string>());
const pendingReply = ref<symbol>();
const replyComposer = ref<{ feedId: string; rid?: string; username: string }>();
const mobileReplyComposer = isTouchMobilePlatform() || isCoarsePointer();
const notificationCards = computed(() => items.value.map(item => {
  const target = currentTab.value === 'list' ? getNotificationActionTarget(item) : null;
  return { item, target, actionKey: target ? `${target.type}:${target.id}` : '' };
}));

async function toggleTargetLike(target: NotificationActionTarget, key: string) {
  const pending = pendingLikes.value;
  if (pending.has(key)) return;
  const previous = likedTargets.value.get(key);
  const liked = !(previous ?? target.liked);
  pending.add(key);
  likedTargets.value.set(key, liked);
  try {
    if (target.type === 'feed') {
      await (liked ? CoolapkTauriAPI.likeFeed(target.id) : CoolapkTauriAPI.unlikeFeed(target.id));
    } else {
      await (liked ? CoolapkTauriAPI.likeReply(target.id) : CoolapkTauriAPI.unlikeReply(target.id));
    }
  } catch (error) {
    if (pending !== pendingLikes.value) return;
    if (previous === undefined) likedTargets.value.delete(key);
    else likedTargets.value.set(key, previous);
    showToast(`${liked ? '点赞' : '取消点赞'}失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    pending.delete(key);
  }
}

async function openReplyComposer(item: any, target: NotificationActionTarget) {
  if (pendingReply.value || replyComposer.value) return;
  const request = Symbol();
  pendingReply.value = request;
  try {
    const rid = target.type === 'feed_reply' ? target.id : undefined;
    let feedId = rid ? getNotificationFeedId(item) : target.id;
    if (rid && !/^[1-9]\d*$/.test(feedId)) {
      const response = await CoolapkTauriAPI.getReplyDetail(rid);
      feedId = String(response?.data?.feedId || response?.data?.feed_id || '');
    }
    if (pendingReply.value !== request) return;
    if (!/^[1-9]\d*$/.test(feedId)) throw new Error('无法找到评论所属的动态');
    replyComposer.value = { feedId, rid, username: getUsername(item) };
  } catch (error) {
    if (pendingReply.value === request) {
      showToast(`打开回复失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  } finally {
    if (pendingReply.value === request) pendingReply.value = undefined;
  }
}

function closeReplyComposer() {
  pendingReply.value = undefined;
  replyComposer.value = undefined;
}

function closeDesktopActions() {
  const details = desktopActions.value;
  if (!details?.open) return;
  details.open = false;
  details.querySelector('summary')?.focus();
}

function closeDesktopActionsOnBlur(event: FocusEvent) {
  const details = desktopActions.value;
  if (details && !(event.relatedTarget instanceof Node && details.contains(event.relatedTarget))) details.open = false;
}

const pageContainerRef = ref<HTMLElement | null>(null);

/** 兼容旧入口，回复和两种 @ 均归入官方统一通知列表。 */
function normalizeNotificationTab(value: unknown): string {
  const tab = String(value || 'list');
  return ['feedLikeList', 'contactsFollowList'].includes(tab) ? tab : 'list';
}

function goBack() {
  if (subNoteType.value) void closeNotificationGroup();
  else if (currentTab.value !== 'list') void switchTab('list');
  else navigateBack(router);
}

async function closeNotificationGroup() {
  subNoteType.value = '';
  page.value = 1;
  items.value = [];
  hasMore.value = true;
  await fetchNotifications();
}

// 切换 Tab
async function switchTab(tabValue: string) {
  if (currentTab.value === tabValue && items.value.length > 0) {
    return;
  }
  closeReplyComposer();
  currentTab.value = tabValue;
  if (pageContainerRef.value) pageContainerRef.value.scrollTop = 0;
  subNoteType.value = '';
  page.value = 1;
  items.value = [];
  hasMore.value = true;
  await fetchNotifications();
}

// 加载更多
async function loadMore() {
  if (loading.value || !hasMore.value) return;
  page.value += 1;
  await fetchNotifications();
}

/**
 * 通知页使用自身作为纵向滚动容器，不能依赖 window 的 scroll 事件。
 * 距离底部不足一张卡片高度时提前预取，按钮仍保留作键盘/兜底入口。
 */
function handlePageScroll(event: Event) {
  const container = event.currentTarget as HTMLElement | null;
  loadMoreWhenNearBottom(container);
}

function loadMoreWhenNearBottom(container = pageContainerRef.value) {
  if (!container || loading.value || !hasMore.value) return;
  const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (remaining <= 240) void loadMore();
}

// 获取数据
async function fetchNotifications(): Promise<boolean> {
  const requestId = ++notificationRequestId;
  const requestedTab = currentTab.value;
  const requestedPage = page.value;
  const requestedUid = authStore.user?.uid;
  if (!authStore.isLoggedIn) {
    items.value = [];
    page.value = 1;
    hasMore.value = false;
    notificationError.value = '';
    return false;
  }
  loading.value = true;
  notificationError.value = '';
  let fetchSucceeded = false;
  try {
    const firstItem = requestedPage > 1 ? String(items.value[0]?.id || '') : '';
    const lastItem = requestedPage > 1 ? String(items.value[items.value.length - 1]?.id || '') : '';
    const res = await CoolapkTauriAPI.getNotifications(subNoteType.value ? 'subList' : requestedTab, requestedPage, firstItem, lastItem, subNoteType.value);
    // 分类切换后丢弃旧请求，避免旧分类响应标记新分类已读。
    if (requestId !== notificationRequestId || requestedUid !== authStore.user?.uid) return false;
    if (!authStore.isLoggedIn) {
      items.value = [];
      page.value = 1;
      hasMore.value = false;
      return false;
    }
    const data = res?.data || [];
    
    if (Array.isArray(data)) {
      // 与官方一致，采用第一份完整 NotifyCount，不能把多个响应的字段取最大值再拼接。
      notificationStore.applyNotifyCount(res);

      if (data.length === 0) {
        hasMore.value = false;
      } else {
        if (page.value === 1) {
          items.value = data;
        } else {
          items.value = [...items.value, ...data];
        }
      }
      loadNotificationFeedSummaries(data);
      // 官方仅在点赞、关注首屏成功后清除该分类，普通通知保留逐条未读。
      if (page.value === 1 && ['like', 'follow'].includes(getCurrentCategory())) markCurrentTabViewed();
      fetchSucceeded = true;
    } else {
      hasMore.value = false;
      fetchSucceeded = true;
    }
  } catch (err) {
    if (requestId !== notificationRequestId) return false;
    console.warn('Notifications fetch warning', err);
    notificationError.value = err instanceof Error ? err.message : String(err);
    // 请求失败时禁止 finally 里的自动 loadMore，否则会在无登录/网络错误时无限重试。
    hasMore.value = false;
    if (page.value > 1) page.value -= 1;
  } finally {
    if (requestId === notificationRequestId) loading.value = false;
    if (fetchSucceeded && requestId === notificationRequestId) {
      // “@ 提及”等分类可能只有一两条，首屏没有滚动条时不会触发 scroll。
      // DOM 更新后检查一次并继续加载，直到内容足以滚动或接口明确到底。
      await nextTick();
      loadMoreWhenNearBottom();
    }
  }
  return fetchSucceeded;
}

async function refreshNotifications(): Promise<boolean> {
  if (loading.value) return false;
  page.value = 1;
  hasMore.value = true;
  return await fetchNotifications();
}

function handleNotificationCountIncrease() {
  void refreshNotifications();
}

// 数据提取工具函数，容错处理（兼容不同通知类型字段：
// 通用 userInfo / 关注类 fromUserInfo / 点赞类 likeUserInfo / 私信类 messageUserInfo）
function getAvatar(item: any): string {
  return getNotificationActor(item, getCurrentCategory()).avatar
    || item.messageUserInfo?.userAvatar
    || '';
}

function getUsername(item: any): string {
  const actor = getNotificationActor(item, getCurrentCategory());
  return actor.username === '酷友'
    ? item.messageUserInfo?.username || '匿名用户'
    : actor.username;
}

/** 人物入口使用发起通知的用户，系统通知不生成无效主页。 */
function getActorUid(item: any): string {
  const value = getCurrentCategory() === 'like'
    ? item.likeUid || item.like_uid || item.likeUserInfo?.uid
    : item.fromuid || item.from_uid || item.fromUserInfo?.uid || item.uid || item.userInfo?.uid || item.messageUserInfo?.uid;
  const uid = String(value || '');
  return /^[1-9]\d*$/.test(uid) && getUsername(item) !== '系统消息' ? uid : '';
}

function openActor(item: any) {
  const uid = getActorUid(item);
  if (uid) void router.push(`/user/${uid}`);
}

function getNote(item: any): string {
  if (currentTab.value === 'feedLikeList') {
    const target = htmlToPlainText(String(item.feedTypeName || item.infoHtml || '动态'))
      .trim();
    return `赞了你的${target}`;
  }
  return item.note || item.message_title || item.feedInfo?.message_title || '';
}

function getMessage(item: any): string {
  if (getNotificationImage(item) || getAdditionInfo(item)) return '';
  // 提取具体评论或动态内容
  if (item.message) return item.message;
  if (item.replyRows && Array.isArray(item.replyRows) && item.replyRows[0]) {
    return item.replyRows[0].message || '';
  }
  if (item.feedInfo?.message) return item.feedInfo.message;
  if (item.targetRow?.message) return item.targetRow.message;
  return '';
}

function getAdditionInfo(item: any): string {
  // 官方右侧区域使用 addition_info，图片和富文本按同一字段择一显示。
  const text = item.addition_info || item.additionInfo;
  return typeof text === 'string' ? text.trim() : '';
}

function getTarget(item: any): string {
  return item.addition_sub_info || item.additionSubInfo || item.targetTitle || item.feedInfo?.message_title || item.feedInfo?.title || '';
}

function renderNotificationText(text: string): string {
  return renderNotificationRichText(text, feedId => feedSummaries.value.get(feedId));
}

function loadNotificationFeedSummaries(rows: any[]) {
  const summaries = feedSummaries.value;
  const requestSummary = (feedId: string) => {
    if (!summaries.has(feedId)) {
      // 同一列表只解析一次，失败时保留可点击的「【动态】」。
      summaries.set(feedId, '');
      void loadFeedFullText(feedId).then((message) => {
        const text = htmlToPlainText(message, true).replace(/\s+/g, ' ').trim();
        const characters = Array.from(text);
        summaries.set(feedId, characters.length > 48 ? characters.slice(0, 48).join('') + '…' : text);
      }).catch(() => {});
    }
    return undefined;
  };
  for (const item of rows) {
    const addition = getNotificationImage(item) ? '' : getAdditionInfo(item);
    for (const text of [getNote(item), getTarget(item), getMessage(item), addition]) {
      if (text) renderNotificationRichText(text, requestSummary);
    }
  }
}

async function resolveNotificationTarget(item: any): Promise<string | null> {
  return resolveNotificationTargetRoute(item, (name) => CoolapkTauriAPI.getProductDetailByName(name));
}

async function openNotificationComment(item: any, href?: string): Promise<boolean> {
  const replyId = getNotificationReplyId(item, href);
  if (!replyId) return false;
  let feedId = getNotificationFeedId(item);
  if (!feedId) {
    try {
      const response = await CoolapkTauriAPI.getReplyDetail(replyId);
      feedId = String(response?.data?.feedId || response?.data?.feed_id || '');
    } catch {
      return false;
    }
  }
  if (!/^\d+$/.test(feedId)) return false;
  openFeedDetail(router, feedId, item, replyId);
  return true;
}

async function openNotificationTarget(item: any): Promise<boolean> {
  const externalUrl = getNotificationExternalUrl(item);
  if (externalUrl) {
    void CoolapkTauriAPI.openUrl(externalUrl);
    return true;
  }
  if (await openNotificationComment(item)) return true;
  const feedId = getNotificationFeedId(item);
  if (feedId) {
    openFeedDetail(router, feedId, item);
    return true;
  }
  const targetRoute = await resolveNotificationTarget(item);
  if (!targetRoute) {
    return false;
  }
  void router.push(targetRoute);
  return true;
}

function formatTime(value: number | string | undefined): string {
  return formatCommentTime({ dateline: value }) || String(value || '');
}

function getCurrentCategory(): NotificationCategory {
  return tabs.find((tab) => tab.value === currentTab.value)?.countKey || 'notification';
}

function getNotificationKey(item: any): string {
  const category = currentTab.value;
  const stableId = item?.id ?? item?.entityId ?? item?.targetId;
  if (stableId !== undefined && stableId !== null && String(stableId).trim()) {
    return `${category}:${String(stableId)}`;
  }
  const actor = item?.fromuid ?? item?.uid ?? item?.likeUid ?? '';
  const timestamp = item?.dateline ?? item?.likeTime ?? item?.lastUpdate ?? '';
  const content = String(item?.note || item?.message || item?.targetTitle || '').slice(0, 80);
  return `${category}:${actor}:${timestamp}:${content}`;
}

function getNotificationUnreadCount(item: any): number {
  const count = Number(item?.unread_count ?? item?.unreadCount);
  if (Number.isFinite(count) && count > 0) return Math.floor(count);
  return Number(item?.isnew ?? item?.isNew ?? 0) > 0 ? 1 : 0;
}

function getNotificationUnreadLabel(item: any): string {
  const count = getNotificationUnreadCount(item);
  return count > 99 ? '99+' : String(count);
}

function isNotificationUnread(item: any): boolean {
  return getNotificationUnreadCount(item) > 0;
}

function markCurrentTabViewed(): number {
  const category = getCurrentCategory();
  const viewedCount = notificationStore.markCategoryViewed(category);
  // 分类计数为零时不从总数猜测扣减，避免吞掉其他尚未查看的通知。
  for (const item of items.value) item.isnew = item.isNew = item.unread_count = item.unreadCount = 0;
  return viewedCount;
}

/** 全部已读与官方一致包含私信，必须由用户确认后才发送请求。 */
async function markAllViewed(): Promise<void> {
  if (clearingNotifications.value || deletingNotifications.value || !authStore.isLoggedIn) return;
  const accountUid = authStore.user?.uid;
  clearingNotifications.value = true;
  try {
    if (!await requestConfirmation({ title: '设为全部已读', message: '将点赞、关注、私信、回复、@、系统消息、活动消息的未读通知设为已读，该操作不可恢复，确定要操作吗？' })) return;
    if (!authStore.isLoggedIn || authStore.user?.uid !== accountUid) return;
    notificationStore.beginNotificationClear();
    await CoolapkTauriAPI.clearNotificationCount('all');
    if (!authStore.isLoggedIn || authStore.user?.uid !== accountUid) return;
    // 清除前发出的列表响应不能再把旧未读标记写回页面。
    notificationRequestId += 1;
    loading.value = false;
    notificationStore.markNotificationsCleared(true);
    for (const item of items.value) item.isnew = item.isNew = item.unread_count = item.unreadCount = 0;
  } catch (error) {
    showToast(`设置全部已读失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally { clearingNotifications.value = false; }
}

/** 官方批量删除只清理通知列表，成功后从服务端重新加载列表和计数。 */
async function deleteAllNotifications(): Promise<void> {
  if (deletingNotifications.value || clearingNotifications.value || !authStore.isLoggedIn) return;
  const accountUid = authStore.user?.uid;
  deletingNotifications.value = true;
  try {
    if (!await requestConfirmation({ title: '清除通知', message: '确定删除所有通知内容？（不包含点赞、关注、私信内容）' })) return;
    if (!authStore.isLoggedIn || authStore.user?.uid !== accountUid) return;
    await CoolapkTauriAPI.deleteAllNotifications();
    if (!authStore.isLoggedIn || authStore.user?.uid !== accountUid) return;
    // 让删除前发出的列表和角标请求失效，保留其他分类的计数。
    notificationStore.beginNotificationClear();
    const stateVersion = notificationStore.notificationStateVersion;
    items.value = [];
    page.value = 1;
    hasMore.value = true;
    const [, count] = await Promise.allSettled([fetchNotifications(), CoolapkTauriAPI.getNotificationCount()]);
    if (count.status === 'fulfilled' && count.value && authStore.user?.uid === accountUid && stateVersion === notificationStore.notificationStateVersion) {
      notificationStore.applyServerResponse(count.value);
    }
  } catch (error) {
    showToast(`删除通知失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    deletingNotifications.value = false;
  }
}

function renderSafeHtml(text: string): string {
  return renderCoolapkRichText(text);
}

// 通知内链接点击：动态链接携带通知上下文进入完整动态页，其余走统一处理。
async function handleNotifyClick(e: Event, item: any) {
  markNotificationRead(item, getCurrentCategory(), authStore.user?.uid);
  const anchor = (e.target as HTMLElement).closest('a');
  const href = anchor?.getAttribute('href') || '';
  // 正文链接始终由应用处理，危险协议不得继续触发浏览器默认导航。
  if (anchor) e.preventDefault();
  // 官方系统账号的聚合卡片打开 noteType 分组，而不是把聚合 ID 当动态或评论 ID。
  const fromUid = String(item.fromuid ?? item.from_uid ?? '');
  if (!anchor && !subNoteType.value && /^\d+$/.test(fromUid) && Number(fromUid) < 9999 && item.note_type) {
    subNoteType.value = String(item.note_type);
    page.value = 1;
    items.value = [];
    hasMore.value = true;
    await fetchNotifications();
    return;
  }
  // 正文链接只打开其自身；空白正文点击才进入通知所属动态和评论。
  if (!anchor?.href || !href || href === '#' || /^javascript:/i.test(href.trim())) {
    await openNotificationTarget(item);
    return;
  }
  // 使用链接自身的动态 ID，避免把所属通知的评论定位带到分享链接上。
  const feedRoute = normalizeCoolapkRoute(href);
  const linkedFeedId = feedRoute?.match(/^\/feed\/(\d+)(?:\?|$)/)?.[1];
  if (linkedFeedId) {
    openFeedDetail(router, linkedFeedId);
    return;
  }
  if (/(?:\/feed\/reply\/\d+|\/reply\/\d+)/i.test(href)) {
    handleAnchorClick(e);
    return;
  }
  const notification = {
    ...item,
    targetUrl: href,
    note: `${String(item?.note || '')} ${anchor.textContent || ''}`.trim(),
  };
  e.preventDefault();
  // 系统账号安全通知有时把“点击查看”渲染为普通 /u/:uid 链接。
  // 不能让该链接先走用户页路由，否则会落到“用户资料加载失败”。
  const externalUrl = getNotificationExternalUrl(notification);
  if (externalUrl) {
    void CoolapkTauriAPI.openUrl(externalUrl);
    return;
  }
  const targetRoute = await resolveNotificationTarget(notification);
  if (targetRoute) {
    void router.push(targetRoute);
    return;
  }
  if (!getNotificationProductName(notification)) handleAnchorClick(e);
}

onActivated(() => {
  // 主动打开通知应看到最新消息；浏览器后退仍保留先前阅读的位置。
  if (!routeNavigationIsHistory.value && pageContainerRef.value) pageContainerRef.value.scrollTop = 0;
  window.addEventListener('coolapk-notification-count-increased', handleNotificationCountIncrease);
  const requestedTab = normalizeNotificationTab(route.query.tab);
  subNoteType.value = typeof route.query.noteType === 'string' ? route.query.noteType : '';
  if (tabs.some((tab) => tab.value === requestedTab)) currentTab.value = requestedTab;
  if (!authStore.isLoggedIn) {
    items.value = [];
    page.value = 1;
    hasMore.value = false;
    notificationError.value = '';
    return;
  }
  void refreshNotifications();
});

onDeactivated(() => {
  closeReplyComposer();
  window.removeEventListener('coolapk-notification-count-increased', handleNotificationCountIncrease);
});

watch(
  () => route.query.tab,
  (tab) => {
    const requestedTab = normalizeNotificationTab(tab);
    if (tabs.some((item) => item.value === requestedTab)) void switchTab(requestedTab);
  }
);

watch(() => route.query.noteType, async noteType => {
  closeReplyComposer();
  subNoteType.value = typeof noteType === 'string' ? noteType : '';
  page.value = 1;
  items.value = [];
  hasMore.value = true;
  await fetchNotifications();
});

watch(
  () => [authStore.isLoggedIn, authStore.user?.uid] as const,
  ([isLoggedIn]) => {
    closeReplyComposer();
    likedTargets.value = new Map();
    pendingLikes.value = new Set();
    feedSummaries.value = new Map();
    notificationRequestId += 1;
    loading.value = false;
    page.value = 1;
    items.value = [];
    notificationError.value = '';
    hasMore.value = isLoggedIn;
    if (isLoggedIn) {
      void refreshNotifications();
    }
  }
);


// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => loading.value);
async function refreshMobilePage() { await refreshNotifications(); }
</script>

<style scoped>
.page-container {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  container: notification-page / inline-size;
  /* 全局字号只更新正文字号，通知的辅助文字从同一字号派生。 */
  --notification-font-secondary: calc(var(--font-size-body) - 1px);
  --notification-font-caption: max(11px, calc(var(--font-size-body) - 2px));
  padding: 0;
  margin: 0 auto;
  background-color: var(--background);
}

.page-header { display: contents; }

.notification-title-row {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--surface);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  padding-inline: max(4px, env(safe-area-inset-left)) max(4px, env(safe-area-inset-right));
}
.notification-heading, .notification-actions { display: flex; align-items: center; gap: 8px; }
.notification-heading { min-height: 56px; }
.notification-actions { grid-column: 2; grid-row: 1; }
.notification-desktop-actions { display: none; }
.page-title { margin: 0; color: var(--text-primary); font-size: calc(var(--font-size-body) + 4px); font-weight: 500; }
.header-action-btn { display: grid; place-items: center; width: 48px; height: 48px; padding: 0; color: var(--text-primary); background: transparent; border: 0; border-radius: 50%; cursor: pointer; }
.header-action-btn svg { width: 24px; height: 24px; fill: currentColor; }
.header-action-btn:hover:not(:disabled) { background: var(--background); }
.header-action-btn:disabled { color: var(--text-disabled); cursor: default; }

.notification-quick-nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 16px 24px; background: var(--surface); }
.quick-nav-btn { position: relative; display: grid; justify-items: center; gap: 8px; padding: 0; border: 0; background: transparent; color: var(--text-primary); font-size: var(--font-size-body); line-height: 1.45; cursor: pointer; }
.notification-list-tab, .notification-nav-desktop-only { display: none; }
.quick-nav-btn.like { --quick-tint: #f44336; }
.quick-nav-btn.follow { --quick-tint: #2196f3; }
.quick-nav-btn.message { --quick-tint: #ff9800; }
.quick-nav-icon { position: relative; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 14px; background: color-mix(in srgb, var(--quick-tint) 10%, transparent); color: var(--quick-tint); font-size: 26px; }
.quick-nav-icon svg { width: 28px; height: 28px; fill: currentColor; }
.quick-nav-badge, .notify-unread-badge { display: inline-grid; place-items: center; min-width: 16px; height: 16px; box-sizing: border-box; padding: 0 4px; border-radius: 999px; background: #f44336; color: #fff; font-size: 11px; line-height: 1; }
.quick-nav-badge { position: absolute; top: -8px; left: calc(50% + 19px); min-width: 17px; height: 17px; font-size: 12px; }

.content-wrapper { min-height: 200px; padding-bottom: var(--space-5); }

.loading-wrapper, .empty-wrapper {
  padding: var(--space-8) 0;
}

.notification-login-hint {
  display: flex;
  justify-content: center;
  margin-top: var(--space-3);
}

.notify-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px 5px;
  background: var(--surface);
}
.notify-card + .notify-card::before {
  position: absolute;
  top: 0;
  left: 68px;
  right: 16px;
  height: 1px;
  background: var(--border-light, var(--border));
  content: '';
}
.notify-avatar-wrap { flex: 0 0 40px; }
.notify-content { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.notify-body { display: flex; align-items: flex-start; gap: 12px; }
.notify-body-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.notify-image { flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 8px; overflow: hidden; cursor: pointer; background: var(--background-secondary); }
.notify-image :deep(.app-image-container) { width: 100%; height: 100%; }
.notify-header { display: flex; align-items: center; gap: 6px; min-width: 0; }
.notify-user, .notify-type { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.notify-user { color: var(--text-primary); font-size: var(--font-size-body); font-weight: 400; }
.notify-card.unread .notify-user { font-weight: 500; }
.notify-type, .notify-message { color: var(--text-secondary); font-size: var(--notification-font-secondary); }
.notify-unread-badge { flex-shrink: 0; }
.notify-action { color: var(--text-primary); font-size: var(--font-size-body); line-height: 1.45; cursor: pointer; }
.notify-target { border-left: 1px solid var(--border); padding-left: 6px; color: var(--text-secondary); font-size: var(--notification-font-caption); line-height: 1.4; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; }
.notify-right-text { flex: 0 0 44px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: max(10px, calc(var(--font-size-body) - 4px)); line-height: 1.3; }
.notify-content :deep(a) { color: var(--brand-primary); cursor: pointer; overflow-wrap: anywhere; }
.notify-profile { padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer; }
.notify-profile:disabled { cursor: default; }
.notify-meta { display: flex; align-items: center; min-height: 32px; }
.notify-meta.with-actions { justify-content: space-between; gap: 8px; }
.notify-row-actions { display: flex; align-items: center; gap: 2px; }
.notify-row-action { display: grid; place-items: center; width: 42px; height: 38px; padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-tertiary); font-size: 16px; cursor: pointer; }
.notify-row-action[aria-pressed="true"] { color: var(--brand-primary); }
.notify-row-action:hover:not(:disabled) { background: var(--background); }
.notify-row-action:disabled { cursor: default; opacity: 0.65; }
.notify-time { font-size: var(--notification-font-caption); color: var(--text-tertiary); }
.page-container :is(button, summary):focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 2px; }

.load-more-wrapper {
  display: flex;
  justify-content: center;
  padding: var(--space-4) 0;
}

.notification-inline-error { margin-bottom: var(--space-3); color: var(--danger); font-size: var(--notification-font-caption); }
.notification-inline-error button { margin-left: 6px; color: var(--brand-primary); background: transparent; border: 0; cursor: pointer; }

.load-more-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: var(--notification-font-secondary);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: all 0.2s;
}

.load-more-btn:hover:not(:disabled) {
  border-color: var(--brand-primary);
  color: var(--brand-primary);
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.no-more {
  color: var(--text-tertiary);
  font-size: var(--notification-font-caption);
}

/* 桌面卡片铺满内容区，工具栏按可用宽度切换布局。 */
@media (min-width: 721px) and (hover: hover) and (pointer: fine) {
  .content-wrapper { padding: 12px 16px var(--space-5); }
  .notification-list { display: grid; gap: 12px; }
  .notify-card {
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
  }
  .notify-card:hover, .notify-card:focus-within { border-color: var(--text-secondary); }
  .notify-card + .notify-card::before { content: none; }
  /* 桌面沿用旧版卡片的昵称、时间与正文排列。 */
  .notify-content { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; }
  .notify-body { display: contents; }
  .notify-body-text { display: contents; }
  .notify-header { grid-area: 1 / 1; }
  .notify-user { font-weight: var(--font-weight-semibold); }
  .notify-meta { grid-area: 1 / 2; min-height: 0; justify-self: end; white-space: nowrap; }
  .notify-row-action { width: 32px; height: 30px; }
  .notify-action, .notify-message, .notify-target { grid-column: 1; }
  .notify-target { order: 1; }
  .notify-image { grid-area: 2 / 2; justify-self: end; }
  .notify-right-text {
    grid-column: 1 / -1;
    order: 2;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--background);
    font-size: var(--notification-font-secondary);
    line-height: 1.45;
  }

  @container notification-page (min-width: 720px) {
    .page-header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 16px;
      padding-inline: 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border-light, var(--border));
    }
    .notification-title-row { display: contents; }
    .notification-tab-heading, .notification-mobile-delete, .quick-nav-icon { display: none; }
    .notification-actions { margin-inline-start: auto; gap: 2px; }
    .notification-heading { min-height: 52px; flex-shrink: 0; }
    .notification-quick-nav { grid-area: 1 / 1; display: flex; gap: 16px; padding: 0; }
    .quick-nav-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 48px;
      padding: 8px 6px;
      font-weight: 500;
      white-space: nowrap;
      font-size: var(--notification-font-secondary);
      color: var(--text-secondary);
    }
    .quick-nav-btn:hover, .quick-nav-btn[aria-current="page"] { color: var(--text-primary); }
    .quick-nav-btn[aria-current="page"] { font-weight: 700; }
    .quick-nav-btn[aria-current="page"]::after {
      content: '';
      position: absolute;
      bottom: 6px;
      left: 50%;
      translate: -50% 0;
      width: 22px;
      height: 3px;
      border-radius: var(--radius-full);
      background: var(--brand-primary);
    }
    .notification-menu-delete:hover:not(:disabled) { background: var(--background); }
    .quick-nav-badge { position: static; order: 1; }
    .header-action-btn { width: 36px; height: 36px; }
    .header-action-btn svg { width: 20px; height: 20px; }
    .notification-desktop-actions { display: block; position: relative; }
    .notification-desktop-actions summary { list-style: none; }
    .notification-desktop-actions summary::-webkit-details-marker { display: none; }
    .notification-menu-delete {
      position: absolute;
      inset-inline-end: 0;
      top: calc(100% + 4px);
      min-width: 112px;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--danger);
      font-size: var(--notification-font-secondary);
      cursor: pointer;
    }
    .notification-menu-delete:disabled { color: var(--text-disabled); cursor: default; }
  }
}

@media (max-width: 720px) {
  .empty-wrapper :deep(.error-state) {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .empty-wrapper :deep(.error-desc) {
    width: 100%;
    max-width: 100%;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .notification-inline-error {
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
}
</style>
