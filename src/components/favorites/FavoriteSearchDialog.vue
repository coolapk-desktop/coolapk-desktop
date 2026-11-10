<template>
  <AppDialog :is-open="true" title="搜索全部收藏" :width="720" @close="$emit('close')">
    <label class="favorite-search-field">
      <i class="fas fa-search" aria-hidden="true"></i>
      <input ref="input" v-model.trim="query" type="search" placeholder="搜索标题、正文或作者" aria-label="搜索标题、正文或作者" />
    </label>
    <div class="favorite-search-tools">
      <span role="status">{{ searching ? '正在搜索…' : query ? `${results.length} 条匹配` : '全部收藏单' }}</span>
      <button type="button" :disabled="syncing" @click="sync">{{ syncing ? '正在更新索引…' : '更新收藏索引' }}</button>
    </div>
    <p v-if="notice" class="favorite-search-note" role="status">{{ notice }}</p>
    <p v-if="error" class="favorite-search-note" role="alert">{{ error }}</p>
    <ul v-if="results.length" class="favorite-search-results">
      <li v-for="entry in visibleResults" :key="entry.feedId">
        <button type="button" @click="openResult(entry)">
          <strong>{{ entry.title || entry.author || '收藏动态' }}</strong>
          <span v-if="entry.message" class="favorite-search-preview">{{ preview(entry.message) }}</span>
          <span v-if="entry.collectionTitles?.length || (entry.author && entry.title)" class="favorite-search-source">
            {{ [entry.title ? entry.author : '', ...(entry.collectionTitles ?? [])].filter(Boolean).join(' · ') }}
          </span>
        </button>
      </li>
    </ul>
    <p v-else-if="query && !searching && !error" class="favorite-search-note">索引中没有匹配的内容</p>
    <button v-if="visibleResults.length < results.length" type="button" class="favorite-search-more" @click="limit += 30">显示更多</button>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AppDialog from '../common/AppDialog.vue';
import { searchFavoriteContentIndex, syncFavoriteContentIndex, type FavoriteContentIndexEntry } from '../../utils/favoriteContentIndex';
import { htmlToPlainText } from '../../utils/htmlText';
import { getSearchEntityRoute } from '../../utils/searchEntities';

const props = defineProps<{ accountId: string }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const input = ref<HTMLInputElement>();
const query = ref('');
const limit = ref(30);
const results = ref<FavoriteContentIndexEntry[]>([]);
const visibleResults = computed(() => results.value.slice(0, limit.value));
const searching = ref(false);
const syncing = ref(false);
const error = ref('');
const notice = ref('');
let disposed = false;

function preview(value: string) {
  return htmlToPlainText(value, true, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

// 查询只读本地索引。输入变更或关窗后丢弃旧结果，避免账号和关键词串线。
watch(query, (keyword, _, onCleanup) => {
  let current = true;
  error.value = '';
  results.value = [];
  limit.value = 30;
  searching.value = Boolean(keyword);
  if (!keyword) return;
  const timer = setTimeout(async () => {
    try {
      const entries = await searchFavoriteContentIndex(props.accountId, keyword, Number.MAX_SAFE_INTEGER);
      if (current) results.value = entries;
    } catch {
      if (current) error.value = '读取收藏索引失败';
    } finally {
      if (current) searching.value = false;
    }
  }, 140);
  onCleanup(() => { current = false; clearTimeout(timer); });
});

async function sync() {
  if (syncing.value) return;
  syncing.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await syncFavoriteContentIndex(props.accountId);
    if (disposed) return;
    notice.value = result.complete ? '收藏索引已更新' : '仅更新了可读取的收藏内容';
    const keyword = query.value;
    const entries = await searchFavoriteContentIndex(props.accountId, keyword, Number.MAX_SAFE_INTEGER);
    if (!disposed && keyword === query.value) results.value = entries;
  } catch {
    if (!disposed) notice.value = '更新收藏索引失败，请重试';
  } finally {
    if (!disposed) syncing.value = false;
  }
}

async function openResult(entry: FavoriteContentIndexEntry) {
  await router.push(getSearchEntityRoute(entry.feed) || { name: 'FeedDetail', params: { feedId: entry.feedId } });
  emit('close');
}

onMounted(async () => { await nextTick(); input.value?.focus(); });
onUnmounted(() => { disposed = true; });
</script>

<style scoped>
.favorite-search-field { display: flex; align-items: center; gap: 10px; padding-inline: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-hover); color: var(--text-secondary); }
.favorite-search-field:focus-within { border-color: var(--brand-primary); }
.favorite-search-field input { flex: 1; min-width: 0; min-height: 42px; border: 0; outline: none; background: transparent; color: var(--text-primary); font: inherit; }
.favorite-search-tools { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; min-height: 44px; color: var(--text-secondary); font-size: 13px; }
.favorite-search-tools button, .favorite-search-more { min-height: 36px; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text-primary); font: inherit; cursor: pointer; }
.favorite-search-tools button:hover, .favorite-search-more:hover { background: var(--surface-hover); }
.favorite-search-tools button:disabled { opacity: 0.55; cursor: wait; }
.favorite-search-results { padding: 0; margin: 0; list-style: none; }
.favorite-search-results li { border-top: 1px solid var(--border-light); }
.favorite-search-results button { display: grid; gap: 4px; width: 100%; padding: 11px 8px; border: 0; border-radius: 6px; text-align: start; background: transparent; color: var(--text-primary); font: inherit; overflow-wrap: anywhere; cursor: pointer; }
.favorite-search-results button:hover { background: var(--surface-hover); }
.favorite-search-preview { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; color: var(--text-secondary); }
.favorite-search-source, .favorite-search-note { color: var(--text-secondary); font-size: 13px; }
.favorite-search-note { margin: 10px 0; }
</style>
