<template>
  <div
    v-if="!noImageMode"
    ref="containerRef"
    class="app-image-container"
    :class="[imageClass, { 'is-loading': loading, 'is-error': error, 'fit-contain': fit === 'contain' }]"
  >
    <img
      v-if="renderedSrc && !error"
      :src="renderedSrc"
      :alt="alt"
      :style="{ objectFit: fit }"
      referrerpolicy="no-referrer"
      v-bind="$attrs"
      :data-original-url="contextImageUrl || undefined"
      @load="handleLoad"
      @error="handleError"
    />
    <div v-else-if="loading && !hideSpinner" class="image-placeholder">
      <i class="fa-solid fa-spinner fa-spin"></i>
    </div>
    <div v-else-if="error" class="image-error">
      <i class="fa-solid fa-image-slash"></i>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { useSettingsStore } from '../../stores/settings';
import { useNoImageMode } from '../../composables/useNoImageMode';
import { sanitizeImageUrl } from '../../utils/image';
import { loadImageResource, normalizeResourceUrl, getMemoryCachedResourceSync } from '../../utils/resourceCache';
import { observeResourceVisibility } from '../../utils/resourceVisibility';
import { useResourceUrlLifetime } from '../../composables/useResourceUrlLifetime';

const props = withDefaults(defineProps<{
  src?: string;
  alt?: string;
  imageClass?: string | object | any[];
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  hideSpinner?: boolean;
}>(), {
  fit: 'cover',
  hideSpinner: false,
});

const emit = defineEmits<{
  (event: 'load', payload: Event): void;
  (event: 'error', payload: Event): void;
}>();

const settingsStore = useSettingsStore();
const noImageMode = useNoImageMode();
const contextImageUrl = computed(() => props.src ? normalizeResourceUrl(props.src) : '');

// 同步尝试命中内存缓存
const initialCached = typeof IntersectionObserver === 'undefined' ? getMemoryCachedResourceSync(props.src) : null;
const renderedSrc = ref<string | undefined>(initialCached || undefined);
useResourceUrlLifetime(renderedSrc);
const loading = ref(!initialCached && !!props.src);
const error = ref(false);
const isFallback = ref(false);

let loadSequence = 0;
let active = true;
let nearViewport = typeof IntersectionObserver === 'undefined';
const containerRef = ref<HTMLElement | null>(null);
let stopObserving = () => {};

function releaseRenderedImage() {
  loadSequence += 1;
  renderedSrc.value = undefined;
  loading.value = false;
}

function observeImage() {
  stopObserving();
  if (!containerRef.value || !active) return;
  nearViewport = typeof IntersectionObserver === 'undefined';
  stopObserving = observeResourceVisibility(containerRef.value, visible => {
    nearViewport = visible;
    if (!active) return;
    if (visible) void loadImage(props.src);
    else releaseRenderedImage();
  });
}

function releaseImage() {
  active = false;
  stopObserving();
  releaseRenderedImage();
}

async function loadImage(url: string | undefined) {
  const sequence = ++loadSequence;
  if (!active || !nearViewport || noImageMode.value) {
    renderedSrc.value = undefined;
    error.value = false;
    loading.value = false;
    isFallback.value = false;
    return;
  }
  if (!url) {
    renderedSrc.value = undefined;
    error.value = false;
    loading.value = false;
    return;
  }

  // 1. 如果是相对地址，自动补全 https；如果是 http 协议，强制自动升级为 https
  const targetUrl = normalizeResourceUrl(url);

  // 协议白名单：降级路径会直接把 URL 交给 <img>（WebView 原生加载），
  // file:/javascript: 等异常 scheme 一律拒绝，防止加载/探测本地文件
  if (!sanitizeImageUrl(targetUrl)) {
    error.value = true;
    loading.value = false;
    renderedSrc.value = undefined;
    return;
  }

  // 2. 如果是本地或者 base64，直接使用
  if (targetUrl.startsWith('data:') || targetUrl.startsWith('blob:') || targetUrl.startsWith('/')) {
    renderedSrc.value = targetUrl;
    loading.value = false;
    error.value = false;
    return;
  }

  // 3. 同步内存缓存秒开命中（0 毫秒零闪烁）
  const syncCached = getMemoryCachedResourceSync(targetUrl);
  if (syncCached) {
    renderedSrc.value = syncCached;
    loading.value = false;
    error.value = false;
    return;
  }

  // 4. 依次检查持久缓存和网络（保持当前已渲染的图片，平滑过渡，不置为 undefined）
  loading.value = true;
  error.value = false;
  isFallback.value = false;

  try {
    const dataUrl = await loadImageResource(targetUrl, (resourceUrl) => (
      CoolapkTauriAPI.getImageDataUrl(resourceUrl, {
        cacheDir: settingsStore.settings.cachePath,
        cacheTtlDays: settingsStore.settings.cacheTtlDays,
      })
    ));
    if (sequence !== loadSequence) return;
    renderedSrc.value = dataUrl;
  } catch (err) {
    if (sequence !== loadSequence) return;
    // 代理请求失败时，自动降级为原生应用 HTTP/HTTPS 直接请求
    isFallback.value = true;
    renderedSrc.value = targetUrl;
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

watch([() => props.src, noImageMode], ([newSrc, disabled]) => {
  if (disabled) {
    loadSequence += 1;
    renderedSrc.value = undefined;
    error.value = false;
    loading.value = false;
    isFallback.value = false;
    return;
  }
  void loadImage(newSrc);
});

onMounted(() => {
  void loadImage(props.src);
});
watch(containerRef, observeImage, { flush: 'post' });

// 保留页面数据和滚动位置，但不让后台页面继续持有图片和解码图层。
onDeactivated(releaseImage);
onUnmounted(releaseImage);
onActivated(() => {
  if (active) return;
  active = true;
  observeImage();
});

function handleLoad(event: Event) {
  loading.value = false;
  emit('load', event);
}

function handleError(event: Event) {
  // 如果降级直接链接后依然失败，才提示为 Error
  if (isFallback.value || !props.src) {
    error.value = true;
  } else {
    isFallback.value = true;
    let targetUrl = props.src;
    if (targetUrl.startsWith('//')) {
      targetUrl = `https:${targetUrl}`;
    }
    renderedSrc.value = targetUrl;
  }
  loading.value = false;
  emit('error', event);
}
</script>


<style scoped>
.app-image-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: var(--background-secondary, #f0f0f0);
  overflow: hidden;
  position: relative;
}

.app-image-container img {
  width: 100%;
  height: 100%;
  display: block;
}

.app-image-container.fit-contain {
  background-color: transparent;
}

.app-image-container.fit-contain img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-placeholder,
.image-error {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--text-tertiary, #999);
  font-size: 1.2rem;
}
</style>
