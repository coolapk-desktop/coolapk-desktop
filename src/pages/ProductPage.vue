<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: headerLoading || feedsLoading || externalLoading || mediaLoading || ratingsLoading }" class="page-container custom-scrollbar" @scroll="handleScroll">
    <div v-if="headerLoading" class="product-header-card skeleton-header">
      <LoadingState text="正在加载产品信息..." />
    </div>

    <div v-else-if="headerError" class="product-header-card skeleton-header">
      <ErrorState title="加载失败" message="无法获取产品信息" @retry="fetchProductHeader" />
    </div>

    <div v-else-if="productDetail" class="product-header-card">
      <div class="header-content">
        <div class="product-icon-wrapper">
          <AppImage
            v-if="productLogo"
            :src="productLogo"
            class="product-icon"
            fit="cover"
            :alt="productTitle"
          />
          <div v-else class="product-icon-fallback">
            <i class="fas fa-microchip"></i>
          </div>
        </div>

        <div class="product-info">
          <h2 class="product-title">{{ productTitle }}</h2>
          <div v-if="productDescription" class="product-desc-text">
            {{ productDescription }}
          </div>
          <div class="product-stats">
            <span v-if="productDetail.hot_num_txt || productDetail.hot_num">{{ productDetail.hot_num_txt || formatCount(productDetail.hot_num) }} 热度</span>
            <span v-if="productDetail.feed_comment_num_txt || productDetail.feed_comment_num">{{ productDetail.feed_comment_num_txt || productDetail.feed_comment_num }} 讨论</span>
            <span v-if="productDetail.follow_num_txt || productDetail.follow_num">{{ productDetail.follow_num_txt || productDetail.follow_num }} 关注</span>
          </div>
        </div>

        <div class="header-actions">
          <button
            type="button"
            :class="['wish-btn', { active: isFollowing }]"
            :disabled="followPending"
            @click="toggleFollow"
          >
            <i :class="isFollowing ? 'fas fa-check' : 'fas fa-plus'"></i>
            <span>{{ isFollowing ? '已关注' : '关注' }}</span>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="product-header-card skeleton-header">
      <EmptyState title="未找到该产品信息" description="该产品可能已下架或ID不正确" />
    </div>

    <div v-if="productDetail && productScore > 0" class="product-score-card">
      <div class="product-score-head"><strong>酷安评分</strong><button type="button" @click="selectTab('rating')">详细数据 <i class="fas fa-chevron-right"></i></button></div>
      <div class="product-score-body">
        <div class="product-score-number"><strong>{{ productScore.toFixed(1) }}</strong><span>{{ productDetail.owner_star_average_score ? '机主评分' : '全部用户评分' }} · {{ productDetail.owner_star_average_score ? (productDetail.owner_rating_total_num || productDetail.owner_star_total_count || 0) : (productDetail.rating_total_num || productDetail.star_total_count || 0) }} 人</span></div>
        <div v-if="productRatingSpecs.length" class="product-score-specs">
          <div v-for="item in productRatingSpecs" :key="item.name"><span>{{ item.name }}</span><div class="rating-distribution-track"><i :style="{ width: `${Math.min(100, item.score * 10)}%` }" /></div><span>{{ item.score.toFixed(1) }}</span></div>
        </div>
      </div>
      <div class="product-score-actions">
        <span v-if="productDetail.owner_rating_total_num">{{ productDetail.owner_rating_total_num }} 机主点评</span>
        <button type="button" :class="['buy-btn', { active: isWished }]" :disabled="wishPending" @click="toggleWish">{{ isWished ? '已想买' : '想买' }}</button>
        <button type="button" class="buy-btn" @click="openRatingComposer">打分</button>
      </div>
    </div>

    <div v-if="productSpecs.length" class="product-spec-chips custom-scrollbar">
      <span v-for="spec in productSpecs" :key="spec">{{ spec }}</span>
    </div>

    <div
      v-if="allTabs.length"
      ref="productTabsRef"
      :class="['product-sub-tabs', 'custom-scrollbar', { 'is-dragging': productTabsDragging }]"
      @wheel="handleProductTabWheel"
      @pointerdown="startProductTabDrag"
      @pointermove="moveProductTabDrag"
      @pointerup="endProductTabDrag"
      @pointercancel="endProductTabDrag"
      @click.capture="cancelClickAfterTabDrag"
    >
      <button
        v-for="tab in allTabs"
        :key="tab.key"
        :class="['product-tab-item', { active: activeTab === tab.key }]"
        @click="selectTab(tab.key)"
      >
        <span>{{ tab.label }}</span>
        <span v-if="activeTab === tab.key" class="tab-line"></span>
      </button>
    </div>

    <!-- ===== 动态 Tab ===== -->
    <template v-if="isFeedTab">
      <EntityFilterBar v-if="!selectedSubId"
        v-model:sort="currentSort"
        v-model:search-keyword="searchKeyword"
        :sort-options="sortOptions"
        :search-sort-options="FEED_SEARCH_SORT_OPTIONS"
        :feed-type="searchFeedType"
        :feed-type-options="PRODUCT_FEED_TYPE_OPTIONS"
        show-feed-type
        :target-title="productTitle"
        scope-type="product_phone"
        :scope-param="productId"
        :auto-navigate-search="false"
        @change="handleSortChange"
        @search="handleProductSearch"
        @clear="handleProductClear"
        @change-feed-type="handleProductFeedTypeChange"
      />

      <div v-if="feedsLoading && page === 1" class="loading-wrapper">
        <LoadingState text="正在获取产品动态..." />
      </div>

      <div v-else-if="feedsError && productFeeds.length === 0" class="error-wrapper">
        <ErrorState title="动态加载失败" message="无法获取该产品的动态，请检查网络后重试" @retry="retryFeeds" />
      </div>

      <div v-else-if="productFeeds.length === 0 && !feedsLoading" class="empty-wrapper">
        <div v-if="selectedSubId === '1'" class="product-subtab-empty">
          <section class="product-subtab-empty-card">
            <div class="product-subtab-empty-title"><i class="fas fa-battery-half"></i><span>续航时长</span></div>
            <p>暂无人分享续航时长</p>
          </section>
          <p class="product-subtab-empty-invite">还没人分享续航时长，说说你用这个产品的续航时长～</p>
        </div>
        <EmptyState v-else title="暂无相关动态" />
      </div>

      <div v-else class="feed-list">
        <FeedCard v-for="item in productFeeds" :key="item.id || item.ttype + item.uid" :feed="item" :highlight-keyword="searchKeyword" @deleted="handleFeedDeleted" />

        <div class="pagination-footer">
          <LoadingState v-if="feedsLoading && page > 1" text="加载更多中..." />
          <button v-else-if="feedsError" class="retry-inline" @click="retryFeeds">加载失败，点击重试</button>
          <div v-else-if="noMore" class="no-more">没有更多动态了</div>
        </div>
      </div>
    </template>

    <template v-if="selectedTab?.kind === 'external'">
      <div v-if="externalLoading && externalItems.length === 0" class="loading-wrapper"><LoadingState text="正在加载栏目内容..." /></div>
      <div v-else-if="externalError && externalItems.length === 0" class="error-wrapper"><ErrorState title="栏目加载失败" :message="externalError" @retry="fetchExternalTab(false)" /></div>
      <div v-else-if="externalItems.length === 0" class="empty-wrapper"><EmptyState title="暂无内容" /></div>
      <div v-else class="feed-list">
        <DiscoveryEntityCard v-for="(item, index) in externalItems" :key="getEntityKey(item, index)" :entity="item" @open="openExternalEntity" />
        <div class="pagination-footer">
          <LoadingState v-if="externalLoading" text="加载更多中..." />
          <button v-else-if="externalError" class="retry-inline" @click="fetchExternalTab(true)">加载失败，点击重试</button>
          <div v-else-if="externalNoMore" class="no-more">没有更多内容了</div>
        </div>
      </div>
    </template>

    <!-- ===== 参数 Tab ===== -->
    <template v-else-if="activeTab === 'config'">
      <div class="config-tab-content">
        <div v-if="configLoading" class="loading-wrapper">
          <LoadingState text="正在加载配置信息..." />
        </div>

        <div v-else-if="configList.length === 0" class="empty-wrapper">
          <EmptyState title="该产品暂无公开配置" description="可以查看其他数码产品获取参数信息" />
        </div>

        <template v-else>
          <div class="config-toolbar">
            <span class="config-toolbar-title">
              <i class="fas fa-table-list"></i> 版本配置（{{ configList.length }}）
            </span>
            <button
              type="button"
              class="compare-btn"
              :disabled="compareSelected.length < 2"
              @click="goCompare"
            >
              <i class="fas fa-code-compare"></i> 对比配置（{{ compareSelected.length }}）
            </button>
          </div>

          <div class="config-list">
            <div
              v-for="config in configList"
              :key="String(config.id)"
              :class="['config-card', { active: selectedConfigId === String(config.id) }]"
              @click="selectConfig(String(config.id))"
            >
              <div class="config-check">
                <i :class="selectedConfigId === String(config.id) ? 'fas fa-circle-dot' : 'far fa-circle'"></i>
              </div>
              <div class="config-info">
                <div class="config-title-row">
                  <strong class="config-title">{{ config.title }}</strong>
                  <span v-if="String(config.is_add_compare) === '1'" class="comparing-badge">对比中</span>
                </div>
                <div class="config-meta">
                  <span v-if="config.price">参考价 ¥{{ config.price }}</span>
                  <span v-if="config.release_time">发布于 {{ config.release_time }}</span>
                  <span v-if="config.cpu">{{ config.cpu }}</span>
                  <span v-if="config.ram">{{ config.ram }}</span>
                </div>
              </div>
              <div class="config-actions" @click.stop>
                <button
                  type="button"
                  :class="['compare-toggle', { active: compareSelected.includes(String(config.id)) }]"
                  :disabled="comparePending"
                  @click="toggleCompareSelected(String(config.id))"
                >
                  <i :class="compareSelected.includes(String(config.id)) ? 'fas fa-check-square' : 'far fa-square'"></i>
                  {{ compareSelected.includes(String(config.id)) ? '已选对比' : '加入对比' }}
                </button>
                <button
                  type="button"
                  :class="['server-compare-toggle', { active: String(config.is_add_compare) === '1' }]"
                  :disabled="serverComparePending"
                  @click="toggleServerCompare(String(config.id))"
                >
                  <i class="fas fa-cloud-upload-alt"></i>
                  {{ String(config.is_add_compare) === '1' ? '移出对比' : '加入对比' }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="selectedConfig" class="config-detail">
            <div class="config-detail-head">
              <span class="config-detail-title"><i class="fas fa-microchip"></i> {{ selectedConfig.title }} 详细参数</span>
            </div>
            <ProductConfigTable :config="selectedConfig" />
          </div>
        </template>
      </div>
    </template>

    <!-- ===== 媒体 Tab ===== -->
    <template v-else-if="activeTab === 'media'">
      <div class="media-sub-tabs">
        <button
          v-for="filter in mediaFilters"
          :key="filter.key"
          type="button"
          :class="['media-filter-btn', { active: activeMediaFilter === filter.key }]"
          @click="selectMediaFilter(filter.key)"
        >
          {{ filter.label }}
        </button>
      </div>

      <div v-if="mediaLoading && mediaList.length === 0" class="loading-wrapper">
        <LoadingState text="正在加载产品图集..." />
      </div>

      <div v-else-if="mediaError && mediaList.length === 0" class="error-wrapper">
        <ErrorState title="图集加载失败" message="无法获取该产品的图片/视频，请检查网络后重试" @retry="fetchMedia" />
      </div>

      <div v-else-if="mediaList.length === 0" class="empty-wrapper">
        <EmptyState title="暂无媒体内容" description="该筛选条件下没有可展示的图片或视频" />
      </div>

      <div v-else class="media-grid">
        <div
          v-for="(item, index) in mediaList"
          :key="String(item.id ?? item.entityId ?? index)"
          class="media-item"
          @click="openMedia(index)"
        >
          <AppImage :src="mediaThumb(item)" image-class="media-img" :alt="mediaTypeText(item)" loading="lazy" />
          <span v-if="isVideo(item)" class="media-play-badge"><i class="fas fa-play"></i></span>
          <span class="media-type-badge">{{ isVideo(item) ? '视频' : '图片' }}</span>
        </div>

        <div class="pagination-footer">
          <LoadingState v-if="mediaLoading" text="加载更多中..." />
          <button v-else-if="mediaError" class="retry-inline" @click="fetchMedia(true)">加载失败，点击重试</button>
          <div v-else-if="mediaNoMore" class="no-more">没有更多内容了</div>
        </div>
      </div>
    </template>

    <!-- ===== 评分 Tab ===== -->
    <template v-else-if="activeTab === 'rating'">
      <div class="rating-tab-content">
        <!-- 我的评分 -->
        <div class="my-rating-card rating-compose-card">
          <div class="my-rating-head">
            <span class="section-title"><i class="fas fa-star"></i> 我的打分</span>
            <span v-if="myRating > 0" class="login-hint">当前已评 {{ myRating }} 星</span>
          </div>

          <button v-if="myRating === 0 && !showRatingComposer" type="button" class="rating-entry" @click="openRatingComposer">
            <span>点击星星评分</span><span class="rating-entry-stars" aria-hidden="true">☆☆☆☆☆</span><i class="fas fa-chevron-right"></i>
          </button>

          <div v-if="authStore.isLoggedIn && myRating > 0" class="rating-login-tip">
            <span>你已为该产品评 {{ myRating }} 星</span>
            <button v-if="myRatingFeedId" type="button" class="login-btn" @click="router.push(`/feed/${myRatingFeedId}`)">查看我的点评</button>
          </div>
          <div v-else-if="authStore.isLoggedIn && showRatingComposer" class="rating-composer">
            <div class="star-input">
              <button
                v-for="star in 5"
                :key="star"
                type="button"
                class="star-btn"
                :class="{ active: star <= selectedRating }"
                @click="setMyRating(star)"
                :title="`${star} 星`"
              >
                <i :class="star <= selectedRating ? 'fas fa-star' : 'far fa-star'"></i>
              </button>
              <span class="rating-hint-text">
                {{ selectedRating > 0 ? `已选 ${selectedRating} 星` : '选择星级后发布点评' }}
              </span>
            </div>
            <textarea v-model="ratingMessage" class="rating-message" maxlength="1000" placeholder="说一说你对这个产品的评价吧（可选）" />
            <div class="rating-options">
              <label class="buy-option">
                <input v-model="buyChecked" type="checkbox" />
                <span>我已购买该产品</span>
              </label>
              <button type="button" class="login-btn" :disabled="ratingPending || selectedRating === 0" @click="submitRating">发布点评</button>
            </div>
            <div v-if="ratingPending" class="rating-pending"><LoadingState text="正在提交评分..." /></div>
          </div>

          <div v-else-if="!authStore.isLoggedIn && showRatingComposer" class="rating-login-tip">
            <span>评分需要登录酷安账号</span>
            <button type="button" class="login-btn" @click="authStore.openLoginModal()">立即登录</button>
          </div>
        </div>

        <div v-if="ratingSummary.total > 0" class="my-rating-card rating-summary-card">
          <div class="rating-list-head">
            <span class="section-title"><i class="fas fa-star"></i> 评分概览</span>
            <div class="rating-list-filter">
              <button v-for="filter in ratingListFilters" :key="filter.key" type="button"
                :class="['filter-pill', { active: summaryAudience === filter.key }]" @click="summaryAudience = filter.key">
                {{ filter.label }}
              </button>
            </div>
          </div>
          <div class="rating-overview">
            <div class="rating-overview-score"><strong>{{ ratingSummary.score.toFixed(1) }}</strong><span>{{ ratingSummary.total }} 人评分</span></div>
            <div class="rating-distribution">
              <div v-for="item in ratingSummary.stars" :key="item.star" class="rating-distribution-row">
                <span>{{ item.star }} 星</span><div class="rating-distribution-track"><i :style="{ width: `${item.percent}%` }" /></div><span>{{ item.count }}</span>
              </div>
            </div>
          </div>
          <div v-if="ratingSummary.recentCount > 0" class="rating-recent">最近 30 天：{{ ratingSummary.recentScore.toFixed(1) }} 分 · {{ ratingSummary.recentCount }} 人评分<span v-if="ratingSummary.positiveRate !== null"> · 好评率 {{ ratingSummary.positiveRate }}%</span></div>
          <div v-if="ratingDimensions.length" class="rating-dimensions">
            <span v-for="item in ratingDimensions" :key="item.name">{{ item.name }} {{ item.score.toFixed(1) }}</span>
          </div>
        </div>

        <!-- 评分趋势图 -->
        <div ref="ratingChartRef" class="rating-chart-wrapper">
          <div v-if="chartLoading" class="loading-wrapper">
            <LoadingState text="正在加载评分趋势..." />
          </div>
          <div v-else-if="chartError" class="error-wrapper">
            <ErrorState title="评分趋势加载失败" message="无法获取该产品的评分趋势数据" @retry="fetchRatingChart" />
          </div>
          <RatingChart v-else :periods="ratingChartPeriods" />
        </div>

        <!-- 用户评分列表 -->
        <div class="rating-list-section">
          <div class="rating-list-head">
            <span class="section-title">排序规则</span>
            <div class="rating-list-filter rating-sort-filter">
              <button
                v-for="option in ratingSortOptions"
                :key="option.url"
                type="button"
                :class="['filter-pill', { active: activeRatingSortUrl === option.url }]"
                :disabled="ratingsLoading"
                @click="selectRatingSort(option.url)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div v-if="ratingsLoading && ratings.length === 0" class="loading-wrapper">
            <LoadingState text="正在加载评分列表..." />
          </div>

          <div v-else-if="ratingsError && ratings.length === 0" class="error-wrapper">
            <ErrorState title="评分列表加载失败" message="无法获取该产品的用户评分" @retry="fetchRatings" />
          </div>

          <div v-else-if="ratings.length === 0" class="empty-wrapper">
            <EmptyState title="暂无评分" description="还没有用户对该产品评分" />
          </div>

          <div v-else class="rating-list">
            <RatingCard v-for="item in ratings" :key="item.id || item.entityId || item.uid" :feed="item" />

            <div class="pagination-footer">
              <LoadingState v-if="ratingsLoading" text="加载更多中..." />
              <button v-else-if="ratingsError" class="retry-inline" @click="fetchRatings(true)">加载失败，点击重试</button>
              <div v-else-if="ratingsNoMore" class="no-more">没有更多评分了</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import FeedCard from '../components/feed/FeedCard.vue';
import RatingCard from '../components/feed/RatingCard.vue';
import AppImage from '../components/common/AppImage.vue';
import LoadingState from '../components/common/LoadingState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ProductConfigTable from '../components/product/ProductConfigTable.vue';
import RatingChart from '../components/product/RatingChart.vue';
import DiscoveryEntityCard from '../components/discovery/DiscoveryEntityCard.vue';
import EntityFilterBar, { type SortOptionItem } from '../components/common/EntityFilterBar.vue';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { showToast } from '../utils/toast';
import { getErrorMessage } from '../utils/errors';
import { getHdImageUrl } from '../utils/image';
import type { ProductConfig, ProductMedia, RatingChartPeriods } from '../types/product';
import { usePageTabTitle } from '../composables/usePageTabTitle';
import {
  FEED_SEARCH_SORT_OPTIONS,
  PRODUCT_FEED_TYPE_OPTIONS,
  resolveFeedSearchSort,
} from '../utils/coolapkFeedSearch';
import { productTabs } from '../utils/productTabs';
import { getEntityKey, parseDiscoveryPage, resolveDiscoveryRoute } from '../utils/discovery';
import { normalizeCoolapkRoute } from '../utils/coolapkRoute';
import { productRatingRows, productRatingSortOptions, type ProductRatingSortOption } from '../utils/productRatingSort';
import type { DiscoveryEntity } from '../types/discovery';

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const authStore = useAuthStore();
// 固定当前缓存页面的参数，避免隐藏后跟随全局路由变化重新加载。
const productId = ref(route.params.productId as string);

const productDetail = ref<any>(null);
const headerLoading = ref(false);
const headerError = ref(false);

const productFeeds = ref<any[]>([]);

function handleFeedDeleted(id: string | number) {
  productFeeds.value = productFeeds.value.filter((f: any) => String(f.id) !== String(id));
}
const feedsLoading = ref(false);
const feedsError = ref(false);
const page = ref(1);
const noMore = ref(false);

const allTabs = computed(() => productTabs(productId.value, productDetail.value?.tabList));
const selectedTab = computed(() => allTabs.value.find((tab) => tab.key === activeTab.value));
const productTabsRef = ref<HTMLElement | null>(null);
const productTabsDragging = ref(false);
let productTabsPointerStartX = 0;
let productTabsScrollStartX = 0;
let productTabsPointerId: number | null = null;
let productTabsDidDrag = false;
const externalItems = ref<DiscoveryEntity[]>([]);
const externalLoading = ref(false);
const externalError = ref('');
const externalNoMore = ref(false);
const externalPage = ref(1);
const externalFirstItem = ref('');
const externalLastItem = ref('');

async function fetchExternalTab(loadMore: boolean) {
  const tab = selectedTab.value;
  if (tab?.kind !== 'external' || externalLoading.value || (loadMore && externalNoMore.value)) return;
  externalLoading.value = true;
  externalError.value = '';
  if (!loadMore) {
    externalItems.value = [];
    externalPage.value = 1;
    externalNoMore.value = false;
    externalFirstItem.value = '';
    externalLastItem.value = '';
  }
  try {
    const response = await CoolapkTauriAPI.getDiscoveryPageData({
      url: tab.url, title: tab.label, page: externalPage.value,
      firstItem: externalFirstItem.value, lastItem: externalLastItem.value,
    });
    if (selectedTab.value?.key !== tab.key) return;
    const parsed = parseDiscoveryPage(response, externalPage.value);
    externalItems.value = loadMore ? [...externalItems.value, ...parsed.items] : parsed.items;
    externalFirstItem.value = parsed.firstItem;
    externalLastItem.value = parsed.lastItem;
    externalNoMore.value = !parsed.hasMore || parsed.items.length === 0;
    externalPage.value++;
  } catch (error) {
    if (selectedTab.value?.key === tab.key) externalError.value = getErrorMessage(error, '栏目加载失败');
  } finally {
    externalLoading.value = false;
    if (selectedTab.value?.kind === 'external' && selectedTab.value.key !== tab.key) void fetchExternalTab(false);
  }
}

function openExternalEntity(entity: DiscoveryEntity) {
  const target = resolveDiscoveryRoute(entity);
  if (!target) return;
  if (target.kind === 'web') {
    void CoolapkTauriAPI.openUrl(target.target, 'internal');
    return;
  }
  const native = normalizeCoolapkRoute(target.target);
  if (native) void router.push(native);
  else void router.push({ path: '/page', query: { url: target.target, title: target.title || String(entity.title || ''), renderer: 'discovery' } });
}

function getRequestedTab(value: unknown): string {
  const requested = String(value || '');
  return /^[a-zA-Z0-9:_-]+$/.test(requested) ? requested : 'feed';
}

const activeTab = ref(getRequestedTab(route.query.tab));
const selectedSubId = computed(() => activeTab.value.match(/^subtab:(\d+)$/)?.[1] || '');
const isFeedTab = computed(() => selectedTab.value?.kind === 'feed' || (!productDetail.value && activeTab.value === 'feed'));

const currentSort = ref('default');
const sortOptions: SortOptionItem[] = [
  { key: 'default', label: '默认', listType: '' },
  { key: 'latest', label: '最新', listType: 'dateline_desc' },
  { key: 'hot', label: '热度', listType: 'rank_score' },
];
const searchFeedType = ref('all');

function handleSortChange(key: string) {
  currentSort.value = key;
  resetFeeds();
  void fetchFeeds(false);
}

function selectTab(key: string) {
  const tab = allTabs.value.find((item) => item.key === key);
  if (tab?.kind === 'external' && key !== activeTab.value) externalItems.value = [];
  activeTab.value = key;
  if (tab?.kind === 'external') {
    void fetchExternalTab(false);
  } else if (isFeedTab.value) {
    resetFeeds();
    void fetchFeeds(false);
  } else if (key === 'config') {
    void fetchConfigs();
  } else if (key === 'media') {
    void fetchMedia();
  } else if (key === 'rating') {
    void fetchRatingChart();
    void fetchRatings();
  }
}

function handleProductTabWheel(event: WheelEvent) {
  const tabs = event.currentTarget as HTMLElement;
  if (tabs.scrollWidth <= tabs.clientWidth) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (delta === 0) return;
  event.preventDefault();
  tabs.scrollLeft += delta;
}

function startProductTabDrag(event: PointerEvent) {
  const tabs = event.currentTarget as HTMLElement;
  if (event.button !== 0 || tabs.scrollWidth <= tabs.clientWidth) return;
  productTabsPointerId = event.pointerId;
  productTabsPointerStartX = event.clientX;
  productTabsScrollStartX = tabs.scrollLeft;
  productTabsDidDrag = false;
}

function moveProductTabDrag(event: PointerEvent) {
  if (productTabsPointerId !== event.pointerId || !productTabsRef.value) return;
  const delta = event.clientX - productTabsPointerStartX;
  if (!productTabsDidDrag && Math.abs(delta) < 4) return;
  if (!productTabsDidDrag) {
    productTabsDidDrag = true;
    productTabsDragging.value = true;
    productTabsRef.value.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  productTabsRef.value.scrollLeft = productTabsScrollStartX - delta;
}

function endProductTabDrag(event: PointerEvent) {
  if (productTabsPointerId !== event.pointerId) return;
  productTabsPointerId = null;
  productTabsDragging.value = false;
}

function cancelClickAfterTabDrag(event: MouseEvent) {
  if (!productTabsDidDrag) return;
  event.preventDefault();
  event.stopPropagation();
  productTabsDidDrag = false;
}

const productLogo = computed(() => {
  if (!productDetail.value) return '';
  return productDetail.value.logo
    || productDetail.value.product_logo
    || productDetail.value.pic
    || productDetail.value.icon
    || '';
});

const productTitle = computed(() => {
  if (!productDetail.value) return productId.value;
  return productDetail.value.title
    || productDetail.value.index_title
    || productDetail.value.alias_title
    || productDetail.value.name
    || productId.value;
});
const productScore = computed(() => Number(productDetail.value?.owner_star_average_score || productDetail.value?.rating_average_score || 0));
const productSpecs = computed(() => Array.isArray(productDetail.value?.product_specs)
  ? productDetail.value.product_specs.map(String).filter(Boolean) : []);
const productRatingSpecs = computed(() => {
  const items = productDetail.value?.rating_item_info;
  if (!Array.isArray(items)) return [];
  return items.map((item: any) => ({ name: String(item.name || ''), score: Number(item.owner_average_score || item.average_score || 0) }))
    .filter((item) => item.name && item.score > 0);
});
usePageTabTitle(productTitle);

const productDescription = computed(() => {
  if (!productDetail.value) return '';
  return productDetail.value.description
    || productDetail.value.device_info
    || productDetail.value.subTitle
    || '';
});

async function fetchProductHeader(preserveContent = false) {
  if (!productId.value) return;
  headerLoading.value = true;
  headerError.value = false;
  // 下拉时保留正文，避免子栏目卸载及重复加载。
  if (!preserveContent) productDetail.value = null;
  try {
    const res = await CoolapkTauriAPI.getProductDetail(productId.value);
    if (res?.data && typeof res.data === 'object') {
      productDetail.value = res.data;
      buyChecked.value = isBought.value;
      if (preserveContent && allTabs.value.some((tab) => tab.key === activeTab.value)) return;
      const requested = String(route.query.tab || '');
      const preferred = allTabs.value.find((tab) => tab.key === requested)?.key
        || allTabs.value.find((tab) => tab.key === activeTab.value)?.key
        || allTabs.value.find((tab) => tab.key === (res.data.selectedTab === 'main' ? 'config' : res.data.selectedTab))?.key
        || allTabs.value[0]?.key;
      if (preferred && preferred !== activeTab.value) selectTab(preferred);
      else if (selectedTab.value?.kind === 'feed' && productFeeds.value.length === 0 && !feedsLoading.value) loadActiveTab();
      else if (selectedTab.value?.kind === 'external' && externalItems.value.length === 0 && !externalLoading.value) loadActiveTab();
    } else {
      headerError.value = true;
    }
  } catch (err) {
    headerError.value = true;
    console.warn('获取产品详情失败', err);
  } finally {
    headerLoading.value = false;
  }
}

const searchKeyword = ref('');

function handleProductSearch(payload: { keyword: string }) {
  const keyword = payload.keyword.trim();
  if (!FEED_SEARCH_SORT_OPTIONS.some((option) => option.key === currentSort.value)) {
    currentSort.value = 'default';
  }
  searchKeyword.value = keyword;
  if (!keyword) searchFeedType.value = 'all';
  resetFeeds();
  void fetchFeeds(false);
}

function handleProductClear() {
  searchKeyword.value = '';
  currentSort.value = 'default';
  searchFeedType.value = 'all';
  resetFeeds();
  void fetchFeeds(false);
}

function handleProductFeedTypeChange(feedType: string) {
  searchFeedType.value = feedType;
  if (!searchKeyword.value.trim()) return;
  resetFeeds();
  void fetchFeeds(false);
}

function readFeedCursor(feed: any): string {
  const value = feed?.id ?? feed?.feedId ?? feed?.feed_id ?? feed?.entityId ?? '';
  return value === null || value === undefined ? '' : String(value);
}

async function fetchFeeds(isLoadMore = false) {
  if (!productId.value || feedsLoading.value || noMore.value) return;

  feedsLoading.value = true;
  if (!isLoadMore) feedsError.value = false;
  try {
    const sortOption = sortOptions.find((option) => option.key === currentSort.value) || sortOptions[0];
    const listType = sortOption?.listType || '';
    const kw = searchKeyword.value.trim();
    const firstItem = isLoadMore && productFeeds.value.length > 0 ? readFeedCursor(productFeeds.value[0]) : '';
    const lastItem = isLoadMore && productFeeds.value.length > 0 ? readFeedCursor(productFeeds.value[productFeeds.value.length - 1]) : '';
    let res: any;
    if (selectedSubId.value) {
      res = await CoolapkTauriAPI.getProductSubtabFeeds(productId.value, selectedSubId.value, page.value);
    } else if (kw) {
      const searchSort = resolveFeedSearchSort(currentSort.value);
      res = await CoolapkTauriAPI.searchByType({
        searchType: 'feed',
        query: kw,
        page: page.value,
        firstItem,
        lastItem,
        pageType: 'product_phone',
        pageParam: productId.value,
        feedType: searchFeedType.value,
        sort: searchSort.sort,
        isStrict: searchSort.isStrict,
      });
    } else {
      res = await CoolapkTauriAPI.getProductFeeds(productId.value, activeTab.value, page.value, listType);
    }
    const data = res?.data;
    const newFeeds = Array.isArray(data)
      ? data
      : Array.isArray(data?.entities)
        ? data.entities
        : Array.isArray(data?.rows)
          ? data.rows
          : [];

    if (newFeeds.length === 0) {
      noMore.value = true;
    } else {
      if (isLoadMore) {
        // 与其他列表一致：加载更多按实体键去重，服务端游标重复时不出现重复卡片。
        const existingKeys = new Set(productFeeds.value.map((feed: any, index: number) => getEntityKey(feed, index)));
        productFeeds.value.push(...newFeeds.filter((feed: any, index: number) => !existingKeys.has(getEntityKey(feed, productFeeds.value.length + index))));
      } else {
        productFeeds.value = newFeeds;
      }
      page.value++;
    }
  } catch (err) {
    feedsError.value = true;
    console.warn('获取产品动态失败', err);
  } finally {
    feedsLoading.value = false;
  }
}

// ===== 想要 / 已购 =====
const isWished = computed(() => {
  return productDetail.value?.userAction?.wish === 1 || productDetail.value?.userAction?.wish === true;
});
const isFollowing = computed(() => {
  return productDetail.value?.userAction?.follow === 1 || productDetail.value?.userAction?.follow === true;
});
const isBought = computed(() => {
  return productDetail.value?.userAction?.buy === 1 || productDetail.value?.userAction?.buy === true;
});
const myRating = computed(() => {
  const raw = productDetail.value?.userAction?.rating;
  const num = Number(raw ?? 0);
  return Number.isFinite(num) && num > 0 ? Math.max(1, Math.min(5, Math.round(num))) : 0;
});
const myRatingFeedId = computed(() => {
  const feed = productDetail.value?.ratingFeed || productDetail.value?.rating_feed;
  const direct = feed?.id || feed?.feedId;
  if (direct) return String(direct);
  const url = String(productDetail.value?.userAction?.ratingFeedUrl || '');
  return url.match(/\/feed\/(\d+)/)?.[1] || '';
});

const wishPending = ref(false);
const followPending = ref(false);

function requireLogin(): boolean {
  if (authStore.isLoggedIn) return true;
  authStore.openLoginModal();
  return false;
}

async function toggleWish() {
  if (!requireLogin() || wishPending.value) return;
  const target = !isWished.value;
  wishPending.value = true;
  try {
    await CoolapkTauriAPI.changeProductWishStatus(productId.value, target ? 1 : 0);
    if (productDetail.value) {
      productDetail.value.userAction = {
        ...(productDetail.value.userAction || {}),
        wish: target ? 1 : 0,
      };
      window.dispatchEvent(new CustomEvent('coolapk-product-event', { detail: { productId: productId.value, wished: target, wish: target ? 1 : 0, userAction: productDetail.value.userAction } }));
    }
    showToast(target ? '已加入想要清单' : '已从想要清单移除', 'success');
  } catch (err) {
    showToast(getErrorMessage(err, '操作失败'), 'error');
  } finally {
    wishPending.value = false;
  }
}

async function toggleFollow() {
  if (!requireLogin() || followPending.value) return;
  const target = !isFollowing.value;
  followPending.value = true;
  try {
    await CoolapkTauriAPI.changeProductFollowStatus(productId.value, target ? 1 : 0);
    if (productDetail.value) {
      productDetail.value.userAction = { ...(productDetail.value.userAction || {}), follow: target ? 1 : 0 };
      window.dispatchEvent(new CustomEvent('coolapk-product-event', { detail: { productId: productId.value, follow: target ? 1 : 0, userAction: productDetail.value.userAction } }));
    }
    showToast(target ? '已关注产品' : '已取消关注', 'success');
  } catch (err) {
    showToast(getErrorMessage(err, '操作失败'), 'error');
  } finally {
    followPending.value = false;
  }
}

// ===== 参数 / 配置 =====
const configList = ref<ProductConfig[]>([]);
const selectedConfigId = ref('');
const selectedConfig = ref<ProductConfig | null>(null);
const configLoading = ref(false);
const comparePending = ref(false);
const serverComparePending = ref(false);
const compareSelected = ref<string[]>([]);

async function fetchConfigs() {
  if (configLoading.value) return;
  configLoading.value = true;
  try {
    const rows = Array.isArray(productDetail.value?.configRows) ? productDetail.value.configRows : [];
    configList.value = rows.filter((row: any) => row && (row.id !== undefined && row.id !== null));
    if (configList.value.length > 0) {
      const firstId = String(configList.value[0].id);
      selectedConfigId.value = firstId;
      await loadConfigDetail(firstId);
    } else {
      selectedConfig.value = null;
    }
  } catch (err) {
    console.warn('加载产品配置失败', err);
  } finally {
    configLoading.value = false;
  }
}

async function selectConfig(configId: string) {
  selectedConfigId.value = configId;
  await loadConfigDetail(configId);
}

async function loadConfigDetail(configId: string) {
  try {
    const res = await CoolapkTauriAPI.getProductConfig(configId);
    // 竞态保护：快速连续切换配置时，先发且较慢的响应不得覆盖后选中的配置。
    if (configId !== selectedConfigId.value) return;
    if (res?.data && typeof res.data === 'object') {
      selectedConfig.value = res.data;
    }
  } catch (err) {
    console.warn('加载配置详情失败', err);
  }
}

function toggleCompareSelected(configId: string) {
  const index = compareSelected.value.indexOf(configId);
  if (index >= 0) {
    compareSelected.value.splice(index, 1);
  } else {
    compareSelected.value.push(configId);
  }
}

async function toggleServerCompare(configId: string) {
  if (!requireLogin() || serverComparePending.value) return;
  serverComparePending.value = true;
  try {
    if (String(configList.value.find((item) => String(item.id) === configId)?.is_add_compare) === '1') {
      await CoolapkTauriAPI.removeConfigCompare(configId);
      showToast('已从服务端对比列表移除', 'success');
    } else {
      await CoolapkTauriAPI.addConfigCompare(configId);
      showToast('已加入服务端对比列表', 'success');
    }
    const index = configList.value.findIndex((item) => String(item.id) === configId);
    if (index >= 0) {
      const current = String(configList.value[index].is_add_compare);
      configList.value = [...configList.value];
      configList.value[index] = { ...configList.value[index], is_add_compare: current === '1' ? 0 : 1 };
    }
  } catch (err) {
    showToast(getErrorMessage(err, '操作失败'), 'error');
  } finally {
    serverComparePending.value = false;
  }
}

function goCompare() {
  const ids = compareSelected.value.filter(Boolean);
  if (ids.length < 2) return;
  router.push({
    path: '/product-compare',
    query: {
      ids: ids.join(','),
      productIds: ids.map(() => productId.value).join(','),
    },
  });
}

// ===== 媒体 =====
const mediaFilters = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'recommend', label: '推荐' },
];
const activeMediaFilter = ref('image');
const mediaList = ref<ProductMedia[]>([]);
const mediaLoading = ref(false);
const mediaError = ref(false);
const mediaNoMore = ref(false);
const mediaPage = ref(1);

function mediaTypeText(item: ProductMedia): string {
  return isVideo(item) ? '产品视频' : '产品图片';
}

function isVideo(item: ProductMedia): boolean {
  return String(item.type).toLowerCase() === 'video';
}

function parseMediaInfo(value: unknown): Record<string, any> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
}

function mediaThumb(item: ProductMedia): string {
  if (isVideo(item)) {
    const info = parseMediaInfo(item.media_info);
    const cover = info?.cover_url || info?.coverUrl || info?.pic || item.pic || '';
    return getHdImageUrl(cover || item.url || '');
  }
  return getHdImageUrl(item.url || item.pic || '');
}

function imageUrlOf(item: ProductMedia): string {
  return item.url || item.pic || '';
}

async function selectMediaFilter(key: string) {
  activeMediaFilter.value = key;
  mediaPage.value = 1;
  mediaNoMore.value = false;
  mediaError.value = false;
  mediaList.value = [];
  await fetchMedia();
}

async function fetchMedia(isLoadMore = false) {
  if (!productId.value || mediaLoading.value || mediaNoMore.value) return;
  mediaLoading.value = true;
  if (!isLoadMore) mediaError.value = false;
  try {
    const mediaType = activeMediaFilter.value === 'recommend' ? 'image' : activeMediaFilter.value;
    const isRecommend = activeMediaFilter.value === 'recommend' ? 1 : 0;
    const res = await CoolapkTauriAPI.getProductMediaList(productId.value, mediaType, isRecommend, mediaPage.value);
    const newItems = (res && res.data && Array.isArray(res.data)) ? res.data : [];
    if (newItems.length === 0) {
      mediaNoMore.value = true;
    } else {
      mediaList.value = isLoadMore ? [...mediaList.value, ...newItems] : newItems;
      mediaPage.value++;
    }
  } catch (err) {
    mediaError.value = true;
    console.warn('获取产品媒体失败', err);
  } finally {
    mediaLoading.value = false;
  }
}

function openMedia(index: number) {
  const imageItems = mediaList.value.filter((item) => !isVideo(item));
  const targetIndex = imageItems.indexOf(mediaList.value[index]);
  if (targetIndex >= 0) {
    appStore.openImageViewer(imageItems.map((item) => imageUrlOf(item)).filter(Boolean), targetIndex);
  } else {
    const url = imageUrlOf(mediaList.value[index]);
    if (url) void CoolapkTauriAPI.openUrl(url, 'system');
  }
}

// ===== 评分 =====
const buyChecked = ref(false);
const ratingPending = ref(false);
const selectedRating = ref(0);
const ratingMessage = ref('');
const ratingChartPeriods = ref<RatingChartPeriods | null>(null);
const ratingChartRef = ref<HTMLElement | null>(null);
const chartLoading = ref(false);
const chartError = ref(false);
const ratings = ref<any[]>([]);
const ratingsLoading = ref(false);
const ratingsError = ref(false);
const ratingsNoMore = ref(false);
const ratingsPage = ref(1);
const ratingSortOptions = ref<ProductRatingSortOption[]>([]);
const activeRatingSortUrl = ref('');
const ratingFirstItem = ref('');
const ratingLastItem = ref('');
const showRatingComposer = ref(false);
const ratingListFilters = [
  { key: 'all', label: '全部' },
  { key: 'owner', label: '机主' },
];
const summaryAudience = ref('all');
const ratingSummary = computed(() => {
  const data = productDetail.value || {};
  const owner = summaryAudience.value === 'owner';
  const prefix = owner ? 'owner_' : '';
  const counts = [5, 4, 3, 2, 1].map((star) => ({ star, count: Number(data[`${prefix}star_${star}_count`] || 0) }));
  const total = Number(data[`${prefix}star_total_count`] || data[owner ? 'owner_rating_total_num' : 'rating_total_num'] || 0);
  const rawScore = Number(data[`${prefix}star_average_score`] || data.rating_average_score || 0);
  const score = rawScore <= 5 ? rawScore * 2 : rawScore;
  const recentPrefix = owner ? 'recent_30_days_owner_' : 'recent_30_days_';
  const rawRecentScore = Number(data[`${recentPrefix}star_average_score`] || 0);
  const rawRate = data[`${recentPrefix}goods_percent`];
  return {
    total, score,
    stars: counts.map((item) => ({ ...item, percent: total > 0 ? item.count / total * 100 : 0 })),
    recentCount: Number(data[`${recentPrefix}star_total_count`] || 0),
    recentScore: rawRecentScore <= 5 ? rawRecentScore * 2 : rawRecentScore,
    positiveRate: rawRate === undefined || rawRate === null ? null : Math.round(Number(rawRate) <= 1 ? Number(rawRate) * 100 : Number(rawRate)),
  };
});
const ratingDimensions = computed(() => {
  const items = productDetail.value?.rating_item_info;
  if (!Array.isArray(items)) return [];
  return items.map((item: any) => ({
    name: String(item.name || ''),
    score: Number(summaryAudience.value === 'owner' ? item.owner_average_score : item.average_score),
  })).filter((item) => item.name && Number.isFinite(item.score) && item.score > 0);
});

async function setMyRating(star: number) {
  if (ratingPending.value) return;
  selectedRating.value = star;
}

async function submitRating() {
  if (!requireLogin() || ratingPending.value || selectedRating.value === 0) return;
  ratingPending.value = true;
  try {
    const result = await CoolapkTauriAPI.createProductRating(productId.value, selectedRating.value, ratingMessage.value, buyChecked.value);
    if (productDetail.value) {
      if (result?.data?.id) productDetail.value.ratingFeed = result.data;
      productDetail.value.userAction = {
        ...(productDetail.value.userAction || {}),
        rating: selectedRating.value,
        buy: buyChecked.value ? 1 : productDetail.value.userAction?.buy,
      };
    }
    ratingMessage.value = '';
    showRatingComposer.value = false;
    showToast('点评已发布', 'success');
    resetRatings();
    void fetchRatings();
    void fetchRatingChart();
  } catch (err) {
    showToast(getErrorMessage(err, '发布点评失败'), 'error');
  } finally {
    ratingPending.value = false;
  }
}

async function fetchRatingChart() {
  if (!productId.value || chartLoading.value) return;
  chartLoading.value = true;
  chartError.value = false;
  try {
    const res = await CoolapkTauriAPI.getProductRatingChart(productId.value);
    if (res?.data && typeof res.data === 'object') {
      ratingChartPeriods.value = res.data;
    } else {
      chartError.value = true;
    }
  } catch (err) {
    chartError.value = true;
    console.warn('获取评分趋势失败', err);
  } finally {
    chartLoading.value = false;
  }
}

async function fetchRatings(isLoadMore = false) {
  const url = activeRatingSortUrl.value || allTabs.value.find((tab) => tab.key === 'rating')?.url;
  if (!productId.value || !url || ratingsLoading.value || ratingsNoMore.value) return;
  ratingsLoading.value = true;
  if (!isLoadMore) ratingsError.value = false;
  try {
    const res = await CoolapkTauriAPI.getDiscoveryPageData({
      url, title: '点评', page: ratingsPage.value,
      firstItem: isLoadMore ? ratingFirstItem.value : '',
      lastItem: isLoadMore ? ratingLastItem.value : '',
    });
    const options = productRatingSortOptions(productId.value, res);
    if (options.length) {
      ratingSortOptions.value = options;
      if (!activeRatingSortUrl.value) activeRatingSortUrl.value = options[0].url;
    }
    const newItems = productRatingRows(res);
    ratings.value = isLoadMore ? [...ratings.value, ...newItems] : newItems;
    // 点评排序接口未提供 hasMore；不足 20 条也可能还有下一页（差评列表已验证如此）。
    ratingsNoMore.value = newItems.length === 0;
    if (newItems.length) {
      ratingFirstItem.value = readFeedCursor(ratings.value[0]);
      ratingLastItem.value = readFeedCursor(ratings.value[ratings.value.length - 1]);
      ratingsPage.value++;
    }
  } catch (err) {
    ratingsError.value = true;
    console.warn('获取用户评分失败', err);
  } finally {
    ratingsLoading.value = false;
  }
}

function resetRatings() {
  ratingsPage.value = 1;
  ratingsNoMore.value = false;
  ratingsError.value = false;
  ratings.value = [];
  ratingFirstItem.value = '';
  ratingLastItem.value = '';
}

async function selectRatingSort(url: string) {
  if (!ratingSortOptions.value.some((option) => option.url === url) || activeRatingSortUrl.value === url) return;
  activeRatingSortUrl.value = url;
  resetRatings();
  await nextTick();
  ratingChartRef.value?.scrollIntoView({ block: 'start', behavior: 'auto' });
  void fetchRatings();
}

function openRatingComposer() {
  selectTab('rating');
  if (!authStore.isLoggedIn) {
    authStore.openLoginModal();
    return;
  }
  showRatingComposer.value = true;
}

function handleScroll(e: Event) {
  const target = e.target as HTMLElement;
  const { scrollTop, clientHeight, scrollHeight } = target;
  if (scrollTop + clientHeight >= scrollHeight - 100) {
    if (isFeedTab.value && !feedsLoading.value && !noMore.value) {
      fetchFeeds(true);
    } else if (selectedTab.value?.kind === 'external' && !externalLoading.value && !externalNoMore.value) {
      void fetchExternalTab(true);
    } else if (activeTab.value === 'media' && !mediaLoading.value && !mediaNoMore.value) {
      fetchMedia(true);
    } else if (activeTab.value === 'rating' && !ratingsLoading.value && !ratingsNoMore.value) {
      fetchRatings(true);
    }
  }
}

function focusSearch() {
  router.push({ path: '/search', query: { q: productTitle.value } });
}

function retryFeeds() {
  noMore.value = false;
  feedsError.value = false;
  void fetchFeeds(page.value > 1);
}

function formatCount(value: number | string) {
  const count = Number(value);
  if (!Number.isFinite(count)) return '0';
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function resetFeeds() {
  page.value = 1;
  noMore.value = false;
  feedsError.value = false;
  productFeeds.value = [];
}

function loadActiveTab() {
  if (selectedTab.value?.kind === 'external') {
    void fetchExternalTab(false);
  } else if (isFeedTab.value) {
    void fetchFeeds(false);
  } else if (activeTab.value === 'config') {
    void fetchConfigs();
  } else if (activeTab.value === 'media') {
    void fetchMedia();
  } else if (activeTab.value === 'rating') {
    void fetchRatingChart();
    void fetchRatings();
  }
}

// productId 在 setup 时一次性取自路由参数（多实例页签固定参数，实例内不会变化），
// 页面数据只在挂载时加载一次，不使用永不触发的 watch。
onMounted(() => {
  resetFeeds();
  void fetchProductHeader();
  loadActiveTab();
});

watch(
  () => route.query.tab,
  (value) => {
    const requestedTab = getRequestedTab(value);
    if (requestedTab !== activeTab.value) selectTab(requestedTab);
  },
);

// 下拉更新当前详情与当前栏目，保留筛选和排序。
async function refreshMobilePage() { await fetchProductHeader(true); if (selectedTab.value?.kind === 'external') await fetchExternalTab(false); else if (isFeedTab.value) { resetFeeds(); await fetchFeeds(false); } else if (activeTab.value === 'config') await fetchConfigs(); else if (activeTab.value === 'media') { mediaPage.value = 1; mediaNoMore.value = false; await fetchMedia(false); } else if (activeTab.value === 'rating') { ratingsPage.value = 1; ratingsNoMore.value = false; ratingFirstItem.value = ''; ratingLastItem.value = ''; await fetchRatingChart(); await fetchRatings(false); } }
</script>

<style scoped>
.page-container {
  width: 100%;
  max-width: var(--feed-max-width, 860px);
  height: 100%;
  overflow-y: auto;
  padding: 14px 16px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.product-header-card {
  background-color: var(--surface);
  border-radius: 12px;
  border: 1px solid var(--border);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.product-score-card {
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
}

.product-score-head, .product-score-body { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.product-score-head strong { color: var(--text-primary); font-size: 15px; }
.product-score-head button { border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; }
.product-score-body { margin-top: 12px; }
.product-score-number { display: flex; flex-direction: column; min-width: 130px; color: var(--text-secondary); font-size: 12px; }
.product-score-number strong { color: var(--brand-primary); font-size: 38px; line-height: 1.1; }
.product-score-specs { flex: 1; max-width: 480px; display: grid; gap: 5px; }
.product-score-specs > div { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 11px; }
.product-score-specs > div span:first-child { min-width: 56px; text-align: right; }
.product-score-specs > div span:last-child { min-width: 26px; }
.product-score-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
.product-score-actions > span { margin-right: auto; color: var(--text-tertiary); font-size: 12px; }
.product-spec-chips { display: flex; gap: 8px; overflow-x: auto; white-space: nowrap; }
.product-spec-chips span { padding: 8px 12px; border-radius: var(--radius-control); background: var(--surface); color: var(--text-secondary); font-size: 12px; }

.header-content {
  display: flex;
  align-items: center;
  gap: 14px;
}

.product-icon-wrapper {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid var(--border);
  background-color: var(--background);
}

.product-icon-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.25));
  font-size: 26px;
  color: #3b82f6;
}

.product-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.product-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--text-primary);
  margin: 0;
}

.product-desc-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.product-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: 11px;
}

.header-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.wish-btn,
.buy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  background-color: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  white-space: nowrap;
}

.wish-btn:hover,
.buy-btn:hover {
  border-color: var(--brand-primary);
  color: var(--brand-primary);
}

.wish-btn.active {
  background-color: var(--brand-soft);
  border-color: var(--brand-primary);
  color: var(--brand-primary);
  font-weight: 600;
}

.buy-btn.active {
  background-color: var(--brand-soft);
  border-color: var(--brand-primary);
  color: var(--brand-primary);
  font-weight: 600;
}

.wish-btn:disabled,
.buy-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.product-sub-tabs {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 20px;
  background-color: var(--surface);
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  border-radius: var(--radius-card, 12px);
  padding: 0 16px;
  height: 48px;
  min-height: 48px;
  flex: 0 0 48px;
  position: sticky;
  top: 0;
  z-index: 20;
  overflow-x: auto;
  overflow-y: hidden;
  touch-action: pan-x;
  cursor: grab;
  user-select: none;
  scrollbar-width: none;
  box-shadow: var(--shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.04));
  box-sizing: border-box;
}

.product-sub-tabs.is-dragging {
  cursor: grabbing;
  scroll-behavior: auto;
}

.product-sub-tabs::-webkit-scrollbar {
  display: none;
}

.product-tab-item {
  position: relative;
  border: none;
  background: transparent;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0 4px;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.product-tab-item:hover {
  color: var(--text-primary);
}

.product-tab-item.active {
  color: var(--text-primary);
  font-weight: 700;
  font-size: 16px;
}

.tab-line {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 22px;
  height: 3.5px;
  background: linear-gradient(90deg, #10b981 0%, #059669 100%);
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4);
}

.feed-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pagination-footer {
  padding: 16px 0;
  text-align: center;
}

.no-more {
  color: var(--text-tertiary);
  font-size: 12px;
}

.retry-inline {
  border: 0;
  background: transparent;
  color: var(--brand-primary, #10b981);
  font-size: 12px;
  cursor: pointer;
}

.loading-wrapper,
.error-wrapper,
.empty-wrapper {
  min-height: 200px;
  display: grid;
  place-items: center;
}

.product-subtab-empty {
  width: 100%;
  min-height: 390px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.product-subtab-empty-card {
  min-height: 142px;
  padding: 20px 24px;
  border-radius: var(--radius-card);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 34px;
}

.product-subtab-empty-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  font-size: 16px;
}

.product-subtab-empty-title i {
  color: var(--brand-primary);
}

.product-subtab-empty-card p {
  margin: 0;
  color: var(--text-secondary);
  text-align: center;
  font-size: 15px;
}

.product-subtab-empty-invite {
  flex: 1;
  min-height: 150px;
  margin: 0;
  padding: 48px 24px;
  display: grid;
  place-items: center;
  color: var(--text-tertiary);
  text-align: center;
  font-size: 18px;
  line-height: 1.6;
}

/* ===== 参数 Tab ===== */
.config-tab-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.config-toolbar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.config-toolbar-title i {
  color: var(--brand-primary);
  margin-right: 6px;
}

.compare-btn {
  border: 1px solid var(--brand-primary);
  background-color: var(--brand-soft);
  color: var(--brand-primary);
  font-size: 12px;
  padding: 7px 14px;
  border-radius: var(--radius-pill);
  cursor: pointer;
}

.compare-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 12px 14px;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.config-card:hover {
  border-color: var(--brand-primary);
}

.config-card.active {
  border-color: var(--brand-primary);
  background-color: var(--brand-soft);
}

.config-check {
  color: var(--text-tertiary);
  font-size: 15px;
  flex-shrink: 0;
}

.config-card.active .config-check {
  color: var(--brand-primary);
}

.config-info {
  flex: 1;
  min-width: 0;
}

.config-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.comparing-badge {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--brand-primary);
  background-color: var(--brand-soft);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}

.config-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.config-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.compare-toggle,
.server-compare-toggle {
  border: 1px solid var(--border);
  background-color: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 5px 10px;
  border-radius: var(--radius-control);
  cursor: pointer;
  white-space: nowrap;
}

.compare-toggle:hover,
.server-compare-toggle:hover {
  color: var(--brand-primary);
  border-color: var(--brand-primary);
}

.compare-toggle.active,
.server-compare-toggle.active {
  color: var(--brand-primary);
  background-color: var(--brand-soft);
  border-color: var(--brand-primary);
}

.compare-toggle:disabled,
.server-compare-toggle:disabled {
  opacity: 0.6;
  cursor: wait;
}

.config-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-detail-head {
  padding: 4px 0;
}

.config-detail-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.config-detail-title i {
  color: var(--brand-primary);
  margin-right: 6px;
}

/* ===== 媒体 Tab ===== */
.media-sub-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.media-filter-btn {
  border: 1px solid var(--border);
  background-color: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  cursor: pointer;
}

.media-filter-btn.active {
  background-color: var(--brand-soft);
  border-color: var(--brand-primary);
  color: var(--brand-primary);
  font-weight: 600;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.media-item {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 12px;
  overflow: hidden;
  background-color: var(--background-secondary);
  cursor: pointer;
  border: 1px solid var(--border-light);
}

.media-img :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-play-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.55);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.media-type-badge {
  position: absolute;
  left: 8px;
  bottom: 8px;
  background-color: rgba(0, 0, 0, 0.6);
  color: #ffffff;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}

/* ===== 评分 Tab ===== */
.rating-tab-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.rating-entry {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 12px 4px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.rating-entry-stars { margin-left: auto; color: var(--text-disabled); font-size: 24px; letter-spacing: 2px; white-space: nowrap; }
.rating-entry > i { color: var(--text-tertiary); }
.rating-entry:hover .rating-entry-stars { color: #f59e0b; }

.my-rating-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.rating-overview {
  display: flex;
  align-items: center;
  gap: 28px;
}

.rating-overview-score {
  display: flex;
  flex-direction: column;
  min-width: 110px;
  color: var(--text-secondary);
  font-size: 12px;
}

.rating-overview-score strong {
  color: var(--brand-primary);
  font-size: 36px;
}

.rating-distribution { flex: 1; display: grid; gap: 5px; }
.rating-distribution-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
.rating-distribution-row span:last-child { min-width: 35px; text-align: right; }
.rating-distribution-track { flex: 1; height: 7px; border-radius: 5px; background: var(--background-secondary); overflow: hidden; }
.rating-distribution-track i { display: block; height: 100%; background: var(--brand-primary); }
.rating-recent { color: var(--text-secondary); font-size: 12px; }
.rating-dimensions { display: flex; flex-wrap: wrap; gap: 8px; }
.rating-dimensions span { padding: 5px 10px; border-radius: var(--radius-pill); background: var(--background-secondary); color: var(--text-secondary); font-size: 12px; }

.my-rating-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.section-title i {
  color: var(--brand-primary);
  margin-right: 6px;
}

.login-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.rating-composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.star-input {
  display: flex;
  align-items: center;
  gap: 6px;
}

.star-btn {
  border: 0;
  background: transparent;
  font-size: 24px;
  color: var(--text-disabled);
  cursor: pointer;
  padding: 2px;
  line-height: 1;
  transition: transform var(--duration-fast) var(--ease-default);
}

.star-btn:hover {
  transform: scale(1.15);
}

.star-btn.active {
  color: #f59e0b;
}

.rating-hint-text {
  margin-left: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.rating-options {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.rating-message {
  width: 100%;
  min-height: 72px;
  padding: 10px 12px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text-primary);
  font: inherit;
  box-sizing: border-box;
}

.buy-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.cancel-rating-btn {
  border: 1px solid var(--border);
  background-color: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 5px 12px;
  border-radius: var(--radius-control);
  cursor: pointer;
}

.cancel-rating-btn:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.rating-pending {
  display: flex;
  justify-content: center;
}

.rating-login-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 13px;
  color: var(--text-secondary);
}

.login-btn {
  border: 0;
  background-color: var(--brand-primary);
  color: #ffffff;
  font-size: 13px;
  padding: 7px 16px;
  border-radius: var(--radius-pill);
  cursor: pointer;
}

.rating-chart-wrapper {
  display: flex;
  flex-direction: column;
}

.rating-list-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.rating-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.rating-list-filter {
  display: flex;
  gap: 6px;
}

.rating-sort-filter { max-width: 100%; overflow-x: auto; }
.rating-sort-filter .filter-pill { white-space: nowrap; }

.filter-pill {
  border: 1px solid var(--border);
  background-color: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  cursor: pointer;
}

.filter-pill.active {
  background-color: var(--brand-soft);
  border-color: var(--brand-primary);
  color: var(--brand-primary);
  font-weight: 600;
}

.rating-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 700px) {
  .header-content {
    display: grid;
    grid-template-columns: 60px minmax(0, 1fr);
    align-items: start;
    column-gap: 12px;
    row-gap: 12px;
  }
  .product-info {
    grid-column: 2;
    min-width: 0;
  }
  .product-title {
    overflow-wrap: anywhere;
    line-height: 1.3;
  }
  .product-stats {
    gap: 4px 8px;
  }
  .header-actions {
    grid-column: 1 / -1;
    flex-direction: row;
    justify-content: flex-end;
    width: 100%;
  }
  .media-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .config-card {
    flex-direction: column;
    align-items: stretch;
  }
  .config-actions {
    flex-direction: row;
  }
}
</style>
