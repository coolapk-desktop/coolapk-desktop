<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: Boolean(selectedTab && states[selectedTab.key]?.loading) }" :class="['discover-page', { 'is-cool-picture': isCoolPicturePage }]" @pointerdown="discoveryRipple" @keydown="discoveryRipple">
    <div class="discover-main-column">
      <div class="discover-toolbar-row">
        <FeedTabs ref="feedTabsView" v-if="tabs.length" :active-key="selectedKey" :tabs="feedTabs" :show-manage="false" @update:active-key="selectTab" />
      </div>

      <div v-if="configError && !tabs.length" class="config-error">
        <strong>发现频道配置加载失败</strong><span>{{ configError }}</span><button type="button" @click="loadConfig">重试</button>
      </div>
      <DiscoverySkeleton v-else-if="!tabs.length" />
      <DiscoveryPager v-else :tabs="tabs" :active-key="selectedKey" @select="selectTab" @prepare="prepareTab" @progress="updateSwipeProgress">
      <template #default="{ tab }">
      <div class="discover-scroll-container custom-scrollbar" @scroll.passive="handleScroll($event, tab)">
      <template v-for="state in [states[tab.key]]" :key="tab.key">
        <section v-if="state?.webUrl" class="web-route-card">
          <i class="fas fa-globe"></i>
          <div>
            <strong>该栏目由网页内容提供</strong>
            <span>{{ state.webUrl }}</span>
          </div>
          <button type="button" @click="openWeb(state.webUrl)">打开页面</button>
        </section>

        <!-- 首屏及尚未访问的相邻频道使用同样紧凑的加载占位。 -->
        <DiscoverySkeleton v-else-if="!state || (state.loading && !state.items.length)" />

        <!-- 错误状态：居中提示并提供重试按钮 -->
        <div v-else-if="state.error && !state.items.length" class="state-container">
          <ErrorState title="发现内容加载失败" :message="state.error" @retry="refresh" />
        </div>

        <!-- 空内容状态：居中提示 -->
        <div v-else-if="!state.items.length && !state.loading" class="state-container">
          <EmptyState title="暂无发现内容" description="服务端暂时没有返回可展示的内容" />
        </div>

        <!-- 发现内容数据流 -->
        <section v-else :class="['discover-content', { 'has-goods-grid': isGoodsTab(tab), 'has-dyh-grid': isDyhTab(tab), 'is-secondhand': tab.title.trim() === '二手', 'is-cool-picture': isCoolPictureTab(tab), 'is-goods-ranking': tab.title.trim() === '好物榜' || tab.pageName === 'V11_FIND_GOOD_GOODS_HOME' }]">
          <DiscoveryEntityCard
            v-for="(entity, index) in (tab.title.trim() === '二手' ? state.items.filter(item => !isSecondHandFeed(item)) : state.items)"
            :key="getEntityKey(entity, index)"
            :entity="entity"
            :plain-topic-labels="isCoolPictureTab(tab)"
            :ranking-context="tab.title.trim() === '好物榜' || tab.pageName === 'V11_FIND_GOOD_GOODS_HOME'"
            inline-selectors
            @open="openEntity"
            @filter="selectFilter"
          />
          <DiscoverySecondHandGrid v-if="tab.title.trim() === '二手'" :items="state.items.filter(isSecondHandFeed)" @open="openEntity" />
          <ErrorState v-if="state.error" class="discovery-filter-error" title="分类内容加载失败" :message="state.error" @retry="refresh" />
          <div v-if="state.loading" class="loading-more"><LoadingState text="正在加载更多..." /></div>
          <div v-else-if="!state.hasMore && !state.error" class="no-more">没有更多内容了</div>
        </section>
      </template>
      </div>
      </template>
      </DiscoveryPager>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { logDiagnostic, logDiagnosticLayout, summarizeDiagnosticError } from '../utils/diagnosticLogger';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../api/coolapk';
import DiscoveryEntityCard from '../components/discovery/DiscoveryEntityCard.vue';
import DiscoverySkeleton from '../components/discovery/DiscoverySkeleton.vue';
import DiscoveryPager from '../components/discovery/DiscoveryPager.vue';
import DiscoverySecondHandGrid from '../components/discovery/DiscoverySecondHandGrid.vue';
import { discoveryRipple } from '../utils/discoveryMotion';
import FeedTabs from '../components/feed/FeedTabs.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import LoadingState from '../components/common/LoadingState.vue';
import type { ConfigPageTab } from '../types/settings';
import type { DiscoveryEntity, DiscoveryPageResult, DiscoveryTab } from '../types/discovery';
import {
  decodeDiscoveryRouteSegment,
  getEntityKey,
  isGoodsEntity,
  normalizeDiscoveryPageUrl,
  parseDiscoveryPage,
  parseDiscoverySelectedKey,
  parseDiscoveryTabs,
  resolveDiscoveryRoute,
  resolveDiscoveryTopicRoute,
} from '../utils/discovery';

interface PageState extends DiscoveryPageResult {
  loading: boolean;
  error: string;
  webUrl: string;
  selectorUrl: string;
  selectorHeader: DiscoveryEntity[];
  requestId: number;
}

const router = useRouter();
const tabs = ref<DiscoveryTab[]>([]);
const selectedKey = ref('');
const feedTabsView = ref<InstanceType<typeof FeedTabs> | null>(null);
function updateSwipeProgress(position: number) { feedTabsView.value?.setSwipeProgress(position); }
const configError = ref('');
const states = reactive<Record<string, PageState>>({});
const feedTabs = computed<ConfigPageTab[]>(() => tabs.value.map((tab) => ({ id: tab.key, title: tab.title, page_name: tab.key, url: tab.url, subTitle: tab.subTitle })));
const selectedTabStorageKey = 'coolapk.discovery.selectedTab.v3';

const fallbackTabs: DiscoveryTab[] = [
  fallbackTab('发现', '#/feed/digestList'),
  fallbackTab('最新', '#/feed/newestList'),
  fallbackTab('酷图', 'V11_FIND_COOLPIC'),
  fallbackTab('应用', '#/apk/list'),
  fallbackTab('看看号', '/user/dyhSubscribe'),
];

// 初始化优先读取本地缓存，避免首屏瞬间无 Tab 和闪烁
try {
  const cached = JSON.parse(localStorage.getItem('coolapk.discovery.tabs.v2') || '[]');
  if (Array.isArray(cached) && cached.length) {
    tabs.value = cached;
    const savedSelected = localStorage.getItem(selectedTabStorageKey);
    selectedKey.value = tabs.value.some((tab) => tab.key === savedSelected)
      ? String(savedSelected)
      : tabs.value.find((tab) => tab.title.trim() === '生活')?.key || tabs.value[0]?.key || '';
  }
} catch {
  tabs.value = fallbackTabs;
  selectedKey.value = fallbackTabs[0]?.key || '';
}

const selectedTab = computed(() => tabs.value.find((tab) => tab.key === selectedKey.value));
function isCoolPictureTab(tab: DiscoveryTab) { return tab.pageName === 'V11_FIND_COOLPIC' || tab.url === 'V11_FIND_COOLPIC' || tab.title.trim() === '酷图'; }
function isSecondHandFeed(entity:DiscoveryEntity) { return String(entity.feedType || entity.feed_type).toLowerCase() === 'ershou' || String(entity.entityTemplate).toLowerCase() === 'feedershou'; }
const isCoolPicturePage = computed(() => selectedTab.value ? isCoolPictureTab(selectedTab.value) : false);
function isGoodsTab(tab: DiscoveryTab) {
  if (tab.title.trim() === '好物榜' || tab.pageName === 'V11_FIND_GOOD_GOODS_HOME') return false;
  if (tab?.nativeKind === 'goods' || tab?.pageName === 'V11_FIND_GOOD_GOODS_HOME') return true;
  const items = states[tab.key]?.items || [];
  return items.length > 1 && items.every(isGoodsEntity);
}
function isDyhTab(tab: DiscoveryTab) {
  if (tab?.nativeKind === 'dyh' || tab?.pageName === 'V11_FIND_DYH' || tab?.title?.includes('看看号')) return true;
  const items = states[tab.key]?.items || [];
  return items.length > 0 && items.every((item) => {
    const type = String(item.entityType || item.entityTemplate || '').toLowerCase();
    return type.includes('dyh') || type.includes('official');
  });
}

// 去重键不能依赖列表下标：全集与增量两套 index 基准不同，无 id 实体会生成不同键而重复插入。
// 无 id 时回退到稳定的模板+标题+链接内容键。
function entityDedupeKey(item: DiscoveryEntity): string {
  const id = item.entityId ?? item.id ?? item.url;
  if (id !== undefined && id !== null && String(id).trim()) return String(id);
  return JSON.stringify([
    item.entityTemplate ?? item.entityType ?? '',
    item.title ?? '',
    item.url ?? '',
  ]);
}

function fallbackTab(title: string, url: string): DiscoveryTab {
  return { key: url, title, url, visible: true, order: 0, raw: { title, url } };
}

function emptyState(loading = false): PageState {
  return { items: [], page: 1, hasMore: true, firstItem: '', lastItem: '', raw: null, loading, error: '', webUrl: '', selectorUrl: '', selectorHeader: [], requestId: 0 };
}

function ensureState(tab: DiscoveryTab): PageState {
  if (!states[tab.key]) states[tab.key] = emptyState(false);
  return states[tab.key];
}

async function loadConfig() {
  configError.value = '';
  try {
    const response = await CoolapkTauriAPI.getDiscoveryConfig();
    const parsed = parseDiscoveryTabs(response);
    if (parsed.length) {
      tabs.value = parsed;
      localStorage.setItem('coolapk.discovery.tabs.v2', JSON.stringify(parsed));
    }
    const serverSelected = parseDiscoverySelectedKey(response, tabs.value);
    const savedSelected = localStorage.getItem(selectedTabStorageKey);
    if (!selectedKey.value || !tabs.value.some((t) => t.key === selectedKey.value)) {
      selectedKey.value = tabs.value.some((tab) => tab.key === savedSelected)
        ? String(savedSelected)
        : tabs.value.find((tab) => tab.title.trim() === '生活')?.key || serverSelected || tabs.value[0]?.key || '';
    }
  } catch (error: any) {
    configError.value = error?.message || '无法获取服务端发现配置';
    logDiagnostic('warn', 'discovery', 'config_failed', summarizeDiagnosticError(error));
  } finally {
    if (!selectedKey.value && tabs.value.length) {
      selectedKey.value = tabs.value[0].key;
    }
    // 旧版保存的话题选中项不再作为发现页内容加载，恢复到可在页内浏览的频道。
    if (selectedTab.value && resolveDiscoveryTopicRoute(selectedTab.value.url || selectedTab.value.pageName || selectedTab.value.key)) {
      const inPageTab = tabs.value.find((tab) => tab.title.trim() === '生活' && !resolveDiscoveryTopicRoute(tab.url || tab.pageName || tab.key)) || tabs.value.find((tab) => !resolveDiscoveryTopicRoute(tab.url || tab.pageName || tab.key));
      if (inPageTab) selectedKey.value = inPageTab.key;
    }
    if (selectedKey.value) localStorage.setItem(selectedTabStorageKey, selectedKey.value);
    void loadSelected(false);
  }
}

function prepareTab(key: string) {
  const tab = tabs.value.find(item => item.key === key);
  if (!tab || resolveDiscoveryTopicRoute(tab.url || tab.pageName || tab.key) || (tab.openNewActivity && tab.nativeKind !== 'dyh')) return;
  void loadSelected(false, false, tab);
}

async function loadSelected(reset = false, loadMore = false, tab = selectedTab.value) {
  if (!tab) return;
  const state = ensureState(tab);
  const target = tab.webUrl || tab.raw.webUrl || tab.raw.web_url || tab.url;
  if (/^https?:\/\//i.test(String(target))) {
    state.webUrl = String(target);
    state.loading = false;
    return;
  }
  if (state.loading && !reset) return;
  if (!reset && !loadMore && state.items.length > 0) return;
  if (!reset && !state.hasMore) return;

  if (reset) {
    // 分类接口可能只返回动态；专区、横幅和分类栏属于当前频道的固定前缀。
    state.items = state.selectorUrl || state.flexUrl ? [...state.selectorHeader] : [];
    state.page = 1;
    state.hasMore = true;
    state.firstItem = '';
    state.lastItem = '';
    state.raw = null;
    state.pageContext = '';
    state.error = '';
  }
  state.loading = true;
  state.error = '';
  const requestId = ++state.requestId;
  const page = state.page;
  const diagnosticContext = `channel=${tab.pageName || tab.nativeKind || 'feed'} page=${page} reset=${reset} load_more=${loadMore}`;
  try {
    const response = tab.nativeKind === 'dyh'
      ? await CoolapkTauriAPI.getDyhList(state.page)
      : await CoolapkTauriAPI.getDiscoveryPageData({
        url: normalizeDiscoveryPageUrl(state.selectorUrl || state.flexUrl || tab.url || tab.pageName || tab.key),
        title: tab.title,
        subTitle: tab.subTitle,
        page: state.page,
        firstItem: state.firstItem,
        lastItem: state.lastItem,
        pageContext: state.pageContext || '',
      });
    const parsed = parseDiscoveryPage(response, state.page);
    if (requestId !== state.requestId) return;
    const known = new Set(state.items.map(entityDedupeKey));
    const nextItems = parsed.items.filter((item) => !known.has(entityDedupeKey(item)));
    state.items.push(...nextItems);
    state.raw = parsed.raw;
    state.firstItem = parsed.firstItem;
    state.lastItem = parsed.lastItem;
    state.pageContext = parsed.pageContext;
    state.hasMore = parsed.hasMore && nextItems.length > 0;
    state.page += 1;
    logDiagnostic('info', 'discovery', 'page_loaded', `${diagnosticContext} received=${parsed.items.length} appended=${nextItems.length} total=${state.items.length} has_more=${state.hasMore}`);
    if (parsed.flexUrl && !state.flexUrl && !state.selectorUrl) {
      state.flexUrl = parsed.flexUrl;
      state.selectorHeader = [...state.items];
      state.page = 1;
      state.firstItem = '';
      state.lastItem = '';
      state.pageContext = '';
      state.hasMore = true;
      state.loading = false;
      await loadSelected(false, true, tab);
    }
  } catch (error: any) {
    if (requestId !== state.requestId) return;
    const detail = error?.message || String(error || '未知错误');
    state.error = `${tab.title}（${tab.url || tab.pageName || tab.key}）：${detail}`;
    logDiagnostic('warn', 'discovery', 'page_failed', `${diagnosticContext} reason=${summarizeDiagnosticError(error)}`);
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      await nextTick();
      document.querySelectorAll<HTMLElement>('.discover-scroll-container').forEach(element => logDiagnosticLayout('discovery', element));
    }
  }
}

function selectTab(key: string) {
  const tab = tabs.value.find((item) => item.key === key);
  if (!tab) return;
  const topicRoute = resolveDiscoveryTopicRoute(tab.url || tab.pageName || tab.key);
  if (topicRoute) {
    navigateNative(topicRoute, tab.title);
    return;
  }
  selectedKey.value = key;
  localStorage.setItem(selectedTabStorageKey, key);
  if (tab.openNewActivity && tab.nativeKind !== 'dyh') {
    openTab(tab);
    return;
  }
  void loadSelected(false);
}

function openTab(tab: DiscoveryTab) {
  if (tab.nativeKind === 'dyh') {
    selectedKey.value = tab.key;
    void loadSelected(true);
    return;
  }
  const route = resolveDiscoveryRoute(tab.raw);
  if (!route) return;
  if (route.kind === 'web') {
    openWeb(route.target);
    return;
  }
  if (route.kind === 'native') {
    navigateNative(route.target, tab.title);
    return;
  }
  navigateDataList(tab.url || tab.pageName || tab.key, tab.title);
}

function openEntity(entity: DiscoveryEntity) {
  const route = resolveDiscoveryRoute(entity);
  if (!route) return;
  if (route.kind === 'web') {
    openWeb(route.target);
  } else if (route.kind === 'native') {
    navigateNative(route.target, route.title || String(entity.title || ''));
  } else {
    navigateDataList(route.target, route.title || String(entity.title || ''));
  }
}

function selectFilter(entity: DiscoveryEntity) {
  // selectorLinkCard 的 URL 是列表请求参数，不能按普通卡片解析成新页面。
  const target = String(entity.url || '').trim();
  if (!target || !selectedTab.value) return;
  if (/^https?:\/\//i.test(target)) { openEntity(entity); return; }
  const state = ensureState(selectedTab.value);
  if (state.selectorUrl === target && !state.error) return;
  const isSelector = (item: DiscoveryEntity): boolean => String(item.entityTemplate || '').toLowerCase().includes('selectorlink')
    || (item.entities || []).some(isSelector);
  let boundary = -1;
  state.items.forEach((item, index) => { if (isSelector(item)) boundary = index; });
  if (boundary >= 0) state.selectorHeader = state.items.slice(0, boundary + 1);
  const updateSelection = (item: DiscoveryEntity) => {
    if (String(item.entityTemplate || '').toLowerCase().includes('selectorlink') && item.entities?.some(child => child.url === target)) {
      item.entities.forEach(child => { child.selected = child.url === target; });
    }
    item.entities?.forEach(updateSelection);
  };
  state.selectorHeader.forEach(updateSelection);
  state.selectorUrl = target;
  void loadSelected(true);
}

function navigateDataList(target: string, title: string) {
  // 点击发现卡片时使用应用级页面标签，不向发现频道栏追加临时标签。
  void router.push({ path: '/page', query: { url: normalizeDiscoveryPageUrl(target), title: title || '内容', renderer: 'discovery' } });
}

function navigateNative(target: string, title: string) {
  const clean = target.replace(/^#/, '');
  const user = clean.match(/^\/user\/(\d+)/);
  const feed = clean.match(/^\/feed\/(\d+)/);
  const app = clean.match(/^\/apk\/([^/?#]+)/);
  const product = clean.match(/^\/product\/(\d+)/);
  const topic = clean.match(/^\/topic\/([^/?#]+)(?:\?([^#]*))?/);
  const dyh = clean.match(/^\/dyh\/(\d+)/);
  const goodsList = clean.match(/^\/goods\/(ranking|lists)\/([^/?#]+)/);
  const secondHandList = clean.match(/^\/feed\/ershouList(?:\?(.*))?$/i);
  if (user) void router.push(`/user/${user[1]}`);
  else if (feed) void router.push(`/feed/${feed[1]}`);
  else if (app) void router.push(`/app/${encodeURIComponent(decodeDiscoveryRouteSegment(app[1]))}`);
  else if (product) void router.push(`/product/${product[1]}`);
  else if (topic) void router.push(`/topic/${encodeURIComponent(decodeDiscoveryRouteSegment(topic[1]))}${topic[2] ? `?${topic[2]}` : ''}`);
  else if (dyh) void router.push(`/dyh/${dyh[1]}`);
  else if (goodsList) void router.push(`/goods/${goodsList[1]}/${goodsList[2]}`);
  else if (secondHandList) void router.push(`/secondhand/list${secondHandList[1] ? `?${secondHandList[1]}` : ''}`);
  else navigateDataList(target, title);
}

function openWeb(url: string) {
  void CoolapkTauriAPI.openUrl(url, 'internal');
}

function refresh() {
  if (selectedTab.value) void loadSelected(true);
  else void loadConfig();
}

function handleScroll(event: Event, tab: DiscoveryTab) {
  if (tab.key !== selectedKey.value || states[tab.key]?.error) return;
  const element = event.currentTarget as HTMLElement;
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 500) {
    void loadSelected(false, true);
  }
}

onMounted(() => { void loadConfig(); });

// 下拉仅刷新当前栏目，不切换筛选、路由或页面实例。
async function refreshMobilePage() { if (selectedTab.value) await loadSelected(true); else await loadConfig(); }
</script>

<style scoped>
.discover-page { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--background); }
.discover-main-column { display: flex; flex: 1; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--surface); }
.discover-toolbar-row { display: flex; flex: 0 0 auto; align-items: stretch; min-width: 0; background: var(--surface); }
.discover-toolbar-row :deep(.feed-tabs-wrapper) { flex: 1 1 auto; min-width: 0; }
.discover-scroll-container { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 20px 24px 48px; background: var(--background-secondary); container-type: inline-size; }
.web-route-card, .config-error { max-width: none; width: 100%; margin: 0 0 16px; background: var(--surface); border: 1px solid var(--border-light, rgba(0,0,0,.08)); border-radius: var(--radius-card, 12px); box-sizing: border-box; }
.web-route-card, .config-error { display: flex; align-items: center; gap: 14px; padding: 18px; }
.web-route-card > i { color: var(--brand-primary); font-size: 24px; }
.web-route-card div, .config-error { min-width: 0; }
.web-route-card div { display: flex; flex-direction: column; gap: 5px; flex: 1; }
.web-route-card span, .config-error span { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.web-route-card button, .config-error button { border: 0; border-radius: 8px; padding: 8px 16px; background: var(--brand-primary); color: white; cursor: pointer; font-weight: 500; }
.config-error { flex-wrap: wrap; color: var(--text-primary); }
.config-error span { flex: 1 1 100%; }
.state-container { max-width: none; width: 100%; margin: 30px 0 0; min-height: 360px; display: flex; justify-content: center; align-items: center; }
.discover-content { max-width: 1120px; width: 100%; min-width: 0; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.discover-content > :deep(*) { min-width: 0; }
.discover-scroll-container > :deep(.discovery-skeleton) { max-width: 1120px; margin-inline: auto; }
.discover-content.is-cool-picture, .is-cool-picture .discover-scroll-container > :deep(.discovery-skeleton) { box-sizing: border-box; width: 100%; padding-inline: 0; }
.discover-content.is-cool-picture { gap: 14px; }
/* 酷图页使用独立圆角卡片，末行卡片也伸展填满可用宽度。 */
.discover-content.is-cool-picture :deep(.discovery-entity-group.is-picture-topic-grid) { overflow: visible; border: 0; background: transparent; }
.discover-content.is-cool-picture :deep(.discovery-entity-group.is-picture-topic-grid .discovery-group-items) { display: flex; flex-wrap: wrap; gap: 12px; padding: 0; }
.discover-content.is-cool-picture :deep(.discovery-entity-group.is-picture-topic-grid .discovery-group-items > *) { flex: 1 1 220px; min-width: 0; }
.discover-content.is-cool-picture :deep(.discovery-entity-group.is-picture-topic-grid .topic-card.mode-card) { box-sizing: border-box; min-height: 144px; justify-content: center; }
.discover-content.is-cool-picture :deep(.discovery-icon-grid) { padding-bottom: 0; border: 0; background: transparent; }
.discover-content.is-cool-picture :deep(.discovery-icon-grid-items.is-category-grid) { display: flex; flex-wrap: wrap; gap: 12px; padding: 0; }
.discover-content.is-cool-picture :deep(.discovery-icon-grid-item.is-category-item) { flex: 1 1 150px; min-width: 0; min-height: 112px; gap: 8px; padding: 12px 8px; border: 1px solid var(--border-light, rgba(0, 0, 0, .08)); border-radius: var(--radius-card, 16px); background: var(--surface); }
.discover-content.is-cool-picture :deep(.discovery-icon-grid-item.is-category-item:hover) { border-color: var(--brand-primary); background: var(--surface-hover); box-shadow: 0 6px 18px rgba(0, 0, 0, .06); }
.discover-content.is-cool-picture :deep(.discovery-icon-grid-item.is-category-item .discovery-icon-inner) { width: 48px; height: 48px; }
.discover-content.is-cool-picture :deep(.discovery-icon-grid-item.is-category-item .discovery-icon-grid-image img) { width: 48px; height: 48px; max-width: 48px; max-height: 48px; }
.discover-content.has-goods-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: stretch; }
.discover-content.has-dyh-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.loading-more, .no-more { grid-column: 1 / -1; padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 13px; }
.discovery-filter-error { grid-column: 1 / -1; }
.discover-content.is-secondhand { grid-template-columns: 1fr; gap:10px; }
.is-secondhand :deep(.discovery-icon-grid-items) { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px 0; padding:14px 8px; }
.is-secondhand :deep(.discovery-icon-grid-item) { min-width:0; padding:4px 0; }
@media(max-width:720px) {
  .is-secondhand :deep(.discovery-icon-grid-image) { width:32px; height:32px; }
  .is-secondhand :deep(.discovery-icon-grid-image img) { width:32px; height:32px; }
  .is-secondhand :deep(.discovery-category-label) { font-size:12px; font-weight:400; }
}
@media (max-width: 1250px) {
  .discover-content.has-goods-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 860px) {
  .discover-scroll-container { padding-top: 12px; padding-bottom: max(48px, var(--mobile-bottom-overlay-space, 0px)); }
  .discover-content.has-dyh-grid { grid-template-columns: 1fr; }
  .discover-content.has-goods-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
/* 与移动外壳一致，720px 以下按 APK 的卡片、间距与两列小图标呈现。 */
@media (max-width: 720px) {
  .discover-scroll-container { padding: 8px 8px max(24px, var(--mobile-bottom-overlay-space, 0px)); border-radius: 16px 16px 0 0; }
  .discover-content { gap: 8px; }
  .discover-content :deep(.discovery-entity-group),
  .discover-content :deep(.discovery-icon-grid),
  .discover-content :deep(.discovery-carousel-card) { border: 0; border-radius: 12px; }
  .discover-content :deep(.discovery-group-header) { padding: 12px 12px 8px; }
  .discover-content :deep(.discovery-group-header h3) { font-size: 16px; }
  .discover-content :deep(.discovery-group-header h3::before) { display: none; }
  .discover-content :deep(.discovery-group-header button) { color: var(--text-tertiary); font-size: 14px; }
  .discover-content :deep(.discovery-mini-grid-items) { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; padding: 6px 4px; }
  .discover-content :deep(.discovery-mini-grid-item) { min-height: 36px; padding: 8px; gap: 8px; border: 0; border-radius: 0; font-size: 14px; background: transparent; }
  :deep(.discovery-mini-grid-item), :deep(.discovery-pill-btn), :deep(.tab-item), :deep(.discovery-group-header button) { position: relative; overflow: hidden; }
  .discover-content :deep(.discovery-mini-icon) { width: 20px; height: 20px; flex-basis: 20px; border-radius: 4px; }
  .discover-content :deep(.discovery-selector-card) { border: 0; padding: 0; overflow: visible; }
  .discover-content :deep(.discovery-selector-pills) { flex-wrap: nowrap; gap: 8px; overflow-x: auto; scrollbar-width: none; }
  .discover-content :deep(.discovery-selector-pills::-webkit-scrollbar) { display: none; }
  .discover-content :deep(.discovery-pill-btn) { flex: 0 0 auto; height: 34px; padding: 0 12px; border: 0; border-radius: 9px; background: var(--surface); font-size: 14px; }
  .discover-content :deep(.discovery-pill-btn.is-active) { background: var(--brand-primary); color: white; }
  .discover-content :deep(.carousel-viewport) { height: auto; aspect-ratio: 4.5; min-height: 0; }
  .discover-content :deep(.discovery-image-card:hover), .discover-content :deep(.discovery-generic-card:hover), .discover-content :deep(.discovery-special-card:hover), .discover-content :deep(.topic-card.mode-card:hover) { transform: none; box-shadow: none; }
  .discover-content :deep(.discovery-pill-btn.is-active) { box-shadow: none; }
}
@container (max-width: 440px) {
  .discover-content :deep(.discovery-mini-grid-items) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.discover-content.is-goods-ranking { grid-template-columns: 1fr; }
.is-goods-ranking :deep(.discovery-icon-grid-items.is-category-grid) { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:16px 4px; padding:12px 8px; }
.is-goods-ranking :deep(.discovery-icon-grid-item.is-category-item) { padding:4px 0; min-width:0; }
.is-goods-ranking :deep(.discovery-category-label) { font-weight:400; font-size:14px; }
.is-goods-ranking :deep(.discovery-icon-grid-image img) { object-fit:contain; box-shadow:none !important; border-radius:0; transform:none !important; }
.is-goods-ranking :deep(.discovery-icon-inner) { transform:none !important; }
@media(min-width:1000px) {
  .discover-content.is-goods-ranking { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .is-goods-ranking > :deep(:not(.discovery-ranking-card)) { grid-column:1 / -1; }
}
</style>
