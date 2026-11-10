<template>
  <AppDialog :is-open="!commentFilter" title="动态统计" :width="1120" keep-content @close="$emit('close')">
    <div class="stats-overview">
      <p class="stats-author">
        <strong>{{ feed.username || feed.userInfo?.username || '发布者' }}</strong>
        <span>{{ statisticsLevel(feed) }} · {{ displayDeviceName(statisticsDevice(feed)) }}</span>
      </p>
      <dl class="stats-summary">
        <div><dd>{{ formatNumber(replies.length) }}</dd><dt>条评论</dt></div>
        <div><dd>{{ formatNumber(participantCount) }}</dd><dt>位评论者</dt></div>
        <div><dd>{{ formatNumber(modelCount) }}</dd><dt>种机型</dt></div>
      </dl>
    </div>

    <div v-if="error" class="stats-status" role="alert">
      <span>评论加载中断，已保留部分数据。{{ error }}</span>
      <button type="button" @click="run">重试</button>
    </div>

    <div class="stats-toolbar">
      <div class="stats-metrics" role="group" aria-label="图表统计口径">
        <button type="button" :aria-pressed="metric === 'people'" @click="metric = 'people'">按人数</button>
        <button type="button" :aria-pressed="metric === 'entries'" @click="metric = 'entries'">按评论数</button>
      </div>
      <p v-if="loading" class="stats-status" role="status">正在补齐评论…</p>
      <p v-else-if="deviceProgress && deviceProgress.done < deviceProgress.total" class="stats-status" role="status">
        补查缺少机型的评论 {{ deviceProgress.done }} / {{ deviceProgress.total }}
      </p>
    </div>

    <div class="stats-charts">
      <FeedStatisticsChart
        title="等级分布"
        :unit="unit"
        :rows="levels.rows"
        :unknown="levels.unknown"
        :empty-text="replies.length ? '暂未识别到评论者等级' : '暂无评论'"
        @show-replies="label => commentFilter = { kind: 'level', label }"
      />
      <section class="device-ranking" aria-label="机型排行">
        <header>
          <h4>机型排行</h4>
          <span v-if="devices.unknown">未知 {{ formatNumber(devices.unknown) }} {{ unit }}</span>
        </header>
        <ol v-if="devices.rows.length" class="device-ranks">
          <li v-for="(row, index) in visibleDevices" :key="row.label">
            <button type="button" class="device-rank-link" :aria-label="`查看 ${row.label} 的评论`" @click="commentFilter = { kind: 'device', label: row.label }">
            <span class="device-rank-number" aria-hidden="true">#{{ index + 1 }}</span>
            <div class="device-rank-model">
              <span>{{ row.label }}</span>
              <div class="device-rank-track" aria-hidden="true">
                <div class="device-rank-bar" :style="{ width: `${(row.value / deviceRankMax) * 100}%` }" />
              </div>
            </div>
            <strong>{{ formatNumber(row.value) }}<small>{{ unit }}</small></strong>
            </button>
          </li>
        </ol>
        <p v-else class="device-rank-empty">{{ deviceEmptyText }}</p>
        <button v-if="devices.rows.length > DEVICE_RANK_LIMIT" type="button" class="device-rank-more" :aria-expanded="showAllDevices" @click="showAllDevices = !showAllDevices">
          {{ showAllDevices ? '收起排行' : `查看全部 ${formatNumber(devices.rows.length)} 种机型` }}
        </button>
      </section>
    </div>
  </AppDialog>
  <FeedCommentSearchDialog v-if="commentFilter" :feed="feed" :replies="filteredReplies" :filter-label="commentFilter.label" @close="commentFilter = undefined" @select="openReply" />
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import type { FeedItem } from '../../types/feed';
import { useDeviceModelNames } from '../../utils/deviceModelNames';
import { groupStatistics, loadStatisticsDevices, loadStatisticsReplies, statisticsDevice, statisticsLevel, statisticsUid } from '../../utils/feedStatistics';
import AppDialog from '../common/AppDialog.vue';
import FeedStatisticsChart from './FeedStatisticsChart.vue';
import FeedCommentSearchDialog from './FeedCommentSearchDialog.vue';

const props = defineProps<{ feed: FeedItem }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();

const formatNumber = new Intl.NumberFormat('zh-CN').format;
const displayDeviceName = useDeviceModelNames();
const replies = shallowRef<any[]>([]);
const commentFilter = ref<{ kind: 'level' | 'device'; label: string }>();
const filteredReplies = computed(() => {
  const filter = commentFilter.value;
  if (!filter) return [];
  return replies.value.filter(item => (filter.kind === 'level' ? statisticsLevel(item) : displayDeviceName(statisticsDevice(item))) === filter.label);
});

async function openReply(replyId: string) {
  await router.push({ name: 'FeedDetail', params: { feedId: String(props.feed.id) }, query: { replyId } });
  emit('close');
}
const loading = ref(false);
const deviceProgress = ref<{ done: number; total: number }>();
const error = ref('');
const metric = ref<'people' | 'entries'>('people');
const DEVICE_RANK_LIMIT = 8;
const showAllDevices = ref(false);
const unit = computed(() => metric.value === 'people' ? '人' : '条');
let controller: AbortController | undefined;

const participantCount = computed(() => new Set(replies.value.map(statisticsUid).filter(Boolean)).size);
// 先按评论区的规则转换，再分组，避免同一机型的不同型号重复上榜。
const deviceGroups = computed(() => groupStatistics(replies.value, item => displayDeviceName(statisticsDevice(item))));
const levelGroups = computed(() => groupStatistics(replies.value, statisticsLevel));
const modelCount = computed(() => deviceGroups.value.filter(row => row.label !== '未知').length);
const deviceEmptyText = computed(() => {
  if (loading.value || (deviceProgress.value && deviceProgress.value.done < deviceProgress.value.total)) return '正在识别评论机型…';
  return replies.value.length ? '评论详情暂未提供可用机型' : '暂无评论';
});

function valueFor(row: ReturnType<typeof groupStatistics>[number]) {
  return metric.value === 'people' ? row.users.size : row.count;
}

const levels = computed(() => {
  const known = new Map<number, number>();
  let unknown = 0;
  for (const row of levelGroups.value) {
    const match = /^Lv\.(\d{1,2})$/.exec(row.label);
    if (match) known.set(Number(match[1]), valueFor(row));
    else unknown += valueFor(row);
  }
  const start = known.has(0) ? 0 : 1;
  const end = Math.max(start - 1, ...known.keys());
  // 补零让横轴保持等级顺序，缺档可以直接从折线读出。
  const rows = Array.from({ length: end - start + 1 }, (_, index) => ({
    label: `Lv.${start + index}`,
    value: known.get(start + index) ?? 0,
  }));
  return { rows, unknown };
});

const devices = computed(() => ({
  unknown: deviceGroups.value.filter(row => row.label === '未知').reduce((sum, row) => sum + valueFor(row), 0),
  rows: deviceGroups.value
    .filter(row => row.label !== '未知')
    .map(row => ({ label: row.label, value: valueFor(row) }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'zh-CN')),
}));
const deviceRankMax = computed(() => Math.max(1, devices.value.rows[0]?.value ?? 0));
const visibleDevices = computed(() => showAllDevices.value ? devices.value.rows : devices.value.rows.slice(0, DEVICE_RANK_LIMIT));

async function run() {
  controller?.abort();
  const signal = (controller = new AbortController()).signal;
  loading.value = true;
  error.value = '';
  deviceProgress.value = undefined;
  try {
    await loadStatisticsReplies(props.feed, signal, rows => { replies.value = rows; });
  } catch (reason) {
    if (signal.aborted) return;
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
  if (signal.aborted) return;
  loading.value = false;
  await loadStatisticsDevices(replies.value, signal, (rows, done, total) => {
    replies.value = rows;
    deviceProgress.value = { done, total };
  });
}

onUnmounted(() => controller?.abort());
void run();
</script>

<style scoped>
.stats-overview { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px 20px; padding-bottom: 12px; border-bottom: 1px solid var(--border-light); }
.stats-author, .stats-summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin: 0; font-size: 13px; }
.stats-author { overflow-wrap: anywhere; }
.stats-author span, .stats-status, .stats-summary dt { color: var(--text-secondary); }
.stats-summary { gap: 4px 14px; }
.stats-summary div { display: inline-flex; align-items: baseline; gap: 4px; white-space: nowrap; }
.stats-summary dd { margin: 0; font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; }
.stats-status { margin: 10px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.stats-status button { margin-inline-start: 8px; }
.stats-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 14px; margin: 12px 0 16px; }
.stats-toolbar .stats-status { margin: 0; font-variant-numeric: tabular-nums; }
.stats-metrics { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px; background: var(--background-secondary); }
button { min-height: 36px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.stats-metrics button { border-color: transparent; background: transparent; }
.stats-metrics button[aria-pressed="true"] { background: var(--surface); border-color: var(--border); font-weight: 600; }
.stats-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 24px 32px; align-items: start; }
.device-ranking { min-width: 0; }
.device-ranking header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.device-ranking h4 { margin: 0; font-size: 15px; font-weight: 650; }
.device-ranking header span, .device-rank-number, .device-rank-empty, .device-ranks small { color: var(--text-secondary); }
.device-ranking header span { flex-shrink: 0; font-size: 13px; }
.device-ranks { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.device-ranks .device-rank-link { display: grid; grid-template-columns: 2.75em minmax(0, 1fr) 5.5em; align-items: baseline; gap: 8px; width: 100%; min-height: 40px; padding: 4px 6px; border: 0; text-align: start; font-size: 13px; font-variant-numeric: tabular-nums; }
.device-rank-link:hover { background: var(--surface-hover); }
.device-ranks strong { text-align: right; white-space: nowrap; }
.device-ranks small { margin-inline-start: 3px; font-size: inherit; font-weight: normal; }
.device-rank-model { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.device-rank-track { height: 7px; overflow: hidden; border-radius: 4px; background: var(--background-secondary); }
.device-rank-bar { height: 100%; border-radius: inherit; background: var(--info); transition: width 180ms ease-out; }
.device-rank-empty { margin: 0; padding: 22px 14px; border-radius: 8px; background: var(--background-secondary); font-size: 13px; }
.device-rank-more { margin-top: 12px; }
@media (prefers-reduced-motion: reduce) { .device-rank-bar { transition: none; } }
</style>
