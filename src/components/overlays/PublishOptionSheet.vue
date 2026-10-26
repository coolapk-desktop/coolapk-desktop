<template>
  <Teleport to="body">
    <div v-if="isOpen" class="publish-sheet-backdrop" :class="`sheet-${presentation || 'page'}`" @click.self="close" @keydown.esc.stop.prevent="close">
      <section ref="sheet" class="publish-sheet" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown.tab="keepFocus">
        <header :class="{ 'has-search': !!$slots.search }"><button type="button" class="sheet-back" aria-label="返回发帖" @click="close"><PublishIcon name="back" /></button><h3 v-if="!$slots.search">{{ title }}</h3><slot name="search" /><slot name="header-actions" /></header>
        <div class="sheet-content custom-scrollbar"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { watch, nextTick, ref } from 'vue';
import { useAndroidBackButton } from '../../utils/androidBackButton';
import PublishIcon from './PublishIcon.vue';
const props = defineProps<{ isOpen: boolean; title: string; presentation?: 'page' | 'bottom' }>();
const emit = defineEmits<{ close: [] }>();
const previousFocus = ref<HTMLElement | null>(null);
const sheet = ref<HTMLElement | null>(null);
useAndroidBackButton(() => props.isOpen, close);
// 弹层返回后恢复原控件焦点，正文插入位置由发帖编辑器单独维护。
watch(() => props.isOpen, async (open) => {
  if (open) { previousFocus.value = document.activeElement instanceof HTMLElement ? document.activeElement : null; await nextTick(); sheet.value?.focus(); }
}, { immediate: true });
function close() { emit('close'); void nextTick(() => previousFocus.value?.focus()); }
// 键盘循环留在当前选择页，防止误触后方的发布按钮。
function keepFocus(event: KeyboardEvent) {
  const controls = Array.from(sheet.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || []);
  const first = controls[0], last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
</script>
<style scoped>
.publish-sheet-backdrop { position: fixed; inset: 0; z-index: 12000; background: rgb(0 0 0 / 36%); display: flex; justify-content: center; align-items: center; padding: 20px; }
.publish-sheet { width: min(520px, 100%); max-height: min(680px, calc(100dvh - 40px)); display: flex; flex-direction: column; border-radius: 16px; background: var(--surface); box-shadow: 0 20px 70px rgb(0 0 0 / 20%); overflow: hidden; color: var(--text-primary); }
header { display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--border-light); }
header h3 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; }
.sheet-back { width: 30px; height: 30px; display: grid; place-items: center; color: var(--text-primary); border-radius: 50%; }
.sheet-back:hover { background: var(--surface-hover); }
.sheet-content { padding: 16px 20px; overflow: auto; min-height: 0; }
footer { padding: 14px 20px; border-top: 1px solid var(--border-light); display: flex; justify-content: flex-end; gap: 10px; }
@media (max-width: 600px) { .publish-sheet-backdrop { padding: 0; } .publish-sheet { width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; padding-top: var(--app-safe-area-top, 0px); padding-bottom: env(safe-area-inset-bottom); } .sheet-content { flex: 1; } }
header.has-search :deep(.publish-search) { flex: 1; min-width: 0; }
@media (max-width: 600px) { header { min-height: 48px; padding: 8px 16px; } header.has-search { gap: 4px; padding: 0 16px; } header.has-search :deep(.publish-search) { padding: 0 8px; height: 30px; border-radius: 3px; } .sheet-content { padding: 0 16px; } .sheet-bottom { align-items: flex-end; } .sheet-bottom .publish-sheet { height: auto; max-height: 75dvh; border-radius: 16px 16px 0 0; padding-top: 0; } .sheet-bottom .sheet-content { padding-top: 8px; padding-bottom: 8px; } }
</style>
