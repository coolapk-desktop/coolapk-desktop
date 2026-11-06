<template>
  <nav class="mobile-bottom-nav" aria-label="移动端主导航">
    <button
      v-for="item in leftItems"
      :key="item.path"
      type="button"
      :class="['mobile-nav-item', { active: isActive(item.path) }]"
      :aria-current="isActive(item.path) ? 'page' : undefined"
      @click="activate(item.path)"
    >
      <OfficialNavIcon class="mobile-nav-icon" :route="item.path" :active="isActive(item.path)" />
      <span>{{ item.label }}</span>
    </button>

    <button type="button" class="mobile-publish" aria-label="发布动态" @click="appStore.openPublish">
      <!-- 官方 APK 的 ic_v15_plus。 -->
      <svg class="mobile-publish-icon" viewBox="0 0 15 15" aria-hidden="true">
        <path d="M7.5,0L7.5,0A1.5,1.5 0,0 1,9 1.5L9,13.5A1.5,1.5 0,0 1,7.5 15L7.5,15A1.5,1.5 0,0 1,6 13.5L6,1.5A1.5,1.5 0,0 1,7.5 0z" />
        <path d="M1.5,6L13.5,6A1.5,1.5 0,0 1,15 7.5L15,7.5A1.5,1.5 0,0 1,13.5 9L1.5,9A1.5,1.5 0,0 1,0 7.5L0,7.5A1.5,1.5 0,0 1,1.5 6z" />
      </svg>
    </button>

    <button
      v-for="item in rightItems"
      :key="item.path"
      type="button"
      :class="['mobile-nav-item', { active: isActive(item.path) }]"
      :aria-current="isActive(item.path) ? 'page' : undefined"
      @click="activate(item.path)"
    >
      <OfficialNavIcon class="mobile-nav-icon" :route="item.path" :active="isActive(item.path)" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '../../stores/app';
import { useSettingsStore } from '../../stores/settings';
import OfficialNavIcon from './OfficialNavIcon.vue';
import { activateHomeTab } from '../../utils/homeTab';

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const settingsStore = useSettingsStore();

const leftItems = computed(() => [
  { path: '/', label: '首页' },
  ...(settingsStore.settings.navVisibility?.digital !== false
    ? [{ path: '/digital', label: '数码' }] : []),
]);

const rightItems = computed(() => [
  ...(settingsStore.settings.navVisibility?.discover !== false
    ? [{ path: '/discover', label: '发现' }] : []),
  { path: '/me', label: '我的' },
]);

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/';
  return route.path === path || route.path.startsWith(`${path}/`);
}

/**
 * 「首页」交给共享判据：单击回到顶部，双击回到顶部并刷新当前栏目。
 * 已在首页时 router.push('/') 会被 vue-router 判为重复导航而中止，必须另行接管。
 */
function activate(path: string) {
  if (path === '/') {
    activateHomeTab(router);
    return;
  }
  void router.push(path);
}
</script>

<style scoped>
.mobile-bottom-nav {
  display: none;
}

@media (max-width: 720px) {
  .mobile-bottom-nav {
    --nav-glass-tint: color-mix(in srgb, var(--surface) 55%, transparent);
    --nav-glass-edge: rgba(255, 255, 255, .75);
    --nav-glass-highlight: rgba(255, 255, 255, .42);
    --nav-glass-selection: rgba(255, 255, 255, .4);
    position: absolute;
    bottom: var(--mobile-bottom-nav-offset, 20px);
    /* 左右留白限制可用宽度，导航栏按可见入口数量居中。 */
    left: 20px;
    right: 20px;
    left: max(20px, env(safe-area-inset-left));
    right: max(20px, env(safe-area-inset-right));
    width: fit-content;
    margin-inline: auto;
    border: 1px solid var(--nav-glass-edge);
    border-radius: 40px;
    box-shadow: 0 10px 32px #00000016, 0 2px 8px #00000008, inset 0 1px 0 var(--nav-glass-edge), inset 0 -1px 0 #ffffff30;
    padding: 4px;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 64px);
    flex: 0 0 auto;
    align-items: center;
    min-height: var(--mobile-bottom-nav-height);
    background: var(--surface);
    background: linear-gradient(155deg, var(--nav-glass-highlight), transparent 48%, #ffffff12), var(--nav-glass-tint);
    -webkit-backdrop-filter: blur(22px) saturate(165%);
    backdrop-filter: blur(22px) saturate(165%);
    isolation: isolate;
    z-index: 30;
  }

  .mobile-bottom-nav::before {
    content: '';
    position: absolute;
    inset: 1px;
    border-radius: inherit;
    box-shadow: inset 1px 1px 1px #ffffff70, inset -1px -1px 1px #ffffff20;
    pointer-events: none;
  }

  :global([data-theme="dark"] .mobile-bottom-nav) {
    --nav-glass-tint: color-mix(in srgb, var(--surface) 68%, transparent);
    --nav-glass-edge: rgba(255, 255, 255, .2);
    --nav-glass-highlight: rgba(255, 255, 255, .12);
    --nav-glass-selection: rgba(255, 255, 255, .09);
  }

  .mobile-nav-item,
  .mobile-publish {
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition: transform 180ms ease, color 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
  }

  .mobile-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 0;
    min-height: 48px;
    padding: 3px 2px;
    border-radius: 28px;
    font-size: 11px;
    font-weight: 600;
  }

  .mobile-nav-icon { --official-nav-icon-size: 24px; }

  .mobile-publish-icon {
    width: 15px;
    height: 15px;
    fill: currentColor;
  }

  .mobile-nav-item.active {
    color: var(--brand-primary);
    background: linear-gradient(145deg, var(--nav-glass-selection), transparent), color-mix(in srgb, var(--surface) 28%, transparent);
    box-shadow: inset 0 1px 0 var(--nav-glass-edge), 0 1px 6px #00000008;
  }

  .mobile-publish {
    display: grid;
    place-items: center;
    width: 48px;
    max-width: 100%;
    height: 44px;
    margin: 0 auto;
    border-radius: 28px;
    background: var(--brand-primary);
    background: linear-gradient(145deg, #ffffff36, transparent 55%, #0000000c), var(--brand-primary);
    color: #fff;
    box-shadow: inset 0 1px 1px #ffffff85, inset 0 -1px 1px #00000015, 0 5px 18px color-mix(in srgb, var(--brand-primary) 30%, transparent);
  }

  .mobile-nav-item:active,
  .mobile-publish:active {
    transform: scale(.96);
  }

  .mobile-nav-item:active {
    background: var(--nav-glass-selection);
  }

  .mobile-nav-item:focus-visible,
  .mobile-publish:focus-visible {
    outline: 2px solid var(--brand-primary);
    outline-offset: 2px;
  }

  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .mobile-bottom-nav { background: var(--surface); }
  }

  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .mobile-bottom-nav { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
    .mobile-nav-item.active { background: var(--surface-hover); }
  }

  @media (prefers-reduced-motion: reduce) {
    .mobile-nav-item, .mobile-publish { transition: none; }
    .mobile-nav-item:active, .mobile-publish:active { transform: none; }
  }
}
</style>
