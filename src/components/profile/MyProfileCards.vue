<template>
  <section class="my-server-cards">
    <div class="cards-heading"><h2>我的卡片</h2><button type="button" @click="openManager">卡片管理</button></div>
    <p v-if="!auth.user" class="card-state">登录后查看我的卡片</p>
    <p v-else-if="loading" class="card-state">正在加载…</p>
    <div v-else-if="error" class="card-state"><p>{{ error }}</p><button type="button" @click="load">重试</button></div>
    <article v-for="card in cards" v-else :key="card.entityId" class="server-card">
      <button type="button" class="server-card-heading" @click="openLink(card.url)"><strong>{{ card.title }}</strong><i class="fas fa-chevron-right"></i></button>
      <p v-if="!card.entities?.length" class="card-empty">{{ card.emptyText || card.description || '暂无内容' }}</p>
      <div v-else :class="[card.entityTemplate === 'iconScrollCard' ? 'card-horizontal' : 'card-rows', { 'card-text-links': card.entityTemplate === 'textLinkListCard' }]">
        <button v-for="(item, index) in card.entities" :key="item.id || item.entityId || index" type="button" class="server-card-item" :class="{ 'history-item': item.entityType === 'history' }" @click="openLink(item.url)">
          <template v-if="card.entityTemplate !== 'textLinkListCard'"><AppImage v-if="imageUrl(item)" class="card-item-image" :src="imageUrl(item)" alt="" />
          <span v-else class="card-image-placeholder"><i class="fas fa-bookmark"></i></span></template>
          <span class="card-item-info"><span class="card-item-title">{{ item.title || item.username }}<span v-if="card.entityTemplate !== 'iconScrollCard' && item.typeName" class="card-type">{{ item.typeName }}</span></span><span v-if="card.entityTemplate === 'iconScrollCard'" class="card-item-subtitle">{{ item.typeName || item.subTitle }}</span><span v-else-if="item.subTitle || item.description" class="card-item-subtitle">{{ plainText(item.subTitle || item.description) }}</span></span>
          <span v-if="item.entityType === 'history' && item.dateline" class="card-time">{{ relativeTime(item.dateline) }}</span>
        </button>
      </div>
    </article>
    <p v-if="auth.user && !loading && !error && !cards.length" class="card-state">暂无卡片，请在卡片管理中添加</p>
    <Teleport to="body"><div v-if="managerOpen" class="card-manager-page">
      <header><button type="button" aria-label="返回我的" :disabled="saving" @click="closeManager"><i class="fas fa-arrow-left"></i></button><h2>卡片管理</h2><button type="button" :disabled="saving || managerLoading || !!managerError" @click="save">{{ saving ? '保存中' : '保存' }}</button></header>
      <main class="custom-scrollbar"><p v-if="managerLoading">正在加载…</p><p v-if="managerError" role="alert">{{ managerError }}</p><template v-if="!managerLoading && !managerError"><h3>已添加</h3><div v-for="(item, index) in added" :key="item.id" class="manager-row"><button type="button" :aria-label="`移除${item.title}`" @click="item.added = false"><i class="fas fa-minus-circle"></i></button><span>{{ item.title }}</span><button type="button" aria-label="上移" :disabled="index === 0" @click="move(item.id, -1)"><i class="fas fa-arrow-up"></i></button><button type="button" aria-label="下移" :disabled="index === added.length - 1" @click="move(item.id, 1)"><i class="fas fa-arrow-down"></i></button></div><h3>未添加</h3><div v-for="item in hidden" :key="item.id" class="manager-row"><button type="button" :aria-label="`添加${item.title}`" @click="item.added = true"><i class="fas fa-plus-circle"></i></button><span>{{ item.title }}</span></div></template></main>
      <p v-if="saveError" class="manager-error" role="alert">{{ saveError }}</p>
    </div></Teleport>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onActivated, onDeactivated } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { normalizeCoolapkRoute } from '../../utils/coolapkRoute';
import { coolapkHtmlToPlainText } from '../../utils/sanitizeHtml';
import { useAndroidBackButton } from '../../utils/androidBackButton';
import AppImage from '../common/AppImage.vue';
type Entity = Record<string, any>;
const auth = useAuthStore(), router = useRouter();
const cards = ref<Entity[]>([]), loading = ref(false), error = ref('');
let requestVersion = 0;
async function load() {
  const version = ++requestVersion;
  cards.value = []; error.value = ''; loading.value = false;
  if (!auth.user?.uid) return;
  loading.value = true;
  try {
    const response = await CoolapkTauriAPI.getLoadConfig(true);
    if (version !== requestVersion) return;
    if (!Array.isArray(response?.data)) throw new Error('卡片接口返回格式错误');
    cards.value = response.data.filter((entity: Entity) => entity.entityType === 'card' && entity.title);
  } catch (err) { if (version === requestVersion) error.value = String(err instanceof Error ? err.message : err); }
  finally { if (version === requestVersion) loading.value = false; }
}
watch(() => String(auth.user?.uid || ''), load, { immediate: true });
function imageUrl(item: Entity) { return item.logo || item.pic || item.cover_pic || item.userAvatar || ''; }
function plainText(value: string) { return coolapkHtmlToPlainText(value || ''); }
function relativeTime(time: number) {
  const seconds = Math.max(0, Date.now() / 1000 - time);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  return `${Math.floor(seconds / 86400)}天前`;
}
async function openLink(url: string) {
  if (!url) return;
  const path = url.split('?')[0];
  const listRoutes: Record<string, string> = { '/member/recentHistoryList': '/my?section=my_recent', '/member/hitHistoryList': '/history', '/topic/myFollowTopicList': '/followed-topics', '/collection/myCollectionList': '/favorites', '/feed/myQaFeedList': `/user/${auth.user?.uid}?tab=qa` };
  const local = listRoutes[path] || normalizeCoolapkRoute(url);
  if (local && router.resolve(local).matched.length) { await router.push(local); return; }
  await CoolapkTauriAPI.openUrl(url.startsWith('/') ? `https://www.coolapk.com${url}` : url, 'internal');
}
interface ManagedCard { id: number; title: string; added: boolean }
const managerOpen = ref(false), managerLoading = ref(false), managerError = ref(''), saveError = ref(''), saving = ref(false);
const managed = ref<ManagedCard[]>([]);
const added = computed(() => managed.value.filter(item => item.added)), hidden = computed(() => managed.value.filter(item => !item.added));
useAndroidBackButton(() => managerOpen.value && !saving.value, () => { void closeManager(); });
let managerRequest = 0;
let activatedOnce = false;
onActivated(() => { if (activatedOnce) void load(); activatedOnce = true; });
onDeactivated(() => { ++requestVersion; ++managerRequest; managerOpen.value = false; });
let initialConfig = '';
function currentConfig() { return JSON.stringify({ show: added.value.map(item => item.id), hide: hidden.value.map(item => item.id) }); }
async function closeManager() {
  if (!managerLoading.value && !managerError.value && currentConfig() !== initialConfig) await save();
  else managerOpen.value = false;
}
watch(() => String(auth.user?.uid || ''), () => { ++managerRequest; managerOpen.value = false; managed.value = []; });
async function openManager() {
  if (!auth.user) { auth.openLoginModal(); return; }
  managerOpen.value = true; managerLoading.value = true; managerError.value = ''; saveError.value = '';
  const version = ++managerRequest;
  try {
    const response = await CoolapkTauriAPI.getMyCardManager();
    if (version !== managerRequest) return;
    if (!Array.isArray(response?.data)) throw new Error('卡片管理接口返回格式错误');
    managed.value = response.data.map((item: Entity) => ({ id: Number(item.id), title: String(item.title || ''), added: Number(item.page_visibility) === 1 }));
    initialConfig = currentConfig();
    if (managed.value.some(item => !Number.isSafeInteger(item.id) || item.id < 0 || !item.title)) throw new Error('卡片管理数据缺少有效 ID 或标题');
  } catch (err) { if (version === managerRequest) managerError.value = String(err instanceof Error ? err.message : err); }
  finally { if (version === managerRequest) managerLoading.value = false; }
}
function move(id: number, delta: number) {
  const visible = added.value, index = visible.findIndex(item => item.id === id), other = visible[index + delta];
  if (!other) return;
  const source = managed.value.findIndex(item => item.id === id), target = managed.value.indexOf(other);
  [managed.value[source], managed.value[target]] = [managed.value[target]!, managed.value[source]!];
}
async function save() {
  if (saving.value) return;
  saving.value = true; saveError.value = '';
  try {
    const response = await CoolapkTauriAPI.updateMyCardConfig(currentConfig());
    if (String(response?.data) !== '1') throw new Error(response?.message || '服务器未确认保存成功');
    managerOpen.value = false; await load();
  } catch (err) { saveError.value = String(err instanceof Error ? err.message : err); }
  finally { saving.value = false; }
}

// 由外层页面下拉统一等待内容刷新完成。
defineExpose({ refresh: load });
</script>
<style scoped>
button { font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer; touch-action: manipulation; }
.cards-heading { display: flex; align-items: center; justify-content: space-between; padding: 0 12px; }
.cards-heading h2 { font-size: 18px; margin: 4px 0; }
.cards-heading button { min-height: 44px; font-size: 12px; color: var(--text-tertiary); }
.server-card { background: var(--surface); border-radius: 12px; margin-bottom: 8px; overflow: hidden; }
.server-card-heading { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 44px; padding: 10px 12px; text-align: left; }
.server-card-heading strong { font-size: 16px; }
.server-card-heading i { color: var(--text-tertiary); font-size: 14px; }
.card-horizontal { display: flex; overflow-x: auto; overscroll-behavior-x: contain; padding: 6px 4px; scrollbar-width: none; }
.card-horizontal::-webkit-scrollbar { display: none; }
.server-card-item { min-width: 0; }
.card-horizontal .server-card-item { display: flex; flex-direction: column; align-items: center; flex: 0 0 25%; gap: 8px; padding: 0 4px 8px; }
.card-horizontal .card-item-image, .card-horizontal .card-image-placeholder { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
.card-item-info { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
.card-horizontal .card-item-info { width: 100%; }
.card-item-title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-item-subtitle { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-rows { padding: 0 12px 8px; }
.card-rows .server-card-item { display: flex; align-items: center; gap: 12px; min-height: 64px; width: 100%; padding: 8px 4px; text-align: left; }
.card-rows .card-item-image, .card-rows .card-image-placeholder { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
.card-rows .card-item-info { flex: 1; }
.card-text-links .server-card-item { min-height: 44px; padding: 6px 4px; }
.card-rows .card-item-subtitle { color: var(--text-secondary); }
.card-type { margin-left: 6px; padding: 2px 6px; font-size: 10px; color: var(--text-secondary); background: var(--background); border-radius: 16px; }
.card-time { flex-shrink: 0; font-size: 12px; color: var(--text-secondary); }
.card-empty { padding: 16px 12px 24px; color: var(--text-tertiary); font-size: 14px; }
.card-state { padding: 16px; color: var(--text-tertiary); text-align: center; }
.card-image-placeholder { display: grid; place-items: center; background: var(--background); color: var(--text-tertiary); }
.card-manager-page { position: fixed; top: var(--app-viewport-top, 0px); left: 0; width: 100%; height: var(--app-viewport-height, 100dvh); background: var(--surface); z-index: 2200; padding: var(--app-safe-area-top, 0px) var(--app-safe-area-right) var(--app-safe-area-bottom) var(--app-safe-area-left); display: flex; flex-direction: column; }
.card-manager-page header { display: flex; align-items: center; gap: 12px; padding: 0 8px; min-height: 56px; border-bottom: 1px solid var(--border-light); }
.card-manager-page h2 { font-size: 20px; flex: 1; }
.card-manager-page header button { min-width: 44px; min-height: 44px; }
.card-manager-page main { flex: 1; overflow-y: auto; min-height: 0; }
.card-manager-page h3 { font-size: 16px; margin: 12px; }
.manager-row { display: flex; align-items: center; min-height: 64px; padding: 8px 12px; gap: 12px; }
.manager-row span { flex: 1; }
.manager-row button { width: 44px; height: 44px; color: var(--brand-primary); }
.manager-row button:disabled { opacity: .3; }
.manager-error { padding: 12px; color: var(--error); }
</style>
