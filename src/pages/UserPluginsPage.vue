<template>
  <div v-pull-refresh="{ refresh: refreshMobilePage, disabled: mobileRefreshBusy || !storeMode }" class="plugins-page custom-scrollbar" @scroll="onScroll">
    <div class="plugins-content">
      <header class="plugins-toolbar">
        <button type="button" aria-label="返回" @click="navigateBack(router, '/me')"><i class="fas fa-arrow-left"></i></button>
        <h1>{{ storeMode ? '挂件商店' : '挂件管理' }}</h1>
        <button v-if="!storeMode" type="button" @click="router.push('/my-plugins/store')"><i class="fas fa-store"></i> 挂件商店</button>
      </header>
      <DemoLoginState v-if="auth.isWebDemo && !auth.isLoggedIn" />
      <div v-else-if="!auth.isLoggedIn" class="plugin-notice"><p>登录后管理和获取你的挂件</p><button class="primary" @click="auth.openLoginModal()">登录酷安</button></div>
      <template v-else>
        <div class="plugins-layout">
          <section class="plugin-preview" aria-label="挂件预览">
            <AppImage v-if="feedPreview" class="preview-decoration" :src="feedPreview" fit="contain" />
            <div class="preview-author"><AppAvatar :src="auth.user?.userAvatar" :plugin-url="avatarPreview" :size="44" /><div><strong>{{ auth.user?.username }}</strong><p>4小时前 <i class="fas fa-mobile-screen"></i> {{ deviceTitle }}</p></div></div>
            <p class="preview-message">正在预览你的头像挂件和动态挂件，让你的动态更好看。</p>
            <div class="preview-counts"><span><i class="far fa-thumbs-up"></i> 999</span><span><i class="far fa-comment"></i> 999</span><span><i class="fas fa-retweet"></i> 999</span></div>
          </section>
          <section :class="storeMode ? 'plugin-shop' : 'plugin-manager'">
            <div v-if="!storeMode" class="plugin-tabs" role="tablist" aria-label="挂件类别">
              <button v-for="(label, index) in ['头像挂件', '动态挂件']" :key="label" role="tab" :aria-selected="type === index" :class="{ active: type === index }" @click="type = index">{{ label }}</button>
            </div>
            <p v-if="loading" class="plugin-notice" role="status">正在加载挂件…</p>
            <div v-if="error" class="plugin-notice" role="alert"><p>{{ error }}</p><button @click="loadInitial">重新加载</button></div>
            <div v-if="!loading && !error && !storeMode" class="plugin-grid">
              <button class="plugin-choice" :class="{ selected: selected[type] === 0 }" :disabled="saving" @click="choose(0)" :aria-pressed="selected[type] === 0">
                <span class="choice-image"><i class="fas fa-ban"></i><i v-if="selected[type] === 0" class="fas fa-check selection-check"></i></span><span>{{ type === 0 ? '无头像挂件' : '无动态挂件' }}</span>
              </button>
              <button v-for="plugin in lists[type]" :key="plugin.id" class="plugin-choice" :class="{ selected: selected[type] === Number(plugin.id) }" :disabled="saving || !pluginUsable(plugin)" :aria-pressed="selected[type] === Number(plugin.id)" @click="choose(Number(plugin.id))">
                <span class="choice-image"><AppImage :src="pluginImage(plugin, true)" fit="contain" /><i v-if="selected[type] === Number(plugin.id)" class="fas fa-check selection-check"></i></span><span>{{ plugin.title }}</span><small v-if="!pluginUsable(plugin)">{{ Number(plugin.expired) === 1 ? '已过期' : '不可使用' }}</small><small v-else-if="plugin.day_left">{{ plugin.day_left }}</small><small v-else-if="plugin.expire_days">可用天数：{{ plugin.expire_days }}</small>
              </button>
            </div>
            <template v-if="storeMode && !loading && !error">
              <article v-for="plugin in shop" :key="plugin.id" class="shop-row" :class="{ previewing: hovered?.id === plugin.id }">
                <span class="plugin-badge">{{ Number(plugin.plugin_type) === 0 ? '头像挂件' : '动态挂件' }}</span>
                <button class="shop-preview" @click="hovered = plugin" :aria-label="`预览${plugin.title}`"><AppImage :src="pluginImage(plugin, true)" fit="contain" /></button>
                <div class="shop-info"><button class="shop-title" @click="hovered = plugin">{{ plugin.title }}</button><p v-if="plugin.getFuncStr">获取方式：{{ pluginCondition(plugin.getFuncStr) }}</p><p v-if="pluginTime(plugin)">获取限时：{{ pluginTime(plugin) }}</p><p v-if="pluginTime(plugin, true)">使用限时：{{ pluginTime(plugin, true) }}</p></div>
                <button class="claim-button" :disabled="claiming !== 0 || pluginClaimLabel(plugin) !== '去获取'" @click="claim(plugin)">{{ claiming === Number(plugin.id) ? '处理中…' : pluginClaimLabel(plugin) }}</button>
              </article>
              <p v-if="!shop.length" class="plugin-notice">暂无可展示的挂件</p>
            </template>
            <div v-if="!loading && !error" class="pagination"><p v-if="moreError" role="alert">{{ moreError }}</p><button v-if="hasMore[storeMode ? 2 : type] || moreError" :disabled="loadingMore || saving" @click="loadMore">{{ loadingMore ? '正在加载…' : moreError ? '重试加载' : '加载更多' }}</button></div>
            <footer v-if="!storeMode && !loading && !error" class="plugin-save"><button class="primary" :disabled="saving || loadingMore" @click="save">{{ saving ? '正在保存…' : '保存设置' }}</button></footer>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import DemoLoginState from '../components/common/DemoLoginState.vue';
import { vPullRefresh } from '../directives/pullRefresh';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppAvatar from '../components/common/AppAvatar.vue';
import AppImage from '../components/common/AppImage.vue';
import { CoolapkTauriAPI } from '../api/coolapk';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import { navigateBack } from '../utils/navigation';
import { normalizeCoolapkRoute } from '../utils/coolapkRoute';
import { showToast } from '../utils/toast';
import { mergePlugins, pluginClaimLabel, pluginCondition, pluginImage, pluginTime, pluginUsable, type UserPlugin } from '../utils/userPlugins';

const route = useRoute(), router = useRouter(), auth = useAuthStore(), app = useAppStore();
const storeMode = computed(() => route.path.endsWith('/store'));
const type = ref(0), lists = ref<UserPlugin[][]>([[], []]), shop = ref<UserPlugin[]>([]);
const selected = ref([0, 0]), original = ref(['', '']), hovered = ref<UserPlugin | null>(null);
const deviceTitle = ref(''), loading = ref(false), loadingMore = ref(false), saving = ref(false), claiming = ref(0);
const error = ref(''), moreErrors = ref(['', '', '']), pages = ref([2, 2, 2]), hasMore = ref([false, false, false]);
const moreError = computed({ get: () => moreErrors.value[storeMode.value ? 2 : type.value], set: value => { moreErrors.value[storeMode.value ? 2 : type.value] = value; } });
const nextPages = ref<UserPlugin[][]>([[], [], []]);
const probing = ref([false, false, false]);
let revision = 0;
onBeforeUnmount(() => { revision++; });
const selectedImage = (index: number) => selected.value[index] === 0 ? '' : pluginImage(lists.value[index].find(p => Number(p.id) === selected.value[index])) || original.value[index];
const avatarPreview = computed(() => storeMode.value ? (hovered.value && Number(hovered.value.plugin_type) === 0 ? pluginImage(hovered.value) : original.value[0]) : selectedImage(0));
const feedPreview = computed(() => storeMode.value ? (hovered.value && Number(hovered.value.plugin_type) === 1 ? pluginImage(hovered.value) : original.value[1]) : selectedImage(1));
function responseData(response: any) {
  const data = response?.data ?? response;
  if (!data || (data.status !== undefined && Number(data.status) !== 200)) throw new Error(data?.message || '挂件服务返回异常');
  return data;
}
async function loadInitial() {
  const current = ++revision;
  error.value = ''; moreErrors.value = ['', '', '']; hovered.value = null; loadingMore.value = false;
  lists.value = [[], []]; shop.value = []; selected.value = [0, 0]; original.value = ['', ''];
  pages.value = [2, 2, 2]; hasMore.value = [false, false, false]; nextPages.value = [[], [], []]; probing.value = [false, false, false];
  if (!auth.isLoggedIn) { loading.value = false; return; }
  loading.value = true;
  try {
    const data = responseData(await CoolapkTauriAPI.getUserPlugins(storeMode.value));
    if (current !== revision) return;
    if (storeMode.value ? !Array.isArray(data.pluginList) : !Array.isArray(data.avatarPluginList) || !Array.isArray(data.feedPluginList)) throw new Error('挂件列表未返回，请检查登录状态后重试');
    lists.value = [mergePlugins([], data.avatarPluginList || []), mergePlugins([], data.feedPluginList || [])];
    // 当前佩戴项可能不在第一页，必须保留它以免保存另一个类别时误卸下。
    [data.selectedAvatarPluginRow, data.selectedFeedPluginRow].forEach((row, index) => {
      if (row?.id) lists.value[index] = mergePlugins(lists.value[index], [row]);
      selected.value[index] = Number(row?.id || 0);
    });
    original.value = [data.avatarPluginUrl || '', data.feedPluginUrl || ''];
    shop.value = mergePlugins([], data.pluginList || []); deviceTitle.value = data.deviceTitle || '';
    await auth.updateCurrentUserProfile({ avatarPluginUrl: original.value[0], feedPluginUrl: original.value[1] });
    if (current === revision) for (const index of storeMode.value ? [2] : [0, 1]) void probeMore(index, current);
  } catch (e) { if (current === revision) error.value = String(e instanceof Error ? e.message : e); }
  finally { if (current === revision) loading.value = false; }
}
// 官方分页没有 hasMore 字段；用下一页实际内容判断，不能默认宣称还有挂件。
async function probeMore(index: number, current: number) {
  if (probing.value[index]) return;
  probing.value[index] = true;
  const page = pages.value[index];
  try {
    const data = responseData(await CoolapkTauriAPI.getUserPlugins(index === 2, page, index === 2 ? 0 : index));
    if (current !== revision || page !== pages.value[index]) return;
    if (!Array.isArray(data.pluginList)) throw new Error('挂件分页未返回有效列表');
    const existing = new Set((index === 2 ? shop.value : lists.value[index]).map(row => Number(row.id)));
    nextPages.value[index] = mergePlugins([], data.pluginList).filter(row => !existing.has(Number(row.id)));
    hasMore.value[index] = nextPages.value[index].length > 0;
  } catch (e) {
    if (current === revision) moreErrors.value[index] = String(e instanceof Error ? e.message : e);
  } finally { if (current === revision) probing.value[index] = false; }
}
async function loadMore() {
  if (loadingMore.value || loading.value) return;
  const current = revision, index = storeMode.value ? 2 : type.value;
  if (!hasMore.value[index] && !moreError.value) return;
  loadingMore.value = true; moreError.value = '';
  try {
    const data = nextPages.value[index].length
      ? { pluginList: nextPages.value[index] }
      : responseData(await CoolapkTauriAPI.getUserPlugins(index === 2, pages.value[index], index === 2 ? 0 : index));
    if (current !== revision) return;
    if (!Array.isArray(data.pluginList)) throw new Error('挂件分页未返回有效列表');
    if (index === 2) shop.value = mergePlugins(shop.value, data.pluginList);
    else lists.value[index] = mergePlugins(lists.value[index], data.pluginList);
    nextPages.value[index] = []; hasMore.value[index] = false; pages.value[index]++;
    if (data.pluginList.length) void probeMore(index, current);
  } catch (e) { if (current === revision) moreErrors.value[index] = String(e instanceof Error ? e.message : e); }
  finally { if (current === revision) loadingMore.value = false; }
}
function onScroll(event: Event) {
  const element = event.target as HTMLElement;
  if (!moreError.value && !error.value && auth.isLoggedIn && element.scrollHeight - element.scrollTop - element.clientHeight < 160) void loadMore();
}
function choose(id: number) { selected.value[type.value] = id; }
async function save() {
  if (saving.value) return;
  const current = revision, account = String(auth.user?.uid), ids = [...selected.value], images = [selectedImage(0), selectedImage(1)];
  saving.value = true;
  try {
    const data = responseData(await CoolapkTauriAPI.saveUserPlugins(ids[0], ids[1]));
    if (Number(data.status) !== 200) throw new Error(data.message || '保存未成功');
    if (current !== revision || String(auth.user?.uid) !== account) return;
    original.value = images;
    await auth.updateCurrentUserProfile({ avatarPluginUrl: images[0], feedPluginUrl: images[1] });
    showToast(data.message || '挂件设置已保存');
  } catch (e) { if (current === revision) showToast(String(e instanceof Error ? e.message : e), 'error'); }
  finally { saving.value = false; }
}
async function openTarget(target: string) {
  const url = new URL(target, 'https://m.coolapk.com');
  const official = url.hostname === 'coolapk.com' || url.hostname.endsWith('.coolapk.com');
  if (official && url.pathname === '/feed/writer' && url.searchParams.get('tag')) {
    app.openPublish(`#${url.searchParams.get('tag')}# `); return;
  }
  const local = normalizeCoolapkRoute(url.href);
  if (local && router.resolve(local).matched.length) await router.push(local);
  else await CoolapkTauriAPI.openUrl(url.href, 'internal');
}
async function claim(plugin: UserPlugin) {
  if (claiming.value || pluginClaimLabel(plugin) !== '去获取') return;
  const current = revision;
  claiming.value = Number(plugin.id);
  try {
    const url = new URL(plugin.get_url || '', 'https://m.coolapk.com');
    if (!plugin.get_url) throw new Error('服务端未提供获取入口');
    if (url.hostname === 'm.coolapk.com' && url.pathname === '/mp/userPlugin/getPlugin') {
      const data = (await CoolapkTauriAPI.claimUserPlugin(Number(plugin.id)))?.data;
      if (current !== revision) return;
      if (data?.forwardUrl) await openTarget(data.forwardUrl);
      else { if (Number(data?.status) !== 200) throw new Error(data?.message || '挂件获取失败'); plugin.is_get = 1; showToast(data.message || '已获取挂件'); }
    } else await openTarget(url.href);
  } catch (e) { if (current === revision) showToast(String(e instanceof Error ? e.message : e), 'error'); }
  finally { claiming.value = 0; }
}
watch([storeMode, () => auth.user?.uid, () => auth.isLoggedIn], () => { void loadInitial(); }, { immediate: true });

// 移动端下拉刷新复用当前页面的数据加载，保留筛选与页面实例。
const mobileRefreshBusy = computed(() => loading.value || loadingMore.value || saving.value || claiming.value !== 0);
async function refreshMobilePage() { await loadInitial(); }
</script>

<style scoped>
.plugins-page { height: 100%; overflow-y: auto; background: linear-gradient(135deg, #dae8fa 0, #ededf5 260px, var(--background) 480px); color: var(--text-primary); padding: 0 14px max(24px, env(safe-area-inset-bottom)); }
:global([data-theme="dark"] .plugins-page) { background: linear-gradient(135deg, #202e40, var(--background) 360px); }
.plugins-content { max-width: 1160px; margin: auto; }
button { font: inherit; color: inherit; border: 0; cursor: pointer; background: transparent; touch-action: manipulation; }
button:disabled { cursor: default; opacity: .5; }
button:focus-visible { outline: 2px solid #0bad64; outline-offset: 3px; }
.plugins-toolbar { display: flex; align-items: center; gap: 16px; min-height: 76px; padding-top: var(--app-safe-area-top, 0px); }
.plugins-toolbar button { min-height: 44px; }
.plugins-toolbar h1 { font-size: 22px; font-weight: 500; flex: 1; margin: 0; }
.plugins-toolbar > button:first-child { font-size: 22px; }
.plugins-toolbar > button:last-child:not(:first-child) { font-size: 15px; }
.plugins-layout { display: grid; gap: 20px; }
.plugin-preview { position: relative; overflow: hidden; background: var(--surface); border-radius: 12px; padding: 22px 14px 18px; box-shadow: 0 12px 24px #00000008; }
.preview-decoration { position: absolute; top: 0; right: 0; width: 100%; height: 44px; pointer-events: none; background: transparent; }
:deep(.preview-decoration img) { object-position: right top; }
.preview-author { display: flex; gap: 14px; align-items: center; position: relative; }
.preview-author strong { font-size: 16px; font-weight: 500; }
.preview-author p { font-size: 12px; color: var(--text-tertiary); margin: 8px 0 0; }
.preview-message { position: relative; font-size: 16px; line-height: 1.7; margin: 18px 0; }
.preview-counts { display: flex; justify-content: space-around; color: var(--text-secondary); font-size: 15px; }
.plugin-manager { background: var(--surface); border-radius: 28px 28px 12px 12px; padding: 18px 14px; min-height: 370px; display: flex; flex-direction: column; }
.plugin-tabs { display: flex; border-radius: 22px; background: var(--background); padding: 3px; margin-bottom: 24px; }
.plugin-tabs button { flex: 1; min-height: 36px; border-radius: 22px; color: var(--text-secondary); }
.plugin-tabs button.active { background: var(--surface); color: var(--text-primary); }
.plugin-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 20px 12px; }
.plugin-choice { display: flex; flex-direction: column; align-items: center; gap: 14px; min-width: 0; padding: 0; font-size: 14px; }
.choice-image { display: grid; place-items: center; position: relative; width: 100%; aspect-ratio: 1; border: 1px solid var(--border); border-radius: 9px; overflow: hidden; }
.choice-image > i:first-child { font-size: 32px; color: #bdbdbd; }
.choice-image .app-image-container { width: 85%; height: 85%; background: transparent; }
.selected .choice-image { border-color: #00ac57; }
.choice-image .selection-check { position: absolute; right: 0; bottom: 0; border-radius: 8px 0 0 0; padding: 8px; background: #0c9f58; color: white; font-size: 16px; }
.plugin-save { margin-top: auto; padding: 26px 4px 4px; position: sticky; bottom: 0; background: var(--surface); }
.primary { background: #0c9f58; color: white; border-radius: 28px; padding: 12px 24px; min-height: 48px; }
.plugin-save .primary { width: 100%; font-size: 18px; }
.plugin-notice { text-align: center; padding: 20px 8px; }
.plugin-notice button, .pagination button { color: #0c9f58; padding: 12px; }
.pagination { text-align: center; font-size: 14px; }
.plugin-shop { display: flex; flex-direction: column; gap: 12px; }
.shop-row { position: relative; display: flex; align-items: center; gap: 12px; background: var(--surface); padding: 16px 14px 10px; border-radius: 10px; border: 1px solid transparent; }
.shop-row.previewing { border-color: #0bad64; }
.plugin-badge { position: absolute; top: 0; left: 0; color: #0bad64; background: #0bad6410; border-radius: 10px 0 8px; font-size: 9px; padding: 3px 4px; }
.shop-preview { flex-shrink: 0; padding: 0; width: 48px; height: 58px; }
.shop-preview .app-image-container { width: 100%; height: 100%; background: transparent; }
.shop-info { flex: 1; min-width: 0; }
.shop-title { font-size: 16px; padding: 0; text-align: left; overflow-wrap: anywhere; }
.shop-info p { font-size: 11px; line-height: 1.5; margin: 2px 0; overflow-wrap: anywhere; }
.claim-button { flex-shrink: 0; background: #0c9f58; color: white; border-radius: 7px; font-size: 13px; padding: 8px 10px; }
.claim-button:disabled { background: var(--background); color: var(--text-tertiary); opacity: 1; }
@media (min-width: 900px) { .plugins-page { padding: 0 32px 32px; } .plugins-layout { grid-template-columns: minmax(300px, 2fr) minmax(450px, 3fr); align-items: start; } .plugin-preview { position: sticky; top: 20px; padding: 28px 22px; } .plugin-manager { min-height: 480px; padding: 24px; } .shop-preview { width: 70px; height: 80px; } .shop-title { font-size: 19px; } .shop-info p { font-size: 13px; } .plugin-badge { font-size: 11px; } .shop-row { padding: 22px 16px 14px; } }
</style>
