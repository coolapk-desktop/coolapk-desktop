<template>
  <div ref="sectionRef" class="feed-comment-section" :class="{ 'official-detail-comments': officialDetail, 'aside-comments': asideLayout }">
    <div class="comment-toolbar">
      <div class="comment-toolbar-left">
        <strong class="comment-title"><template v-if="officialDetail">共 {{ commentCount }} 回复</template><template v-else>评论 <span>{{ commentCount }}</span></template></strong>
        <div v-if="!preserveApiOrder || showSortControls" class="comment-sort" aria-label="评论排序和筛选">
          <button
            v-for="option in commentSortOptions"
            :key="option.value"
            type="button"
            :class="['comment-sort-button', { 'is-active': !authorOnly && commentSortMode === option.value }]"
            :aria-pressed="!authorOnly && commentSortMode === option.value"
            @click.stop="selectCommentSort(option.value)"
          >
            {{ option.label }}
          </button>
          <button
            type="button"
            :class="['comment-sort-button', { 'is-active': authorOnly }]"
            :aria-pressed="authorOnly"
            @click.stop="selectAuthorOnly"
          >
            楼主
          </button>
        </div>
      </div>
      <button
        v-if="!officialDetail && !hideCollapseButton"
        type="button"
        class="comment-toolbar-collapse-btn"
        :title="showShortcutHints ? '收起评论 (Esc)' : '收起评论'"
        aria-label="收起评论"
        @click.stop="$emit('collapse')"
      >
        <i class="fa-solid fa-chevron-up"></i>
        <span>收起评论</span>
      </button>
    </div>

    <!-- 回复时保留顶部输入区的占位，浮层打开不会挤动当前楼层。 -->
    <div v-if="floatingReplyComposer" :style="{ height: `${inlineComposerHeight}px` }" aria-hidden="true"></div>
    <!-- 评论发表输入框组件 -->
    <Teleport to="body" :disabled="!floatingComposer">
    <div v-if="!floatingComposer || composerOpen" :class="floatingComposer ? ['official-composer-layer', { 'desktop-reply-composer': !officialDetail }] : 'inline-composer-layer'">
    <div v-if="floatingComposer" class="official-composer-backdrop" @click="closeComposer"></div>
    <div class="comment-composer-box">
      <button v-if="floatingComposer" type="button" class="official-composer-close" aria-label="关闭评论输入" @click="closeComposer"><i class="fas fa-xmark"></i></button>
      <!-- 针对楼层的回复目标提示栏 -->
      <div v-if="replyTargetUser" class="comment-reply-target-bar">
        <span class="reply-target-text">
          <i class="fa-solid fa-reply"></i>
          回复 <span class="reply-target-name">@{{ replyTargetUser }}</span>
        </span>
        <button
          type="button"
          class="reply-target-clear-btn"
          title="取消回复"
          aria-label="取消回复"
          @click="clearReplyTarget"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <!-- 多行评论富文本输入框 (原生直接显示彩色酷安表情) -->
      <div
        ref="inputRef"
        class="comment-textarea comment-rich-editor custom-scrollbar"
        contenteditable="true"
        role="textbox"
        tabindex="0"
        :data-placeholder="replyTargetUser ? '撰写回复...' : '撰写你的精彩评论... (支持直接粘贴截图)'"
        @input="handleEditorInput"
        @paste="handlePaste"
        @keydown="handleKeydown"
      ></div>

      <!-- 已选图片预览列表 -->
      <div v-if="images.length > 0" class="comment-media-preview">
        <div v-for="(img, i) in images" :key="i" class="comment-media-thumb">
          <AppImage v-if="img.url" :src="img.preview" alt="评论配图" fit="cover" />
          <img v-else :src="img.preview" alt="评论配图" />
          <button
            type="button"
            class="comment-media-remove-btn"
            title="移除图片"
            :disabled="sending"
            @click="removeImage(i)"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div v-if="uploadingImages" class="comment-uploading-tip">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <span>正在上传配图 {{ uploadedCount }}/{{ imageUploadTotal }}...</span>
        </div>
      </div>

      <!-- 隐藏的文件选择器 -->
      <input
        ref="imageInputRef"
        type="file"
        accept="image/*"
        multiple
        style="display: none"
        @change="handleImageSelected"
      />

      <!-- 工具栏与表情面板 -->
      <div v-if="floatingComposer && showEmojiPicker" ref="officialEmojiPanelRef" class="official-composer-emoji" @click.stop>
        <EmojiPanel :key="String(feedId)" :disabled="sending" :selected-urls="images.flatMap(image => image.url ? [image.url] : [])" @select="insertEmoji" @picture="selectFavoritePicture" />
      </div>
      <div class="comment-composer-toolbar">
        <div class="composer-tools-left">
          <!-- 表情按钮 -->
          <div ref="emojiContainerRef" class="emoji-picker-container">
            <button
              type="button"
              class="composer-tool-btn"
              :class="{ 'is-active': showEmojiPicker }"
              title="插入表情"
              aria-label="插入表情"
              @click.stop="toggleEmojiPicker"
            >
              <i class="fa-regular fa-face-smile"></i>
              <span>表情</span>
            </button>

            <!-- 官方分类表情浮层 -->
            <div
              v-if="showEmojiPicker && !floatingComposer"
              class="emoji-picker-popover custom-scrollbar"
              @click.stop
            >
              <EmojiPanel :key="String(feedId)" :disabled="sending" :selected-urls="images.flatMap(image => image.url ? [image.url] : [])" @select="insertEmoji" @picture="selectFavoritePicture" />
            </div>
          </div>

          <!-- 图片按钮 -->
          <button
            type="button"
            class="composer-tool-btn"
            :title="showShortcutHints ? `添加图片 (最多9张，支持直接${formatShortcut('Ctrl+V')}粘贴截图)` : '添加图片 (最多9张)'"
            aria-label="添加图片"
            :disabled="sending"
            @click="triggerImageSelect"
          >
            <i class="fa-regular fa-image"></i>
            <span>图片</span>
          </button>
        </div>

        <div class="composer-tools-right">
          <span v-if="inputMsg.length > 0" class="comment-word-count">
            {{ inputMsg.length }} / 1000
          </span>
          <Button
            variant="primary"
            size="sm"
            icon="fa-solid fa-paper-plane"
            :loading="sending"
            :disabled="(!inputMsg.trim() && images.length === 0) || sending"
            @click="handleSend"
          >
            {{ replyTargetUser ? '回复' : '评论' }}
          </Button>
        </div>
      </div>
    </div>

    </div>
    </Teleport>

    <!-- 评论加载中 -->
    <div v-if="targetReplyError" class="comment-error" role="status">
      <span>{{ targetReplyError }}</span>
      <button type="button" @click="loadTargetReply">重试</button>
    </div>
    <div v-if="loading && !targetComments.length" class="comment-loading">
      <i class="fa-solid fa-circle-notch fa-spin text-green"></i>
      <span>载入评论楼层中...</span>
    </div>

    <div v-else-if="error && !targetComments.length" class="comment-error">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>{{ error }}</span>
      <button type="button" @click="$emit('retry-comments')">重试</button>
    </div>

    <!-- 无评论提示 -->
    <div v-else-if="!sortedComments.length" class="comment-empty">
      <i class="fa-regular fa-comments empty-icon"></i>
      <span>{{ authorOnly ? '暂无楼主评论' : '暂无评论，快来抢沙发吧~' }}</span>
    </div>

    <!-- 微博/酷安 规范楼中楼树状结构列表 -->
    <div v-else class="comment-list">
      <div
        v-for="c in sortedComments"
        :key="c.id || c.uid"
        class="comment-row"
        :class="{ 'notification-comment-target': String(c.id) === targetReplyId && !hasInlineTargetReply }"
        data-context-kind="comment"
        :data-context-feed-id="feedId"
        :data-context-comment-id="c.id"
        :data-comment-username="c.username || c.userInfo?.username || '酷友'"
        :data-comment-text="getCommentText(c)"
      >
        <!-- 1. 一级评论人头像 -->
        <UserHoverCard
          :uid="c.uid || c.userId || c.userInfo?.uid"
          :avatar="getCommentAvatar(c)"
          :username="c.username || c.userInfo?.username"
          :level="getCommentUserLevel(c)"
          :verify-title="getCommentVerifyTitle(c)"
        >
          <AppAvatar
            class="comment-avatar"
            :src="getCommentAvatar(c)"
            :plugin-url="getCommentPluginUrl(c)"
            :size="32"
            alt="头像"
            @click.stop="openCommentUser(c)"
          />
        </UserHoverCard>

        <!-- 一级评论主体 -->
        <div class="comment-main">
          <!-- 名字、楼主标签、时间设备 -->
          <div class="comment-meta">
            <UserHoverCard
              :uid="c.uid || c.userId || c.userInfo?.uid"
              :avatar="getCommentAvatar(c)"
              :username="c.username || c.userInfo?.username"
              :level="getCommentUserLevel(c)"
              :verify-title="getCommentVerifyTitle(c)"
            >
              <span
                class="comment-username"
                @click.stop="openCommentUser(c)"
              >
                {{ c.username || c.userInfo?.username || '酷友' }}
              </span>
            </UserHoverCard>
            
            <!-- 楼主 Tag -->
            <span v-if="isAuthor(c)" class="badge-author">
              <i class="fa-solid fa-user-pen"></i> 楼主
            </span>
            <span v-else-if="authorOnly && c.authorOnlyContext" class="author-filter-context-label">上下文</span>
            <span v-if="!isAuthor(c) && isOwn(c)" class="badge-identity">我</span>

            <span v-if="getCommentUserLevel(c)" class="level-tag">LV{{ getCommentUserLevel(c) }}</span>
            <span v-if="getCommentVerifyTitle(c)" class="verify-tag" :title="getCommentVerifyTitle(c)">
              <i class="fa-solid fa-circle-check"></i>
              {{ getCommentVerifyTitle(c) }}
            </span>
          </div>

          <div v-if="hasCommentDetails(c)" class="comment-detail-row">
            <button
              v-if="displayCommentTime(c)"
              type="button"
              class="comment-time-button"
              :title="isAbsoluteTimeVisible(c) ? '点击恢复相对时间' : '点击查看完整时间'"
              @click.stop="toggleCommentTime(c)"
            >
              <i class="fa-regular fa-clock"></i>
              {{ displayCommentTime(c) }}
            </button>
            <span v-if="getCommentDeviceTitle(c)" class="comment-device" :title="getCommentDeviceTooltip(c)">
              <i class="fa-solid fa-mobile-screen-button"></i>
              {{ displayDeviceName(getCommentDeviceTitle(c)) }}
            </span>
            <span v-if="getCommentFloor(c)" class="comment-secondary-meta">#{{ getCommentFloor(c) }}楼</span>
            <span v-if="getCommentLocation(c)" class="comment-secondary-meta">
              <i class="fa-solid fa-location-dot"></i>
              {{ getCommentLocation(c) }}
            </span>
          </div>

          <!-- 一级评论正文 -->
          <div
            class="comment-text"
            v-html="formatCommentText(getCommentText(c))"
            @click="handleCommentTextClick($event, c)"
          ></div>

          <FeedImageGrid
            v-if="getCommentImages(c).length"
            class="comment-image-grid"
            :images="getCommentImages(c)"
            :content-id="c.id"
            content-type="reply"
            variant="comment"
          />

          <div class="comment-actions">
            <button
              type="button"
              :class="['comment-like-btn', { 'is-liked': isLiked(c) }]"
              :disabled="isLikePending(c)"
              aria-label="点赞评论"
              @click.stop="toggleLike(c)"
            >
              <i :class="[officialDetail ? (isLiked(c) ? 'fa-solid fa-thumbs-up' : 'fa-regular fa-thumbs-up') : (isLiked(c) ? 'fa-solid fa-heart' : 'fa-regular fa-heart')]"></i>
              <span>{{ getLikeCount(c) > 0 ? formatLikeCount(getLikeCount(c)) : '赞' }}</span>
            </button>
            <button
              type="button"
              class="comment-reply-btn"
              @click.stop="setReplyTarget(c.username || c.userInfo?.username, c.id)"
            >
              <i class="fa-regular fa-comment"></i>
              回复
            </button>
            <button
              v-if="isOwn(c)"
              type="button"
              class="comment-delete-btn"
              aria-label="删除评论"
              @click.stop="handleDeleteComment(c)"
            >
              <i class="fa-solid fa-trash-can"></i>
              删除
            </button>
          </div>

          <!-- 2. 带竖线的多层级楼中楼回复 -->
          <div v-if="getSubReplyRows(c).length > 0 || hasSubReplyMore(c)" class="sub-reply-thread">
            <div
              v-for="sub in getVisibleSubReplies(c)"
              :key="sub.id || sub.uid"
              class="sub-reply-row"
              :class="{ 'notification-comment-target': String(sub.id) === targetReplyId }"
              data-context-kind="comment"
              :data-context-feed-id="feedId"
              :data-context-comment-id="sub.id"
              :data-comment-username="sub.username || sub.fromUserName || '酷友'"
              :data-comment-text="getCommentText(sub)"
              @click="handleSubReplyClick($event, sub, c)"
            >
              <!-- 子回复头像 -->
              <UserHoverCard
                :uid="sub.uid || sub.fromUid || sub.userId || sub.userInfo?.uid"
                :avatar="getCommentAvatar(sub)"
                :username="sub.username || sub.fromUserName"
                :level="getCommentUserLevel(sub)"
                :verify-title="getCommentVerifyTitle(sub)"
              >
                <AppAvatar
                  class="sub-reply-avatar"
                  :src="getCommentAvatar(sub)"
                  :plugin-url="getCommentPluginUrl(sub)"
                  :size="28"
                  alt="头像"
                  @click.stop="openCommentUser(sub)"
                />
              </UserHoverCard>
              <div class="sub-reply-main">
                <!-- 子回复 meta -->
                <div class="sub-reply-meta">
                  <UserHoverCard
                    :uid="sub.uid || sub.fromUid || sub.userId || sub.userInfo?.uid"
                    :avatar="getCommentAvatar(sub)"
                    :username="sub.username || sub.fromUserName"
                    :level="getCommentUserLevel(sub)"
                    :verify-title="getCommentVerifyTitle(sub)"
                  >
                    <span class="sub-user" @click.stop="openCommentUser(sub)">{{ sub.username || sub.fromUserName || '酷友' }}</span>
                  </UserHoverCard>
                  <span v-if="isAuthor(sub)" class="badge-author sub-badge">楼主</span>
                  <span v-if="!isAuthor(sub) && isOwn(sub)" class="badge-identity sub-badge">我</span>
                  <span v-if="getCommentUserLevel(sub)" class="level-tag">LV{{ getCommentUserLevel(sub) }}</span>
                  <span v-if="getCommentVerifyTitle(sub)" class="verify-tag" :title="getCommentVerifyTitle(sub)">
                    <i class="fa-solid fa-circle-check"></i>
                    {{ getCommentVerifyTitle(sub) }}
                  </span>

                  <!-- 被回复人 -->
                  <template v-if="sub.replyUsername || sub.rusername || sub.toUserName">
                    <span class="sub-reply-to">回复</span>
                    <span class="sub-target-user">@{{ sub.replyUsername || sub.rusername || sub.toUserName }}</span>
                  </template>

                </div>
                <div v-if="hasCommentDetails(sub)" class="comment-detail-row sub-detail-row">
                  <button
                    v-if="displayCommentTime(sub)"
                    type="button"
                    class="comment-time-button"
                    :title="isAbsoluteTimeVisible(sub) ? '点击恢复相对时间' : '点击查看完整时间'"
                    @click.stop="toggleCommentTime(sub)"
                  >
                    <i class="fa-regular fa-clock"></i>
                    {{ displayCommentTime(sub) }}
                  </button>
                  <span v-if="getCommentDeviceTitle(sub)" class="comment-device" :title="getCommentDeviceTooltip(sub)">
                    <i class="fa-solid fa-mobile-screen-button"></i>
                    {{ displayDeviceName(getCommentDeviceTitle(sub)) }}
                  </span>
                  <span v-if="getCommentLocation(sub)" class="comment-secondary-meta">
                    <i class="fa-solid fa-location-dot"></i>
                    {{ getCommentLocation(sub) }}
                  </span>
                </div>
                <!-- 子回复正文 -->
                <div class="sub-reply-text" v-html="formatCommentText(getCommentText(sub))" @click="handleSubReplyTextClick($event, sub)"></div>
                <FeedImageGrid
                  v-if="getCommentImages(sub).length"
                  class="comment-image-grid sub-comment-images"
                  :images="getCommentImages(sub)"
                  :content-id="sub.id"
                  content-type="reply"
                  variant="comment"
                />
                <div class="sub-reply-actions">
                  <button
                    type="button"
                    :class="['comment-like-btn', 'sub-like-btn', { 'is-liked': isLiked(sub) }]"
                    :disabled="isLikePending(sub)"
                    aria-label="点赞回复"
                    @click.stop="toggleLike(sub)"
                  >
                    <i :class="[isLiked(sub) ? 'fa-solid fa-heart' : 'fa-regular fa-heart']"></i>
                    <span>{{ getLikeCount(sub) > 0 ? formatLikeCount(getLikeCount(sub)) : '赞' }}</span>
                  </button>
                  <button
                    v-if="isOwn(sub)"
                    type="button"
                    class="comment-delete-btn sub-delete-btn"
                    aria-label="删除回复"
                    @click.stop="handleDeleteSubReply(c, sub)"
                  >
                    <i class="fa-solid fa-trash-can"></i>
                    删除
                  </button>
                </div>
              </div>
            </div>

            <div v-if="getSubReplyLoading(c)" class="sub-reply-status" aria-live="polite">
              <i class="fa-solid fa-circle-notch fa-spin text-green"></i>
              <span>加载楼中楼...</span>
            </div>
            <button
              v-else-if="getSubReplyError(c)"
              type="button"
              class="sub-more-btn sub-reply-error"
              @click.stop="retrySubReplies(c)"
            >
              {{ getSubReplyError(c) }}，点击重试
            </button>

            <!-- 楼中楼按 APK 的 replyList 分页；展开时只请求当前楼层，不预取所有楼层。 -->
            <div v-else-if="hasSubReplyMore(c) || expandedFloorIds.has(String(c.id))" class="sub-more-btn-wrap">
              <button
                v-if="!expandedFloorIds.has(String(c.id))"
                type="button"
                class="sub-more-btn"
                @click.stop="toggleExpandSub(c)"
              >
                <template v-if="getRemainingSubCount(c) > 0">
                  展开剩下的 {{ getRemainingSubCount(c) }} 条回复
                </template>
                <template v-else>
                  展开更多回复
                </template>
                <i class="fa-solid fa-chevron-down icon-arrow"></i>
              </button>
              <template v-else>
                <button
                  v-if="hasSubReplyMore(c)"
                  type="button"
                  class="sub-more-btn"
                  @click.stop="loadMoreSubReplies(c)"
                >
                  加载更多楼中楼 <i class="fa-solid fa-chevron-down icon-arrow"></i>
                </button>
                <button
                  type="button"
                  class="sub-more-btn sub-collapse-btn"
                  @click.stop="toggleExpandSub(c)"
                >
                  收起回复 <i class="fa-solid fa-chevron-up icon-arrow"></i>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="hasMoreComments"
      ref="loadMoreSentinel"
      class="comment-load-more"
      aria-live="polite"
    >
      <div v-if="loadingMoreComments" class="comment-loading-more">
        <i class="fa-solid fa-circle-notch fa-spin text-green"></i>
        <span>加载更多评论...</span>
      </div>
      <button
        v-else-if="loadMoreError"
        type="button"
        class="comment-load-more-error"
        @click.stop="$emit('retry-more-comments')"
      >
        {{ loadMoreError }}，点击重试
      </button>
      <button
        v-else
        type="button"
        class="comment-load-more-hint"
        @click.stop="$emit('load-more-comments')"
      >
        继续下滑加载更多评论
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { createEditorTextNodes } from "../../utils/editorTextNodes";
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { normalizeUserUid } from '../../utils/userRoute';
import { useDeviceModelNames } from '../../utils/deviceModelNames';

const displayDeviceName = useDeviceModelNames();
const router = useRouter();
import { usePlatformShortcuts } from '../../utils/shortcuts';
import { useShortcutHints } from '../../composables/useShortcutHints';
import AppAvatar from '../common/AppAvatar.vue';
import UserHoverCard from '../user/UserHoverCard.vue';
import Button from '../ui/Button.vue';
import FeedImageGrid from './FeedImageGrid.vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore } from '../../stores/settings';
import { EMOJI_MAP, EMOJI_BASE, getEmojiUrl } from '../../utils/coolapkEmoji';
import { useRecentEmojis } from '../../utils/recentEmojis';
import EmojiPanel from '../common/EmojiPanel.vue';
import AppImage from '../common/AppImage.vue';
import { isSystemEmoji, type EmojiPicture } from '../../utils/emojiPanel';
import { clearCommentDraft, loadCommentDraft, saveCommentDraft } from '../../utils/commentDrafts';
import { handleAnchorClick } from '../../utils/anchorClick';
import { showToast } from '../../utils/toast';
import { requestConfirmation } from '../../utils/confirm';
import { getErrorMessage } from '../../utils/errors';
import { renderCoolapkRichText } from '../../utils/richText';
import { hasFeedMoreSuffix } from '../../utils/feedContent';
import { logDiagnostic, summarizeDiagnosticError } from '../../utils/diagnosticLogger';
import { reactiveUserProfileMap, getCachedUserProfileSync } from '../../utils/userProfilePreloader';
import { verifyWithCaptcha, extractCaptchaParamsFromResponse } from '../../utils/neteaseCaptcha';
import { openShuzilmGuide, isRiskControlError, hasActiveShuzilmDeviceId } from '../../utils/shuzilmDeviceGuide';
import { hasActiveTextSelection } from '../../utils/selection';
import {
  COMMENT_SORT_OPTIONS,
  formatCommentAbsoluteTime,
  formatCommentTime,
  getCommentDeviceTitle,
  getCommentImages,
  getCommentLocation,
  getCommentUserLevel,
  getCommentVerifyTitle,
  getReplyData,
  getReplyPageCursor,
  hasMoreReplyPages,
  mergeReplies,
  sortComments,
  type CommentSortMode,
  type CommentSortSelection,
} from '../../utils/commentList';

const props = withDefaults(
  defineProps<{
    feedId?: string | number;
    targetReplyId?: string;
    officialDetail?: boolean;
    defaultSortMode?: CommentSortMode;
    /** 宿主保存楼主筛选，切换互动栏目后重新挂载时恢复按钮状态。 */
    defaultAuthorOnly?: boolean;
    preserveApiOrder?: boolean;
    /** 侧栏共用话题评论的无卡片布局；服务端排序时仍可显示共用筛选按钮。 */
    asideLayout?: boolean;
    showSortControls?: boolean;
    /** 抑制工具栏「收起评论」按钮与 Esc 的 collapse 事件：
     *  给分栏详情页右栏这种没有「收起」语义的宿主用；默认 false，既有调用点行为不变。 */
    hideCollapseButton?: boolean;
    feedUid?: string | number;
    feedUsername?: string;
    comments: any[];
    totalCommentCount?: number | string | null;
    loading?: boolean;
    error?: string;
    hasMoreComments?: boolean;
    loadingMoreComments?: boolean;
    loadMoreError?: string;
    normalizeImg?: (url: string, type: 'avatar' | 'feed') => string;
    formatRichText?: (text: string) => string;
  }>(),
  {
    feedId: '',
    targetReplyId: '',
    defaultAuthorOnly: false,
    preserveApiOrder: false,
    asideLayout: false,
    showSortControls: false,
    hideCollapseButton: false,
    feedUid: '',
    feedUsername: '',
    totalCommentCount: undefined,
    loading: false,
    error: '',
    hasMoreComments: false,
    loadingMoreComments: false,
    loadMoreError: '',
    normalizeImg: (url: string) => url,
    formatRichText: (text: string) => renderCoolapkRichText(text),
  }
);

function getCommentText(item: any): string {
  const text = String(item?.message || item?.replyRowsText || '');
  if (!text || getCommentImages(item).length === 0) return text;
  return text.replace(/\[\s*图片\s*\]/gi, '').trim();
}

function formatCommentText(text: string): string {
  if (!text) return '';
  return props.formatRichText ? props.formatRichText(text) : renderCoolapkRichText(text);
}

const emit = defineEmits<{
  (e: 'send-comment', text: string): void;
  (e: 'delete-comment', id: string | number): void;
  (e: 'retry-comments'): void;
  (e: 'load-more-comments'): void;
  (e: 'retry-more-comments'): void;
  (e: 'comment-sort-change', selection: CommentSortSelection): void;
  (e: 'collapse'): void;
}>();

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const { formatShortcut } = usePlatformShortcuts();
const showShortcutHints = useShortcutHints();

const inputMsg = ref('');
const sending = ref(false);
const inputRef = ref<HTMLDivElement | null>(null);
const composerOpen = ref(false);
const floatingReplyComposer = ref(false);
const inlineComposerHeight = ref(0);
const floatingComposer = computed(() => props.officialDetail || floatingReplyComposer.value);
const systemBarDimOwner = Symbol('comment-composer');
watch([composerOpen, () => props.officialDetail], ([open, official]) => {
  settingsStore.setAndroidSystemBarDimmed(systemBarDimOwner, Boolean(open && official));
}, { flush: 'sync' });
onUnmounted(() => { settingsStore.setAndroidSystemBarDimmed(systemBarDimOwner, false); });
async function openComposer() { if (!authStore.isLoggedIn) { authStore.openLoginModal(); return; } composerOpen.value = true; await nextTick(); syncMsgToEditor(inputMsg.value); inputRef.value?.focus({ preventScroll: true }); }
watch(composerOpen, async visible => { if (visible) { await nextTick(); syncMsgToEditor(inputMsg.value); } });
onDeactivated(closeComposer);
defineExpose({ openComposer });
const replyTargetUser = ref('');
const replyTargetId = ref('');
const commentSortMode = ref<CommentSortMode>(props.defaultSortMode ?? settingsStore.settings.commentDefaultSortMode);
const authorOnly = ref(props.defaultAuthorOnly);
const commentSortOptions = COMMENT_SORT_OPTIONS;
const absoluteTimeIds = ref<Set<string>>(new Set());
const loadMoreSentinel = ref<HTMLElement | null>(null);
let loadMoreObserver: IntersectionObserver | null = null;

watch([() => props.defaultSortMode, () => props.defaultAuthorOnly], ([sortMode, authorFilter]) => {
  if (sortMode) commentSortMode.value = sortMode;
  authorOnly.value = authorFilter;
});

watch(() => settingsStore.settings.commentDefaultSortMode, (sortMode) => {
  commentSortMode.value = sortMode;
  authorOnly.value = false;
});

function disconnectLoadMoreObserver() {
  loadMoreObserver?.disconnect();
  loadMoreObserver = null;
}

function findScrollableParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (
      /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflowX}`)
      && parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function refreshLoadMoreObserver() {
  disconnectLoadMoreObserver();
  if (
    !props.hasMoreComments ||
    props.loadingMoreComments ||
    props.loadMoreError ||
    !loadMoreSentinel.value ||
    typeof IntersectionObserver === 'undefined'
  ) {
    return;
  }

  const root = findScrollableParent(loadMoreSentinel.value);
  loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      emit('load-more-comments');
    }
  }, { root, rootMargin: '0px 0px 200px 0px', threshold: 0 });
  loadMoreObserver.observe(loadMoreSentinel.value);
}

function selectCommentSort(mode: CommentSortMode) {
  if (!authorOnly.value && commentSortMode.value === mode) return;
  authorOnly.value = false;
  commentSortMode.value = mode;
  emit('comment-sort-change', { mode, authorOnly: false });
}

function selectAuthorOnly() {
  authorOnly.value = !authorOnly.value;
  emit('comment-sort-change', {
    mode: commentSortMode.value,
    authorOnly: authorOnly.value,
  });
}

// 评论配图与酷安表情输入
const MAX_IMAGES = 9;
const images = ref<{ file?: File; preview: string; url?: string }[]>([]);
const imageUploadTotal = ref(0);
const uploadingImages = ref(false);
const uploadedCount = ref(0);
const imageInputRef = ref<HTMLInputElement | null>(null);
const showEmojiPicker = ref(false);
const emojiContainerRef = ref<HTMLElement | null>(null);
const officialEmojiPanelRef = ref<HTMLElement | null>(null);
const { addRecent } = useRecentEmojis();
let restoringDraft = false;

function createEmojiImg(name: string, _filename?: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'coolapk-emoji';
  img.src = getEmojiUrl(name) || `${EMOJI_BASE}coolapk_emotion_1_hahaha.png`;
  img.alt = `[${name}]`;
  img.title = name;
  img.setAttribute('data-emoji', `[${name}]`);
  img.setAttribute('contenteditable', 'false');
  return img;
}

function parseTextToEditorNodes(text: string): Node[] {
  return createEditorTextNodes(text);
}

function getEditorText(el: HTMLElement | null): string {
  if (!el) return '';
  let result = '';
  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.tagName === 'IMG' && element.getAttribute('data-emoji')) {
        result += element.getAttribute('data-emoji');
      } else if (element.tagName === 'BR') {
        result += '\n';
      } else {
        node.childNodes.forEach(traverse);
        if (element.tagName === 'DIV' || element.tagName === 'P') {
          if (node.nextSibling) result += '\n';
        }
      }
    }
  };
  el.childNodes.forEach(traverse);
  return result;
}

function syncMsgToEditor(text: string) {
  const el = inputRef.value;
  if (!el) return;
  el.innerHTML = '';
  const nodes = parseTextToEditorNodes(text);
  nodes.forEach((n) => el.appendChild(n));
}

function handleEditorInput() {
  const el = inputRef.value;
  if (!el) return;
  inputMsg.value = getEditorText(el);
}

function currentDraftAccount(): string {
  return String(authStore.user?.uid || 'guest');
}

async function restoreDraft() {
  if (!props.feedId) return;
  restoringDraft = true;
  try {
    const draft = await loadCommentDraft(currentDraftAccount(), props.feedId, replyTargetId.value || undefined);
    if (draft) {
      inputMsg.value = draft;
      syncMsgToEditor(draft);
    }
  } finally {
    restoringDraft = false;
  }
}

watch([() => props.feedId, replyTargetId, () => authStore.user?.uid], () => {
  void restoreDraft();
});

watch(inputMsg, (val) => {
  if (!restoringDraft && props.feedId) {
    void saveCommentDraft(currentDraftAccount(), props.feedId, replyTargetId.value || undefined, val);
  }
});

function isAbsoluteTimeVisible(item: any): boolean {
  return absoluteTimeIds.value.has(itemKey(item));
}

function displayCommentTime(item: any): string {
  return isAbsoluteTimeVisible(item)
    ? formatCommentAbsoluteTime(item)
    : formatCommentTime(item);
}

function toggleCommentTime(item: any) {
  const key = itemKey(item);
  const nextSet = new Set(absoluteTimeIds.value);
  if (nextSet.has(key)) nextSet.delete(key);
  else nextSet.add(key);
  absoluteTimeIds.value = nextSet;
}

function getCommentFloor(item: any): string {
  const value = item?.floor ?? item?.rank ?? '';
  return String(value).trim();
}

function getCommentAvatar(item: any): string {
  const direct =
    item?.userAvatar ||
    item?.avatar ||
    item?.user_avatar ||
    item?.userSmallAvatar ||
    item?.userBigAvatar ||
    item?.userInfo?.userAvatar ||
    item?.userInfo?.avatar ||
    item?.userInfo?.user_avatar ||
    item?.userInfo?.userSmallAvatar ||
    item?.userInfo?.userBigAvatar;
  if (direct && typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  const uid = String(item?.uid || item?.fromUid || item?.userId || item?.userInfo?.uid || '').trim();
  if (uid) {
    const p = reactiveUserProfileMap[uid] || getCachedUserProfileSync(uid);
    const candidate =
      p?.userAvatar ||
      p?.avatar ||
      p?.user_avatar ||
      p?.userSmallAvatar ||
      p?.userBigAvatar ||
      p?.userInfo?.userAvatar ||
      p?.userInfo?.avatar;
    if (candidate && typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function getCommentPluginUrl(item: any): string {
  const direct = item?.avatar_plugin_url || item?.userInfo?.avatar_plugin_url || item?.userAvatarPluginUrl;
  if (direct) return String(direct).trim();
  const uid = String(item?.uid || item?.fromUid || item?.userId || item?.userInfo?.uid || '').trim();
  if (uid) {
    const p = reactiveUserProfileMap[uid] || getCachedUserProfileSync(uid);
    return p?.avatar_plugin_url || p?.userInfo?.avatar_plugin_url || p?.userAvatarPluginUrl || '';
  }
  return '';
}

function getCommentDeviceRom(item: any): string {
  return String(item?.deviceRom ?? item?.device_rom ?? '').trim();
}

function getCommentDeviceTooltip(item: any): string {
  return [
    getCommentDeviceTitle(item),
    getCommentDeviceRom(item),
    String(item?.deviceBuild ?? item?.device_build ?? '').trim(),
  ].filter(Boolean).join(' · ');
}

function hasCommentDetails(item: any): boolean {
  return Boolean(
    displayCommentTime(item)
    || getCommentDeviceTitle(item)
    || getCommentFloor(item)
    || getCommentLocation(item),
  );
}

const myUid = computed(() => (authStore.isLoggedIn ? String(authStore.user?.uid ?? '').trim() : ''));

function getCommentUid(item: any): string {
  return String(item?.uid || item?.fromUid || item?.userId || item?.userInfo?.uid || item?.user_info?.uid || '').trim();
}

function isOwn(item: any): boolean {
  const uid = getCommentUid(item);
  return !!uid && !!myUid.value && uid === myUid.value;
}

async function handleDeleteComment(comment: any) {
  const confirmed = await requestConfirmation({
    title: '删除评论',
    message: '确定要删除这条评论吗？',
    confirmText: '删除',
    danger: true
  });
  if (!confirmed) return;
  try {
    const res = await CoolapkTauriAPI.deleteReply(String(comment.id));
    if (res && res.code === 200) {
      showToast('评论已删除');
      emit('delete-comment', comment.id);
    } else {
      showToast(res?.message || '删除评论失败', 'error');
    }
  } catch (err: any) {
    showToast(getErrorMessage(err, '删除评论失败'), 'error');
  }
}

async function handleDeleteSubReply(floor: any, sub: any) {
  const confirmed = await requestConfirmation({
    title: '删除回复',
    message: '确定要删除这条回复吗？',
    confirmText: '删除',
    danger: true
  });
  if (!confirmed) return;
  try {
    const res = await CoolapkTauriAPI.deleteReply(String(sub.id));
    if (res && res.code === 200) {
      showToast('回复已删除');
      const source = props.comments.find((c: any) => String(c.id) === String(floor.id));
      if (source && Array.isArray(source.replyRows)) {
        source.replyRows = source.replyRows.filter((r: any) => String(r.id) !== String(sub.id));
      }
    } else {
      showToast(res?.message || '删除回复失败', 'error');
    }
  } catch (err: any) {
    showToast(getErrorMessage(err, '删除回复失败'), 'error');
  }
}

type LikeState = { liked: boolean; count: number };

const likeStates = ref<Record<string, LikeState>>({});
const likePending = ref<Record<string, boolean>>({});

function itemKey(item: any): string {
  return String(item?.id ?? `${item?.uid ?? 'unknown'}:${item?.dateline ?? item?.infoHtml ?? ''}`);
}

const replyDetails = ref<Record<string, any>>({});
const requestedReplyDetailIds = new Set<string>();
const replyDetailQueue: string[] = [];
let activeReplyDetailRequests = 0;
const MAX_REPLY_DETAIL_CONCURRENCY = 4;

function collectReplyIds(items: any[]): string[] {
  const result: string[] = [];
  const visit = (item: any) => {
    const id = String(item?.id ?? '').trim();
    if (id) result.push(id);
    const children = Array.isArray(item?.replyRows)
      ? item.replyRows
      : Array.isArray(item?.rlist)
        ? item.rlist
        : [];
    children.forEach(visit);
  };
  items.forEach(visit);
  return [...new Set(result)];
}

function mergeReplyDetail(item: any): any {
  const detail = replyDetails.value[String(item?.id ?? '')];
  if (!detail) return item;

  const merged = { ...item };
  Object.entries(detail).forEach(([key, value]) => {
    const hasMeaningfulValue = value !== undefined
      && value !== null
      && value !== ''
      && value !== 0
      && (!Array.isArray(value) || value.length > 0);
    if (hasMeaningfulValue) merged[key] = value;
  });
  return merged;
}

function pumpReplyDetailQueue() {
  while (activeReplyDetailRequests < MAX_REPLY_DETAIL_CONCURRENCY && replyDetailQueue.length > 0) {
    const replyId = replyDetailQueue.shift();
    if (!replyId) continue;
    activeReplyDetailRequests += 1;
    void CoolapkTauriAPI.getReplyDetail(replyId)
      .then((response: any) => {
        if (!response?.data) return;
        replyDetails.value = {
          ...replyDetails.value,
          [replyId]: response.data,
        };
      })
      .catch(() => {
        // 补充元数据失败不影响评论正文、点赞和回复等主要功能。
      })
      .finally(() => {
        activeReplyDetailRequests -= 1;
        pumpReplyDetailQueue();
      });
  }
}

function scheduleReplyDetails(ids: string[]) {
  ids.forEach((id) => {
    if (requestedReplyDetailIds.has(id)) return;
    requestedReplyDetailIds.add(id);
    replyDetailQueue.push(id);
  });
  pumpReplyDetailQueue();
}

watch(
  () => collectReplyIds(props.comments).join(','),
  () => scheduleReplyDetails(collectReplyIds(props.comments)),
  { immediate: true },
);

function initialLikeState(item: any): LikeState {
  const like = item?.userAction?.like;
  const count = Number(item?.likenum ?? item?.likeNum ?? item?.like_num ?? 0);
  return {
    liked: like === 1 || like === '1' || like === true,
    count: Number.isFinite(count) ? Math.max(0, count) : 0,
  };
}

function getLikeState(item: any): LikeState {
  const key = itemKey(item);
  return likeStates.value[key] || initialLikeState(item);
}

function isLiked(item: any): boolean {
  return getLikeState(item).liked;
}

function getLikeCount(item: any): number {
  return getLikeState(item).count;
}

function isLikePending(item: any): boolean {
  return likePending.value[itemKey(item)] === true;
}

function formatLikeCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(count);
}

async function toggleLike(item: any) {
  if (!authStore.isLoggedIn) {
    authStore.openLoginModal();
    return;
  }

  const id = item?.id;
  if (id === undefined || id === null || String(id).trim() === '') return;

  const key = itemKey(item);
  if (isLikePending(item)) return;

  const previous = getLikeState(item);
  const next: LikeState = {
    liked: !previous.liked,
    count: Math.max(0, previous.count + (previous.liked ? -1 : 1)),
  };
  likeStates.value = { ...likeStates.value, [key]: next };
  likePending.value = { ...likePending.value, [key]: true };

  try {
    if (next.liked) {
      await CoolapkTauriAPI.likeReply(String(id));
    } else {
      await CoolapkTauriAPI.unlikeReply(String(id));
    }
  } catch (error) {
    likeStates.value = { ...likeStates.value, [key]: previous };
    console.error('Failed to toggle comment like', error);
  } finally {
    const pending = { ...likePending.value };
    delete pending[key];
    likePending.value = pending;
  }
}

type SubReplyState = {
  items: any[];
  nextPage: number;
  lastItem: string;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  error: string;
};

const expandedFloorIds = ref<Set<string>>(new Set());
const subReplyStates = ref<Record<string, SubReplyState>>({});

function subReplyFloorId(floor: any): string {
  return String(floor?.id ?? '').trim();
}

function getEmbeddedSubReplies(floor: any): any[] {
  if (Array.isArray(floor?.replyRows)) return floor.replyRows;
  if (Array.isArray(floor?.rlist)) return floor.rlist;
  return [];
}

function getPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getSubReplyTotal(floor: any): number | null {
  const embedded = getEmbeddedSubReplies(floor);
  // replynum 是楼中楼总数，replyRowsCount 是当前动态内嵌的条数；不能把
  // replyRowsMore 当成具体数量，它只是 APK 用来表示“还有更多”的标记。
  const replyNum = getPositiveNumber(floor?.replynum ?? floor?.replyNum);
  if (replyNum !== null) return Math.max(embedded.length, replyNum);

  const embeddedCount = getPositiveNumber(floor?.replyRowsCount);
  return embeddedCount !== null ? Math.max(embedded.length, embeddedCount) : null;
}

function hasExplicitSubReplyMore(floor: any): boolean {
  return getPositiveNumber(floor?.replyRowsMore) !== null;
}

function mergeSubReplyRows(embedded: any[], fetched: any[]): any[] {
  // APK 的会话列表沿用 replyList 顺序。完整分页优先，尚未取到的预览仅补在末尾。
  return mergeReplies(fetched, embedded).map(mergeReplyDetail);
}

function getSubReplyRows(floor: any): any[] {
  const floorId = subReplyFloorId(floor);
  const state = floorId ? subReplyStates.value[floorId] : undefined;
  return mergeSubReplyRows(getEmbeddedSubReplies(floor), state?.items || []);
}

function ensureSubReplyState(floor: any): SubReplyState | null {
  const floorId = subReplyFloorId(floor);
  if (!floorId) return null;
  const existing = subReplyStates.value[floorId];
  if (existing) return existing;

  const embedded = getEmbeddedSubReplies(floor);
  const total = getSubReplyTotal(floor);
  const state: SubReplyState = {
    items: [],
    nextPage: 1,
    lastItem: '',
    hasMore: total === null
      ? hasExplicitSubReplyMore(floor)
      : embedded.length < total || hasExplicitSubReplyMore(floor),
    loaded: false,
    loading: false,
    error: '',
  };
  subReplyStates.value = { ...subReplyStates.value, [floorId]: state };
  return state;
}

function updateSubReplyState(floorId: string, patch: Partial<SubReplyState>) {
  const current = subReplyStates.value[floorId];
  if (!current) return;
  subReplyStates.value = {
    ...subReplyStates.value,
    [floorId]: { ...current, ...patch },
  };
}

function hasSubReplyMore(floor: any): boolean {
  const floorId = subReplyFloorId(floor);
  const rows = getSubReplyRows(floor);
  const total = getSubReplyTotal(floor);
  const state = floorId ? subReplyStates.value[floorId] : undefined;
  if (state?.loaded) return state.hasMore;
  if (total !== null && rows.length < total) return true;

  return hasExplicitSubReplyMore(floor) || (state ? state.hasMore : false);
}

function getRemainingSubCount(floor: any): number {
  const total = getSubReplyTotal(floor);
  if (total === null) return 0;
  return Math.max(0, total - getSubReplyRows(floor).length);
}

function getVisibleSubReplies(floor: any): any[] {
  const rows = getSubReplyRows(floor);
  const floorId = subReplyFloorId(floor);
  const state = floorId ? subReplyStates.value[floorId] : undefined;
  // APK 直接渲染 replyRows；这里不能再固定截断成前两条。只有点击“展开更多”
  // 后拿到的远端分页数据，才由 expandedFloorIds 控制是否显示。
  if (expandedFloorIds.value.has(floorId) || !state?.loaded) return rows;
  return getEmbeddedSubReplies(floor);
}

function getSubReplyLoading(floor: any): boolean {
  const floorId = subReplyFloorId(floor);
  return floorId ? subReplyStates.value[floorId]?.loading === true : false;
}

function getSubReplyError(floor: any): string {
  const floorId = subReplyFloorId(floor);
  return floorId ? subReplyStates.value[floorId]?.error || '' : '';
}

function toggleExpandedFloor(floorId: string) {
  const nextSet = new Set(expandedFloorIds.value);
  if (nextSet.has(floorId)) nextSet.delete(floorId);
  else nextSet.add(floorId);
  expandedFloorIds.value = nextSet;
}

async function toggleExpandSub(floor: any) {
  const floorId = subReplyFloorId(floor);
  if (!floorId) return;
  if (expandedFloorIds.value.has(floorId)) {
    toggleExpandedFloor(floorId);
    return;
  }

  toggleExpandedFloor(floorId);
  const state = ensureSubReplyState(floor);
  if (state && !state.loaded && hasSubReplyMore(floor)) await loadSubReplies(floor, true);
  else if (state && !state.loaded) updateSubReplyState(floorId, { loaded: true, hasMore: false });
}

async function loadSubReplies(floor: any, reset: boolean) {
  const floorId = subReplyFloorId(floor);
  const feedId = String(props.feedId || '').trim();
  if (!floorId || !feedId) return;

  const state = ensureSubReplyState(floor);
  if (!state || state.loading) return;
  if (!reset && !state.hasMore) return;

  const page = reset ? 1 : state.nextPage;
  const requestedFeedId = feedId;
  updateSubReplyState(floorId, { loading: true, error: '' });

  try {
    const response: any = await CoolapkTauriAPI.getSubReplies(feedId, floorId, page, {
      lastItem: reset ? '' : state.lastItem,
    });
    if (String(props.feedId || '').trim() !== requestedFeedId) return;
    const pageRows = Array.isArray(response?.data) ? response.data : [];
    const previousRows = mergeSubReplyRows(getEmbeddedSubReplies(floor), state.items);
    const fetchedRows = reset ? pageRows : mergeReplies(state.items, pageRows);
    const loadedRows = mergeSubReplyRows(getEmbeddedSubReplies(floor), fetchedRows);
    const total = getSubReplyTotal(floor);
    const cursor = getReplyPageCursor(pageRows);
    const hasMore = hasMoreReplyPages(pageRows, previousRows, loadedRows, total);

    updateSubReplyState(floorId, {
      items: fetchedRows,
      nextPage: page + 1,
      lastItem: cursor.lastItem || state.lastItem,
      hasMore,
      loaded: true,
      loading: false,
      error: '',
    });
    scheduleReplyDetails(collectReplyIds(pageRows));
  } catch (error) {
    if (String(props.feedId || '').trim() !== requestedFeedId) return;
    updateSubReplyState(floorId, {
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function loadMoreSubReplies(floor: any) {
  if (!expandedFloorIds.value.has(subReplyFloorId(floor))) return;
  void loadSubReplies(floor, false);
}

function retrySubReplies(floor: any) {
  const floorId = subReplyFloorId(floor);
  const state = floorId ? subReplyStates.value[floorId] : undefined;
  void loadSubReplies(floor, !state || state.nextPage <= 1);
}

watch(
  () => String(props.feedId || ''),
  () => {
    expandedFloorIds.value = new Set();
    subReplyStates.value = {};
  },
);

function toggleEmojiPicker() {
  showEmojiPicker.value = !showEmojiPicker.value;
}

function insertEmoji(name: string) {
  addRecent(name);
  const filename = EMOJI_MAP[name];
  const el = inputRef.value;
  const emojiCode = isSystemEmoji(name) ? name : `[${name}]`;
  if (!el) {
    inputMsg.value += emojiCode;
    return;
  }

  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  const img = isSystemEmoji(name) ? document.createTextNode(name) : createEmojiImg(name, filename);

  if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(img);

    const newRange = document.createRange();
    newRange.setStartAfter(img);
    newRange.setEndAfter(img);
    sel.removeAllRanges();
    sel.addRange(newRange);
  } else {
    el.appendChild(img);
  }

  inputMsg.value = getEditorText(el);
}

function triggerImageSelect() {
  showEmojiPicker.value = false;
  if (images.value.length >= MAX_IMAGES) {
    showToast(`最多只能添加 ${MAX_IMAGES} 张配图`, 'warning');
    return;
  }
  imageInputRef.value?.click();
}

function selectFavoritePicture(picture: EmojiPicture) {
  if (sending.value) return;
  if (images.value.some(image => image.url === picture.url)) { showToast('已经添加了', 'info'); return; }
  if (images.value.length >= MAX_IMAGES) { showToast(`最多只能添加 ${MAX_IMAGES} 张配图`, 'warning'); return; }
  images.value.push({ url: picture.url, preview: picture.url });
}

function appendImageFiles(files: File[]) {
  if (!files.length) return;
  const remain = MAX_IMAGES - images.value.length;
  if (remain <= 0) {
    showToast(`最多只能添加 ${MAX_IMAGES} 张配图`, 'warning');
    return;
  }
  if (files.length > remain) {
    showToast(`最多只能添加 ${MAX_IMAGES} 张配图，已截取前 ${remain} 张`, 'warning');
  }
  files.slice(0, remain).forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      images.value.push({ file, preview: String(reader.result) });
    };
    reader.readAsDataURL(file);
  });
}

function handleImageSelected(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files ? Array.from(target.files) : [];
  target.value = '';
  if (files.length === 0) return;
  appendImageFiles(files);
}

function handlePaste(e: ClipboardEvent) {
  const clipboardData = e.clipboardData;
  if (!clipboardData) return;

  const imageFiles: File[] = [];
  if (clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
  }

  if (imageFiles.length > 0) {
    e.preventDefault();
    appendImageFiles(imageFiles);
    return;
  }

  const text = clipboardData.getData('text/plain');
  if (text) {
    e.preventDefault();
    const el = inputRef.value;
    if (!el) return;
    const nodes = parseTextToEditorNodes(text);
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const frag = document.createDocumentFragment();
      let lastNode: Node | null = null;
      nodes.forEach((n) => {
        lastNode = n;
        frag.appendChild(n);
      });
      range.insertNode(frag);
      if (lastNode) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastNode);
        newRange.setEndAfter(lastNode);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    } else {
      nodes.forEach((n) => el.appendChild(n));
    }
    inputMsg.value = getEditorText(el);
  }
}

function removeImage(index: number) {
  if (sending.value) return;
  images.value.splice(index, 1);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    handleSend();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (replyTargetUser.value) {
      clearReplyTarget();
    } else if (!props.hideCollapseButton) {
      emit('collapse');
    }
  }
}

function resolveUploadedUrl(data: any): string {
  let url = '';
  if (typeof data === 'string') {
    url = data;
  } else if (data && typeof data === 'object') {
    url = data.url || data.pic || data.path || data.filename || '';
  }
  if (!url) throw new Error('上传图片失败：服务端未返回图片地址');
  if (url.startsWith('//')) url = `https:${url}`;
  else if (url.startsWith('/')) url = `https://image.coolapk.com${url}`;
  return url;
}

function buildFinalMessage(text: string): string {
  const base = text.trim();
  if (
    settingsStore.settings.publishDeviceSignature &&
    settingsStore.settings.deviceSignature &&
    base.length > 0
  ) {
    return `${base}\n来自 ${settingsStore.settings.deviceSignature.trim()}`;
  }
  return base;
}

function setReplyTarget(username?: string, replyId?: string | number) {
  if (!username) return;
  // 桌面回复使用浮层输入，避免浏览器把顶部编辑框滚入视口。
  if (!props.officialDetail && !floatingReplyComposer.value) {
    inlineComposerHeight.value = sectionRef.value?.querySelector<HTMLElement>('.inline-composer-layer')?.getBoundingClientRect().height || 0;
    floatingReplyComposer.value = true;
  }
  composerOpen.value = true;
  replyTargetUser.value = username;
  replyTargetId.value = replyId ? String(replyId) : '';
  nextTick(() => {
    inputRef.value?.focus({ preventScroll: true });
  });
}

function closeComposer() { composerOpen.value = false; clearReplyTarget(); }

function clearReplyTarget() {
  if (floatingReplyComposer.value) { floatingReplyComposer.value = false; composerOpen.value = false; }
  replyTargetUser.value = '';
  replyTargetId.value = '';
}

/** 只合并回复所属楼层，不清空主评论和已加载的楼中楼分页。 */
async function updateRepliedFloor(feedId: string, replyId: string, returnedReply: any) {
  if (String(props.feedId) !== feedId) return;
  const floor = nestedComments.value.find(item => String(item.id) === replyId || getSubReplyRows(item).some(sub => String(sub.id) === replyId));
  if (!floor) return;
  const floorId = subReplyFloorId(floor);
  try {
    const hasReplyData = returnedReply && !Array.isArray(returnedReply) && returnedReply.id;
    const rows = hasReplyData ? [returnedReply] : getReplyData(await CoolapkTauriAPI.getSubReplies(feedId, floorId, 1, { lastItem: '' }));
    if (String(props.feedId) !== feedId) return;
    const state = ensureSubReplyState(floor);
    if (!state) return;
    // 成功返回的回复直接追加；接口未返回回复内容时，仅补取当前楼层第一页。
    updateSubReplyState(floorId, { items: mergeReplies(state.items, rows).map(mergeReplyDetail) });
    expandedFloorIds.value = new Set([...expandedFloorIds.value, floorId]);
  } catch (error) {
    logDiagnostic('warn', 'comment', 'reply_floor_refresh_failed', summarizeDiagnosticError(error));
  }
}

function handleClickOutside(event: MouseEvent) {
  if (showEmojiPicker.value && emojiContainerRef.value && !emojiContainerRef.value.contains(event.target as Node) && !officialEmojiPanelRef.value?.contains(event.target as Node)) {
    showEmojiPicker.value = false;
  }
}

function handleContextReplyComment(event: Event) {
  const detail = (event as CustomEvent<{ feedId?: string | number; username?: string; commentId?: string | number }>).detail;
  if (String(detail?.feedId || '') !== String(props.feedId || '')) return;
  setReplyTarget(detail?.username || '酷友', detail?.commentId);
}

function bindGlobalListeners() {
  // 捕获阶段先判断面板外部点击，避免评论卡片的 @click.stop 阻断关闭。
  window.addEventListener('click', handleClickOutside, true);
  window.addEventListener('coolapk-context-reply-comment', handleContextReplyComment);
}

function unbindGlobalListeners() {
  window.removeEventListener('click', handleClickOutside, true);
  window.removeEventListener('coolapk-context-reply-comment', handleContextReplyComment);
}

onMounted(() => {
  bindGlobalListeners();
  if (inputRef.value) {
    Object.defineProperty(inputRef.value, 'value', {
      get() {
        return inputMsg.value;
      },
      set(val: string) {
        inputMsg.value = String(val ?? '');
        syncMsgToEditor(String(val ?? ''));
      },
      configurable: true,
    });
  }
  void restoreDraft();
  void nextTick(refreshLoadMoreObserver);
});

function handleActivated() {
  bindGlobalListeners();
  void nextTick(refreshLoadMoreObserver);
}

function handleDeactivated() {
  unbindGlobalListeners();
  disconnectLoadMoreObserver();
}

onActivated(handleActivated);
onDeactivated(handleDeactivated);
onUnmounted(() => {
  unbindGlobalListeners();
  disconnectLoadMoreObserver();
});

function handleCommentTextClick(e: MouseEvent, c: any) {
  // 选中文本准备复制时，不触发点击回复
  if (hasActiveTextSelection()) return;
  // 点中了评论内的链接则交给统一链接处理，否则视为点击评论（设置为回复对象）
  if ((e.target as HTMLElement).closest('a')) {
    if (handleCommentMoreClick(e, c)) return;
    handleAnchorClick(e);
    return;
  }
  setReplyTarget(c.username || c.userInfo?.username, c.id);
}

function handleSubReplyTextClick(e: MouseEvent, sub: any) {
  if (!handleCommentMoreClick(e, sub)) handleAnchorClick(e);
}

function handleCommentMoreClick(e: MouseEvent, comment: any): boolean {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor?.textContent?.trim().includes('查看更多')) return false;
  e.preventDefault();
  e.stopPropagation();
  const replyId = String(comment?.id ?? '').trim();
  const feedId = String(props.feedId ?? '').trim();
  // 只记录所属动态和评论 ID，便于从用户诊断日志定位原文章，不记录正文。
  logDiagnostic('info', 'comment', 'expand_requested', `feed_id=${feedId} reply_id=${replyId}`);
  if (!replyId) return true;
  // 评论的“查看更多”指向评论 ID，必须读取评论详情，不能作为动态 ID 打开。
  void CoolapkTauriAPI.getReplyDetail(replyId).then((response: any) => {
    const message = response?.data?.message;
    if (typeof message !== 'string' || !message.trim() || hasFeedMoreSuffix(message)) throw new Error('评论详情没有返回完整正文');
    replyDetails.value = { ...replyDetails.value, [replyId]: { ...replyDetails.value[replyId], ...response.data } };
    logDiagnostic('info', 'comment', 'expand_succeeded', `feed_id=${feedId} reply_id=${replyId}`);
  }).catch((error: unknown) => {
    logDiagnostic('warn', 'comment', 'expand_failed', `feed_id=${feedId} reply_id=${replyId} reason=${summarizeDiagnosticError(error)}`);
    showToast('加载完整评论失败，请稍后重试', 'error');
  });
  return true;
}

function openCommentUser(comment: any) {
  const uid = normalizeUserUid(comment.uid || comment.fromUid || comment.userId || comment.userInfo?.uid);
  if (uid) void router.push(`/user/${encodeURIComponent(uid)}`);
}

function handleSubReplyClick(e: MouseEvent, sub: any, floor: any) {
  // 选中文本准备复制时，不触发点击回复
  if (hasActiveTextSelection()) return;
  const target = e.target as HTMLElement;
  if (target.closest('a') || target.closest('button') || target.closest('.comment-image-grid')) return;
  setReplyTarget(sub.username || sub.fromUserName, sub.id || floor.id);
}

/**
 * 判断是否为原动态作者 (楼主)
 */
function isAuthor(commentItem: any) {
  const authorUid = String(props.feedUid || '');
  const authorName = String(props.feedUsername || '');
  const itemUid = getCommentUid(commentItem);
  const itemName = String(commentItem.username || commentItem.userInfo?.username || '');

  if ([commentItem.isAuthor, commentItem.is_author, commentItem.isFeedAuthor].some(value => Number(value) === 1)) {
    return true;
  }

  if (authorUid && itemUid) return authorUid === itemUid;
  if (authorName && itemName && authorName === itemName) return true;
  return false;
}

function collectAuthorReplies(items: any[]): any[] {
  const result: any[] = [];
  items.forEach((item) => {
    const children = Array.isArray(item?.replyRows) ? item.replyRows : [];
    if (isAuthor(item)) {
      const authorChildren = collectAuthorReplies(children);
      result.push({ ...item, replyRows: authorChildren, replyRowsCount: authorChildren.length });
    } else {
      result.push(...collectAuthorReplies(children));
    }
  });
  return result;
}

function filterAuthorOnlyComments(comments: any[]): any[] {
  const result: any[] = [];
  comments.forEach((floor) => {
    const authorReplies = collectAuthorReplies(Array.isArray(floor.replyRows) ? floor.replyRows : []);
    if (isAuthor(floor)) {
      result.push({ ...floor, replyRows: authorReplies, replyRowsCount: authorReplies.length });
    } else if (authorReplies.length > 0) {
      result.push({ ...floor, replyRows: authorReplies, replyRowsCount: authorReplies.length, authorOnlyContext: true });
    }
  });
  return result;
}

const sectionRef = ref<HTMLElement | null>(null);
const targetComments = ref<any[]>([]);
const targetReplyError = ref('');
let targetRequest = 0;
let scrolledTarget = '';

/**
 * 自动树形构建算法 (Tree Aggregation)：
 * 将平铺的回复数组聚合成真实的【一级楼层 -> 二级楼中楼 (replyRows)】嵌套树！
 */
const nestedComments = computed(() => {
  const comments = mergeReplies(props.comments || [], targetComments.value);
  if (!comments.length) return [];

  const topMap = new Map<string, any>();
  const topList: any[] = [];
  const orphanSubs: any[] = [];

  // 第一遍扫描：识别一级楼层与已有 replyRows
  const feedIdStr = String(props.feedId || '');

  comments.forEach((rawItem) => {
    const enrichedItem = mergeReplyDetail(rawItem);
    const item = {
      ...enrichedItem,
      replyRows: Array.isArray(enrichedItem.replyRows)
        ? enrichedItem.replyRows.map(mergeReplyDetail)
        : Array.isArray(enrichedItem.rlist)
          ? enrichedItem.rlist.map(mergeReplyDetail)
          : [],
    };

    const ridStr = String(item.rid || '0');
    const rridStr = String(item.rrid || '0');

    // 只有当 rid/rrid 既不为 '0' 也不等于原动态 feedId 时，才是楼中楼二层回复
    const isSub = Boolean(
      (rridStr !== '0' && rridStr !== feedIdStr) ||
      (ridStr !== '0' && ridStr !== feedIdStr)
    );

    if (!isSub) {
      topMap.set(String(item.id), item);
      topList.push(item);
    } else {
      orphanSubs.push(item);
    }
  });

  // 第二遍扫描：将游离的二级回复按 parent ID (rid/rrid) 挂载到父级楼层中
  orphanSubs.forEach((subItem) => {
    const parentId = String(subItem.rrid || subItem.rid || '');
    if (parentId && topMap.has(parentId)) {
      const parent = topMap.get(parentId);
      parent.replyRows = mergeReplies(parent.replyRows, [subItem]);
    } else {
      // 如果找不到父级，自身升格为楼层，但内嵌其回复关系
      topList.push({
        ...subItem,
        replyRows: subItem.replyRows || []
      });
    }
  });

  // 楼中楼接口返回的数据保存在组件本地，不能直接改写只读 props；
  // 在树构建阶段合并，保证楼主筛选、详情补齐和渲染都能看到已加载的子回复。
  topList.forEach((floor) => {
    const floorId = subReplyFloorId(floor);
    const state = floorId ? subReplyStates.value[floorId] : undefined;
    if (state?.items.length) {
      floor.replyRows = mergeSubReplyRows(floor.replyRows, state.items);
    }
  });

  return topList;
});

const sortedComments = computed(() => {
  // 应用页通过官方 listType 请求排序，不能再按全局评论设置重排。
  if (props.preserveApiOrder) return nestedComments.value;
  const visibleComments = authorOnly.value ? filterAuthorOnlyComments(nestedComments.value) : nestedComments.value;
  // APK 的楼主筛选由 fromFeedAuthor=1 决定顺序，不叠加当前排序按钮的本地排序。
  return authorOnly.value ? visibleComments : sortComments(visibleComments, commentSortMode.value);
});

// 同一回复可能同时出现在楼中楼预览和完整楼层中，只突出更紧凑的楼中楼目标。
const hasInlineTargetReply = computed(() => Boolean(props.targetReplyId) && sortedComments.value.some(
  floor => getVisibleSubReplies(floor).some(reply => String(reply.id) === props.targetReplyId),
));

async function loadTargetReply() {
  const request = ++targetRequest;
  const replyId = props.targetReplyId;
  const feedId = String(props.feedId || '');
  targetComments.value = [];
  targetReplyError.value = '';
  scrolledTarget = '';
  if (!replyId || !feedId) return;
  try {
    const response = await CoolapkTauriAPI.getReplyDetail(replyId);
    if (request !== targetRequest) return;
    const reply = response?.data;
    if (String(reply?.id || '') !== replyId) throw new Error('这条评论不存在或已被删除');
    const replyFeedId = String(reply.feedId || reply.feed_id || '');
    if (replyFeedId && replyFeedId !== feedId) throw new Error('这条评论不属于当前动态');
    // rrid 表示根楼层，rid 表示被回复的评论；根楼层不在首屏时单独补齐。
    const parentId = String(reply.rrid && String(reply.rrid) !== '0' ? reply.rrid : reply.rid || '');
    let parent: any = null;
    if (parentId && parentId !== '0' && parentId !== feedId && parentId !== replyId) {
      const parentResponse = await CoolapkTauriAPI.getReplyDetail(parentId);
      if (request !== targetRequest) return;
      parent = parentResponse?.data;
      if (String(parent?.id || '') !== parentId) throw new Error('评论所在楼层不存在或已被删除');
      expandedFloorIds.value = new Set([...expandedFloorIds.value, parentId]);
    }
    authorOnly.value = false;
    targetComments.value = parent ? [parent, reply] : [reply];
  } catch (error) {
    if (request === targetRequest) targetReplyError.value = error instanceof Error ? error.message : '目标评论加载失败';
  }
}

watch([() => props.feedId, () => props.targetReplyId], () => { void loadTargetReply(); }, { immediate: true });
onUnmounted(() => { targetRequest++; });

async function scrollToTargetReply() {
  const key = `${props.feedId}:${props.targetReplyId}`;
  if (!props.targetReplyId || props.loading || scrolledTarget === key) return;
  await nextTick();
  const target = sectionRef.value?.querySelector<HTMLElement>('.notification-comment-target');
  if (!target) return;
  target.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  scrolledTarget = key;
}
watch([sortedComments, () => props.loading, () => props.error], () => { void scrollToTargetReply(); }, { flush: 'post' });
onActivated(() => { scrolledTarget = ''; void scrollToTargetReply(); });

const commentCount = computed(() => {
  const total = props.totalCommentCount;
  if (total !== undefined && total !== null && total !== '') {
    const parsed = Number(total);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return nestedComments.value.length;
});

watch(
  [
    () => props.hasMoreComments,
    () => props.loadingMoreComments,
    () => props.loadMoreError,
    () => sortedComments.value.length,
  ],
  () => {
    void nextTick(refreshLoadMoreObserver);
  },
  { flush: 'post' },
);

async function handleSend() {
  const rawMsg = inputMsg.value.trim();
  if (!rawMsg && images.value.length === 0) return;
  if (sending.value) return;

  if (!authStore.isLoggedIn) {
    authStore.openLoginModal();
    return;
  }

  const currentFeedId = props.feedId;
  if (!currentFeedId) {
    emit('send-comment', rawMsg);
    inputMsg.value = '';
    images.value = [];
    clearReplyTarget();
    return;
  }

  const proceedSubmit = async () => {
    sending.value = true;
    imageUploadTotal.value = images.value.filter(image => !image.url && image.file).length;
    uploadingImages.value = imageUploadTotal.value > 0;
    uploadedCount.value = 0;

    try {
      let pic = '';
      if (images.value.length > 0) {
        const urls: string[] = [];
        for (const img of images.value) {
          if (img.url) { urls.push(img.url); continue; }
          if (!img.file) throw new Error('评论图片尚未准备好');
          const bytes = new Uint8Array(await img.file.arrayBuffer());
          const contentType = img.file.type || 'image/jpeg';
          const res = await CoolapkTauriAPI.uploadImage(bytes, img.file.name, contentType, 'feed');
          img.url = resolveUploadedUrl(res?.data);
          urls.push(img.url);
          uploadedCount.value += 1;
        }
        pic = urls.join(',');
      }

      // 官方 ReplyActivity 为纯图片回复补上 [图片]，服务端不接受空正文。
      const finalMessage = buildFinalMessage(rawMsg || (pic ? '[图片]' : ''));
      const targetRid = replyTargetId.value || undefined;

      const executeReply = async (postToken?: string) => {
        if (postToken) {
          return await CoolapkTauriAPI.replyFeed(
            String(currentFeedId),
            finalMessage,
            targetRid,
            pic || undefined,
            postToken
          );
        }
        return await CoolapkTauriAPI.replyFeed(
          String(currentFeedId),
          finalMessage,
          targetRid,
          pic || undefined
        );
      };

      let res: any;
      try {
        res = await executeReply();
      } catch (err: any) {
        const captchaParams = extractCaptchaParamsFromResponse(err);
        if (captchaParams?.captchaId) {
          showToast('正在调起安全滑块验证...', 'info');
          const token = await verifyWithCaptcha(captchaParams.captchaId);
          res = await executeReply(token);
        } else if (isRiskControlError(err)) {
          showToast('酷安服务端风控拦截（需官方设备认证），发表失败', 'error');
          openShuzilmGuide({
            reason: 'risk_controlled',
            message: '请求被酷安服务端拦截。请到设备信息设置粘贴手机官方酷安复制的设备日志，保存后重试。',
            onConfirmContinue: () => {
              void proceedSubmit();
            },
          });
          return;
        } else {
          throw err;
        }
      }

      if (res && res.code !== 200) {
        const captchaParams = extractCaptchaParamsFromResponse(res);
        if (captchaParams?.captchaId) {
          showToast('正在调起安全滑块验证...', 'info');
          const token = await verifyWithCaptcha(captchaParams.captchaId);
          res = await executeReply(token);
        } else if (isRiskControlError(res)) {
          showToast('酷安服务端风控拦截（需官方设备认证），发表失败', 'error');
          openShuzilmGuide({
            reason: 'risk_controlled',
            message: '请求被酷安服务端拦截。请到设备信息设置粘贴手机官方酷安复制的设备日志，保存后重试。',
            onConfirmContinue: () => {
              void proceedSubmit();
            },
          });
          return;
        }
      }

      if (res && res.code === 200) {
      await clearCommentDraft(currentDraftAccount(), currentFeedId, targetRid);
      inputMsg.value = '';
      if (inputRef.value) {
        inputRef.value.innerHTML = '';
      }
      images.value = [];
      clearReplyTarget();
      if (props.officialDetail) composerOpen.value = false;
      showEmojiPicker.value = false;
      showToast('评论发表成功');
      emit('send-comment', rawMsg);
      // 楼中楼回复只补齐当前楼层，保留主评论分页和已展开的楼层。
      if (targetRid) await updateRepliedFloor(String(currentFeedId), targetRid, res.data);
      else emit('retry-comments');
    } else {
      showToast(res?.message || '评论发表失败', 'error');
    }
  } catch (err: any) {
    showToast(getErrorMessage(err, '发表评论异常'), 'error');
  } finally {
    uploadingImages.value = false;
    sending.value = false;
  }
  };

  // 未设置设备 ID 时先让用户在弹窗中粘贴官方日志，保存后继续评论。
  if (!settingsStore.settings.deviceFingerprint.deviceId?.trim() && !(await hasActiveShuzilmDeviceId())) {
    openShuzilmGuide({ reason: 'missing_id', onConfirmContinue: () => { void proceedSubmit(); } });
    return;
  }
  await proceedSubmit();
}
</script>

<style scoped>
.notification-comment-target {
  background: var(--primary-light, rgba(0, 190, 100, 0.1));
  outline: 2px solid var(--primary-color, #00b968);
  outline-offset: -2px;
  border-radius: 8px;
  scroll-margin-block: 80px;
}
.official-detail-comments { margin: 0 !important; padding: 0 16px 16px !important; border: 0 !important; border-radius: 0 !important; background: var(--surface) !important; }
.official-detail-comments .comment-toolbar { position: sticky; top: 60px; z-index: 5; background: var(--surface); padding: 8px 0 12px; border: 0; scroll-margin-top: 70px; }
.official-detail-comments .comment-toolbar-left { width: 100%; display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 8px; }
.official-detail-comments .comment-title { font-size: 14px; font-weight: 400; white-space: nowrap; }
.official-detail-comments .comment-sort { display: flex; background: var(--surface-hover); border-radius: 24px; padding: 2px; gap: 0; }
.official-detail-comments .comment-sort-button { min-width: 0; font-size: 12px; padding: 5px 9px; border: 0; border-radius: 24px; background: transparent; box-shadow: none; }
.official-detail-comments .comment-sort-button.is-active { background: var(--surface); color: var(--text-primary); }
.official-detail-comments .comment-row { padding: 10px 0 16px; border: 0; gap: 10px; background: transparent; }
.official-detail-comments .comment-main { display: grid; grid-template-columns: minmax(0, 1fr) auto; min-width: 0; gap: 0; }
.official-detail-comments .comment-meta { grid-row: 1; grid-column: 1 / -1; }
.official-detail-comments .comment-username { color: var(--brand-primary); font-size: 14px; font-weight: 400; }
.official-detail-comments .level-tag, .official-detail-comments .verify-tag { display: none; }
.official-detail-comments .comment-text { grid-row: 2; grid-column: 1 / -1; font-size: 15px; line-height: 1.65; margin: 4px 0 10px; }
.official-detail-comments .comment-detail-row > .comment-device, .official-detail-comments .comment-detail-row > .comment-secondary-meta { display: none; }
.official-detail-comments .comment-image-grid { grid-row: 3; grid-column: 1 / -1; }
.official-detail-comments .comment-detail-row { grid-row: 4; grid-column: 1; color: var(--text-tertiary); font-size: 11px; align-self: center; }
.official-detail-comments .comment-actions { grid-row: 4; grid-column: 2; justify-content: flex-end; margin: 0; gap: 14px; }
.official-detail-comments .comment-actions button { font-size: 11px; color: var(--text-tertiary); }
/* 已点赞状态优先于详情按钮的默认灰色，图标与计数一起沿用主题色。 */
.official-detail-comments .comment-like-btn.is-liked { color: var(--brand-primary); }
.official-detail-comments .comment-actions i { font-size: 18px; }
.official-detail-comments .sub-reply-thread { grid-row: 5; grid-column: 1 / -1; margin: 12px 0 0; }
.official-detail-comments .sub-reply-thread { border: 0; padding: 8px; border-radius: 8px; background: var(--surface-hover); }
.official-detail-comments .sub-reply-row { display: block; padding: 2px 0; }
.official-detail-comments .sub-reply-avatar, .official-detail-comments .sub-reply-row .user-hover-trigger:has(.sub-reply-avatar), .official-detail-comments .sub-detail-row, .official-detail-comments .sub-reply-actions { display: none; }
.official-detail-comments .sub-reply-main { display: block; }
.official-detail-comments .sub-reply-meta { display: inline; font-size: 14px; line-height: 1.65; }
.official-detail-comments .sub-reply-meta :deep(.user-hover-trigger) { display: inline; }
.official-detail-comments .sub-target-user { color: var(--brand-primary); }
.official-detail-comments .sub-user { color: var(--brand-primary); font-weight: 400; }
.official-detail-comments .sub-reply-text { display: inline; font-size: 14px; line-height: 1.65; }
.official-detail-comments .sub-reply-text::before { content: '：'; }
.inline-composer-layer { display: contents; }
/* 挂在 body 上，避免帖子容器的变换/裁切和桌面侧栏遮挡；使用键盘上方的可视视口。 */
.official-composer-layer { position: fixed; left: 0; right: 0; top: var(--app-viewport-top, 0px); height: var(--app-viewport-height, 100dvh); z-index: 1100; display: flex; flex-direction: column; justify-content: flex-end; pointer-events: none; }
.official-composer-layer .comment-composer-box { position: relative; z-index: 1; flex-shrink: 0; display: flex; flex-direction: column; width: 100%; box-sizing: border-box; margin: 0; max-height: calc(100% - 16px); overflow-y: auto; border-radius: 18px 18px 0 0; padding: 30px max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); background: var(--surface); box-shadow: 0 -4px 28px #0002; pointer-events: auto; }
.official-composer-layer .comment-composer-toolbar { flex-shrink: 0; }
.official-composer-layer .comment-rich-editor { flex-shrink: 0; min-height: 52px; max-height: min(120px, calc(var(--app-viewport-height, 100dvh) * .2)); }
.official-composer-layer .comment-media-preview { flex-shrink: 0; max-height: 76px; overflow-y: auto; }
.official-composer-emoji { height: min(320px, calc(var(--app-viewport-height, 100dvh) * .4)); min-height: 0; flex-shrink: 1; margin-top: 8px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.official-composer-emoji :deep(.categorized-emoji-panel) { height: 100%; }
.desktop-reply-composer .comment-composer-box { width: min(640px, 100%); align-self: center; }
.official-composer-backdrop { position: absolute; inset: 0; background: #0006; pointer-events: auto; }
.official-composer-close { position: absolute; right: 10px; top: 4px; width: 30px; height: 30px; border: 0; background: transparent; color: var(--text-secondary); font-size: 18px; }
.feed-comment-section {
  margin-top: 14px;
  padding: 14px;
  background: var(--background);
  border-radius: var(--radius-card);
  border: 1px solid var(--border-light);
}

/* 话题与分栏详情复用同一套侧栏评论间距和背景。 */
.feed-comment-section.aside-comments { margin-top: 0; padding: 0; background: transparent; border: none; box-shadow: none; }

.comment-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.comment-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.comment-toolbar-collapse-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast);
  margin-left: auto;
}

.comment-toolbar-collapse-btn:hover {
  color: var(--brand-primary);
  border-color: var(--brand-primary);
  background: var(--brand-soft);
}

.comment-title {
  color: var(--text-primary);
  font-size: 0.95rem;
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
}

.comment-title span {
  color: var(--text-tertiary);
  font-size: 0.78rem;
  font-weight: 500;
}

.comment-sort {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-muted, var(--surface));
  border: 1px solid var(--border-light);
  overflow-x: auto;
  scrollbar-width: none;
  max-width: 100%;
}

.comment-sort-button {
  border: 0;
  border-radius: 999px;
  padding: 5px 12px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 0.78rem;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  line-height: 1.4;
  transition: color var(--duration-fast), background var(--duration-fast), box-shadow var(--duration-fast);
}

.comment-sort-button:hover {
  color: var(--text-primary);
}

.comment-sort-button.is-active {
  color: var(--brand-primary);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  font-weight: 600;
}

/* 输入框与评论发布工具栏 */
.comment-composer-box {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card, 12px);
  padding: 10px 12px;
  margin-bottom: 14px;
  /* 键盘弹出时给编辑框下方留出键盘高度，保证表情/图片/发送按钮不被遮挡。 */
  scroll-margin-bottom: calc(var(--keyboard-inset, 0px) + 16px);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

/* 绿色聚焦边框只用于内联输入框，浮层保留自身的普通边框和阴影。 */
.inline-composer-layer .comment-composer-box:focus-within {
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 2px var(--brand-soft);
}

.comment-reply-target-bar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 3px 8px;
  background: var(--brand-soft);
  color: var(--brand-primary);
  border-radius: var(--radius-xs, 4px);
  font-size: 0.78rem;
  margin-bottom: 6px;
}

.comment-reply-target-bar .reply-target-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.comment-reply-target-bar .reply-target-name {
  font-weight: 600;
}

.reply-target-clear-btn {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0 2px;
  font-size: 0.75rem;
  display: inline-flex;
  align-items: center;
  transition: color var(--duration-fast);
}

.reply-target-clear-btn:hover {
  color: var(--danger, #f04444);
}

.comment-textarea {
  width: 100%;
  border: none;
  outline: none;
  resize: vertical;
  min-height: 52px;
  max-height: 160px;
  background: transparent;
  font-size: 0.88rem;
  line-height: 1.55;
  color: var(--text-primary);
  font-family: inherit;
}

.comment-textarea::placeholder {
  color: var(--text-tertiary);
}

/* 媒体缩略图预览 */
.comment-media-preview {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  margin-bottom: 4px;
}

.comment-media-thumb {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
  border: 1px solid var(--border-light);
  background: var(--background);
}

.comment-media-thumb :deep(.app-image-container), .comment-media-thumb :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.comment-media-remove-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border: none;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast);
}

.comment-media-remove-btn:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.85);
}

.comment-media-remove-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.comment-uploading-tip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--text-secondary);
  align-self: center;
}

/* 工具栏 */
.comment-composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-light);
  position: relative;
}

.composer-tools-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.composer-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-control, 6px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: color var(--duration-fast), background var(--duration-fast);
}

.composer-tool-btn:hover,
.composer-tool-btn.is-active {
  color: var(--brand-primary);
  background: var(--brand-soft);
}

.composer-tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.emoji-picker-container {
  position: relative;
}

.emoji-picker-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 120;
  width: min(360px, calc(100vw - 32px));
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card, 12px);
  box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.15));
  padding: 0;
}

.emoji-section-title {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  padding: 4px 4px 6px 4px;
  user-select: none;
  font-weight: 500;
  line-height: 1;
}

.emoji-section-title:not(:first-child) {
  margin-top: 8px;
}

.emoji-grid-recent {
  margin-bottom: 2px;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}

.emoji-item-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 2px;
  border: none;
  border-radius: var(--radius-xs, 4px);
  background: transparent;
  cursor: pointer;
  transition: background var(--duration-fast), transform var(--duration-fast);
}

.emoji-item-btn:hover {
  background: var(--surface-hover, rgba(0, 0, 0, 0.05));
  transform: scale(1.15);
}

.emoji-item-btn img {
  width: 24px;
  height: 24px;
  object-fit: contain;
  pointer-events: none;
}

.composer-tools-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.comment-word-count {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

/* 加载与空提示 */
.comment-loading,
.comment-error,
.comment-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 0;
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.comment-error { gap: 8px; color: var(--danger); }
.comment-error button { padding: 4px 10px; color: var(--brand-primary); background: var(--brand-soft); border: 0; border-radius: var(--radius-control); cursor: pointer; }

.empty-icon {
  font-size: 1.1rem;
}

.text-green {
  color: var(--brand-primary);
}

/* 评论列表 */
.comment-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.comment-load-more {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0 2px;
  color: var(--text-tertiary);
  font-size: 0.8rem;
}

.comment-loading-more {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.comment-load-more-hint,
.comment-load-more-error {
  color: var(--text-tertiary);
}

.comment-load-more-error {
  border: 0;
  padding: 4px 10px;
  background: var(--brand-soft);
  border-radius: var(--radius-control);
  cursor: pointer;
}

.comment-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.comment-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  cursor: pointer;
}

.comment-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.comment-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.82rem;
}

.comment-username {
  font-weight: 700;
  color: var(--text-primary);
  cursor: pointer;
}

.comment-username:hover {
  color: var(--brand-primary);
}

/* 楼主 Badge 标签 (微博/酷安 风格高亮) */
.badge-author {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.68rem;
  background: var(--brand-primary);
  color: var(--text-inverse, #ffffff);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  font-weight: 600;
  line-height: 1.3;
}

.author-filter-context-label {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  background: var(--background-secondary);
  font-size: 0.68rem;
  line-height: 1.3;
}

.badge-author.sub-badge {
  font-size: 0.65rem;
  padding: 0 4px;
  margin-right: 4px;
}

.badge-identity {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 1px 5px;
  border: 1px solid currentColor;
  border-radius: var(--radius-xs);
  color: var(--brand-primary);
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.3;
}

.badge-identity.sub-badge {
  padding: 0 4px;
  font-size: 0.65rem;
}

.level-tag {
  font-size: 0.68rem;
  background: var(--background-secondary);
  color: var(--text-secondary);
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
}

.verify-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: min(280px, 45vw);
  padding: 1px 7px;
  border-radius: 999px;
  background: #fff6e8;
  color: #d87a00;
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.comment-detail-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px 9px;
  min-height: 18px;
}

.sub-detail-row {
  margin-top: 1px;
}

.comment-time-button,
.comment-device,
.comment-secondary-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.76rem;
  color: var(--text-tertiary);
}

.comment-time-button {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  transition: color var(--duration-fast);
}

.comment-time-button:hover {
  color: var(--brand-primary);
}

.comment-device {
  max-width: min(210px, 40vw);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.72rem;
  opacity: 0.82;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--duration-fast), opacity var(--duration-fast);
}

.comment-device:hover {
  color: var(--text-secondary);
  opacity: 1;
}

.comment-device i {
  font-size: 0.68rem;
}

.comment-image-grid {
  align-self: flex-start;
}

.sub-comment-images {
  max-width: 360px;
}

.comment-text {
  font-size: 0.88rem;
  color: var(--text-primary);
  line-height: 1.6;
  word-break: break-word;
  cursor: pointer;
  user-select: text;
}

.comment-text *,
.sub-reply-text,
.sub-reply-text * {
  user-select: text;
}

.comment-text :deep(a.coolapk-user-link),
.sub-reply-text :deep(a.coolapk-user-link) {
  color: var(--brand-primary);
  font-weight: 400;
}

.comment-actions,
.sub-reply-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 5px;
}

.comment-like-btn,
.comment-reply-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.4;
  cursor: pointer;
  transition: color 0.15s ease, transform 0.15s ease;
}

.comment-like-btn:hover,
.comment-reply-btn:hover,
.comment-like-btn.is-liked {
  color: var(--brand-primary);
}

.comment-delete-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.4;
  cursor: pointer;
  transition: color 0.15s ease;
}

.comment-delete-btn:hover {
  color: var(--danger);
}

.sub-delete-btn {
  font-size: 0.7rem;
}

.comment-like-btn.is-liked i {
  animation: comment-like-pop 0.25s ease;
}

.comment-like-btn:disabled {
  cursor: wait;
  opacity: 0.7;
}

.sub-reply-actions {
  margin-top: 3px;
}

.sub-like-btn {
  font-size: 0.7rem;
}

@keyframes comment-like-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

/* 竖线多层级楼中楼 (Threaded Sub-replies) */
.sub-reply-thread {
  margin-top: 8px;
  margin-left: 4px;
  padding-left: 14px;
  border-left: 2px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sub-reply-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--duration-fast);
}

.sub-reply-row:hover {
  background: var(--surface-hover);
}

.sub-reply-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  margin-top: 2px;
}

.sub-reply-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sub-reply-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 0.8rem;
}

.sub-user {
  font-weight: 700;
  color: var(--text-primary);
}

.sub-reply-to {
  color: var(--text-tertiary);
  margin: 0 2px;
}

.sub-target-user {
  color: var(--text-primary);
  font-weight: 400;
}

.sub-reply-text {
  font-size: 0.85rem;
  color: var(--text-primary);
  line-height: 1.55;
  word-break: break-word;
}

.sub-more-btn-wrap {
  margin-top: 4px;
  padding-left: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sub-reply-status,
.sub-reply-error {
  margin: 4px 0 0 4px;
  font-size: 0.78rem;
  color: var(--text-tertiary);
}

.sub-reply-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* 可点击的展开/收起按钮样式 */
.sub-more-btn {
  border: 0;
  background: transparent;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.78rem;
  color: var(--brand-primary);
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: var(--duration-fast);
}

.sub-more-btn:hover {
  background: var(--brand-soft);
}

.sub-collapse-btn {
  color: var(--text-tertiary);
  font-weight: 500;
}

.icon-arrow {
  font-size: 0.7em;
}

.icon-arrow {
  font-size: 0.7em;
}

:deep(.coolapk-emoji),
.comment-text :deep(.coolapk-emoji),
.sub-reply-text :deep(.coolapk-emoji) {
  width: 22px !important;
  height: 22px !important;
  max-width: 22px !important;
  max-height: 22px !important;
  min-width: 22px !important;
  min-height: 22px !important;
  display: inline-block !important;
  vertical-align: -4px !important;
  margin: 0 2px !important;
  object-fit: contain !important;
}

.comment-rich-editor {
  min-height: 52px;
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  cursor: text;
  box-sizing: border-box;
}

.comment-rich-editor:empty:before,
.comment-rich-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--text-tertiary, #969ba3) !important;
  pointer-events: none;
}

.comment-rich-editor :deep(.coolapk-emoji),
.comment-rich-editor img.coolapk-emoji {
  width: 22px !important;
  height: 22px !important;
  vertical-align: -4px !important;
  margin: 0 2px !important;
  display: inline-block !important;
  user-select: all !important;
  cursor: default;
}
</style>
