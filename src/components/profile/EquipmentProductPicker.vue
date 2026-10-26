<template>
  <AppDialog :is-open="Boolean(windowLabel)" title="添加产品" :width="600" @close="close">
    <form class="equipment-search" @submit.prevent="search(true)">
      <input v-model="query" aria-label="搜索产品" placeholder="输入产品名称，例如手机、平板、耳机型号" :disabled="selecting" />
      <AppButton type="submit" :loading="loading" :disabled="selecting || !query.trim()">搜索</AppButton>
    </form>
    <p v-if="error" class="picker-error" role="alert">{{ error }}</p>
    <div class="equipment-results custom-scrollbar">
      <button v-for="product in products" :key="product.id" type="button" class="equipment-result" :disabled="selecting" @click="select(product.id)">
        <AppImage class="product-image" :src="product.image" :alt="product.name" fit="contain" />
        <span>{{ product.name }}</span><i class="fas fa-plus"></i>
      </button>
      <EmptyState v-if="!products.length && !loading" :title="searched ? '没有找到相关产品' : '搜索要添加的产品'" />
    </div>
    <AppButton v-if="hasMore" variant="ghost" :loading="loading" :disabled="selecting" @click="search(false)">加载更多</AppButton>
    <p class="picker-hint">选择后返回装备编辑页，点击“完成”保存。</p>
  </AppDialog>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { CoolapkTauriAPI } from '../../api/coolapk';
import AppDialog from '../common/AppDialog.vue';
import AppButton from '../common/AppButton.vue';
import AppImage from '../common/AppImage.vue';
import EmptyState from '../common/EmptyState.vue';
import { getDigitalProductId, getDigitalProductImage, getDigitalProductTitle, isDigitalProduct } from '../../utils/digitalProduct';
import type { DiscoveryEntity } from '../../types/discovery';

const windowLabel = ref('');
const query = ref('');
const error = ref('');
const loading = ref(false);
const selecting = ref(false);
const searched = ref(false);
const products = ref<{ id: string; name: string; image: string }[]>([]);
const hasMore = ref(false);
let page = 1;
let appliedQuery = '';
let lastItem = '';
let sequence = 0;
let disposed = false;
let unlisten: UnlistenFn | undefined;

function close() {
  if (selecting.value) return;
  sequence++;
  windowLabel.value = '';
  loading.value = false;
}

onMounted(() => {
  void listen<{ windowLabel: string }>('equipment-product-picker', event => {
    const target = event.payload?.windowLabel;
    if (selecting.value || typeof target !== 'string' || !/^browser_window_\d+$/.test(target)) return;
    sequence++;
    windowLabel.value = target;
    query.value = '';
    error.value = '';
    products.value = [];
    searched.value = false;
    hasMore.value = false;
    loading.value = false;
    page = 1;
    lastItem = '';
  }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
});
onUnmounted(() => { disposed = true; sequence++; unlisten?.(); });

async function search(reset: boolean) {
  if (loading.value || selecting.value || !windowLabel.value) return;
  if (reset) {
    appliedQuery = query.value.trim();
    if (!appliedQuery) return;
    page = 1;
    lastItem = '';
    products.value = [];
    hasMore.value = false;
  }
  const attempt = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const response: any = await CoolapkTauriAPI.searchByType({ searchType: 'product', query: appliedQuery, page, lastItem });
    if (attempt !== sequence) return;
    if (!Array.isArray(response?.data)) throw new Error(response?.message || '服务端未返回产品搜索结果');
    const incoming: typeof products.value = [];
    const collect = (rows: unknown) => {
      if (!Array.isArray(rows)) return;
      for (const value of rows) {
        if (!value || typeof value !== 'object') continue;
        const entity = value as DiscoveryEntity;
        if (Array.isArray(entity.entities)) collect(entity.entities);
        else if (isDigitalProduct(entity)) {
          const id = getDigitalProductId(entity);
          const name = getDigitalProductTitle(entity);
          if (/^\d+$/.test(id) && name) incoming.push({ id, name, image: getDigitalProductImage(entity) });
        }
      }
    };
    collect(response?.data);
    const ids = new Set(products.value.map(product => product.id));
    const unique = incoming.filter(product => { if (ids.has(product.id)) return false; ids.add(product.id); return true; });
    products.value.push(...unique);
    hasMore.value = unique.length > 0;
    lastItem = incoming[incoming.length - 1]?.id || lastItem;
    page++;
    searched.value = true;
  } catch (err: any) {
    if (attempt === sequence) error.value = err?.message || String(err || '搜索产品失败');
  } finally {
    if (attempt === sequence) loading.value = false;
  }
}

async function select(productId: string) {
  if (selecting.value || !windowLabel.value) return;
  selecting.value = true;
  error.value = '';
  try {
    await CoolapkTauriAPI.selectEquipmentProduct(windowLabel.value, productId);
    windowLabel.value = '';
    sequence++;
  } catch (err: any) {
    error.value = err?.message || String(err || '添加产品失败');
  } finally {
    selecting.value = false;
  }
}
</script>

<style scoped>
.equipment-search { display: flex; gap: var(--space-2); }
.equipment-search input { flex: 1; min-width: 0; background: var(--surface); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-control); padding: var(--space-2); }
.equipment-results { max-height: 55vh; overflow-y: auto; margin-top: var(--space-3); }
.equipment-result { display: flex; align-items: center; gap: var(--space-3); width: 100%; text-align: left; padding: var(--space-3); border: 0; border-bottom: 1px solid var(--border); color: var(--text-primary); background: var(--surface); cursor: pointer; }
.equipment-result:hover { background: var(--surface-hover); }
.equipment-result span { flex: 1; overflow-wrap: anywhere; }
.equipment-result i { color: var(--brand-primary); }
.product-image { width: 48px; height: 48px; flex-shrink: 0; }
.picker-hint { color: var(--text-secondary); font-size: var(--font-size-caption); margin-top: var(--space-3); }
.picker-error { color: var(--danger); overflow-wrap: anywhere; }
</style>
