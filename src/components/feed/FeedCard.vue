<template>
  <!-- 卡片保留正常布局，离屏子树由 useViewportContent 回收，避免绘制跳过与高度测量反复影响滚动位置。 -->
  <article
    ref="cardRef"
    :style="viewportPlaceholderStyle"
    @click.capture="retainViewportContent"
    @pointerdown.capture="retainPointerContent"
    @selectstart.capture="retainViewportContent"
    @keydown.capture="retainViewportContent"
    @focusin="retainViewportContent"
    @contextmenu.capture="retainViewportContent"
    :class="['feed-card', { 'is-detail-mode': detailMode, 'is-official-mobile-detail': officialMobileDetail, 'has-user-cover': !!userCoverUrl, 'is-question-card': isQuestionCard, 'is-answer-card': isAnswerCard }]"
    :data-feed-id="feed.id"
    :data-feed-text="feed.message || feed.message_raw_output || ''"
    :data-feed-images="JSON.stringify(feedImages)"
    @click="handleCardClick"
  >
    <template v-if="renderViewportContent">
    <!-- 卡片顶部沉浸式个性空间背景图 -->
    <div v-if="!officialMobileDetail && userCoverUrl && !feedPluginUrl" class="card-cover-backdrop" aria-hidden="true">
      <AppImage :src="userCoverUrl" image-class="card-cover-image" fit="cover" />
      <div class="card-cover-mask"></div>
    </div>

    <AppImage v-if="!officialMobileDetail && feedPluginUrl" :src="feedPluginUrl" class="feed-plugin-decoration" fit="contain" aria-hidden="true" />

    <div v-if="isPinnedFeed" class="feed-pinned-label"><i class="fas fa-thumbtack" aria-hidden="true"></i><span>置顶</span></div>
    <!-- targetType 是关联标的标题，由下方关联卡片展示；头部只显示明确的推荐来源。 -->
    <div :class="{ 'official-detail-author': officialMobileDetail }">
    <button v-if="officialMobileDetail" class="official-back" type="button" aria-label="返回" @click.stop="navigateBack(router)"><i class="fas fa-arrow-left"></i></button>
    <FeedHeader
      :uid="authorUid"
      :avatar="feed.userAvatar || feed.userInfo?.userAvatar"
      :plugin-url="(feed.userInfo as any)?.avatar_plugin_url || (feed as any).avatar_plugin_url || (feed as any).userAvatarPluginUrl"
      :feed-plugin-url="feedPluginUrl"
      :username="feed.username || feed.userInfo?.username"
      :level="feed.userInfo?.level || feed.level"
      :gender="(feed.userInfo as any)?.gender ?? (feed as any).gender"
      :gender-title="(feed.userInfo as any)?.gender_title ?? (feed as any).gender_title ?? (feed.userInfo as any)?.age_group ?? (feed as any).age_group"
      :ip-location="(feed as any).ip_location || (feed as any).ipLocation || (feed as any).location || (feed as any).city || (feed as any).province || (feed.userInfo as any)?.ip_location || (feed.userInfo as any)?.city"
      :verify-title="feed.userInfo?.verify_title || feed.verifyTitle"
      :dateline="feed.dateline || feed.infoHtml"
      :device="feed.device_title || feed.deviceTitle"
      :self-only="Number(feed.publishStatus ?? feed.publish_status) === 1"
      :read-num="[feed.readNum, feed.read_num, feed.viewnum, feed.hitnum].find((count) => Number(count) > 0)"
      :rank-index="rankIndex"
      :recommend-source="feed.recommendSource"
      :show-device-info="showDeviceInfo"
      :entity-type="feed.entityType"
      :entity-id="feed.entityId || feed.id"
      :question-mode="isQuestionCard || isAnswerCard"
      :is-edited="isEdited"
      :show-edit-status="!officialMobileDetail"
      @more="toggleMoreMenu"
      @edit-history="openHistoryDialog"
    >
      <template v-if="officialMobileDetail" #actions><button class="official-follow-author" :disabled="authorFollowPending" @click.stop="toggleAuthorFollow">{{ authorFollowing ? '已关注' : '关注' }}</button><button class="official-more" aria-label="更多选项" @click.stop="toggleMoreMenu"><i class="fas fa-ellipsis-vertical"></i></button></template>
    </FeedHeader>
    </div>

    <Teleport to="body" :disabled="officialMobileDetail">
    <div v-if="moreMenuOpen" class="more-menu-backdrop" :class="{ 'is-floating': !officialMobileDetail }" @click.stop="moreMenuOpen = false"></div>
    <div v-if="moreMenuOpen" ref="moreMenuRef" class="more-menu" :class="{ 'official-share-sheet': officialMobileDetail, 'is-floating': !officialMobileDetail }" :style="officialMobileDetail ? undefined : moreMenuStyle" @click.stop>
      <template v-if="officialMobileDetail">
        <div class="official-share-handle" aria-hidden="true"></div>
        <div class="official-share-tools">
          <button @click="copyFeed(false)"><span><i class="far fa-clone"></i></span>复制</button>
          <button @click="moreMenuOpen = false; toggleFav()"><span><i class="far fa-star"></i></span>{{ isFav ? '取消收藏' : '收藏' }}</button>
          <button @click="reportOfficialFeed"><span><i class="far fa-bell"></i></span>举报</button>
        </div>
        <div class="official-share-destinations">
          <button @click="moreMenuOpen = false; openForwardDialog()"><span><i class="far fa-pen-to-square"></i></span>动态</button>
          <button @click="openSharePrivate"><span><i class="far fa-envelope"></i></span>私信</button>
          <button @click="handleShareImage"><span><i class="far fa-image"></i></span>生成分享图</button>
          <button @click="openShareDyh"><span><i class="fas fa-circle-dot"></i></span>看看号</button>
          <button @click="copyFeed(true)"><span><i class="fas fa-link"></i></span>复制链接</button>
        </div>
      </template>
      <div v-else class="desktop-share-tools">
        <button @click="copyFeed(false)"><i class="far fa-copy"></i>复制</button>
        <button @click="moreMenuOpen = false; toggleFav()"><i class="far fa-star"></i>{{ isFav ? '取消收藏' : '收藏' }}</button>
        <button @click="reportOfficialFeed"><i class="fas fa-flag"></i>举报</button>
        <button @click="moreMenuOpen = false; openForwardDialog()"><i class="fas fa-retweet"></i>动态</button>
        <button @click="openSharePrivate"><i class="far fa-envelope"></i>私信</button>
        <button @click="openShareDyh"><i class="fas fa-circle-dot"></i>看看号</button>
        <button @click="copyFeed(true)"><i class="fas fa-link"></i>复制链接</button>
      </div>
      <button v-if="!officialMobileDetail" class="more-menu-item" @click="handleShareImage">
        <i class="fas fa-image"></i> 生成长图
      </button>
      <button v-if="isMyFeed" class="more-menu-item" :disabled="!canEditFeed" :title="canEditFeed ? '重新编辑动态' : '此动态当前不能编辑'" @click="handleEditFeed">
        <i class="fas fa-pen"></i> 重新编辑
      </button>
      <button v-if="canPinFeed" class="more-menu-item" :disabled="pinPending" @click="handlePinFeed">
        <i class="fas fa-thumbtack"></i> {{ isMemberPinned ? '取消置顶' : '置顶' }}
      </button>
      <button v-if="isMyFeed" class="more-menu-item is-danger" @click="handleDeleteFeed">
        <i class="fas fa-trash-alt"></i> 删除动态
      </button>
      <div v-if="!officialMobileDetail" class="more-menu-divider"></div>
      <!-- 点赞和转发列表入口放在省略号菜单末尾。 -->
      <button v-if="!officialMobileDetail" class="more-menu-item" @click="openInteractionListFromMoreMenu('likes')">
        <i class="far fa-heart"></i> 查看点赞用户
      </button>
      <button v-if="!officialMobileDetail" class="more-menu-item" @click="openInteractionListFromMoreMenu('forwards')">
        <i class="fas fa-retweet"></i> 查看转发列表
      </button>
      <button v-if="officialMobileDetail" class="official-share-cancel" @click="moreMenuOpen = false">取消</button>
    </div>
    </Teleport>

    <OfficialRatingDetailBody v-if="isRatingDetail" :feed="feed" />
    <FeedContent v-else
      :feed-id="feed.id"
      :title="feed.title || feed.message_title || feed.messageTitle"
      :message="feed.message || feed.message_raw_output"
      :username="feed.username || feed.userInfo?.username"
      :force-expanded="detailMode"
      :max-lines="maxLines"
      :highlight-keyword="highlightKeyword"
      :question-mode="isQuestionCard"
      :answer-mode="isAnswerCard"
    />

    <!-- 闲置价格不依赖外链；外部商品链接保留为显式按钮。 -->
    <div v-if="secondHandPrice || secondHandLink" class="secondhand-link-card">
      <div class="secondhand-link-copy">
        <strong v-if="secondHandPrice" class="secondhand-price">{{ secondHandPrice }}</strong>
        <span v-if="secondHandLink" class="secondhand-link-source"><i class="fas fa-link"></i>{{ secondHandLinkSource }}链接</span>
        <span v-if="secondHandLink" class="secondhand-link-description">查看闲置商品详情</span>
      </div>
      <button v-if="secondHandLink" type="button" class="secondhand-link-button" @click.stop="openSecondHandLink"><i class="fas fa-arrow-up-right-from-square"></i>打开</button>
    </div>

    <VoteCard v-if="feed.vote" :feed-id="feed.id" :vote="feed.vote" />

    <FeedVideoCard :feed="feed" />

    <FeedImageGrid
      v-model:image-ratios="feedImageRatios"
      :images="feedImages"
      :content-id="feed.id"
      content-type="feed"
    />

    <!-- 1. 被回复/转发的原动态 -->
    <!-- 1. 被回复/转发的原动态 -->
    <div
      v-if="isTargetFeed && targetRow"
      class="quoted-feed-box"
      @click.stop="openQuotedFeed"
    >
      <div class="quoted-header" v-if="quotedAuthor">
        <span class="quoted-author">@{{ quotedAuthor }}</span>
      </div>
      <div
        class="quoted-message"
        v-html="formattedQuotedMessage"
      ></div>
      <FeedImageGrid
        v-model:image-ratios="quotedImageRatios"
        v-if="quotedImages.length"
        :images="quotedImages"
        :content-id="targetRow?.id || targetRow?.entityId"
        :content-type="isTargetFeed ? 'feed' : 'reply'"
        variant="comment"
      />
    </div>

    <!-- 2. 关联的标的卡片（如机型“华为Pura70 Pro+”、应用、话题） -->
    <div v-if="targetObjectRows.length" class="feed-target-wrapper">
      <template v-for="(target, index) in targetObjectRows" :key="getTargetKey(target, index)">
      <OfficialFeedProductCard v-if="officialMobileDetail && isProductTarget(target)" :target="target" @open="openTarget" />
      <div
        v-else
        class="feed-target-chip" :class="{ 'rating-detail-target': isRatingDetail }"
        @click.stop="openTarget(target)"
        :title="getTargetTitle(target)"
      >
        <div class="target-chip-media" v-if="getTargetImage(target)">
          <AppImage
            :src="getTargetImage(target)"
            :alt="getTargetTitle(target)"
            image-class="target-chip-logo"
            fit="contain"
          />
        </div>
        <div v-else class="target-chip-icon">
          <i :class="targetIconClass(target)"></i>
        </div>
        <div class="target-chip-text">
          <span class="target-chip-title"><span v-if="isRatingDetail && !isProductTarget(target)" class="rating-target-type">话题</span>{{ getTargetTitle(target) || '关联内容' }}</span>
          <span v-if="getTargetSubtitle(target)" class="target-chip-subtitle">{{ getTargetSubtitle(target) }}</span>
        </div>
        <div v-if="isRatingDetail && Number(target.star_average_score) > 0" class="rating-target-score"><strong>{{ Number(target.star_average_score).toFixed(1) }}</strong><span><i v-for="value in 5" :key="value" class="fas fa-star" :class="{ active: value <= topicScoreStars(Number(target.star_average_score)) }"></i></span></div>
        <i v-else class="fas fa-chevron-right target-chip-arrow"></i>
      </div>
      </template>
    </div>

    <button v-if="!detailMode && mobileOfficialEnabled && officialHotReply" class="official-hot-reply" @click.stop="openOfficialDetail"><span class="hot-reply-likes">{{ officialHotReply.likenum || 0 }}赞</span><span class="hot-reply-copy"><span class="hot-reply-user">{{ officialHotReply.username || officialHotReply.userInfo?.username }}: </span><span v-html="formatRichText(String(officialHotReply.message || ''))"></span></span></button>
    <div v-if="hasQuestionStats" class="question-stats" aria-label="问答统计">
      <span><i class="fas fa-comment-dots" aria-hidden="true"></i>{{ questionAnswerCount }}人回答</span>
      <span aria-hidden="true">·</span>
      <span><i class="fas fa-user-group" aria-hidden="true"></i>{{ questionFollowCount }}人关注</span>
    </div>

    <p v-if="officialMobileDetail && (publishedLocation || isEdited)" class="official-published-location">
      <span v-if="publishedLocation">发布于{{ publishedLocation }}</span><span v-if="publishedLocation && isEdited"> · </span><button v-if="isEdited" type="button" class="official-edited-status" @click.stop="openHistoryDialog">已编辑</button>
    </p>
    <!-- 移动详情底栏脱离路由动画的 transform 和滚动裁剪，首屏即可固定在视口底部。 -->
    <Teleport to="body" :disabled="!officialMobileDetail">
      <FeedActionBar
        v-show="!officialMobileDetail || (componentActive && pageVisible && !hasBlockingOverlay)"
        :official-detail="officialMobileDetail"
        @write-comment="writeMobileComment"
        :feed-id="feed.id"
        :likenum="feed.likenum"
        :replynum="feed.replynum"
        :favnum="favnum"
        :sharenum="feed.sharenum"
        :favorited="isFav"
        :user-action="feed.userAction"
        @open-comment="officialMobileDetail ? scrollToMobileComments() : toggleComments()"
        @toggle-fav="toggleFav"
        @forward="openForwardDialog"
        @open-like-list="openLikeList"
        @open-forward-list="openForwardList"
      />
    </Teleport>

    <div v-if="showComments" class="inline-comment-wrapper" @click.stop="touchActiveComments(feed.id)">
      <FeedCommentSection
        ref="commentSectionRef"
        :target-reply-id="targetReplyId"
        :official-detail="officialMobileDetail"        :feed-id="feed.id"
        :feed-uid="authorUid"
        :feed-username="feed.username"
        :default-sort-mode="commentsSortMode"
        :total-comment-count="feed.replynum"
        :comments="comments"
        :pinned-comments="feed.topReplyRows || []"
        :loading="commentsLoading"
        :error="commentsError"
        :has-more-comments="hasMoreComments"
        :loading-more-comments="commentsLoadingMore"
        :load-more-error="commentsLoadMoreError"
        :normalize-img="normalizeImg"
        :format-rich-text="formatRichText"
        @collapse="handleCollapseComments"
        @delete-comment="removeComment"
        @retry-comments="openComments(true)"
        @load-more-comments="loadMoreComments"
        @retry-more-comments="loadMoreComments"
        @comment-sort-change="handleCommentSortChange"
      />
      <!-- 评论区右下角固定悬浮收起按钮（评论滑动时按钮固定在视口右下角纹丝不动） -->
      <Teleport to="body">
        <Transition name="floating-collapse-fade">
          <div
            v-if="isCommentsFloatingVisible"
            class="global-floating-comment-collapse"
            :style="floatingCollapseStyle"
            @click.stop="handleCollapseComments"
          >
            <button
              type="button"
              class="btn-floating-collapse"
              title="收起评论区"
            >
              <i class="fa-solid fa-chevron-up"></i>
              <span>收起评论</span>
            </button>
          </div>
        </Transition>
      </Teleport>
    </div>

    <FeedDyhShareDialog :is-open="dyhShareOpen" :feed-id="String(feed.id)" @close="dyhShareOpen = false" />
    <AppDialog :is-open="privateShareOpen" title="分享动态到私信" :width="420" @close="privateShareOpen = false">
      <LoadingState v-if="privateShareLoading" text="加载最近联系人..." />
      <p v-if="privateShareError">{{ privateShareError }}<button @click="openSharePrivate">重试</button></p>
      <button v-for="contact in privateShareContacts" :key="String(contact.uid)" class="official-share-contact" @click="shareToPrivate(contact)">{{ contact.username }}</button>
      <p v-if="!privateShareLoading && !privateShareError && !privateShareContacts.length">暂无最近联系人</p>
    </AppDialog>
    <ForwardDialog v-model:show="forwardOpen" :feed="feed" @success="handleForwardSuccess" />

    <FeedShareImageDialog v-model:show="shareImageOpen" :feed="feed" :images="feedImages" />

    <FeedInteractionListDialog
      :show="interactionMode !== null"
      :mode="interactionMode || 'likes'"
      :feed-id="feed.id"
      :feed-type="interactionFeedType"
      @update:show="closeInteractionDialog"
    />

    <AppDialog :is-open="historyDialogOpen" title="编辑记录" :width="680" @close="historyDialogOpen = false">
      <div class="history-dialog" @click.stop>
        <p class="history-description">动态每次修改的内容都会保留，当前版本显示在最上方。</p>
        <LoadingState v-if="historyLoading" text="正在加载编辑记录..." />
        <div v-else-if="historyError" class="history-status">
          <span>{{ historyError }}</span>
          <button type="button" @click="loadHistory">重试</button>
        </div>
        <div v-else-if="!historyList.length" class="history-status">暂无编辑记录</div>
        <div v-else class="history-list">
          <article v-for="(item, index) in historyList" :key="item.entityId || item.id || item.dateline || index" class="history-item">
            <div class="history-version-row">
              <div class="history-version-left">
                <span :class="['history-version', { 'is-current': isCurrentHistory(item, index) }]">
                  {{ formatHistoryVersion(item, index) }}
                </span>
                <span
                  v-if="getHistoryDiffBadge(item, index)"
                  :class="['history-diff-badge', `is-${getHistoryDiffBadge(item, index)?.type}`]"
                >
                  {{ getHistoryDiffBadge(item, index)?.text }}
                </span>
              </div>
              <time class="history-time">{{ formatHistoryDate(item) }}</time>
            </div>
            <h4 v-if="getHistoryTitle(item)" class="history-title">{{ getHistoryTitle(item) }}</h4>
            <div class="history-text diff-content-container" v-html="getHistoryDiffHtml(item, index)"></div>
            <FeedImageGrid :images="getHistoryImages(item)" />
          </article>
        </div>
      </div>
    </AppDialog>

    <FeedCollectionPickerDialog
      :is-open="collectionPickerOpen"
      :collections="collectionOptions"
      :selected-ids="collectionInitialSelectedIds"
      :loading="collectionPickerLoading"
      :submitting="collectionPickerSubmitting"
      :allow-empty-selection="favoritePickerOnRemove"
      @close="closeCollectionPicker"
      @confirm="confirmCollectionSelection"
    />
    </template>
  </article>
</template>

<script setup lang="ts">
import { htmlToPlainText } from '../../utils/htmlText';
import { isFeedEdited } from '../../utils/feedEditStatus';
import { computed, ref, watch, onMounted, nextTick, onUnmounted, onActivated, onDeactivated, inject } from 'vue';
import { useViewportContent } from '../../composables/useViewportContent';
import { feedPageVisibleKey, feedPageRenderKey } from '../../utils/feedPageVisibility';
import { useRouter } from 'vue-router';
import type { FeedItem } from '../../types/feed';
import { navigateBack } from '../../utils/navigation';
import { getNotificationFeedId, getNotificationReplyId } from '../../utils/notificationNavigation';
import { useOfficialMobileFeedDetail, useMobileLayout } from '../../composables/useOfficialMobileFeedDetail';
import { openDesktopFeedCommentsKey } from '../../utils/desktopFeedComments';
import OfficialFeedProductCard from './OfficialFeedProductCard.vue';
import FeedHeader from './FeedHeader.vue';
import FeedContent from './FeedContent.vue';
import OfficialRatingDetailBody from './OfficialRatingDetailBody.vue';
import { topicScoreStars } from '../../utils/topicRating';
import VoteCard from './VoteCard.vue';
import FeedImageGrid from './FeedImageGrid.vue';
import FeedVideoCard from './FeedVideoCard.vue';
import FeedActionBar from './FeedActionBar.vue';
import FeedCollectionPickerDialog from './FeedCollectionPickerDialog.vue';
import FeedCommentSection from './FeedCommentSection.vue';
import FeedInteractionListDialog from './FeedInteractionListDialog.vue';
import ForwardDialog from '../overlays/ForwardDialog.vue';
import FeedShareImageDialog from '../overlays/FeedShareImageDialog.vue';
import LoadingState from '../common/LoadingState.vue';
import AppDialog from '../common/AppDialog.vue';
import FeedDyhShareDialog from './FeedDyhShareDialog.vue';
import { useAndroidBackButton } from '../../utils/androidBackButton';
import AppImage from '../common/AppImage.vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { preloadUserProfile, reactiveUserProfileMap } from '../../utils/userProfilePreloader';
import { renderCoolapkRichText } from '../../utils/richText';
import { generateTextDiffHtml, getDiffSummary } from '../../utils/textDiff';
import {
  getCommentReplyRequestOptions,
  getExpectedCommentCount,
  getReplyData,
  getReplyPageCursor,
  hasMoreReplyPages,
  mergeReplies,
  type CommentSortMode,
  type CommentSortSelection,
} from '../../utils/commentList';
import { useAppStore } from '../../stores/app';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore } from '../../stores/settings';
import { registerOpenComments, touchActiveComments, isCommentHostVisible } from '../../utils/activeCommentTracker';
import { showToast } from '../../utils/toast';
import { requestConfirmation } from '../../utils/confirm';
import { getErrorMessage } from '../../utils/errors';
import { extractFeedImageInputs, type FeedImageInput } from '../../utils/livePhoto';
import { normalizeCoolapkNativeRoute, normalizeCoolapkPageRoute, normalizeCoolapkRoute } from '../../utils/coolapkRoute';
import { isAnswerSearchEntity } from '../../utils/searchEntities';
import { getQuestionAnswerCount, getQuestionFeedId, getQuestionFollowCount, isQuestionFeedEntity } from '../../utils/question';
import {
  getFeedRelationImage,
  getFeedRelationKey,
  getFeedRelationRows,
  getFeedRelationSubtitle,
  getFeedRelationTitle,
  getFeedRelationType,
} from '../../utils/feedRelations';
import { getUserUid } from '../../utils/userRoute';
import { getFeedInteractionType } from '../../utils/feedInteractions';
import { hasActiveTextSelection } from '../../utils/selection';
import { queueFavoriteContentIndexEntry, removeFavoriteContentIndexEntry } from '../../utils/favoriteContentIndex';

const settingsStore = useSettingsStore();
const appStore = useAppStore();
const router = useRouter();
const mobileOfficialEnabled = useOfficialMobileFeedDetail();
const mobileLayout = useMobileLayout();
const openDesktopFeedComments = inject(openDesktopFeedCommentsKey, null);
/**
 * 点击卡片是否应跳详情页，而不是就地展开评论。
 *
 * 移动端布局由既有开关 `officialMobileFeedDetail` 决定（行为不变，且优先于宿主）；
 * 桌面布局则由新开关 `desktopFeedDetailOnClick` 决定。
 *
 * 话题页三栏模式下宿主会传 `disableInlineComments`，要求点击卡片时
 * emit('open-comment') 交给宿主在右栏显示评论 —— 这是该模式下唯一能
 * 更新右栏的路径。此时新开关不参与判断，宿主约定优先。
 */
const opensDetailOnClick = computed(() =>
  mobileOfficialEnabled.value
  || (!mobileLayout.value && !props.disableInlineComments && settingsStore.settings.desktopFeedDetailOnClick)
);
const commentSectionRef = ref<InstanceType<typeof FeedCommentSection> | null>(null);
const showDeviceInfo = computed(() => settingsStore.settings.showDeviceInfo);

const props = defineProps<{
  feed: FeedItem;
  rankIndex?: number;
  profileUid?: string | number;
  detailMode?: boolean;
  officialMobileDetail?: boolean;
  autoOpenComments?: boolean;
  targetReplyId?: string;
  cloudFavorite?: boolean;
  favoritePickerOnRemove?: boolean;
  maxLines?: number;
  highlightKeyword?: string;
  disableInlineComments?: boolean;
  /** 分栏详情页用：点赞/转发列表交给宿主渲染（右栏），本组件不弹窗。 */
  externalInteractionLists?: boolean;
  questionMode?: boolean;
  answerMode?: boolean;
  /** 我的回复等列表中的记录 ID 属于评论，点击时需先定位所属动态。 */
  replyMode?: boolean;
}>();

const authorFollowing = ref(Number((props.feed.userAction as any)?.followAuthor) === 1);
const authorFollowPending = ref(false);
watch(() => (props.feed.userAction as any)?.followAuthor, value => { authorFollowing.value = Number(value) === 1; });
const officialHotReply = computed(() => { const rows = (props.feed as any).hotReplyRows; if (!Array.isArray(rows)) return null; return rows.flatMap(row => row?.entities || [row]).find(row => row && row.message && (row.username || row.userInfo?.username)) || null; });
const publishedLocation = computed(() => String((props.feed as any).ip_location || (props.feed as any).ipLocation || (props.feed as any).location || '').replace(/^发布于/, '').trim());
function isProductTarget(target: any) { return /product|device/.test(String(target.targetType || target.target_type || target.entityType)) || /^\/product\//.test(String(target.url || '')); }
async function toggleAuthorFollow() {
  if (!authStore.isLoggedIn) { authStore.openLoginModal(); return; }
  if (authorFollowPending.value || !authorUid.value) return;
  authorFollowPending.value = true;
  try { if (authorFollowing.value) await CoolapkTauriAPI.unfollowUser(String(authorUid.value)); else await CoolapkTauriAPI.followUser(String(authorUid.value)); authorFollowing.value = !authorFollowing.value; }
  catch (error) { showToast(getErrorMessage(error, '关注作者失败'), 'error'); }
  finally { authorFollowPending.value = false; }
}
function navigateToOfficialDetail(scrollTo: 'top' | 'comments') {
  appStore.setFeedDetailContext(String(props.feed.id), props.feed);
  void router.push({ path: `/feed/${props.feed.id}`, query: { scrollTo } });
}
function openOfficialDetail() { navigateToOfficialDetail('top'); }
let openingReplyDetail = false;
async function openReplyDetail() {
  if (openingReplyDetail) return;
  openingReplyDetail = true;
  try {
    const reply = { ...props.feed, entityType: 'reply' };
    const replyId = getNotificationReplyId(reply);
    if (!replyId) throw new Error('缺少评论标识，无法打开这条回复');
    let feedId = getNotificationFeedId(reply);
    if (!feedId) {
      const response = await CoolapkTauriAPI.getReplyDetail(replyId);
      feedId = getNotificationFeedId(response?.data);
    }
    if (!feedId) throw new Error('无法获取这条回复所属的动态，请稍后重试');
    await router.push({ path: `/feed/${feedId}`, query: { replyId } });
  } catch (error) {
    showToast(getErrorMessage(error, '打开回复失败，请稍后重试'), 'error');
  } finally { openingReplyDetail = false; }
}
async function scrollToMobileComments() { void openComments(); await nextTick(); cardRef.value?.querySelector('.comment-toolbar')?.scrollIntoView({ block: 'start', behavior: settingsStore.settings.reduceMotion ? 'auto' : 'smooth' }); }
async function writeMobileComment() { if (!authStore.isLoggedIn) { authStore.openLoginModal(); return; } void openComments(); await nextTick(); commentSectionRef.value?.openComposer(); }
const isAnswerCard = computed(() => Boolean(props.answerMode) || isAnswerSearchEntity(props.feed as any));
const isRatingDetail = computed(() => {
  const feed = props.feed as any;
  return props.detailMode && (/^(rating|ratingFeed)$/i.test(String(feed.feedType || feed.entityType || ''))
    || Number(feed.rating_score ?? feed.ratingScore) > 0
    || (Array.isArray(feed.rating_item_info ?? feed.ratingItemInfo) && (feed.rating_item_info ?? feed.ratingItemInfo).length > 0));
});
// FeedCard 同时用于话题和普通动态列表，不能用搜索结果里的 questionId 推断问答；这里只接受明确的问答实体标记。
const isQuestionCard = computed(() => !isAnswerCard.value && (Boolean(props.questionMode) || isQuestionFeedEntity(props.feed)));
const hasQuestionStats = computed(() => {
  if (!isQuestionCard.value) return false;
  const feed = props.feed as any;
  return ['question_answer_num', 'questionAnswerNum', 'question_follow_num', 'questionFollowNum']
    .some((key) => feed[key] !== undefined && feed[key] !== null);
});
const questionAnswerCount = computed(() => getQuestionAnswerCount(props.feed));
const questionFollowCount = computed(() => getQuestionFollowCount(props.feed));

const authorUid = computed(() => {
  return getUserUid(props.feed);
});

const userCoverUrl = computed(() => {
  // 背景单独控制；关闭时不挂载图片节点，也不保留背景专用样式。
  if (!settingsStore.settings.showFeedBackground) return '';
  const preloaded = authorUid.value ? reactiveUserProfileMap[authorUid.value] : null;
  const info = props.feed.userInfo as any;
  const feedAny = props.feed as any;
  return (
    feedAny.userCover ||
    feedAny.cover ||
    info?.cover ||
    info?.userCover ||
    preloaded?.cover ||
    ''
  );
});

onMounted(() => {
  if (authorUid.value) preloadUserProfile(authorUid.value);
});

watch(authorUid, (newUid) => {
  if (newUid) preloadUserProfile(newUid);
});

const feedImages = computed<FeedImageInput[]>(() => {
  const feed = props.feed as FeedItem & Record<string, unknown>;
  const isArticle = feed.feedType === 'feedArticle'
    || feed.feed_type === 'feedArticle'
    || Number(feed.isHtmlArticle ?? feed.is_html_article ?? 0) === 1;

  if (isArticle) {
    const rawModels = feed.message_raw_output ?? feed.messageRawOutput;
    let models: unknown = rawModels;
    if (typeof models === 'string') {
      try { models = JSON.parse(models); } catch { models = null; }
    }
    if (Array.isArray(models)) {
      const articleImages = models.flatMap((model): string[] => {
        if (!model || typeof model !== 'object') return [];
        const image = model as Record<string, unknown>;
        return image.type === 'image' && typeof image.url === 'string' && image.url.trim()
          ? [image.url]
          : [];
      });
      if (articleImages.length) return articleImages;
    }
  }

  return extractFeedImageInputs(props.feed);
});

const secondHandInfo = computed<Record<string, any> | null>(() => {
  const raw = (props.feed as any).ershou_info || (props.feed as any).ershouInfo || (props.feed as any).second_hand_info || (props.feed as any).secondHandInfo;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
});

const secondHandLink = computed(() => {
  const rawUrl = secondHandInfo.value?.link_url || secondHandInfo.value?.linkUrl || secondHandInfo.value?.url || secondHandInfo.value?.link;
  const url = String(rawUrl || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
});

const secondHandPrice = computed(() => {
  const info = secondHandInfo.value;
  if (!info) return '';
  if (Number(info.is_face_deal) === 1) return '价格面议';
  const rawPrice = info.product_price;
  if (typeof rawPrice !== 'string' && typeof rawPrice !== 'number') return '';
  const price = String(rawPrice).trim();
  return price ? `¥${price}` : '';
});

const secondHandLinkSource = computed(() => String(secondHandInfo.value?.link_source || secondHandInfo.value?.linkSource || '闲鱼').trim() || '闲鱼');

function openSecondHandLink() {
  if (secondHandLink.value) void CoolapkTauriAPI.openUrl(secondHandLink.value, 'internal');
}

const emit = defineEmits<{
  (e: 'deleted', id: string | number): void;
  (e: 'pin-changed'): void;
  (e: 'favorite-changed', payload: { id: string | number; favorited: boolean }): void;
  (e: 'open-comment', feed: FeedItem): void;
  (e: 'open-like-list'): void;
  (e: 'open-forward-list'): void;
}>();

const authStore = useAuthStore();
const feedPluginUrl = computed(() => {
  if (!settingsStore.settings.showFeedBackground) return '';
  if (String(authStore.user?.uid) === authorUid.value && authStore.user?.feedPluginUrl !== undefined) return authStore.user.feedPluginUrl;
  const info = props.feed.userInfo as any;
  const preloaded = authorUid.value ? reactiveUserProfileMap[authorUid.value] : null;
  return (props.feed as any).feed_plugin_url || info?.feed_plugin_url || preloaded?.feed_plugin_url || '';
});
const shareImageOpen = ref(false);

const isMyFeed = computed(() => {
  if (!authStore.isLoggedIn || !authStore.user) return false;
  return !!authorUid.value && authorUid.value === String(authStore.user.uid);
});

const isMemberPinned = computed(() => Number(props.feed.isStickTop) === 1);
const isPinnedFeed = computed(() => isMemberPinned.value || Number(props.feed.is_editor_title_top) === 1 || Number(props.feed.collectionItem?.is_top) === 1);
const canPinFeed = computed(() => isMyFeed.value && !props.replyMode && String(props.profileUid || '') === String(authStore.user?.uid));
const pinPending = ref(false);
async function handlePinFeed() {
  if (!canPinFeed.value || pinPending.value) return;
  pinPending.value = true;
  try {
    const top = !isMemberPinned.value;
    if (top && !await requestConfirmation({ title: '置顶动态', message: '将此动态置顶到个人主页；如果已有置顶动态，将替换原来的置顶。是否继续？', confirmText: '置顶' })) return;
    const response = await CoolapkTauriAPI.setUserFeedTop(String(props.profileUid), String(props.feed.id), top);
    if (response?.code !== 200) throw new Error(response?.message || '设置置顶失败');
    props.feed.isStickTop = top ? 1 : 0;
    moreMenuOpen.value = false;
    showToast(top ? '动态已置顶' : '已取消置顶');
    emit('pin-changed');
  } catch (error) {
    showToast(getErrorMessage(error, '设置置顶失败'), 'error');
  } finally { pinPending.value = false; }
}

const canEditFeed = computed(() => {
  const value = (props.feed as any).enableModify ?? (props.feed as any).enable_modify;
  return value === undefined || Number(value) === 1;
});

const isEdited = computed(() => isFeedEdited(props.feed));

const baseTargetRow = computed<any>(() =>
  (props.feed as any).forwardSourceFeed ||
  (props.feed as any).forward_source_feed ||
  props.feed.targetRow ||
  (props.feed as any).target_row ||
  (props.feed as any).targetFeed ||
  (props.feed as any).replyFeed ||
  (props.feed as any).feedInfo ||
  (props.feed as any).feed ||
  null
);

const targetRows = computed<any[]>(() => {
  const candidates = [baseTargetRow.value, ...getFeedRelationRows(props.feed)].filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  const seen = new Set<string>();
  return candidates.filter((row, index) => {
    const key = getFeedRelationKey(row, index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

const targetRow = computed<any>(() => targetRows.value[0] || null);

function isTargetFeedRow(target: any): boolean {
  if (!target) return false;
  const type = String(target.entityType || target.entity_type || target.type || '').toLowerCase();
  if (type === 'feed' || type === 'feed_reply' || type === 'feedreply' || type === 'article') return true;
  return Boolean((target.username || target.userName || target.userInfo?.username) && (target.message || target.message_raw_output || target.content || target.text));
}

const isTargetFeed = computed(() => {
  const target = targetRow.value;
  return isTargetFeedRow(target);
});

const targetObjectRows = computed<any[]>(() => targetRows.value.filter((target) => {
  if (isTargetFeedRow(target)) return false;
  const type = getFeedRelationType(target);
  return Boolean(getFeedRelationTitle(target) || getFeedRelationImage(target) || target.id || target.entityId || target.url || type);
}));

const quotedAuthor = computed(() => {
  const t = targetRow.value;
  if (!t) return '';
  return t.username || t.userName || t.displayUserName || t.userInfo?.username || '';
});

const formattedQuotedMessage = computed(() => {
  const t = targetRow.value;
  if (!t) return '原动态内容';
  const text = t.message || t.content || t.text || t.title || '原动态内容';
  return renderCoolapkRichText(text);
});

const quotedImages = computed<FeedImageInput[]>(() => {
  const t = targetRow.value;
  if (!t) return [];
  return extractFeedImageInputs(t);
});

function targetIconClass(target: any): string {
  if (!target) return 'fas fa-tag';
  const type = getFeedRelationType(target);
  const title = getFeedRelationTitle(target).toLowerCase();
  if (type.includes('product') || type.includes('device') || title.includes('pro') || title.includes('ultra') || title.includes('phone') || title.includes('mate') || title.includes('pura')) return 'fas fa-mobile-screen';
  if (type.includes('apk') || type.includes('app')) return 'fas fa-cubes';
  if (type.includes('topic') || type.includes('node') || type.includes('tag') || title.includes('os') || title.includes('ui')) return 'fas fa-hashtag';
  if (type.includes('goods') || type.includes('mall')) return 'fas fa-bag-shopping';
  return 'fas fa-tag';
}

function getTargetTitle(target: any): string {
  return getFeedRelationTitle(target);
}

function getTargetSubtitle(target: any): string {
  return getFeedRelationSubtitle(target);
}

function getTargetImage(target: any): string {
  return getFeedRelationImage(target);
}

function getTargetKey(target: any, index: number): string {
  return getFeedRelationKey(target, index);
}

function openTarget(target: any) {
  if (!target) return;
  const targetUrl = target.url || target.targetUrl || target.target_url || target.webUrl || target.web_url;
  if (typeof targetUrl === 'string' && targetUrl) {
    const normalizedRoute = normalizeCoolapkRoute(targetUrl);
    if (normalizedRoute && !/^\/page(?:\?|$)/i.test(normalizedRoute)) {
      void router.push(normalizedRoute);
      return;
    }
    const pageRoute = normalizeCoolapkPageRoute(targetUrl);
    if (pageRoute) {
      const pageUrl = new URL(pageRoute, 'https://www.coolapk.com');
      void router.push({
        path: '/page',
        query: {
          url: pageUrl.searchParams.get('url') || '',
          title: getTargetTitle(target),
        },
      });
      return;
    }
    if (normalizedRoute) void router.push(normalizedRoute);
    else if (targetUrl.startsWith('/')) void router.push(normalizeCoolapkNativeRoute(targetUrl) || targetUrl);
    else void CoolapkTauriAPI.openUrl(targetUrl);
    return;
  }
  const type = getFeedRelationType(target);
  const id = target.id || target.entityId || target.entity_id || target.targetId || target.target_id;
  const packageName = target.packageName || target.package_name || target.apkName || target.apkname;
  const topicTag = target.tag || target.topicTag || target.topic_tag || target.title || target.name || id;
  if (packageName && (type.includes('apk') || type.includes('app') || type.includes('game'))) {
    const appRoute = normalizeCoolapkNativeRoute(`/apk/${String(packageName)}`);
    if (appRoute) void router.push(appRoute);
    return;
  }
  if (type.includes('topic') || type.includes('node') || type.includes('tag')) {
    const normalizedTopicTag = String(topicTag || '').trim();
    if (normalizedTopicTag) void router.push(`/topic/${encodeURIComponent(normalizedTopicTag)}`);
    return;
  }
  if (id) {
    if (type.includes('apk') || type.includes('app')) {
      const appRoute = normalizeCoolapkNativeRoute(`/apk/${String(id)}`);
      if (appRoute) void router.push(appRoute);
    } else if (type.includes('product') || type.includes('device')) {
      void router.push(`/product/${id}`);
    }
  }
}

function openQuotedFeed() {
  const target = targetRow.value;
  const feedId = target?.id || target?.feed_id || target?.entityId || props.feed.replyRows?.[0]?.id;
  if (feedId) {
    void router.push(`/feed/${feedId}`);
  }
}

const dyhShareOpen = ref(false);
function openShareDyh() { moreMenuOpen.value = false; if (!authStore.isLoggedIn) { authStore.openLoginModal(); return; } dyhShareOpen.value = true; }
const privateShareOpen = ref(false);
const privateShareContacts = ref<any[]>([]);
const privateShareLoading = ref(false);
const privateShareError = ref('');
async function copyFeed(link: boolean) {
  const text = link ? `https://www.coolapk.com/feed/${props.feed.id}` : htmlToPlainText(String(props.feed.message || ''));
  try { await navigator.clipboard.writeText(text); moreMenuOpen.value = false; showToast('已复制'); }
  catch { showToast('复制失败，请检查剪贴板权限', 'error'); }
}
function reportOfficialFeed() { moreMenuOpen.value = false; void CoolapkTauriAPI.openUrl(`https://m.coolapk.com/mp/do?c=feed&m=report&type=feed&id=${encodeURIComponent(String(props.feed.id))}`, 'internal'); }
async function openSharePrivate() {
  moreMenuOpen.value = false;
  if (!authStore.isLoggedIn) { authStore.openLoginModal(); return; }
  privateShareOpen.value = true; privateShareLoading.value = true; privateShareError.value = '';
  try { const response = await CoolapkTauriAPI.getRecentChatUsers(); privateShareContacts.value = (Array.isArray(response?.data) ? response.data : []).map((row: any) => ({ ...row, uid: row.uid || row.userInfo?.uid, username: row.username || row.userInfo?.username || '酷友' })).filter((row: any) => row.uid); }
  catch (error) { privateShareError.value = getErrorMessage(error, '联系人加载失败'); }
  finally { privateShareLoading.value = false; }
}
function shareToPrivate(contact: any) { privateShareOpen.value = false; void router.push({ path: '/messages', query: { uid: String(contact.uid), username: contact.username, initialText: `https://www.coolapk.com/feed/${props.feed.id}` } }); }
const forwardOpen = ref(false);
const interactionMode = ref<'likes' | 'forwards' | null>(null);
const moreMenuOpen = ref(false);
const moreMenuRef = ref<HTMLElement | null>(null);
const moreMenuStyle = ref({ top: '8px', left: '8px', maxHeight: 'calc(100dvh - 16px)' });

function positionMoreMenu() {
  if (!moreMenuOpen.value || props.officialMobileDetail || !cardRef.value || !moreMenuRef.value) return;
  const card = cardRef.value.getBoundingClientRect();
  const menu = moreMenuRef.value.getBoundingClientRect();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const menuHeight = Math.min(Math.max(menu.height, moreMenuRef.value.scrollHeight + 2), Math.max(0, height - 16));
  const top = Math.max(8, Math.min(card.top + 40, height - menuHeight - 8));
  moreMenuStyle.value = {
    top: `${top}px`,
    left: `${Math.max(8, Math.min(card.right - menu.width - 12, width - menu.width - 8))}px`,
    maxHeight: `${Math.max(0, height - 16)}px`,
  };
}

function closeMenuOnScroll(event: Event) {
  // 菜单内滚动保留浮层；页面滚动时关闭，避免与动态卡片脱离。
  if (event.target instanceof Node && moreMenuRef.value?.contains(event.target)) return;
  moreMenuOpen.value = false;
}

watch(moreMenuOpen, async (open) => {
  window.removeEventListener('resize', positionMoreMenu);
  window.removeEventListener('scroll', closeMenuOnScroll, true);
  if (!open || props.officialMobileDetail) return;
  await nextTick();
  if (!moreMenuOpen.value || !moreMenuRef.value || !cardRef.value) return;
  positionMoreMenu();
  window.addEventListener('resize', positionMoreMenu);
  window.addEventListener('scroll', closeMenuOnScroll, true);
});
onUnmounted(() => {
  window.removeEventListener('resize', positionMoreMenu);
  window.removeEventListener('scroll', closeMenuOnScroll, true);
});
const historyDialogOpen = ref(false);
const historyLoading = ref(false);
const historyError = ref('');
const historyList = ref<any[]>([]);
const historyLoaded = ref(false);

const interactionFeedType = computed(() => getFeedInteractionType(props.feed));

function openForwardDialog() {
  if (!authStore.isLoggedIn) {
    authStore.openLoginModal();
    return;
  }
  forwardOpen.value = true;
}

function handleForwardSuccess() {
  props.feed.sharenum = (Number(props.feed.sharenum) || 0) + 1;
}

function openLikeList() {
  if (props.externalInteractionLists) { emit('open-like-list'); return; }
  interactionMode.value = 'likes';
}

function openForwardList() {
  if (props.externalInteractionLists) { emit('open-forward-list'); return; }
  interactionMode.value = 'forwards';
}

function closeInteractionDialog(show: boolean) {
  if (!show) interactionMode.value = null;
}

function toggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value;
}

function openInteractionListFromMoreMenu(mode: 'likes' | 'forwards') {
  moreMenuOpen.value = false;
  if (props.externalInteractionLists) {
    if (mode === 'likes') emit('open-like-list');
    else emit('open-forward-list');
    return;
  }
  if (mode === 'likes') openLikeList();
  else openForwardList();
}

function handleShareImage() {
  moreMenuOpen.value = false;
  shareImageOpen.value = true;
}

function handleEditFeed() {
  moreMenuOpen.value = false;
  appStore.openEditFeed(props.feed);
}

async function openHistoryDialog() {
  if (!isEdited.value) return;
  historyDialogOpen.value = true;
  if (!historyLoaded.value) {
    await loadHistory();
  }
}

async function loadHistory() {
  historyLoading.value = true;
  historyError.value = '';
  try {
    const response: any = await CoolapkTauriAPI.getFeedChangeHistory(String(props.feed.id));
    historyList.value = Array.isArray(response?.data) ? response.data : [];
    historyLoaded.value = true;
  } catch (error) {
    console.warn('加载动态编辑记录失败：', error);
    historyError.value = '编辑记录加载失败';
  } finally {
    historyLoading.value = false;
  }
}

function formatHistoryDate(item: any): string {
  const value = item?.last_change_time || item?.lastChangeTime || item?.date || item?.dateline || item?.createTime || item?.create_time;
  if (!value) return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const date = new Date(number > 9_999_999_999 ? number : number * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false });
}

function isCurrentHistory(item: any, index: number): boolean {
  return index === 0 && Number(item?.isHistory ?? item?.is_history ?? 0) === 0;
}

function formatHistoryVersion(item: any, index: number): string {
  if (isCurrentHistory(item, index)) return '当前版本';
  const changeCount = Number(item?.change_count ?? item?.changeCount ?? 0);
  return changeCount > 0 ? `第 ${changeCount} 次编辑` : '原始版本';
}

function getHistoryTitle(item: any): string {
  return String(item?.message_title || item?.title || '').trim();
}

function formatHistoryContent(item: any): string {
  if (!item || typeof item !== 'object') return '（无详细内容）';
  return item.message
    || item.content
    || item.text
    || item.change_content
    || item.description
    || (item.title ? `标题：${item.title}` : '')
    || '（无详细内容）';
}

function formatHistoryHtml(item: any): string {
  return renderCoolapkRichText(formatHistoryContent(item));
}

function getPreviousHistoryItem(index: number): any | null {
  if (index + 1 < historyList.value.length) {
    return historyList.value[index + 1];
  }
  return null;
}

function getHistoryDiffHtml(item: any, index: number): string {
  const prevItem = getPreviousHistoryItem(index);
  if (!prevItem) {
    return formatHistoryHtml(item);
  }
  const oldText = formatHistoryContent(prevItem);
  const newText = formatHistoryContent(item);
  return generateTextDiffHtml(oldText, newText);
}

function getHistoryDiffBadge(item: any, index: number): { text: string; type: 'diff' | 'same' } | null {
  const prevItem = getPreviousHistoryItem(index);
  if (!prevItem) return null;
  const oldText = formatHistoryContent(prevItem);
  const newText = formatHistoryContent(item);
  const summary = getDiffSummary(oldText, newText);
  if (summary.isSame) {
    return { text: '文本无改动', type: 'same' };
  }
  const parts: string[] = [];
  if (summary.addedChars > 0) parts.push(`+${summary.addedChars}`);
  if (summary.deletedChars > 0) parts.push(`-${summary.deletedChars}`);
  return { text: parts.join(' / '), type: 'diff' };
}

function getHistoryImages(item: any): string[] {
  if (Array.isArray(item?.picArr)) return item.picArr;
  if (Array.isArray(item?.pics)) return item.pics;
  return item?.pic ? [item.pic] : [];
}

async function handleDeleteFeed() {
  const confirmed = await requestConfirmation({
    title: '删除动态',
    message: '确定要删除这条动态吗？删除后无法恢复。',
    confirmText: '删除',
    danger: true
  });
  if (!confirmed) return;
  moreMenuOpen.value = false;
  try {
    const res = await CoolapkTauriAPI.deleteFeed(String(props.feed.id));
    if (res && res.code === 200) {
      showToast('动态已删除');
      emit('deleted', props.feed.id);
    } else {
      showToast(res?.message || '删除动态失败', 'error');
    }
  } catch (err: any) {
    showToast(getErrorMessage(err, '删除动态失败'), 'error');
  }
}

function removeComment(id: string | number) {
  comments.value = comments.value.filter((c: any) => String(c.id) !== String(id));
}

const isFav = ref(
  props.cloudFavorite === true ||
  props.feed.userAction?.collect === 1 ||
  props.feed.userAction?.favorite === 1
);
const favnum = ref(props.feed.favnum || 0);
watch(() => props.feed.favnum, value => { if (value !== undefined) favnum.value = Number(value) || 0; });
const favoritePending = ref(false);
const collectionPickerOpen = ref(false);
const collectionPickerLoading = ref(false);
const collectionPickerSubmitting = ref(false);
const collectionOptions = ref<any[]>([]);
const collectionInitialSelectedIds = ref<string[]>([]);

const showComments = ref(false);
const comments = ref<any[]>([]);
const commentsLoading = ref(false);
const commentsError = ref('');
const commentsPage = ref(0);
const hasMoreComments = ref(false);
const commentsLoadingMore = ref(false);
const commentsLoadMoreError = ref('');
const commentsSortMode = ref<CommentSortMode>(settingsStore.settings.commentDefaultSortMode);
const commentsAuthorOnly = ref(false);
let commentsFirstItem = '';
let commentsLastItem = '';
let commentsRequestVersion = 0;
const hasBlockingOverlay = computed(() => Boolean(dyhShareOpen.value || privateShareOpen.value || appStore.activeImageViewer || appStore.isSearchOpen || appStore.isPublishOpen || authStore.isLoginModalOpen || forwardOpen.value || interactionMode.value || historyDialogOpen.value || collectionPickerOpen.value || moreMenuOpen.value));

async function toggleFav() {
  if (!authStore.isLoggedIn) {
    authStore.openLoginModal();
    return;
  }
  if (favoritePending.value) return;

  const id = String(props.feed.id);
  const target = !isFav.value;
  const feedType = String((props.feed as any).entityType || (props.feed as any).feedType || 'feed');
  const trace = String((props.feed as any).trace || (props.feed as any).extra_key || '');

  if (target || props.favoritePickerOnRemove) {
    await openCollectionPicker(id);
    return;
  }

  favoritePending.value = true;
  try {
    await CoolapkTauriAPI.setFeedCloudFavorite(id, target, feedType, trace);
    isFav.value = target;
    favnum.value = Math.max(0, favnum.value + (target ? 1 : -1));
    if (target) void queueFavoriteContentIndexEntry(authStore.user?.uid || '', props.feed).catch((error) => console.warn('更新收藏正文索引失败:', error));
    else void removeFavoriteContentIndexEntry(authStore.user?.uid || '', id).catch((error) => console.warn('移除收藏正文索引失败:', error));
    showToast(target ? '已收藏到云端' : '已取消云端收藏', 'success');
    emit('favorite-changed', { id: props.feed.id, favorited: target });
  } catch (err) {
    showToast(getErrorMessage(err, target ? '收藏失败' : '取消收藏失败'), 'error');
  } finally {
    favoritePending.value = false;
  }
}

function collectionId(collection: any): string {
  return String(collection?.id ?? collection?.collectionId ?? collection?.entityId ?? '');
}

function isCollectionSelected(collection: any): boolean {
  const value = collection?.isBeCollected ?? collection?.is_be_collected;
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function openCollectionPicker(feedId: string) {
  if (collectionPickerOpen.value || collectionPickerLoading.value) return;
  favoritePending.value = true;
  collectionPickerLoading.value = true;
  try {
    const options = await CoolapkTauriAPI.getFeedCollectionOptions(feedId);
    const validOptions = options.filter((item: any) => collectionId(item));
    if (validOptions.length === 0) {
      throw new Error('酷安未返回可用收藏夹，请先在酷安创建收藏夹');
    }
    collectionOptions.value = validOptions;
    collectionInitialSelectedIds.value = validOptions
      .filter(isCollectionSelected)
      .map(collectionId);
    collectionPickerOpen.value = true;
  } catch (err) {
    showToast(getErrorMessage(err, '加载收藏夹失败'), 'error');
  } finally {
    collectionPickerLoading.value = false;
    favoritePending.value = false;
  }
}

function closeCollectionPicker() {
  if (collectionPickerSubmitting.value) return;
  collectionPickerOpen.value = false;
  collectionOptions.value = [];
  collectionInitialSelectedIds.value = [];
}

async function confirmCollectionSelection(selectedIds: string[]) {
  if (collectionPickerSubmitting.value) return;
  const ids = Array.from(new Set(selectedIds.filter(Boolean)));
  if (ids.length === 0 && !props.favoritePickerOnRemove) {
    showToast('请至少选择一个收藏夹', 'error');
    return;
  }

  const previousIds = new Set(collectionInitialSelectedIds.value);
  const cancelIds = collectionInitialSelectedIds.value.filter((id) => !ids.includes(id));
  const feedType = String((props.feed as any).entityType || (props.feed as any).feedType || 'feed');
  const trace = String((props.feed as any).trace || (props.feed as any).extra_key || '');
  collectionPickerSubmitting.value = true;
  favoritePending.value = true;
  try {
    await CoolapkTauriAPI.updateFeedCloudCollections(
      String(props.feed.id),
      ids.join(','),
      cancelIds.join(','),
      feedType,
      trace,
    );
    const remainsFavorited = ids.length > 0;
    isFav.value = remainsFavorited;
    if (previousIds.size === 0 && remainsFavorited) {
      favnum.value = Math.max(0, favnum.value + 1);
    } else if (previousIds.size > 0 && !remainsFavorited) {
      favnum.value = Math.max(0, favnum.value - 1);
    }
    if (remainsFavorited) void queueFavoriteContentIndexEntry(authStore.user?.uid || '', props.feed).catch((error) => console.warn('更新收藏正文索引失败:', error));
    else void removeFavoriteContentIndexEntry(authStore.user?.uid || '', props.feed.id).catch((error) => console.warn('移除收藏正文索引失败:', error));
    showToast(remainsFavorited ? '收藏夹已更新' : '已取消全部云端收藏', 'success');
    collectionPickerOpen.value = false;
    emit('favorite-changed', { id: props.feed.id, favorited: remainsFavorited });
  } catch (err) {
    showToast(getErrorMessage(err, '收藏失败'), 'error');
  } finally {
    collectionPickerSubmitting.value = false;
    favoritePending.value = false;
  }
}

function isCurrentCommentRequest(requestedFeedId: string, currentRequest: number): boolean {
  return currentRequest === commentsRequestVersion
    && requestedFeedId === String(props.feed.id || '');
}

async function loadCommentPage(
  requestedFeedId: string,
  page: number,
  cursor?: { firstItem?: string; lastItem?: string },
): Promise<any[]> {
  const response = await CoolapkTauriAPI.getFeedReplies(requestedFeedId, page, {
    ...getCommentReplyRequestOptions(commentsSortMode.value, commentsAuthorOnly.value),
    ...cursor,
  });
  return getReplyData(response);
}

function updateCommentCursor(pageReplies: any[], resetFirst = false) {
  const cursor = getReplyPageCursor(pageReplies);
  if (resetFirst || !commentsFirstItem) commentsFirstItem = cursor.firstItem;
  if (cursor.lastItem) commentsLastItem = cursor.lastItem;
}

async function loadMoreComments() {
  if (
    !hasMoreComments.value ||
    commentsLoading.value ||
    commentsLoadingMore.value
  ) {
    return;
  }

  const requestedFeedId = String(props.feed.id || '');
  if (!requestedFeedId) return;

  const currentRequest = commentsRequestVersion;
  const page = commentsPage.value + 1;
  commentsLoadingMore.value = true;
  commentsLoadMoreError.value = '';

  try {
    const pageReplies = await loadCommentPage(requestedFeedId, page, {
      firstItem: commentsFirstItem,
      lastItem: commentsLastItem,
    });
    if (!isCurrentCommentRequest(requestedFeedId, currentRequest)) return;

    updateCommentCursor(pageReplies);
    const previousReplies = comments.value;
    const mergedReplies = mergeReplies(previousReplies, pageReplies);
    if (mergedReplies.length > previousReplies.length) {
      comments.value = mergedReplies;
      commentsPage.value = page;
    }
    hasMoreComments.value = hasMoreReplyPages(
      pageReplies,
      previousReplies,
      mergedReplies,
      getExpectedCommentCount(props.feed.replynum),
    );
  } catch (err) {
    if (isCurrentCommentRequest(requestedFeedId, currentRequest)) {
      console.error('Failed to load more comments', err);
      commentsLoadMoreError.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    if (isCurrentCommentRequest(requestedFeedId, currentRequest)) {
      commentsLoadingMore.value = false;
    }
  }
}

async function openComments(force = false) {
  showComments.value = true;
  if (
    !force &&
    (commentsLoading.value || commentsLoadingMore.value || commentsPage.value > 0)
  ) {
    return;
  }

  const requestedFeedId = String(props.feed.id || '');
  if (!requestedFeedId) return;

  const currentRequest = ++commentsRequestVersion;
  if (force) comments.value = [];
  commentsPage.value = 0;
  hasMoreComments.value = false;
  commentsFirstItem = '';
  commentsLastItem = '';
  commentsError.value = '';
  commentsLoadMoreError.value = '';
  commentsLoadingMore.value = false;
  commentsLoading.value = true;

  try {
    const pageReplies = await loadCommentPage(requestedFeedId, 1);

    if (!isCurrentCommentRequest(requestedFeedId, currentRequest)) return;

    updateCommentCursor(pageReplies, true);
    comments.value = pageReplies;
    commentsPage.value = pageReplies.length > 0 ? 1 : 0;
    hasMoreComments.value = hasMoreReplyPages(
      pageReplies,
      [],
      pageReplies,
      getExpectedCommentCount(props.feed.replynum),
    );

    // 第 1 页返回即结束首屏 loading。若确实还有评论，第 2 页在底部以“加载更多”状态补齐，
    // 不再让用户等待两页请求都完成后才看到第一批评论。
    commentsLoading.value = false;
    if (hasMoreComments.value) void loadMoreComments();
  } catch (err) {
    if (isCurrentCommentRequest(requestedFeedId, currentRequest)) {
      console.error('Failed to load comments', err);
      commentsError.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    if (isCurrentCommentRequest(requestedFeedId, currentRequest)) {
      commentsLoading.value = false;
    }
  }
}

function handleCommentSortChange(selection: CommentSortSelection) {
  commentsSortMode.value = selection.mode;
  commentsAuthorOnly.value = selection.authorOnly;
  void openComments(true);
}

watch(() => settingsStore.settings.commentDefaultSortMode, (sortMode) => {
  commentsSortMode.value = sortMode;
  commentsAuthorOnly.value = false;
  if (showComments.value) void openComments(true);
});

const cardRef = ref<HTMLElement | null>(null);
const feedImageRatios = ref<Record<string, number>>({});
const quotedImageRatios = ref<Record<string, number>>({});
const pageVisible = inject(feedPageVisibleKey, ref(true));
const { renderViewportContent, viewportPlaceholderStyle, retainViewportContent } = useViewportContent(cardRef, computed(() => Boolean(
  props.detailMode || props.officialMobileDetail || props.autoOpenComments || showComments.value || commentsPage.value > 0
  || moreMenuOpen.value || shareImageOpen.value || forwardOpen.value || dyhShareOpen.value || privateShareOpen.value
  || interactionMode.value || collectionPickerOpen.value || historyDialogOpen.value || commentsLoading.value || favoritePending.value
)), inject(feedPageRenderKey, pageVisible));
function retainPointerContent(event: PointerEvent) {
  // 鼠标拖动选字需要保留子树；触摸滚动不把途经的所有卡片永久留在内存中。
  if (event.pointerType !== 'touch') retainViewportContent();
}
const componentActive = ref(true);
useAndroidBackButton(() => !!props.officialMobileDetail && componentActive.value && pageVisible.value && moreMenuOpen.value, () => { moreMenuOpen.value = false; });
const isCommentsFloatingVisible = ref(false);
const floatingCollapseStyle = ref<{ bottom: string; right: string }>({ bottom: '32px', right: '32px' });

function updateFloatingCollapse() {
  if (
    !pageVisible.value || !componentActive.value ||
    hasBlockingOverlay.value ||
    !showComments.value ||
    props.detailMode ||
    !cardRef.value ||
    !cardRef.value.isConnected ||
    !comments.value.length
  ) {
    isCommentsFloatingVisible.value = false;
    return;
  }
  const rect = cardRef.value.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    isCommentsFloatingVisible.value = false;
    return;
  }
  const windowHeight = window.innerHeight;
  const windowWidth = window.innerWidth;

  // 只要动态卡片或评论区正在当前视口中展示
  const isInViewport = isCommentHostVisible(cardRef.value) && rect.top < windowHeight - 80 && rect.bottom > 120;

  if (isInViewport) {
    isCommentsFloatingVisible.value = true;
    // 水平对齐到卡片右内侧边缘，当卡片靠右（rightOffset < 96px）时进入右下角回到顶部悬浮球区域，
    // 将收起评论按钮上移到回到顶部上方（bottom: 84px），防止两按钮重叠冲突；空间充足时固定在底部 32px
    const rightOffset = Math.max(28, windowWidth - rect.right + 24);
    const isOverlappingFabZone = rightOffset < 96;
    floatingCollapseStyle.value = {
      bottom: isOverlappingFabZone ? '84px' : '32px',
      right: `${rightOffset}px`,
    };
  } else {
    isCommentsFloatingVisible.value = false;
  }
}

let scrollListenerAttached = false;

function bindScrollListener() {
  if (scrollListenerAttached) return;
  scrollListenerAttached = true;
  window.addEventListener('scroll', updateFloatingCollapse, true);
  window.addEventListener('resize', updateFloatingCollapse);
}

function unbindScrollListener() {
  if (!scrollListenerAttached) return;
  scrollListenerAttached = false;
  window.removeEventListener('scroll', updateFloatingCollapse, true);
  window.removeEventListener('resize', updateFloatingCollapse);
}

function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    if (parent.classList.contains('feed-scroll-container')) return parent;
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
    parent = parent.parentElement;
  }
  return null;
}

function keepCollapsedCardVisible(card: HTMLElement, scrollContainer: HTMLElement | null) {
  const cardRect = card.getBoundingClientRect();
  const viewportTop = scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
  const viewportBottom = viewportTop + (scrollContainer ? scrollContainer.clientHeight : window.innerHeight);
  if (cardRect.bottom > viewportTop && cardRect.top < viewportBottom) return;

  const currentScrollTop = scrollContainer ? scrollContainer.scrollTop : (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop);
  const targetScrollTop = cardRect.bottom <= viewportTop
    ? currentScrollTop + cardRect.bottom - viewportBottom
    : currentScrollTop + cardRect.top - viewportTop;
  if (scrollContainer) {
    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    scrollContainer.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
    return;
  }

  const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const maxScrollTop = Math.max(0, documentHeight - window.innerHeight);
  window.scrollTo({ top: Math.max(0, Math.min(targetScrollTop, maxScrollTop)), behavior: 'auto' });
}

async function toggleComments() {
  // 提问的评论入口实际是回答列表，不调用普通回复接口或右侧评论面板。
  if (openQuestionDetail(true)) return;
  if (!props.detailMode && mobileOfficialEnabled.value && openAnswerDetail('comments')) return;
  if (props.replyMode && !props.detailMode) { await openReplyDetail(); return; }
  if (!props.detailMode && opensDetailOnClick.value && !isQuestionCard.value && !isAnswerCard.value) { navigateToOfficialDetail('comments'); return; }
  if (props.disableInlineComments) {
    emit('open-comment', props.feed);
    return;
  }
  // 详情入口关闭时，普通动态列表也能独立使用右侧评论，不再落到内联展开。
  if (!props.detailMode && !mobileLayout.value && settingsStore.settings.desktopCommentsOnRight && openDesktopFeedComments?.(props.feed)) return;
  if (showComments.value) {
    showComments.value = false;
    return;
  }
  await openComments();
}

function handleCollapseComments() {
  // 收起只改变当前动态的展开状态，保持用户当前视口，下一条动态自然露出。
  const card = cardRef.value;
  const scrollContainer = card ? findScrollContainer(card) : null;
  showComments.value = false;
  isCommentsFloatingVisible.value = false;
  unbindScrollListener();
  if (card) {
    void nextTick(() => keepCollapsedCardVisible(card, scrollContainer));
  }
}

watch(
  () => props.disableInlineComments,
  (disabled) => {
    if (disabled && showComments.value) {
      showComments.value = false;
    }
  },
  { immediate: true }
);

let activeCommentsUnregister: (() => void) | null = null;

watch(
  showComments,
  (isOpen) => {
    if (isOpen) {
      activeCommentsUnregister?.();
      activeCommentsUnregister = registerOpenComments(props.feed.id, handleCollapseComments, () => pageVisible.value && componentActive.value && isCommentHostVisible(cardRef.value));
      if (!props.detailMode) {
        bindScrollListener();
        void nextTick(updateFloatingCollapse);
      }
    } else {
      activeCommentsUnregister?.();
      activeCommentsUnregister = null;
      isCommentsFloatingVisible.value = false;
      unbindScrollListener();
    }
  },
  { immediate: true }
);

watch(hasBlockingOverlay, (isBlocked) => {
  if (isBlocked) {
    isCommentsFloatingVisible.value = false;
  } else if (showComments.value) {
    void nextTick(updateFloatingCollapse);
  }
});

watch(
  () => router?.currentRoute?.value?.fullPath,
  () => {
    // 路由切换时立即隐藏浮动收起按钮
    isCommentsFloatingVisible.value = false;
    unbindScrollListener();
  }
);

onDeactivated(() => {
  moreMenuOpen.value = false;
  privateShareOpen.value = false;
  dyhShareOpen.value = false;
  componentActive.value = false;
  // 页面离开 / 被 keep-alive 缓存休眠时隐藏
  isCommentsFloatingVisible.value = false;
  unbindScrollListener();
});

onActivated(() => {
  componentActive.value = true;
  // 页面重新恢复显示时如果评论仍然打开则重新计算
  if (pageVisible.value && showComments.value && !props.detailMode) {
    bindScrollListener();
    void nextTick(updateFloatingCollapse);
  }
});

watch(pageVisible, (visible) => {
  if (!visible) { isCommentsFloatingVisible.value = false; unbindScrollListener(); }
  else if (componentActive.value && showComments.value && !props.detailMode) { bindScrollListener(); void nextTick(updateFloatingCollapse); }
});

onUnmounted(() => {
  activeCommentsUnregister?.();
  activeCommentsUnregister = null;
  isCommentsFloatingVisible.value = false;
  unbindScrollListener();
});

watch(
  () => props.autoOpenComments,
  (shouldOpen) => {
    // 详情页决定何时具备足够的动态信息；已加载过的评论不会重复请求。
    if (shouldOpen) void openComments();
  },
  { immediate: true }
);

watch(
  () => String(props.feed.id || ''),
  (nextFeedId, previousFeedId) => {
    if (nextFeedId === previousFeedId) return;
    commentsRequestVersion += 1;
    comments.value = [];
    commentsPage.value = 0;
    commentsFirstItem = '';
    commentsLastItem = '';
    commentsLoading.value = false;
    hasMoreComments.value = false;
    commentsLoadingMore.value = false;
    commentsError.value = '';
    commentsLoadMoreError.value = '';
    if (props.autoOpenComments) void openComments();
  }
);

function handleCardClick(e: MouseEvent) {
  if (props.detailMode) return;
  // 选中文本准备复制时，不触发卡片点击（如展开/收起评论）
  if (hasActiveTextSelection()) return;
  const target = e.target as HTMLElement;
  if (target.closest('a') || target.closest('button') || target.closest('.grid-item') || target.closest('.feed-video-card') || target.closest('.inline-comment-wrapper')) {
    return;
  }

  if (props.replyMode) { void openReplyDetail(); return; }

  if (openQuestionDetail()) return;
  if (openAnswerDetail()) return;

  const entityType = props.feed.entityType;
  if (entityType === 'product') {
    const productId = props.feed.entityId || props.feed.id;
    if (productId) {
      router.push(`/product/${productId}`);
      return;
    }
  }
  if (entityType === 'dyh') {
    const dyhId = props.feed.entityId || props.feed.id;
    if (dyhId) {
      router.push(`/dyh/${dyhId}`);
      return;
    }
  }
  if (entityType === 'album') {
    const albumId = props.feed.entityId || props.feed.id;
    if (albumId) {
      router.push(`/album/${albumId}`);
      return;
    }
  }

  if (opensDetailOnClick.value) openOfficialDetail();
  else toggleComments();
}

function openQuestionDetail(atAnswers = false): boolean {
  if (!isQuestionCard.value) return false;
  const questionId = getQuestionFeedId(props.feed);
  if (!questionId) return false;
  appStore.setFeedDetailContext(questionId, props.feed);
  void router.push(atAnswers ? { path: `/question/${encodeURIComponent(questionId)}`, query: { scrollTo: 'answers' } } : `/question/${encodeURIComponent(questionId)}`);
  return true;
}

function openAnswerDetail(scrollTo?: 'top' | 'comments'): boolean {
  if (!isAnswerCard.value) return false;
  const feed = props.feed as any;
  const answerId = [feed.answerId, feed.answer_id, feed.id, feed.entityId, feed.entity_id, feed.feedId, feed.feed_id]
    .map((value) => String(value ?? '').trim())
    .find(Boolean) || '';
  if (!answerId) return false;
  appStore.setFeedDetailContext(answerId, props.feed);
  const path = `/feed/${encodeURIComponent(answerId)}`;
  void router.push(scrollTo ? { path, query: { scrollTo } } : path);
  return true;
}

function normalizeImg(url: string) {
  return url;
}

function formatRichText(text: string) {
  if (!text) return '';
  return renderCoolapkRichText(text);
}

defineExpose({
  refreshComments: () => showComments.value ? openComments(true) : Promise.resolve(),
  toggleComments,
  handleCollapseComments,
  showComments,
});
</script>

<style scoped>
.feed-pinned-label { position: relative; display: flex; align-items: center; gap: 6px; margin-bottom: 10px; color: #f44336; font-size: 12px; }
.feed-target-chip.rating-detail-target { display: flex; width: 100%; max-width: 680px; height: auto; min-height: 80px; border-radius: 10px; padding: 14px; gap: 12px; background: var(--background-secondary); align-items: center; }
.rating-detail-target .target-chip-media { width: 46px; height: 46px; min-width: 46px; max-width: 46px; min-height: 46px; max-height: 46px; }
.rating-detail-target :deep(.target-chip-logo) { width: 46px !important; height: 46px !important; }
.rating-detail-target .target-chip-text { flex: 1; flex-direction: column; align-items: flex-start; gap: 6px; }
.rating-detail-target .target-chip-title,.rating-detail-target .target-chip-subtitle { max-width: 100%; }
.rating-detail-target .target-chip-title { display: flex; gap: 6px; align-items: center; font-size: 16px; }
.rating-target-type { border: 1px solid var(--brand-primary); color: var(--brand-primary); border-radius: 4px; padding: 1px 4px; font-size: 12px; }
.rating-target-score { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
.rating-target-score strong { font-size: 28px; line-height: 1; }
.rating-target-score > span { display: flex; gap: 3px; }
.rating-target-score i { display: grid; place-items: center; width: 12px; height: 12px; font-size: 8px; border-radius: 2px; background: var(--border-color); color: white; }
.rating-target-score i.active { background: #ffb900; }
.official-hot-reply { position: relative; display: block; width: 100%; border: 0; border-radius: 9px; margin-top: 12px; padding: 28px 10px 12px; background: var(--surface-hover); text-align: left; color: var(--text-primary); font: inherit; }
.hot-reply-likes { position: absolute; top: 0; left: 0; background: var(--brand-primary); color: white; border-radius: 9px 0 7px 0; padding: 2px 10px; font-size: 11px; }
.hot-reply-copy { font-size: 14px; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.hot-reply-user { color: var(--brand-primary); }
.is-official-mobile-detail { transform: none !important; padding: 0 16px 16px !important; border: 0 !important; background: var(--surface); }
.official-detail-author { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 8px; margin: 0 -16px 12px; padding: 6px 8px; min-height: 60px; background: var(--surface); border-bottom: 1px solid var(--border-light); }
.official-detail-author :deep(.feed-header) { flex: 1; min-width: 0; margin: 0; }
.official-back, .official-more { flex: 0 0 32px; border: 0; background: transparent; color: var(--text-primary); font-size: 20px; min-height: 40px; }
@media (max-width: 720px) {
  .official-detail-author {
    padding-top: calc(6px + var(--app-safe-area-top, 0px));
    padding-left: max(8px, env(safe-area-inset-left, 0px));
    padding-right: max(8px, env(safe-area-inset-right, 0px));
  }
  .official-back { flex-basis: 44px; min-height: 44px; }
}
.official-follow-author { border: 1px solid var(--text-tertiary); color: var(--text-secondary); background: transparent; border-radius: 20px; padding: 4px 10px; font: inherit; font-size: 12px; white-space: nowrap; }
.official-detail-author :deep(.user-level), .official-detail-author :deep(.verify-badge), .official-detail-author :deep(.ip-badge), .official-detail-author :deep(.read-count), .official-detail-author :deep(.edited-badge), .official-detail-author :deep(.recommend-source-badge), .official-detail-author :deep(.header-feed-plugin) { display: none; }
.official-detail-author :deep(.username) { font-weight: 400; font-size: 16px; }
.official-detail-author :deep(.device-badge) { background: transparent; border: 0; padding: 0; }
.official-detail-author :deep(.meta-row) { flex-wrap: nowrap; font-size: 11px; overflow: hidden; }
.is-official-mobile-detail :deep(.feed-content) { font-size: 16px; line-height: 1.9; }
.official-published-location { color: var(--text-tertiary); font-size: 12px; margin: 14px 0 24px; }
.official-edited-status { border:0; padding:0; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.is-official-mobile-detail .feed-target-wrapper { display: block; margin-top: 28px; }
.is-official-mobile-detail .inline-comment-wrapper { margin: 24px -16px 0; }
.is-official-mobile-detail .more-menu { position: fixed; top: calc(70px + var(--app-safe-area-top, 0px)); right: 12px; z-index: 70; }
 .is-official-mobile-detail .more-menu-backdrop { z-index: 65; background: #0009; }
.is-official-mobile-detail .official-share-sheet { top: auto; bottom: 0; left: 0; right: 0; border-radius: 14px 14px 0 0; border: 0; max-height: 75vh; overflow-y: auto; padding: 12px 0 0; background: var(--surface); }
.official-share-handle { width: 32px; height: 4px; margin: 0 auto 20px; border-radius: 3px; background: var(--border); }
.official-share-tools, .official-share-destinations { display: flex; gap: 0; padding: 0 12px; }
.official-share-tools { margin-bottom: 36px; }
.official-share-destinations { overflow-x: auto; margin-bottom: 30px; }
.official-share-tools button, .official-share-destinations button { flex: 0 0 20%; min-width: 0; display: flex; flex-direction: column; gap: 10px; align-items: center; border: 0; padding: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.official-share-tools span, .official-share-destinations span { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; background: var(--surface-hover); color: var(--text-secondary); }
.official-share-destinations button:not(:last-child) span { background: var(--brand-soft); color: var(--brand-primary); }
.official-share-tools i, .official-share-destinations i { font-size: 22px; }
.official-share-cancel { width: 100%; border: 0; padding: 18px 0 max(18px, env(safe-area-inset-bottom)); background: var(--background-secondary); color: var(--text-primary); font: inherit; font-size: 16px; cursor: pointer; }
.official-share-contact { display: block; width: 100%; border: 0; border-bottom: 1px solid var(--border-light); padding: 14px; background: var(--surface); color: var(--text-primary); text-align: left; font: inherit; }
.desktop-share-tools { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; width: min(280px, calc(100vw - 48px)); padding: 8px; border-bottom: 1px solid var(--border-light); }
.desktop-share-tools button { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px; border: 0; border-radius: 8px; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer; }
.desktop-share-tools button:hover { background: var(--surface-hover); color: var(--brand-primary); }
.desktop-share-tools i { font-size: 20px; }
.feed-card {
  position: relative;
  background-color: var(--surface);
  border-radius: var(--radius-card, 14px);
  border: 1px solid var(--border);
  padding: var(--feed-card-padding, 16px) 18px;
  margin-bottom: var(--feed-card-gap, 12px);
  transition: background-color 0.2s ease, border-color 0.2s ease;
  cursor: pointer;
  overflow: hidden;
}

.feed-plugin-decoration { position: absolute; top: 0; right: 0; width: 50%; height: 48px; pointer-events: none; z-index: 0; background: transparent; content-visibility: auto; }
:deep(.feed-plugin-decoration img) { object-position: right top; }
@media (min-width: 721px) {
  .feed-plugin-decoration { display: none; }
}

/* 右上角作者个性空间背景图氛围层 */
.card-cover-backdrop {
  content-visibility: auto;
  position: absolute;
  top: 0;
  right: 0;
  width: 58%;
  max-width: 480px;
  height: 86px;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
  opacity: 0.9;
  transition: opacity 0.3s ease;
  mask-image: linear-gradient(to left, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.85) 40%, rgba(0, 0, 0, 0.25) 75%, transparent 100%),
              linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.9) 45%, rgba(0, 0, 0, 0.2) 80%, transparent 100%);
  -webkit-mask-image: linear-gradient(to left, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.85) 40%, rgba(0, 0, 0, 0.25) 75%, transparent 100%),
                      linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.9) 45%, rgba(0, 0, 0, 0.2) 80%, transparent 100%);
  mask-composite: intersect;
  -webkit-mask-composite: destination-in;
}

:deep(.card-cover-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 25%;
}

.card-cover-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(255, 255, 255, 0.15) 60%,
    var(--surface) 100%
  );
}

:root[data-theme='dark'] .card-cover-backdrop,
.theme-dark .card-cover-backdrop {
  opacity: 0.82;
}

:root[data-theme='dark'] .card-cover-mask,
.theme-dark .card-cover-mask {
  background: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(15, 23, 42, 0.3) 60%,
    var(--surface) 100%
  );
}

.feed-card:hover {
  background-color: var(--surface);
  border-color: var(--border);
}

.feed-card.is-detail-mode {
  cursor: default;
}

.feed-card.is-detail-mode:hover {
  background-color: var(--surface);
  border-color: var(--border);
}

.question-stats {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 2px 0 10px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption, 12px);
}

.question-stats span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.question-stats i {
  color: var(--brand-primary);
}

.quoted-feed-box {
  background: var(--background-secondary, rgba(0, 0, 0, 0.03));
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  border-radius: 8px;
  padding: 10px 14px;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.quoted-feed-box:hover {
  background: var(--surface-hover, rgba(0, 0, 0, 0.05));
  border-color: var(--border);
}

.quoted-author {
  font-weight: 600;
  color: var(--brand-primary, #10b981);
}

.quoted-message {
  color: var(--text-secondary);
  line-height: 1.55;
  font-size: 13.5px;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.quoted-message :deep(a) {
  color: var(--brand-primary, #10b981);
  font-weight: 500;
  text-decoration: none;
  padding: 0 2px;
}

.quoted-message :deep(a):hover {
  text-decoration: underline;
}

.quoted-message :deep(.coolapk-emoji) {
  display: inline-block;
  vertical-align: -3px;
  width: 18px;
  height: 18px;
  margin: 0 2px;
}

/* 标的卡片（如机型“华为Pura70 Pro+”、产品、话题、应用等）精致胶囊 */
.feed-target-wrapper {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 6px 0 8px 0;
}

.feed-target-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  width: fit-content;
  height: 30px;
  padding: 0 10px 0 5px;
  border-radius: 15px;
  background: var(--background-secondary, rgba(0, 0, 0, 0.04));
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  box-sizing: border-box;
}

.feed-target-chip:hover {
  background: var(--surface-hover, var(--background-secondary));
  border-color: rgba(16, 185, 129, 0.35);
  transform: translateY(-1px);
}

.target-chip-media {
  width: 20px;
  height: 20px;
  min-width: 20px;
  max-width: 20px;
  min-height: 20px;
  max-height: 20px;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.target-chip-logo {
  width: 20px !important;
  height: 20px !important;
  border-radius: 4px;
  background: transparent !important;
}

.target-chip-logo :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.target-chip-icon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  font-size: 11px;
  flex-shrink: 0;
}

.target-chip-text {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.target-chip-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

.target-chip-subtitle {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.target-chip-arrow {
  font-size: 10px;
  color: var(--text-tertiary);
  opacity: 0.5;
  margin-left: 2px;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.feed-target-chip:hover .target-chip-arrow {
  transform: translateX(2px);
  color: #10b981;
  opacity: 1;
}

.inline-comment-wrapper {
  position: relative;
  margin-top: 12px;
  border-top: 1px solid var(--border-light);
  padding-top: 4px;
  cursor: default;
}

/* 全局固定悬浮收起按钮（Fixed 定位在视口右下角，评论滚动时静止不动） */
.global-floating-comment-collapse {
  position: fixed;
  z-index: 900;
  pointer-events: auto;
  transition: bottom 0.2s cubic-bezier(0.4, 0, 0.2, 1), right 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-floating-collapse {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 15px;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 22px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14), 0 1px 4px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-floating-collapse:hover {
  background: var(--brand-primary, #10b981);
  border-color: var(--brand-primary, #10b981);
  color: #ffffff;
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.35);
}

.btn-floating-collapse:active {
  transform: translateY(0) scale(0.98);
}

.btn-floating-collapse i {
  font-size: 11px;
}

.floating-collapse-fade-enter-active,
.floating-collapse-fade-leave-active {
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.floating-collapse-fade-enter-from,
.floating-collapse-fade-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.94);
}

.history-dialog {
  min-height: 160px;
  cursor: default;
}

.history-description {
  margin: 0 0 18px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.history-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-left: 20px;
}

.history-list::before {
  content: '';
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 5px;
  width: 1px;
  background-color: var(--border);
}

.history-item {
  position: relative;
  padding: 14px 16px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-control);
  background-color: var(--background-secondary);
}

.history-item::before {
  content: '';
  position: absolute;
  top: 18px;
  left: -20px;
  width: 11px;
  height: 11px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background-color: var(--text-tertiary);
  box-shadow: 0 0 0 1px var(--border);
}

.history-item:first-child::before {
  background-color: var(--brand-primary);
}

.history-version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
}

.history-version {
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-semibold);
}

.history-version.is-current {
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--brand-primary);
  background-color: var(--brand-soft);
}

.history-time {
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.history-title {
  margin: 0 0 6px;
  color: var(--text-primary);
  font-size: var(--font-size-sub);
  line-height: 1.5;
}

.history-version-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-diff-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 10px;
  letter-spacing: 0.2px;
}

.history-diff-badge.is-diff {
  background: var(--brand-soft, rgba(16, 185, 129, 0.12));
  color: var(--brand-primary, #10b981);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.history-diff-badge.is-same {
  background: var(--background-secondary, rgba(0, 0, 0, 0.05));
  color: var(--text-tertiary, #999999);
}

.history-text {
  color: var(--text-primary);
  font-size: var(--font-size-sub);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.history-text :deep(a) {
  color: var(--brand-primary);
}

/* Diff 标签高亮样式：新增绿底+删除红底删除线 */
.history-text :deep(.diff-tag-insert) {
  background-color: var(--diff-insert-bg, rgba(16, 185, 129, 0.16));
  color: var(--diff-insert-text, #059669);
  text-decoration: none;
  border-bottom: 1.5px solid var(--diff-insert-border, #10b981);
  padding: 1px 4px;
  margin: 0 1px;
  border-radius: 3px;
  font-weight: 600;
  display: inline;
}

.history-text :deep(.diff-tag-delete) {
  background-color: var(--diff-delete-bg, rgba(239, 68, 68, 0.14));
  color: var(--diff-delete-text, #dc2626);
  text-decoration: line-through;
  opacity: 0.85;
  padding: 1px 4px;
  margin: 0 1px;
  border-radius: 3px;
  font-weight: normal;
  display: inline;
}

.history-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 64px;
  color: var(--text-tertiary);
  font-size: var(--font-size-sub);
}

.history-status button {
  color: var(--brand-primary);
}

.secondhand-link-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 0 4px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--brand-primary) 22%, var(--border));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--brand-primary) 7%, var(--surface));
}

.secondhand-link-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.secondhand-price {
  color: var(--danger, #ff4848);
  font-size: var(--font-size-title-md);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}

.secondhand-link-source {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-semibold);
}

.secondhand-link-source i {
  color: var(--brand-primary);
}

.secondhand-link-description {
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.secondhand-link-button {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 0;
  border-radius: var(--radius-pill);
  color: var(--text-inverse);
  background: var(--brand-primary);
  font-size: var(--font-size-caption);
  cursor: pointer;
}

.secondhand-link-button:hover {
  filter: brightness(0.94);
}

.more-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.more-menu {
  position: absolute;
  top: 40px;
  right: 12px;
  z-index: 21;
  min-width: 132px;
  padding: var(--space-1);
  background-color: var(--surface-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  box-shadow: var(--shadow-dropdown);
  display: flex;
  flex-direction: column;
}

.more-menu-backdrop.is-floating { z-index: 1900; }
.more-menu.is-floating { position: fixed; right: auto; z-index: 1901; max-width: calc(100vw - 16px); min-width: 0; overflow-y: auto; overscroll-behavior: contain; }

.more-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  text-align: left;
  transition: background-color var(--duration-fast) var(--ease-default);
}

.more-menu-item:hover {
  background-color: var(--surface-hover);
}

.more-menu-divider {
  height: 1px;
  margin: 5px 8px;
  background: var(--border-light);
}

.more-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.more-menu-item.is-danger {
  color: var(--danger);
}

.more-menu-item.is-danger:hover {
  background-color: var(--danger);
  color: var(--text-inverse);
}
</style>
