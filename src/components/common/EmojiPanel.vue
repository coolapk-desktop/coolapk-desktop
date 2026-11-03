<template>
  <div ref="panelRoot" class="categorized-emoji-panel" @click.stop>
    <div class="emoji-category-tabs custom-scrollbar" role="tablist" aria-label="表情分类">
      <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :title="tab.title" :aria-label="tab.title" :aria-selected="active === tab.id" :class="{ active: active === tab.id }" :disabled="managingBusy" @mousedown.prevent @click="active = tab.id">
        <img v-if="tab.id === 'niuniu'" :src="EMOJI_GROUPS[3].items[0]?.url" alt="" />
        <svg v-else-if="tab.id === 'coolb'" class="coolb-category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" />
          <path d="M17 8.5 13.5 14c-1.3 2-2.5 2.5-4 2-1.4-.5-2.2-1.6-2.2-3s.8-2.5 2.2-3c1.5-.5 2.7 0 4 1.5l3.5 4" />
        </svg>
        <i v-else :class="['fa-regular', tab.icon]" aria-hidden="true"></i>
      </button>
    </div>
    <div class="emoji-category-body custom-scrollbar" role="tabpanel" :aria-label="activeTitle">
      <div class="emoji-section-title emoji-manager-heading">
        <template v-if="active === 'favorites' && managerOpen"><button type="button" aria-label="返回收藏表情" :disabled="managingBusy" @click="closeManager">←</button><span>全部表情</span></template>
        <span v-else>{{ activeTitle }}</span>
        <button v-if="active === 'favorites' && account" type="button" :disabled="loading || managingBusy || selecting" @click="toggleEditing">{{ editing ? '完成' : '整理' }}</button>
      </div>
      <template v-if="active === 'favorites'">
        <p v-if="!account" class="emoji-state">登录后查看收藏表情</p>
        <p v-else-if="loading" class="emoji-state" role="status">正在加载收藏表情…</p>
        <div v-else-if="error" class="emoji-state" role="status">{{ error }} <button type="button" @click="loadFavorites">重试</button></div>
        <div v-else class="emoji-grid emoji-favorite-grid">
          <button type="button" class="emoji-add-button" aria-label="添加收藏表情" :disabled="disabled || selecting || managingBusy" @mousedown.prevent @click="openAdd"><span aria-hidden="true">＋</span></button>
          <div v-for="(picture, index) in favorites" :key="picture.id" class="emoji-favorite-cell">
            <button type="button" class="emoji-item-btn" :class="{ 'is-selected': selectedIds.includes(picture.id), 'is-sortable': editing, 'is-dragging': draggedId === picture.id }" :data-emoji-id="picture.id" :aria-label="editing ? '选择收藏表情' : '使用收藏表情'" :aria-pressed="editing ? selectedIds.includes(picture.id) : undefined" :disabled="disabled || selecting || managingBusy" @pointerdown="beginDrag($event, picture.id)" @mousedown.prevent @click="usePicture(picture)" @keydown.alt.up.prevent="movePicture(index, -1)" @keydown.alt.down.prevent="movePicture(index, 1)"><AppImage :src="picture.url" alt="收藏表情" fit="contain" /><span v-if="editing" class="emoji-selection-mark" aria-hidden="true">{{ selectedIds.includes(picture.id) ? '✓' : '○' }}</span></button>
          </div>
        </div>
        <p v-if="account && !loading && !error && !favorites.length" class="emoji-state">你还没有添加表情，点击＋添加</p>
      </template>
      <template v-else>
        <div class="emoji-grid" :class="{ 'emoji-grid-recent': active === 'recent' }">
          <button v-for="item in items" :key="item.name" type="button" class="emoji-item-btn emoji-item" :title="'label' in item ? String(item.label) : item.name" :disabled="disabled || selecting" @mousedown.prevent @click="$emit('select', item.name)">
            <img v-if="item.url" :src="item.url" :alt="item.name" loading="lazy" /><span v-else>{{ item.name }}</span>
          </button>
        </div>
        <p v-if="!items.length" class="emoji-state">暂无最近使用的表情</p>
      </template>
    </div>
    <input ref="addInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden @change="addPictures" />
    <div v-if="active === 'favorites' && editing" class="emoji-manager-actions"><span>已选 {{ selectedIds.length }} 个 · 拖动排序</span><button type="button" :disabled="!selectedIds.length || managingBusy" @click="deleteSelected">删除选中</button><button type="button" :disabled="!orderChanged || managingBusy" @click="saveOrder">保存排序</button></div>
    <p v-if="managingBusy" class="emoji-selection-status" role="status">{{ managementStatus }}</p>
    <p v-if="selecting" class="emoji-selection-status" role="status">正在读取表情图片…</p>
    <p v-if="selectionError" class="emoji-selection-status" role="status">{{ selectionError }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import AppImage from './AppImage.vue';
import { normalizeResourceUrl } from '../../utils/resourceCache';
import { showToast } from '../../utils/toast';
import { useAuthStore } from '../../stores/auth';
import { useRecentEmojis } from '../../utils/recentEmojis';
import { getEmojiUrl } from '../../utils/coolapkEmoji';
import { EMOJI_GROUPS, normalizeEmojiPictures, type EmojiPicture } from '../../utils/emojiPanel';
const props = withDefaults(defineProps<{ disabled?: boolean; selectedUrls?: string[]; initialTab?: string }>(), { disabled: false, selectedUrls: () => [], initialTab: 'coolapk' });
const emit = defineEmits<{ select: [name: string]; picture: [picture: EmojiPicture] }>();
const auth = useAuthStore();
const account = computed(() => auth.isLoggedIn ? String(auth.user?.uid || '') : '');
const { recentEmojis } = useRecentEmojis();
// 评论输入每次打开时进入最近使用，其他调用方保留原分类。
const active = ref(props.initialTab);
const tabs = [{ id: 'recent', title: '最近使用', icon: 'fa-clock' }, { id: 'favorites', title: '收藏', icon: 'fa-heart' }, ...EMOJI_GROUPS];
const activeTitle = computed(() => tabs.find(tab => tab.id === active.value)?.title || '酷安表情');
const items = computed(() => active.value === 'recent'
  ? recentEmojis.value.map(name => ({ name, url: getEmojiUrl(name) }))
  : EMOJI_GROUPS.find(group => group.id === active.value)?.items || []);
const favorites = ref<EmojiPicture[]>([]);
const loading = ref(false), selecting = ref(false);
const error = ref(''), selectionError = ref('');
const addInput = ref<HTMLInputElement | null>(null);
const managerOpen = ref(false), editing = ref(false), managingBusy = ref(false), orderChanged = ref(false);
const selectedIds = ref<string[]>([]), managementStatus = ref('');
const panelRoot = ref<HTMLElement | null>(null), draggedId = ref('');
let dragStart: { id: string; pointerId: number; x: number; y: number } | null = null;
let suppressClick = false;
let revision = 0, disposed = false;
async function loadFavorites() {
  const uid = account.value, request = ++revision;
  if (!uid) return;
  loading.value = true; error.value = '';
  try {
    const response = await CoolapkTauriAPI.getEmojiPictures();
    if (disposed || request !== revision || uid !== account.value) return;
    if (response?.code !== 200) throw new Error('读取收藏表情失败');
    favorites.value = normalizeEmojiPictures(response.data);
  } catch {
    if (!disposed && request === revision) error.value = '收藏表情加载失败，请重试';
  } finally { if (request === revision) loading.value = false; }
}
function checkResult(response: any) {
  if (response?.code !== 200) throw new Error(response?.message || '表情管理失败，请重试');
}
function currentAccount(uid: string) { return !disposed && account.value === uid; }
function toggleSelected(id: string) {
  selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(value => value !== id) : [...selectedIds.value, id];
}
function usePicture(picture: EmojiPicture) {
  if (suppressClick) { suppressClick = false; return; }
  if (editing.value) toggleSelected(picture.id);
  else void selectPicture(picture);
}
function beginDrag(event: PointerEvent, id: string) {
  if (!editing.value || managingBusy.value || props.disabled || (event.button !== undefined && event.button !== 0)) return;
  suppressClick = false;
  dragStart = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
}
function handleDragMove(event: PointerEvent) {
  if (!dragStart || dragStart.pointerId !== event.pointerId || !editing.value || managingBusy.value) return;
  if (!draggedId.value && Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 6) return;
  draggedId.value = dragStart.id; suppressClick = true;
  if (event.cancelable) event.preventDefault();
  const hit = document.elementFromPoint?.(event.clientX, event.clientY);
  const target = hit?.closest<HTMLElement>('[data-emoji-id]');
  if (target && panelRoot.value?.contains(target)) {
    const from = favorites.value.findIndex(item => item.id === dragStart!.id);
    const to = favorites.value.findIndex(item => item.id === target.dataset.emojiId);
    if (from >= 0 && to >= 0 && from !== to) {
      const list = [...favorites.value]; const [picture] = list.splice(from, 1); list.splice(to, 0, picture);
      favorites.value = list; orderChanged.value = true;
    }
  }
  const body = panelRoot.value?.querySelector<HTMLElement>('.emoji-category-body');
  if (body) {
    const bounds = body.getBoundingClientRect();
    if (event.clientY < bounds.top + 28) body.scrollTop -= 18;
    else if (event.clientY > bounds.bottom - 28) body.scrollTop += 18;
  }
}
function endDrag(event?: PointerEvent) {
  if (event && dragStart && event.pointerId !== dragStart.pointerId) return;
  dragStart = null; draggedId.value = '';
}
function movePicture(index: number, offset: number) {
  const target = index + offset;
  if (managingBusy.value || target < 0 || target >= favorites.value.length) return;
  const list = [...favorites.value];
  [list[index], list[target]] = [list[target], list[index]];
  favorites.value = list; orderChanged.value = true;
}
async function saveOrder() {
  if (!orderChanged.value || managingBusy.value || !account.value) return false;
  const uid = account.value;
  managingBusy.value = true; selectionError.value = ''; managementStatus.value = '正在保存排序…';
  try {
    checkResult(await CoolapkTauriAPI.editEmojiPictures('sort', favorites.value.map(item => item.id)));
    if (!currentAccount(uid)) return false;
    orderChanged.value = false; await loadFavorites(); return !error.value;
  } catch (error) { if (currentAccount(uid)) selectionError.value = error instanceof Error ? error.message : String(error); return false; }
  finally { managingBusy.value = false; }
}
async function toggleEditing() {
  if (editing.value) {
    if (orderChanged.value && !await saveOrder()) return;
    editing.value = false; selectedIds.value = []; await loadFavorites();
  } else { managerOpen.value = true; editing.value = true; }
}
async function closeManager() {
  if (orderChanged.value && !await saveOrder()) return;
  managerOpen.value = editing.value = false; selectedIds.value = []; await loadFavorites();
}
function openAdd() {
  managerOpen.value = true;
  addInput.value?.click();
}
async function addPictures(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []); input.value = '';
  if (!files.length || !account.value || managingBusy.value) return;
  const uid = account.value;
  managingBusy.value = true; selectionError.value = ''; managementStatus.value = '正在添加表情…';
  try {
    if (files.some(file => !/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024)) throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片，单张不超过 20MB');
    for (let index = 0; index < files.length; index++) {
      if (!currentAccount(uid)) return;
      const file = files[index]; managementStatus.value = `正在添加表情 ${index + 1}/${files.length}…`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!currentAccount(uid)) return;
      const response = await CoolapkTauriAPI.uploadImage(bytes, file.name, file.type, 'feed_emoji_picture');
      if (!currentAccount(uid)) return;
      checkResult(response);
      const data = response.data;
      let url = typeof data === 'string' ? data : data?.url || data?.pic || data?.path || data?.filename || '';
      if (url.startsWith('//')) url = `https:${url}`;
      else if (url.startsWith('/')) url = `https://image.coolapk.com${url}`;
      const picture = normalizeEmojiPictures([{ id: 'upload', url }])[0];
      if (!picture) throw new Error('上传未返回有效的表情图片地址');
      checkResult(await CoolapkTauriAPI.addEmojiPicture(picture.url));
    }
  } catch (error) { if (currentAccount(uid)) selectionError.value = error instanceof Error ? error.message : String(error); }
  finally {
    if (currentAccount(uid)) { selectedIds.value = []; orderChanged.value = false; await loadFavorites(); }
    managingBusy.value = false;
  }
}
async function deleteSelected() {
  if (!selectedIds.value.length || managingBusy.value || !account.value) return;
  const uid = account.value;
  managingBusy.value = true; selectionError.value = ''; managementStatus.value = '正在删除表情…';
  try {
    checkResult(await CoolapkTauriAPI.editEmojiPictures('delete', [...selectedIds.value]));
    if (currentAccount(uid)) { selectedIds.value = []; orderChanged.value = false; await loadFavorites(); }
  } catch (error) { if (currentAccount(uid)) selectionError.value = error instanceof Error ? error.message : String(error); }
  finally { managingBusy.value = false; }
}
function autoRefresh() {
  if (active.value === 'favorites' && account.value && !editing.value && !loading.value && !managingBusy.value && !selecting.value && document.visibilityState !== 'hidden') void loadFavorites();
}
function selectPicture(picture: EmojiPicture) {
  if (props.disabled || managingBusy.value || !account.value) return;
  if (props.selectedUrls.some(url => normalizeResourceUrl(url) === normalizeResourceUrl(picture.url))) {
    showToast('已经添加了', 'info'); return;
  }
  selectionError.value = '';
  emit('picture', { ...picture });
}
watch(account, () => {
  endDrag(); suppressClick = false;
  revision++; favorites.value = []; loading.value = false;
  managerOpen.value = editing.value = orderChanged.value = false; selectedIds.value = [];
  error.value = selectionError.value = '';
  if (active.value === 'favorites' && account.value) void loadFavorites();
});
watch(active, tab => {
  endDrag(); suppressClick = false;
  managerOpen.value = editing.value = orderChanged.value = false; selectedIds.value = []; selectionError.value = '';
  if (tab === 'favorites' && account.value) void loadFavorites();
});
onMounted(() => {
  window.addEventListener('focus', autoRefresh); document.addEventListener('visibilitychange', autoRefresh);
  window.addEventListener('pointermove', handleDragMove, { passive: false }); window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag);
});
onUnmounted(() => {
  disposed = true; revision++; endDrag();
  window.removeEventListener('focus', autoRefresh); document.removeEventListener('visibilitychange', autoRefresh);
  window.removeEventListener('pointermove', handleDragMove); window.removeEventListener('pointerup', endDrag); window.removeEventListener('pointercancel', endDrag);
});
</script>

<style scoped>
.categorized-emoji-panel { width: 100%; min-width: 0; display: flex; flex-direction: column; height: 320px; }
.emoji-category-tabs { display: flex; flex-shrink: 0; overflow-x: auto; gap: 4px; padding: 4px; border-bottom: 1px solid var(--border); }
.emoji-category-tabs button { display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--text-primary); flex: 0 0 42px; height: 38px; border-radius: 8px; font-size: 23px; cursor: pointer; }
.emoji-category-tabs button.active { background: var(--brand-soft); color: var(--brand-primary); }
.emoji-category-tabs img { width: 28px; height: 28px; object-fit: contain; }
.coolb-category-icon { width: 28px; height: 28px; vertical-align: middle; }
.emoji-category-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; }
.emoji-section-title { font-size: 12px; color: var(--text-tertiary); padding-bottom: 8px; }
.emoji-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 4px; }
.emoji-item-btn { min-width: 0; border: 0; border-radius: 6px; background: transparent; padding: 4px; cursor: pointer; font-size: 26px; line-height: 1.3; }
.emoji-item-btn:hover { background: var(--brand-soft); }
.emoji-item-btn:disabled { opacity: .5; cursor: default; }
.emoji-item-btn img { display: block; width: 100%; height: 30px; object-fit: contain; font-size: 12px; overflow: hidden; }
.emoji-favorite-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.emoji-favorite-grid img { height: 64px; }
.emoji-favorite-grid :deep(.app-image-container) { width: 100%; height: 64px; }
.emoji-selection-status { flex-shrink: 0; margin: 0; padding: 8px; color: var(--text-secondary); font-size: 12px; overflow-wrap: anywhere; max-height: 72px; overflow-y: auto; }
.emoji-state { color: var(--text-secondary); font-size: 13px; padding: 8px; }
.emoji-manager-heading { display: flex; align-items: center; gap: 8px; }
.emoji-manager-heading > button:last-child { margin-left: auto; }
.emoji-manager-heading button, .emoji-manager-actions button { border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; padding: 4px; }
.emoji-add-button { height: 72px; border: 2px dashed var(--border); border-radius: 8px; background: transparent; color: var(--text-tertiary); font-size: 36px; cursor: pointer; }
.emoji-favorite-cell { min-width: 0; }
.emoji-favorite-cell > .emoji-item-btn { position: relative; width: 100%; }
.emoji-favorite-cell > .is-selected { background: var(--brand-soft); outline: 1px solid var(--brand-primary); }
.emoji-selection-mark { position: absolute; top: 0; right: 4px; color: var(--brand-primary); font-size: 16px; }
.emoji-item-btn.is-sortable { touch-action: none; cursor: grab; user-select: none; }
.emoji-item-btn.is-sortable :deep(img) { pointer-events: none; -webkit-user-drag: none; user-select: none; }
.emoji-item-btn.is-dragging { opacity: .5; cursor: grabbing; outline: 1px dashed var(--brand-primary); }
.emoji-manager-actions { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; font-size: 12px; border-top: 1px solid var(--border); }
.emoji-manager-actions button:disabled, .emoji-add-button:disabled { opacity: .5; cursor: default; }
@media (max-width: 720px) { .emoji-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } .emoji-favorite-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
</style>
