<template>
  <div
    ref="previewRef"
    class="live-photo-preview"
    :class="{
      'is-live-photo': item.isLivePhoto,
      'is-gif': isGif,
      'is-playing': isPlaying,
      'is-single': isSingle,
      'is-long': isLong,
    }"
    :aria-label="item.isLivePhoto ? 'Live Photo，悬浮播放' : isGif ? 'GIF 动图，悬浮播放' : '图片'"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <AppImage
      :src="staticCoverUrl"
      alt="动态图片"
      image-class="grid-img"
      @load="forwardLoad"
    />

    <AppImage
      v-if="isGif && gifMounted"
      :src="item.sourceUrl"
      alt="GIF 动图预览"
      image-class="grid-img gif-preview-image"
      :hide-spinner="true"
      :style="{ opacity: isPlaying ? 1 : 0 }"
      @load="handleGifLoad"
      @error="handleGifError"
    />

    <video
      v-if="item.isLivePhoto && resolvedVideoUrl && videoMounted"
      ref="videoRef"
      class="live-photo-video"
      :src="resolvedVideoUrl"
      :poster="staticCoverUrl"
      muted
      loop
      playsinline
      preload="none"
      :aria-hidden="!isPlaying"
      :style="{ opacity: isPlaying ? 1 : 0 }"
      @canplay="handleCanPlay"
      @playing="isPlaying = true"
      @pause="isPlaying = false"
      @error="handleVideoError"
    ></video>

    <span
      v-if="item.isLivePhoto || isGif"
      class="live-badge"
      :class="{ 'gif-badge': isGif }"
      role="button"
      :aria-label="isGif ? (isPlaying ? '暂停动图' : '播放动图') : (isPlaying ? '暂停实况' : '播放实况')"
      :title="isGif ? 'GIF 动图' : 'Live Photo 实况'"
      @click="handlePreviewTap"
    >
      {{ isGif ? 'GIF' : 'Live' }}
    </span>

    <span v-if="resolving && !isGif" class="live-photo-loading" aria-live="polite">
      <i class="fas fa-circle-notch fa-spin"></i>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, onDeactivated, onUnmounted, ref, watch } from 'vue';
import AppImage from '../common/AppImage.vue';
import { getHdImageUrl, getStaticAnimatedImageUrl, isAnimatedImageUrl } from '../../utils/image';
import { normalizeResourceUrl } from '../../utils/resourceCache';
import { isCoarsePointer } from '../../utils/platform';
import { observeResourceVisibility } from '../../utils/resourceVisibility';
import { logLiveVideoState } from '../../utils/liveVideoCodec';
import {
  resolveLivePhotoVideo,
  type FeedImageItem,
  type LivePhotoContextType,
} from '../../utils/livePhoto';

const props = withDefaults(defineProps<{
  item: FeedImageItem;
  contentId?: string | number;
  contentType?: LivePhotoContextType;
  isSingle?: boolean;
  isLong?: boolean;
  autoPlayGif?: boolean;
  gifAutoPlay?: boolean;
}>(), {
  contentType: 'feed',
  isSingle: false,
  isLong: false,
  autoPlayGif: true,
  gifAutoPlay: false,
});

const emit = defineEmits<{
  (event: 'load', payload: Event): void;
}>();

const videoRef = ref<HTMLVideoElement | null>(null);
const previewRef = ref<HTMLElement | null>(null);
let stopObserving = () => {};
let previewVisible = false;
let previewActive = true;
let autoGifPaused = false;
function observePreview() {
  stopObserving();
  if (!previewRef.value) return;
  stopObserving = observeResourceVisibility(previewRef.value, visible => {
    previewVisible = visible;
    if (!visible) stopPreview();
    else resumeSingleGif();
  });
}
// 列表默认只挂载静态封面；视频地址在首次悬浮时才交给 <video>。
const resolvedVideoUrl = ref('');
// 只有"打算播放"期间才把 <video> 放进 DOM：暂停后浏览器就没有任何视频画面可画，
// 静态封面必定回到这一项自己的图，不会残留上一帧或被 iOS 的视频合成层盖住。
const videoMounted = ref(false);
const resolving = ref(false);
const isPlaying = ref(false);
const videoError = ref(false);
const videoSource = ref<'metadata' | 'resolver' | 'none'>('none');
const fallbackAttempted = ref(false);
const isHovered = ref(false);
const gifMounted = ref(false);
const isGif = computed(() => !props.item.isLivePhoto && isAnimatedImageUrl(props.item.sourceUrl));
let resolveSequence = 0;

const staticCoverUrl = computed(() => {
  if (isGif.value) return getStaticAnimatedImageUrl(props.item.sourceUrl);
  const url = props.item.coverUrl || props.item.sourceUrl;
  return props.item.isLivePhoto ? normalizeResourceUrl(url) : getHdImageUrl(url);
});

function forwardLoad(event: Event) {
  emit('load', event);
}

async function playPreview() {
  if (!isHovered.value || !videoRef.value || videoError.value) return;
  const video = videoRef.value;
  videoRef.value.muted = true;
  videoRef.value.loop = true;
  try {
    await videoRef.value.play();
  } catch (error) {
    if (!isHovered.value || video !== videoRef.value) return;
    logLiveVideoState('preview_play_failed', video, error);
    // 浏览器自动播放策略拒绝时保留高清静态封面，不打断图片浏览。
    isPlaying.value = false;
  }
}

function handleCanPlay() {
  void playPreview();
}

async function handleMouseEnter() {
  // 触摸端使用角标显式播放，避免兼容 mouseenter 导致点按时重复切换。
  if (isCoarsePointer() || (isGif.value && !props.autoPlayGif)) return;
  await startPreview();
}

async function startPreview() {
  if (isGif.value) {
    if (gifMounted.value) return;
    autoGifPaused = false;
    isHovered.value = true;
    resolving.value = true;
    gifMounted.value = true;
    return;
  }
  if (!props.item.isLivePhoto) return;
  isHovered.value = true;
  videoError.value = false;
  videoMounted.value = true;

  if (!resolvedVideoUrl.value) {
    const sequence = ++resolveSequence;
    if (props.item.liveVideoUrl) {
      resolvedVideoUrl.value = props.item.liveVideoUrl;
      videoSource.value = 'metadata';
    } else {
      resolving.value = true;
      try {
        const url = await resolveLivePhotoVideo(props.item, props.contentId, props.contentType);
        if (sequence !== resolveSequence || !isHovered.value || !url) return;
        resolvedVideoUrl.value = url;
        videoSource.value = 'resolver';
      } catch (error) {
        if (sequence === resolveSequence) {
          videoError.value = true;
          console.warn('Live Photo 预览加载失败：', error);
        }
      } finally {
        if (sequence === resolveSequence) resolving.value = false;
      }
    }
    await nextTick();
  }

  await nextTick();
  await playPreview();
}

async function retryThroughResolver() {
  if (
    !isHovered.value
    || !props.item.isLivePhoto
    || fallbackAttempted.value
    || !props.item.sourceUrl
  ) return;

  fallbackAttempted.value = true;
  videoError.value = false;
  isPlaying.value = false;
  videoSource.value = 'none';
  resolvedVideoUrl.value = '';
  const sequence = ++resolveSequence;
  resolving.value = true;
  try {
    const url = await resolveLivePhotoVideo(
      props.item,
      props.contentId,
      props.contentType,
      { force: true },
    );
    if (sequence !== resolveSequence || !isHovered.value || !url) return;
    resolvedVideoUrl.value = url;
    videoSource.value = 'resolver';
    await nextTick();
    await playPreview();
  } catch (error) {
    if (sequence === resolveSequence) {
      videoError.value = true;
      console.warn('Live Photo 预览重新解析失败：', error);
    }
  } finally {
    if (sequence === resolveSequence) resolving.value = false;
  }
}

/**
 * 触摸端没有 hover，点击 Live 角标就地播放 / 暂停。
 * 桌面端保持原行为：不拦截点击，让它冒泡到宫格打开查看器。
 */
function handlePreviewTap(event: MouseEvent) {
  if ((!props.item.isLivePhoto && !isGif.value) || !isCoarsePointer()) return;
  event.preventDefault();
  event.stopPropagation();
  if (isHovered.value) {
    autoGifPaused = true;
    stopPreview();
    return;
  }
  void startPreview();
}

function handleGifLoad() {
  if (!gifMounted.value || !isHovered.value) return;
  resolving.value = false;
  isPlaying.value = true;
}

function handleGifError() {
  autoGifPaused = true;
  stopPreview();
}

function handleMouseLeave() {
  if (isGif.value && props.gifAutoPlay) return;
  stopPreview();
}

function resumeSingleGif() {
  if (isGif.value && props.gifAutoPlay && previewVisible && previewActive
    && !autoGifPaused && document.visibilityState !== 'hidden') void startPreview();
}

function stopPreview() {
  isHovered.value = false;
  resolveSequence += 1;
  resolving.value = false;
  gifMounted.value = false;
  const video = videoRef.value;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    try {
      video.currentTime = 0;
    } catch {
      // 视频还没有可 seek 的元数据时无需处理。
    }
  }
  isPlaying.value = false;
  // 暂停与移出后立刻卸载视频节点：暂停态下视频不应再参与渲染。
  videoMounted.value = false;
}

function handleVideoError(event: Event) {
  // 切换地址时旧 video 节点可能晚到一步派发 error，不能覆盖新解析结果。
  const video = videoRef.value;
  if (!video || event.target !== video) return;
  logLiveVideoState('preview_media_failed', video);
  videoError.value = true;
  isPlaying.value = false;
  // imageUriList 里的直链失效时，重新走一次 APK 的 showVideo 解析。
  if (videoSource.value === 'metadata') {
    void retryThroughResolver();
  }
}

watch(() => props.item.key, () => {
  stopPreview();
  autoGifPaused = false;
  resolvedVideoUrl.value = '';
  videoError.value = false;
  videoSource.value = 'none';
  fallbackAttempted.value = false;
  resumeSingleGif();
});

onUnmounted(() => {
  stopObserving();
  previewActive = false;
  stopPreview();
});
onDeactivated(() => {
  stopObserving();
  previewActive = false;
  stopPreview();
});
onMounted(observePreview);
onActivated(() => {
  previewActive = true;
  observePreview();
});
function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') stopPreview();
  else resumeSingleGif();
}
onMounted(() => document.addEventListener('visibilitychange', handleVisibilityChange));
onUnmounted(() => document.removeEventListener('visibilitychange', handleVisibilityChange));
watch(() => props.autoPlayGif, enabled => {
  if (!enabled && isGif.value) stopPreview();
});
watch(() => props.gifAutoPlay, enabled => {
  if (enabled) resumeSingleGif();
  else if (isGif.value) stopPreview();
});
</script>

<style scoped>
.live-photo-preview {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  background: var(--background-secondary, #f0f0f0);
}

.live-photo-preview.is-single {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  display: block;
}

.live-photo-preview :deep(.app-image-container) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  overflow: hidden;
}

.live-photo-preview.is-single :deep(.app-image-container) {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
}

.live-photo-preview :deep(.gif-preview-image) {
  position: absolute !important;
  inset: 0;
}

.live-photo-preview :deep(.grid-img img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}

.live-photo-preview.is-single :deep(.grid-img img) {
  width: 100%;
  height: auto;
  max-height: 520px;
  object-fit: contain;
  border-radius: 12px;
}

.live-photo-preview.is-single.is-long :deep(.grid-img img) {
  height: 420px;
  object-fit: cover;
  object-position: top center;
}

.live-photo-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  background: transparent;
  transition: opacity 0.16s ease;
  pointer-events: none;
}

.live-photo-preview.is-single .live-photo-video {
  object-fit: contain;
}

.live-photo-preview.is-single.is-long .live-photo-video {
  object-fit: cover;
  object-position: top center;
}

.live-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 2;
  display: inline-block;
  padding: 3px 8px 3px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.78);
  color: #222222;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-family-base);
  line-height: 1.2;
  /* 触摸端要能点这个角标就地播放，桌面端点击继续冒泡到宫格打开查看器。 */
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 角标本体只有约 34x22，向单元格内部（上、左）扩大触摸命中区。 */
@media (pointer: coarse) {
  .live-badge::after {
    content: '';
    position: absolute;
    inset: -12px -4px -4px -12px;
  }
}

.live-photo-preview.is-playing .live-badge {
  background: rgba(16, 185, 129, 0.9);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(16, 185, 129, 0.45);
}

.live-photo-loading {
  position: absolute;
  left: 6px;
  bottom: 6px;
  z-index: 2;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
  font-size: 10px;
  pointer-events: none;
}

@keyframes live-ring-pulse {
  0% {
    opacity: 0.85;
    transform: translate(-50%, -50%) scale(0.6);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.85);
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-badge-rings::before,
  .live-badge-rings::after,
  .live-badge-rings span {
    animation: none;
  }

  .live-photo-video {
    transition: none;
  }
}
</style>
