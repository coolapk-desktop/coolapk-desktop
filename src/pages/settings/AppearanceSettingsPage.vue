<template>
  <div class="settings-section">
    <h3 class="section-title">外观设置</h3>

    <div class="setting-group">
      <h4 class="group-title">主题模式</h4>
      <div class="theme-options">
        <div
          :class="['theme-card', { 'is-active': settingsStore.settings.theme === 'light' }]"
          @click="settingsStore.setTheme('light')"
        >
          <div class="preview-box light-preview"></div>
          <span>浅色模式</span>
        </div>

        <div
          :class="['theme-card', { 'is-active': settingsStore.settings.theme === 'dark' }]"
          @click="settingsStore.setTheme('dark')"
        >
          <div class="preview-box dark-preview"></div>
          <span>深色模式</span>
        </div>

        <div
          :class="['theme-card', { 'is-active': settingsStore.settings.theme === 'system' }]"
          @click="settingsStore.setTheme('system')"
        >
          <div class="preview-box system-preview"></div>
          <span>跟随系统</span>
        </div>
      </div>
    </div>

    <div class="setting-group light-background-settings">
      <h4 class="group-title">浅色界面底色</h4>
      <p class="group-sub">调整页面、卡片与导航底色，降低亮白感；自定义颜色会自动柔化，深色主题沿用原有配色。</p>
      <div class="light-background-options">
        <button v-for="option in lightBackgroundOptions" :key="option.label" type="button" :class="['light-background-option', { 'is-active': settingsStore.settings.lightBackgroundColor === option.color }]" :aria-pressed="settingsStore.settings.lightBackgroundColor === option.color" @click="settingsStore.settings.lightBackgroundColor = option.color"><span class="background-swatch" :style="{ backgroundColor: option.color || '#ffffff' }"></span>{{ option.label }}</button>
        <label class="light-background-custom">自定义底色<input type="color" aria-label="自定义浅色界面底色" :value="settingsStore.settings.lightBackgroundColor || '#e9ecef'" @input="settingsStore.settings.lightBackgroundColor = ($event.target as HTMLInputElement).value" /></label>
      </div>
      <div v-if="lightBackgroundPreview" class="light-background-preview" :style="{ backgroundColor: lightBackgroundPreview.page, borderColor: lightBackgroundPreview.border }"><span :style="{ backgroundColor: lightBackgroundPreview.surface }">正文与卡片预览</span></div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">主题强调色</h4>
      <p class="group-sub">全局品牌主色调，侧边栏、按钮与链接等统一换色</p>
      <div class="accent-options">
        <div
          v-for="c in accentColors"
          :key="c.key"
          :class="['accent-swatch', { 'is-active': settingsStore.settings.accentColor === c.key }]"
          :style="{ '--swatch-color': c.color }"
          @click="settingsStore.setAccent(c.key)"
        >
          <span class="swatch-dot"></span>
          <span>{{ c.label }}</span>
        </div>
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">页面缩放与字号</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">界面缩放比例<span v-if="showShortcutHints"> ({{ formatShortcut('Ctrl + / -') }})</span></span>
          <span class="row-sub">
            {{ settingsStore.settings.zoomManuallySet ? `手动缩放 ${settingsStore.settings.zoom}%` : '默认 100%：系统显示缩放已自动适配，无需额外放大' }}
          </span>
        </div>
        <div class="zoom-controls">
          <button class="zoom-btn" @click="settingsStore.setZoom(settingsStore.settings.zoom - 10)">-</button>
          <span class="zoom-value">{{ settingsStore.settings.zoom }}%</span>
          <button class="zoom-btn" @click="settingsStore.setZoom(settingsStore.settings.zoom + 10)">+</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">正文字号</span>
          <span class="row-sub">动态正文与标题的显示字号</span>
        </div>
        <div class="zoom-controls">
          <button class="zoom-btn" @click="adjustFontSize(-1)">-</button>
          <span class="zoom-value">{{ settingsStore.settings.fontSize }}px</span>
          <button class="zoom-btn" @click="adjustFontSize(1)">+</button>
        </div>
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">界面字体</h4>
      <div v-if="isAndroidTauri" class="setting-row">
        <div class="row-info">
          <span class="row-label">系统字体</span>
          <span class="row-sub">Android 版使用系统字体；如已保存自定义字体，可以恢复默认。</span>
        </div>
        <button
          v-if="settingsStore.settings.fontFamily"
          type="button"
          class="font-reset-button"
          @click="resetFontFamily"
        >
          恢复默认
        </button>
      </div>
      <div v-else class="setting-row">
        <div class="row-info">
          <span class="row-label">字体族</span>
          <span class="row-sub">打开 Windows 系统字体选择器，从本机已安装字体中选择</span>
        </div>
        <div class="font-picker-controls">
          <button
            type="button"
            class="font-picker-button"
            :disabled="fontPickerOpening"
            aria-label="打开系统字体选择器"
            @click="openFontPicker"
          >
            <span class="font-picker-value">{{ selectedFontLabel }}</span>
            <i class="fas fa-chevron-down" aria-hidden="true"></i>
          </button>
          <button
            v-if="settingsStore.settings.fontFamily"
            type="button"
            class="font-reset-button"
            @click="resetFontFamily"
          >
            恢复默认
          </button>
        </div>
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">列表密度</h4>
      <p class="group-sub">信息流卡片的留白与间距紧凑程度</p>
      <div class="density-options">
        <div
          v-for="d in densityOptions"
          :key="d.key"
          :class="['density-card', { 'is-active': settingsStore.settings.density === d.key }]"
          @click="settingsStore.settings.density = d.key"
        >
          <span class="density-icon">{{ d.icon }}</span>
          <span>{{ d.label }}</span>
        </div>
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">微动画与视觉效果</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">减少动态过渡效果</span>
          <span class="row-sub">禁用界面显隐动画与微交互</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.reduceMotion" />
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">页面标签栏</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">显示顶部页面标签栏</span>
          <span class="row-sub">关闭后隐藏已打开页面的标签栏，仍可通过侧边栏和后退按钮导航</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.showPageTabBar" />
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">动态详情</h4>
      <div class="setting-row"><div class="row-info"><span class="row-label">官方样式动态详情</span><span class="row-sub">手机和平板默认启用官方作者栏、评论列表和底部操作栏；关闭后恢复原有动态详情与内联评论。</span></div><AppSwitch v-model="settingsStore.settings.officialMobileFeedDetail" /></div>
      <!-- 触摸设备上 isMobileLayout 直接短路为移动布局，该开关永远不会生效，直接不展示。 -->
      <div v-if="showDesktopLayoutSwitch" class="setting-row"><div class="row-info"><span class="row-label">点击动态进入详情页</span><span class="row-sub">桌面端点击动态进入详情页；关闭后在当前页面查看评论。</span></div><AppSwitch v-model="settingsStore.settings.desktopFeedDetailOnClick" /></div>
      <div v-if="showDesktopLayoutSwitch" class="setting-row"><div class="row-info"><span class="row-label">评论显示在右侧</span><span class="row-sub">统一控制动态列表、话题页和动态详情页的右侧评论；宽窗口下生效，可拖动调节宽度，与点击进入详情页独立。</span></div><AppSwitch v-model="settingsStore.settings.desktopCommentsOnRight" /></div>
    </div>
    <div v-if="showDesktopLayoutSwitch" class="setting-group">
      <h4 class="group-title">窗口响应式布局</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">禁止窄窗口自动切换手机模式</span>
          <span class="row-sub">窗口宽度缩小（&lt; 720px）时保持桌面端顶栏与侧边栏，不自动切换为手机端导航栏</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.disableAutoMobileMode" />
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">导航与阅读</h4>
      <div class="setting-row">
        <div class="row-info"><span class="row-label">液态玻璃</span><span class="row-sub">统一控制首页和话题顶部导航的透明模糊效果，关闭时使用实色背景</span></div>
        <AppSwitch v-model="settingsStore.settings.headerGlass" />
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">滚动时自动隐藏导航</span>
          <span class="row-sub">移动布局向下阅读时收起首页、数码和发现的搜索栏与底部 Dock，或详情操作栏；保留栏目栏，反向滚动恢复显示</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.autoHideMobileNavigation" />
      </div>
    </div>

    <div v-if="!isAndroidTauri" class="setting-group">
      <h4 class="group-title">首页右侧栏</h4>
      <p class="group-sub">分别控制首页右侧的热门资讯、热榜和热门话题卡片，关闭后不再请求对应数据</p>

      <div class="setting-row">
        <div class="row-info"><span class="row-label">热门资讯</span><span class="row-sub">在首页右侧栏第一块显示热门资讯</span></div>
        <AppSwitch v-model="settingsStore.settings.showHomeHotNews" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">动态热榜</span>
          <span class="row-sub">支持今日、本周、本月切换，并记住上次选择</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.showHomeMonthlyRank" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">热门话题</span>
          <span class="row-sub">显示首页右侧的热门话题列表</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.showHomeHotTopics" />
      </div>
    </div>

    <!-- 页面栏目显隐设置区域 -->
    <div class="setting-group">
      <h4 class="group-title">导航栏目显隐设置</h4>
      <p class="group-sub">
        控制侧边栏与手机快捷入口中显示的栏目；“数码”和“发现”开关同时控制手机底栏，底栏始终保留首页、发布和我的。
      </p>

      <details class="nav-disclosure nav-main-disclosure">
        <summary><span><i class="fas fa-bars" aria-hidden="true"></i>{{ isAndroidTauri ? '快捷入口栏目' : '主导航栏目' }}</span><i class="fas fa-chevron-down" aria-hidden="true"></i></summary>
        <div class="nav-disclosure-content">
          <div class="setting-row">
            <div class="row-info">
              <span class="row-label">在“我的”中置顶“我的常去”</span>
              <span class="row-sub">
                {{ isAndroidTauri ? '将“我的常去”移动到手机“我的”页面的最前面' : '将“我的常去”移动到“我的”栏目子页面的最前面' }}
              </span>
            </div>
            <AppSwitch v-model="settingsStore.settings.myRecentPinned" />
          </div>

          <div class="nav-grid nav-main-grid">
            <div v-for="nav in navItems" :key="nav.key" class="nav-toggle-card">
              <div class="nav-item-meta">
                <i :class="[nav.icon, 'nav-item-icon']"></i>
                <span class="nav-item-name">{{ nav.label }}</span>
              </div>
              <AppSwitch
                :model-value="getNavVisible(nav.key)"
                @update:model-value="toggleNav(nav.key)"
              />
            </div>
          </div>
        </div>
      </details>

      <details class="nav-disclosure nav-more-settings">
        <summary><span><i class="fas fa-user" aria-hidden="true"></i>个人中心「我的」</span><i class="fas fa-chevron-down" aria-hidden="true"></i></summary>
        <div class="nav-disclosure-content">
          <div class="setting-row nav-more-master-row">
            <div class="row-info">
              <span class="row-label"><i class="fas fa-user nav-item-icon"></i> 个人中心「我的」</span>
              <span class="row-sub">
                {{ isAndroidTauri ? '控制快捷入口中的「我的」入口及其工作台数据子项' : '控制侧栏「我的」入口及其工作台数据子项' }}
              </span>
            </div>
            <AppSwitch
              :model-value="getNavVisible('my')"
              @update:model-value="toggleNav('my')"
            />
          </div>
          <div v-if="getNavVisible('my')" class="nav-grid nav-more-grid">
            <div v-for="nav in moreNavItems" :key="nav.key" class="nav-toggle-card">
              <div class="nav-item-meta">
                <i :class="[nav.icon, 'nav-item-icon']"></i>
                <span class="nav-item-name">{{ nav.label }}</span>
              </div>
              <AppSwitch
                :model-value="getNavVisible(nav.key)"
                @update:model-value="toggleNav(nav.key)"
              />
            </div>
          </div>
        </div>
      </details>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settings';
import type { AccentColor, FeedDensity } from '../../types/settings';
import AppSwitch from '../../components/common/AppSwitch.vue';
import { moreNavs } from '../../config/navigation';
import { usePlatformShortcuts } from '../../utils/shortcuts';
import { useShortcutHints } from '../../composables/useShortcutHints';
import { showToast } from '../../utils/toast';
import { isTouchMobilePlatform } from '../../utils/platform';
import { buildLightBackground } from '../../utils/lightBackground';

const settingsStore = useSettingsStore();
const lightBackgroundOptions = [{ label: '默认', color: '' }, { label: '柔和浅灰', color: '#e5e7eb' }, { label: '暖米色', color: '#eee8dc' }];
const lightBackgroundPreview = computed(() => buildLightBackground(settingsStore.settings.lightBackgroundColor));
const { formatShortcut } = usePlatformShortcuts();
const showShortcutHints = useShortcutHints();
const fontPickerOpening = ref(false);
const isAndroidTauri = isTauri() && typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
// 该开关是桌面端语义（窄窗口是否保留桌面外壳）；手机上窗口永远是窄的，开关会毁掉移动外壳，直接不展示。
const showDesktopLayoutSwitch = !isTouchMobilePlatform();
const selectedFontLabel = computed(() => settingsStore.settings.fontFamily || '系统默认');

const accentColors: { key: AccentColor; label: string; color: string }[] = [
  { key: 'green', label: '酷安绿', color: '#10b768' },
  { key: 'blue', label: '活力蓝', color: '#2f7bff' },
  { key: 'violet', label: '优雅紫', color: '#7c5cff' },
  { key: 'orange', label: '暖橙', color: '#f58220' },
];

const densityOptions: { key: FeedDensity; label: string; icon: string }[] = [
  { key: 'comfortable', label: '舒适', icon: '▨' },
  { key: 'standard', label: '标准', icon: '▦' },
  { key: 'compact', label: '紧凑', icon: '▤' },
];

function adjustFontSize(delta: number) {
  const next = Math.min(Math.max(settingsStore.settings.fontSize + delta, 12), 20);
  settingsStore.settings.fontSize = next;
}

async function openFontPicker() {
  if (fontPickerOpening.value) return;
  fontPickerOpening.value = true;
  try {
    const selected = await invoke<string | null>('pick_font_family', {
      currentFont: settingsStore.settings.fontFamily || null,
    });
    const fontFamily = selected?.trim();
    if (fontFamily) settingsStore.settings.fontFamily = fontFamily;
  } catch (error) {
    showToast(`打开系统字体选择器失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    fontPickerOpening.value = false;
  }
}

function resetFontFamily() {
  settingsStore.settings.fontFamily = '';
}

const navItems = [
  { key: 'home', label: '首页', icon: 'fas fa-home' },
  { key: 'discover', label: '发现', icon: 'fas fa-compass' },
  { key: 'topics', label: '话题', icon: 'fas fa-hashtag' },
  { key: 'digital', label: '数码', icon: 'fas fa-microchip' },
  { key: 'pictures', label: '酷图', icon: 'far fa-images' },
  { key: 'more', label: '更多服务', icon: 'fas fa-shapes' },
  { key: 'notifications', label: '通知', icon: 'far fa-bell' },
  { key: 'favorites', label: '收藏', icon: 'far fa-bookmark' },
  { key: 'history', label: '历史', icon: 'far fa-clock' },
  { key: 'messages', label: '消息', icon: 'far fa-comment-alt' },
  { key: 'following', label: '关注', icon: 'fas fa-user-group' },
];

const moreNavItems = moreNavs.map(({ key, label, icon }) => ({ key, label, icon }));

function getNavVisible(key: string): boolean {
  const vis = settingsStore.settings.navVisibility;
  if (!vis) return true;
  return vis[key as keyof typeof vis] !== false;
}

function toggleNav(key: string) {
  settingsStore.toggleNavVisibility(key as any);
}
</script>


<style scoped>
.light-background-options { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.light-background-option, .light-background-custom { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); color: var(--text-primary); font: inherit; cursor: pointer; }
.light-background-option.is-active { border-color: var(--brand-primary); background: var(--brand-soft); }
.background-swatch { width: 20px; height: 20px; border: 1px solid var(--border); border-radius: 50%; flex-shrink: 0; }
.light-background-custom input { width: 34px; height: 28px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.light-background-preview { margin-top: 12px; padding: 14px; border: 1px solid; border-radius: var(--radius-card); color: #17191c; }
.light-background-preview span { display: block; padding: 14px; border-radius: var(--radius-control); }
.nav-disclosure { min-width: 0; }
.nav-disclosure > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 10px 12px; border: 1px dashed var(--border); border-radius: var(--radius-control); background: var(--background); color: var(--text-primary); font-size: var(--font-size-sub); font-weight: var(--font-weight-semibold); list-style: none; cursor: pointer; }
.nav-disclosure > summary::-webkit-details-marker { display: none; }
.nav-disclosure > summary > span { display: flex; align-items: center; gap: 10px; min-width: 0; overflow-wrap: anywhere; }
.nav-disclosure > summary > span > i { flex-shrink: 0; color: var(--brand-primary); }
.nav-disclosure > summary > .fa-chevron-down { flex-shrink: 0; font-size: 12px; transition: transform var(--duration-fast); }
.nav-disclosure[open] > summary > .fa-chevron-down { transform: rotate(180deg); }
.nav-disclosure > summary:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 2px; }
.nav-disclosure-content { display: flex; flex-direction: column; gap: var(--space-3); padding-top: 12px; }

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

.group-sub {
  font-size: var(--font-size-sub);
  color: var(--text-tertiary);
  margin-top: -4px;
}

.nav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.nav-toggle-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}

.nav-item-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.nav-item-icon {
  color: var(--brand-primary);
  font-size: 14px;
  width: 16px;
  text-align: center;
}

.nav-item-name {
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
}

.theme-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 180px));
  gap: var(--space-4);
}

.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  background-color: var(--background);
  border: 2px solid var(--border);
  border-radius: var(--radius-card);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.theme-card.is-active {
  border-color: var(--brand-primary);
  background-color: var(--brand-soft);
}

.preview-box {
  width: 100%;
  height: 64px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.light-preview { background-color: #ffffff; }
.dark-preview { background-color: #0f1113; }
.system-preview { background: linear-gradient(135deg, #ffffff 50%, #0f1113 50%); }

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

.zoom-controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.accent-options {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-2);
}

.accent-swatch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: var(--font-size-sub);
  color: var(--text-secondary);
  transition: all var(--duration-fast) var(--ease-default);
  user-select: none;
}

.accent-swatch:hover {
  border-color: var(--swatch-color);
  color: var(--text-primary);
}

.accent-swatch.is-active {
  border-color: var(--swatch-color);
  background-color: var(--brand-soft);
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
}

.swatch-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: var(--swatch-color);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

.density-options {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.density-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border: 2px solid var(--border);
  border-radius: var(--radius-card);
  cursor: pointer;
  font-size: var(--font-size-sub);
  color: var(--text-secondary);
  transition: all var(--duration-fast) var(--ease-default);
  user-select: none;
}

.density-card:hover {
  border-color: var(--brand-primary);
  color: var(--text-primary);
}

.density-card.is-active {
  border-color: var(--brand-primary);
  background-color: var(--brand-soft);
  color: var(--brand-primary);
  font-weight: var(--font-weight-semibold);
}

.density-icon {
  font-size: 18px;
  letter-spacing: -1px;
}

.zoom-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-control);
  background-color: var(--background);
  border: 1px solid var(--border);
  font-size: 16px;
  font-weight: bold;
}

.zoom-value {
  font-size: var(--font-size-sub);
  min-width: 44px;
  text-align: center;
}

.font-picker-controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.font-picker-button {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-width: 220px;
  max-width: 260px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background-color: var(--background);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.font-picker-button:hover:not(:disabled),
.font-picker-button:focus-visible {
  border-color: var(--brand-primary);
  outline: none;
}

.font-picker-button:disabled {
  cursor: wait;
  opacity: 0.7;
}

.font-picker-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.font-reset-button {
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--brand-primary);
  cursor: pointer;
  font: inherit;
  font-size: var(--font-size-caption);
  white-space: nowrap;
}

.font-reset-button:hover {
  text-decoration: underline;
}

@media (max-width: 720px) {
  .settings-section {
    width: 100%;
    max-width: none;
  }

  .theme-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .theme-card {
    min-width: 0;
    padding: var(--space-2);
  }

  .preview-box {
    height: 48px;
  }

  .setting-row {
    align-items: flex-start;
    gap: 12px;
  }

  .row-info {
    flex: 1 1 auto;
    min-width: 0;
  }

  .row-sub {
    line-height: 1.4;
  }

  .font-picker-controls {
    flex: 1 1 100%;
    min-width: 0;
  }

  .font-picker-button {
    flex: 1 1 auto;
    min-width: 0;
    max-width: none;
  }

  .density-options {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .density-card {
    min-width: 0;
    padding: var(--space-3) 6px;
  }

  .nav-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .nav-toggle-card {
    min-width: 0;
  }
}
</style>
