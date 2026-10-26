<template>
  <div class="settings-page-container">
    <div class="settings-layout-card" :class="{ 'is-mobile': mobileLayout }" @keydown.esc.stop="closeCategories">
      <aside v-if="!mobileLayout" class="settings-sidebar">
        <h2 class="settings-title">设置中心</h2>
        <nav class="settings-menu" aria-label="设置栏目">
          <router-link v-for="item in settingsMenu" :key="item.path" :to="item.path" class="settings-menu-item" active-class="is-active">
            <i :class="[item.icon, 'menu-icon']" aria-hidden="true"></i><span>{{ item.label }}</span>
          </router-link>
        </nav>
      </aside>
      <button v-if="mobileLayout && categoriesOpen" type="button" class="settings-category-backdrop" aria-label="关闭设置分类" @click="closeCategories"></button>
      <header v-if="mobileLayout" class="settings-navigation">
        <h2 class="settings-title">设置中心</h2>
        <div class="settings-category-picker">
          <button ref="categoryTrigger" type="button" class="settings-category-trigger" aria-label="设置分类" aria-haspopup="dialog" :aria-expanded="categoriesOpen" aria-controls="settings-category-panel" @click="toggleCategories">
            <i :class="currentCategory.icon" aria-hidden="true"></i><span>{{ currentCategory.label }}</span><i class="fas fa-chevron-down category-chevron" :class="{ 'is-open': categoriesOpen }" aria-hidden="true"></i>
          </button>
          <div v-if="categoriesOpen" id="settings-category-panel" ref="categoryPanel" class="settings-category-panel custom-scrollbar" role="dialog" aria-label="设置分类">
            <div class="category-panel-heading"><strong>设置分类</strong><span>选择设置栏目</span></div>
            <nav class="settings-category-grid" aria-label="设置栏目">
              <button v-for="item in settingsMenu" :key="item.path" type="button" class="settings-category-card" :class="{ 'is-active': currentCategory.path === item.path }" :aria-current="currentCategory.path === item.path ? 'page' : undefined" @click="selectCategory(item.path)">
                <i :class="item.icon" aria-hidden="true"></i><span>{{ item.label }}</span>
              </button>
            </nav>
          </div>
        </div>
      </header>
      <section class="settings-content custom-scrollbar">
        <router-view v-slot="{ Component }">
          <component :is="Component" v-if="Component" />
        </router-view>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onDeactivated, ref, watch } from 'vue';
import { useAndroidBackButton } from '../../utils/androidBackButton';
import { useRoute, useRouter } from 'vue-router';
import { useMobileLayout } from '../../composables/useOfficialMobileFeedDetail';
const route = useRoute();
const router = useRouter();
const mobileLayout = useMobileLayout();
const settingsMenu = [
  { path: '/settings/profile', label: '个人信息', icon: 'fas fa-id-card' },
  { path: '/settings/account', label: '账号与安全', icon: 'fas fa-user-shield' },
  { path: '/settings/notifications', label: '通知设置', icon: 'fas fa-bell' },
  { path: '/settings/privacy', label: '隐私设置', icon: 'fas fa-lock' },
  { path: '/settings/content', label: '内容偏好', icon: 'fas fa-sliders-h' },
  { path: '/settings/downloads', label: '下载与缓存', icon: 'fas fa-download' },
  { path: '/settings/network', label: '网络代理', icon: 'fas fa-globe' },
  { path: '/settings/appearance', label: '外观设置', icon: 'fas fa-palette' },
  { path: '/settings/shortcuts', label: '快捷键', icon: 'fas fa-keyboard' },
  { path: '/settings/startup', label: '启动与行为', icon: 'fas fa-power-off' },
  { path: '/settings/device', label: '设备信息', icon: 'fas fa-mobile-alt' },
  { path: '/settings/diagnostics', label: '诊断日志', icon: 'fas fa-file-lines' },
  { path: '/settings/about', label: '关于酷安', icon: 'fas fa-info-circle' },
];
const categoriesOpen = ref(false);
const categoryTrigger = ref<HTMLButtonElement | null>(null);
const categoryPanel = ref<HTMLElement | null>(null);
// 分类卡片和触发按钮始终跟随路由，支持直接打开和前进后退。
const currentCategory = computed(() => settingsMenu.find(item => item.path === route.path) || settingsMenu[7]!);
async function toggleCategories() {
  if (categoriesOpen.value) { closeCategories(); return; }
  categoriesOpen.value = true;
  await nextTick();
  categoryPanel.value?.querySelector<HTMLButtonElement>('.is-active')?.focus({ preventScroll: true });
}
function closeCategories() { categoriesOpen.value = false; categoryTrigger.value?.focus({ preventScroll: true }); }
function selectCategory(path: string) {
  closeCategories();
  if (path !== route.path && settingsMenu.some(item => item.path === path)) void router.push(path);
}
useAndroidBackButton(() => categoriesOpen.value, closeCategories);
watch(() => route.fullPath, () => { categoriesOpen.value = false; });
watch(mobileLayout, () => { categoriesOpen.value = false; });
onDeactivated(() => { categoriesOpen.value = false; });
</script>

<style scoped>
.settings-page-container { width: 100%; height: 100%; min-width: 0; min-height: 0; display: flex; background: var(--surface); }
.settings-layout-card { flex: 1; min-width: 0; min-height: 0; height: 100%; position: relative; display: flex; overflow: hidden; background: var(--surface); }
.settings-layout-card.is-mobile { flex-direction: column; }
.settings-sidebar { width: 170px; background: var(--surface); border-right: 1px solid var(--border); padding: var(--space-4) var(--space-3); display: flex; flex-direction: column; flex-shrink: 0; }
.settings-sidebar .settings-title { margin-bottom: var(--space-5); }
.settings-menu { display: flex; flex-direction: column; gap: var(--space-1); }
.settings-menu-item { display: flex; align-items: center; gap: var(--space-3); height: 40px; padding: 0 var(--space-4); border-radius: var(--radius-control); font-size: var(--font-size-sub); color: var(--text-secondary); font-weight: var(--font-weight-medium); text-decoration: none; transition: all var(--duration-fast) var(--ease-default); }
.settings-menu-item:hover { background: var(--surface-hover); color: var(--text-primary); }
.settings-menu-item.is-active { background: var(--brand-soft); color: var(--brand-primary); font-weight: var(--font-weight-semibold); }
.menu-icon { font-size: 15px; width: 18px; text-align: center; }
.settings-navigation { position: relative; z-index: 12; flex: 0 0 auto; display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px 24px; border-bottom: 1px solid var(--border); }
.settings-title { margin: 0; color: var(--text-primary); font-size: var(--font-size-title-md); font-weight: var(--font-weight-bold); }
.settings-category-picker { position: relative; width: min(280px, 100%); max-width: 100%; }
.settings-category-trigger { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 8px 12px; border: 1px solid var(--border-light); border-radius: 13px; background: var(--surface-hover); color: var(--text-secondary); font: inherit; cursor: pointer; }
.settings-category-trigger > span { flex: 1; text-align: left; }
.category-chevron { font-size: 12px; transition: transform var(--duration-fast); }
.category-chevron.is-open { transform: rotate(180deg); }
.settings-category-trigger:focus-visible, .settings-category-card:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: -2px; }
.settings-category-backdrop { position: absolute; inset: 0; z-index: 11; border: 0; background: #0003; cursor: default; }
.settings-category-panel { position: absolute; top: calc(100% + 8px); left: 0; width: min(460px, calc(100vw - 32px)); max-height: min(480px, calc(var(--app-viewport-height, 100dvh) - 180px)); box-sizing: border-box; padding: 16px 12px 12px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 13px; background: var(--surface); box-shadow: var(--shadow-lg); }
.category-panel-heading { display: flex; align-items: center; gap: 10px; margin: 0 4px 16px; color: var(--text-primary); }
.category-panel-heading strong { font-size: 16px; }
.category-panel-heading > span { color: var(--text-tertiary); font-size: 12px; }
.settings-category-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.settings-category-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-height: 60px; padding: 6px 4px; border: 1px solid var(--border-light); border-radius: 13px; background: var(--surface-hover); color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.settings-category-card > i { font-size: 18px; }
.settings-category-card:hover { background: var(--brand-soft); }
.settings-category-card.is-active { color: var(--brand-primary); background: var(--brand-soft); }
.settings-content { flex: 1; min-width: 0; min-height: 0; padding: var(--space-6); overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }
/* 子设置页共享可用宽度，移除各页遗留的固定上限，同时允许窄窗口收缩。 */
.settings-content :deep(.settings-section) { width: 100%; max-width: none; min-width: 0; box-sizing: border-box; }
/* 按内容所需宽度换行，系统放大字体或 PC 窄窗口时也不能让操作挤扁说明。 */
.settings-content :deep(.setting-row) { flex-wrap: wrap; gap: 12px 16px; }
.settings-content :deep(.setting-row > .row-info) { flex: 1 1 200px; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.settings-content :deep(.setting-row > .select-control), .settings-content :deep(.setting-row > .text-input) { max-width: 100%; min-width: 0; }
.settings-content :deep(.setting-row > .row-actions) { flex-wrap: wrap; flex-shrink: 0; max-width: 100%; margin-left: 0; }
.settings-content :deep(.setting-row .app-button) { max-width: 100%; height: auto; min-height: 28px; white-space: normal; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  /* 多按钮操作独占一行，不能为了同排展示而把说明或按钮文字挤成竖排。 */
  .settings-content :deep(.setting-row > .row-actions) { flex-basis: 100%; justify-content: flex-start; }
}
/* 栏目名称由桌面侧栏或移动端分类按钮展示，内容区不再重复标题，保留说明与账号信息。 */
.settings-content :deep(.section-title) { display: none; }
.is-mobile .settings-navigation { padding: 10px 16px; }
.is-mobile .settings-title { display: none; }
.is-mobile .settings-category-picker, .is-mobile .settings-category-panel { width: 100%; }
.is-mobile .settings-content { padding: 16px; }
</style>
