<template>
  <div class="settings-section">
    <h3 class="section-title">内容偏好设置</h3>

    <div class="setting-group">
      <h4 class="group-title">正文与列表</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">正文折叠阈值</span>
          <span class="row-sub">列表卡片正文超过设置行数时自动显示“展开全文”按钮</span>
        </div>
        <select v-model.number="settingsStore.settings.collapseLines" class="select-control">
          <option :value="8">超 8 行折叠</option>
          <option :value="12">超 12 行折叠 (推荐)</option>
          <option :value="18">超 18 行折叠</option>
          <option :value="0">从不折叠 (展示全部正文)</option>
        </select>
      </div>

    </div>

    <div class="setting-group">
      <h4 class="group-title">动态展示</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">图片自适应排列</span>
          <span class="row-sub">桌面端按帖子可用宽度排列多图，能放下时显示在同一行，空间不足时自动换行</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.adaptiveFeedImages" />
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">无图模式</span>
          <span class="row-sub">开启后不显示图片、视频及图片占位图，适合专注阅读文字</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.noImageMode" />
      </div>

      <div v-if="settingsStore.settings.noImageMode" class="setting-row">
        <div class="row-info">
          <span class="row-label">进入详情时展示图片</span>
          <span class="row-sub">首页和列表保持无图，进入动态或问答详情后显示图片</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.showImagesInDetail" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">动图自动播放</span>
          <span class="row-sub">关闭后列表中的 GIF 动图将不加载，节省流量</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.autoPlayGif" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">显示动态背景图</span>
          <span class="row-sub">显示作者在动态顶部的背景和装饰图，关闭后保留正文配图与头像</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.showFeedBackground" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">显示发帖设备信息</span>
          <span class="row-sub">在动态头部展示作者使用的设备型号</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.showDeviceInfo" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">时间显示格式</span>
          <span class="row-sub">动态时间展示为“X 分钟前”或完整日期时间</span>
        </div>
        <select v-model="settingsStore.settings.timeDisplay" class="select-control">
          <option value="relative">相对时间 (推荐)</option>
          <option value="absolute">绝对时间 (yyyy-MM-dd HH:mm)</option>
        </select>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">图片点击打开方式</span>
          <span class="row-sub">点击图片时使用内置查看器，或交给系统默认图片查看器</span>
        </div>
        <select v-model="settingsStore.settings.imageOpenMode" class="select-control">
          <option value="internal">内置查看器 (推荐)</option>
          <option value="system" :disabled="!supportsSystemViewer">
            系统默认查看器{{ supportsSystemViewer ? '' : '（当前平台不支持）' }}
          </option>
        </select>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">Live 图片自动播放声音</span>
          <span class="row-sub">打开 Live 图片时自动播放原声；关闭后默认静音，可在查看器中手动开启</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.autoPlayLivePhotoSound" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">不再提醒 Live 图片编码问题</span>
          <span class="row-sub">关闭后仍保留静态封面，可在此处重新开启提示</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.suppressUnsupportedLivePhotoCodecPrompt" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">打开图片自动加载原图</span>
          <span class="row-sub">进入内置图片查看器时直接加载原图，可能增加等待时间和流量消耗</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.autoLoadOriginalImage" />
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">评论排序</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">话题讨论默认排序</span>
          <span class="row-sub">进入话题讨论页时，动态列表默认按最新排序</span>
        </div>
        <select v-model="settingsStore.settings.topicDiscussionDefaultSortMode" class="select-control">
          <option value="latest">最新</option>
          <option value="default">默认</option>
          <option value="hot">热度</option>
        </select>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">普通评论默认排序</span>
          <span class="row-sub">动态、回答等普通评论区使用的默认排序</span>
        </div>
        <select v-model="settingsStore.settings.commentDefaultSortMode" class="select-control">
          <option value="default">默认</option>
          <option value="latest">最新</option>
          <option value="likes">热门</option>
        </select>
      </div>
    </div>

    <details class="search-order-group" @toggle="toggleSearchOrder">
      <summary class="search-order-trigger">
        <span><i class="fas fa-arrow-down-short-wide" aria-hidden="true"></i>搜索分类排序</span>
        <i class="fas fa-chevron-down search-order-chevron" aria-hidden="true"></i>
      </summary>
      <div class="search-order-content">
        <div class="search-order-heading">
          <p class="row-sub">综合固定在第一位。拖动右侧手柄调整其他分类，松手后自动保存，手机和桌面搜索均立即生效。</p>
          <AppButton variant="ghost" size="sm" :disabled="!settingsStore.settings.searchTabOrder.length" @click="resetSearchOrder">恢复默认</AppButton>
        </div>
        <SearchTabOrderList v-if="searchOrderOpen" :tabs="orderedSearchTabs" @reorder="saveSearchOrder" />
        <p class="row-sub" role="status">{{ searchOrderMessage }}</p>
      </div>
    </details>

    <div class="setting-group">
      <h4 class="group-title">关键词屏蔽</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">屏蔽关键词</span>
          <span class="row-sub">正文或标题包含任一关键词的动态，将不在时间线中显示</span>
        </div>
      </div>
      <div class="keyword-input-row">
        <input
          v-model="keywordInput"
          type="text"
          class="text-input"
          placeholder="输入要屏蔽的关键词，回车或点击添加"
          @keydown.enter.prevent="addKeyword"
        />
        <AppButton variant="secondary" size="sm" @click="addKeyword">添加</AppButton>
      </div>
      <div v-if="blockedKeywords.length > 0" class="keyword-chips">
        <span v-for="kw in blockedKeywords" :key="kw" class="keyword-chip">
          <span class="chip-text">{{ kw }}</span>
          <button class="chip-remove" type="button" title="移除" @click="removeKeyword(kw)">
            <i class="fas fa-times"></i>
          </button>
        </span>
      </div>
      <p v-else class="tray-tip">
        <i class="fas fa-info-circle"></i>
        暂无屏蔽关键词，添加后可过滤不想看到的动态（如“广告”、“抽奖”等）。
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">链接</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">酷安网页打开方式</span>
          <span class="row-sub">未适配为站内页面的酷安网页按此设置打开；非酷安域名始终直接使用系统浏览器</span>
        </div>
        <select v-model="settingsStore.settings.externalLinkMode" class="select-control">
          <option value="internal">应用内查看 (推荐)</option>
          <option value="system">系统浏览器</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import AppSwitch from '../../components/common/AppSwitch.vue';
import AppButton from '../../components/common/AppButton.vue';
import SearchTabOrderList from '../../components/search/SearchTabOrderList.vue';
import { isTouchMobilePlatform } from '../../utils/platform';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { DEFAULT_SEARCH_TABS } from '../../types/search';
import { extractSearchTabs } from '../../utils/searchEntities';
import { orderSearchTabs } from '../../utils/searchTabOrder';

const settingsStore = useSettingsStore();
// 系统默认查看器依赖桌面端的 opener，iOS/Android 上没有实现。
const supportsSystemViewer = !isTouchMobilePlatform();
const keywordInput = ref('');
const searchOrderOpen = ref(false);
const configuredSearchTabs = ref(DEFAULT_SEARCH_TABS);
const orderedSearchTabs = computed(() => orderSearchTabs(configuredSearchTabs.value, settingsStore.settings.searchTabOrder).filter(tab => tab.searchType !== 'all'));
const searchOrderMessage = ref('调整后自动保存；恢复默认将沿用酷安提供的分类顺序。');

function toggleSearchOrder(event: Event) {
  // 收起时卸载排序列表，取消未完成的拖动并释放指针监听。
  searchOrderOpen.value = (event.currentTarget as HTMLDetailsElement).open;
}

function saveSearchOrder(order: string[]) {
  settingsStore.settings.searchTabOrder = order;
  searchOrderMessage.value = '搜索分类顺序已保存。';
}

function resetSearchOrder() {
  settingsStore.settings.searchTabOrder = [];
  searchOrderMessage.value = '已恢复默认分类顺序。';
}

onMounted(async () => {
  try {
    configuredSearchTabs.value = extractSearchTabs(await CoolapkTauriAPI.getTabConfig());
  } catch {
    // 离线时仍可调整协议默认分类，下次搜索按已保存的顺序应用。
  }
});

const blockedKeywords = computed(() => settingsStore.settings.blockedKeywords);

function addKeyword() {
  const kw = keywordInput.value.trim();
  if (!kw) return;
  if (!settingsStore.settings.blockedKeywords.includes(kw)) {
    settingsStore.settings.blockedKeywords = [...settingsStore.settings.blockedKeywords, kw];
  }
  keywordInput.value = '';
}

function removeKeyword(kw: string) {
  settingsStore.settings.blockedKeywords = settingsStore.settings.blockedKeywords.filter(
    (k) => k !== kw
  );
}
</script>

<style scoped>
.search-order-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.search-order-heading > p { flex: 1 1 220px; }
.search-order-group { min-width: 0; }
.search-order-trigger { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 10px 12px; border: 1px dashed var(--border); border-radius: var(--radius-control); background: var(--background); color: var(--text-primary); font-size: var(--font-size-sub); font-weight: var(--font-weight-semibold); list-style: none; cursor: pointer; }
.search-order-trigger::-webkit-details-marker { display: none; }
.search-order-trigger > span { display: flex; align-items: center; gap: 10px; min-width: 0; overflow-wrap: anywhere; }
.search-order-trigger > span > i { flex-shrink: 0; color: var(--brand-primary); }
.search-order-chevron { flex-shrink: 0; font-size: 12px; transition: transform var(--duration-fast); }
.search-order-group[open] .search-order-chevron { transform: rotate(180deg); }
.search-order-trigger:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 2px; }
.search-order-content { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 720px;
}

.section-title {
  font-size: var(--font-size-title-md);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);

  border-bottom: 1px solid var(--border);
  padding-bottom: var(--space-3);
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.group-title {
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-light);
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-label {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.row-sub {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.select-control {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.select-control:hover {
  border-color: var(--brand-primary);
}

.text-input {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  outline: none;
  flex: 1;
  min-width: 0;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.text-input:hover,
.text-input:focus {
  border-color: var(--brand-primary);
}

.keyword-input-row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}

.keyword-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.keyword-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 12px;
  border-radius: var(--radius-pill);
  background-color: var(--brand-soft);
  border: 1px solid var(--brand-green-border);
  color: var(--brand-primary);
  font-size: var(--font-size-sub);
}

.chip-text {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--brand-primary);
  font-size: 11px;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-default);
}

.chip-remove:hover {
  background-color: var(--brand-soft-hover);
}

.tray-tip {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

</style>
