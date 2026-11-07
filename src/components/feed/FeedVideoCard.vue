<template>
  <div v-if="video && !settingsStore.settings.noImageMode" class="feed-video-card" @click.stop>
    <div class="feed-video-frame">
      <video
        ref="videoRef"
        class="feed-video"
        :key="playableUrl"
        :src="playableUrl || undefined"
        :poster="video.poster || undefined"
        controls
        :preload="isWebBuild ? 'none' : 'metadata'"
        playsinline
        @play="hasStarted = true"
        @ended="hasStarted = false"
        @loadedmetadata="videoError = false"
        @error="handleVideoError"
      ></video>

        <button
          v-if="!hasStarted"
        type="button"
        class="feed-video-poster"
        aria-label="播放视频"
        @click.stop="playVideo"
      >
        <AppImage v-if="video.poster" :src="video.poster" alt="视频封面" image-class="video-poster-image" fit="cover" />
        <div v-else class="video-poster-fallback"><i class="fas fa-film"></i></div>
        <span class="video-poster-shade"></span>
        <span class="video-play-button"><i class="fas fa-play"></i></span>
          <span v-if="formattedDuration" class="video-duration">{{ formattedDuration }}</span>
        </button>
        <button v-if="videoError" type="button" class="video-error-message" @click.stop="retryVideo">视频加载失败，请重试</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { isWebBuild } from '../../api/runtime';
import { useSettingsStore } from '../../stores/settings';
import AppImage from '../common/AppImage.vue';
import { extractFeedVideoUrl, formatFeedVideoDuration, getFeedVideo } from '../../utils/feedMedia';

const props = defineProps<{ feed: unknown }>();
const settingsStore = useSettingsStore();
const videoRef = ref<HTMLVideoElement | null>(null);
const hasStarted = ref(false);
const video = computed(() => getFeedVideo(props.feed));
const formattedDuration = computed(() => formatFeedVideoDuration(video.value?.duration || ''));
const videoError = ref(false);
const resolvedUrl = ref('');
const resolutionFailed = ref(false);
const resolving = ref(false);
const webProxyUrl = ref('');
let resolutionVersion = 0;
let playRequested = false;

function getPlayableSource(url: string): string {
  if (!url || isWebBuild) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === 'https:' && (host === 'weibocdn.com' || host.endsWith('.weibocdn.com'))) {
      const encodedUrl = encodeURIComponent(url);
      // Windows WebView2 exposes Tauri custom schemes through the mapped
      // http://<scheme>.localhost origin.
      return navigator.userAgent.includes('Windows')
        ? `http://coolapk-video.localhost/?url=${encodedUrl}`
        : `coolapk-video://localhost/?url=${encodedUrl}`;
    }
  } catch {
    // 保留原始地址，让 video 元素按原有错误链路处理。
  }
  return url;
}

const playableUrl = computed(() => {
  if (!video.value) return '';
  if (isWebBuild) return webProxyUrl.value || resolvedUrl.value || video.value.url;
  const url = video.value.requestParams && !resolutionFailed.value ? resolvedUrl.value : video.value.url;
  return getPlayableSource(url);
});

async function resolveVideo() {
  if (settingsStore.settings.noImageMode) return;
  const requestParams = video.value?.requestParams;
  if (!requestParams) return;

  const currentVersion = ++resolutionVersion;
  resolving.value = true;
  resolutionFailed.value = false;
  resolvedUrl.value = '';
  videoError.value = false;
  try {
    const response: any = await CoolapkTauriAPI.resolveVideoUrl(requestParams);
    const url = extractFeedVideoUrl(response);
    if (!url) throw new Error('酷安未返回可播放地址');
    if (currentVersion !== resolutionVersion) return;
    resolvedUrl.value = url;
  } catch (error) {
    console.warn('酷安视频地址解析失败：', error);
    if (currentVersion === resolutionVersion) resolutionFailed.value = true;
  } finally {
    if (currentVersion === resolutionVersion) resolving.value = false;
  }
}

watch([() => video.value?.requestParams, () => isWebBuild ? video.value?.url : undefined, () => settingsStore.settings.noImageMode], ([, , noImageMode]) => {
  if (isWebBuild) {
    resolutionVersion += 1;
    playRequested = false;
    hasStarted.value = false;
    webProxyUrl.value = '';
  }
  if (noImageMode || isWebBuild) {
    resolvedUrl.value = '';
    resolutionFailed.value = false;
    resolving.value = false;
    videoError.value = false;
    return;
  }
  void resolveVideo();
}, { immediate: true });

async function playVideo() {
  if (resolving.value) return;
  playRequested = true;
  if (isWebBuild && !playableUrl.value && video.value?.requestParams) {
    await resolveVideo();
    await nextTick();
    if (!playRequested) return;
  }
  if (!videoRef.value || !playableUrl.value) {
    if (isWebBuild) videoError.value = true;
    return;
  }
  videoError.value = false;
  try {
    await videoRef.value.play();
  } catch {
    if (!resolving.value) videoError.value = true;
  }
}

async function handleVideoError() {
  if (resolving.value) return;
  if (isWebBuild && !resolvedUrl.value && !resolutionFailed.value && video.value?.requestParams) {
    const version = resolutionVersion + 1;
    await resolveVideo();
    await nextTick();
    if (version !== resolutionVersion) return;
    if (resolvedUrl.value && playRequested) await playVideo();
    else if (!resolvedUrl.value) await handleVideoError();
    return;
  }
  if (isWebBuild && !webProxyUrl.value) {
    const cdnUrl = [resolvedUrl.value, video.value?.url].find(url => /^https:\/\/(?:[a-z0-9-]+\.)*weibocdn\.com\//i.test(url || ''));
    if (cdnUrl) {
      webProxyUrl.value = `/api/media/weibo-video?url=${encodeURIComponent(cdnUrl)}`;
      await nextTick();
      if (playRequested) await playVideo();
      return;
    }
  }
  videoError.value = true;
}

function retryVideo() {
  videoError.value = false;
  if (video.value?.requestParams && !webProxyUrl.value) {
    void resolveVideo();
    return;
  }
  const element = videoRef.value;
  if (!element) return;
  element.load();
  void element.play().catch(() => {
    videoError.value = true;
  });
}
</script>

<style scoped>
.feed-video-card {
  width: min(100%, 620px);
  margin: 6px 0 12px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #111827;
}

.feed-video-frame {
  position: relative;
  aspect-ratio: 16 / 9;
  min-height: 180px;
}

.feed-video {
  display: block;
  width: 100%;
  height: 100%;
  background: #000;
  object-fit: contain;
}

.feed-video-poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  color: #fff;
  cursor: pointer;
  background: transparent;
}

.video-poster-image,
.video-poster-fallback,
.video-poster-shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.video-poster-image {
  display: block;
}

.video-poster-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.68);
  font-size: 36px;
  background: linear-gradient(135deg, #1f2937, #111827);
}

.video-poster-shade {
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.52));
}

.video-play-button {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.52);
  font-size: 20px;
  transform: translate(-50%, -50%);
  transition: transform 0.18s ease, background-color 0.18s ease;
}

.feed-video-poster:hover .video-play-button {
  background: var(--brand-primary, #10b981);
  transform: translate(-50%, -50%) scale(1.06);
}

.video-duration {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 2px 7px;
  border-radius: 5px;
  color: #fff;
  background: rgba(0, 0, 0, 0.68);
  font-size: 12px;
  line-height: 1.4;
}

.video-error-message {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 2px 7px;
  border-radius: 5px;
  color: #fff;
  background: rgba(127, 29, 29, 0.82);
  font-size: 12px;
  line-height: 1.4;
  border: 0;
  cursor: pointer;
  pointer-events: auto;
}
</style>
