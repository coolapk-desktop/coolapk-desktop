<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: configLoading || tabLoading || sideLoading || productLoading || dynamicCategoryLoading || (props.channelOnly && !props.channelActive) }" class="digital-page page-container" :class="{ 'is-mobile-presentation': mobilePresentation }">
    <FeedTabs v-if="digitalTabs.length && !channelOnly" :active-key="selectedTabKey" :tabs="digitalTabNavItems" :swipe-progress="mobilePresentation ? swipeProgress : undefined" :show-manage="false" @update:active-key="selectDigitalTabByKey" />

    <!-- 复用发现页的滑动容器；各栏目独立保留筛选、分页与滚动位置。 -->
    <DiscoveryPager v-if="mobilePresentation && !channelOnly && digitalTabs.length" :tabs="pagerTabs" :active-key="selectedTabKey" @select="selectDigitalTabByKey" @progress="swipeProgress = $event">
      <template #default="{ tab }">
        <DigitalPage :key="tab.key" channel-only :channel-tabs="digitalTabs" :channel-key="tab.key" :channel-active="selectedTabKey === tab.key" @select-channel="selectDigitalTabByKey" />
      </template>
    </DiscoveryPager>
    <template v-else>

    <nav v-if="visibleDigitalSubtabs.length" class="digital-subtabs" data-discovery-horizontal-scroll aria-label="数码服务端子栏目">
      <button v-for="item in visibleDigitalSubtabs" :key="subtabKey(item)" type="button" :class="['digital-subtab', { active: selectedSubtabKey === subtabKey(item) }]" @click="selectDigitalSubtab(item)">
        <span>{{ entityTitle(item) || '子栏目' }}</span>
      </button>
    </nav>

    <div v-if="configLoading && !selectedTab" class="digital-config-state"><LoadingState text="正在获取数码服务端栏目..." /></div>
    <div v-else-if="configError && !selectedTab" class="digital-config-state"><ErrorState title="数码栏目加载失败" :message="configError" @retry="loadDigitalConfig" /></div>
    <section v-else-if="selectedTabWebUrl" class="digital-web-route">
      <i class="fas fa-globe"></i>
      <div>
        <strong>该数码栏目由网页内容提供</strong>
        <span>{{ selectedTabWebUrl }}</span>
      </div>
      <button type="button" @click="openWeb(selectedTabWebUrl)">打开页面</button>
    </section>

    <template v-else-if="isCategoryTab || isDynamicCategoryView">
      <div v-if="isCategoryTab && compactSidebar" class="library-filter-bar" aria-label="数码库筛选">
        <button v-for="mode in modes" :key="mode.key" type="button" :class="{ active: activeMode === mode.key }" :aria-expanded="activeMode === mode.key && sidebarExpanded" @click="switchMode(mode.key)">
          {{ mode.label }}<i :class="activeMode === mode.key && sidebarExpanded ? 'fas fa-chevron-up' : 'fas fa-chevron-down'" aria-hidden="true"></i>
        </button>
        <button v-if="sidebarExpanded" type="button" class="library-collapse" aria-label="收起品牌和分类" @click="sidebarExpanded = false"><i class="fas fa-angles-left" aria-hidden="true"></i></button>
      </div>
      <div class="digital-body" :class="{ 'is-library': isCategoryTab, 'is-selector-collapsed': isCategoryTab && compactSidebar && !sidebarExpanded }">
      <aside class="digital-sidebar">
        <div class="sidebar-toolbar">
          <div v-if="isCategoryTab && !compactSidebar" class="mode-switch" role="tablist" aria-label="数码服务端分类模式">
            <button v-for="mode in modes" :key="mode.key" type="button" role="tab" :aria-selected="activeMode === mode.key" :aria-expanded="compactSidebar ? activeMode === mode.key && sidebarExpanded : undefined" :class="['mode-button', { active: activeMode === mode.key }]" @click="switchMode(mode.key)">
              <i :class="mode.icon"></i>
              {{ mode.label }}
            </button>
          </div>
          <div v-if="!isCategoryTab" class="dynamic-mode-label"><i class="fas fa-layer-group"></i><span>数码栏目</span><button type="button" aria-label="返回数码首页" title="返回数码首页" @click="clearDynamicCategoryView"><i class="fas fa-arrow-left"></i></button></div>
          <label v-show="!isCategoryTab || !compactSidebar || sidebarExpanded" class="digital-search">
            <i class="fas fa-search" aria-hidden="true"></i>
            <input v-model="searchQuery" type="search" :placeholder="isCategoryTab ? activeMode === 'brand' ? '搜索品牌' : '搜索分类' : '搜索数码栏目'" :aria-label="isCategoryTab ? activeMode === 'brand' ? '搜索品牌' : '搜索分类' : '搜索数码栏目'" @keydown.esc="searchQuery = ''" />
            <button v-if="searchQuery" type="button" aria-label="清除搜索" @click="searchQuery = ''"><i class="fas fa-times"></i></button>
          </label>
        </div>

        <div v-show="!isCategoryTab || !compactSidebar || sidebarExpanded" class="sidebar-options">
        <template v-if="isCategoryTab">
          <div v-if="sideLoading" class="digital-state"><LoadingState text="正在获取服务端列表..." /></div>
          <div v-else-if="sideError" class="digital-state"><ErrorState title="列表加载失败" message="无法获取服务端数码列表" @retry="loadSide" /></div>
          <div v-else-if="filteredSideItems.length === 0" class="digital-state"><EmptyState title="暂无服务端数据" description="当前模式没有可展示的品牌或分类" /></div>
          <nav v-else class="digital-side-list" aria-label="数码品牌或分类">
            <button v-for="item in filteredSideItems" :key="sideItemKey(item)" type="button" :class="['digital-side-item', { active: selectedId === sideItemKey(item) }]" @click="selectSide(item)">
              <span v-if="isHotSideItem(item)" class="digital-side-logo-fallback digital-side-hot-logo"><i class="fas fa-fire" aria-hidden="true"></i></span>
              <AppImage v-else-if="sideLogo(item)" :src="sideLogo(item)" fit="contain" class="digital-side-logo" image-class="digital-side-logo-img" />
              <span v-else class="digital-side-logo-fallback"><i class="fas fa-microchip"></i></span>
              <span class="digital-side-name">{{ item.title || item.name || '未命名' }}</span>
              <span v-if="productCount(item)" class="digital-side-count">{{ formatCount(productCount(item)) }}</span>
            </button>
          </nav>
        </template>
        <template v-else>
          <div v-if="filteredDynamicCategoryItems.length === 0" class="digital-state"><EmptyState title="暂无数码栏目" description="当前数码页面没有可展示的分类入口" /></div>
          <nav v-else class="digital-side-list" aria-label="数码服务端栏目">
            <button v-for="(item, index) in filteredDynamicCategoryItems" :key="dynamicCategoryItemKey(item, index)" type="button" :class="['digital-side-item', { active: dynamicCategorySelectedKey === dynamicCategoryItemKey(item, index) }]" @click="selectDynamicCategory(item)">
              <AppImage v-if="getEntityImage(item)" :src="getEntityImage(item)" fit="contain" class="digital-side-logo" image-class="digital-side-logo-img" />
              <span v-else class="digital-side-logo-fallback"><i :class="getEntityFallbackIcon(item)"></i></span>
              <span class="digital-side-name">{{ entityTitle(item) || '未命名栏目' }}</span>
            </button>
          </nav>
        </template>
        </div>
      </aside>

      <main ref="productScrollContainer" class="digital-content" @scroll.passive="handleScroll">
        <template v-if="isCategoryTab">
          <div v-if="!selected" class="digital-content-empty"><i class="fas fa-arrow-left"></i><span>从左侧选择服务端品牌或分类</span></div>
          <template v-else>
            <div class="digital-content-toolbar">
              <div class="toolbar-left">
                <span class="toolbar-title">{{ selectedCategoryTitle }}</span>
                <span v-if="selectedCategoryCount" class="toolbar-count">共 {{ selectedCategoryCount }} 款产品</span>
              </div>
              <div class="toolbar-right">
                <div class="view-switcher" role="group" aria-label="视图模式切换">
                  <button type="button" :class="['view-btn', { active: displayMode === 'grid' }]" title="网格视图" @click="setDisplayMode('grid')">
                    <i class="fas fa-grip"></i>
                    <span>网格</span>
                  </button>
                  <button type="button" :class="['view-btn', { active: displayMode === 'vertical' }]" title="列表视图" @click="setDisplayMode('vertical')">
                    <i class="fas fa-list"></i>
                    <span>列表</span>
                  </button>
                </div>
              </div>
            </div>
            <div v-if="productLoading && products.length === 0" class="digital-result-state"><DiscoverySkeleton /></div>
            <div v-else-if="productError && products.length === 0" class="digital-result-state"><ErrorState title="数码页面加载失败" :message="productError" @retry="loadProducts" /></div>
            <div v-else-if="products.length === 0" class="digital-result-state"><EmptyState title="服务端暂未返回内容" description="该品牌或分类当前没有可展示的数码内容" /></div>
            <div v-else :class="['digital-result-list', displayMode]">
              <template v-for="(block, index) in displayBlocks" :key="blockKey(block, index)">
                <DigitalSeriesTitle v-if="block.kind === 'title'" :title="block.title || ''" />
                <DigitalSeriesMore v-else-if="block.kind === 'more' && block.entity" :label="entityTitle(block.entity)" @open="openEntity(block.entity)" />
                <div v-else-if="block.kind === 'products'" :class="['series-products', displayMode]">
                  <template v-if="displayMode === 'horizontal'">
                    <DigitalProductRow :products="block.items" :more="block.more" @open="openEntity" />
                  </template>
                  <template v-else>
                    <DigitalProductCard
                      v-for="(product, productIndex) in block.items"
                      :key="getEntityKey(product, productIndex)"
                      :product="product"
                      :layout="displayMode === 'grid' ? 'grid' : 'vertical'"
                      @open="openEntity"
                    />
                  </template>
                </div>
                <div v-else-if="block.entity" :class="['digital-entity-item', { 'is-group': Array.isArray(block.entity.entities) && block.entity.entities.length > 0 }]">
                  <DiscoveryEntityCard :entity="block.entity" :product-layout="displayMode === 'grid' ? 'grid' : 'vertical'" @open="openEntity" />
                </div>
              </template>
              <div ref="productBottomSentinel" class="digital-pagination">
                <LoadingState v-if="productLoading" text="正在加载更多服务端内容..." />
                <button v-else-if="productError" type="button" class="inline-retry" @click="loadProducts(true)">加载失败，点击重试</button>
                <span v-else-if="productNoMore">没有更多服务端内容了</span>
              </div>
            </div>
          </template>
        </template>
        <template v-else>
          <div v-if="dynamicCategorySelected" class="digital-content-toolbar">
            <div class="toolbar-left">
              <span class="toolbar-title">{{ selectedCategoryTitle }}</span>
            </div>
            <div class="toolbar-right">
              <div class="view-switcher" role="group" aria-label="视图模式切换">
                <button type="button" :class="['view-btn', { active: displayMode === 'grid' }]" title="网格视图" @click="setDisplayMode('grid')">
                  <i class="fas fa-grip"></i>
                  <span>网格</span>
                </button>
                <button type="button" :class="['view-btn', { active: displayMode === 'vertical' }]" title="列表视图" @click="setDisplayMode('vertical')">
                  <i class="fas fa-list"></i>
                  <span>列表</span>
                </button>
              </div>
            </div>
          </div>
          <div v-if="dynamicCategoryLoading && dynamicCategoryItems.length === 0" class="digital-result-state"><DiscoverySkeleton /></div>
          <div v-else-if="dynamicCategoryError && dynamicCategoryItems.length === 0" class="digital-result-state"><ErrorState title="数码栏目加载失败" :message="dynamicCategoryError" @retry="loadDynamicCategory" /></div>
          <div v-else-if="dynamicCategoryItems.length === 0" class="digital-result-state"><EmptyState title="服务端暂未返回内容" description="该数码栏目当前没有可展示的内容" /></div>
          <div v-else :class="['digital-result-list', displayMode]">
            <template v-for="(block, index) in dynamicCategoryBlocks" :key="`dynamic-category-${blockKey(block, index)}`">
              <DigitalSeriesTitle v-if="block.kind === 'title'" :title="block.title || ''" />
              <DigitalSeriesMore v-else-if="block.kind === 'more' && block.entity" :label="entityTitle(block.entity)" @open="openEntity(block.entity)" />
              <div v-else-if="block.kind === 'products'" :class="['series-products', displayMode]">
                <DigitalProductCard
                  v-for="(product, productIndex) in block.items"
                  :key="getEntityKey(product, productIndex)"
                  :product="product"
                  :layout="displayMode === 'grid' ? 'grid' : 'vertical'"
                  @open="openEntity"
                />
              </div>
              <div v-else-if="block.entity" :class="['digital-entity-item', { 'is-group': Array.isArray(block.entity.entities) && block.entity.entities.length > 0 }]">
                <DiscoveryEntityCard :entity="block.entity" :product-layout="displayMode === 'grid' ? 'grid' : 'vertical'" @open="openEntity" />
              </div>
            </template>
            <div ref="dynamicCategoryBottomSentinel" class="digital-pagination">
              <LoadingState v-if="dynamicCategoryLoading" text="正在加载更多服务端内容..." />
              <button v-else-if="dynamicCategoryError" type="button" class="inline-retry" @click="loadDynamicCategory(true)">加载失败，点击重试</button>
              <span v-else-if="dynamicCategoryNoMore">没有更多服务端内容了</span>
            </div>
          </div>
        </template>
      </main>
      </div>
    </template>

    <main ref="tabScrollContainer" v-else class="digital-server-content" @scroll.passive="handleTabScroll">
      <div v-if="tabItems.length > 0 && !mobilePresentation" class="digital-content-toolbar">
        <div class="toolbar-left">
          <span class="toolbar-title">{{ selectedTabTitle }}</span>
        </div>
        <div class="toolbar-right">
          <div class="view-switcher" role="group" aria-label="视图模式切换">
            <button type="button" :class="['view-btn', { active: displayMode === 'grid' }]" title="网格视图" @click="setDisplayMode('grid')">
              <i class="fas fa-grip"></i>
              <span>网格</span>
            </button>
            <button type="button" :class="['view-btn', { active: displayMode === 'vertical' }]" title="列表视图" @click="setDisplayMode('vertical')">
              <i class="fas fa-list"></i>
              <span>列表</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="tabLoading && tabItems.length === 0" class="digital-result-state"><DiscoverySkeleton /></div>
      <div v-else-if="tabError && tabItems.length === 0" class="digital-result-state"><ErrorState title="数码页面加载失败" :message="tabError" @retry="loadTabItems" /></div>
      <div v-else-if="tabItems.length === 0" class="digital-result-state"><EmptyState title="服务端暂未返回内容" description="该数码栏目当前没有可展示的内容" /></div>
      <div v-else-if="mobilePresentation" class="mobile-digital-list">
        <MobileDigitalCard v-for="(entity, index) in tabItems" :key="getEntityKey(entity, index)" :entity="entity" @open="openEntity" />
        <div ref="tabBottomSentinel" class="digital-pagination">
          <LoadingState v-if="tabLoading" text="正在加载更多..." />
          <button v-else-if="tabError" type="button" class="inline-retry" @click="loadTabItems(true)">加载失败，点击重试</button>
        </div>
      </div>
      <div v-else :class="['digital-server-list', displayMode]">
        <template v-for="(block, index) in tabDisplayBlocks" :key="`tab-${blockKey(block, index)}`">
          <DigitalSeriesTitle v-if="block.kind === 'title'" :title="block.title || ''" />
          <DigitalSeriesMore v-else-if="block.kind === 'more' && block.entity" :label="entityTitle(block.entity)" @open="openEntity(block.entity)" />
          <div v-else-if="block.kind === 'products'" :class="['digital-server-products', displayMode]">
            <DigitalProductCard
              v-for="(product, productIndex) in block.items"
              :key="getEntityKey(product, productIndex)"
              :product="product"
              :layout="displayMode === 'grid' ? 'grid' : 'vertical'"
              @open="openEntity"
            />
          </div>
          <div v-else-if="block.entity" :class="['digital-entity-item', { 'is-group': Array.isArray(block.entity.entities) && block.entity.entities.length > 0 }]">
            <DiscoveryEntityCard :entity="block.entity" :product-layout="displayMode === 'grid' ? 'grid' : 'vertical'" @open="openEntity" />
          </div>
        </template>
        <div ref="tabBottomSentinel" class="digital-pagination">
          <LoadingState v-if="tabLoading" text="正在加载更多服务端内容..." />
          <button v-else-if="tabError" type="button" class="inline-retry" @click="loadTabItems(true)">加载失败，点击重试</button>
          <span v-else-if="tabNoMore">没有更多服务端内容了</span>
        </div>
      </div>
    </main>
    </template>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import AppImage from '../components/common/AppImage.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import LoadingState from '../components/common/LoadingState.vue';
import DiscoveryEntityCard from '../components/discovery/DiscoveryEntityCard.vue';
import DiscoverySkeleton from '../components/discovery/DiscoverySkeleton.vue';
import DiscoveryPager from '../components/discovery/DiscoveryPager.vue';
import FeedTabs from '../components/feed/FeedTabs.vue';
import DigitalProductCard from '../components/digital/DigitalProductCard.vue';
import MobileDigitalCard from '../components/digital/MobileDigitalCard.vue';
import { useSettingsStore } from '../stores/settings';
import { isTouchMobilePlatform } from '../utils/platform';
import { findProductCategory } from '../utils/productCategory';
import { productSortTarget, markProductSort, replaceSortedProducts } from '../utils/productSort';
import { showToast } from '../utils/toast';
import DigitalProductRow from '../components/digital/DigitalProductRow.vue';
import DigitalSeriesMore from '../components/digital/DigitalSeriesMore.vue';
import DigitalSeriesTitle from '../components/digital/DigitalSeriesTitle.vue';
import type { DiscoveryEntity, DiscoveryPageResult, DiscoveryTab } from '../types/discovery';
import type { ProductBrand } from '../types/product';
import type { ConfigPageTab } from '../types/settings';
import { decodeDiscoveryRouteSegment, getEntityFallbackIcon, getEntityImage, getEntityKey, parseDiscoveryPage, resolveDiscoveryRoute } from '../utils/discovery';
import { getDigitalEntityTitle, isDigitalProduct, isDigitalSeriesMore, isDigitalSeriesTitle } from '../utils/digitalProduct';
import { getFallbackDigitalTabs, parseDigitalConfig, removeRedundantFirstDigitalTab, resolveDefaultDigitalTabKey } from '../utils/digitalTabs';
import type { DigitalTab } from '../utils/digitalTabs';

type DigitalMode = 'brand' | 'category';
const props = withDefaults(defineProps<{ channelOnly?: boolean; channelTabs?: DigitalTab[]; channelKey?: string; channelActive?: boolean }>(), { channelOnly: false, channelActive: true });
const emit = defineEmits<{ (event: 'select-channel', key: string): void }>();
const swipeProgress = ref<number>();
type DisplayMode = 'grid' | 'vertical' | 'horizontal';
type DigitalBlock = { kind: 'title' | 'more' | 'products' | 'entity'; title?: string; items: DiscoveryEntity[]; entity?: DiscoveryEntity; more?: DiscoveryEntity };

const router = useRouter();
const settingsStore = useSettingsStore();
const viewportWidth = ref(window.innerWidth);
const compactSidebar = computed(() => viewportWidth.value <= 720);
const sidebarExpanded = ref(true);
const updateViewport = () => { viewportWidth.value = window.innerWidth; };
const mobilePresentation = computed(() => viewportWidth.value <= 720
  && (isTouchMobilePlatform() || !settingsStore.settings.disableAutoMobileMode));
onMounted(() => window.addEventListener('resize', updateViewport));
onBeforeUnmount(() => window.removeEventListener('resize', updateViewport));
const modes: Array<{ key: DigitalMode; label: string; icon: string }> = [
  { key: 'brand', label: '品牌', icon: 'fas fa-tags' },
  { key: 'category', label: '分类', icon: 'fas fa-layer-group' },
];
const activeMode = ref<DigitalMode>('brand');
const savedDisplayMode = localStorage.getItem('coolapk.digital.display_mode');
const displayMode = ref<DisplayMode>(savedDisplayMode === 'vertical' ? 'vertical' : 'grid');

function setDisplayMode(mode: DisplayMode) {
  displayMode.value = mode;
  try {
    localStorage.setItem('coolapk.digital.display_mode', mode);
  } catch {}
}
const digitalTabs = ref<DigitalTab[]>([]);
const selectedTabKey = ref('');
const selectedSubtabKey = ref('');
const configLoading = ref(false);
const configError = ref('');
const sideItems = ref<ProductBrand[]>([]);
const selected = ref<ProductBrand | null>(null);
const selectedId = ref('');
const searchQuery = ref('');
const sideLoading = ref(false);
const sideError = ref(false);
const products = ref<DiscoveryEntity[]>([]);
const productLoading = ref(false);
const productError = ref('');
const productNoMore = ref(false);
const productPage = ref(1);
const firstItem = ref('');
const lastItem = ref('');
const selectionVersion = ref(0);
const tabItems = ref<DiscoveryEntity[]>([]);
const tabLoading = ref(false);
const tabError = ref('');
const tabNoMore = ref(false);
const tabPage = ref(1);
const tabFirstItem = ref('');
const tabLastItem = ref('');
const tabSelectionVersion = ref(0);
const dynamicCategorySelected = ref<DiscoveryEntity | null>(null);
const dynamicCategoryItems = ref<DiscoveryEntity[]>([]);
const dynamicCategoryLoading = ref(false);
const dynamicCategoryError = ref('');
const dynamicCategoryNoMore = ref(false);
const dynamicCategoryPage = ref(1);
const dynamicCategoryFirstItem = ref('');
const dynamicCategoryLastItem = ref('');
const dynamicCategorySelectionVersion = ref(0);
const productScrollContainer = ref<HTMLElement | null>(null);
const productBottomSentinel = ref<HTMLElement | null>(null);
const dynamicCategoryBottomSentinel = ref<HTMLElement | null>(null);
const tabScrollContainer = ref<HTMLElement | null>(null);
const tabBottomSentinel = ref<HTMLElement | null>(null);
let requestVersion = 0;
let loadingSelectionVersion = -1;
let tabRequestVersion = 0;
let loadingTabSelectionVersion = -1;
let dynamicCategoryRequestVersion = 0;
let loadingDynamicCategorySelectionVersion = -1;
let productObserver: IntersectionObserver | null = null;
let dynamicCategoryObserver: IntersectionObserver | null = null;
let tabObserver: IntersectionObserver | null = null;

const selectedTab = computed(() => digitalTabs.value.find((tab) => tab.key === selectedTabKey.value) || null);
const pagerTabs = computed<DiscoveryTab[]>(() => digitalTabs.value.map(tab => ({ ...tab, subTitle: tab.subTitle || '' })));
const digitalTabNavItems = computed<ConfigPageTab[]>(() => digitalTabs.value.map((tab) => ({ title: tab.title, page_name: tab.key, url: tab.url || tab.key })));
const isCategoryTab = computed(() => selectedTab.value?.category === true);
const isDynamicCategoryView = computed(() => !isCategoryTab.value && Boolean(dynamicCategorySelected.value));
const digitalSubtabs = computed(() => selectedTab.value?.rawEntities.filter((entity) => String(entity.url || entity.pageName || entity.page_name || entity.webUrl || entity.web_url || '').trim()) || []);
const digitalTabTargets = computed(() => new Set(digitalTabs.value.flatMap((tab) => [tab.key, tab.pageName, tab.url, tab.webUrl].map(normalizeDigitalTarget).filter(Boolean))));
const visibleDigitalSubtabs = computed(() => digitalSubtabs.value.filter((entity) => {
  const target = normalizeDigitalTarget(entity.url || entity.pageName || entity.page_name || entity.webUrl || entity.web_url);
  return target && (!digitalTabTargets.value.has(target) || Object.keys(getDigitalRequestArgs(entity)).length > 0);
}));
const selectedSubtab = computed(() => digitalSubtabs.value.find((entity) => subtabKey(entity) === selectedSubtabKey.value) || null);
const selectedTabTitle = computed(() => String(selectedSubtab.value?.title || selectedTab.value?.title || '数码'));
const selectedTabSubTitle = computed(() => String(selectedSubtab.value?.subTitle || selectedSubtab.value?.sub_title || selectedTab.value?.subTitle || ''));
const selectedTabTarget = computed(() => {
  const entityUrl = normalizeDigitalTarget(selectedSubtab.value?.url || selectedSubtab.value?.pageName || selectedSubtab.value?.page_name);
  if (entityUrl && !isWebUrl(entityUrl)) return entityUrl;
  return normalizeDigitalTarget(selectedTab.value?.url || selectedTab.value?.pageName || selectedTab.value?.key);
});
const selectedTabWebUrl = computed(() => {
  const entityUrl = normalizeDigitalTarget(selectedSubtab.value?.webUrl || selectedSubtab.value?.web_url || selectedSubtab.value?.url);
  if (isWebUrl(entityUrl)) return entityUrl;
  return normalizeDigitalTarget(selectedTab.value?.webUrl);
});
const selectedRequestArgs = computed<Record<string, unknown>>(() => getDigitalRequestArgs(selectedSubtab.value || selectedTab.value?.raw));

const selectedCategoryTitle = computed(() => {
  if (selected.value) return String(selected.value.title || selected.value.name || '数码库');
  if (dynamicCategorySelected.value) return entityTitle(dynamicCategorySelected.value) || '数码分类';
  return selectedTabTitle.value || '数码';
});
const selectedCategoryCount = computed(() => {
  if (selected.value) {
    const count = productCount(selected.value);
    return count ? formatCount(count) : '';
  }
  return '';
});

const filteredSideItems = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return sideItems.value;
  return sideItems.value.filter((item) => `${item.title || ''} ${item.name || ''}`.toLocaleLowerCase().includes(query));
});

const dynamicCategorySourceItems = computed(() => {
  if (!selectedTab.value || selectedTab.value.category) return [];
  const grid = tabItems.value.find((item) => isDynamicCategoryGrid(item));
  return (grid?.entities || []).filter((item) => Boolean(dynamicCategoryTarget(item)));
});
const filteredDynamicCategoryItems = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return dynamicCategorySourceItems.value;
  return dynamicCategorySourceItems.value.filter((item) => entityTitle(item).toLocaleLowerCase().includes(query));
});
const dynamicCategorySelectedKey = computed(() => dynamicCategorySelected.value ? dynamicCategoryItemKey(dynamicCategorySelected.value) : '');

function asResponseList(response: unknown): ProductBrand[] {
  if (Array.isArray(response)) return response.filter(Boolean) as ProductBrand[];
  if (response && typeof response === 'object' && Array.isArray((response as { data?: unknown }).data)) return (response as { data: unknown[] }).data.filter(Boolean) as ProductBrand[];
  return [];
}

function sideItemKey(item: ProductBrand): string {
  return String(item.id ?? item.entityId ?? item.url ?? item.title ?? item.name ?? '');
}

function sideLogo(item: ProductBrand): string {
  return String(item.logo || item.pic || '');
}

function isHotSideItem(item: ProductBrand): boolean {
  return String(item.title || item.name || '').trim() === '热门';
}

function productCount(item: ProductBrand): number {
  const value = Number(item.product_num ?? item.series_num ?? 0);
  return Number.isFinite(value) ? value : 0;
}

const entityTitle = getDigitalEntityTitle;

function dynamicCategoryItemKey(item: DiscoveryEntity, index = 0): string {
  return getEntityKey(item, index);
}

function isDynamicCategoryGrid(item: DiscoveryEntity): boolean {
  const template = `${String(item.entityTemplate || '').toLowerCase()} ${String(item.entityType || '').toLowerCase()}`;
  return Array.isArray(item.entities) && (template.includes('iconlinkgrid') || template.includes('icontablinkgrid') || template.includes('tablinkgrid'));
}

function dynamicCategoryTarget(item: DiscoveryEntity): string {
  const route = resolveDiscoveryRoute(item);
  return route?.kind === 'data-list' && isDigitalCategoryRoute(route.target) ? normalizeDigitalTarget(route.target) : '';
}

async function resolveDynamicCategory(item: DiscoveryEntity): Promise<DiscoveryEntity> {
  const target = dynamicCategoryTarget(item);
  const id = new URLSearchParams(target.split('?')[1] || '').get('id')?.trim();
  if (!id) return item;
  const response = await CoolapkTauriAPI.getProductCategoryList();
  const categories: DiscoveryEntity[] = Array.isArray(response?.data) ? response.data : [];
  const result = findProductCategory(categories, id);
  if (!result?.category.url) throw new Error('该数码分类缺少内容地址');
  // Preserve the APK directory URL, including isSecondCategory and other server context.
  return result.category;
}

function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function subtabKey(entity: DiscoveryEntity, index = 0): string {
  return String(entity.entityId ?? entity.entity_id ?? entity.id ?? entity.url ?? entity.webUrl ?? entity.web_url ?? entity.title ?? `subtab-${index}`);
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function getDigitalRequestArgs(entity: DiscoveryEntity | undefined): Record<string, unknown> {
  if (!entity) return {};
  const extra = parseRecord(entity.extraData ?? entity.extra_data);
  const requestArgs = entity.requestArgs ?? entity.request_args ?? entity.requestParams ?? entity.request_params ?? entity.params ?? entity.queryParams ?? entity.query_params ?? extra.requestArgs ?? extra.request_args ?? extra.requestParams ?? extra.request_params ?? extra.params ?? extra.queryParams ?? extra.query_params;
  const parsed = parseRecord(requestArgs);
  if (Object.keys(parsed).length > 0) return parsed;
  const pageParam = entity.pageParam ?? entity.page_param ?? extra.pageParam ?? extra.page_param;
  return pageParam === undefined || pageParam === null || pageParam === '' ? {} : { pageParam };
}

function selectDigitalSubtab(entity: DiscoveryEntity) {
  const key = subtabKey(entity);
  if (selectedSubtabKey.value === key) return;
  selectedSubtabKey.value = key;
  if (selectedTab.value) localStorage.setItem(`coolapk.digital.subtab.${selectedTab.value.key}`, key);
  resetTabItems();
  if (!selectedTabWebUrl.value) void loadTabItems(false, tabSelectionVersion.value);
}

function buildPageContext(kind: string, tab: DigitalTab | null, entity: DiscoveryEntity | null = null): string {
  return JSON.stringify({ source: 'desktop-digital', kind, tab: tab?.key || '', pageName: tab?.pageName || '', subTab: entity ? subtabKey(entity) : '', entityId: entity?.entityId ?? entity?.id ?? '' });
}

function buildBlocks(items: DiscoveryEntity[], mode: DisplayMode): DigitalBlock[] {
  const blocks: DigitalBlock[] = [];
  const pending: DiscoveryEntity[] = [];
  const flushProducts = (more?: DiscoveryEntity) => {
    if (pending.length === 0) return;
    blocks.push({ kind: 'products', items: pending.splice(0), more });
  };
  for (const item of items) {
    if (isDigitalSeriesTitle(item)) {
      flushProducts();
      blocks.push({ kind: 'title', title: entityTitle(item), items: [] });
    } else if (isDigitalProduct(item)) {
      if (mode === 'horizontal') {
        pending.push(item);
        if (pending.length === 3) flushProducts();
      } else {
        pending.push(item);
      }
    } else if (isDigitalSeriesMore(item)) {
      if (mode === 'horizontal') {
        if (pending.length > 0) flushProducts(item);
        else blocks.push({ kind: 'products', items: [], more: item });
      } else {
        flushProducts();
        blocks.push({ kind: 'more', items: [], entity: item });
      }
    } else {
      flushProducts();
      blocks.push({ kind: 'entity', items: [], entity: item });
    }
  }
  flushProducts();
  return blocks;
}

const displayBlocks = computed(() => buildBlocks(products.value, displayMode.value));
const tabDisplayBlocks = computed(() => buildBlocks(tabItems.value, displayMode.value));
const dynamicCategoryBlocks = computed(() => buildBlocks(dynamicCategoryItems.value, displayMode.value));

function blockKey(block: DigitalBlock, index: number): string {
  if (block.entity) return `entity-${getEntityKey(block.entity, index)}`;
  if (block.kind === 'products' && block.items[0]) return `products-${getEntityKey(block.items[0], index)}`;
  return `${block.kind}-${index}`;
}

const sortTarget = ref('');

function resetTabItems(preserveContent = false) {
  sortTarget.value = '';
  tabSelectionVersion.value += 1;
  if (!preserveContent) tabItems.value = [];
  tabError.value = '';
  tabNoMore.value = false;
  tabPage.value = 1;
  tabFirstItem.value = '';
  tabLastItem.value = '';
}

async function loadDigitalConfig() {
  configLoading.value = true;
  configError.value = '';
  try {
    // 子栏目沿用外层已获取的配置，不重复请求栏目配置接口。
    const parsed = props.channelOnly && props.channelTabs ? { tabs: props.channelTabs, selectedKey: props.channelKey || '' } : parseDigitalConfig(await CoolapkTauriAPI.getTabConfig());
    const normalizedTabs = removeRedundantFirstDigitalTab(parsed.tabs.length ? parsed.tabs : getFallbackDigitalTabs());
    digitalTabs.value = normalizedTabs.tabs;
    const defaultTabKey = resolveDefaultDigitalTabKey(digitalTabs.value, parsed.selectedKey, normalizedTabs.removedKey);
    if (!selectedTabKey.value || !digitalTabs.value.some((tab) => tab.key === selectedTabKey.value)) selectedTabKey.value = defaultTabKey;
  } catch (error) {
    configError.value = error instanceof Error ? error.message : '无法获取服务端数码栏目';
    digitalTabs.value = getFallbackDigitalTabs();
    console.warn('加载数码服务端栏目失败，使用协议默认栏目', error);
  } finally {
    configLoading.value = false;
  }
  const nextTab = digitalTabs.value.find((tab) => tab.key === selectedTabKey.value) || digitalTabs.value[0];
  if (!nextTab) return;
  selectedTabKey.value = nextTab.key;
  if (mobilePresentation.value && !props.channelOnly) return;
  selectedSubtabKey.value = '';
  searchQuery.value = '';
  clearDynamicCategoryView();
  if (nextTab.category) activeMode.value = 'category';
  resetProducts();
  resetTabItems();
  if (nextTab.category) await loadSide(true);
  else await loadTabItems(false, tabSelectionVersion.value);
}

function selectDigitalTab(tab: DigitalTab) {
  // 内容中的跨栏目入口交给外层切换，保持顶部选中项与滑动页一致。
  if (props.channelOnly && tab.key !== props.channelKey) { emit('select-channel', tab.key); return; }
  if (mobilePresentation.value && !props.channelOnly) { selectedTabKey.value = tab.key; return; }
  if (selectedTabKey.value === tab.key && !tab.category && isDynamicCategoryView.value) {
    clearDynamicCategoryView();
    return;
  }
  if (selectedTabKey.value === tab.key && ((tab.category && activeMode.value === 'category' && sideItems.value.length > 0) || (!tab.category && tabItems.value.length > 0))) return;
  selectedTabKey.value = tab.key;
  selectedSubtabKey.value = '';
  searchQuery.value = '';
  clearDynamicCategoryView();
  if (tab.category) activeMode.value = 'category';
  resetProducts();
  resetTabItems();
  if (tab.category) void loadSide(true);
  else void loadTabItems(false, tabSelectionVersion.value);
}

function selectDigitalTabByKey(key: string) {
  const tab = digitalTabs.value.find((item) => item.key === key);
  if (tab) selectDigitalTab(tab);
}

async function loadTabItems(isLoadMore = false, expectedSelectionVersion = tabSelectionVersion.value) {
  const tab = selectedTab.value;
  if (!tab || tab.category || selectedTabWebUrl.value || expectedSelectionVersion !== tabSelectionVersion.value) return;
  if (tabLoading.value && loadingTabSelectionVersion === expectedSelectionVersion) return;
  if (tabNoMore.value) return;
  tabLoading.value = true;
  tabError.value = '';
  const currentRequest = ++tabRequestVersion;
  const tabKey = tab.key;
  loadingTabSelectionVersion = expectedSelectionVersion;
  try {
    const response = await CoolapkTauriAPI.getDiscoveryPageData({ url: sortTarget.value || selectedTabTarget.value || tab.pageName || tab.key, title: selectedTabTitle.value, subTitle: selectedTabSubTitle.value, page: tabPage.value, firstItem: tabFirstItem.value, lastItem: tabLastItem.value, pageContext: buildPageContext('digital-tab', tab, selectedSubtab.value), requestArgs: selectedRequestArgs.value });
    const parsed = parseDiscoveryPage(response, tabPage.value);
    if (expectedSelectionVersion !== tabSelectionVersion.value || tabKey !== selectedTabKey.value) return;
    const incoming = markProductSort(parsed.items, sortTarget.value);
    if (isLoadMore) {
      const existingKeys = new Set(tabItems.value.map((item, index) => getEntityKey(item, index)));
      tabItems.value = [...tabItems.value, ...incoming.filter((item, index) => !existingKeys.has(getEntityKey(item, tabItems.value.length + index)))];
    } else {
      tabItems.value = replaceSortedProducts(tabItems.value, incoming, sortTarget.value);
    }
    tabFirstItem.value = parsed.firstItem;
    tabLastItem.value = parsed.lastItem;
    tabPage.value += 1;
    tabNoMore.value = incoming.length === 0 || !parsed.hasMore;
  } catch (error) {
    if (expectedSelectionVersion !== tabSelectionVersion.value || tabKey !== selectedTabKey.value) return;
    tabError.value = error instanceof Error ? error.message : '无法获取服务端数码栏目';
    console.warn('加载服务端数码栏目内容失败', error);
  } finally {
    if (currentRequest === tabRequestVersion) {
      tabLoading.value = false;
      loadingTabSelectionVersion = -1;
    }
  }
}

async function switchMode(mode: DigitalMode) {
  if (!isCategoryTab.value) return;
  if (activeMode.value === mode && sideItems.value.length > 0) {
    if (compactSidebar.value) sidebarExpanded.value = !sidebarExpanded.value;
    return;
  }
  sidebarExpanded.value = true;
  activeMode.value = mode;
  searchQuery.value = '';
  sideItems.value = [];
  selected.value = null;
  selectedId.value = '';
  resetProducts();
  await loadSide();
}

async function loadSide(forceReload = false) {
  sideLoading.value = true;
  sideError.value = false;
  try {
    const response = activeMode.value === 'brand' ? await CoolapkTauriAPI.getProductBrandList() : await CoolapkTauriAPI.getProductCategoryList();
    sideItems.value = asResponseList(response).filter((item) => sideItemKey(item));
    const nextSelection = sideItems.value.find((item) => sideItemKey(item) === selectedId.value) || sideItems.value[0];
    if (nextSelection && (forceReload || !selected.value || sideItemKey(nextSelection) !== selectedId.value)) selectSide(nextSelection, false);
    if (!nextSelection) {
      selected.value = null;
      selectedId.value = '';
      resetProducts();
    }
  } catch (error) {
    sideError.value = true;
    console.warn('加载数码品牌/分类失败', error);
  } finally {
    sideLoading.value = false;
  }
}

function isDigitalCategoryRoute(target: string): boolean {
  return /^\/product\/categoryList(?:\?|$)/i.test(normalizeDigitalTarget(target));
}

function openDigitalCategory(entity: DiscoveryEntity, target: string): boolean {
  if (!selectedTab.value || selectedTab.value.category || dynamicCategorySourceItems.value.length === 0) return false;
  if (!dynamicCategoryTarget(entity) || normalizeDigitalTarget(target) !== dynamicCategoryTarget(entity)) return false;
  selectDynamicCategory(entity);
  return true;
}

function resetDynamicCategoryContent(preserveContent = false) {
  sortTarget.value = '';
  dynamicCategorySelectionVersion.value += 1;
  if (!preserveContent) dynamicCategoryItems.value = [];
  dynamicCategoryError.value = '';
  dynamicCategoryNoMore.value = false;
  dynamicCategoryPage.value = 1;
  dynamicCategoryFirstItem.value = '';
  dynamicCategoryLastItem.value = '';
}

function clearDynamicCategoryView() {
  dynamicCategorySelected.value = null;
  searchQuery.value = '';
  resetDynamicCategoryContent();
}

function selectDynamicCategory(item: DiscoveryEntity) {
  if (!dynamicCategoryTarget(item)) return;
  if (dynamicCategorySelected.value && dynamicCategoryItemKey(dynamicCategorySelected.value) === dynamicCategoryItemKey(item) && dynamicCategoryItems.value.length > 0) return;
  dynamicCategorySelected.value = item;
  searchQuery.value = '';
  resetDynamicCategoryContent();
  void loadDynamicCategory(false, dynamicCategorySelectionVersion.value);
}

async function loadDynamicCategory(isLoadMore = false, expectedSelectionVersion = dynamicCategorySelectionVersion.value) {
  const selection = dynamicCategorySelected.value;
  if (!selection || expectedSelectionVersion !== dynamicCategorySelectionVersion.value) return;
  if (dynamicCategoryLoading.value && loadingDynamicCategorySelectionVersion === expectedSelectionVersion) return;
  if (dynamicCategoryNoMore.value) return;
  dynamicCategoryLoading.value = true;
  dynamicCategoryError.value = '';
  const currentRequest = ++dynamicCategoryRequestVersion;
  loadingDynamicCategorySelectionVersion = expectedSelectionVersion;
  try {
    const category = await resolveDynamicCategory(selection);
    if (expectedSelectionVersion !== dynamicCategorySelectionVersion.value || selection !== dynamicCategorySelected.value) return;
    const response = await CoolapkTauriAPI.getDiscoveryPageData({ url: sortTarget.value || String(category.url || ''), title: entityTitle(category), subTitle: String(category.subTitle || category.sub_title || ''), page: dynamicCategoryPage.value, firstItem: dynamicCategoryFirstItem.value, lastItem: dynamicCategoryLastItem.value, pageContext: buildPageContext('digital-category-page', selectedTab.value, category), requestArgs: getDigitalRequestArgs(category) });
    const parsed = parseDiscoveryPage(response, dynamicCategoryPage.value);
    if (expectedSelectionVersion !== dynamicCategorySelectionVersion.value || selection !== dynamicCategorySelected.value) return;
    const incoming = markProductSort(parsed.items, sortTarget.value);
    if (isLoadMore) {
      const existingKeys = new Set(dynamicCategoryItems.value.map((item, index) => getEntityKey(item, index)));
      dynamicCategoryItems.value = [...dynamicCategoryItems.value, ...incoming.filter((item, index) => !existingKeys.has(getEntityKey(item, dynamicCategoryItems.value.length + index)))];
    } else {
      dynamicCategoryItems.value = replaceSortedProducts(dynamicCategoryItems.value, incoming, sortTarget.value);
    }
    dynamicCategoryFirstItem.value = parsed.firstItem;
    dynamicCategoryLastItem.value = parsed.lastItem;
    dynamicCategoryPage.value += 1;
    dynamicCategoryNoMore.value = incoming.length === 0 || !parsed.hasMore;
  } catch (error) {
    if (expectedSelectionVersion !== dynamicCategorySelectionVersion.value || selection !== dynamicCategorySelected.value) return;
    dynamicCategoryError.value = error instanceof Error ? error.message : '无法获取服务端数码栏目';
    console.warn('加载服务端数码分类内容失败', error);
  } finally {
    if (currentRequest === dynamicCategoryRequestVersion) {
      dynamicCategoryLoading.value = false;
      loadingDynamicCategorySelectionVersion = -1;
    }
  }
}

function resetProducts(preserveContent = false) {
  sortTarget.value = '';
  selectionVersion.value += 1;
  if (!preserveContent) products.value = [];
  productError.value = '';
  productNoMore.value = false;
  productPage.value = 1;
  firstItem.value = '';
  lastItem.value = '';
}

function selectSide(item: ProductBrand, closeSelector = true) {
  if (closeSelector && compactSidebar.value) sidebarExpanded.value = false;
  selected.value = item;
  selectedId.value = sideItemKey(item);
  resetProducts();
  void loadProducts(false, selectionVersion.value);
}

function parseLegacyProducts(response: unknown, page: number): DiscoveryPageResult {
  const parsed = parseDiscoveryPage(response, page);
  if (response && typeof response === 'object' && !Array.isArray(response) && Array.isArray((response as { data?: unknown }).data)) return parsed;
  const items = asResponseList(response) as DiscoveryEntity[];
  // 优先以响应中的分页字段（hasMore/has_more，含 pagination 元信息）为准；
  // 仅当响应缺失分页字段时才退回「页大小 ≥ 20」启发式（服务端页大小不是 20 时可能误判）。
  const root = response && typeof response === 'object' && !Array.isArray(response) ? (response as Record<string, unknown>) : {};
  const meta = (root.pagination ?? root.pageInfo ?? root.page_info) as Record<string, unknown> | undefined;
  const explicitMore = root.hasMore ?? root.has_more ?? meta?.hasMore ?? meta?.has_more;
  return { items, page, hasMore: typeof explicitMore === 'boolean' ? explicitMore : items.length >= 20, firstItem: String(items[0]?.entityId ?? items[0]?.id ?? ''), lastItem: String(items[items.length - 1]?.entityId ?? items[items.length - 1]?.id ?? ''), raw: response };
}

async function loadProducts(isLoadMore = false, expectedSelectionVersion = selectionVersion.value) {
  const selection = selected.value;
  if (!selection || expectedSelectionVersion !== selectionVersion.value) return;
  if (productLoading.value && loadingSelectionVersion === expectedSelectionVersion) return;
  if (productNoMore.value) return;
  productLoading.value = true;
  productError.value = '';
  const currentRequest = ++requestVersion;
  loadingSelectionVersion = expectedSelectionVersion;
  try {
    const url = sortTarget.value || String(selection.url || '').trim();
    if (!url && activeMode.value === 'category') throw new Error('服务端分类缺少数据地址');
    const response = url
      ? await CoolapkTauriAPI.getDiscoveryPageData({ url, title: String(selection.title || selection.name || ''), subTitle: String(selection.subTitle || ''), page: productPage.value, firstItem: firstItem.value, lastItem: lastItem.value, pageContext: buildPageContext(activeMode.value === 'brand' ? 'digital-brand' : 'digital-category', selectedTab.value, selection), requestArgs: getDigitalRequestArgs(selection) })
        : activeMode.value === 'brand'
        ? await CoolapkTauriAPI.getProductBrandProducts(String(selection.id ?? selection.entityId ?? ''), String(selection.type || 'recommend'), productPage.value, { firstItem: firstItem.value, lastItem: lastItem.value })
        : await CoolapkTauriAPI.getProductList(String(selection.pageName || ''), String(selection.title || selection.name || ''), String(selection.subTitle || ''), productPage.value, { firstItem: firstItem.value, lastItem: lastItem.value });
    const parsed = url ? parseDiscoveryPage(response, productPage.value) : parseLegacyProducts(response, productPage.value);
    if (expectedSelectionVersion !== selectionVersion.value || selection !== selected.value) return;
    const incoming = markProductSort(parsed.items, sortTarget.value);
    if (isLoadMore) {
      const existingKeys = new Set(products.value.map((item, index) => getEntityKey(item, index)));
      products.value = [...products.value, ...incoming.filter((item, index) => !existingKeys.has(getEntityKey(item, products.value.length + index)))];
    } else {
      products.value = replaceSortedProducts(products.value, incoming, sortTarget.value);
    }
    firstItem.value = parsed.firstItem;
    lastItem.value = parsed.lastItem;
    productPage.value += 1;
    productNoMore.value = incoming.length === 0 || !parsed.hasMore;
  } catch (error) {
    if (expectedSelectionVersion !== selectionVersion.value || selection !== selected.value) return;
    productError.value = error instanceof Error ? error.message : '无法获取服务端数码页面';
    console.warn('加载服务端数码页面失败', error);
  } finally {
    if (currentRequest === requestVersion) {
      productLoading.value = false;
      loadingSelectionVersion = -1;
    }
  }
}

function normalizeDigitalTarget(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const queryIndex = raw.indexOf('?');
  if (queryIndex >= 0) {
    const nested = new URLSearchParams(raw.slice(queryIndex + 1)).get('url');
    if (nested) return normalizeDigitalTarget(nested);
  }
  const clean = raw.replace(/^#/, '').trim();
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function findDigitalTabForEntity(entity: DiscoveryEntity): DigitalTab | null {
  const entityTargets = [entity.url, entity.pageName, entity.page_name, entity.webUrl, entity.web_url].map(normalizeDigitalTarget).filter(Boolean);
  if (entityTargets.length === 0) return null;
  return digitalTabs.value.find((tab) => {
    const tabTargets = [tab.key, tab.pageName, tab.url, tab.webUrl].map(normalizeDigitalTarget).filter(Boolean);
    return entityTargets.some((target) => tabTargets.includes(target));
  }) || null;
}

async function openEntity(entity: DiscoveryEntity) {
  const sort = productSortTarget(isDynamicCategoryView.value ? dynamicCategoryItems.value : isCategoryTab.value ? products.value : tabItems.value, entity);
  if (sort) {
    if (sortTarget.value === sort) return;
    if (isDynamicCategoryView.value) {
      resetDynamicCategoryContent(true);
      sortTarget.value = sort;
      void loadDynamicCategory(false, dynamicCategorySelectionVersion.value);
    } else if (isCategoryTab.value) {
      resetProducts(true);
      sortTarget.value = sort;
      void loadProducts(false, selectionVersion.value);
    } else {
      resetTabItems(true);
      sortTarget.value = sort;
      void loadTabItems(false, tabSelectionVersion.value);
    }
    return;
  }
  const route = resolveDiscoveryRoute(entity);
  if (!route) return;
  if (isDigitalCategoryRoute(route.target) && !new URLSearchParams(normalizeDigitalTarget(route.target).split('?')[1] || '').get('id')) {
    navigateDataList(normalizeDigitalTarget(route.target), entityTitle(entity));
    return;
  }
  if (mobilePresentation.value && isDigitalCategoryRoute(route.target)) {
    try {
      const category = await resolveDynamicCategory(entity);
      navigateDataList(String(category.url), entityTitle(category), String(category.subTitle || category.sub_title || ''));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '分类加载失败', 'error');
    }
    return;
  }
  if (isDigitalCategoryRoute(route.target) && openDigitalCategory(entity, route.target)) return;
  const digitalTab = findDigitalTabForEntity(entity);
  if (digitalTab) {
    selectDigitalTab(digitalTab);
    return;
  }
  if (route.kind === 'web') {
    void CoolapkTauriAPI.openUrl(route.target, 'internal');
  } else if (route.kind === 'native') {
    navigateNative(route.target, route.title || entityTitle(entity));
  } else {
    navigateDataList(route.target, route.title || entityTitle(entity));
  }
}

function openWeb(url: string) {
  if (isWebUrl(url)) void CoolapkTauriAPI.openUrl(url, 'internal');
}

function navigateDataList(target: string, title: string, subTitle = '') {
  void router.push({ path: '/page', query: { url: target, title, subTitle, renderer: 'discovery' } });
}

function navigateNative(target: string, title: string) {
  const clean = target.replace(/^#/, '');
  const user = clean.match(/^\/user\/([^/?#]+)/);
  const feed = clean.match(/^\/feed\/([^/?#]+)/);
  const app = clean.match(/^\/apk\/([^/?#]+)/);
  // 列表地址与详情共用前缀，只有数字产品 ID 才打开详情。
  const product = clean.match(/^\/product\/(\d+)(?=[/?#]|$)/);
  const topic = clean.match(/^\/topic\/([^/?#]+)/);
  const dyh = clean.match(/^\/dyh\/([^/?#]+)/);
  if (user) void router.push(`/user/${user[1]}`);
  else if (feed) void router.push(`/feed/${feed[1]}`);
  else if (app) void router.push(`/app/${encodeURIComponent(decodeDiscoveryRouteSegment(app[1]))}`);
  else if (product) void router.push(`/product/${product[1]}`);
  else if (topic) void router.push(`/topic/${encodeURIComponent(decodeDiscoveryRouteSegment(topic[1]))}`);
  else if (dyh) void router.push(`/dyh/${dyh[1]}`);
  else navigateDataList(target, title);
}

function handleScroll(event: Event) {
  const element = event.target as HTMLElement;
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 480) {
    if (isDynamicCategoryView.value) void loadDynamicCategory(true);
    else void loadProducts(true);
  }
}

function handleTabScroll(event: Event) {
  const element = event.target as HTMLElement;
  if (!selectedTabWebUrl.value && element && element.scrollHeight - element.scrollTop - element.clientHeight < 480) void loadTabItems(true);
}

function observePaginationSentinels() {
  productObserver?.disconnect();
  dynamicCategoryObserver?.disconnect();
  tabObserver?.disconnect();
  productObserver = null;
  dynamicCategoryObserver = null;
  tabObserver = null;
  if (!props.channelActive || typeof IntersectionObserver === 'undefined') return;
  if (productBottomSentinel.value) {
    productObserver = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadProducts(true); }, { root: productScrollContainer.value, rootMargin: '480px 0px' });
    productObserver.observe(productBottomSentinel.value);
  }
  if (dynamicCategoryBottomSentinel.value) {
    dynamicCategoryObserver = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadDynamicCategory(true); }, { root: productScrollContainer.value, rootMargin: '480px 0px' });
    dynamicCategoryObserver.observe(dynamicCategoryBottomSentinel.value);
  }
  if (tabBottomSentinel.value) {
    tabObserver = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadTabItems(true); }, { root: tabScrollContainer.value, rootMargin: '480px 0px' });
    tabObserver.observe(tabBottomSentinel.value);
  }
}

function formatCount(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(value);
}

watch([productBottomSentinel, dynamicCategoryBottomSentinel, tabBottomSentinel, productScrollContainer, tabScrollContainer, () => props.channelActive], () => { void nextTick(observePaginationSentinels); }, { flush: 'post' });
// 桌面布局仍使用原页面；从移动布局切回时补加载当前栏目。
watch(mobilePresentation, mobile => { if (!mobile && !props.channelOnly && selectedTab.value) selectDigitalTab(selectedTab.value); });

onMounted(() => { void loadDigitalConfig(); });

onBeforeUnmount(() => { productObserver?.disconnect(); dynamicCategoryObserver?.disconnect(); tabObserver?.disconnect(); productObserver = null; dynamicCategoryObserver = null; tabObserver = null; });

// 下拉仅刷新当前栏目，不切换筛选、路由或页面实例。
async function refreshMobilePage() { if (!digitalTabs.value.length) { await loadDigitalConfig(); return; } if (isCategoryTab.value) { productPage.value = 1; productNoMore.value = false; firstItem.value = ''; lastItem.value = ''; await loadProducts(false); } else if (isDynamicCategoryView.value) { dynamicCategoryPage.value = 1; dynamicCategoryNoMore.value = false; dynamicCategoryFirstItem.value = ''; dynamicCategoryLastItem.value = ''; await loadDynamicCategory(false); } else { tabPage.value = 1; tabNoMore.value = false; tabFirstItem.value = ''; tabLastItem.value = ''; await loadTabItems(false); } }
</script>

<style scoped>
.digital-page { display: flex; flex: 1 1 auto; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--surface); color: var(--text-primary); }
.digital-subtabs { display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 24px; border-bottom: 1px solid var(--divider); background: var(--surface); }
.digital-subtab { display: inline-flex; align-items: center; justify-content: center; min-height: 34px; padding: 0 16px; border: 1px solid transparent; border-radius: 18px; background: var(--surface-hover); color: var(--text-secondary); cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; }
.digital-subtab:hover, .digital-subtab.active { border-color: var(--brand-green-border, rgba(16, 185, 102, .22)); background: var(--brand-soft, rgba(16, 185, 129, .1)); color: var(--brand-primary); }
.digital-config-state { display: grid; place-items: center; flex: 1 1 auto; min-height: 300px; }
.digital-web-route { display: flex; align-items: center; gap: 14px; max-width: 960px; width: calc(100% - 44px); padding: 18px; margin: 24px auto; border: 1px solid var(--border-light, rgba(0, 0, 0, .08)); border-radius: 12px; background: var(--surface); }
.digital-web-route > i { color: var(--brand-primary); font-size: 24px; }
.digital-web-route > div { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 5px; }
.digital-web-route span { overflow: hidden; color: var(--text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.digital-web-route button { border: 0; border-radius: 8px; padding: 8px 14px; background: var(--brand-primary); color: #fff; cursor: pointer; font: inherit; font-size: 12px; }
.mode-button, .digital-search button { border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; font: inherit; }
.digital-search button:hover { background: var(--surface-hover); color: var(--brand-primary); }
.digital-body { display: grid; grid-template-columns: minmax(250px, 300px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; }
.digital-sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--divider); background: var(--surface); }
.sidebar-options { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.library-filter-bar { display: flex; flex-shrink: 0; align-items: center; border-bottom: 1px solid var(--divider); background: var(--surface); }
.library-filter-bar button { display: flex; align-items: center; justify-content: center; gap: 8px; flex: 1; min-height: 44px; border: 0; background: transparent; color: var(--text-secondary); font: inherit; font-size: 14px; cursor: pointer; }
.library-filter-bar button.active { color: var(--brand-primary); font-weight: 600; }
.library-filter-bar i { font-size: 11px; }
.library-filter-bar .library-collapse { flex: 0 0 40px; }
.sidebar-toolbar { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-bottom: 1px solid var(--divider); }
.mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px; border-radius: 9px; background: var(--surface-hover); }
.mode-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; border-radius: 7px; font-size: 13px; }
.mode-button.active { background: var(--surface); color: var(--brand-primary); font-weight: 700; box-shadow: 0 2px 8px rgba(0, 0, 0, .06); }
.dynamic-mode-label { display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 9px; border-radius: 9px; background: var(--brand-soft, rgba(16, 185, 129, .1)); color: var(--brand-primary); font-size: 13px; font-weight: 700; }
.dynamic-mode-label > span { flex: 1; }
.dynamic-mode-label button { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; }
.dynamic-mode-label button:hover { background: var(--surface); }
.digital-search { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border: 1px solid var(--border-light); border-radius: 8px; background: var(--surface-hover); color: var(--text-tertiary); }
.digital-search:focus-within { border-color: var(--brand-primary); background: var(--surface); box-shadow: 0 0 0 3px var(--brand-soft, rgba(16, 185, 129, .12)); }
.digital-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; }
.digital-side-list { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; gap: 1px; overflow-y: auto; padding: 0 8px 16px; }
.digital-side-item { display: flex; align-items: center; gap: 11px; min-height: 58px; width: 100%; padding: 8px 10px; border: 0; border-left: 3px solid transparent; border-radius: 8px; background: transparent; color: var(--text-primary); cursor: pointer; font: inherit; text-align: left; }
.digital-side-item:hover { background: var(--surface-hover); }
.digital-side-item.active { border-left-color: var(--brand-primary); background: var(--brand-soft, rgba(16, 185, 129, .1)); color: var(--brand-primary); }
.digital-side-logo,
.digital-side-logo-fallback {
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 0;
  overflow: visible;
  background: transparent !important;
}
.digital-side-logo :deep(.app-image-container),
.digital-side-logo.app-image-container {
  background: transparent !important;
  background-color: transparent !important;
}
.digital-side-logo :deep(img),
.digital-side-logo-img {
  width: 100%;
  height: 100%;
  padding: 0;
  object-fit: contain;
  background: transparent !important;
}
:root:not([data-theme='dark']) .digital-side-logo :deep(img),
:root:not([data-theme='dark']) .digital-side-logo-img {
  mix-blend-mode: multiply;
}
.digital-side-logo-fallback {
  display: grid;
  place-items: center;
  background: transparent;
  color: var(--text-tertiary);
}
.digital-side-hot-logo { color: var(--warning, #f59e0b); font-size: 20px; }
.digital-side-item.active .digital-side-hot-logo { color: var(--brand-primary); }
.digital-side-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.digital-side-count { color: var(--text-tertiary); font-size: 11px; }
.digital-state, .digital-result-state { display: grid; place-items: center; flex: 1 1 auto; min-height: 220px; }
.digital-content, .digital-server-content { min-width: 0; min-height: 0; height: 100%; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; background: var(--surface-hover); padding-bottom: var(--mobile-bottom-overlay-space, 0px); }
.digital-server-content { flex: 1 1 0; }
.digital-server-list { display: flex; flex-direction: column; gap: 14px; max-width: 1280px; padding: 16px 22px 28px; margin: 0 auto; }
.digital-result-list.grid, .digital-server-list.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); align-content: start; }
.digital-result-list.grid > :not(.digital-entity-item), .digital-server-list.grid > :not(.digital-entity-item),
.digital-result-list.grid > .digital-entity-item.is-group, .digital-server-list.grid > .digital-entity-item.is-group { grid-column: 1 / -1; }
.digital-entity-item { min-width: 0; }
.digital-content-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 22px;
  background: var(--surface);
  border-bottom: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  position: sticky;
  top: 0;
  z-index: 10;
}
.toolbar-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.toolbar-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}
.toolbar-count {
  font-size: 12px;
  color: var(--text-tertiary);
}
.view-switcher {
  display: inline-flex;
  padding: 2px;
  background: var(--surface-hover);
  border-radius: 8px;
  gap: 2px;
}
.view-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.view-btn:hover {
  color: var(--text-primary);
}
.view-btn.active {
  background: var(--surface);
  color: var(--brand-primary);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.digital-server-products { display: grid; gap: 14px; }
.digital-result-list { display: flex; flex-direction: column; gap: 14px; max-width: 1280px; padding: 16px 22px 28px; margin: 0 auto; }
.series-title { padding: 4px 3px 0; }
.series-title h3 { margin: 0; color: var(--text-primary); font-size: 17px; }
.series-more { display: inline-flex; align-items: center; justify-content: space-between; gap: 9px; min-height: 34px; align-self: flex-start; padding: 0 3px; border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; font: inherit; font-size: 12px; }
.series-more.inline { align-self: center; padding: 0 10px; }
.series-products { display: grid; gap: 14px; }
.series-products.grid, .digital-server-products.grid { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.series-products.vertical, .digital-server-products.vertical { grid-template-columns: minmax(0, 1fr); gap: 10px; }
.series-products.horizontal { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; }
.series-products.horizontal .series-more { grid-column: 1 / -1; justify-self: end; }
.digital-pagination { min-height: 44px; display: grid; place-items: center; color: var(--text-tertiary); font-size: 12px; }
.inline-retry { border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; font: inherit; }
.digital-content-empty { display: grid; place-items: center; gap: 9px; min-height: 360px; color: var(--text-tertiary); font-size: 13px; }
.digital-content-empty i { font-size: 25px; }
.mobile-digital-list { display: flex; flex-direction: column; gap: 8px; padding: 8px 8px 16px; }
@media (max-width: 720px) {
  .digital-page.is-mobile-presentation { background: var(--surface-hover); }
  .is-mobile-presentation :deep(.feed-tabs-wrapper) { background: var(--surface); border-bottom: 0; }
  .is-mobile-presentation :deep(.feed-tabs) { gap: 0; padding-inline: 4px; }
  .is-mobile-presentation :deep(.tab-item) { flex: 0 0 auto; padding-inline: 12px; font-size: 16px; }
  .is-mobile-presentation :deep(.tab-item.is-active) { font-weight: 700; }
  .is-mobile-presentation .digital-server-content { background: var(--surface-hover); border-radius: 14px 14px 0 0; }
}
@media (max-width: 980px) { .digital-body { grid-template-columns: minmax(220px, 250px) minmax(0, 1fr); } .series-products.horizontal { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .digital-subtabs { padding-inline: 16px; } .digital-web-route { align-items: flex-start; flex-wrap: wrap; width: calc(100% - 32px); margin: 16px auto; } .digital-web-route button { margin-left: 38px; } .digital-body { display: flex; flex-direction: column; overflow: hidden; } .digital-sidebar { flex: 0 0 auto; max-height: 285px; border-right: 0; border-bottom: 1px solid var(--divider); } .digital-content, .digital-server-content { flex: 1 1 0; height: auto; } .digital-side-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow-y: auto; } .digital-side-item { min-height: 50px; } .digital-side-logo, .digital-side-logo-fallback { flex-basis: 32px; width: 32px; height: 32px; } .digital-result-list, .digital-server-list { padding: 14px 16px 24px; } .series-products.horizontal { grid-template-columns: 1fr; } }
/* 官方 product_brand_list 为左右结构，品牌分组栏宽 84dp。 */
@media (max-width: 720px) {
  .digital-body.is-library { display: grid; grid-template-columns: 84px minmax(0, 1fr); }
  .is-library .digital-sidebar { max-height: none; border-bottom: 0; border-right: 1px solid var(--divider); }
  .is-library.is-selector-collapsed { grid-template-columns: minmax(0, 1fr); }
  .is-selector-collapsed .digital-sidebar { display: none; }
  .is-library .sidebar-toolbar { padding: 8px 4px; }
  .is-library .digital-search { gap: 3px; padding-inline: 4px; }
  .is-library .digital-search input { width: 0; min-width: 0; font-size: 11px; }
  .is-library .digital-search > i { font-size: 11px; }
  .is-library .digital-side-list { display: flex; flex-direction: column; }
  .is-library .digital-side-item { flex-shrink: 0; justify-content: center; min-height: 48px; padding: 12px 8px; border-radius: 0; font-size: 12px; }
  .is-library .digital-side-name { text-align: center; white-space: normal; overflow-wrap: anywhere; }
  .is-library .digital-side-logo, .is-library .digital-side-logo-fallback, .is-library .digital-side-count { display: none; }
  .is-library .digital-content-toolbar { padding: 10px 12px; gap: 6px; flex-wrap: wrap; }
  .is-library .toolbar-title { font-size: 15px; }
  .is-library .digital-result-list { padding: 12px; }
  .is-library .series-products.grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
