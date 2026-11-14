<template>
  <div class="page-navigation" :class="{ 'is-compact': compact }" role="group" aria-label="页面导航">
    <AppIconButton icon="fas fa-arrow-left" title="后退" aria-label="后退" size="sm" :disabled="!canGoBack" @click="navigateBack(router)" />
    <AppIconButton icon="fas fa-arrow-right" title="前进" aria-label="前进" size="sm" :disabled="!canGoForward" @click="navigateForward(router)" />
    <AppIconButton icon="fas fa-rotate-right" title="刷新当前页面" aria-label="刷新当前页面" size="sm" @click="refreshPageTabGeneration(pageTabsStore.tabs, route)" />
    <span class="back-to-top-control"><BackToTop variant="nav" /></span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIconButton from '../common/AppIconButton.vue';
import BackToTop from '../common/BackToTop.vue';
import { usePageTabsStore } from '../../stores/pageTabs';
import { canNavigateBack, canNavigateForward, navigateBack, navigateForward } from '../../utils/navigation';
import { refreshPageTabGeneration } from '../../utils/pageTabs';

defineProps<{ compact?: boolean }>();

const router = useRouter();
const route = useRoute();
const pageTabsStore = usePageTabsStore();

// 路由历史的目标可能重复指向当前页，这时保持对应的导航按钮禁用。
const canGoBack = computed(() => Boolean(route.fullPath) && canNavigateBack(router) && router.options.history.state.back !== route.fullPath);
const canGoForward = computed(() => Boolean(route.fullPath) && canNavigateForward(router) && router.options.history.state.forward !== route.fullPath);
</script>

<style scoped>
.page-navigation {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  padding: 2px;
  border-radius: var(--radius-control);
}
.back-to-top-control { display: inline-flex; }
@media (max-width: 800px) {
  .page-navigation:not(.is-compact) .back-to-top-control { display: none; }
}
</style>
