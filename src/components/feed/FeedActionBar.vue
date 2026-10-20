<template>
  <div class="feed-action-bar" :class="{ 'official-detail-actions': officialDetail, 'reading-hidden': officialDetail && detailActionsHidden }" :inert="officialDetail && detailActionsHidden || undefined" :aria-hidden="officialDetail && detailActionsHidden || undefined">
    <button v-if="officialDetail" class="official-write-comment" @click.stop="$emit('write-comment')"><OfficialDetailIcon name="write" />写评论</button>
    <div class="action-group">
      <button
        type="button"
        :class="['action-btn', 'like-btn', { 'is-liked': isLiked }]"
        title="点赞"
        :aria-label="`点赞，当前 ${formatCount(likeCount, '0')}`"
        @click.stop="toggleLike"
      >
        <OfficialDetailIcon v-if="officialDetail" name="like" :active="isLiked" class="action-icon" />
        <i v-else :class="[officialDetail ? (isLiked ? 'fas fa-thumbs-up' : 'far fa-thumbs-up') : (isLiked ? 'fas fa-heart' : 'far fa-heart'), 'action-icon']"></i>
        <span>{{ formatCount(likeCount, officialDetail ? (isLiked ? '已赞' : '点赞') : '') }}</span>
      </button>
    </div>

    <button class="action-btn comment-btn" @click.stop="$emit('open-comment')" title="评论">
      <OfficialDetailIcon v-if="officialDetail" name="comment" class="action-icon" />
      <i v-else class="far fa-comment action-icon"></i>
      <span>{{ officialDetail ? (formatCount(replyCount, '0')) : formatCount(replyCount) }}</span>
    </button>

    <div class="action-group">
      <button
        type="button"
        class="action-btn share-btn"
        title="转发"
        :aria-label="`转发，当前 ${formatCount(shareCount, '0')}`"
        @click.stop="shareFeed"
      >
        <OfficialDetailIcon v-if="officialDetail" name="share" class="action-icon" />
        <i v-else class="fas fa-retweet action-icon"></i>
        <span>{{ formatCount(shareCount, officialDetail ? '转发' : '') }}</span>
      </button>
    </div>

    <button :class="['action-btn', 'fav-btn', { 'is-fav': isFav }]" @click.stop="toggleFav" title="收藏">
      <OfficialDetailIcon v-if="officialDetail" name="favorite" :active="isFav" class="action-icon" />
      <i v-else :class="[officialDetail ? (isFav ? 'fas fa-star' : 'far fa-star') : (isFav ? 'fas fa-bookmark' : 'far fa-bookmark'), 'action-icon']"></i>
      <span>{{ formatCount(favnum, officialDetail ? (isFav ? '已收藏' : '收藏') : '') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { inject, ref, watch } from 'vue';
import { mobileDetailActionsHiddenKey } from '../../composables/useMobileReadingNavigation';
import OfficialDetailIcon from './OfficialDetailIcon.vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { useAuthStore } from '../../stores/auth';
import { showToast } from '../../utils/toast';
import { getErrorMessage } from '../../utils/errors';

const authStore = useAuthStore();
const detailActionsHidden = inject(mobileDetailActionsHiddenKey, ref(false));

const props = defineProps<{
  feedId: string | number;
  officialDetail?: boolean;
  likenum?: number;
  replynum?: number;
  favnum?: number;
  sharenum?: number;
  favorited?: boolean;
  userAction?: {
    like?: number;
    favorite?: number;
    collect?: number;
  };
}>();

const emit = defineEmits<{
  (e: 'open-comment'): void;
  (e: 'write-comment'): void;
  (e: 'toggle-fav'): void;
  (e: 'forward'): void;
  (e: 'open-like-list'): void;
  (e: 'open-forward-list'): void;
}>();

const isLiked = ref(props.userAction?.like === 1);
const likeCount = ref(props.likenum || 0);

const isFav = ref(props.favorited ?? (props.userAction?.collect === 1 || props.userAction?.favorite === 1));

const replyCount = ref(props.replynum || 0);
const shareCount = ref(props.sharenum || 0);

function formatCount(num?: number, defaultText: string = ''): string {
  if (!num || num <= 0) return defaultText;
  if (num >= 10000) {
    const val = (num / 10000).toFixed(1);
    return `${val.endsWith('.0') ? val.slice(0, -2) : val}万`;
  }
  return String(num);
}

// 动态详情可能异步到达，需同步 props 更新
watch(
  () => [props.likenum, props.replynum, props.sharenum] as const,
  ([like, reply, share]) => {
    if (like !== undefined) likeCount.value = like;
    if (reply !== undefined) replyCount.value = reply;
    if (share !== undefined) shareCount.value = share;
  }
);

watch(
  () => [props.favorited, props.userAction?.like, props.userAction?.favorite, props.userAction?.collect] as const,
  ([favorited, like, favorite, collect]) => {
    if (like !== undefined) isLiked.value = like === 1;
    if (favorited !== undefined) {
      isFav.value = favorited;
    } else if (favorite !== undefined || collect !== undefined) {
      isFav.value = collect === 1 || favorite === 1;
    }
  }
);

async function toggleLike() {
  if (!authStore.isLoggedIn) {
    authStore.openLoginModal();
    return;
  }
  const prevLiked = isLiked.value;
  const prevCount = likeCount.value;
  const nextLiked = !prevLiked;
  isLiked.value = nextLiked;
  likeCount.value = Math.max(0, prevCount + (nextLiked ? 1 : -1));
  try {
    if (nextLiked) {
      await CoolapkTauriAPI.likeFeed(String(props.feedId));
    } else {
      await CoolapkTauriAPI.unlikeFeed(String(props.feedId));
    }
  } catch (err: any) {
    isLiked.value = prevLiked;
    likeCount.value = prevCount;
    const msg = getErrorMessage(err, '点赞操作失败');
    // Preserve the API's error text. A network-related server message does not
    // prove that the request requires an official phone environment.
    showToast(msg, 'error');
  }
}

function toggleFav() {
  emit('toggle-fav');
}

function shareFeed() {
  if (!authStore.isLoggedIn) {
    authStore.openLoginModal();
    return;
  }
  emit('forward');
}
</script>

<style scoped>
.feed-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  padding-top: 8px;
  margin-top: 10px;
  width: 100%;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-width: 0;
  gap: 5px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 500;
  padding: 6px 6px;
  border-radius: 18px;
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.2, 0, 0.2, 1);
}

.action-btn span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.action-btn:hover {
  background-color: var(--background-secondary, rgba(0, 0, 0, 0.04));
  color: var(--text-primary);
}

.action-btn:hover .action-icon {
  transform: scale(1.15);
}

.like-btn:hover {
  color: #ef4444;
  background-color: rgba(239, 68, 68, 0.08);
}

.like-btn.is-liked {
  color: #ef4444;
  font-weight: 600;
}

.like-btn.is-liked .action-icon {
  animation: heartPulse 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.comment-btn:hover {
  color: var(--brand-primary, #10b981);
  background-color: rgba(16, 185, 129, 0.08);
}

.share-btn:hover {
  color: #3b82f6;
  background-color: rgba(59, 130, 246, 0.08);
}

.action-group {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-width: 0;
}

.action-group .action-btn {
  flex: 0 1 auto;
}

.interaction-count-btn {
  flex: 0 0 auto;
  min-width: 22px;
  padding: 6px 3px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
}

.interaction-count-btn:hover {
  background: var(--background-secondary, rgba(0, 0, 0, 0.04));
  color: var(--brand-primary);
}

.fav-btn:hover {
  color: #f59e0b;
  background-color: rgba(245, 158, 11, 0.08);
}

.fav-btn.is-fav {
  color: #f59e0b;
  font-weight: 600;
}

@keyframes heartPulse {
  0% { transform: scale(1); }
  40% { transform: scale(1.4); }
  80% { transform: scale(0.9); }
  100% { transform: scale(1); }
}

.action-icon {
  font-size: 15px;
  transition: transform 0.2s ease;
}

/* 两个独立玻璃表面，外层不遮挡滚动到下方的评论。 */
.feed-action-bar.official-detail-actions {
  transition: transform 200ms ease, opacity 200ms ease;
  --detail-glass-tint: color-mix(in srgb, var(--surface) 56%, transparent);
  --detail-glass-edge: #ffffffb8;
  position: fixed;
  left: max(20px, env(safe-area-inset-left));
  right: max(20px, env(safe-area-inset-right));
  bottom: calc(20px + env(safe-area-inset-bottom));
  z-index: 45;
  display: grid;
  grid-template-columns: 44% repeat(4, minmax(0, 1fr));
  width: auto;
  height: 50px;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  isolation: isolate;
}
.feed-action-bar.official-detail-actions.reading-hidden { transform: translateY(calc(100% + 20px + env(safe-area-inset-bottom, 0px))); opacity: 0; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .feed-action-bar.official-detail-actions { transition: none; } }
.official-detail-actions::before,
.official-detail-actions .official-write-comment {
  border: 1px solid var(--detail-glass-edge);
  border-radius: 32px;
  background: var(--surface);
  background: linear-gradient(150deg, #ffffff55, transparent 50%, #ffffff10), var(--detail-glass-tint);
  -webkit-backdrop-filter: blur(22px) saturate(165%);
  backdrop-filter: blur(22px) saturate(165%);
  box-shadow: 0 8px 28px #00000012, inset 0 1px 1px #ffffff65;
}
.official-detail-actions::before { content: ''; position: absolute; inset: 0 0 0 44%; z-index: -1; pointer-events: none; }
.official-detail-actions .official-write-comment { height: 100%; margin-right: 10px; min-width: 0; color: var(--text-primary); font: inherit; font-size: 17px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 10px; cursor: pointer; }
.official-detail-actions .official-write-comment svg { width: 22px; height: 22px; flex-shrink: 0; }
.official-detail-actions > .action-group, .official-detail-actions > .action-btn { min-width: 0; height: 100%; }
.official-detail-actions .action-btn { flex-direction: column; gap: 2px; padding: 4px 0; color: var(--text-primary); font-size: 10px; }
.official-detail-actions .action-icon { width: 22px; height: 22px; }
.official-detail-actions > .action-group:first-of-type { order: 2; }
.official-detail-actions > .comment-btn { order: 1; }
.official-detail-actions > .fav-btn { order: 3; }
.official-detail-actions > .action-group:last-of-type { order: 4; }
.official-detail-actions .is-liked { color: #ef4444; }
.official-detail-actions .is-fav { color: #f59e0b; }
:global([data-theme="dark"] .official-detail-actions) { --detail-glass-tint: color-mix(in srgb, var(--surface) 72%, transparent); --detail-glass-edge: #ffffff30; }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .official-detail-actions::before, .official-detail-actions .official-write-comment { background: var(--surface); }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .official-detail-actions::before, .official-detail-actions .official-write-comment { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
}

</style>
