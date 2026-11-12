<template>
  <div ref="root" class="option-menu" @focusout="handleFocusOut" @keydown.esc="handleEscape">
    <button ref="trigger" type="button" class="option-trigger" :class="{ 'is-active': open || highlighted }" :aria-label="label" aria-haspopup="menu" :aria-expanded="open" @click="toggle" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <i :class="icon" aria-hidden="true"></i>
      <span>{{ currentLabel }}</span>
      <i class="fas fa-chevron-down option-chevron" aria-hidden="true"></i>
    </button>

    <div v-if="open" ref="menu" class="option-popup custom-scrollbar" :class="{ 'align-end': alignEnd }" role="menu" :aria-label="label" @keydown="handleMenuKey">
      <button v-for="(option, index) in options" :key="option.key" type="button" class="option-row" role="menuitemradio" :aria-checked="option.key === modelValue" :tabindex="index === focusedIndex ? 0 : -1" @focus="focusedIndex = index" @click="select(option.key)">
        <span>{{ option.label }}</span>
        <i v-if="option.key === modelValue" class="fas fa-check" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref } from 'vue';

const props = defineProps<{
  modelValue: string;
  options: readonly { key: string; label: string }[];
  label: string;
  icon: string;
  alignEnd?: boolean;
  highlighted?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const open = ref(false);
const focusedIndex = ref(0);
const currentLabel = computed(() => props.options.find(option => option.key === props.modelValue)?.label || props.label);

function focusOption(index: number) {
  focusedIndex.value = index;
  menu.value?.querySelectorAll('button')[index]?.focus();
}

// 打开后聚焦选中项，长菜单也能直接从当前选项继续浏览。
async function show(fromEnd = false) {
  if (open.value || !props.options.length) return;
  open.value = true;
  document.addEventListener('pointerdown', handleOutsidePointer);
  const selected = props.options.findIndex(option => option.key === props.modelValue);
  await nextTick();
  focusOption(selected < 0 && fromEnd ? props.options.length - 1 : Math.max(selected, 0));
}

function close(restoreFocus = false) {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener('pointerdown', handleOutsidePointer);
  if (restoreFocus) trigger.value?.focus();
}

function toggle() {
  if (open.value) close(true);
  else void show();
}

function handleOutsidePointer(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close();
}

function handleFocusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node)) close();
}

function handleEscape(event: KeyboardEvent) {
  if (!open.value) return;
  event.preventDefault();
  event.stopPropagation();
  close(true);
}

function handleMenuKey(event: KeyboardEvent) {
  const length = props.options.length;
  const destinations: Record<string, number> = {
    ArrowDown: (focusedIndex.value + 1) % length,
    ArrowUp: (focusedIndex.value + length - 1) % length,
    Home: 0,
    End: length - 1,
  };
  const destination = destinations[event.key];
  if (typeof destination !== 'number') return;
  event.preventDefault();
  focusOption(destination);
}

function select(key: string) {
  close(true);
  if (key === props.modelValue) return;
  emit('update:modelValue', key);
  emit('change', key);
}

onDeactivated(() => close());
onBeforeUnmount(() => close());
</script>

<style scoped>
.option-menu { position: relative; min-width: 0; }

.option-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  min-height: 34px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text-primary);
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.option-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.option-trigger i { flex: none; color: var(--text-secondary); }
.option-chevron { font-size: 10px; }
.option-trigger:hover { background: var(--surface-hover); }
.option-trigger.is-active { border-color: var(--brand-primary); background: var(--brand-soft); }
.option-trigger.is-active i { color: inherit; }
.option-trigger[aria-expanded="true"] .option-chevron { transform: rotate(180deg); }

.option-popup {
  position: absolute;
  z-index: 20;
  inset-block-start: calc(100% + var(--space-1));
  inset-inline-start: 0;
  width: max(100%, 170px);
  max-width: calc(100vw - 2 * var(--space-3));
  max-height: min(280px, 48vh);
  overflow: auto;
  overscroll-behavior: contain;
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-dropdown);
}

.option-popup.align-end { inset-inline: auto 0; }

.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  min-height: 34px;
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-sub);
  text-align: start;
  cursor: pointer;
}

.option-row:hover { background: var(--surface-hover); }
.option-row[aria-checked="true"] { background: var(--brand-soft); font-weight: var(--font-weight-medium); }
.option-trigger.is-active, .option-row[aria-checked="true"] {
  color: var(--brand-active);
  color: color-mix(in srgb, var(--brand-active) 88%, var(--text-primary));
}
.option-trigger:focus-visible, .option-row:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: -2px; }
</style>
