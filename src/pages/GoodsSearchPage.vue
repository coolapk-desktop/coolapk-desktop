<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: searching }" class="page-container custom-scrollbar" @scroll="handleScroll">
    <div class="top-nav-bar">
      <div class="search-box">
        <i class="fas fa-search search-icon"></i>
        <input
          v-model="keyword"
          class="search-input"
          type="text"
          placeholder="搜索京东/淘宝/拼多多好物"
          maxlength="40"
          @keyup.enter="searchFromUi"
        />
        <button v-if="keyword" class="clear-btn" type="button" title="清空" @click="clearKeyword">
          <i class="fas fa-times-circle"></i>
        </button>
      </div>
      <AppButton size="sm" :loading="searching" @click="searchFromUi">搜索</AppButton>
    </div>

    <div v-if="!hasSearched" class="idle-content">
      <div v-if="hotWords.length > 0" class="hot-words-section">
        <h3 class="section-title"><i class="fas fa-fire hot-icon"></i> 热门搜索</h3>
        <div class="hot-words-wrap">
          <button
            v-for="(word, idx) in hotWords"
            :key="hotWordKey(word)"
            class="hot-word-chip"
            :class="`rank-${Math.min(idx, 2)}`"
            type="button"
            @click="useHotWord(word)"
          >
            <span class="hot-word-rank">{{ idx + 1 }}</span>
            {{ hotWordText(word) }}
          </button>
        </div>
      </div>

      <div v-if="history.length > 0" class="history-section">
        <div class="history-header">
          <h3 class="section-title">搜索历史</h3>
          <button class="clear-history" type="button" title="清空历史" @click="clearHistory">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
        <div class="history-wrap">
          <button
            v-for="word in history"
            :key="word"
            class="history-chip"
            type="button"
            @click="useHotWord(word)"
          >
            {{ word }}
          </button>
        </div>
      </div>
    </div>

    <template v-else>
      <div class="filter-bar">
        <div class="filter-options">
          <button
            v-for="opt in sortOptions"
            :key="opt.key"
            class="filter-option"
            :class="{ 'is-active': activeSort === opt.key }"
            type="button"
            @click="selectSort(opt.key)"
          >
            {{ opt.label }}
          </button>
        </div>
        <button
          class="coupon-toggle"
          :class="{ 'is-on': couponOnly }"
          type="button"
          title="只看有优惠券的商品"
          @click="toggleCoupon"
        >
          <i class="fas fa-ticket-alt"></i>
          <span>优惠券</span>
        </button>
      </div>

      <div v-if="searching && goods.length === 0" class="state-wrapper">
        <LoadingState text="正在搜索好物..." />
      </div>

      <div v-else-if="searchError && goods.length === 0" class="state-wrapper">
        <ErrorState title="搜索失败" :message="searchError" @retry="searchFromUi" />
      </div>

      <div v-else-if="goods.length === 0" class="state-wrapper">
        <EmptyState title="没有找到相关好物" description="换个关键词试试吧" />
      </div>

      <div v-else class="goods-grid">
        <article v-for="item in goods" :key="goodsKey(item)" class="goods-card" @click="openGoods(item)">
          <div class="goods-cover">
            <AppImage
              v-if="goodsPic(item)"
              :src="goodsPic(item)"
              image-class="goods-cover-img"
              fit="cover"
              :alt="goodsTitle(item)"
            />
            <div v-else class="goods-cover-fallback">
              <i class="fas fa-gift"></i>
            </div>
            <span v-if="goodsPromoTitle(item)" class="promo-badge">{{ goodsPromoTitle(item) }}</span>
          </div>
          <div class="goods-body">
            <h4 class="goods-title">{{ goodsTitle(item) }}</h4>
            <div class="goods-price-row">
              <span class="goods-price"><i class="fas fa-yen-sign"></i> {{ displayPrice(item) }}</span>
              <span v-if="goodsMall(item)" class="goods-mall">{{ goodsMall(item) }}</span>
            </div>
            <div v-if="tags(item).length > 0" class="goods-tags">
              <span v-for="tag in tags(item).slice(0, 3)" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>
        </article>
      </div>

      <div class="pagination-footer">
        <LoadingState v-if="searching && goods.length > 0" text="加载更多中..." />
        <button v-else-if="searchError && goods.length > 0" class="retry-inline" @click="searchFromUi">加载失败，点击重试</button>
        <div v-else-if="noMore" class="no-more">没有更多好物了</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import AppButton from '../components/common/AppButton.vue';
import AppImage from '../components/common/AppImage.vue';
import LoadingState from '../components/common/LoadingState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { showToast } from '../utils/toast';

const HISTORY_KEY = 'coolapk_goods_search_history';

const route = useRoute();
const router = useRouter();

// 关键词、排序、优惠券都落在路由 query（q/sort/coupon）上：
// 切换页签或进入详情再返回时按地址恢复，避免组件重建后搜索状态全部丢失。
const SORT_KEYS = ['default', 'sell', 'price_asc', 'price_desc'];

// 搜索请求序号：新请求自增即作废旧请求，过期响应直接丢弃，慢响应不会覆盖新结果。
let requestVersion = 0;

function queryText(value: unknown): string {
  return (Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')).trim();
}

/** 把地址栏 query 归一成可用的搜索条件（非法排序回落到综合）。 */
function routeSearchState() {
  const sort = queryText(route.query.sort);
  return {
    keyword: queryText(route.query.q),
    sort: SORT_KEYS.includes(sort) ? sort : 'default',
    coupon: ['1', 'true'].includes(queryText(route.query.coupon).toLowerCase()),
  };
}

const initialRouteState = routeSearchState();

const keyword = ref(initialRouteState.keyword);
const searching = ref(false);
const hasSearched = ref(Boolean(initialRouteState.keyword));
const searchError = ref('');
const noMore = ref(false);
const page = ref(1);

const hotWords = ref<string[]>([]);
const history = ref<string[]>([]);

const activeSort = ref(initialRouteState.sort);
const couponOnly = ref(initialRouteState.coupon);

const sortOptions = [
  { key: 'default', label: '综合', sortName: 'default', sort: 'default' },
  { key: 'sell', label: '销量', sortName: 'sell', sort: 'sell' },
  { key: 'price_asc', label: '价格↑', sortName: 'price', sort: 'asc' },
  { key: 'price_desc', label: '价格↓', sortName: 'price', sort: 'desc' },
];

const goods = ref<any[]>([]);

const activeSortOption = computed(
  () => sortOptions.find((o) => o.key === activeSort.value) || sortOptions[0],
);

function goodsKey(goods: any): string {
  return String(goods?.id ?? goods?.entityId ?? `${goods?.goods_title}-${goods?.mall_title}`);
}

function goodsPic(goods: any): string {
  return goods?.goods_pic || goods?.pic || '';
}

function goodsTitle(goods: any): string {
  return goods?.goods_title || goods?.title || '未知好物';
}

function goodsMall(goods: any): string {
  return goods?.mall_title || goods?.mallInfo?.mall_title || '';
}

function goodsPromoTitle(goods: any): string {
  return goods?.goods_promo_title || '';
}

function displayPrice(goods: any): string {
  return goods?.goods_promo_price || goods?.goods_price || '--';
}

function tags(goods: any): string[] {
  const list: string[] = [];
  if (goods?.category_title) list.push(goods.category_title);
  if (goods?.mall_title) list.push(goods.mall_title);
  if (goods?.goods_tags) {
    list.push(...String(goods.goods_tags).split(',').filter(Boolean));
  }
  return list;
}

function hotWordKey(word: string | any): string {
  return typeof word === 'string' ? word : String(word?.id ?? word?.title ?? '');
}

function hotWordText(word: string | any): string {
  return typeof word === 'string' ? word : (word?.title || word?.word || '');
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    history.value = raw ? JSON.parse(raw) : [];
  } catch {
    history.value = [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value.slice(0, 12)));
  } catch {
    // 忽略本地存储异常
  }
}

function recordHistory(word: string) {
  const trimmed = word.trim();
  if (!trimmed) return;
  history.value = [trimmed, ...history.value.filter((h) => h !== trimmed)].slice(0, 12);
  saveHistory();
}

function clearHistory() {
  history.value = [];
  saveHistory();
}

async function loadHotWords() {
  try {
    const res = await CoolapkTauriAPI.getGoodsSearchHotWords();
    const data = res?.data;
    if (Array.isArray(data)) {
      hotWords.value = data.map((item: any) => (typeof item === 'string' ? item : (item?.title || item?.word || String(item?.id || '')))).filter(Boolean);
    }
  } catch (err) {
    console.warn('加载热门搜索失败', err);
  }
}

/** 把当前搜索条件写回地址栏；page 只在组件内维护，不参与路由。 */
function syncRouteQuery(
  keywordValue = keyword.value,
  sortValue = activeSort.value,
  couponValue = couponOnly.value,
) {
  const query: Record<string, string> = { ...(route.query as Record<string, string>) };
  query.tab = 'search';
  const kw = keywordValue.trim();
  if (kw) query.q = kw;
  else delete query.q;
  if (sortValue && sortValue !== 'default') query.sort = sortValue;
  else delete query.sort;
  if (couponValue) query.coupon = '1';
  else delete query.coupon;
  const same = ['tab', 'q', 'sort', 'coupon'].every(
    (key) => queryText(route.query[key]) === (query[key] ?? ''),
  );
  if (same) return;
  // 页面内筛选变化用 replace，避免每次切排序都在历史里堆一条记录。
  void router.replace({ path: '/goods', query });
}

/** 模板事件处理器：不把事件对象当成搜索选项传入。 */
function searchFromUi() {
  void doSearch();
}

async function doSearch(options?: { syncRoute?: boolean }) {
  const kw = keyword.value.trim();
  if (!kw) {
    showToast('请输入搜索关键词', 'warning');
    return;
  }
  // 新请求一律自增序号并快照条件：加载中切排序/优惠券不再被静默丢弃，
  // 而是作废旧请求重发，旧响应回来时序号不匹配直接丢弃。
  const token = ++requestVersion;
  const opt = activeSortOption.value;
  const sortKey = activeSort.value;
  const coupon = couponOnly.value;
  if (options?.syncRoute !== false) syncRouteQuery(kw, sortKey, coupon);
  recordHistory(kw);
  page.value = 1;
  noMore.value = false;
  searchError.value = '';
  goods.value = [];
  hasSearched.value = true;
  searching.value = true;
  try {
    const res = await CoolapkTauriAPI.searchGoods({
      keyword: kw,
      sortName: opt.sortName,
      sort: opt.sort,
      isCoupon: coupon,
      page: 1,
    });
    if (token !== requestVersion) return;
    const list = (res?.data && Array.isArray(res.data)) ? res.data : [];
    if (list.length === 0) {
      noMore.value = true;
    } else {
      goods.value = list;
      page.value = 2;
    }
  } catch (err: any) {
    if (token !== requestVersion) return;
    searchError.value = err?.message || '搜索失败';
  } finally {
    if (token === requestVersion) searching.value = false;
  }
}

async function loadMore() {
  const kw = keyword.value.trim();
  if (!kw || searching.value || noMore.value) return;
  // 加载更多沿用当前请求代数（不自增），一旦发起新搜索就整体作废，避免新旧分页拼接。
  const token = requestVersion;
  const opt = activeSortOption.value;
  const coupon = couponOnly.value;
  searching.value = true;
  try {
    const res = await CoolapkTauriAPI.searchGoods({
      keyword: kw,
      sortName: opt.sortName,
      sort: opt.sort,
      isCoupon: coupon,
      page: page.value,
    });
    if (token !== requestVersion) return;
    const list = (res?.data && Array.isArray(res.data)) ? res.data : [];
    if (list.length === 0) {
      noMore.value = true;
    } else {
      const existing = new Set(goods.value.map(goodsKey));
      goods.value.push(...list.filter((i: any) => !existing.has(goodsKey(i))));
      page.value++;
    }
  } catch (err: any) {
    if (token !== requestVersion) return;
    searchError.value = err?.message || '加载更多失败';
  } finally {
    if (token === requestVersion) searching.value = false;
  }
}

function useHotWord(word: string | any) {
  keyword.value = hotWordText(word);
  void doSearch();
}

function clearKeyword() {
  keyword.value = '';
  hasSearched.value = false;
  goods.value = [];
  noMore.value = false;
  searchError.value = '';
  // 作废在途请求，避免清空关键词后旧结果又回填到列表。
  requestVersion += 1;
  searching.value = false;
  syncRouteQuery('', activeSort.value, couponOnly.value);
}

function selectSort(key: string) {
  if (activeSort.value === key) return;
  activeSort.value = key;
  // 加载中切换排序不再静默丢弃高亮与结果：直接作废旧请求按新排序重发。
  if (hasSearched.value && keyword.value.trim()) void doSearch();
  else syncRouteQuery();
}

function toggleCoupon() {
  couponOnly.value = !couponOnly.value;
  if (hasSearched.value && keyword.value.trim()) void doSearch();
  else syncRouteQuery();
}

// 地址栏变化（前进/后退、切页签回来、外部跳转）以 query 为准恢复条件并自动搜索。
watch(
  () => `${queryText(route.query.q)}|${queryText(route.query.sort)}|${queryText(route.query.coupon)}`,
  () => {
    const next = routeSearchState();
    if (
      next.keyword === keyword.value.trim()
      && next.sort === activeSort.value
      && next.coupon === couponOnly.value
    ) return;
    keyword.value = next.keyword;
    activeSort.value = next.sort;
    couponOnly.value = next.coupon;
    if (next.keyword) {
      hasSearched.value = true;
      void doSearch({ syncRoute: false });
      return;
    }
    requestVersion += 1;
    searching.value = false;
    hasSearched.value = false;
    goods.value = [];
    noMore.value = false;
    searchError.value = '';
  },
);

function handleScroll(e: Event) {
  const el = e.target as HTMLElement;
  const scrollDiff = el && el.scrollHeight
    ? el.scrollHeight - el.scrollTop - el.clientHeight
    : 999;
  if (scrollDiff < 260 && hasSearched.value) {
    void loadMore();
  }
}

function openGoods(goods: any) {
  const buyUrl = goods?.goods_buy_url || goods?.goods_url || '';
  if (!buyUrl) return;
  void CoolapkTauriAPI.openUrl(buyUrl, 'system');
}

void loadHotWords();
loadHistory();
// 地址栏里带着关键词（切回好物搜索页签、从详情返回）时按原条件自动重搜。
if (keyword.value) void doSearch({ syncRoute: false });

// 下拉仅刷新当前栏目，不切换筛选、路由或页面实例。
async function refreshMobilePage() { if (keyword.value.trim()) await doSearch(); else await loadHotWords(); }
</script>

<style scoped>
.page-container {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: var(--space-5);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.top-nav-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 8px 14px;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.search-box:focus-within {
  border-color: var(--brand-primary);
}

.search-icon {
  color: var(--text-tertiary);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-sub);
}

.clear-btn {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0;
}

.clear-btn:hover {
  color: var(--text-secondary);
}

.idle-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.section-title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin: 0 0 var(--space-3);
}

.hot-icon {
  color: var(--warning);
  margin-right: 4px;
}

.hot-words-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.hot-word-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background-color: var(--surface);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.hot-word-chip:hover {
  border-color: var(--brand-primary);
  color: var(--brand-primary);
}

.hot-word-rank {
  color: var(--text-tertiary);
  font-weight: var(--font-weight-bold);
}

.hot-word-chip.rank-0 .hot-word-rank,
.hot-word-chip.rank-1 .hot-word-rank,
.hot-word-chip.rank-2 .hot-word-rank {
  color: var(--warning);
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.history-header .section-title {
  margin-bottom: 0;
}

.clear-history {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.clear-history:hover {
  color: var(--danger);
}

.history-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.history-chip {
  border: 1px solid var(--border-light);
  background-color: var(--surface);
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.history-chip:hover {
  color: var(--brand-primary);
  border-color: var(--brand-primary);
}

.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.filter-options {
  display: flex;
  gap: var(--space-2);
}

.filter-option {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sub);
  padding: 4px 10px;
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.filter-option:hover {
  color: var(--text-primary);
}

.filter-option.is-active {
  color: var(--brand-primary);
  font-weight: var(--font-weight-semibold);
  background-color: var(--brand-soft);
}

.coupon-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  background-color: var(--surface);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.coupon-toggle.is-on {
  border-color: var(--warning);
  color: var(--warning);
  background-color: rgba(245, 159, 0, 0.1);
}

.state-wrapper {
  padding: var(--space-10) 0;
}

.goods-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-3);
}

.goods-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  overflow: hidden;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-default);
  display: flex;
  flex-direction: column;
}

.goods-card:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.goods-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  background-color: var(--background-secondary);
  overflow: hidden;
}

.goods-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.goods-cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 34px;
}

.promo-badge {
  position: absolute;
  left: 8px;
  top: 8px;
  background-color: var(--danger);
  color: #ffffff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  max-width: 70%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.goods-body {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.goods-title {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.8em;
}

.goods-price-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.goods-price {
  color: var(--danger);
  font-weight: var(--font-weight-bold);
  font-size: var(--font-size-body);
}

.goods-mall {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  background-color: var(--background-secondary);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}

.goods-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  font-size: 11px;
  color: var(--text-tertiary);
  background-color: var(--background-secondary);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}

.pagination-footer {
  padding: var(--space-4) 0;
  text-align: center;
}

.no-more {
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.retry-inline {
  border: 0;
  background: transparent;
  color: var(--brand-primary);
  font-size: var(--font-size-caption);
  cursor: pointer;
}
</style>
