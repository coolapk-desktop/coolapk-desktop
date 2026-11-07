<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy }" class="page-container custom-scrollbar" @scroll="handleScroll">
    <div class="page-header">
      <div class="header-main">
        <button type="button" class="back-button" @click="goBack">
          <i class="fas fa-arrow-left"></i>
          <span>二手市场</span>
        </button>
        <span class="page-subtitle">品牌分类</span>
      </div>
      <span class="route-hint"><i class="fas fa-mobile-alt"></i> 选择品牌后查看闲置型号</span>
    </div>

    <div class="browser-layout">
      <aside class="brand-panel">
        <h3 class="panel-title">品牌</h3>
        <div v-if="brandLoading" class="panel-state"><LoadingState text="正在获取品牌..." /></div>
        <div v-else-if="brandError" class="panel-state"><ErrorState title="品牌加载失败" message="无法获取闲置品牌列表" @retry="loadBrands" /></div>
        <div v-else-if="brands.length === 0" class="panel-state"><EmptyState title="暂无品牌" /></div>
        <nav v-else class="brand-list" aria-label="闲置品牌列表">
          <button v-for="(brand, index) in brands" :key="getEntityKey(brand, index)" type="button" :class="['brand-item', { active: selectedBrandId === brandId(brand) }]" @click="selectBrand(brand)">
            <AppImage v-if="getEntityImage(brand)" :src="getEntityImage(brand)" fit="contain" image-class="brand-logo" />
            <span v-else class="brand-logo-fallback"><i class="fas fa-tags"></i></span>
            <span class="brand-name">{{ entityTitle(brand) || '未命名品牌' }}</span>
            <span v-if="brandCount(brand)" class="brand-count">{{ brandCount(brand) }}</span>
          </button>
        </nav>
      </aside>

      <main class="product-panel">
        <div class="product-toolbar">
          <div>
            <h3>{{ selectedBrand ? entityTitle(selectedBrand) : '请选择品牌' }}</h3>
            <span v-if="selectedBrand">APK 闲置型号列表</span>
          </div>
        </div>

        <div v-if="productLoading && products.length === 0" class="result-state"><DiscoverySkeleton /></div>
        <div v-else-if="productError && products.length === 0" class="result-state"><ErrorState title="型号加载失败" :message="productError" @retry="reloadProducts" /></div>
        <div v-else-if="!selectedBrand" class="result-state"><EmptyState title="选择左侧品牌" description="APK 会按品牌加载对应的闲置型号" /></div>
        <div v-else-if="products.length === 0" class="result-state"><EmptyState title="暂无闲置型号" description="该品牌暂时没有可展示的型号" /></div>
        <div v-else class="product-list">
          <DiscoveryEntityCard v-for="(product, index) in products" :key="getEntityKey(product, index)" :entity="product" :compact="true" @open="openProduct" />
          <div class="pagination-footer">
            <LoadingState v-if="productLoading" text="正在加载更多型号..." />
            <button v-else-if="productError" type="button" class="retry-inline" @click="loadProducts(true)">加载失败，点击重试</button>
            <span v-else-if="productNoMore" class="no-more">没有更多型号了</span>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import AppImage from '../components/common/AppImage.vue';
import LoadingState from '../components/common/LoadingState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import DiscoveryEntityCard from '../components/discovery/DiscoveryEntityCard.vue';
import DiscoverySkeleton from '../components/discovery/DiscoverySkeleton.vue';
import { getEntityImage, getEntityKey, parseDiscoveryPage, resolveDiscoveryRoute } from '../utils/discovery';
import { normalizeCoolapkRoute } from '../utils/coolapkRoute';
import type { DiscoveryEntity } from '../types/discovery';

const router = useRouter();
const brands = ref<DiscoveryEntity[]>([]);
const selectedBrand = ref<DiscoveryEntity | null>(null);
const brandLoading = ref(false);
const brandError = ref(false);
const products = ref<DiscoveryEntity[]>([]);
const productLoading = ref(false);
const productError = ref('');
const productNoMore = ref(false);
const productPage = ref(1);
const firstItem = ref('');
const lastItem = ref('');
const selectionVersion = ref(0);
let loadingSelectionVersion = -1;

const selectedBrandId = computed(() => selectedBrand.value ? brandId(selectedBrand.value) : '');

function responseList(response: unknown): DiscoveryEntity[] {
  if (Array.isArray(response)) return response.filter(Boolean) as DiscoveryEntity[];
  if (response && typeof response === 'object' && Array.isArray((response as { data?: unknown }).data)) return (response as { data: unknown[] }).data.filter(Boolean) as DiscoveryEntity[];
  return [];
}

function entityTitle(entity: DiscoveryEntity | null): string {
  if (!entity) return '';
  return String(entity.title || entity.name || entity.label || '').trim();
}

function brandId(entity: DiscoveryEntity): string {
  return String(entity.id ?? entity.entityId ?? entity.url ?? entity.title ?? '').trim();
}

function brandCount(entity: DiscoveryEntity): string {
  const value = entity.productNum ?? entity.product_num ?? entity.seriesNum ?? entity.series_num;
  return value === undefined || value === null || value === '' ? '' : String(value);
}

function resetProducts() {
  selectionVersion.value += 1;
  products.value = [];
  productError.value = '';
  productNoMore.value = false;
  productPage.value = 1;
  firstItem.value = '';
  lastItem.value = '';
}

async function loadBrands() {
  brandLoading.value = true;
  brandError.value = false;
  try {
    const response = await CoolapkTauriAPI.getSecondHandBrandList();
    brands.value = responseList(response).filter((item) => brandId(item));
    const next = brands.value.find((item) => brandId(item) === selectedBrandId.value) || brands.value[0] || null;
    selectedBrand.value = next;
    resetProducts();
    if (next) void loadProducts(false, selectionVersion.value);
  } catch (error) {
    brandError.value = true;
    console.warn('加载闲置品牌失败', error);
  } finally {
    brandLoading.value = false;
  }
}

function selectBrand(brand: DiscoveryEntity) {
  if (selectedBrand.value && brandId(selectedBrand.value) === brandId(brand) && products.value.length > 0) return;
  selectedBrand.value = brand;
  resetProducts();
  void loadProducts(false, selectionVersion.value);
}

function normalizeProduct(entity: DiscoveryEntity): DiscoveryEntity {
  const type = `${String(entity.entityType || '').toLowerCase()} ${String(entity.entityTemplate || '').toLowerCase()}`;
  if (type.includes('title') || type.includes('more') || type.includes('group')) return entity;
  return { ...entity, brandId: entity.brandId ?? entity.brand_id ?? selectedBrandId.value, entityTemplate: 'ershouProduct' };
}

function appendProducts(incoming: DiscoveryEntity[]) {
  const existingKeys = new Set(products.value.map((item, index) => getEntityKey(item, index)));
  const normalized = incoming.map(normalizeProduct);
  products.value = [...products.value, ...normalized.filter((item, index) => !existingKeys.has(getEntityKey(item, products.value.length + index)))];
}

async function loadProducts(isLoadMore = false, expectedSelectionVersion = selectionVersion.value) {
  const selection = selectedBrand.value;
  if (!selection || expectedSelectionVersion !== selectionVersion.value) return;
  if (productLoading.value && loadingSelectionVersion === expectedSelectionVersion) return;
  if (productNoMore.value) return;
  productLoading.value = true;
  productError.value = '';
  loadingSelectionVersion = expectedSelectionVersion;
  try {
    const response = await CoolapkTauriAPI.getSecondHandProductList(brandId(selection), String(selection.type || 'recommend'), productPage.value, { firstItem: firstItem.value, lastItem: lastItem.value });
    if (expectedSelectionVersion !== selectionVersion.value || selection !== selectedBrand.value) return;
    const parsed = parseDiscoveryPage(response, productPage.value);
    if (isLoadMore) appendProducts(parsed.items);
    else products.value = parsed.items.map(normalizeProduct);
    firstItem.value = parsed.firstItem;
    lastItem.value = parsed.lastItem;
    productPage.value += 1;
    productNoMore.value = parsed.items.length === 0 || !parsed.hasMore;
  } catch (error) {
    if (expectedSelectionVersion === selectionVersion.value && selection === selectedBrand.value) {
      productError.value = error instanceof Error ? error.message : '无法获取闲置型号';
    }
    console.warn('加载闲置型号失败', error);
  } finally {
    if (loadingSelectionVersion === expectedSelectionVersion) {
      productLoading.value = false;
      loadingSelectionVersion = -1;
    }
  }
}

function reloadProducts() {
  resetProducts();
  void loadProducts(false, selectionVersion.value);
}

function openProduct(entity: DiscoveryEntity) {
  // 与卡片渲染走同一套 normalizeProduct 归一化，保证跳转口径与展示口径一致。
  const routeInfo = resolveDiscoveryRoute(normalizeProduct(entity));
  if (!routeInfo) return;
  if (routeInfo.kind === 'web') {
    void CoolapkTauriAPI.openUrl(routeInfo.target, 'internal');
    return;
  }
  const localRoute = normalizeCoolapkRoute(routeInfo.target);
  if (localRoute && router.resolve(localRoute).matched.length > 0) {
    void router.push(localRoute);
    return;
  }
  void router.push({ path: '/page', query: { url: routeInfo.target, title: routeInfo.title || entityTitle(entity), renderer: 'discovery' } });
}

function handleScroll(event: Event) {
  const element = event.currentTarget as HTMLElement;
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 360) void loadProducts(true);
}

function goBack() {
  void router.push('/secondhand');
}

onMounted(() => { void loadBrands(); });

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => brandLoading.value || productLoading.value);
async function refreshMobilePage() { resetProducts(); await loadProducts(false, selectionVersion.value); }
</script>

<style scoped>
.page-container { width: 100%; height: 100%; overflow-y: auto; padding: 14px 16px; box-sizing: border-box; }
.page-header { margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.header-main { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.back-button { display: inline-flex; align-items: center; gap: 8px; border: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 18px; font-weight: 800; cursor: pointer; padding: 0; }
.back-button i { color: var(--brand-primary); font-size: 15px; }
.page-subtitle, .route-hint { color: var(--text-tertiary); font-size: 12px; }
.route-hint { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.route-hint i { color: var(--brand-primary); }
.browser-layout { display: grid; grid-template-columns: minmax(190px, 250px) minmax(0, 1fr); gap: 14px; align-items: start; }
.brand-panel, .product-panel { min-width: 0; background: var(--surface); border: 1px solid var(--border-light, rgba(0, 0, 0, .08)); border-radius: 12px; }
.brand-panel { overflow: hidden; }
.panel-title, .product-toolbar { margin: 0; padding: 14px 16px; border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, .08)); }
.panel-title { color: var(--text-primary); font-size: 15px; }
.brand-list { display: flex; flex-direction: column; padding: 6px; }
.brand-item { display: flex; align-items: center; gap: 9px; min-height: 48px; border: 0; border-radius: 9px; background: transparent; color: var(--text-primary); cursor: pointer; padding: 6px 9px; text-align: left; }
.brand-item:hover, .brand-item.active { background: var(--brand-soft, rgba(16, 185, 129, .1)); }
.brand-logo, .brand-logo-fallback { width: 32px; height: 32px; flex: 0 0 32px; border-radius: 8px; }
.brand-logo-fallback { display: grid; place-items: center; background: var(--surface-hover); color: var(--brand-primary); }
.brand-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.brand-count { color: var(--text-tertiary); font-size: 11px; }
.panel-state, .result-state { padding: 16px; }
.product-toolbar { display: flex; align-items: center; justify-content: space-between; }
.product-toolbar h3 { margin: 0; color: var(--text-primary); font-size: 16px; }
.product-toolbar span { display: block; margin-top: 4px; color: var(--text-tertiary); font-size: 12px; }
.product-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; padding: 14px; }
.pagination-footer { grid-column: 1 / -1; padding: 8px 0; text-align: center; }
.no-more, .retry-inline { color: var(--text-tertiary); font-size: 12px; }
.retry-inline { border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; }
@media (max-width: 760px) { .browser-layout { grid-template-columns: 1fr; } .brand-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
