<template>
  <!-- 悬浮模式（默认）：页面滚动时在右下角展示圆形悬浮按钮 -->
  <Transition v-if="variant === 'floating'" name="back-to-top-fade">
    <button
      v-if="showButton"
      class="back-to-top-btn"
      title="回到顶部"
      @click="scrollToTop"
    >
      <i class="fas fa-arrow-up icon"></i>
      <span class="tooltip-text">回到顶部</span>
    </button>
  </Transition>

  <!-- 导航栏模式：复用在顶部导航栏等区域，作为标准图标按钮展示 -->
  <AppIconButton
    v-else-if="variant === 'nav'"
    class="scroll-to-top-nav-btn"
    icon="fas fa-arrow-up"
    title="回到顶部"
    aria-label="回到顶部"
    size="sm"
    @click="scrollToTop"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import AppIconButton from './AppIconButton.vue';

const props = withDefaults(
  defineProps<{
    variant?: 'floating' | 'nav';
  }>(),
  {
    variant: 'floating',
  }
);

const route = useRoute();
const showButton = ref(false);
let activeScrollTarget: HTMLElement | Window | null = null;

const isExcluded = computed(() => {
  return route?.path?.startsWith('/messages');
});

let scrollRafId: number | null = null;
let pendingScrollEvent: Event | undefined;
let lastScrollFrameTime = 0;

function checkScroll(e?: Event) {
  if (isExcluded.value) {
    showButton.value = false;
    return;
  }

  let scrollTop = 0;
  const target = e?.target as HTMLElement | null;
  if (target && target.scrollTop !== undefined) {
    if (target.scrollTop === 0 && !showButton.value) {
      return;
    }
    // 排除聊天区域内的内部滚动
    if (target.classList?.contains('chat-area') || target.classList?.contains('session-list') || target.closest?.('.messages-page')) {
      showButton.value = false;
      return;
    }
    scrollTop = target.scrollTop;
    if (scrollTop > 300) {
      activeScrollTarget = target;
    }
  } else {
    scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    if (scrollTop > 300) {
      activeScrollTarget = window;
    }
  }

  const nextVisible = scrollTop > 300;
  if (showButton.value !== nextVisible) {
    showButton.value = nextVisible;
  }
}

function scheduleCheckScroll(e?: Event) {
  pendingScrollEvent = e;
  const now = performance.now();
  if (scrollRafId === null && now - lastScrollFrameTime >= 16) {
    lastScrollFrameTime = now;
    checkScroll(e);
  }
  if (scrollRafId !== null || typeof requestAnimationFrame === 'undefined') return;
  scrollRafId = requestAnimationFrame((ts) => {
    scrollRafId = null;
    lastScrollFrameTime = ts;
    const latest = pendingScrollEvent;
    pendingScrollEvent = undefined;
    checkScroll(latest);
  });
}

function scrollToTop() {
  if (activeScrollTarget && 'scrollTo' in activeScrollTarget) {
    try {
      activeScrollTarget.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    } catch {
      (activeScrollTarget as HTMLElement).scrollTop = 0;
    }
  } else {
    try {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    } catch {
      window.scrollTo(0, 0);
    }
  }

  const selectors = '[data-resource-scroll-root], .custom-scrollbar, .feed-scroll-container, .page-container, .user-page-wrapper, .discover-scroll-container, .feed-detail-page, .downloads-page, main.app-main-content';
  const scrollables = document.querySelectorAll<HTMLElement>(selectors);
  let scrolledFound = false;

  scrollables.forEach((el) => {
    if (el.scrollTop > 0) {
      scrolledFound = true;
      try {
        el.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        el.scrollTop = 0;
      }
    }
  });

  if (!scrolledFound) {
    const allScrollables = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
      (el) => el.scrollTop > 0 && el.scrollHeight > el.clientHeight
    );
    allScrollables.forEach((el) => {
      try {
        el.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        el.scrollTop = 0;
      }
    });
  }
}

onMounted(() => {
  window.addEventListener('scroll', scheduleCheckScroll, { capture: true, passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', scheduleCheckScroll, true);
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId);
    scrollRafId = null;
  }
  pendingScrollEvent = undefined;
});
</script>

<style scoped>
.scroll-to-top-nav-btn:hover {
  color: var(--brand-primary, #10b981);
}

.back-to-top-btn {
  position: fixed;
  bottom: 28px;
  right: 28px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--surface, #ffffff);
  color: var(--brand-primary, #10b981);
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.08));
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 990;
  will-change: transform, opacity;
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease, background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.back-to-top-btn:hover {
  transform: translate3d(0, -3px, 0) scale(1.08);
  background: var(--brand-primary, #10b981);
  color: #ffffff;
  box-shadow: 0 10px 24px rgba(16, 185, 129, 0.35);
  border-color: transparent;
}

.icon {
  font-size: 16px;
}

.tooltip-text {
  position: absolute;
  right: 52px;
  background: rgba(0, 0, 0, 0.75);
  color: #ffffff;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.back-to-top-btn:hover .tooltip-text {
  opacity: 1;
}

/* 动画过渡 */
.back-to-top-fade-enter-active,
.back-to-top-fade-leave-active {
  will-change: transform, opacity;
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease;
}

.back-to-top-fade-enter-from,
.back-to-top-fade-leave-to {
  opacity: 0;
  transform: translate3d(0, 20px, 0) scale3d(0.6, 0.6, 1);
}
</style>
