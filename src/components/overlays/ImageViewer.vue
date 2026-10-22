<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="viewerData && !noImageMode" class="image-viewer-backdrop" :class="{ 'no-image-detail-enabled': detailImagesEnabled }" @click="handleBackdropClick">
        <!-- 顶部工具栏 -->
        <div class="viewer-topbar">
          <div class="topbar-left">
            <span class="counter-text">{{ currentIndex + 1 }} / {{ totalCount }}</span>
            <button
              v-if="currentItem?.isLivePhoto"
              type="button"
              class="topbar-live-badge"
              :class="{ 'is-playing': liveVideoPlaying }"
              :title="liveVideoPlaying ? '点击暂停实况' : '点击播放实况'"
              @click.stop="toggleLivePlayback"
            >
              <span>Live</span>
              <span v-if="liveResolving" class="viewer-live-loading"><i class="fas fa-circle-notch fa-spin"></i></span>
            </button>
          </div>
          <div class="topbar-actions">
            <button class="viewer-btn" title="缩小" @click="zoomOut"><i class="fas fa-search-minus"></i></button>
            <span class="zoom-text">{{ Math.round(scale * 100) }}%</span>
            <button class="viewer-btn" title="放大" @click="zoomIn"><i class="fas fa-search-plus"></i></button>
            <button class="viewer-btn" title="向左旋转 90°" @click="rotateLeft"><i class="fas fa-undo"></i></button>
            <button class="viewer-btn" title="向右旋转 90°" @click="rotateRight"><i class="fas fa-redo"></i></button>
            <button class="viewer-btn" title="重置" @click="resetTransform"><i class="fas fa-compress-arrows-alt"></i></button>
            <button class="viewer-btn" title="复制链接" @click="copyLink"><i class="fas fa-link"></i></button>
            <button
              class="viewer-btn"
              :disabled="savingOriginal"
              :title="savingOriginal ? '正在保存原图' : '保存原图'"
              @click.stop="saveOriginal"
            >
              <i :class="savingOriginal ? 'fas fa-circle-notch fa-spin' : 'fas fa-download'"></i>
            </button>
            <button class="viewer-btn" :title="showShortcutHints ? '关闭 (Esc)' : '关闭'" @click="close"><i class="fas fa-times"></i></button>
          </div>
        </div>

        <!-- 左右导航 -->
        <button v-if="currentIndex > 0" class="nav-arrow nav-prev" @click="slideTo(-1)">
          <i class="fas fa-chevron-left"></i>
        </button>

        <button v-if="currentIndex < totalCount - 1" class="nav-arrow nav-next" @click="slideTo(1)">
          <i class="fas fa-chevron-right"></i>
        </button>

        <!-- 主图片显示区 -->
        <div
          ref="stageRef"
          class="image-stage"
          @dblclick="handleDoubleClick"
          @mousedown="startDrag"
          @mousemove="onDrag"
          @mouseup="stopDrag"
          @mouseleave="stopDrag"
          @touchstart="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="onTouchEnd"
          @touchcancel="onTouchCancel"
          @wheel.prevent="handleWheel"
        >
          <img
            v-if="displaySrc"
            ref="imageRef"
            :src="displaySrc"
            :data-original-url="originalUrl || undefined"
            :data-resource-url="currentUrl || undefined"
            alt="Viewer Image"
            class="viewer-img"
            :style="mediaTransformStyle"
            :class="{ 'is-touch-dragging': touchDragging || mediaTransition === 'none', 'is-sliding': mediaTransition === 'smooth' }"
            @dragstart.prevent
            @load="measureImage"
          />
          <video
            v-if="currentItem?.isLivePhoto && liveVideoUrl"
            ref="liveVideoRef"
            :key="liveVideoUrl"
            class="viewer-live-video"
            :src="liveVideoUrl"
            :poster="displaySrc || undefined"
            :muted="!liveSoundEnabled"
            loop
            playsinline
            preload="auto"
            :style="{ ...mediaTransformStyle, opacity: liveVideoPlaying ? 1 : 0 }"
            aria-label="Live Photo 实况视频"
            @canplay="handleLiveCanPlay"
            @pause="liveVideoPlaying = false"
            @error="handleLiveVideoError"
          ></video>
          <div v-if="!displaySrc" class="viewer-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <span>正在载入高清大图...</span>
          </div>
          <!-- 切图过渡：旧画面留在这层继续滑出，避免换图瞬间变成硬切。 -->
          <img
            v-if="slideGhost"
            :src="slideGhost.src"
            class="viewer-ghost"
            :class="{ 'is-sliding': mediaTransition === 'smooth' }"
            :style="ghostTransformStyle"
            alt=""
            aria-hidden="true"
            @dragstart.prevent
          />
        </div>

        <!-- 底部一体化灵动毛玻璃控制岛 -->
        <div v-if="currentItem?.isLivePhoto || showOriginalControl" class="viewer-bottombar" @click.stop>
          <div class="viewer-control-island">
            <template v-if="currentItem?.isLivePhoto">
              <button
                type="button"
                class="island-btn live-play-btn"
                :class="{ 'is-active': liveVideoPlaying }"
                :disabled="!liveVideoUrl || liveResolving"
                :title="liveVideoUnsupported ? `当前系统不支持 ${liveVideoUnsupported.name}` : (liveVideoError ? '重新解析并播放实况' : (liveVideoPlaying ? '暂停实况' : '播放实况'))"
                @click.stop="toggleLivePlayback"
              >
                <i :class="liveVideoPlaying ? 'fas fa-pause' : (liveVideoUnsupported ? 'fas fa-ban' : 'fas fa-play')"></i>
                <span>{{ liveResolving ? '加载中' : (liveVideoUnsupported ? '不支持' : (liveVideoError ? '重试' : (liveVideoPlaying ? '实况' : '播放'))) }}</span>
              </button>

              <button
                type="button"
                class="island-btn live-sound-btn"
                :class="{ 'is-active': liveSoundEnabled }"
                :disabled="!liveVideoUrl || liveResolving"
                :title="liveSoundEnabled ? '关闭声音' : '开启原声'"
                @click.stop="toggleLiveSound"
              >
                <i :class="liveSoundEnabled ? 'fas fa-volume-high' : 'fas fa-volume-xmark'"></i>
                <span>{{ liveSoundEnabled ? '原声' : '静音' }}</span>
              </button>

              <div v-if="showOriginalControl" class="island-divider"></div>
            </template>

            <button
              v-if="showOriginalControl"
              class="island-btn raw-image-btn"
              :class="{ 'is-loading': isCurrentOriginalLoading }"
              :disabled="isCurrentOriginalLoading"
              @click.stop="loadOriginal"
            >
              <i :class="[
                isCurrentOriginalLoading ? 'fas fa-circle-notch fa-spin' : 'fas fa-file-image'
              ]"></i>
              <span>
                {{ isCurrentOriginalLoading ? '正在加载原图...' : '查看原图' }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '../../stores/app';
import { useShortcutHints } from '../../composables/useShortcutHints';
import { useSettingsStore } from '../../stores/settings';
import { useNoImageMode, provideDetailImageScope } from '../../composables/useNoImageMode';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { getHdImageUrl, getOriginalImageUrl } from '../../utils/image';
import { getMemoryCachedResourceSync, loadImageResource, normalizeResourceUrl } from '../../utils/resourceCache';
import { useResourceUrlLifetime } from '../../composables/useResourceUrlLifetime';
import { getErrorMessage } from '../../utils/errors';
import { showToast } from '../../utils/toast';
import { showLivePhotoCodecPrompt } from '../../utils/livePhotoCodecPrompt';
import { useAndroidBackButton } from '../../utils/androidBackButton';
import { isTouchMobilePlatform } from '../../utils/platform';
import { normalizeFeedImageItems, resolveLivePhotoVideo, type FeedImageItem } from '../../utils/livePhoto';
import { detectLiveVideoCodec, getLiveVideoCodecSupport, waitForDecodedVideoFrame, logLiveVideoState, type LiveVideoCodec } from '../../utils/liveVideoCodec';

const appStore = useAppStore();
const showShortcutHints = useShortcutHints();
const settingsStore = useSettingsStore();
const viewerData = computed(() => appStore.activeImageViewer);
const viewerDetailScope = computed(() => Boolean(viewerData.value?.fromDetail));
const detailImagesEnabled = provideDetailImageScope(viewerDetailScope);
const noImageMode = useNoImageMode(viewerDetailScope);
const currentIndex = ref(0);
const scale = ref(1);
const rotation = ref(0);
const translateX = ref(0);
const translateY = ref(0);
const isDragging = ref(false);
// 触摸横滑时的实时位移（仅缩放比例为 1 时使用），松手后归零。
const swipeOffsetX = ref(0);
// 触摸下滑关闭时的实时位移，松手后归零。
const swipeOffsetY = ref(0);
// 触摸滑动期间关闭 transform 过渡，避免跟手位移被 50ms 补间拖出黏滞感。
const touchDragging = ref(false);
const savingOriginal = ref(false);

const stageRef = ref<HTMLElement | null>(null);
const imageRef = ref<HTMLImageElement | null>(null);
interface ImageSize { width: number; height: number }
const imageSize = ref<ImageSize | null>(null);
const viewportSize = ref({ width: window.innerWidth, height: window.innerHeight });
/**
 * 切图过渡状态：
 * 'none' = 初始摆放（关闭过渡），'smooth' = 正在缓动，null = 默认 50ms 跟手过渡。
 */
const mediaTransition = ref<'none' | 'smooth' | null>(null);
/** 程序化切图位移；手指跟手的位移仍然走 swipeOffsetX。 */
const slideOffsetX = ref(0);

interface SlideGhost {
  src: string;
  offsetX: number;
  scale: number;
  rotation: number;
  imageSize: ImageSize | null;
}

/** 正在滑出的旧画面，与 SLIDE_DURATION_MS / CSS 里的过渡时长一起决定滑出动画。 */
const slideGhost = ref<SlideGhost | null>(null);
const SLIDE_DURATION_MS = 280;
let transitionTimer: ReturnType<typeof setTimeout> | null = null;

const displaySrc = ref<string>('');
useResourceUrlLifetime(displaySrc);
useResourceUrlLifetime(computed(() => slideGhost.value?.src));
let resolveSequence = 0;

const liveVideoRef = ref<HTMLVideoElement | null>(null);
const liveVideoUrl = ref('');
const liveResolving = ref(false);
const liveVideoPlaying = ref(false);
const liveSoundEnabled = ref(false);
const liveVideoError = ref(false);
const liveVideoUnsupported = ref<LiveVideoCodec | null>(null);
const liveVideoSource = ref<'metadata' | 'resolver' | 'none'>('none');
const liveVideoFallbackAttempted = ref(false);
let liveResolveSequence = 0;
let livePlaybackSequence = 0;
let liveUnsupportedNoticeUrl = '';
const liveVideoCodecChecks = new Map<string, Promise<{ codec: LiveVideoCodec | null; unsupported: boolean }>>();

const originalLoadedMap = ref<Record<number, boolean>>({});
const originalLoadingMap = ref<Record<number, boolean>>({});

let startX = 0;
let startY = 0;

const imageItems = computed(() => normalizeFeedImageItems(viewerData.value?.urls || []));
const currentItem = computed(() => imageItems.value[currentIndex.value] || null);
const totalCount = computed(() => imageItems.value.length);
const rawUrl = computed(() => currentItem.value?.sourceUrl || '');
/** 让浏览器按实际尺寸重绘，避免 transform 放大合成图层时出现分块接缝。 */
function scaledImageSize(size: ImageSize | null, zoom: number) {
  if (!size) return {};
  const fit = Math.min(1, viewportSize.value.width * 0.9 / size.width, viewportSize.value.height * 0.88 / size.height);
  const width = size.width * fit * zoom;
  const height = size.height * fit * zoom;
  return {
    width: `${width}px`,
    height: `${height}px`,
    maxWidth: 'none',
    maxHeight: 'none',
    // 放大到超过舞台时，图片、实况视频和旧图层都保持相同的中心。
    position: 'absolute' as const,
    inset: 'auto',
    margin: '0',
    left: `calc(50% - ${width / 2}px)`,
    top: `calc(50% - ${height / 2}px)`,
  };
}

function measureImage() {
  const image = imageRef.value;
  if (image?.naturalWidth && image.naturalHeight) {
    imageSize.value = { width: image.naturalWidth, height: image.naturalHeight };
  }
}

function updateViewportSize() {
  viewportSize.value = { width: window.innerWidth, height: window.innerHeight };
}

watch(displaySrc, () => {
  imageSize.value = null;
  void nextTick(() => {
    if (imageRef.value?.complete) measureImage();
  });
}, { flush: 'sync' });

const mediaTransformStyle = computed(() => ({
  ...scaledImageSize(imageSize.value, scale.value),
  transform: `translate(${translateX.value + swipeOffsetX.value + slideOffsetX.value}px, ${translateY.value + swipeOffsetY.value}px) rotate(${rotation.value}deg)`,
  cursor: isDragging.value ? 'grabbing' : 'grab',
}));

/** 幽灵层自带离场时的缩放/旋转：换图那一帧主图的 transform 已经被重置。 */
const ghostTransformStyle = computed(() => {
  const ghost = slideGhost.value;
  if (!ghost) return {};
  return {
    ...scaledImageSize(ghost.imageSize, ghost.scale),
    transform: `translate(${ghost.offsetX}px, 0) rotate(${ghost.rotation}deg)`,
  };
});

function itemCoverUrl(item: FeedImageItem): string {
  return item.coverUrl || item.sourceUrl;
}

/** 私信图片等走 API 接口的图片（showImage）本身即原图，不做缩略图后缀处理。 */
function isPassThroughImageUrl(url: string): boolean {
  // 使用主机与路径字段判断私信接口，避免误判第三方 URL 中的相同字样。
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && ['api.coolapk.com', 'api2.coolapk.com'].includes(parsed.hostname); }
  catch { return false; }
}

/**
 * 该图片首次显示时使用的地址，必须与 loadCurrentMedia 的选择保持一致；
 * 相邻图片预读也复用这里，避免预读与显示读到两个不同地址而白读一轮。
 */
function itemDisplayUrl(item: FeedImageItem): string {
  const coverUrl = itemCoverUrl(item);
  if (isPassThroughImageUrl(coverUrl)) return coverUrl;
  if (item.isLivePhoto) return normalizeResourceUrl(item.sourceUrl || coverUrl);
  return getHdImageUrl(coverUrl);
}

/** 该图片的原图地址。 */
function itemOriginalUrl(item: FeedImageItem): string {
  if (!item.sourceUrl) return '';
  if (isPassThroughImageUrl(item.sourceUrl)) return item.sourceUrl;
  return getOriginalImageUrl(item.sourceUrl);
}

const currentUrl = computed(() => {
  const item = currentItem.value;
  if (!item) return '';
  // 这一张的原图已经加载过：切回来继续显示原图，不要退回缩略图。
  if (originalLoadedMap.value[currentIndex.value]) {
    const original = itemOriginalUrl(item);
    if (original) return original;
  }
  return itemDisplayUrl(item);
});

const originalUrl = computed(() => {
  const item = currentItem.value;
  return item ? itemOriginalUrl(item) : '';
});

const isCurrentOriginalLoaded = computed(() => Boolean(originalLoadedMap.value[currentIndex.value]));
const isCurrentOriginalLoading = computed(() => Boolean(originalLoadingMap.value[currentIndex.value]));
const showOriginalControl = computed(() => !isCurrentOriginalLoaded.value);

async function resolveImageData(url: string): Promise<boolean> {
  const sequence = ++resolveSequence;
  if (noImageMode.value) {
    displaySrc.value = '';
    return false;
  }
  if (!url) {
    displaySrc.value = '';
    return false;
  }
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    displaySrc.value = url;
    return true;
  }
  // 命中内存缓存时同步贴回，切图不用闪一帧「正在载入高清大图」。
  const cached = getMemoryCachedResourceSync(url);
  if (cached) {
    displaySrc.value = cached;
    return true;
  }
  displaySrc.value = '';
  try {
    const dataUrl = await loadImageResource(url, CoolapkTauriAPI.getImageDataUrl);
    if (sequence !== resolveSequence) return false;
    displaySrc.value = dataUrl;
    return true;
  } catch (err) {
    if (sequence !== resolveSequence) return false;
    console.warn('看图器加载图片失败:', err);
    displaySrc.value = url; // 备用回退直接使用原 url
    return false;
  }
}

function resetLiveState() {
  liveResolveSequence += 1;
  livePlaybackSequence += 1;
  liveResolving.value = false;
  liveVideoPlaying.value = false;
  liveSoundEnabled.value = settingsStore.settings.autoPlayLivePhotoSound;
  liveVideoError.value = false;
  liveVideoUnsupported.value = null;
  liveVideoFallbackAttempted.value = false;
  liveUnsupportedNoticeUrl = '';
  liveVideoSource.value = currentItem.value?.liveVideoUrl ? 'metadata' : 'none';
  const video = liveVideoRef.value;
  if (video) {
    video.pause();
    try {
      video.currentTime = 0;
    } catch {
      // 切图时旧视频还没有元数据时无需处理。
    }
  }
  liveVideoUrl.value = currentItem.value?.liveVideoUrl || '';
}

function decodeVideoHeader(encodedHeader: string): Uint8Array | null {
  try {
    const binary = atob(encodedHeader);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function checkLiveVideoCodec(videoUrl: string): Promise<{ codec: LiveVideoCodec | null; unsupported: boolean }> {
  const cached = liveVideoCodecChecks.get(videoUrl);
  if (cached) return await cached;
  const check = (async () => {
    try {
      const header = decodeVideoHeader(await CoolapkTauriAPI.getLivePhotoVideoHeader(videoUrl));
      const codec = header ? detectLiveVideoCodec(header) : null;
      if (!codec) return { codec: null, unsupported: false };
      return { codec, unsupported: await getLiveVideoCodecSupport(codec) === 'unsupported' };
    } catch {
      return { codec: null, unsupported: false };
    }
  })();
  liveVideoCodecChecks.set(videoUrl, check);
  return await check;
}

function showUnsupportedLiveVideoToast(codec: LiveVideoCodec, force = false) {
  if (settingsStore.settings.suppressUnsupportedLivePhotoCodecPrompt) return;
  if (!force && liveUnsupportedNoticeUrl === liveVideoUrl.value) return;
  liveUnsupportedNoticeUrl = liveVideoUrl.value;
  void showLivePhotoCodecPrompt(codec, () => {
    settingsStore.settings.suppressUnsupportedLivePhotoCodecPrompt = true;
  });
}

async function playLiveVideo(forceUnsupportedNotice = false): Promise<boolean> {
  const video = liveVideoRef.value;
  if (!video || !liveVideoUrl.value || liveVideoError.value) return false;
  const playbackSequence = ++livePlaybackSequence;
  liveVideoPlaying.value = false;
  const codecCheck = await checkLiveVideoCodec(liveVideoUrl.value);
  if (playbackSequence !== livePlaybackSequence || video !== liveVideoRef.value) return false;
  if (codecCheck.unsupported && codecCheck.codec) {
    liveVideoUnsupported.value = codecCheck.codec;
    video.pause();
    showUnsupportedLiveVideoToast(codecCheck.codec, forceUnsupportedNotice);
    return false;
  }
  liveVideoUnsupported.value = null;
  video.loop = true;
  video.muted = !liveSoundEnabled.value;
  try {
    await video.play();
    const hasFrame = await waitForDecodedVideoFrame(video);
    if (playbackSequence !== livePlaybackSequence || video !== liveVideoRef.value) return false;
    liveVideoPlaying.value = hasFrame;
    logLiveVideoState(hasFrame ? 'viewer_playing' : 'viewer_frame_failed', video);
    return hasFrame;
  } catch (error) {
    if (playbackSequence !== livePlaybackSequence || video !== liveVideoRef.value) return false;
    logLiveVideoState('viewer_play_failed', video, error);
    liveVideoPlaying.value = false;
    // 自动播放策略拒绝时保留静态封面，用户点击播放按钮仍可重试。
    return false;
  }
}

async function resolveCurrentLiveVideo(force = false) {
  if (noImageMode.value) {
    clearMediaForNoImageMode();
    return;
  }
  const item = currentItem.value;
  const sequence = ++liveResolveSequence;
  if (!item?.isLivePhoto) return;

  if (item.liveVideoUrl && !force) {
    liveVideoSource.value = 'metadata';
    await nextTick();
    if (sequence === liveResolveSequence) await playLiveVideo();
    return;
  }

  liveResolving.value = true;
  try {
    const videoUrl = await resolveLivePhotoVideo(
      item,
      viewerData.value?.contentId,
      viewerData.value?.contentType || 'feed',
      { force },
    );
    if (sequence !== liveResolveSequence) return;
    if (!videoUrl) {
      liveVideoError.value = true;
      return;
    }
    liveVideoSource.value = 'resolver';
    liveVideoUrl.value = videoUrl;
    await nextTick();
    await playLiveVideo();
  } catch (error) {
    if (sequence === liveResolveSequence) {
      liveVideoError.value = true;
      console.warn('Live Photo 查看器加载失败：', error);
    }
  } finally {
    if (sequence === liveResolveSequence) liveResolving.value = false;
  }
}

function handleLiveCanPlay() {
  void playLiveVideo();
}

async function retryLiveVideoThroughResolver() {
  const item = currentItem.value;
  if (!item?.isLivePhoto || liveVideoFallbackAttempted.value || !item.sourceUrl) return;

  liveVideoFallbackAttempted.value = true;
  livePlaybackSequence += 1;
  liveVideoError.value = false;
  liveVideoPlaying.value = false;
  liveVideoUnsupported.value = null;
  liveVideoSource.value = 'none';
  liveVideoUrl.value = '';
  await nextTick();
  await resolveCurrentLiveVideo(true);
}

async function handleLiveVideoError(event: Event) {
  // 切换地址时旧 video 节点可能晚到一步派发 error，不能覆盖新解析结果。
  const video = liveVideoRef.value;
  if (!video || event.target !== video) return;
  logLiveVideoState('viewer_media_failed', video);
  const codecCheck = await checkLiveVideoCodec(liveVideoUrl.value);
  if (event.target !== liveVideoRef.value) return;
  if (codecCheck.unsupported && codecCheck.codec) {
    liveVideoUnsupported.value = codecCheck.codec;
    liveVideoPlaying.value = false;
    showUnsupportedLiveVideoToast(codecCheck.codec);
    return;
  }
  liveVideoError.value = true;
  liveVideoPlaying.value = false;
  // imageUriList 里的 liveVideoUrl 可能是旧的直链；失败后按 APK 重新解析一次。
  if (liveVideoSource.value === 'metadata') {
    void retryLiveVideoThroughResolver();
  }
}

async function toggleLivePlayback() {
  const video = liveVideoRef.value;
  if (!video || !liveVideoUrl.value) return;
  if (liveVideoUnsupported.value) {
    showUnsupportedLiveVideoToast(liveVideoUnsupported.value, true);
    return;
  }
  if (video.paused) {
    if (liveVideoError.value && liveVideoSource.value === 'metadata') {
      await retryLiveVideoThroughResolver();
      return;
    }
    liveVideoError.value = false;
    await playLiveVideo(true);
  } else {
    livePlaybackSequence += 1;
    video.pause();
    liveVideoPlaying.value = false;
  }
}

async function toggleLiveSound() {
  if (!liveVideoUrl.value) return;
  liveSoundEnabled.value = !liveSoundEnabled.value;
  const video = liveVideoRef.value;
  if (!video) return;
  video.muted = !liveSoundEnabled.value;
  if (liveSoundEnabled.value && video.paused) await playLiveVideo();
}

watch(viewerData, (val) => {
  clearSingleTapClose();
  lastTapAt = 0;
  settleTransitionNow();
  if (val) {
    currentIndex.value = Math.min(Math.max(val.currentIndex, 0), Math.max(imageItems.value.length - 1, 0));
    originalLoadedMap.value = {};
    originalLoadingMap.value = {};
    resetTransform();
  } else {
    clearMediaForNoImageMode();
  }
});

function clearMediaForNoImageMode() {
  resolveSequence += 1;
  liveResolveSequence += 1;
  livePlaybackSequence += 1;
  displaySrc.value = '';
  originalLoadedMap.value = {};
  originalLoadingMap.value = {};
  liveResolving.value = false;
  liveVideoUrl.value = '';
  liveVideoPlaying.value = false;
  liveVideoError.value = false;
  liveVideoUnsupported.value = null;
  liveVideoSource.value = 'none';
  liveVideoFallbackAttempted.value = false;
  liveUnsupportedNoticeUrl = '';
  liveVideoCodecChecks.clear();
  const video = liveVideoRef.value;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

function loadCurrentMedia() {
  if (noImageMode.value) {
    clearMediaForNoImageMode();
    return;
  }
  if (settingsStore.settings.autoLoadOriginalImage && originalUrl.value) {
    void loadOriginal();
  } else if (currentUrl.value) {
    void resolveImageData(currentUrl.value);
  }
  void resolveCurrentLiveVideo();
  prefetchAdjacentImages();
}

/**
 * 预读左右相邻图片：切图时直接用缓存出图，不必等一次完整的原图下载。
 * 这里只做预热，不参与 displaySrc；同一地址的并发请求由 resourceCache 合并。
 */
function prefetchAdjacentImages() {
  if (noImageMode.value) return;
  const items = imageItems.value;
  if (items.length < 2) return;
  const prefetchOriginal = settingsStore.settings.autoLoadOriginalImage;
  for (const offset of [-1, 1]) {
    const item = items[currentIndex.value + offset];
    if (!item) continue;
    const url = (prefetchOriginal ? itemOriginalUrl(item) : '') || itemDisplayUrl(item);
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) continue;
    void loadImageResource(url, CoolapkTauriAPI.getImageDataUrl).catch(() => undefined);
  }
}

watch(currentItem, () => {
  resetTransform();
  if (!currentItem.value) {
    clearMediaForNoImageMode();
    return;
  }
  resetLiveState();
  loadCurrentMedia();
}, { immediate: true });

watch(noImageMode, (enabled) => {
  if (enabled) clearMediaForNoImageMode();
  else if (viewerData.value) loadCurrentMedia();
});

async function loadOriginal() {
  if (noImageMode.value) return;
  const idx = currentIndex.value;
  const itemSourceUrl = rawUrl.value;
  const url = originalUrl.value;

  // 没有原图地址（接口本身只给缩略图）时退回当前显示地址，避免切图后空着。
  if (!itemSourceUrl || !url) {
    if (currentUrl.value) await resolveImageData(currentUrl.value);
    return;
  }

  // 不再用 originalLoadingMap 拦截"同一张图正在加载"：同一地址的并发请求由
  // resourceCache 合并，而拦截会让「切走再切回」跳过加载，画面停在上一次的结果。
  originalLoadingMap.value = { ...originalLoadingMap.value, [idx]: true };
  try {
    const loaded = await resolveImageData(url);
    if (
      loaded
      && idx === currentIndex.value
      && currentItem.value?.sourceUrl === itemSourceUrl
    ) {
      originalLoadedMap.value = { ...originalLoadedMap.value, [idx]: true };
    }
  } finally {
    // 无论成功、失败还是被切图顶掉都要释放标记：只按"当前是否还是这张图"
    // 清理会让被切走的那张永久停在加载中，之后切回来既不重新加载也不更新画面。
    originalLoadingMap.value = { ...originalLoadingMap.value, [idx]: false };
  }
}

function resetTransform() {
  scale.value = 1;
  rotation.value = 0;
  translateX.value = 0;
  translateY.value = 0;
  swipeOffsetX.value = 0;
  swipeOffsetY.value = 0;
}

function rotateRight() {
  rotation.value = (rotation.value + 90) % 360;
}

function rotateLeft() {
  rotation.value = (rotation.value - 90 + 360) % 360;
}

function close() {
  clearSingleTapClose();
  lastTapAt = 0;
  appStore.closeImageViewer();
}

useAndroidBackButton(() => Boolean(viewerData.value), close);

function prev() {
  if (currentIndex.value > 0) {
    currentIndex.value--;
    resetTransform();
  }
}

function next() {
  if (currentIndex.value < totalCount.value - 1) {
    currentIndex.value++;
    resetTransform();
  }
}

function slideDistance(): number {
  const width = stageRef.value?.clientWidth ?? 0;
  return width > 0 ? width : Math.max(window.innerWidth || 0, 320);
}

function clearTransitionTimer() {
  if (transitionTimer !== null) {
    clearTimeout(transitionTimer);
    transitionTimer = null;
  }
}

/** 过渡结束后复位：清掉幽灵层，恢复默认过渡时长。 */
function endTransitionLater() {
  clearTransitionTimer();
  transitionTimer = setTimeout(() => {
    transitionTimer = null;
    mediaTransition.value = null;
    slideGhost.value = null;
  }, SLIDE_DURATION_MS + 40);
}

/** 立即结束进行中的切图/回弹过渡（新手势、关闭、卸载时调用）。 */
function settleTransitionNow() {
  clearTransitionTimer();
  mediaTransition.value = null;
  slideGhost.value = null;
  slideOffsetX.value = 0;
}

/**
 * 手势结束时把跟手位移归零：同一帧内切到缓动，让画面滑回原位而不是 50ms 硬切。
 */
function restoreSwipeOffsets() {
  const hadOffset = swipeOffsetX.value !== 0 || swipeOffsetY.value !== 0;
  touchDragging.value = false;
  if (!hadOffset) {
    swipeOffsetX.value = 0;
    swipeOffsetY.value = 0;
    return;
  }
  mediaTransition.value = 'smooth';
  swipeOffsetX.value = 0;
  swipeOffsetY.value = 0;
  endTransitionLater();
}

/**
 * 带过渡地切换图片：
 * 1) 同一帧内以「无过渡」把新画面摆到手指另一侧的屏幕外，避免闪一帧居中画面；
 * 2) 旧画面交给幽灵层，从手指当前位置继续滑出；
 * 3) 下一帧打开缓动，两层同时滑动到终点。
 * 换图本身仍是同步的，计数与画面同一帧生效。
 */
function slideTo(direction: 1 | -1, fromOffsetX = 0): boolean {
  clearSingleTapClose();
  const atEdge = direction === 1
    ? currentIndex.value >= totalCount.value - 1
    : currentIndex.value <= 0;
  if (atEdge) return false;

  const distance = slideDistance();
  const ghostSrc = displaySrc.value;
  clearTransitionTimer();
  slideGhost.value = ghostSrc
    ? { src: ghostSrc, offsetX: fromOffsetX, scale: scale.value, rotation: rotation.value, imageSize: imageSize.value }
    : null;
  // 跟手位移交接给过渡位移：新画面从手指另一侧的屏幕外滑入。
  swipeOffsetX.value = 0;
  swipeOffsetY.value = 0;
  touchDragging.value = false;
  mediaTransition.value = 'none';
  slideOffsetX.value = direction * distance;

  if (direction === 1) next();
  else prev();

  void nextTick(() => {
    // 读一次布局强制样式刷新，确保缓动从上一帧的位置开始，而不是滑向屏幕外。
    if (stageRef.value) void stageRef.value.offsetWidth;
    mediaTransition.value = 'smooth';
    slideOffsetX.value = 0;
    const ghost = slideGhost.value;
    if (ghost) slideGhost.value = { ...ghost, offsetX: -direction * distance };
    endTransitionLater();
  });
  return true;
}

function zoomIn() {
  scale.value = Math.min(Number((scale.value + 0.25).toFixed(2)), 4);
}

function zoomOut() {
  scale.value = Math.max(Number((scale.value - 0.25).toFixed(2)), 0.3);
}

function handleWheel(e: WheelEvent) {
  const delta = e.deltaY < 0 ? 0.15 : -0.15;
  const newScale = Math.min(Math.max(scale.value + delta, 0.3), 5);
  scale.value = Number(newScale.toFixed(2));
}

function toggleZoom() {
  if (scale.value === 1) {
    scale.value = 1.8;
  } else {
    resetTransform();
  }
}

function handleDoubleClick() {
  clearSingleTapClose();
  // 触摸端已经用 touchend 间隔识别过双击，避免同一次双击被鼠标事件再算一遍。
  if (Date.now() < suppressDoubleClickUntil) return;
  toggleZoom();
}

let dragStartX = 0;
let dragStartY = 0;
let isDraggedMove = false;

function startDrag(e: MouseEvent) {
  if (e.button !== 0) return; // 仅限左键拖拽
  isDragging.value = true;
  isDraggedMove = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  startX = e.clientX - translateX.value;
  startY = e.clientY - translateY.value;
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
  if (dist > 4) {
    isDraggedMove = true;
  }
  translateX.value = e.clientX - startX;
  translateY.value = e.clientY - startY;
}

function stopDrag() {
  setTimeout(() => {
    isDragging.value = false;
  }, 50);
}

/* ------------------------------------------------------------------
 * 触摸手势（移动端）
 * 缩放比例为 1 时：单指横滑 = 上一张 / 下一张（跟随位移 + 边界阻尼），
 * 单指下滑 = 关闭查看器，双击 = 放大 / 还原。
 * 两指：捏合缩放。
 * 放大后：单指拖动 = 平移图片，避免和切图冲突。
 * ------------------------------------------------------------------ */
const SWIPE_SWITCH_DISTANCE = 56;
const SWIPE_CLOSE_DISTANCE = 120;
const SWIPE_AXIS_LOCK_RATIO = 1.15;
const SWIPE_EDGE_RESISTANCE = 0.28;
const BACKDROP_TAP_GUARD_MS = 400;
// 触摸端双击判定窗口；与 utils/homeTab 的 360ms 取值保持同一量级。
const DOUBLE_TAP_MS = 300;
const PINCH_MIN_SCALE = 0.3;
const PINCH_MAX_SCALE = 4;

let touchActive = false;
let touchMoved = false;
let touchPanMode = false;
let touchStartX = 0;
let touchStartY = 0;
let suppressBackdropTapUntil = 0;
let suppressDoubleClickUntil = 0;
let lastTapAt = 0;
let singleTapCloseTimer: ReturnType<typeof setTimeout> | null = null;
let pinchActive = false;
let pinchStartDistance = 0;
let pinchStartScale = 1;

function clearSingleTapClose() {
  if (singleTapCloseTimer !== null) clearTimeout(singleTapCloseTimer);
  singleTapCloseTimer = null;
}

function scheduleSingleTapClose() {
  clearSingleTapClose();
  // 等待双击判定窗口，第二次点按或开始拖动、捏合时取消关闭。
  singleTapCloseTimer = setTimeout(() => {
    singleTapCloseTimer = null;
    close();
  }, DOUBLE_TAP_MS);
}

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function onTouchStart(e: TouchEvent) {
  clearSingleTapClose();
  // 新手势打断上一段切图过渡，避免两层动画同时跑。
  settleTransitionNow();
  touchMoved = false;
  touchPanMode = false;
  swipeOffsetX.value = 0;
  swipeOffsetY.value = 0;

  // 双指：捏合缩放。整段手势结束后才重新接管，避免缩放中途误切图。
  if (e.touches.length === 2) {
    lastTapAt = 0;
    touchActive = false;
    pinchActive = true;
    touchDragging.value = true;
    pinchStartDistance = touchDistance(e.touches[0], e.touches[1]);
    pinchStartScale = scale.value;
    return;
  }

  pinchActive = false;
  if (e.touches.length !== 1) {
    touchActive = false;
    touchDragging.value = false;
    return;
  }
  touchActive = true;
  touchDragging.value = true;
  const touch = e.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  if (scale.value > 1) {
    touchPanMode = true;
    isDragging.value = true;
    startX = touch.clientX - translateX.value;
    startY = touch.clientY - translateY.value;
  }
}

function onTouchMove(e: TouchEvent) {
  if (pinchActive) {
    if (e.touches.length !== 2 || pinchStartDistance <= 0) return;
    if (e.cancelable) e.preventDefault();
    const distance = touchDistance(e.touches[0], e.touches[1]);
    if (Math.abs(distance - pinchStartDistance) > 8) touchMoved = true;
    const next = pinchStartScale * (distance / pinchStartDistance);
    scale.value = Math.min(Math.max(Number(next.toFixed(2)), PINCH_MIN_SCALE), PINCH_MAX_SCALE);
    return;
  }

  if (!touchActive) return;
  if (e.touches.length !== 1) {
    touchActive = false;
    touchDragging.value = false;
    swipeOffsetX.value = 0;
    swipeOffsetY.value = 0;
    return;
  }
  const touch = e.touches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  if (Math.hypot(dx, dy) > 6) touchMoved = true;

  if (touchPanMode) {
    if (e.cancelable) e.preventDefault();
    translateX.value = touch.clientX - startX;
    translateY.value = touch.clientY - startY;
    return;
  }

  if (Math.abs(dy) > Math.abs(dx) * SWIPE_AXIS_LOCK_RATIO) {
    // 竖向手势：下滑关闭。上滑不接管，留给后续可能加入的手势。
    swipeOffsetX.value = 0;
    swipeOffsetY.value = dy > 0 ? dy : 0;
    if (e.cancelable) e.preventDefault();
    return;
  }

  if (Math.abs(dx) <= Math.abs(dy) * SWIPE_AXIS_LOCK_RATIO) {
    swipeOffsetX.value = 0;
    return;
  }
  if (e.cancelable) e.preventDefault();

  const atStart = currentIndex.value === 0 && dx > 0;
  const atEnd = currentIndex.value === totalCount.value - 1 && dx < 0;
  swipeOffsetX.value = (atStart || atEnd) ? dx * SWIPE_EDGE_RESISTANCE : dx;
}

function endTouchGesture(commitSwipe: boolean) {
  const offsetX = swipeOffsetX.value;
  const offsetY = swipeOffsetY.value;
  const wasPinching = pinchActive;
  const wasTouchActive = touchActive;
  const panned = touchPanMode;
  pinchActive = false;
  touchActive = false;
  touchPanMode = false;

  if (wasPinching) {
    if (isTouchMobilePlatform()) suppressBackdropTapUntil = Date.now() + BACKDROP_TAP_GUARD_MS;
    restoreSwipeOffsets();
    return;
  }
  if (!wasTouchActive) {
    restoreSwipeOffsets();
    return;
  }

  // 移动端纯点按延后关闭，让双击仍可缩放；桌面保留点击背景关闭。
  // 注意放在平移判断之前：放大状态下单击同样不能移动图片，必须仍然允许双击还原。
  if (!touchMoved) {
    if (panned) isDragging.value = false;
    if (!commitSwipe && isTouchMobilePlatform()) {
      lastTapAt = 0;
      suppressBackdropTapUntil = Date.now() + BACKDROP_TAP_GUARD_MS;
      restoreSwipeOffsets();
      return;
    }
    const now = Date.now();
    if (lastTapAt > 0 && now - lastTapAt < DOUBLE_TAP_MS) {
      lastTapAt = 0;
      suppressBackdropTapUntil = now + BACKDROP_TAP_GUARD_MS;
      suppressDoubleClickUntil = now + BACKDROP_TAP_GUARD_MS;
      toggleZoom();
    } else {
      lastTapAt = now;
      if (isTouchMobilePlatform()) {
        suppressBackdropTapUntil = now + BACKDROP_TAP_GUARD_MS;
        scheduleSingleTapClose();
      }
    }
    restoreSwipeOffsets();
    return;
  }

  lastTapAt = 0;
  if (panned) {
    isDragging.value = false;
    suppressBackdropTapUntil = Date.now() + BACKDROP_TAP_GUARD_MS;
    restoreSwipeOffsets();
    return;
  }
  // 滑动结束后 WebKit 仍可能补发一次 click，避免被当成"点背景"直接关闭。
  suppressBackdropTapUntil = Date.now() + BACKDROP_TAP_GUARD_MS;

  // 下滑关闭：画面留在手指松开的位置随遮罩一起淡出，不再弹回中心。
  if (commitSwipe && offsetY >= SWIPE_CLOSE_DISTANCE) {
    touchDragging.value = false;
    close();
    return;
  }
  if (commitSwipe && Math.abs(offsetX) >= SWIPE_SWITCH_DISTANCE) {
    slideTo(offsetX < 0 ? 1 : -1, offsetX);
    return;
  }
  // 位移不够：缓动回弹。
  restoreSwipeOffsets();
}

function onTouchEnd(e: TouchEvent) {
  // 捏合结束时可能还有一根手指在屏幕上，等全部抬起再复位。
  if (pinchActive && e.touches.length > 0) return;
  endTouchGesture(true);
}

function onTouchCancel() {
  endTouchGesture(false);
}

function handleBackdropClick(e: MouseEvent) {
  if (Date.now() < suppressBackdropTapUntil) return;

  if (isDraggedMove) {
    isDraggedMove = false;
    return;
  }

  const target = e.target as HTMLElement;
  if (!target) return;

  if (target.tagName.toLowerCase() === 'img') {
    if (isTouchMobilePlatform()) scheduleSingleTapClose();
    return;
  }
  if (target.closest('.viewer-topbar') || target.closest('.viewer-bottombar') || target.closest('.nav-arrow') || target.closest('.raw-image-btn') || target.closest('.viewer-btn')) {
    return;
  }

  close();
}

function copyLink() {
  if (currentUrl.value) {
    navigator.clipboard.writeText(currentUrl.value);
  }
}

async function saveOriginal() {
  if (!originalUrl.value || savingOriginal.value) return;
  savingOriginal.value = true;
  try {
    const path = await CoolapkTauriAPI.saveImage(
      originalUrl.value,
      settingsStore.settings.downloadPath,
      currentUrl.value === originalUrl.value && /^(?:data:|blob:)/.test(displaySrc.value) ? displaySrc.value : undefined
    );
    showToast(`原图已保存：${path}`, 'success', 3000);
  } catch (error) {
    showToast(getErrorMessage(error, '保存原图失败'), 'error', 3000);
  } finally {
    savingOriginal.value = false;
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!viewerData.value) return;
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowLeft') slideTo(-1);
  if (e.key === 'ArrowRight') slideTo(1);
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', updateViewportSize);
});
onUnmounted(() => {
  clearSingleTapClose();
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('resize', updateViewportSize);
  clearTransitionTimer();
  clearMediaForNoImageMode();
});
</script>

<style scoped>
.image-viewer-backdrop {
  position: fixed;
  /* 桌面端避开应用标题栏，避免预览工具栏覆盖窗口控制按钮。 */
  inset: var(--topbar-height) 0 0;
  background-color: rgba(0, 0, 0, 0.92);
  z-index: 3000;
  display: flex;
  flex-direction: column;
}

.viewer-topbar {
  flex-shrink: 0;
  height: 56px;
  padding: 0 var(--space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #ffffff;
  z-index: 3002;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.counter-text {
  white-space: nowrap;
  font-size: var(--font-size-sub, 14px);
  font-weight: var(--font-weight-medium, 500);
}

.topbar-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border-radius: 4px;
  border: none;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.15);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
  user-select: none;
}

.topbar-live-badge:hover {
  background: rgba(255, 255, 255, 0.25);
}

.topbar-live-badge.is-playing {
  background: rgba(16, 185, 129, 0.8);
  color: #ffffff;
}

.live-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  transition: all 0.2s ease;
}

.topbar-live-badge.is-playing .live-badge-dot {
  background: #ffffff;
  transform: scale(1.2);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.viewer-btn {
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-control, 8px);
  cursor: pointer;
  transition: all 0.2s ease;
}

.viewer-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
}

.viewer-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.zoom-text {
  font-size: 13px;
  min-width: 44px;
  text-align: center;
}

.nav-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 3002;
  transition: background 0.2s ease;
}

.nav-arrow:hover {
  background: rgba(255, 255, 255, 0.3);
}

.nav-prev { left: 24px; }
.nav-next { right: 24px; }

.image-stage {
  flex: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  user-select: none;
  /* 触摸端由脚本接管横滑切图与放大后平移，避免被 WebView 当成滚动/回弹。 */
  touch-action: none;
}

.viewer-img {
  flex-shrink: 0;
  max-width: 90vw;
  max-height: 88vh;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  transition: transform 0.05s ease-out;
  pointer-events: auto;
}

/* 触摸拖动期间取消过渡，保证位移严格跟手。 */
.viewer-img.is-touch-dragging {
  transition: none;
}

/* 切图/回弹过渡：时长必须与脚本里的 SLIDE_DURATION_MS 保持一致。 */
.viewer-img.is-sliding,
.viewer-ghost.is-sliding {
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}

/* 切图时继续滑出的旧画面；盒子与 .viewer-img 对齐，盖在新图之上。 */
.viewer-ghost {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  max-width: 90vw;
  max-height: 88vh;
  margin: auto;
  object-fit: contain;
  display: block;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  pointer-events: none;
}

.viewer-live-video {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  max-width: 90vw;
  max-height: 88vh;
  margin: auto;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.viewer-live-badge {
  position: absolute;
  top: 20px;
  left: 24px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  color: #ffffff;
  background: rgba(15, 23, 42, 0.55);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.viewer-live-badge:hover {
  background: rgba(15, 23, 42, 0.75);
  border-color: rgba(255, 255, 255, 0.45);
  transform: scale(1.04);
}

.viewer-live-badge.is-playing {
  background: rgba(16, 185, 129, 0.75);
  border-color: rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.45);
}

.live-badge-rings,
.live-badge-rings::before,
.live-badge-rings::after,
.live-badge-rings span {
  display: block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.live-badge-rings {
  position: relative;
  flex: 0 0 9px;
  background: #ffffff;
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.4);
}

.viewer-live-badge.is-playing .live-badge-rings {
  background: #ffffff;
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.6);
}

.live-badge-rings::before,
.live-badge-rings::after,
.live-badge-rings span {
  position: absolute;
  top: 50%;
  left: 50%;
  content: '';
  border: 1px solid rgba(255, 255, 255, 0.75);
  transform: translate(-50%, -50%) scale(0.6);
  animation: live-viewer-ring-pulse 1.8s ease-out infinite;
}

.live-badge-rings::after {
  animation-delay: 0.6s;
}

.live-badge-rings span {
  animation-delay: 1.2s;
}

.viewer-live-loading {
  margin-left: 2px;
  font-size: 10px;
}

.viewer-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
}

.viewer-loading i {
  font-size: 32px;
  color: var(--brand-primary, #10b966);
}

.viewer-bottombar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3002;
  display: flex;
  align-items: center;
  justify-content: center;
}

.viewer-control-island {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transition: all 0.2s ease;
}

.island-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
}

.island-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.island-btn.is-active {
  background: rgba(16, 185, 129, 0.28);
  color: #10b981;
  font-weight: 600;
}

.island-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.live-play-btn i {
  font-size: 11px;
}

.live-sound-btn i {
  font-size: 12px;
}

.island-divider {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.16);
  margin: 0 2px;
}

.raw-image-btn i {
  font-size: 12px;
}

.raw-image-btn.is-loaded {
  color: #10b981;
  cursor: default;
}

@keyframes live-viewer-ring-pulse {
  0% {
    opacity: 0.84;
    transform: translate(-50%, -50%) scale(0.55);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.9);
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-badge-rings::before,
  .live-badge-rings::after,
  .live-badge-rings span,
  .viewer-live-video {
    animation: none;
    transition: none;
  }

  .viewer-img.is-sliding,
  .viewer-ghost.is-sliding {
    transition: none;
  }
}

@media (max-width: 720px) {
  .image-viewer-backdrop {
    inset: 0;
  }

  /* 顶栏落在刘海/灵动岛区域，必须自行让出安全区（与 MobileTopBar 一致）。 */
  .viewer-topbar {
    height: auto;
    min-height: 44px;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 8px;
    padding: var(--app-safe-area-top, 0px) max(10px, env(safe-area-inset-left)) 0 max(10px, env(safe-area-inset-right));
  }

  /* 桌面版整排按钮宽度（约 428px）超过手机可用宽度，这里压缩到能完整放下关闭按钮。 */
  .topbar-actions {
    gap: 2px;
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-left: auto;
  }

  .viewer-btn {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    font-size: 14px;
  }

  .zoom-text {
    min-width: 32px;
    font-size: 12px;
  }

  .counter-text {
    font-size: 13px;
  }

  .nav-arrow {
    width: 40px;
    height: 40px;
    font-size: 16px;
    background: rgba(255, 255, 255, 0.1);
  }

  .nav-prev { left: 8px; }
  .nav-next { right: 8px; }

  .viewer-bottombar {
    bottom: calc(16px + env(safe-area-inset-bottom));
  }
}
</style>
