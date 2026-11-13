<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy || !authStore.isLoggedIn }" :class="['page-container', { 'is-embedded': embedded }]" class="custom-scrollbar">
    <div v-if="!embedded" class="page-header">
      <div class="header-main">
        <div class="header-titles">
          <h2 class="page-title"><i class="fas fa-star icon"></i> 我的常去</h2>
          <span class="page-subtitle">同步酷安个人中心“我的卡片”中的常用入口</span>
        </div>
        <AppButton v-if="authStore.isLoggedIn" variant="secondary" size="sm" icon="fas fa-sync-alt" :loading="loading" @click="load(true)">刷新</AppButton>
      </div>
    </div>

    <DemoLoginState v-if="authStore.isWebDemo && !authStore.isLoggedIn" />
    <div v-else-if="!authStore.isLoggedIn" class="empty-wrapper">
      <EmptyState title="登录后查看我的常去" description="登录酷安账号后，此处会读取“我的卡片”中的常用入口" />
      <AppButton variant="primary" size="sm" @click="authStore.openLoginModal()">立即登录</AppButton>
    </div>
    <template v-else>
      <LoadingState v-if="loading && !cards.length" text="正在读取我的常去..." />
      <ErrorState v-else-if="error && !cards.length" title="我的常去加载失败" :message="error" @retry="load(true)" />
      <EmptyState v-else-if="!cards.length" title="暂无我的常去" description="你可以在酷安手机端的“我的卡片”中添加常用入口" />
      <div v-else class="recent-card-grid">
        <button
          v-for="card in cards"
          :key="card.id"
          class="recent-card"
          type="button"
          :disabled="!card.url"
          :title="card.url ? `打开${card.title}` : card.title"
          @click="openCard(card)"
        >
          <div class="recent-card-media">
            <AppImage v-if="card.imageUrl" :src="card.imageUrl" :alt="card.title" image-class="recent-card-image" fit="cover" :hide-spinner="true" />
            <span v-else class="recent-card-fallback" aria-hidden="true"><i class="fas fa-bookmark"></i></span>
          </div>
          <span class="recent-card-title">{{ card.title }}</span>
          <i v-if="card.url" class="fas fa-arrow-up-right-from-square recent-card-action" aria-hidden="true"></i>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import DemoLoginState from '../components/common/DemoLoginState.vue';
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import AppImage from '../components/common/AppImage.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import LoadingState from '../components/common/LoadingState.vue';
import { CoolapkTauriAPI } from '../api/coolapk';
import { useAuthStore } from '../stores/auth';
import { normalizeCoolapkRoute } from '../utils/coolapkRoute';
import { normalizeMyCardsResponse, type MyCard } from '../utils/myCards';

const { embedded = false } = defineProps<{ embedded?: boolean }>();
const router = useRouter();
const authStore = useAuthStore();
const cards = ref<MyCard[]>([]);
const loading = ref(false);
const error = ref('');
let loadSequence = 0;

async function load(refresh = false) {
  const sequence = ++loadSequence;
  if (!authStore.isLoggedIn || !authStore.user?.uid) {
    cards.value = [];
    error.value = '';
    loading.value = false;
    return;
  }
  if (refresh) cards.value = [];
  error.value = '';
  loading.value = true;
  try {
    // 复用酷安个人中心正式的卡片配置接口，不在桌面端写死入口内容。
    const response = await CoolapkTauriAPI.getLoadConfig();
    if (sequence === loadSequence) cards.value = normalizeMyCardsResponse(response);
  } catch (err: any) {
    if (sequence === loadSequence) error.value = err?.message || '加载失败，请检查网络';
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

async function openCard(card: MyCard) {
  const rawUrl = card.url.trim();
  if (!rawUrl) return;
  const localRoute = normalizeCoolapkRoute(rawUrl);
  if (localRoute && router.resolve(localRoute).matched.length > 0) {
    await router.push(localRoute);
    return;
  }
  const targetUrl = rawUrl.startsWith('/') ? `https://www.coolapk.com${rawUrl}` : rawUrl;
  await CoolapkTauriAPI.openUrl(targetUrl, 'internal');
}

watch(
  () => [authStore.isLoggedIn, String(authStore.user?.uid || '')] as const,
  () => { void load(true); },
  { immediate: true },
);

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => loading.value);
async function refreshMobilePage() { await load(true); }
</script>

<style scoped>
.page-container { width: 100%; height: 100%; overflow-y: auto; padding: var(--space-5); box-sizing: border-box; }
.page-container.is-embedded { height: auto; overflow: visible; padding: 0; }
.page-header { margin-bottom: var(--space-5); }
.header-main { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
.header-titles { display: flex; flex-direction: column; gap: 4px; }
.page-title { margin: 0; display: flex; align-items: center; gap: var(--space-3); color: var(--text-primary); font-size: var(--font-size-title-lg); }
.page-title .icon { color: var(--brand-primary); }
.page-subtitle { color: var(--text-tertiary); font-size: var(--font-size-sub); }
.empty-wrapper { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); padding: var(--space-10) 0; }
.recent-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-4); padding: var(--space-4); }
.recent-card { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: var(--space-3); min-height: 170px; overflow: hidden; padding: 0 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-card); background: var(--surface); color: var(--text-primary); text-align: left; cursor: pointer; transition: border-color var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default); }
.recent-card:hover:not(:disabled) { border-color: var(--brand-primary); box-shadow: var(--shadow-sm); transform: translateY(-2px); }
.recent-card:disabled { cursor: default; opacity: 0.65; }
.recent-card-media { display: flex; align-items: center; justify-content: center; width: 100%; height: 108px; overflow: hidden; background: var(--background-secondary, #f3f4f6); }
.recent-card-image, .recent-card-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.recent-card-image :deep(img) { width: 100%; height: 100%; }
.recent-card-fallback { color: var(--brand-primary); font-size: 30px; }
.recent-card-title { display: block; overflow: hidden; padding: 0 var(--space-3); font-size: var(--font-size-sub); font-weight: var(--font-weight-semibold); text-overflow: ellipsis; white-space: nowrap; }
.recent-card-action { position: absolute; right: var(--space-3); bottom: var(--space-3); color: var(--text-tertiary); font-size: 11px; }
@media (max-width: 700px) { .recent-card-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); } }
</style>
