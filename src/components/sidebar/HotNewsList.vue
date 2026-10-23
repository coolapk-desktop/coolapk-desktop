<template>
  <section class="sidebar-card hot-news-card">
    <header class="card-header"><h3>热门资讯</h3><button class="refresh-btn" type="button" title="刷新热门资讯" aria-label="刷新热门资讯" @click="fetchNews"><i class="fas fa-sync-alt" aria-hidden="true"></i></button></header>
    <LoadingState v-if="loading" text="正在获取资讯" />
    <ErrorState v-else-if="error" title="资讯加载失败" :message="error" @retry="fetchNews" />
    <EmptyState v-else-if="!items.length" title="暂无热门资讯" />
    <div v-else class="news-list">
      <button v-for="(item, index) in items" :key="String(item.url || index)" type="button" class="news-item" :title="item.title" @click="openNews(item)">
        <AppImage v-if="getEntityImage(item)" :src="getEntityImage(item)" fit="cover" class="news-icon" />
        <span class="news-title">{{ item.title }}</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { useSettingsStore } from '../../stores/settings';
import { getEntityImage, resolveDiscoveryRoute } from '../../utils/discovery';
import type { DiscoveryEntity } from '../../types/discovery';
import AppImage from '../common/AppImage.vue';
import LoadingState from '../common/LoadingState.vue';
import EmptyState from '../common/EmptyState.vue';
import ErrorState from '../common/ErrorState.vue';

const router = useRouter();
const settings = useSettingsStore();
const items = ref<DiscoveryEntity[]>([]);
const loading = ref(false);
const error = ref('');
let sequence = 0;

/** 仅保留官方热榜首页的六条资讯实体，不缓存整页动态或自行生成热搜。 */
async function fetchNews() {
  const request = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const response = await CoolapkTauriAPI.getDiscoveryPageData({ url: 'V9_HOME_TAB_RANKING', title: '热榜', page: 1 });
    if (request !== sequence) return;
    const data: DiscoveryEntity[] = Array.isArray(response?.data) ? response.data : [];
    items.value = data.filter(card => card.entityTemplate === 'iconMiniGridCard').flatMap(card => card.entities || []).filter(item => item.title && item.url).slice(0, 6);
  } catch (cause) {
    if (request === sequence) error.value = cause instanceof Error ? cause.message : '请稍后重试';
  } finally { if (request === sequence) loading.value = false; }
}

function openNews(item: DiscoveryEntity) {
  const route = resolveDiscoveryRoute(item);
  if (!route) return;
  if (route.kind === 'web') void CoolapkTauriAPI.openUrl(route.target, settings.settings.externalLinkMode);
  else if (route.kind === 'native') void router.push(route.target);
  else void router.push({ path: '/page', query: { url: route.target, title: String(item.title || '热门资讯'), renderer: 'discovery' } });
}

onMounted(fetchNews);
onUnmounted(() => { sequence += 1; });
</script>

<style scoped>
.sidebar-card { background: var(--surface); min-width: 0; overflow: hidden; }
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.card-header h3 { margin: 0; font-size: 17px; line-height: 22px; color: var(--text-primary); }
.refresh-btn { border: 0; background: transparent; color: var(--text-tertiary); padding: 4px; cursor: pointer; }
.refresh-btn:hover { color: var(--brand-primary); }
.news-list { display: flex; flex-direction: column; gap: 4px; }
.news-item { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; min-height: 40px; padding: 4px 0; border: 0; background: transparent; text-align: left; color: var(--text-primary); font: inherit; cursor: pointer; }
.news-item:hover { color: var(--brand-primary); }
.news-icon { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 6px; }
.news-title { min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; line-height: 19px; font-size: 13px; overflow-wrap: anywhere; }
button:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: -2px; border-radius: 4px; }
</style>
