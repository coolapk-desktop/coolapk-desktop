<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy }" class="page-container custom-scrollbar" @scroll="handleScroll">
    <!-- 未登录引导 -->
    <div v-if="!authStore.isLoggedIn" class="empty-wrapper">
      <EmptyState title="登录后查看浏览历史" description="登录酷安账号后，此处将同步展示您在酷安上真实的浏览历史与最近访问记录" />
      <div class="login-hint">
        <AppButton variant="primary" size="sm" @click="authStore.openLoginModal()">立即登录</AppButton>
      </div>
    </div>

    <!-- 登录后展示实际访问的帖子历史。 -->
    <div v-else class="history-two-columns">
      <main class="history-main-timeline">
        <div class="section-title-row">
          <h2>帖子浏览历史</h2>
        </div>

        <div v-if="loading && filteredMainTimelineItems.length === 0" class="loading-wrapper">
          <LoadingState text="正在读取历史记录..." />
        </div>
        <div v-else-if="error && filteredMainTimelineItems.length === 0" class="error-wrapper">
          <ErrorState title="加载历史失败" :message="error" @retry="fetchHistory(true)" />
        </div>
        <div v-else-if="filteredMainTimelineItems.length === 0" class="empty-wrapper">
          <EmptyState :title="noMore ? '暂无帖子浏览记录' : '当前记录中暂无帖子'" description="打开帖子后，浏览记录会显示在此处" />
          <AppButton v-if="!noMore" size="sm" :disabled="loadingMore" @click="fetchHistory(false)">{{ loadingMore ? '正在查找...' : '继续加载帖子记录' }}</AppButton>
        </div>

        <div v-else class="timeline-tree">
          <div class="timeline-stem"></div>

          <div
            v-for="group in groupedFilteredTimeline"
            :key="group.dateLabel"
            class="timeline-group"
          >
            <div class="timeline-date-header">
              <div class="date-dot"></div>
              <span class="date-title">{{ group.dateLabel }}</span>
              <span class="group-count">{{ group.items.length }} 记录</span>
            </div>

            <div class="feed-posts-list">
              <div
                v-for="item in group.items"
                :key="item.id"
                class="feed-history-card history-item"
                @click="openItem(item)"
              >
                <div class="card-main-layout">
                  <div class="card-avatar-col">
                    <AppAvatar v-if="itemAvatar(item)" :src="itemAvatar(item)" size="md" :alt="itemAuthorName(item)" />
                    <div v-else :class="['item-type-avatar', `type-${getItemType(item)}`]">
                      <i :class="itemTypeIcon(item)"></i>
                    </div>
                  </div>

                  <div class="card-left-info">
                    <div class="feed-card-top">
                      <div class="feed-author-meta">
                        <div class="card-name-line">
                          <span class="feed-author-name">{{ itemAuthorName(item) }}</span>
                          <span v-if="typeLabel(item)" :class="['type-badge', `type-${getItemType(item)}`]">
                            {{ typeLabel(item) }}
                          </span>
                        </div>
                        <div class="feed-time-text">
                          <span><i class="far fa-clock"></i> 浏览 {{ formatTimeExact(item.dateline) }}</span>
                          <span v-if="itemPublishTime(item)">发布 {{ itemPublishTime(item) }}</span>
                        </div>
                      </div>
                    </div>

                    <div v-if="itemPostTitle(item)" class="history-post-title">{{ itemPostTitle(item) }}</div>
                    <div
                      v-if="richDescription(item)"
                      class="feed-text-content history-desc"
                      v-html="richDescription(item)"
                      @click.stop="handleDescClick($event, item)"
                    ></div>
                  </div>

                  <div v-if="itemCoverPic(item)" class="card-thumb-wrap" @click.stop="openItem(item)">
                    <AppImage :src="itemCoverPic(item)" class="card-thumb-img" fit="cover" />
                  </div>

                  <div class="card-arrow-wrap">
                    <i class="fas fa-chevron-right arrow-icon"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="pagination-footer">
            <LoadingState v-if="loadingMore" text="正在读取更多历史足迹..." />
            <div v-else-if="noMore" class="no-more">已加载全部历史记录</div>
            <AppButton v-else size="sm" @click="fetchHistory(false)">加载更多浏览记录</AppButton>
          </div>
        </div>
      </main>

    </div>
  </div>
</template>

<script setup lang="ts">
import { vPullRefresh } from '../directives/pullRefresh';
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import LoadingState from '../components/common/LoadingState.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorState from '../components/common/ErrorState.vue';
import AppAvatar from '../components/common/AppAvatar.vue';
import AppImage from '../components/common/AppImage.vue';
import { CoolapkTauriAPI } from '../api/coolapk';
import { renderCoolapkRichText } from '../utils/richText';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import { htmlToPlainText } from '../utils/htmlText';
import { handleAnchorClick } from '../utils/anchorClick';
import { openFeedDetail } from '../utils/feedNavigation';

const router = useRouter();
const authStore = useAuthStore();

const loading = ref(false);
const loadingMore = ref(false);
const noMore = ref(false);
const feeds = ref<any[]>([]);
const page = ref(1);
const error = ref('');
const historyPageCursor = ref<{ firstItem?: string; lastItem?: string }>({});
const feedDetails = ref<Record<string, any>>({});
let metadataGeneration = 0;
let metadataQueue: any[] = [];
let metadataRequests = 0;
const requestedMetadata = new Set<string>();

function itemFeedId(item: any): string {
  return firstText(item?.url, item?.targetUrl).match(/\/?feed\/(\d+)/)?.[1]
    || firstText(item?.id, item?.entityId).match(/^(?:feed:)?(\d+)$/)?.[1] || '';
}

function itemFeed(item: any): any {
  return feedDetails.value[itemFeedId(item)] || item?.feed || null;
}

// 历史实体只提供摘要 title；游客详情补齐作者和发布时间，不产生账号浏览记录。
function loadHistoryMetadata(items: any[]) {
  for (const item of items) {
    const id = itemFeedId(item);
    if (!id || requestedMetadata.has(id)) continue;
    requestedMetadata.add(id);
    const cached = useAppStore().getFeedDetailContext(id);
    if (cached?.username && cached?.entityType !== 'history') {
      feedDetails.value[id] = cached;
    } else metadataQueue.push({ id, generation: metadataGeneration });
  }
  drainMetadataQueue();
}

function drainMetadataQueue() {
  while (metadataRequests < 2 && metadataQueue.length) {
    const { id, generation } = metadataQueue.shift();
    metadataRequests++;
    void CoolapkTauriAPI.getPublicFeedDetail(id).then((response) => {
      if (generation === metadataGeneration && String(response?.data?.id) === id) feedDetails.value[id] = response.data;
    }).catch(() => {
      // 已删除、私密或暂不可访问的帖子仍展示历史摘要，不阻塞列表。
    }).finally(() => { metadataRequests--; drainMetadataQueue(); });
  }
}

function resetMetadata() {
  metadataGeneration++;
  metadataQueue = [];
  requestedMetadata.clear();
  feedDetails.value = {};
}

onUnmounted(resetMetadata);

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function isFeedHistoryItem(item: any): boolean {
  const entityType = firstText(item?.entityType, item?.entity_type).toLowerCase();
  if (entityType && !['history', 'feed', 'feedarticle'].includes(entityType)) return false;
  const historyType = firstText(item?.historyType, item?.history_type).toLowerCase();
  if (historyType) return historyType === 'feed' || historyType === 'feedarticle';
  const url = firstText(item?.url, item?.targetUrl);
  return /^\/?feed\/\d+(?:[/?#]|$)/i.test(url);
}

function entityId(item: any): string {
  return firstText(item?.id, item?.entityId, item?.entity_id);
}

function historyCursor(): { firstItem?: string; lastItem?: string } {
  return historyPageCursor.value;
}

function getItemType(item: any): 'feed' | 'user' | 'topic' | 'apk' {
  if (!item) return 'feed';
  if (isFeedHistoryItem(item)) return 'feed';
  const type = firstText(item?.type, item?.entityType, item?.entity_type, item?.target_type, item?.entityTemplate).toLowerCase();
  const url = firstText(item?.url, item?.targetUrl).toLowerCase();
  const title = asText(item?.title);

  // URL 前缀优先判定（历史条目 url 形如 /u/xxx、/feed/xxx、/t/xxx、/apk/xxx）
  if (type === 'user' || url.startsWith('/u/')) return 'user';
  if (type === 'topic' || type === 'dyh' || url.startsWith('/t/') || url.includes('/topic/')) return 'topic';
  if (type === 'apk' || type === 'game' || type === 'product' || url.startsWith('/apk/') || url.includes('/product/') || item?.apkname || item?.packageName) return 'apk';
  if (type === 'feed' || url.startsWith('/feed/')) return 'feed';

  // 无 URL 时的兜底判断
  if (title.endsWith('的动态')) return 'user';

  return 'feed';
}

function typeLabel(item: any): string {
  const t = getItemType(item);
  if (t === 'user') return '用户';
  if (t === 'topic') return '话题';
  if (t === 'apk') return '应用';
  if (t === 'feed') return '动态';
  return '';
}

function itemAuthorName(item: any): string {
  const feed = itemFeed(item);
  const username = firstText(feed?.username, feed?.userInfo?.username, item?.username, item?.userInfo?.username).trim();
  if (username) return username;
  const title = asText(item?.title).trim();
  return title.endsWith('的动态') ? title.replace(/的动态$/, '').trim() || '未知用户' : '未知用户';
}

function itemPostTitle(item: any): string {
  const feed = itemFeed(item);
  // 已有详情正文时，历史 title 可能只是正文摘要，不能再当作独立标题。
  const title = htmlToPlainText(firstText(feed?.message_title, feed?.messageTitle, feed?.title, !firstText(feed?.message, feed?.message_raw_output) ? item?.title : '')).trim();
  return title && !title.endsWith('的动态') ? title : '';
}

function itemPublishTime(item: any): string {
  // 历史 dateline 是浏览时间，绝不能拿来充当发布时间。
  const date = timestampToDate(itemFeed(item)?.dateline);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${formatTimeExact(date.getTime())}`;
}

function itemAvatar(item: any): string {
  const raw = item?.userAvatar || item?.user_avatar || item?.avatar || item?.userInfo?.userAvatar || item?.authorAvatar || item?.logo;
  if (typeof raw === 'string' && raw.trim() && raw.length > 5) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    if (trimmed.startsWith('http')) return trimmed;
    if (!trimmed.startsWith('/')) return `https://image.coolapk.com/${trimmed}`;
    return trimmed;
  }
  return '';
}

function itemTypeIcon(item: any): string {
  const type = getItemType(item);
  if (type === 'user') return 'fas fa-user';
  if (type === 'topic') return 'fas fa-hashtag';
  if (type === 'apk') return 'fas fa-cube';
  return 'fas fa-align-left';
}

function cleanDescriptionText(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.trim();
  if (text === 'feed' || text === 'null' || text === 'undefined') return '';

  // 去除纯图片占位标记如 [图片]、[视频]、[查看图片]
  text = text.replace(/\[\s*(?:图片|视频|查看图片)\s*\]/gi, '');

  // 将连续 2 个以上的换行符折叠为单个换行，防止换行挤占整行高度导致半截文字
  text = text.replace(/\n\s*\n+/g, '\n');

  return text.trim();
}

function richDescription(item: any): string {
  // 优先展示详情正文；历史 description 对文章经常只是标题，不能重复渲染。
  const feed = itemFeed(item);
  const desc = firstText(feed?.message, feed?.message_raw_output, item?.description, item?.message, item?.digest, item?.subTitle);
  const cleaned = cleanDescriptionText(desc);
  if (htmlToPlainText(cleaned).replace(/\s+/g, '') === itemPostTitle(item).replace(/\s+/g, '')) return '';
  if (
    cleaned &&
    !['feedcover', 'feed', 'feedarticle', 'feedreply', 'user', 'topic', 'apk', 'history'].includes(cleaned.toLowerCase())
  ) {
    return renderCoolapkRichText(cleaned);
  }
  return '';
}

function itemCoverPic(item: any): string {
  // 与帖子详情使用同一图片来源；历史摘要无封面时恢复右侧首图缩略图。
  for (const source of [itemFeed(item), item]) {
    const pictures = [source?.pic, source?.cover, source?.extra_pic, source?.smallPic, source?.image, ...(Array.isArray(source?.picArr) ? source.picArr : []), ...(Array.isArray(source?.pics) ? source.pics : [])];
    for (const pic of pictures) {
      if (typeof pic !== 'string' || !pic.trim() || pic.includes('avatar') || pic.includes('default') || pic.trim().length <= 8) continue;
      return pic.trim().startsWith('//') ? `https:${pic.trim()}` : pic.trim();
    }
  }
  return '';
}

function timestampToDate(value: unknown): Date | null {
  const ts = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.trim())
      : 0;
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const date = new Date(ts > 9999999999 ? ts : ts * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateLabel(timestamp: unknown): string {
  const date = timestampToDate(timestamp);
  if (!date) return '更早之前';
  const now = new Date();

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) return '今天';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) return '昨天';

  const beforeYesterday = new Date(now);
  beforeYesterday.setDate(now.getDate() - 2);
  const isBeforeYesterday =
    date.getFullYear() === beforeYesterday.getFullYear() &&
    date.getMonth() === beforeYesterday.getMonth() &&
    date.getDate() === beforeYesterday.getDate();

  if (isBeforeYesterday) return '前天';

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatTimeExact(dateline: unknown): string {
  const date = timestampToDate(dateline);
  if (date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  return asText(dateline);
}

function historyRowKey(item: any): string {
  const id = entityId(item);
  if (!id) return '';
  const type = firstText(item?.historyType, item?.type, item?.entityType).toLowerCase();
  return `${type}:${id}`;
}

function deduplicateHistoryItems(items: any[]): any[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = historyRowKey(item);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const filteredMainTimelineItems = computed(() => feeds.value);

const groupedFilteredTimeline = computed(() => {
  const map: Map<string, any[]> = new Map();
  for (const item of filteredMainTimelineItems.value) {
    const label = getDateLabel(item.dateline);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(item);
  }
  const result: { dateLabel: string; items: any[] }[] = [];
  for (const [dateLabel, items] of map.entries()) {
    result.push({ dateLabel, items });
  }
  return result;
});

function openItem(item: any) {
  const type = firstText(item?.historyType, item?.history_type, item?.type, item?.entityType).toLowerCase();
  const url = firstText(item?.url, item?.targetUrl);
  const id = firstText(item?.id, item?.target_id, item?.entityId);

  if (type === 'feed' || type === 'feedarticle' || url.includes('/feed/')) {
    const feedId = url.match(/\/feed\/(\d+)/)?.[1] || id.match(/^(?:feed:)?(\d+)$/)?.[1];
    if (feedId) {
      openFeedDetail(router, feedId, item);
      return;
    }
  }

  if (url && url.startsWith('/')) {
    if (url.startsWith('/u/')) {
      const uid = url.replace('/u/', '').split('?')[0];
      router.push(`/user/${uid}`);
      return;
    }
    if (url.startsWith('/topic/') || url.startsWith('/t/')) {
      const tag = url.replace(/^\/(topic|t)\//, '').split('?')[0];
      router.push(`/topic/${encodeURIComponent(tag)}`);
      return;
    }
    if (url.startsWith('/feed/')) {
      const feedId = url.replace('/feed/', '').split('?')[0];
      openFeedDetail(router, feedId, item);
      return;
    }
  }

  if (id) {
    switch (type) {
      case 'user':
        router.push(`/user/${id}`);
        return;
      case 'topic':
      case 'dyh':
        router.push(`/topic/${encodeURIComponent(item.title || id)}`);
        return;
      case 'apk':
      case 'game':
        router.push(`/product/${id}`);
        return;
      case 'album':
      case 'appCollection':
        router.push(`/album/${id}`);
        return;
    }
  }

  const full = url.startsWith('http') ? url : `https://www.coolapk.com${url}`;
  CoolapkTauriAPI.openUrl(full, 'internal');
}

function handleDescClick(e: Event, item: any) {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor?.href) {
    openItem(item);
    return;
  }
  e.preventDefault();
  const feedMatch = (anchor.getAttribute('href') || '').match(/^\/feed\/(\d+)/);
  if (feedMatch?.[1]) {
    openFeedDetail(router, feedMatch[1], item);
    return;
  }
  handleAnchorClick(e);
}

async function fetchHistory(isRefresh = false) {
  if (loading.value || (loadingMore.value && !isRefresh)) return;

  if (isRefresh) {
    page.value = 1;
    noMore.value = false;
    feeds.value = [];
    historyPageCursor.value = {};
    loading.value = true;
  } else {
    if (noMore.value) return;
    loadingMore.value = true;
  }
  error.value = '';

  try {
    // 与官方 HistoryTimeV9Fragment 一致：空 type 才返回带浏览时间的 history 实体。
    // type=feed 返回帖子实体，其中 dateline 是发布时间，不能用于历史时间轴。
    for (let attempt = 0; attempt < 5; attempt++) {
      const cursor = historyCursor();
      const res = await CoolapkTauriAPI.getHitHistory(page.value, '', cursor.firstItem, cursor.lastItem);
      const rawItems: any[] = Array.isArray(res?.data) ? res.data : [];
      if (!rawItems.length) { noMore.value = true; break; }
      const lastItem = entityId(rawItems[rawItems.length - 1]) || undefined;
      if (lastItem && lastItem === cursor.lastItem) { noMore.value = true; break; }
      // 游标取完整历史列表，不能用筛选后的帖子替换用户、话题等末尾记录。
      historyPageCursor.value = { firstItem: cursor.firstItem || entityId(rawItems[0]) || undefined, lastItem };
      page.value++;
      const existingKeys = new Set(feeds.value.map(historyRowKey).filter(Boolean));
      const newFeeds = deduplicateHistoryItems(rawItems.filter(isFeedHistoryItem)).filter(item => !existingKeys.has(historyRowKey(item)));
      feeds.value.push(...newFeeds);
      loadHistoryMetadata(newFeeds);
      if (newFeeds.length) break;
    }
  } catch (err: any) {
    error.value = err?.message || '加载失败，请检查网络';
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

function handleScroll(e: Event) {
  if (!authStore.isLoggedIn) return;
  const target = e.target as HTMLElement;
  const { scrollTop, clientHeight, scrollHeight } = target;
  if (scrollTop + clientHeight >= scrollHeight - 120) {
    if (!loading.value && !loadingMore.value && !noMore.value) {
      void fetchHistory(false);
    }
  }
}

watch(
  () => authStore.user?.uid,
  () => {
    resetMetadata();
    if (!authStore.isLoggedIn) return;
    if (feeds.value.length === 0) void fetchHistory(true);
  }
);

onMounted(() => {
  if (authStore.isLoggedIn) {
    void fetchHistory(true);
  }
});

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => loading.value || loadingMore.value);
async function refreshMobilePage() { await fetchHistory(true); }
</script>

<style scoped>
.page-container {
  width: 100%;
  max-width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: 0;
  margin: 0;
  background-color: var(--background-secondary);
}

.history-two-columns {
  display: flex;
  align-items: flex-start;
  width: 100%;
  max-width: 1000px;
  padding: 16px;
  margin: 0 auto;
  box-sizing: border-box;
}

.history-main-timeline {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.section-title-row {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 8px 0 16px;
}

.section-title-row h2 {
  margin: 0;
  font-size: 16px;
  color: var(--text-primary);
}

/* 动态专属时间轴 */
.timeline-tree {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-left: 14px;
}

.timeline-stem {
  position: absolute;
  top: 14px;
  bottom: 20px;
  left: 6px;
  width: 2px;
  background: linear-gradient(to bottom, var(--brand-primary), var(--border));
  z-index: 1;
}

.timeline-group {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 2;
}

.timeline-date-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.date-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background-color: var(--brand-primary);
  border: 3px solid var(--surface);
  box-shadow: 0 0 0 3px var(--brand-soft);
  flex-shrink: 0;
  z-index: 3;
}

.date-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.group-count {
  font-size: 11px;
  color: var(--text-tertiary);
  background-color: var(--background);
  padding: 1px 7px;
  border-radius: var(--radius-pill);
}

.feed-posts-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 24px;
}

.feed-history-card {
  background-color: var(--surface);
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.08));
  border-radius: var(--radius-card, 12px);
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.feed-history-card:hover {
  border-color: var(--brand-primary, #10b981);
  transform: translateY(-1.5px);
  box-shadow: 0 6px 18px rgba(16, 185, 129, 0.08);
}

.card-main-layout {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  width: 100%;
}

.card-avatar-col {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-type-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--brand-soft, rgba(16, 185, 129, 0.12));
  color: var(--brand-primary, #10b981);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  transition: all 0.2s ease;
}

.item-type-avatar.type-user {
  background-color: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}

.item-type-avatar.type-topic {
  background-color: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.item-type-avatar.type-apk {
  background-color: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}

.card-left-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feed-card-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.feed-author-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.type-badge {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--brand-primary, #10b981);
  background-color: var(--brand-soft, rgba(16, 185, 129, 0.1));
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.type-badge.type-user {
  color: #3b82f6;
  background-color: rgba(59, 130, 246, 0.1);
}

.type-badge.type-topic {
  color: #f59e0b;
  background-color: rgba(245, 158, 11, 0.1);
}

.type-badge.type-apk {
  color: #8b5cf6;
  background-color: rgba(139, 92, 246, 0.1);
}

.feed-author-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feed-time-text {
  font-size: 11.5px;
  color: var(--text-tertiary);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.history-post-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.arrow-icon {
  font-size: 12px;
  color: var(--text-tertiary);
  opacity: 0.4;
  transition: all 0.2s ease;
}

.feed-history-card:hover .arrow-icon {
  transform: translateX(3px);
  opacity: 1;
  color: var(--brand-primary);
}

.feed-text-content {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: transparent;
  padding: 0;
  margin: 0;
  border-radius: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.feed-text-content :deep(a) {
  color: var(--brand-primary, #10b981);
  font-weight: 500;
  text-decoration: none;
  padding: 0 2px;
}

.feed-text-content :deep(a):hover {
  text-decoration: underline;
}

.feed-text-content :deep(.coolapk-emoji) {
  display: inline-block;
  vertical-align: -3px;
  width: 18px;
  height: 18px;
  margin: 0 2px;
}

.card-thumb-wrap {
  width: 72px;
  height: 72px;
  min-width: 72px;
  max-width: 72px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--background-secondary);
  border: 1px solid var(--border-light);
  flex-shrink: 0;
  margin-top: 4px;
}

.card-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-arrow-wrap {
  align-self: center;
  padding-left: 2px;
}

.login-hint {
  margin-top: var(--space-3);
  text-align: center;
}

.pagination-footer {
  padding: 16px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* 手机缩略图保留在右侧，缩小占位以给标题和正文留出阅读宽度。 */
@media (max-width: 600px) {
  .feed-history-card { padding: 12px; }
  .card-main-layout { gap: 8px; }
  .card-thumb-wrap { width: 48px; height: 48px; min-width: 48px; max-width: 48px; }
  .card-arrow-wrap { display: none; }
  .feed-posts-list { padding-left: 12px; }
}
</style>
