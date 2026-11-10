<template>
  <AppDialog :is-open="true" :title="filterLabel ? `${filterLabel}的评论` : '搜索评论'" :width="640" @close="$emit('close')">
    <div class="reply-search-bar">
      <i class="fas fa-search" aria-hidden="true"></i>
      <input ref="input" v-model.trim="query" type="search" placeholder="搜索评论正文或昵称" aria-label="搜索评论正文或昵称" />
    </div>
    <div class="reply-search-scope">
      <span role="status">{{ status }}</span>
      <button v-if="canLoadAll && !complete" type="button" :disabled="loading" @click="loadAll">{{ error ? '重试' : '搜索全部评论' }}</button>
    </div>
    <p v-if="error" class="reply-search-empty" role="alert">{{ error }}</p>
    <ul v-if="results.length" class="reply-search-results">
      <li v-for="row in visibleResults" :key="row.id">
        <button type="button" @click="$emit('select', row.id)">
          <strong>{{ row.name || '酷友' }}</strong>
          <span>{{ row.text || '图片评论' }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="query || filterLabel" class="reply-search-empty">没有匹配的评论</p>
    <button v-if="visibleResults.length < results.length" type="button" class="reply-search-more" @click="limit += 40">显示更多</button>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { FeedItem } from '../../types/feed';
import { getReplyEntityId, mergeReplies } from '../../utils/commentList';
import { loadStatisticsReplies } from '../../utils/feedStatistics';
import { htmlToPlainText } from '../../utils/htmlText';
import AppDialog from '../common/AppDialog.vue';

const props = defineProps<{ feed: FeedItem; replies: any[]; canLoadAll?: boolean; filterLabel?: string }>();
defineEmits<{ close: []; select: [replyId: string] }>();

const input = ref<HTMLInputElement>();
const query = ref('');
const limit = ref(40);
const loaded = shallowRef<any[]>([]);
const loading = ref(false);
const complete = ref(false);
const error = ref('');
const controller = new AbortController();

// 评论正文可能含链接和表情标记，搜索与预览统一使用可见文字。
function plainText(value: unknown) {
  return htmlToPlainText(String(value ?? ''), true, ' ').replace(/\s+/g, ' ').trim();
}

const rows = computed(() => mergeReplies(props.replies, loaded.value).flatMap(reply => {
  const id = getReplyEntityId(reply);
  if (!id) return [];
  return [{ id, name: String(reply.username || reply.fromUserName || reply.userInfo?.username || ''), text: plainText(reply.message) }];
}));
const terms = computed(() => query.value.toLowerCase().split(/\s+/).filter(Boolean));
const results = computed(() => terms.value.length || props.filterLabel ? rows.value.filter(row => terms.value.every(term => `${row.name} ${row.text}`.toLowerCase().includes(term))) : []);
const visibleResults = computed(() => results.value.slice(0, limit.value));
const status = computed(() => loading.value
  ? `正在补齐评论 · 已读取 ${rows.value.length} 条`
  : `${complete.value ? '全部评论' : '已加载评论'} · ${query.value ? `${results.value.length} 条匹配` : `${rows.value.length} 条`}`);

watch(query, () => { limit.value = 40; });
onMounted(async () => { await nextTick(); input.value?.focus(); });
onUnmounted(() => controller.abort());

async function loadAll() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    await loadStatisticsReplies(props.feed, controller.signal, replies => { loaded.value = replies; });
    if (!controller.signal.aborted) complete.value = true;
  } catch (reason) {
    if (!controller.signal.aborted) error.value = reason instanceof Error ? reason.message : '评论加载失败';
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
</script>

<style scoped>
.reply-search-bar { display: flex; align-items: center; gap: 10px; padding-inline: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-hover); color: var(--text-secondary); }
.reply-search-bar:focus-within { border-color: var(--brand-primary); }
.reply-search-bar input { flex: 1; min-width: 0; min-height: 42px; border: 0; outline: none; background: transparent; color: var(--text-primary); font: inherit; }
.reply-search-scope { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; min-height: 42px; color: var(--text-secondary); font-size: 13px; }
.reply-search-scope button, .reply-search-more { min-height: 36px; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text-primary); font: inherit; cursor: pointer; }
.reply-search-scope button:hover, .reply-search-more:hover { background: var(--surface-hover); }
.reply-search-scope button:disabled { opacity: 0.55; cursor: wait; }
.reply-search-results { list-style: none; padding: 0; margin: 0; }
.reply-search-results li { border-top: 1px solid var(--border-light); }
.reply-search-results button { display: grid; gap: 4px; width: 100%; padding: 10px 8px; border: 0; border-radius: 6px; text-align: start; background: transparent; color: var(--text-primary); font: inherit; cursor: pointer; }
.reply-search-results button:hover { background: var(--surface-hover); }
.reply-search-results span { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; color: var(--text-secondary); }
.reply-search-empty { margin: 12px 0; color: var(--text-secondary); }
</style>
