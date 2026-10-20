<template>
  <AppDialog
    :is-open="appStore.isPublishOpen && !shuzilmGuideState.visible"
    :title="isEditMode ? (publishMode === 'article' ? '重新编辑图文' : '重新编辑动态') : publishMode === 'article' ? '发布图文' : '发布新动态'"
    :width="760"
    dialog-class="publish-dialog"
    @close="closePublish"
  >
    <template #header>
      <button type="button" class="publish-back" aria-label="返回" :disabled="submitting" @click="closePublish"><PublishIcon name="close" /></button>
      <div v-if="!isEditMode" class="header-mode-switch" role="tablist" aria-label="发布类型">
        <button
          type="button"
          role="tab"
          :aria-selected="publishMode === 'feed'"
          :class="{ 'is-selected': publishMode === 'feed' }"
          :disabled="submitting"
          @click="setPublishMode('feed')"
        >动态</button>
        <button
          type="button"
          role="tab"
          :aria-selected="publishMode === 'article'"
          :class="{ 'is-selected': publishMode === 'article' }"
          :disabled="submitting"
          @click="setPublishMode('article')"
        >图文</button>
      </div>
      <h3 v-else class="publish-title">{{ publishMode === 'article' ? '重新编辑图文' : '重新编辑动态' }}</h3>
      <button v-if="!isEditMode" type="button" class="header-drafts" :disabled="submitting || savingDraft" @click="showDrafts = true">
        <i class="far fa-file-alt"></i> 草稿（{{ draftList.length }}）
      </button>
      <button v-if="publishMode === 'feed'" type="button" class="mobile-preview" @click="previewMode = !previewMode">{{ previewMode ? '编辑' : '预览' }}</button>
      <AppButton class="mobile-publish" variant="primary" :disabled="editLoading || !!editLoadError || processingMedia || !canPublish || submitting" :loading="submitting" @click="handlePublish">{{ isEditMode ? '保存' : '发布' }}</AppButton>
    </template>
    <div class="publish-container">
      <div v-if="editLoading" class="panel-tip">正在读取可编辑动态...</div>
      <div v-else-if="editLoadError" class="error-tip"><i class="fas fa-exclamation-circle"></i> {{ editLoadError }}</div>
      <template v-else>
      <input ref="videoInputRef" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" style="display:none" @change="handleVideoSelected" />
      <fieldset :disabled="submitting" class="publish-fields">
      <div class="publish-fields-layout">
      <PublishOptionSheet :is-open="showDrafts && !isEditMode" title="草稿箱" @close="showDrafts = false">
        <div class="draft-list"><div v-for="draft in draftList" :key="draft.id" class="draft-card"><button type="button" class="draft-open" @click="switchDraft(draft)"><span class="draft-title">{{ draft.title }}</span><span class="draft-meta">{{ draft.state.mode === 'article' ? '图文' : '动态' }} · {{ draftImageCount(draft) }} 张图片 · {{ draft.state.target?.title || '未选择板块' }}</span></button><button type="button" class="draft-delete" :disabled="savingDraft" :aria-label="`删除草稿${draft.title}`" @click="removeDraft(draft.id)"><i class="far fa-trash-alt"></i></button></div><p v-if="!draftList.length" class="publish-picker-state">暂无草稿</p></div>
        <template #footer><button type="button" class="publish-confirm" :disabled="savingDraft" @click="newDraft">新建草稿</button></template>
      </PublishOptionSheet>
      <div class="publish-compose-scroll custom-scrollbar">
      <!-- 关联板块与权限设置合并在顶部，方案1：发到哪里与谁能看并排一目了然 -->
      <div v-if="!isEditMode" class="publish-target-area">
        <div class="publish-target-header">
          <PublishTargetPicker ref="targetPicker" v-model="publishTarget" />
          <button type="button" class="publish-visibility" title="谁可以看" @click="showVisibility = true">
            <i :class="visibleStatus === 1 ? 'fas fa-globe-asia' : 'fas fa-lock'"></i>
            <span>{{ visibleStatus === 1 ? '所有人可见' : '仅自己可见' }}</span>
            <i class="fas fa-chevron-down visibility-arrow"></i>
          </button>
        </div>
        <PublishProductOptions v-if="publishTarget?.type === 'product_phone'" :target="publishTarget" v-model="productOptions" />
      </div>
      <PublishArticleComposer v-if="publishMode === 'article'" v-show="!previewMode" ref="articleComposer" :model-value="articleState" :disabled="submitting || processingMedia" @update:model-value="articleState = $event" />
      <div v-if="previewMode && publishMode === 'article'" class="publish-article-preview preview-box custom-scrollbar" v-html="articlePreviewHtml"></div>
      <div v-else-if="previewMode && publishMode === 'feed'" class="preview-box custom-scrollbar">
        <div class="preview-content" v-html="previewHtml"></div>
        <div v-if="!message.trim()" class="preview-empty">输入内容后此处显示预览效果</div>
      </div>
      <div
        v-else-if="publishMode === 'feed'"
        ref="messageInput"
        :contenteditable="!submitting"
        role="textbox"
        aria-label="动态内容"
        aria-multiline="true"
        data-placeholder="分享这一刻的酷搞感受，与酷友讨论数码生活..."
        class="publish-textarea custom-scrollbar"
        @input="handleEditorInput"
        @keydown="handleEditorKeydown"
        @keyup="topicInsertOffset = editorOffset()"
        @mouseup="topicInsertOffset = editorOffset()"
        @paste="handleEditorPaste"
        @copy="handleEditorCopy"
        @cut="handleEditorCut"
        @compositionend="syncEditor"
      ></div>

      <div v-if="publishMode === 'feed' && videoAttachment" class="publish-video-preview"><video :src="videoAttachment.preview" :poster="videoAttachment.coverPreview" controls preload="metadata"></video><button type="button" aria-label="移除视频" :disabled="submitting" @click="clearVideo"><i class="fas fa-times"></i></button><p v-if="uploadingVideo">正在上传视频…</p></div>
      <div v-if="errorMessage.startsWith('最多只能添加')" class="publish-image-limit-tip"><i class="fas fa-exclamation-circle"></i> {{ errorMessage }}</div>
      <div v-if="publishMode === 'feed' && images.length > 0" class="publish-media-area">
        <div v-if="!isEditMode && !['3', '4'].includes(productOptions.subTypeId || '')" class="publish-cover-mode" role="group" aria-label="图片展示模式">
          <span class="publish-cover-mode-indicator" :class="{ 'is-large-cover': largeCover }" aria-hidden="true"></span>
          <button type="button" :class="{ 'is-selected': largeCover }" :aria-pressed="largeCover" :disabled="submitting" @click="largeCover = true">大封面</button>
          <button type="button" :class="{ 'is-selected': !largeCover }" :aria-pressed="!largeCover" :disabled="submitting" @click="largeCover = false">九宫格</button>
        </div>
        <TransitionGroup name="publish-image" tag="div" class="publish-media-preview" :class="{ 'large-cover-mode': largeCover }">
        <div v-for="(img, i) in images" :key="imageDragKey(img)" :data-image-key="imageDragKey(img)" class="media-item" :class="{ 'is-dragging': dragImageIndex === i }">
          <div class="media-thumb" @pointerdown="beginImageDrag($event, i)" @dragstart.prevent>
            <AppImage :src="img.preview" alt="动态图片" image-class="media-thumb-image" :draggable="false" />
            <button class="remove-img" :disabled="submitting" aria-label="移除图片" @click="removeImage(i)"><i class="fas fa-times"></i></button>
          </div>
          <label v-if="img.liveVideo || img.liveIdentifier" class="live-photo-mode"><select :value="img.liveEnabled ? 'live' : 'still'" :disabled="submitting" aria-label="实况上传方式" @change="img.liveEnabled = ($event.target as HTMLSelectElement).value === 'live'; img.url = undefined"><option value="live">上传实况</option><option value="still">仅静态照片</option></select></label>
          <span v-if="img.liveIdentifier && !img.liveVideo && img.liveEnabled" class="live-photo-missing">缺少原始 MOV</span>
        </div>
        <div v-if="uploadingImages" key="upload-tip" class="upload-tip">
          <i class="fas fa-circle-notch fa-spin"></i> 正在上传图片 {{ uploadedCount }}/{{ imageUploadTotal }}...
        </div>
        </TransitionGroup>
      </div>
      <input
        v-if="publishMode === 'feed'"
        ref="imageInputRef"
        type="file"
        accept="image/*,.heic,.heif,.mov,.mp4"
        multiple
        style="display: none"
        @change="handleImageSelected"
      />

      <div class="publish-settings">
      <PublishExtras ref="extrasPicker" v-if="!isEditMode" :uid="currentDraftAccount()" v-model="extraOptions" :attachment-title="attachmentTitle" @attachment-title="attachmentTitle = $event" />
      <!-- 官方仅自己可见使用 publish_status=1，不能直接把 -1 写到请求表单。 -->
      <PublishOptionSheet :is-open="showVisibility" title="谁可以看" @close="showVisibility = false"><button v-for="choice in visibilityChoices" :key="choice.value" type="button" class="publish-choice" :class="{ 'is-selected': visibleStatus === choice.value }" @click="visibleStatus = choice.value; showVisibility = false"><i :class="choice.icon"></i><span>{{ choice.title }}</span><i :class="visibleStatus === choice.value ? 'fas fa-check-circle' : 'far fa-circle'"></i></button></PublishOptionSheet>
      </div>
      <div v-if="errorMessage && !errorMessage.startsWith('最多只能添加')" class="error-tip"><i class="fas fa-exclamation-circle"></i> {{ errorMessage }}</div>
      </div>
      <!-- APK submit_feed_v8 的推荐区与工具区固定在编辑区底部。 -->
      <div class="publish-bottom-area">
      <PublishTopicRecommendations :node-type="publishTarget?.type === 'tag' ? '3' : publishTarget?.type === 'apk' ? '1' : publishTarget?.type === 'product_phone' ? '7' : '0'" :node-name="publishTarget?.title || ''" :uid="currentDraftAccount()" :text="topicSourceText" :cursor="topicInsertOffset" :refresh="topicRefresh" @select="insertRecommendedTopic" />

      <!-- 分类表情面板 -->
      <div v-if="showEmojiPanel" class="emoji-panel custom-scrollbar"><EmojiPanel :key="publishMode" :disabled="submitting || processingMedia" :selected-urls="selectedFavoriteUrls" @select="insertEmoji" @picture="selectFavoritePicture" /></div>

      <!-- 话题选择器保留正文光标，选择后替换正在输入的井号片段。 -->
      <PublishTopicPicker v-if="showTopicPanel" :uid="currentDraftAccount()" :initial-query="topicQuery" @select="selectPublishTopic" @close="showTopicPanel = false" />

      <PublishMentionPicker v-if="showMentionPanel" :uid="currentDraftAccount()" :initial-query="mentionQuery" @select="selectMentionUsers" @close="showMentionPanel = false" />

      <div class="publish-toolbar">
        <div class="toolbar-tools">
          <button
            class="tool-btn"
            :class="{ 'is-active': showEmojiPanel }"
            title="插入表情"
            @mousedown.prevent
            @click="toggleEmojiPanel"
          >
            <PublishIcon name="emotion" /> <span>表情</span>
          </button>
          <button class="tool-btn" :disabled="publishMode === 'feed' && !!videoAttachment" title="添加图片" @click="triggerImageUpload"><PublishIcon name="photo" /> <span>图片</span></button>
          <button class="tool-btn" title="@酷友" @mousedown.prevent @click="insertAtMention"><PublishIcon name="mention" /> <span>提醒</span></button>
          <button
            class="tool-btn"
            :class="{ 'is-active': showTopicPanel }"
            title="插入话题"
            @mousedown.prevent
            @click="toggleTopicPanel"
          >
            <PublishIcon name="topic" /> <span>话题</span>
          </button>

          <button v-if="!isEditMode" class="tool-btn" title="添加应用" @click="targetPicker?.openPicker('apk')"><PublishIcon name="app" /><span>应用</span></button>
          <button v-if="!isEditMode" class="tool-btn" title="添加好物" @click="extrasPicker?.openGoods()"><PublishIcon name="goods" /><span>好物</span></button>
          <button class="tool-btn" title="更多" :aria-expanded="showMore" aria-controls="publish-more-panel" @click="toggleMorePanel"><PublishIcon name="more" /><span>更多</span></button>
          <button v-if="publishMode === 'article'" class="tool-btn article-preview-toggle" :title="previewMode ? '返回编辑' : '预览效果'" :aria-label="previewMode ? '返回编辑' : '预览效果'" @click="previewMode = !previewMode">
            <PublishIcon name="eye" /> <span>{{ previewMode ? '编辑' : '预览' }}</span>
          </button>
          <button v-else-if="publishMode === 'feed'" class="tool-btn desktop-preview" title="预览效果" @click="previewMode = !previewMode">
            <PublishIcon name="eye" /> <span>{{ previewMode ? '编辑' : '预览' }}</span>
          </button>
        </div>
        <span class="word-count" :class="{ 'is-over-limit': publishMode === 'article' && (articleBodyLength > 12000 || articleEmojiCount > 100) }"><template v-if="publishMode === 'article'">{{ articleBodyLength }} / 12,000 字 · 特殊表情 {{ articleEmojiCount }} / 100</template><template v-else>{{ message.length }} / 1000</template></span>
      </div>
      <!-- APK 的更多区域使用图标网格，在工具栏下方展开。 -->
      <div v-if="showMore" id="publish-more-panel" class="publish-more-grid" aria-label="更多发布选项">
        <button v-if="!isEditMode" type="button" class="mobile-device-option" role="switch" aria-label="发动态时附带型号" :aria-checked="includeDeviceModel" :class="{ 'is-active': includeDeviceModel }" :disabled="submitting" @click="includeDeviceModel = !includeDeviceModel"><span class="more-icon"><i class="fas fa-mobile-alt"></i></span><span>附带型号</span><small>{{ includeDeviceModel ? '已开启' : '已关闭' }}</small></button>
        <button v-if="!isEditMode && publishMode === 'feed'" type="button" :disabled="processingMedia" @click="openVideoPicker"><span class="more-icon"><i class="fas fa-video"></i></span><span>视频</span></button>
        <button v-if="!isEditMode" type="button" @click="showMore = false; extrasPicker?.openDeclaration()"><span class="more-icon"><i class="far fa-file-alt"></i></span><span>内容声明</span></button>
        <button v-if="!isEditMode && extrasPicker?.hasDyhs" type="button" @click="showMore = false; extrasPicker?.openDyh()"><span class="more-icon"><i class="far fa-newspaper"></i></span><span>订阅号</span></button>
        <button type="button" @click="showMore = false; showDrafts = true"><span class="more-icon"><i class="far fa-save"></i></span><span>草稿箱</span></button>
        <button v-if="publishMode === 'feed'" type="button" @click="showMore = false; previewMode = !previewMode"><span class="more-icon"><PublishIcon name="eye" /></span><span>{{ previewMode ? '返回编辑' : '预览' }}</span></button>
        <p v-if="videoPickerHint" class="publish-more-hint">{{ videoPickerHint }}</p>
      </div>
      </div>
      </div>
      </fieldset>
      </template>
    </div>

    <template #footer>
      <div class="footer-actions">
        <button v-if="!isEditMode" type="button" class="publish-device-option" role="switch" aria-label="发动态时附带型号" :aria-checked="includeDeviceModel" :class="{ 'is-active': includeDeviceModel }" :disabled="submitting" @click="includeDeviceModel = !includeDeviceModel"><i class="fas fa-mobile-alt" aria-hidden="true"></i><span>附带型号</span><span class="device-switch-track" aria-hidden="true"></span></button>
        <AppButton variant="ghost" :disabled="submitting" @click="closePublish">取消</AppButton>
        <AppButton
          variant="primary"
          :disabled="editLoading || !!editLoadError || processingMedia || !canPublish || submitting"
          :loading="submitting"
          @click="handlePublish"
        >
          {{ isEditMode ? '保存修改' : '立即发布' }}
        </AppButton>
      </div>
    </template>
  </AppDialog>
</template>

<script setup lang="ts">
import { createUuid } from '../../utils/uuid';
import { preparePublishVideo, type PublishVideo } from '../../utils/publishVideo';
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { useAppStore } from '../../stores/app';
import { useSettingsStore } from '../../stores/settings';
import { useAuthStore } from '../../stores/auth';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { renderCoolapkEmoji, getEmojiUrl } from '../../utils/coolapkEmoji';
import { useRecentEmojis } from '../../utils/recentEmojis';
import EmojiPanel from '../common/EmojiPanel.vue';
import { isSystemEmoji, type EmojiPicture } from '../../utils/emojiPanel';
import { showToast } from '../../utils/toast';
import { renderCoolapkRichText } from '../../utils/richText';
import { extractFeedImageInputs, normalizeFeedImageItems } from '../../utils/livePhoto';
import { listFullPublishDrafts, saveFullPublishDraft, deleteFullPublishDraft, restoreFullPublishDraft, type FullPublishDraft, type PublishDraftState } from '../../utils/publishDrafts';
import { verifyWithCaptcha, extractCaptchaParamsFromResponse } from '../../utils/neteaseCaptcha';
import { shuzilmGuideState, openShuzilmGuide, isRiskControlError, hasActiveShuzilmDeviceId } from '../../utils/shuzilmDeviceGuide';
import PublishIcon from './PublishIcon.vue';
import PublishOptionSheet from './PublishOptionSheet.vue';
import '../../styles/publish.css';
import PublishTopicPicker from './PublishTopicPicker.vue';
import PublishTargetPicker from './PublishTargetPicker.vue';
import PublishExtras from './PublishExtras.vue';
import type { PublishTarget, PublishOptions } from '../../types/publish';
import PublishProductOptions from './PublishProductOptions.vue';
import { validateProductPublish } from '../../utils/publishProduct';
import { preparePublishImage, originalLiveCompanions, movePublishImage, type PublishImage } from '../../utils/publishMedia';
import PublishMentionPicker, { type MentionUser } from './PublishMentionPicker.vue';
import PublishTopicRecommendations from './PublishTopicRecommendations.vue';
import type { PublishTopic } from '../../utils/publishTopics';
import AppDialog from '../common/AppDialog.vue';
import AppButton from '../common/AppButton.vue';
import AppImage from '../common/AppImage.vue';
import PublishArticleComposer from './PublishArticleComposer.vue';
import { buildPublishArticleMessage, hasPublishableArticleText, parsePublishArticleMessage, type PublishArticleState } from '../../utils/publishArticle';
import { renderPublishArticlePreview } from '../../utils/publishArticleMarkdown';

const appStore = useAppStore();
const settingsStore = useSettingsStore();
const authStore = useAuthStore();
const MAX_IMAGES = 9;
const message = ref('');
const images = ref<PublishImage[]>([]);
const videoAttachment = ref<PublishVideo>();
type PublishMode = 'feed' | 'article';
const publishMode = ref<PublishMode>('feed');
function emptyArticle(): PublishArticleState { return { title: '', cover: null, blocks: [{ id: createUuid(), type: 'text', text: '' }] }; }
const articleState = ref<PublishArticleState>(emptyArticle());
const selectedFavoriteUrls = computed(() => (publishMode.value === 'article'
  ? articleState.value.blocks.flatMap(block => block.type === 'image' ? [block.image] : [])
  : images.value).flatMap(image => image.url ? [image.url] : []));
const articleComposer = ref<InstanceType<typeof PublishArticleComposer> | null>(null);
const articleBodyLength = computed(() => articleState.value.blocks.reduce((count, block) => count + (block.type === 'text' ? block.text.length : 0), 0));
const articleEmojiCount = computed(() => articleState.value.blocks.reduce((count, block) => count + (block.type === 'text' ? emojiCount(block.text) : 0), 0));
const canPublish = computed(() => publishMode.value === 'article'
  ? !articleComposer.value?.isPreparing() && !!articleState.value.title.trim() && articleBodyLength.value <= 12000 && articleEmojiCount.value <= 100 && hasPublishableArticleText(articleState.value)
  : !!message.value.trim() || images.value.length > 0 || !!videoAttachment.value);
const uploadableImageCount = computed(() => publishMode.value === 'article'
  ? [articleState.value.cover, ...articleState.value.blocks.filter((block) => block.type === 'image').map((block) => block.image)].filter((image) => !!image?.file && !image.url).length
  : images.value.filter((image) => !!image.file && !image.url).length);
const topicSourceText = computed(() => publishMode.value === 'article'
  ? articleState.value.blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
  : message.value);
const publishTarget = ref<PublishTarget | null>(null);
const productOptions = ref<PublishOptions>({});
const extraOptions = ref<PublishOptions>({ originalType: 0, extraUrl: '', dyhId: '' });
const defaultIncludeDeviceModel = ref(false);
const includeDeviceModel = computed({
  get: () => extraOptions.value.includeDeviceModel ?? defaultIncludeDeviceModel.value,
  set: (value: boolean) => { extraOptions.value = { ...extraOptions.value, includeDeviceModel: value }; },
});
const attachmentTitle = ref('');
const targetPicker = ref<InstanceType<typeof PublishTargetPicker> | null>(null);
const extrasPicker = ref<InstanceType<typeof PublishExtras> | null>(null);
const showMore = ref(false);
const visibleStatus = ref<1 | -1>(1);
const showVisibility = ref(false);
const visibilityChoices = [{ value: 1, title: '所有人', icon: 'fas fa-globe-asia' }, { value: -1, title: '仅自己', icon: 'fas fa-lock' }] as const;
watch(publishTarget, () => { if (!restoringDraft) productOptions.value = {}; });
const largeCover = ref(false);
const processingMedia = ref(false);
const dragImageIndex = ref(-1);
const videoInputRef = ref<HTMLInputElement | null>(null);
const videoPickerHint = ref('');
const uploadingVideo = ref(false);
function clearVideo() { if (videoAttachment.value) URL.revokeObjectURL(videoAttachment.value.preview); videoAttachment.value = undefined; }
function openVideoPicker() {
  videoPickerHint.value = '';
  if (submitting.value || processingMedia.value) return;
  if (images.value.length) { videoPickerHint.value = '视频和图片不能同时发布，请先移除已选图片'; return; }
  const input = videoInputRef.value;
  if (!input) { videoPickerHint.value = '视频选择器暂不可用，请重新打开发布窗口'; return; }
  showMore.value = false;
  try { if (typeof input.showPicker === 'function') input.showPicker(); else input.click(); }
  catch { input.click(); }
}
const uploadingImages = ref(false);
const uploadedCount = ref(0);
const imageUploadTotal = ref(0);
const submitting = ref(false);
const errorMessage = ref('');
const showEmojiPanel = ref(false);
const { addRecent } = useRecentEmojis();
const showTopicPanel = ref(false);
const showMentionPanel = ref(false);
const mentionQuery = ref('');
const mentionTriggerStart = ref<number | null>(null);
const mentionInsertOffset = ref(0);
const topicQuery = ref('');
const topicRefresh = ref(0);
const topicTriggerStart = ref<number | null>(null);
// 自定义话题输入框获得焦点后，仍按正文原来的光标位置插入话题。
const topicInsertOffset = ref(0);
const previewMode = ref(false);
const editLoading = ref(false);
const editLoadError = ref('');
const isEditMode = computed(() => !!appStore.editFeedTarget);
const messageInput = ref<HTMLDivElement | null>(null);
const imageInputRef = ref<HTMLInputElement | null>(null);
let restoringDraft = false;
let openRevision = 0;
const draftId = ref('');
const draftList = ref<FullPublishDraft[]>([]);
const showDrafts = ref(false);
const savingDraft = ref(false);
let draftAccount = '';
let sessionIsEdit = false;
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let saveRevision = 0;
onBeforeUnmount(() => { finishImageDrag(); clearTimeout(draftTimer); ++openRevision; clearVideo(); });

async function closePublish() {
  if (submitting.value || processingMedia.value) return;
  finishImageDrag();
  try { await persistCurrentDraft(); appStore.closePublish(); }
  catch (failure) { errorMessage.value = `保存草稿失败：${failure instanceof Error ? failure.message : String(failure)}`; }
}

function draftSnapshot(): PublishDraftState {
  return { mode: publishMode.value, article: { title: articleState.value.title, cover: articleState.value.cover ? { ...articleState.value.cover } : null, blocks: articleState.value.blocks.map((block) => block.type === 'image' ? { ...block, image: { ...block.image } } : { ...block }) }, text: message.value, images: images.value.map((image) => ({ ...image })), target: publishTarget.value ? JSON.parse(JSON.stringify(publishTarget.value)) : null, productOptions: { ...productOptions.value }, visibleStatus: visibleStatus.value, largeCover: largeCover.value, extraOptions: { ...extraOptions.value }, attachmentTitle: attachmentTitle.value, video: videoAttachment.value ? { ...videoAttachment.value } : undefined };
}
async function persistCurrentDraft() {
  clearTimeout(draftTimer);
  if (sessionIsEdit || !draftId.value || !draftAccount) return;
  const request = ++saveRevision;
  const uid = draftAccount;
  const id = draftId.value;
  const state = draftSnapshot();
  savingDraft.value = true;
  try {
    const articleHasContent = !!state.article?.title.trim() || !!state.article?.cover || !!state.article?.blocks.some((block) =>
      block.type === 'image' || block.type === 'preserved' || (block.type === 'text' && block.text.trim()),
    );
    if (state.text.trim() || state.images.length || state.video || articleHasContent || state.target || state.extraOptions.extraUrl || state.extraOptions.dyhId || state.extraOptions.originalType || state.visibleStatus !== 1 || state.largeCover) await saveFullPublishDraft(uid, id, state);
    else await deleteFullPublishDraft(uid, id);
    if (uid === draftAccount) draftList.value = await listFullPublishDrafts(uid);
  } finally { if (request === saveRevision) savingDraft.value = false; }
}
async function applyDraftState(state: PublishDraftState, id: string) {
  restoringDraft = true;
  clearTimeout(draftTimer);
  draftId.value = id;
  publishMode.value = state.mode || 'feed';
  articleState.value = state.article || emptyArticle();
  message.value = state.text;
  images.value = state.images;
  clearVideo(); videoAttachment.value = state.video;
  publishTarget.value = state.target;
  productOptions.value = state.productOptions;
  visibleStatus.value = state.visibleStatus;
  largeCover.value = state.largeCover;
  extraOptions.value = state.extraOptions;
  attachmentTitle.value = state.attachmentTitle;
  showTopicPanel.value = false;
  showMentionPanel.value = false;
  previewMode.value = false;
  await nextTick();
  renderEditor();
  restoringDraft = false;
}
async function switchDraft(draft: FullPublishDraft) {
  try { await persistCurrentDraft(); await applyDraftState(restoreFullPublishDraft(draft), draft.id); showDrafts.value = false; }
  catch (failure) { errorMessage.value = `读取草稿失败：${failure instanceof Error ? failure.message : String(failure)}`; }
}
async function newDraft() {
  try {
    await persistCurrentDraft();
    await applyDraftState({ mode: 'feed', article: emptyArticle(), text: '', images: [], target: null, productOptions: {}, visibleStatus: 1, largeCover: false, extraOptions: {}, attachmentTitle: '' }, createUuid());
    showDrafts.value = false;
  } catch (failure) { errorMessage.value = `保存草稿失败：${failure instanceof Error ? failure.message : String(failure)}`; }
}
async function removeDraft(id: string) {
  try {
    clearTimeout(draftTimer);
    await deleteFullPublishDraft(draftAccount, id);
    if (id === draftId.value) await applyDraftState({ mode: 'feed', article: emptyArticle(), text: '', images: [], target: null, productOptions: {}, visibleStatus: 1, largeCover: false, extraOptions: {}, attachmentTitle: '' }, createUuid());
    draftList.value = await listFullPublishDrafts(draftAccount);
  } catch (failure) { errorMessage.value = `删除草稿失败：${failure instanceof Error ? failure.message : String(failure)}`; }
}

function currentDraftAccount(): string {
  return appStore.isPublishOpen && draftAccount ? draftAccount : String(authStore.user?.uid || 'guest');
}

function setPublishMode(mode: PublishMode) {
  if (isEditMode.value || submitting.value || publishMode.value === mode) return;
  publishMode.value = mode;
  previewMode.value = false;
  showEmojiPanel.value = false;
  showTopicPanel.value = false;
  showMentionPanel.value = false;
  showMore.value = false;
  errorMessage.value = '';
}

function draftImageCount(draft: FullPublishDraft): number {
  const article = draft.state.article;
  return draft.state.mode === 'article'
    ? (article?.cover ? 1 : 0) + (article?.blocks.filter((block) => block.type === 'image').length || 0)
    : draft.state.images.length;
}
// 账号切换时先保存原账号草稿再退出编辑，避免草稿和发布凭据跨账号混用。
watch(() => authStore.user?.uid, () => { if (appStore.isPublishOpen && draftAccount !== String(authStore.user?.uid || 'guest')) void closePublish(); });

const previewHtml = computed(() => {
  // 预览统一走安全化渲染（先 sanitize 再渲染酷安表情），
  // 与正文实际展示逻辑一致，防止预览阶段注入 HTML
  return renderCoolapkRichText(message.value);
});
const articlePreviewHtml = computed(() => renderPublishArticlePreview(articleState.value));

watch(() => appStore.isPublishOpen, async (open) => {
  const revision = ++openRevision;
  if (open) {
    restoringDraft = true;
    draftAccount = String(authStore.user?.uid || 'guest');
    sessionIsEdit = isEditMode.value;
    draftId.value = createUuid();
    showDrafts.value = false;
    showVisibility.value = false;
    showMore.value = false;
    videoPickerHint.value = '';
    clearTimeout(draftTimer);
    message.value = '';
    publishMode.value = 'feed';
    articleState.value = emptyArticle();
    publishTarget.value = null;
    visibleStatus.value = 1;
    largeCover.value = false;
    extraOptions.value = { originalType: 0, extraUrl: '', dyhId: '' };
    attachmentTitle.value = '';
    images.value = []; clearVideo();
    uploadingImages.value = false; uploadingVideo.value = false;
    errorMessage.value = '';
    previewMode.value = false;
    showEmojiPanel.value = false;
    showTopicPanel.value = false;
    showMentionPanel.value = false;
    mentionTriggerStart.value = null;
    topicQuery.value = '';
    topicTriggerStart.value = null;
    editLoadError.value = '';
    if (appStore.editFeedTarget) {
      editLoading.value = true;
      try {
        const response = await CoolapkTauriAPI.getEditableFeed(String(appStore.editFeedTarget.id));
        if (revision !== openRevision || !appStore.isPublishOpen) return;
        const feed = response?.data;
        if (!feed || String(feed.id) !== String(appStore.editFeedTarget.id)) throw new Error('获取可编辑动态失败');
        const authorUid = feed.uid ?? feed.userInfo?.uid;
        if (authorUid && String(authorUid) !== String(authStore.user?.uid)) throw new Error('只能编辑自己发布的动态');
        const canEdit = feed.enableModify ?? feed.enable_modify;
        if (canEdit !== undefined && Number(canEdit) !== 1) throw new Error('此动态当前不允许编辑或编辑次数已用尽');
        const articleType = Number(feed.isHtmlArticle ?? feed.is_html_article ?? 0);
        if (String(feed.feedType ?? feed.feed_type ?? 'feed') !== 'feed' && articleType !== 1) throw new Error('目前只支持重新编辑普通动态和图文');
        if (Number(feed.mediaType ?? feed.media_type ?? 0) > 0 || String(feed.mediaUrl ?? feed.media_url ?? '')) throw new Error('暂不支持重新编辑视频动态');
        const cardFeed = appStore.editFeedTarget;
        if (articleType === 1) {
          publishMode.value = 'article';
          // changeDetail may put a display placeholder in `message` (for example "图文动态").
          // The editable ArticleModel array is carried by message_raw_input/output.
          const articleMessage = [feed.messageRawInput, feed.message_raw_input, feed.messageRawOutput, feed.message_raw_output, feed.message]
            .find((value) => {
              if (Array.isArray(value)) return true;
              if (typeof value !== 'string' || !value.trim()) return false;
              try { return Array.isArray(JSON.parse(value)); } catch { return false; }
            });
          articleState.value = parsePublishArticleMessage(articleMessage, {
            title: [feed.messageTitle, feed.message_title, cardFeed.messageTitle, cardFeed.message_title, cardFeed.title]
              .find((value) => typeof value === 'string' && value.trim().length > 0),
            cover: [feed.messageCover, feed.message_cover, cardFeed.messageCover, cardFeed.message_cover]
              .find((value) => typeof value === 'string' && value.trim().length > 0),
          });
        } else {
          if (articleType !== 0) throw new Error('暂不支持重新编辑大封面动态');
          message.value = [feed.messageRawInput, feed.message_raw_input, feed.message, feed.messageRawOutput, cardFeed.message, cardFeed.message_raw_output].find((value) => typeof value === 'string' && value.trim()) || '';
          const imageInputs = extractFeedImageInputs(feed);
          const detailItems = normalizeFeedImageItems(imageInputs.length === 1 && typeof imageInputs[0] === 'string' && imageInputs[0].includes(',') ? imageInputs[0].split(',') : imageInputs);
          const cardItems = normalizeFeedImageItems(extractFeedImageInputs(cardFeed));
          if (imageInputs.length > 0 && detailItems.length === 0 && cardItems.length === 0) throw new Error('无法识别原动态图片，为避免丢失图片，已停止编辑');
          if ([...detailItems, ...cardItems].some((item) => item.isLivePhoto)) throw new Error('暂不支持重新编辑实况照片动态，以免丢失照片信息');
          const originalPics = typeof feed.pic === 'string' ? feed.pic.split(',').filter(Boolean) : [];
          const imageCount = Math.max(detailItems.length, cardItems.length, originalPics.length);
          images.value = Array.from({ length: imageCount }, (_, index) => ({
            url: originalPics.length === imageCount ? originalPics[index] : cardItems[index]?.sourceUrl || detailItems[index]?.sourceUrl || '',
            preview: cardItems[index]?.coverUrl || detailItems[index]?.coverUrl || '',
          }));
          if (images.value.some((image) => !image.url || !image.preview)) throw new Error('原动态图片信息不完整，为避免丢失图片，已停止编辑');
        }
      } catch (error: any) {
        if (revision === openRevision) editLoadError.value = error?.message || String(error);
      } finally {
        if (revision === openRevision) editLoading.value = false;
      }
    } else {
      defaultIncludeDeviceModel.value = false;
      try {
        const response = await CoolapkTauriAPI.getDeviceInfo();
        if (revision !== openRevision || !appStore.isPublishOpen) return;
        defaultIncludeDeviceModel.value = response?.data?.defaultProfile?.includeDeviceModel === true;
      } catch { /* 无法确认真实设备时默认不附带型号。 */ }
      try {
        draftList.value = await listFullPublishDrafts(draftAccount);
        if (revision !== openRevision || !appStore.isPublishOpen) return;
        if (appStore.publishInitialText) message.value = appStore.publishInitialText;
        else if (draftList.value[0]) await applyDraftState(restoreFullPublishDraft(draftList.value[0]), draftList.value[0].id);
      } catch (failure) { editLoadError.value = `草稿读取失败：${failure instanceof Error ? failure.message : String(failure)}`; }
    }
    await nextTick();
    renderEditor();
    restoringDraft = false;
    nextTick(() => messageInput.value?.focus());
  }
});

watch([publishMode, articleState, message, images, videoAttachment, publishTarget, productOptions, visibleStatus, largeCover, extraOptions, attachmentTitle], () => {
  if (restoringDraft || sessionIsEdit || !appStore.isPublishOpen) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { void persistCurrentDraft().catch((failure) => { errorMessage.value = `保存草稿失败：${String(failure)}`; }); }, 600);
}, { deep: true });

watch(previewMode, async (preview) => {
  if (!preview) { await nextTick(); renderEditor(); }
});

function escapeEditorText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 编辑区显示表情图片，实际草稿和发布内容仍保留酷安使用的 [表情名] 文本。
function editorText(node: Node | null): string {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node instanceof HTMLImageElement) return node.alt || '';
  return Array.from(node.childNodes).map(editorText).join('');
}

function editorOffset(): number {
  const editor = messageInput.value;
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return message.value.length;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(editor);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  return editorText(range.cloneContents()).length;
}

function setEditorOffset(offset: number) {
  const editor = messageInput.value;
  if (!editor) return;
  const selection = window.getSelection();
  const range = document.createRange();
  let remaining = offset;
  let found = false;
  const nodes = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (nodes.nextNode()) {
    const node = nodes.currentNode;
    if (node instanceof HTMLImageElement) {
      const length = node.alt.length;
      if (remaining === 0) { range.setStartBefore(node); found = true; break; }
      if (remaining <= length) { range.setStartAfter(node); found = true; break; }
      remaining -= length;
    } else if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length || 0;
      if (remaining <= length) { range.setStart(node, remaining); found = true; break; }
      remaining -= length;
    }
  }
  if (!found) range.selectNodeContents(editor);
  range.collapse(!found ? false : true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function renderEditor(caret?: number) {
  const editor = messageInput.value;
  if (!editor) return;
  // 先按原始文本切分完整话题，再转义和渲染表情；保存、复制和发送仍使用纯文本。
  let html = '', end = 0;
  for (const topic of editorTopics(message.value)) {
    html += renderCoolapkEmoji(escapeEditorText(message.value.slice(end, topic.index)));
    html += `<span class="publish-topic">${renderCoolapkEmoji(escapeEditorText(topic.text))}</span>`;
    end = topic.index + topic.text.length;
  }
  editor.innerHTML = html + renderCoolapkEmoji(escapeEditorText(message.value.slice(end)));
  if (caret !== undefined) setEditorOffset(caret);
}

function editorTopics(value: string) {
  return Array.from(value.matchAll(/#[^#\r\n]+#/g)).filter((match) => match[0].slice(1, -1).trim()).map((match) => ({ text: match[0], index: match.index! }));
}

// 只在话题结构变化时重绘，普通输入保留原 DOM；删除井号或在话题末尾输入时清除颜色继承。
function topicHighlightChanged(editor: HTMLElement, value: string): boolean {
  const topics = editorTopics(value);
  const spans = Array.from(editor.querySelectorAll('.publish-topic'));
  if (topics.length !== spans.length) return true;
  return spans.some((span, index) => {
    const before = document.createRange();
    before.selectNodeContents(editor);
    before.setEndBefore(span);
    return editorText(span) !== topics[index].text || editorText(before.cloneContents()).length !== topics[index].index;
  });
}

function emojiCount(value: string): number {
  return Array.from(value.matchAll(/\[([^\]\r\n]{1,20})\]/g)).filter((match) => !!getEmojiUrl(match[1])).length;
}

function syncEditor() {
  const editor = messageInput.value;
  if (!editor) return;
  const caret = editorOffset();
  const value = editorText(editor);
  if (value.length > 1000) {
    message.value = value.slice(0, 1000);
    renderEditor(Math.min(caret, 1000));
    return;
  }
  message.value = value;
  if (editor.querySelectorAll('img.coolapk-emoji').length !== emojiCount(value) || topicHighlightChanged(editor, value)) renderEditor(caret);
}

function handleEditorInput(event: InputEvent) {
  const editor = messageInput.value;
  if (!editor || event.currentTarget !== editor) return;
  if (event.isComposing) { message.value = editorText(editor); return; }
  syncEditor();
  // 输入未闭合的话题时自动打开选择器；粘贴整段文字不触发选择。
  if (event.inputType === 'insertText') {
    const offset = editorOffset();
    const fragment = message.value.slice(0, offset).match(/(?:^|[\s])#([^#\n]{0,80})$/);
    if (fragment) {
      topicTriggerStart.value = offset - fragment[1].length - 1;
      topicInsertOffset.value = offset;
      topicQuery.value = fragment[1];
      showTopicPanel.value = true;
      showEmojiPanel.value = false;
      showMentionPanel.value = false;
    } else if (topicTriggerStart.value !== null) { showTopicPanel.value = false; topicTriggerStart.value = null; }
    const mention = message.value.slice(0, offset).match(/(?:^|[\s])@([^@\s]{0,40})$/);
    if (mention) {
      mentionTriggerStart.value = offset - mention[1].length - 1;
      mentionInsertOffset.value = offset;
      mentionQuery.value = mention[1];
      showMentionPanel.value = true;
      showTopicPanel.value = false;
      showEmojiPanel.value = false;
    } else if (mentionTriggerStart.value !== null) { showMentionPanel.value = false; mentionTriggerStart.value = null; }
  }
}

function insertAtCursor(text: string, offset?: number) {
  const editor = messageInput.value;
  if (!editor) return;
  editor.focus();
  if (offset !== undefined) setEditorOffset(offset);
  const selection = window.getSelection();
  const range = selection?.rangeCount && editor.contains(selection.anchorNode) ? selection.getRangeAt(0) : document.createRange();
  if (!editor.contains(range.startContainer)) { range.selectNodeContents(editor); range.collapse(false); }
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  syncEditor();
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); insertAtCursor('\n'); }
}

function handleEditorPaste(event: ClipboardEvent) {
  event.preventDefault();
  insertAtCursor(event.clipboardData?.getData('text/plain') || '');
}

function handleEditorCopy(event: ClipboardEvent) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !messageInput.value?.contains(selection.anchorNode)) return;
  event.preventDefault();
  event.clipboardData?.setData('text/plain', editorText(selection.getRangeAt(0).cloneContents()));
}

function handleEditorCut(event: ClipboardEvent) {
  handleEditorCopy(event);
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  selection.getRangeAt(0).deleteContents();
  syncEditor();
}

function insertEmoji(name: string) {
  addRecent(name);
  insertPublishText(isSystemEmoji(name) ? name : `[${name}]`);
}

function selectFavoritePicture(picture: EmojiPicture) {
  if (submitting.value || processingMedia.value || videoAttachment.value) return;
  if (selectedFavoriteUrls.value.includes(picture.url)) { showToast('已经添加了', 'info'); return; }
  if (publishMode.value !== 'article' && images.value.length >= MAX_IMAGES) {
    errorMessage.value = `最多只能添加 ${MAX_IMAGES} 张图片`;
    return;
  }
  const image: PublishImage = { url: picture.url, preview: picture.url };
  if (publishMode.value === 'article') articleComposer.value?.insertPreparedPicture(image);
  else images.value.push(image);
}

function insertRecommendedTopic(title: string) {
  insertPublishText(`#${title}# `);
  if (publishMode.value === 'feed') topicInsertOffset.value = editorOffset();
}

function selectPublishTopic(topic: PublishTopic) {
  topicRefresh.value++;
  if (publishMode.value === 'article') {
    articleComposer.value?.insertTextAtCaret(`#${topic.title}# `);
    showTopicPanel.value = false;
    topicTriggerStart.value = null;
    topicQuery.value = '';
    return;
  }
  const start = topicTriggerStart.value;
  if (start !== null) {
    const end = topicInsertOffset.value;
    message.value = message.value.slice(0, start) + message.value.slice(end);
    renderEditor(start);
  }
  insertAtCursor(`#${topic.title}# `, start ?? topicInsertOffset.value);
  showTopicPanel.value = false;
  topicTriggerStart.value = null;
  topicQuery.value = '';
}

async function insertAtMention() {
  if (publishMode.value === 'article') {
    mentionTriggerStart.value = null;
    mentionQuery.value = '';
    showMentionPanel.value = !showMentionPanel.value;
    if (showMentionPanel.value) { showTopicPanel.value = false; showEmojiPanel.value = false; showMore.value = false; }
    return;
  }
  if (previewMode.value) { previewMode.value = false; await nextTick(); renderEditor(); }
  mentionInsertOffset.value = editorOffset();
  mentionTriggerStart.value = null;
  mentionQuery.value = '';
  showMentionPanel.value = !showMentionPanel.value;
  if (showMentionPanel.value) { showTopicPanel.value = false; showEmojiPanel.value = false; showMore.value = false; }
}

function selectMentionUsers(users: MentionUser[]) {
  if (publishMode.value === 'article') {
    articleComposer.value?.insertTextAtCaret(users.map((user) => `@${user.username} `).join(''));
    showMentionPanel.value = false;
    return;
  }
  const start = mentionTriggerStart.value;
  if (start !== null) {
    message.value = message.value.slice(0, start) + message.value.slice(mentionInsertOffset.value);
    renderEditor(start);
  }
  insertAtCursor(users.map((user) => `@${user.username} `).join(''), start ?? mentionInsertOffset.value);
  showMentionPanel.value = false;
  mentionTriggerStart.value = null;
}

function insertPublishText(text: string) {
  if (publishMode.value === 'article') articleComposer.value?.insertTextAtCaret(text);
  else insertAtCursor(text);
}

function toggleEmojiPanel() {
  showEmojiPanel.value = !showEmojiPanel.value;
  if (showEmojiPanel.value) { showTopicPanel.value = false; showMentionPanel.value = false; showMore.value = false; }
}

async function toggleTopicPanel() {
  if (publishMode.value === 'article') {
    topicTriggerStart.value = null;
    topicQuery.value = '';
    showTopicPanel.value = !showTopicPanel.value;
    if (showTopicPanel.value) { showEmojiPanel.value = false; showMentionPanel.value = false; showMore.value = false; }
    return;
  }
  if (previewMode.value) { previewMode.value = false; await nextTick(); renderEditor(); }
  topicInsertOffset.value = editorOffset();
  topicTriggerStart.value = null;
  topicQuery.value = '';
  showTopicPanel.value = !showTopicPanel.value;
  if (showTopicPanel.value) { showEmojiPanel.value = false; showMentionPanel.value = false; showMore.value = false; }
}

function toggleMorePanel() {
  showMore.value = !showMore.value;
  if (showMore.value) { showEmojiPanel.value = false; showTopicPanel.value = false; showMentionPanel.value = false; }
}

function triggerImageUpload() {
  if (publishMode.value === 'article') {
    articleComposer.value?.openImagePicker();
    return;
  }
  if (images.value.length >= MAX_IMAGES) {
    errorMessage.value = `最多只能添加 ${MAX_IMAGES} 张图片`;
    return;
  }
  imageInputRef.value?.click();
}

async function handleVideoSelected(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file || submitting.value || processingMedia.value || images.value.length) return;
  videoPickerHint.value = '';
  const revision = openRevision; processingMedia.value = true; errorMessage.value = '';
  try { const video = await preparePublishVideo(file); if (revision !== openRevision || !appStore.isPublishOpen) { URL.revokeObjectURL(video.preview); return; } clearVideo(); videoAttachment.value = video; showMore.value = false; }
  catch (error) { errorMessage.value = error instanceof Error ? error.message : String(error); }
  finally { processingMedia.value = false; }
}

async function handleImageSelected(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files ? Array.from(target.files) : [];
  target.value = '';
  if (!files.length || submitting.value || processingMedia.value || videoAttachment.value) return;
  videoPickerHint.value = '';
  const revision = openRevision;
  processingMedia.value = true;
  errorMessage.value = '';
  try {
  const companions = await originalLiveCompanions(files);
  for (const image of images.value) { if (image.liveIdentifier && !image.liveVideo && companions.has(image.liveIdentifier)) { image.liveVideo = companions.get(image.liveIdentifier); image.url = undefined; } }
  const photoFiles = files.filter(file => !/\.(mov|mp4)$/i.test(file.name));
  const remain = MAX_IMAGES - images.value.length;
  if (photoFiles.length > remain) errorMessage.value = `最多只能添加 ${MAX_IMAGES} 张图片`;
  // 顺序读取保证选择顺序，某张图片出错时保留其他可用图片。
  for (const file of photoFiles.slice(0, remain)) {
    try { const image = await preparePublishImage(file); if (image.liveIdentifier && !image.liveVideo) image.liveVideo = companions.get(image.liveIdentifier); if (revision === openRevision && appStore.isPublishOpen && images.value.length < MAX_IMAGES) images.value.push(image); }
    catch (failure) { errorMessage.value = `${file.name}：${failure instanceof Error ? failure.message : String(failure)}`; }
  }
  if (!photoFiles.length && !companions.size) errorMessage.value = '所选文件不是实况原片中的动态文件；普通视频请从更多 → 视频上传';
  } catch (failure) { errorMessage.value = failure instanceof Error ? failure.message : String(failure); } finally { processingMedia.value = false; }
}

// 保持照片的 DOM 标识稳定，排序时不因下标变化而重建图片和实况选项。
const imageDragKeys = new WeakMap<PublishImage, string>();
let imageDragSerial = 0;
function imageDragKey(image: PublishImage): string {
  let key = imageDragKeys.get(image);
  if (!key) { key = String(++imageDragSerial); imageDragKeys.set(image, key); }
  return key;
}
let imageDrag: { pointerId: number; key: string; x: number; y: number; scroll: HTMLElement | null; scrollTop: number; slots: DOMRect[]; active: boolean } | null = null;
// 用指针事件避开桌面窗口的系统文件拖放处理，实况原片始终随照片一起移动。
function beginImageDrag(event: PointerEvent, index: number) {
  if (event.button !== 0 || submitting.value || processingMedia.value || (event.target as HTMLElement).closest('button, select, input')) return;
  const grid = (event.currentTarget as HTMLElement).closest<HTMLElement>('.publish-media-preview');
  if (!grid) return;
  finishImageDrag();
  const scroll = grid.closest<HTMLElement>('.publish-compose-scroll');
  imageDrag = { pointerId: event.pointerId, key: imageDragKey(images.value[index]), x: event.clientX, y: event.clientY, scroll, scrollTop: scroll?.scrollTop ?? 0, slots: Array.from(grid.querySelectorAll<HTMLElement>('.media-item')).map(item => item.getBoundingClientRect()), active: false };
  event.preventDefault();
  document.addEventListener('pointermove', moveImageDrag, { passive: false });
  document.addEventListener('pointerup', endImageDrag);
  document.addEventListener('pointercancel', endImageDrag);
  window.addEventListener('blur', finishImageDrag);
}
function moveImageDrag(event: PointerEvent) {
  const drag = imageDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (submitting.value) { finishImageDrag(); return; }
  if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
  drag.active = true;
  event.preventDefault();
  const from = images.value.findIndex(image => imageDragKey(image) === drag.key);
  const scrollDelta = (drag.scroll?.scrollTop ?? drag.scrollTop) - drag.scrollTop;
  const pointerY = event.clientY + scrollDelta;
  let to = drag.slots.findIndex(slot => event.clientX >= slot.left && event.clientX <= slot.right && pointerY >= slot.top && pointerY <= slot.bottom);
  if (to < 0 && drag.slots.length) to = drag.slots.reduce((closest, slot, slotIndex) => {
    const distance = Math.hypot(event.clientX - (slot.left + slot.right) / 2, pointerY - (slot.top + slot.bottom) / 2);
    const closestSlot = drag.slots[closest];
    return distance < Math.hypot(event.clientX - (closestSlot.left + closestSlot.right) / 2, pointerY - (closestSlot.top + closestSlot.bottom) / 2) ? slotIndex : closest;
  }, 0);
  if (from >= 0 && to >= 0 && from !== to) images.value = movePublishImage(images.value, from, to);
  dragImageIndex.value = images.value.findIndex(image => imageDragKey(image) === drag.key);
  // 窗口较小时靠近编辑区边缘滚动，继续拖动时能看到下面的图片。
  if (drag.scroll) {
    const bounds = drag.scroll.getBoundingClientRect();
    if (event.clientY < bounds.top + 28) drag.scroll.scrollTop -= 16;
    else if (event.clientY > bounds.bottom - 28) drag.scroll.scrollTop += 16;
  }
}
function endImageDrag(event: PointerEvent) { if (event.pointerId === imageDrag?.pointerId) finishImageDrag(); }
function finishImageDrag() {
  imageDrag = null;
  dragImageIndex.value = -1;
  document.removeEventListener('pointermove', moveImageDrag);
  document.removeEventListener('pointerup', endImageDrag);
  document.removeEventListener('pointercancel', endImageDrag);
  window.removeEventListener('blur', finishImageDrag);
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

async function uploadArticleImage(image: PublishImage): Promise<string> {
  if (image.url) return image.url;
  if (!image.file) throw new Error('图文中有图片尚未准备好，请重新选择');
  const bytes = new Uint8Array(await image.file.arrayBuffer());
  const liveVideo = image.liveEnabled && image.liveVideo ? new Uint8Array(await image.liveVideo.arrayBuffer()) : undefined;
  const result = await CoolapkTauriAPI.uploadImage(bytes, image.file.name, image.file.type || 'image/jpeg', 'feed', undefined, liveVideo, image.hdr || 0);
  image.url = resolveUploadedUrl(result?.data);
  uploadedCount.value += 1;
  return image.url;
}

function removeImage(index: number) {
  if (submitting.value) return;
  images.value.splice(index, 1);
  if (!images.value.length) videoPickerHint.value = '';
}

function buildFinalMessage(): string {
  const base = message.value.trim();
  if (isEditMode.value) return message.value;
  if (
    settingsStore.settings.publishDeviceSignature &&
    settingsStore.settings.deviceSignature &&
    base.length > 0
  ) {
    return `${base}\n来自 ${settingsStore.settings.deviceSignature.trim()}`;
  }
  return base;
}

async function handlePublish() {
  if (!canPublish.value || submitting.value || processingMedia.value || editLoading.value || editLoadError.value) return;
  const articleImages = [articleState.value.cover, ...articleState.value.blocks.filter((block) => block.type === 'image').map((block) => block.image)].filter((image): image is PublishImage => !!image);
  const selectedImages = publishMode.value === 'article' ? articleImages : images.value;
  if (selectedImages.some(image => image.liveEnabled && !image.liveVideo)) { errorMessage.value = '实况照片缺少原始动态文件，请同时选择原片及对应 MOV，或选择仅静态照片'; return; }
  if (draftAccount !== String(authStore.user?.uid || 'guest')) { errorMessage.value = '账号已切换，请重新打开发帖页'; return; }

  if (!isEditMode.value) {
    const validation = validateProductPublish(publishTarget.value, productOptions.value, publishMode.value === 'article' ? articleImages.length : images.value.length);
    if (validation) { errorMessage.value = validation; return; }
  }

  const proceedPublish = async () => {
    submitting.value = true;
    uploadingImages.value = uploadableImageCount.value > 0;
    imageUploadTotal.value = uploadableImageCount.value;
    uploadedCount.value = 0;
    errorMessage.value = '';
    try {
      let pic = '';
      let requestMessage = '';
      let articleCoverUrl = '';
      let articleImageUrls: Record<string, string> = {};
      if (publishMode.value === 'feed' && videoAttachment.value && !videoAttachment.value.mediaUrl) {
        uploadingVideo.value = true;
        const video = videoAttachment.value;
        const result = await CoolapkTauriAPI.uploadPublishVideo(new Uint8Array(await video.file.arrayBuffer()), video.file.name, new Uint8Array(await video.cover.arrayBuffer()), video.duration);
        if (!result?.data?.mediaUrl || !result?.data?.mediaInfo) throw new Error(result?.message || '视频上传未返回结果');
        video.mediaUrl = result.data.mediaUrl; video.mediaInfo = result.data.mediaInfo;
        uploadingVideo.value = false;
      }
      if (publishMode.value === 'article') {
        articleImageUrls = {};
        if (articleState.value.cover) articleCoverUrl = await uploadArticleImage(articleState.value.cover);
        for (const block of articleState.value.blocks) {
          if (block.type === 'image') articleImageUrls[block.id] = await uploadArticleImage(block.image);
        }
        requestMessage = buildPublishArticleMessage(articleState.value, { cover: articleCoverUrl || null, images: articleImageUrls });
      } else if (images.value.length > 0) {
        const urls: string[] = [];
        for (const img of images.value) {
          if (img.url) { urls.push(img.url); continue; }
          if (img.file) {
            const bytes = new Uint8Array(await img.file.arrayBuffer());
            const contentType = img.file.type || 'image/jpeg';
            const video = img.liveEnabled && img.liveVideo ? new Uint8Array(await img.liveVideo.arrayBuffer()) : undefined;
            const res = await CoolapkTauriAPI.uploadImage(bytes, img.file.name, contentType, 'feed', undefined, video, img.hdr || 0);
            img.url = resolveUploadedUrl(res?.data);
            urls.push(img.url);
            uploadedCount.value += 1;
          }
        }
        pic = urls.join(',');
        requestMessage = buildFinalMessage();
      } else {
        requestMessage = buildFinalMessage();
      }

      const executeCreate = async (postToken?: string) => {
        if (draftAccount !== String(authStore.user?.uid || 'guest')) throw new Error('账号已切换，已停止发布');
        if (appStore.editFeedTarget) {
          const editOptions: PublishOptions | undefined = publishMode.value === 'article'
            ? { htmlArticle: true, messageTitle: articleState.value.title, messageCover: articleCoverUrl }
            : undefined;
          return await CoolapkTauriAPI.updateFeed(String(appStore.editFeedTarget.id), requestMessage, pic, postToken, editOptions);
        }
        const options: PublishOptions = {
          targetType: publishTarget.value?.type || '',
          targetId: publishTarget.value?.id || '',
          visibleStatus: visibleStatus.value,
          ...(publishMode.value === 'article'
            ? { htmlArticle: true, messageTitle: articleState.value.title, messageCover: articleCoverUrl }
            : { largeCover: largeCover.value && !['3', '4'].includes(productOptions.value.subTypeId || '') }),
          ...productOptions.value,
          ...extraOptions.value,
          includeDeviceModel: includeDeviceModel.value,
          ...(publishMode.value === 'feed' && videoAttachment.value ? { mediaUrl: videoAttachment.value.mediaUrl, mediaInfo: videoAttachment.value.mediaInfo } : {}),
        };
        return await CoolapkTauriAPI.createFeed(requestMessage, pic || undefined, postToken, options);
      };

      let res: any;
      try {
        res = await executeCreate();
      } catch (err: any) {
        const captchaParams = extractCaptchaParamsFromResponse(err);
        if (captchaParams?.captchaId) {
          const token = await verifyWithCaptcha(captchaParams.captchaId);
          res = await executeCreate(token);
        } else if (isRiskControlError(err)) {
          errorMessage.value = `酷安服务端风控拦截（需官方设备认证），${isEditMode.value ? '修改' : '发布'}失败`;
          openShuzilmGuide({
            reason: 'risk_controlled',
            message: '请求被酷安服务端拦截。请到设备信息设置粘贴手机官方酷安复制的设备日志，保存后重试。',
            onConfirmContinue: () => {
              errorMessage.value = '';
              void proceedPublish();
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
          const token = await verifyWithCaptcha(captchaParams.captchaId);
          res = await executeCreate(token);
        } else if (isRiskControlError(res)) {
          errorMessage.value = `酷安服务端风控拦截（需官方设备认证），${isEditMode.value ? '修改' : '发布'}失败`;
          openShuzilmGuide({
            reason: 'risk_controlled',
            message: '请求被酷安服务端拦截。请到设备信息设置粘贴手机官方酷安复制的设备日志，保存后重试。',
            onConfirmContinue: () => {
              errorMessage.value = '';
              void proceedPublish();
            },
          });
          return;
        }
      }

      if (res && res.code === 200) {
        if (appStore.editFeedTarget) {
          const updatedPictures = pic ? pic.split(',') : [];
          if (publishMode.value === 'article') {
            const articleSummary = articleState.value.blocks
              .flatMap((block) => block.type === 'text' && block.text.trim() ? [block.text] : [])
              .join('\n');
            Object.assign(appStore.editFeedTarget, {
              title: articleState.value.title,
              // Feed cards display the API's plain-text summary. Keep the serialized
              // ArticleModel in raw_output for article thumbnails and future editing.
              message: articleSummary,
              messageRawInput: requestMessage,
              message_raw_input: requestMessage,
              messageRawOutput: requestMessage,
              message_raw_output: requestMessage,
              messageTitle: articleState.value.title,
              message_title: articleState.value.title,
              messageCover: articleCoverUrl,
              message_cover: articleCoverUrl,
              isHtmlArticle: 1,
              is_html_article: 1,
              // FeedArticle thumbnails are sourced from ArticleModel.image entries,
              // not the ordinary feed pic array.
              pics: [],
              picArr: [],
              imageUriList: [],
              pic: '',
              isModified: 1,
            });
          } else {
            Object.assign(appStore.editFeedTarget, { message: buildFinalMessage(), messageRawInput: buildFinalMessage(), message_raw_output: buildFinalMessage(), pics: updatedPictures, picArr: updatedPictures, imageUriList: updatedPictures, pic, isModified: 1 });
          }
        } else {
          clearTimeout(draftTimer);
          await deleteFullPublishDraft(draftAccount, draftId.value);
          draftId.value = '';
        }
        message.value = '';
        images.value = []; clearVideo();
        articleState.value = emptyArticle();
        // 给用户明确反馈后延迟关闭
        errorMessage.value = '';
        const successTip = document.createElement('div');
        successTip.className = 'publish-success-tip';
        successTip.textContent = isEditMode.value ? '修改成功！' : '发布成功！';
        document.body.appendChild(successTip);
        setTimeout(() => successTip.remove(), 1500);
        setTimeout(() => {
          appStore.closePublish();
        }, 600);
      } else {
        errorMessage.value = res?.message || `${isEditMode.value ? '修改' : '发布'}动态失败`;
      }
    } catch (err: any) {
      errorMessage.value = typeof err === 'string' ? err : (err?.message || `${isEditMode.value ? '修改' : '发布'}${publishMode.value === 'article' ? '图文' : '动态'}服务异常`);
      // 失败时保持弹窗打开并聚焦输入框，便于用户修改重试
      nextTick(() => messageInput.value?.focus());
    } finally {
      uploadingImages.value = false; uploadingVideo.value = false;
      submitting.value = false;
    }
  };

  // 未设置设备 ID 时先完成设备信息设置，保存后继续发布。
  if (!isEditMode.value && !settingsStore.settings.deviceFingerprint.deviceId?.trim() && !(await hasActiveShuzilmDeviceId())) {
    openShuzilmGuide({ reason: 'missing_id', onConfirmContinue: () => { void proceedPublish(); } });
    return;
  }
  await proceedPublish();
}
</script>

<style scoped>
.publish-device-option { display: inline-flex; align-items: center; gap: 8px; margin-right: auto; padding: 8px 10px; border: 1px solid var(--border-light); border-radius: 20px; background: var(--bg-primary); color: var(--text-secondary); font-size: 12px; cursor: pointer; }
.publish-device-option.is-active { color: var(--brand-primary); }
.publish-device-option:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 3px; }
.publish-device-option:disabled { opacity: .5; cursor: not-allowed; }
.device-switch-track { display: block; width: 28px; height: 16px; border-radius: 9px; background: var(--border); transition: background .15s; }
.device-switch-track::after { content: ''; display: block; width: 12px; height: 12px; margin: 2px; border-radius: 50%; background: white; box-shadow: 0 1px 3px rgb(0 0 0 / 15%); transition: transform .15s; }
.is-active .device-switch-track { background: var(--brand-primary); }
.is-active .device-switch-track::after { transform: translateX(12px); }
.publish-more-grid > .mobile-device-option { display: none; }
.mobile-device-option small { font-size: 10px; color: var(--text-tertiary); }
.mobile-device-option.is-active, .mobile-device-option.is-active small { color: var(--brand-primary); }
@media (max-width: 600px) { .publish-more-grid > .mobile-device-option { display: flex; } }
.publish-visibility { display: flex; gap: 8px; align-items: center; margin-top: 10px; color: var(--text-secondary); font-size: var(--font-size-sub); }
.publish-visibility select { padding: 6px; background: var(--surface); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-control); }

.draft-tools { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; font-size: var(--font-size-caption); color: var(--text-secondary); }
.draft-tools button, .draft-list button { color: var(--brand-primary); }
.draft-list { max-height: 180px; overflow: auto; padding: 8px; border: 1px solid var(--border); margin-bottom: 10px; }
.draft-list > div { display: flex; justify-content: space-between; gap: 10px; margin: 8px 0; }

.publish-container {
  display: flex;
  flex-direction: column;
}

.publish-textarea {
  width: 100%;
  border: none;
  min-height: 140px;
  max-height: 220px;
  overflow-y: auto;
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  color: var(--text-primary);
  background: transparent;
}

.publish-textarea:empty::before {
  content: attr(data-placeholder);
  color: var(--text-tertiary);
}

.publish-textarea :deep(.coolapk-emoji) {
  width: 24px;
  height: 24px;
  object-fit: contain;
  vertical-align: middle;
}

.publish-textarea :deep(.publish-topic) { color: var(--brand-primary); }

.preview-box {
  min-height: 140px;
  max-height: 220px;
  overflow-y: auto;
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  color: var(--text-primary);
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
}

.preview-empty {
  color: var(--text-tertiary);
  font-size: var(--font-size-sub);
}

.publish-article-preview {
  max-height: min(62vh, 640px);
  padding: clamp(16px, 4vw, 28px);
  line-height: 1.75;
}

.publish-article-preview :deep(.article-preview-cover) {
  display: block;
  width: 100%;
  max-height: 360px;
  margin: 0 0 20px;
  border-radius: 10px;
  object-fit: cover;
}

.publish-article-preview :deep(.article-preview-title) {
  margin: 0 0 22px;
  color: var(--text-primary);
  font-size: 1.65em;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.publish-article-preview :deep(.article-preview-markdown) {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.publish-article-preview :deep(.article-preview-heading-1) { font-size: 1.125em; font-weight: 700; }
.publish-article-preview :deep(.article-preview-heading-2),
.publish-article-preview :deep(.article-preview-heading-3) { font-weight: 700; }
.publish-article-preview :deep(.article-preview-markdown a) { color: var(--brand-primary); }
.publish-article-preview :deep(.article-preview-image) {
  display: block;
  max-width: 100%;
  max-height: 520px;
  margin: 18px auto;
  object-fit: contain;
  border-radius: 8px;
}
.publish-article-preview :deep(.article-preview-image-description) {
  margin: -10px 0 18px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  text-align: center;
  white-space: pre-wrap;
}
.publish-article-preview :deep(.article-preview-preserved) {
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text-tertiary);
  font-size: 13px;
}
.publish-article-preview :deep(.article-preview-empty) { color: var(--text-tertiary); }

.publish-media-preview {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
  flex-wrap: wrap;
}

.media-item { width: 90px; display: flex; flex-direction: column; gap: 4px; font-size: var(--font-size-caption); }
.media-controls { display: flex; gap: 6px; color: var(--brand-primary); }
.media-controls button:disabled { opacity: .4; }

.media-thumb {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.media-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-thumb :deep(.app-image-container),
.media-thumb :deep(.app-image-container img) {
  width: 100%;
  height: 100%;
}

.remove-img {
  position: absolute;
  top: 2px;
  right: 2px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 10px;
}

.remove-img:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.upload-tip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  align-self: center;
}

.publish-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-light);
}

.toolbar-tools {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.tool-btn {
  font-size: var(--font-size-sub);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.tool-btn:hover,
.tool-btn.is-active {
  color: var(--brand-primary);
}

.word-count {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.emoji-panel {
  margin-bottom: 8px;
  margin-top: 4px;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm, 10px);
  padding: 0;
  background-color: var(--background);
  animation: panelSlideDown 0.2s cubic-bezier(0.16, 1, 0.3, 1);
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

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
  gap: 4px;
}

.emoji-grid-recent {
  margin-bottom: 2px;
}

.emoji-item {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xs);
  transition: background-color var(--duration-fast) var(--ease-default);
}

.emoji-item:hover {
  background-color: var(--surface-hover);
}

.emoji-item img {
  width: 28px;
  height: 28px;
  object-fit: contain;
}

.topic-panel {
  margin-top: var(--space-3);
  max-height: 150px;
  overflow-y: auto;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-control);
  padding: var(--space-3);
  background-color: var(--background);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.topic-create { display: flex; width: 100%; gap: var(--space-2); }
.topic-create input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--border-light); border-radius: var(--radius-control); background: var(--surface); color: var(--text-primary); outline: none; }
.topic-create input:focus { border-color: var(--brand-primary); }
.topic-create button { flex: 0 0 auto; padding: 8px 12px; border-radius: var(--radius-control); background: var(--brand-primary); color: #fff; cursor: pointer; }
.topic-create button:disabled { opacity: .5; cursor: not-allowed; }
.topic-panel-label { width: 100%; color: var(--text-secondary); font-size: var(--font-size-caption); }

.panel-tip {
  width: 100%;
  text-align: center;
  padding: var(--space-3);
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.topic-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-light);
  background-color: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  max-width: 220px;
}

.topic-item:hover {
  background-color: var(--brand-soft);
  border-color: var(--brand-primary);
  color: var(--brand-primary);
}

.topic-hash {
  font-size: 12px;
  color: var(--brand-primary);
}

.topic-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 550;
}

.error-tip {
  margin-top: var(--space-3);
  color: var(--danger);
  font-size: var(--font-size-caption);
}
</style>

<style>
.publish-success-tip {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--brand-primary, #10b981);
  color: #fff;
  padding: 10px 22px;
  border-radius: var(--radius-pill, 9999px);
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
  z-index: 9999;
  animation: successTipIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes successTipIn {
  from {
    opacity: 0;
    transform: translate(-50%, -12px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
</style>

<style scoped>
.publish-back {
  width: 34px;
  height: 34px;
  color: var(--text-primary);
  border-radius: var(--radius-sm, 8px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s ease;
}
.publish-back:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--brand-primary);
  transform: scale(1.05);
}
.publish-title { flex: 1; font-size: 16px; font-weight: 600; margin: 0 12px; }
.header-mode-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  background: var(--surface-hover, rgba(0, 0, 0, 0.04));
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.05));
  border-radius: 999px;
  gap: 2px;
  margin: 0 auto;
}
.header-mode-switch button {
  position: relative;
  z-index: 1;
  min-width: 68px;
  padding: 5px 16px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.15s ease;
}
.header-mode-switch button:hover:not(:disabled) {
  color: var(--text-primary);
}
.header-mode-switch button.is-selected {
  background: var(--surface, #ffffff);
  color: var(--brand-primary, #10b981);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.header-mode-switch button:active:not(:disabled) {
  transform: scale(0.96);
}
.header-drafts {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 5px 10px;
  border-radius: 999px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
}
.header-drafts:hover:not(:disabled) {
  color: var(--brand-primary);
  background: var(--brand-soft, rgba(16, 185, 129, 0.08));
  transform: translateY(-1px);
}
.header-drafts:active:not(:disabled) {
  transform: scale(0.96);
}
.mobile-publish { display: none; }
.publish-settings { margin-top: 8px; }
.publish-visibility { margin: 0; font-size: 14px; color: var(--text-primary); }
.draft-list { border: 0; max-height: none; padding: 0; }
.draft-card { display: flex; align-items: center; border-bottom: 1px solid var(--border-light); padding: 14px 0; }
.draft-open { flex: 1; min-width: 0; text-align: left; display: grid; gap: 8px; }
.draft-title { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.draft-meta { color: var(--text-tertiary); font-size: 12px; }
.draft-delete { color: var(--text-tertiary); padding: 12px; transition: color 0.18s ease; }
.draft-delete:hover:not(:disabled) { color: var(--danger); }
.media-thumb { width: 100%; height: auto; aspect-ratio: 1; }
.media-item { width: 110px; }
@media (max-width: 600px) {
  .mobile-publish { display: inline-flex; margin-left: 14px; }
  .publish-textarea { min-height: 240px; max-height: none; font-size: 16px; }
  .publish-media-preview { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .media-item { width: 100%; }
  .toolbar-tools { flex: 1; justify-content: space-around; gap: 0; flex-wrap: nowrap; }
  .tool-btn { font-size: 0; width: 40px; height: 44px; justify-content: center; }
  .tool-btn i { font-size: 22px; }
  .word-count { font-size: 10px; }
  .publish-toolbar { margin-top: 16px; padding-top: 0; }
}
</style>

<style scoped>
.publish-container { flex: 1 1 0; min-height: 0; min-width: 0; }
/* fieldset 保留原生禁用行为，内部独立分配正文与底部栏的高度，避免被媒体撑开。 */
.publish-fields { display: block; flex: 1 1 0; height: 100%; min-height: 0; min-width: 0; border: 0; padding: 0; margin: 0; }
.publish-fields-layout { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
.publish-compose-scroll { flex: 1 1 0; min-height: 0; overflow-y: auto; }
.word-count.is-over-limit { color: var(--danger); font-weight: 600; }
.publish-target-area { margin-bottom: 10px; }
.publish-bottom-area { flex-shrink: 0; padding-top: 6px; }
.publish-toolbar {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.mobile-tool, .mobile-preview { display: none; }
.toolbar-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}
.tool-btn {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm, 8px);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
              color 0.18s ease,
              background-color 0.18s ease,
              box-shadow 0.18s ease;
}
.tool-btn:hover:not(:disabled) {
  color: var(--brand-primary);
  background-color: var(--brand-soft, rgba(16, 185, 129, 0.1));
  transform: translateY(-2px) scale(1.08);
  box-shadow: 0 3px 8px rgba(16, 185, 129, 0.16);
}
.tool-btn:active:not(:disabled) {
  transform: scale(0.92);
  transition-duration: 0.08s;
}
.tool-btn.is-active {
  color: var(--brand-primary);
  background-color: var(--brand-soft, rgba(16, 185, 129, 0.12));
  box-shadow: 0 0 0 1px var(--brand-primary);
}
.tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none !important;
}
.tool-btn span:not(.publish-icon) { display: none; }
.publish-visibility {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 13px;
  border: 1px solid var(--border-light);
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.publish-visibility:hover {
  color: var(--brand-primary);
  border-color: var(--brand-primary);
  background: var(--brand-soft, rgba(16, 185, 129, 0.08));
  transform: translateY(-1px);
}
.publish-visibility:active {
  transform: scale(0.96);
}
.visibility-arrow {
  font-size: 10px;
  color: var(--text-tertiary);
  transition: transform 0.2s ease, color 0.2s ease;
}
.publish-visibility:hover .visibility-arrow {
  color: var(--brand-primary);
}
.publish-target-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border-bottom: 1px solid var(--border-light);
  padding: 0 4px;
}
.publish-target-header :deep(.target-picker) {
  flex: 1;
  min-width: 0;
}
.publish-target-header :deep(.publish-setting-row) {
  border-bottom: none !important;
}
.publish-target-header .publish-visibility {
  flex-shrink: 0;
  margin-right: 2px;
}
.footer-actions {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.publish-settings:has(.publish-extras) { margin-top: 6px; }
.publish-more-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, 74px);
  justify-content: space-around;
  gap: 16px;
  padding: 14px 16px;
  margin-top: 8px;
  max-height: min(180px, 25dvh);
  overflow-y: auto;
  background: var(--background);
  border-radius: var(--radius-sm, 10px);
  border: 1px solid var(--border-light);
  animation: panelSlideDown 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes panelSlideDown {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.publish-more-grid > button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-secondary);
  border: none;
  background: transparent;
  cursor: pointer;
}
.publish-more-grid > button:disabled { cursor: not-allowed; opacity: .45; }
.publish-more-hint { grid-column: 1 / -1; margin: 0; text-align: center; color: var(--text-tertiary); font-size: 12px; }
.more-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  background: var(--surface);
  border-radius: 16px;
  font-size: 26px;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.more-icon .publish-icon { width: 30px; height: 30px; }
.publish-more-grid > button:hover .more-icon {
  color: var(--brand-primary);
  background: var(--brand-soft);
  transform: translateY(-2px) scale(1.06);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.16);
}
.publish-more-grid > button:active .more-icon {
  transform: scale(0.94);
}
.publish-media-area { position: relative; width: 100%; margin-top: 8px; }
.publish-cover-mode { position: relative; display: grid; grid-template-columns: 72px 72px; width: 152px; height: 34px; padding: 2px; margin: 0 auto 8px; border: 1px solid var(--border-light); border-radius: 999px; background: var(--background); }
.publish-cover-mode-indicator { position: absolute; top: 2px; left: 2px; width: 72px; height: 28px; border-radius: 999px; background: var(--brand-soft, rgba(16, 185, 129, .12)); box-shadow: 0 1px 3px rgb(0 0 0 / 16%); transition: transform 180ms ease; }
.publish-cover-mode-indicator.is-large-cover { transform: translateX(76px); }
.publish-cover-mode > button { position: relative; z-index: 1; width: 72px; height: 28px; border-radius: 999px; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: color 120ms ease; }
.publish-cover-mode > button.is-selected { color: var(--brand-primary); font-weight: 600; }
.publish-cover-mode > button:disabled { cursor: not-allowed; }
.publish-media-preview { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; width: 100%; }
.publish-media-preview.large-cover-mode { display: flex; flex-wrap: nowrap; align-items: flex-start; max-width: 100%; overflow-x: auto; overflow-y: hidden; padding: 4px 2px 10px; scroll-snap-type: x proximity; }
.publish-media-preview.large-cover-mode > .media-item { flex: 0 0 clamp(148px, 34vw, 220px); width: clamp(148px, 34vw, 220px); scroll-snap-align: start; }
.media-item { width: 100%; min-width: 0; cursor: grab; }
.media-item:active { cursor: grabbing; }
.publish-image-move { transition: transform 130ms ease-out; }
.media-item.is-dragging { position: relative; z-index: 1; opacity: .82; outline: 2px solid var(--brand-primary); border-radius: 8px; }
.media-item.is-dragging .media-thumb { transform: scale(.96); box-shadow: 0 8px 20px rgb(0 0 0 / 18%); }
.media-thumb { width: 100%; aspect-ratio: 1; overflow: hidden; border-radius: 8px; }
.media-thumb { touch-action: none; user-select: none; transition: transform 120ms ease, box-shadow 120ms ease; }
.media-thumb :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.live-photo-mode { display: block; margin-top: 4px; }
.live-photo-mode select { max-width: 100%; border: 0; background: transparent; color: var(--brand-primary); font-size: 12px; }
.live-photo-missing { display: block; font-size: 11px; color: var(--text-tertiary); }
.publish-image-limit-tip { display: flex; align-items: center; gap: 5px; margin: 4px 16px 8px; color: var(--danger); font-size: var(--font-size-caption); }
.publish-video-preview { position: relative; max-width: 420px; margin-top: 16px; }
.publish-video-preview video { display: block; width: 100%; max-height: 280px; border-radius: 8px; background: #111; }
.publish-video-preview > button { position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; color: white; background: rgb(0 0 0 / 55%); border-radius: 50%; }
.publish-video-preview p { margin-top: 8px; color: var(--text-tertiary); font-size: 12px; }
@media (max-width: 600px) {
  .publish-title { font-size: 18px; font-weight: 500; color: var(--text-primary); }
  .publish-back { width: 38px; height: 38px; }
  .header-mode-switch {
    padding: 2px;
    gap: 1px;
    margin: 0 auto;
  }
  .header-mode-switch button {
    min-width: 52px;
    padding: 4px 10px;
    font-size: 12px;
  }
  .header-drafts { display: none; }
  .mobile-preview { display: block; min-width: 56px; height: 32px; color: var(--brand-primary); font-size: 14px; }
  .mobile-publish {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 56px;
    height: 32px;
    margin: 0 4px 0 0;
    padding: 0 10px;
    background: transparent;
    color: var(--brand-primary);
    box-shadow: none;
    font-size: 14px;
    font-weight: 600;
  }
  .mobile-publish:disabled { background: transparent; color: var(--text-tertiary); opacity: 1; }
  .publish-target-area { margin-bottom: 0; }
  .publish-target-header {
    gap: 8px;
    padding: 0 16px;
    height: 46px;
    border-bottom: 0.5px solid var(--border-light);
  }
  .publish-target-header :deep(.publish-setting-row) {
    height: 46px;
    min-height: 46px;
    padding-left: 0;
    padding-right: 0;
  }
  .publish-target-header :deep(.setting-value:not(.selected)) {
    display: none;
  }
  .publish-target-header .publish-visibility {
    padding: 4px 10px;
    font-size: 12px;
  }
  .publish-textarea { padding: 14px 16px; min-height: 160px; max-height: none; font-size: 15px; }
  .publish-media-area { margin: 0 16px; width: calc(100% - 32px); }
  .publish-media-preview { width: 100%; }
  .publish-video-preview { margin: 0 16px; }
  .publish-settings { margin: 0 16px; }
  .publish-bottom-area { padding: 0; border-top: 0.5px solid var(--border-light); }
  .publish-bottom-area :deep(.recommendations) { padding: 0 16px; margin: 4px 0; }
  .publish-toolbar { padding: 0; margin: 0; }
  .toolbar-tools { gap: 0; width: 100%; }
  .tool-btn { flex: 1; min-width: 0; width: auto; height: 40px; }
  .tool-btn span:not(.publish-icon), .desktop-preview, .word-count { display: none; }
  .article-preview-toggle { display: flex; }
  .publish-toolbar { gap: 0; }
  .publish-visibility { margin: 0; }
  .mobile-tool { display: flex; }
  .emoji-panel { margin: 0; border: 0; border-radius: 0; }
}
</style>
