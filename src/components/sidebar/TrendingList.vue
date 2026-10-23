<template>
  <div class="sidebar-card">
    <div class="card-header">
      <h3 class="card-title">{{ currentPeriod.title }}</h3>
      <div class="rank-controls">
      <button class="refresh-btn period-prev" title="上一个热榜" aria-label="上一个热榜" @click="switchPeriod(-1)"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
      <button class="refresh-btn period-next" title="下一个热榜" aria-label="下一个热榜" @click="switchPeriod(1)"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
      <button class="refresh-btn" :title="`刷新${currentPeriod.title}`" @click="fetchHot">
        <i class="fas fa-sync-alt"></i>
      </button>
      </div>
    </div>

    <div class="card-body custom-scrollbar">
      <div v-if="loading" class="loading-wrapper">
        <LoadingState text="正在获取热榜" />
      </div>
      <div v-else-if="error" class="empty-wrapper"><ErrorState title="热榜加载失败" :message="error" @retry="fetchHot" /></div>
      <div v-else-if="items.length === 0" class="empty-wrapper">
        <EmptyState title="暂无热榜" />
      </div>
      <div v-else class="trending-list">
        <div
          v-for="(item, index) in items.slice(0, 5)"
          :key="item.id || index"
          class="trending-item"
          @click="openFeed(item)"
        >
          <span :class="['rank-num', `rank-${index + 1}`]">{{ index + 1 }}</span>
          <div class="item-info">
            <span class="item-title">{{ item.title || item.message || '热榜动态' }}</span>
            <span class="item-meta">{{ item.replynum || 0 }} 评论 · {{ item.likenum || 0 }} 点赞</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../../api/coolapk';
import LoadingState from '../common/LoadingState.vue';
import EmptyState from '../common/EmptyState.vue';
import ErrorState from '../common/ErrorState.vue';
import { useSettingsStore } from '../../stores/settings';
import { hasFeedRenderableContent } from '../../utils/feedFilter';
import { openFeedDetail } from '../../utils/feedNavigation';

const router = useRouter();
const loading = ref(false);
const items = ref<any[]>([]);
const error = ref('');
const settings = useSettingsStore();
const periods = [{ key: 'day', title: '今日热榜' }, { key: 'week', title: '本周热榜' }, { key: 'month', title: '本月热榜' }] as const;
const currentPeriod = computed(() => periods.find(period => period.key === settings.settings.homeSidebarRankPeriod) || periods[0]);
let sequence = 0;

/** 保存到统一设置，重建右栏或重启应用后仍恢复用户选中的时间范围。 */
function switchPeriod(direction: number) {
  const index = periods.findIndex(period => period.key === currentPeriod.value.key);
  settings.settings.homeSidebarRankPeriod = periods[(index + direction + periods.length) % periods.length].key;
}

async function fetchHot() {
  const request = ++sequence;
  const period = currentPeriod.value.key;
  loading.value = true;
  error.value = '';
  items.value = [];
  try {
    // 今日沿用官方今日热门参数；周榜、月榜复用现有统计接口。
    const res = period === 'day'
      ? await CoolapkTauriAPI.getDiscoveryPageData({ url: '#/feed/statList?cacheExpires=300&statType=day&sortField=rank_score&filterRepeatQuestionAnswer=true&replyRowsLimit=1', title: '今日热榜', page: 1 })
      : await CoolapkTauriAPI.getRankFeeds(period, 1);
    if (request !== sequence) return;
    if (res && res.data) {
      items.value = res.data.filter(hasFeedRenderableContent);
    }
  } catch (err) {
    if (request === sequence) error.value = err instanceof Error ? err.message : '请稍后重试';
  } finally {
    if (request === sequence) loading.value = false;
  }
}

function openFeed(item: any) {
  if (item && item.id) {
    openFeedDetail(router, item.id, item);
  }
}

watch(() => settings.settings.homeSidebarRankPeriod, fetchHot, { immediate: true });
onUnmounted(() => { sequence += 1; });
</script>

<style scoped>
.sidebar-card {
  background-color: var(--surface);
  border-radius: var(--radius-card);
  border: 1px solid var(--border);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
  overflow: hidden;
  min-width: 0;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.card-title {
  margin: 0;
  font-size: 17px;
  line-height: 22px;
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.refresh-btn {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 4px;
  border-radius: var(--radius-xs);
  transition: color var(--duration-fast) var(--ease-default);
}

.rank-controls { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
.rank-controls button:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 2px; }

.refresh-btn:hover {
  color: var(--brand-primary);
}

.trending-list {
  display: flex;
  flex-direction: column;
}

.trending-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 46px;
  cursor: pointer;
  padding: 4px 0;
  transition: opacity var(--duration-fast) var(--ease-default);
}

.trending-item:hover {
  opacity: 0.8;
}

.rank-num {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-tertiary);
  width: 18px;
  height: 18px;
  border-radius: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background-color: transparent;
}

.rank-1 {
  color: #ff4757;
}

.rank-2 {
  color: #ffa502;
}

.rank-3 {
  color: #f5bd2e;
}

.item-info {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

.item-title {
  font-size: 15px;
  line-height: 20px;
  color: var(--text-primary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  font-size: 12px;
  line-height: 18px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
</style>
