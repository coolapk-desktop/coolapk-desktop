<template>
  <div v-pull-refresh="{ refresh: refreshMobileCategory, disabled: directoryLoading || loading }" class="category-browser">
    <LoadingState v-if="directoryLoading" text="正在加载分类…" />
    <ErrorState v-else-if="directoryError" title="分类加载失败" :message="directoryError" @retry="loadDirectory" />
    <EmptyState v-else-if="!categories.length" title="暂无分类" />
    <template v-else>
      <nav class="category-directory custom-scrollbar" aria-label="数码分类">
        <div v-for="(parent, index) in categories" :key="getEntityKey(parent, index)">
          <button type="button" :class="{ active: selectedParent === parent }" :aria-pressed="selectedParent === parent" @click="selectParent(parent)">
            <AppImage v-if="getEntityImage(parent)" :src="getEntityImage(parent)" fit="contain" />
            <span>{{ parent.title }}</span>
          </button>
          <div v-if="selectedParent === parent && children(parent).length" class="category-children">
            <button v-for="(child, childIndex) in children(parent)" :key="getEntityKey(child, childIndex)" type="button" :class="{ active: selected === child }" :aria-pressed="selected === child" @click="selectCategory(child)">{{ child.title }}</button>
          </div>
        </div>
      </nav>
      <section ref="contentRef" class="category-results custom-scrollbar" @scroll.passive="handleScroll">
        <header><h3>{{ selected?.title }}</h3><div role="group" aria-label="产品显示方式"><button type="button" :aria-pressed="layout === 'grid'" aria-label="网格视图" @click="layout = 'grid'"><i class="fas fa-th-large" /></button><button type="button" :aria-pressed="layout === 'vertical'" aria-label="列表视图" @click="layout = 'vertical'"><i class="fas fa-list" /></button></div></header>
        <LoadingState v-if="loading && !items.length" text="正在加载分类内容…" />
        <ErrorState v-else-if="error && !items.length" title="分类内容加载失败" :message="error" @retry="loadContent" />
        <EmptyState v-else-if="!items.length" title="暂无内容" />
        <div v-else class="category-items" :class="{ 'is-grid': layout === 'grid' }">
          <DiscoveryEntityCard v-for="(item, index) in items" :key="getEntityKey(item, index)" :entity="item" :product-layout="layout" @open="openItem" />
        </div>
        <LoadingState v-if="loading && items.length" text="加载更多…" />
        <button v-else-if="error && items.length" class="load-more" type="button" @click="loadContent">加载失败，点击重试</button>
        <button v-else-if="items.length && !noMore" class="load-more" type="button" @click="loadContent">加载更多</button>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../../directives/pullRefresh';
import { nextTick, onMounted, ref, watch } from 'vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import AppImage from '../common/AppImage.vue';
import LoadingState from '../common/LoadingState.vue';
import ErrorState from '../common/ErrorState.vue';
import EmptyState from '../common/EmptyState.vue';
import DiscoveryEntityCard from '../discovery/DiscoveryEntityCard.vue';
import { getEntityImage, getEntityKey, parseDiscoveryPage } from '../../utils/discovery';
import type { DiscoveryEntity } from '../../types/discovery';
import { findProductCategory } from '../../utils/productCategory';
import { productSortTarget, markProductSort, replaceSortedProducts } from '../../utils/productSort';

const props = defineProps<{ selectedId?: string }>();
const emit = defineEmits<{ open: [entity: DiscoveryEntity] }>();
const categories = ref<DiscoveryEntity[]>([]);
const selectedParent = ref<DiscoveryEntity>();
const selected = ref<DiscoveryEntity>();
const directoryLoading = ref(false);
const directoryError = ref('');
const contentRef = ref<HTMLElement>();
const items = ref<DiscoveryEntity[]>([]);
const layout = ref<'grid' | 'vertical'>('grid');
const loading = ref(false);
const error = ref('');
const noMore = ref(false);
const sortTarget = ref('');
let revision = 0;
let page = 1;
let firstItem = '';
let lastItem = '';

// ProductBrand.getChildList() maps to secondCategoryRows in the official APK.
function children(parent: DiscoveryEntity): DiscoveryEntity[] {
  return Array.isArray(parent.secondCategoryRows) ? parent.secondCategoryRows : [];
}
function selectParent(parent: DiscoveryEntity) {
  selectedParent.value = parent;
  selectCategory(children(parent)[0] || parent);
}
function selectInitialCategory() {
  const id = props.selectedId;
  const match = id ? findProductCategory(categories.value, id) : undefined;
  const parent = match?.parent || categories.value[0];
  if (!parent) return;
  selectedParent.value = parent;
  selectCategory(match?.category || children(parent)[0] || parent);
}
async function loadDirectory() {
  directoryLoading.value = true;
  directoryError.value = '';
  try {
    const response = await CoolapkTauriAPI.getProductCategoryList();
    categories.value = Array.isArray(response?.data) ? response.data : [];
    selectInitialCategory();
  } catch (failure) {
    directoryError.value = failure instanceof Error ? failure.message : String(failure);
  } finally { directoryLoading.value = false; }
}
function selectCategory(category: DiscoveryEntity) {
  if (selected.value === category && !error.value) return;
  revision++;
  selected.value = category;
  sortTarget.value = '';
  items.value = [];
  loading.value = false;
  error.value = '';
  noMore.value = false;
  page = 1;
  firstItem = lastItem = '';
  if (contentRef.value) contentRef.value.scrollTop = 0;
  void loadContent();
}
async function loadContent() {
  if (!selected.value || loading.value || noMore.value) return;
  const currentRevision = revision;
  const category = selected.value;
  loading.value = true;
  error.value = '';
  try {
    if (!category.url) throw new Error('该分类缺少内容地址');
    const response = await CoolapkTauriAPI.getDiscoveryPageData({ url: sortTarget.value || category.url, title: category.title || '', subTitle: category.subTitle || '', page, firstItem, lastItem });
    if (currentRevision !== revision) return;
    const parsed = parseDiscoveryPage(response, page);
    const keys = new Set(items.value.map((item, index) => getEntityKey(item, index)));
    items.value = sortTarget.value && page === 1
      ? replaceSortedProducts(items.value, parsed.items, sortTarget.value)
      : [...items.value, ...markProductSort(parsed.items, sortTarget.value).filter((item, index) => !keys.has(getEntityKey(item, items.value.length + index)))];
    firstItem = parsed.firstItem;
    lastItem = parsed.lastItem;
    noMore.value = !parsed.items.length || !parsed.hasMore;
    page++;
  } catch (failure) {
    if (currentRevision === revision) error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    if (currentRevision === revision) {
      loading.value = false;
      await nextTick();
      const element = contentRef.value;
      if (!error.value && !noMore.value && element && element.clientHeight > 0 && element.scrollHeight <= element.clientHeight) void loadContent();
    }
  }
}
function handleScroll(event: Event) {
  const element = event.currentTarget as HTMLElement;
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 480) void loadContent();
}
function openItem(entity: DiscoveryEntity) {
  const target = productSortTarget(items.value, entity);
  if (!target) { emit('open', entity); return; }
  if (sortTarget.value === target) return;
  sortTarget.value = target;
  revision++;
  loading.value = false;
  error.value = '';
  noMore.value = false;
  page = 1;
  firstItem = lastItem = '';
  void loadContent();
}
watch(() => props.selectedId, selectInitialCategory);
onMounted(loadDirectory);

async function refreshMobileCategory() {
  if (!selected.value) { await loadDirectory(); return; }
  revision++;
  page = 1; firstItem = lastItem = ''; noMore.value = false;
  await loadContent();
}
</script>

<style scoped>
.category-browser { display: flex; width: 100%; height: 100%; min-height: 0; overflow: hidden; background: var(--background); }
.category-directory { flex: 0 0 176px; overflow-y: auto; background: var(--surface); border-right: 1px solid var(--border); }
.category-directory button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 64px; padding: 12px 16px; color: var(--text-secondary); text-align: left; background: transparent; }
.category-directory :deep(.app-image-container) { flex: 0 0 32px; width: 32px; height: 32px; }
.category-directory button:hover { background: var(--background); }
.category-directory button.active { color: var(--brand-primary); background: var(--background); font-weight: 600; box-shadow: inset 3px 0 var(--brand-primary); }
.category-children button { min-height: 44px; padding-left: 30px; font-size: 12px; }
.category-results { flex: 1; min-width: 0; overflow-y: auto; padding: 16px; }
.category-results header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px; }
.category-results h3 { margin: 0; font-size: 16px; }
.category-results header button { padding: 8px; color: var(--text-secondary); background: transparent; }
.category-results header button[aria-pressed='true'] { color: var(--brand-primary); }
.category-items { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.category-items.is-grid { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
.category-items.is-grid > :deep(:not(.digital-product-card)) { grid-column: 1 / -1; }
.load-more { display: block; margin: 16px auto; padding: 10px; background: transparent; color: var(--brand-primary); }
@media (max-width: 720px) {
  .category-directory { flex-basis: 88px; }
  .category-directory button { flex-direction: column; justify-content: center; gap: 6px; padding: 12px 6px; text-align: center; font-size: 12px; }
  .category-children button { padding: 10px 6px; }
  .category-results { padding: 12px 8px; }
  .category-items.is-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
}
</style>
