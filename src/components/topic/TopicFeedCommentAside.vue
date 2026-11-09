<template>
  <aside class="topic-feed-comment-aside">
    <!-- 顶部状态栏 -->
    <div class="aside-header">
      <div v-if="feed" class="active-feed-brief">
        <UserHoverCard
          :uid="authorUid"
          :avatar="effectiveAvatar"
          :username="authorName"
          :level="authorLevel"
          :verify-title="authorVerifyTitle"
          :device="deviceTitle"
        >
          <div class="author-avatar-wrap clickable" @click.stop="handleUserClick">
            <AppAvatar
              :src="effectiveAvatar"
              :plugin-url="effectivePluginUrl"
              :size="32"
            />
          </div>
        </UserHoverCard>

        <div class="author-info">
          <div class="author-row">
            <UserHoverCard
              :uid="authorUid"
              :avatar="effectiveAvatar"
              :username="authorName"
              :level="authorLevel"
              :verify-title="authorVerifyTitle"
              :device="deviceTitle"
            >
              <span class="author-name clickable" @click.stop="handleUserClick">{{ authorName }}</span>
            </UserHoverCard>
            <span v-if="authorLevel" class="author-level">Lv.{{ authorLevel }}</span>
            <span v-if="authorVerifyTitle" class="author-verify-badge" :title="authorVerifyTitle">
              <i class="fas fa-check-circle"></i>
            </span>
          </div>
          <div class="author-sub-meta">
            <span class="feed-time">{{ formattedFeedTime }}</span>
            <span v-if="deviceTitle" class="feed-device" :title="deviceTitle">
              <i class="fas fa-mobile-alt device-icon"></i>
              <span>{{ displayDeviceName(deviceTitle) }}</span>
            </span>
          </div>
        </div>
      </div>
      <div v-else class="aside-title">
        <i class="fas fa-comments text-brand"></i>
        <span>评论互动</span>
      </div>

      <button
        type="button"
        class="btn-close-aside"
        title="关闭/折叠评论区"
        @click="$emit('close')"
      >
        <i class="fas fa-times"></i>
      </button>
    </div>

    <!-- 评论内容区 -->
    <div class="aside-content custom-scrollbar">
      <div v-if="feed" class="feed-comment-container">
        <FeedCommentSection
          aside-layout
          :feed-id="feed.id"
          :default-sort-mode="commentsSortMode"
          :feed-uid="authorUid"
          :feed-username="authorName"
          :total-comment-count="commentCount"
          :comments="comments"
          :loading="loading"
          :error="error"
          :has-more-comments="hasMoreComments"
          :loading-more-comments="commentsLoadingMore"
          :load-more-error="commentsLoadMoreError"
          @send-comment="handleSendComment"
          @comment-created="handleCommentCreated"
          @retry-comments="loadComments(true)"
          @load-more-comments="loadMoreComments"
          @retry-more-comments="loadMoreComments"
          @comment-sort-change="handleCommentSortChange"
          @delete-comment="handleDeleteComment"
        />
      </div>
      <div v-else class="aside-empty-placeholder">
        <i class="far fa-comment-dots empty-icon"></i>
        <p class="empty-title">点击中间动态查看评论</p>
        <p class="empty-desc">在中间选择一条动态，即可在此快速浏览楼层讨论并发表回复</p>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useDeviceModelNames } from '../../utils/deviceModelNames';

const displayDeviceName = useDeviceModelNames();
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../../api/coolapk';
import FeedCommentSection from '../feed/FeedCommentSection.vue';
import AppAvatar from '../common/AppAvatar.vue';
import UserHoverCard from '../user/UserHoverCard.vue';
import { getUserUid, normalizeUserUid } from '../../utils/userRoute';
import {
  getCommentReplyRequestOptions,
  getExpectedCommentCount,
  // 复用 commentList 的统一标识：楼中楼/游标/合并共用同一优先级，避免宿主各自实现互相矛盾
  getReplyEntityId as commentRowId,
  getReplyData,
  getReplyPageCursor,
  hasMoreReplyPages,
  mergeReplies,
  type CommentSortMode,
  type CommentSortSelection,
} from '../../utils/commentList';
import {
  preloadUserProfile,
  reactiveUserProfileMap,
  getCachedUserProfileSync,
} from '../../utils/userProfilePreloader';
import { useSettingsStore } from '../../stores/settings';

const props = defineProps<{
  feed?: any;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const router = useRouter();
const settingsStore = useSettingsStore();
const comments = ref<any[]>([]);
const loading = ref(false);
const error = ref('');
const commentsPage = ref(0);
const hasMoreComments = ref(false);
const commentsLoadingMore = ref(false);
const commentsLoadMoreError = ref('');
const commentsSortMode = ref<CommentSortMode>(settingsStore.settings.commentDefaultSortMode);
const commentsAuthorOnly = ref(false);
let commentsFirstItem = '';
let commentsLastItem = '';
let commentsRequestVersion = 0;

const authorUid = computed(() => {
  if (!props.feed) return '';
  return getUserUid(props.feed);
});

const currentUid = computed(() => normalizeUserUid(authorUid.value));

const preloadedProfile = computed(() => {
  if (!currentUid.value) return null;
  return reactiveUserProfileMap[currentUid.value] || getCachedUserProfileSync(currentUid.value);
});

watch(currentUid, (newUid) => {
  if (newUid) {
    preloadUserProfile(newUid);
  }
}, { immediate: true });

// 动态详情有时只带用户 ID，头像需要从预加载的用户资料补齐。
// 不能把 feed.pic 当作头像：它是动态正文配图，失败时会直接显示破图。
const effectiveAvatar = computed(() => {
  if (!props.feed) return '';
  const feed = props.feed;
  const p = preloadedProfile.value;
  const candidates = [
    feed.userAvatar,
    feed.avatar,
    feed.user_avatar,
    feed.userBigAvatar,
    feed.userSmallAvatar,
    feed.userInfo?.userAvatar,
    feed.userInfo?.avatar,
    feed.userInfo?.user_avatar,
    feed.userInfo?.userBigAvatar,
    feed.userInfo?.userSmallAvatar,
    p?.userAvatar,
    p?.avatar,
    p?.user_avatar,
    p?.userBigAvatar,
    p?.userSmallAvatar,
    p?.userInfo?.userAvatar,
    p?.userInfo?.avatar,
    p?.userInfo?.user_avatar,
    p?.userInfo?.userBigAvatar,
    p?.userInfo?.userSmallAvatar,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return value ? String(value).trim() : '';
});

// 头像挂件（支持原生字段与预加载自动补全）
const effectivePluginUrl = computed(() => {
  if (!props.feed) return '';
  const feed = props.feed;
  const direct =
    feed.avatar_plugin_url ||
    feed.userInfo?.avatar_plugin_url ||
    feed.userAvatarPluginUrl;
  if (direct && String(direct).trim()) return String(direct).trim();
  const p = preloadedProfile.value;
  return p?.avatar_plugin_url || p?.userInfo?.avatar_plugin_url || p?.userAvatarPluginUrl || '';
});

const authorName = computed(() => {
  if (!props.feed) return '';
  return props.feed.username || props.feed.userInfo?.username || preloadedProfile.value?.username || '酷友';
});

const authorLevel = computed(() => {
  if (!props.feed) return 0;
  return Number(props.feed.userInfo?.level || props.feed.userLevel || preloadedProfile.value?.level || 0);
});

const authorVerifyTitle = computed(() => {
  if (!props.feed) return '';
  return props.feed.userInfo?.verify_title || props.feed.verify_title || preloadedProfile.value?.verify_title || '';
});

function handleUserClick() {
  if (currentUid.value && router) {
    router.push(`/user/${currentUid.value}`);
  }
}

const deviceTitle = computed(() => {
  if (!props.feed) return '';
  return props.feed.device_title || props.feed.device || props.feed.device_name || '';
});

const formattedFeedTime = computed(() => {
  if (!props.feed) return '';
  const raw = props.feed.dateline || props.feed.infoHtml || props.feed.created_at || '';
  return formatDateline(raw);
});

function formatDateline(time?: number | string): string {
  if (!time) return '刚刚';
  const timestamp = normalizeTimestamp(time);
  if (timestamp === null) return String(time);
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
  const date = new Date(timestamp * 1000);
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

function normalizeTimestamp(value: number | string): number | null {
  const timestamp = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  if (timestamp >= 1_000_000_000_000) return timestamp / 1000;
  if (timestamp >= 10_000_000_000) return timestamp / 10;
  return timestamp;
}

const commentCount = computed(() => {
  if (!props.feed) return 0;
  return props.feed.replynum || props.feed.commentnum || 0;
});

function isCurrentCommentRequest(requestedFeedId: string, currentRequest: number): boolean {
  return currentRequest === commentsRequestVersion
    && requestedFeedId === String(props.feed?.id || '');
}

/** 发表评论成功后本地累加计数，标题立即一致，不再整页重拉评论列表。 */
function handleSendComment() {
  if (!props.feed) return;
  props.feed.replynum = Math.max(0, Number(props.feed.replynum || props.feed.commentnum) || 0) + 1;
}

/** 合并后续页时按 id 去重：本地插入的评论可能又出现在服务端回包里。 */
function dedupeCommentsById(list: any[]): any[] {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const item of list) {
    const id = commentRowId(item);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    result.push(item);
  }
  return result;
}

/**
 * 就地插入接口返回的新评论，保留已加载的分页和滚动位置。
 * 楼中楼回复（payload.replyId 有值）的楼层由 FeedCommentSection 自己补齐，这里不再插入主列表。
 */
function handleCommentCreated(payload: { comment?: any; replyId?: string } = {}) {
  if (payload?.replyId) return;
  const raw = payload?.comment;
  const row = Array.isArray(raw) ? raw[0] : raw;
  const id = row && typeof row === 'object' ? commentRowId(row) : '';
  if (!row || typeof row !== 'object' || !id) return;
  if (comments.value.some((c: any) => commentRowId(c) === id)) return;
  comments.value = [row, ...comments.value];
  // 分页游标仍由服务端已加载页的首尾 ID 维护，本地插入不参与。
}

function updateCommentCursor(pageReplies: any[], resetFirst = false) {
  const cursor = getReplyPageCursor(pageReplies);
  if (resetFirst || !commentsFirstItem) commentsFirstItem = cursor.firstItem;
  if (cursor.lastItem) commentsLastItem = cursor.lastItem;
}

async function loadMoreComments() {
  if (!hasMoreComments.value || loading.value || commentsLoadingMore.value) return;
  const requestedFeedId = String(props.feed?.id || '');
  if (!requestedFeedId) return;

  const currentRequest = commentsRequestVersion;
  const page = commentsPage.value + 1;
  commentsLoadingMore.value = true;
  commentsLoadMoreError.value = '';
  try {
    const pageReplies = getReplyData(await CoolapkTauriAPI.getFeedReplies(requestedFeedId, page, {
      ...getCommentReplyRequestOptions(commentsSortMode.value, commentsAuthorOnly.value),
      firstItem: commentsFirstItem,
      lastItem: commentsLastItem,
    }));
    if (!isCurrentCommentRequest(requestedFeedId, currentRequest)) return;
    updateCommentCursor(pageReplies);
    const previousReplies = comments.value;
    // 后续页回包可能带上刚就地插入的新评论，按 id 去重避免重复显示。
    const mergedReplies = dedupeCommentsById(mergeReplies(previousReplies, pageReplies));
    if (mergedReplies.length > previousReplies.length) {
      comments.value = mergedReplies;
      commentsPage.value = page;
    }
    hasMoreComments.value = hasMoreReplyPages(
      pageReplies,
      previousReplies,
      mergedReplies,
      getExpectedCommentCount(commentCount.value),
    );
  } catch (err: any) {
    if (isCurrentCommentRequest(requestedFeedId, currentRequest)) {
      commentsLoadMoreError.value = err?.message || '获取更多评论失败';
    }
  } finally {
    if (isCurrentCommentRequest(requestedFeedId, currentRequest)) {
      commentsLoadingMore.value = false;
    }
  }
}

async function loadComments(force = false) {
  if (!force && (loading.value || commentsLoadingMore.value || commentsPage.value > 0)) return;
  if (!props.feed || !props.feed.id) {
    commentsRequestVersion += 1;
    comments.value = [];
    commentsPage.value = 0;
    hasMoreComments.value = false;
    commentsFirstItem = '';
    commentsLastItem = '';
    return;
  }

  const requestedFeedId = String(props.feed.id);
  const currentRequest = ++commentsRequestVersion;
  if (force) comments.value = [];
  commentsPage.value = 0;
  hasMoreComments.value = false;
  commentsFirstItem = '';
  commentsLastItem = '';
  commentsLoadMoreError.value = '';
  loading.value = true;
  error.value = '';
  try {
    const pageReplies = getReplyData(await CoolapkTauriAPI.getFeedReplies(requestedFeedId, 1, {
      ...getCommentReplyRequestOptions(commentsSortMode.value, commentsAuthorOnly.value),
    }));
    if (!isCurrentCommentRequest(requestedFeedId, currentRequest)) return;
    updateCommentCursor(pageReplies, true);
    comments.value = pageReplies;
    commentsPage.value = pageReplies.length > 0 ? 1 : 0;
    hasMoreComments.value = hasMoreReplyPages(
      pageReplies,
      [],
      pageReplies,
      getExpectedCommentCount(commentCount.value),
    );
    loading.value = false;
    if (hasMoreComments.value) void loadMoreComments();
  } catch (err: any) {
    if (isCurrentCommentRequest(requestedFeedId, currentRequest)) {
      error.value = err?.message || '获取评论列表失败';
    }
  } finally {
    if (isCurrentCommentRequest(requestedFeedId, currentRequest)) loading.value = false;
  }
}

function handleCommentSortChange(selection: CommentSortSelection) {
  commentsSortMode.value = selection.mode;
  commentsAuthorOnly.value = selection.authorOnly;
  void loadComments(true);
}

watch(() => settingsStore.settings.commentDefaultSortMode, (sortMode) => {
  commentsSortMode.value = sortMode;
  commentsAuthorOnly.value = false;
  if (props.feed?.id) void loadComments(true);
});

function handleDeleteComment(commentId: string | number) {
  comments.value = comments.value.filter((c) => String(c.id) !== String(commentId));
}

watch(
  () => props.feed?.id,
  (newId) => {
    if (newId) {
      void loadComments(true);
    } else {
      commentsRequestVersion += 1;
      comments.value = [];
      commentsPage.value = 0;
      hasMoreComments.value = false;
      commentsFirstItem = '';
      commentsLastItem = '';
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.topic-feed-comment-aside {
  width: 380px;
  flex: 0 0 380px;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--surface);
  border-left: 1px solid var(--border-light, rgba(0, 0, 0, 0.08));
  overflow: hidden;
  animation: slideInRight 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.aside-header {
  height: 52px;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
}

.active-feed-brief {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.author-avatar-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.author-avatar-wrap.clickable {
  cursor: pointer;
}

.author-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.author-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.author-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.author-name.clickable {
  cursor: pointer;
  transition: color 0.15s ease;
}

.author-name.clickable:hover {
  color: var(--brand-primary, #10b981);
}

.author-verify-badge {
  font-size: 11px;
  color: #ff9800;
  display: inline-flex;
  align-items: center;
}

.author-level {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.12);
  color: var(--brand-primary, #10b981);
  line-height: 1.2;
}

.author-sub-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.feed-device {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-tertiary);
}

.device-icon {
  font-size: 9px;
}

.aside-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.btn-close-aside {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.btn-close-aside:hover {
  background: var(--background-secondary);
  color: var(--text-primary);
}

.aside-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.feed-comment-container {
  flex: 1;
  padding: 12px 16px 24px;
}

.aside-empty-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  text-align: center;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 42px;
  color: var(--text-tertiary);
  margin-bottom: 16px;
  opacity: 0.6;
}

.empty-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.empty-desc {
  font-size: 12px;
  line-height: 1.6;
  max-width: 260px;
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
