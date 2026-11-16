<template>
  <div class="secondhand-waterfall">
    <div v-for="(item,index) in items" :key="getEntityKey(item,index)" :ref="el => observeCard(el as HTMLElement | null, getEntityKey(item,index))" class="secondhand-grid-item" style="grid-row-end: span 1;">
      <DiscoverySecondHandCard :entity="item" @open="$emit('open', $event)" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, onUpdated } from 'vue';
import type { DiscoveryEntity } from '../../types/discovery';
import { getEntityKey } from '../../utils/discovery';
import DiscoverySecondHandCard from './DiscoverySecondHandCard.vue';
defineProps<{ items: DiscoveryEntity[] }>();
defineEmits<{ open: [entity: DiscoveryEntity] }>();

interface CardEntry {
  key: string;
  wrapper: HTMLElement;
  element: Element;
  span: number;
}

const cards = new Map<string, CardEntry>();
const elementToKey = new WeakMap<Element, string>();
const dirtyKeys = new Set<string>();
let microtaskScheduled = false;
let rafId: number | null = null;
let stopped = false;

const resizeObserver = typeof ResizeObserver === 'undefined'
  ? null
  : new ResizeObserver((entries) => {
      if (stopped) return;
      let added = false;
      if (entries && typeof (entries as unknown as Iterable<ResizeObserverEntry>)[Symbol.iterator] === 'function') {
        for (const entry of entries) {
          const key = elementToKey.get(entry.target);
          if (key && cards.has(key)) {
            dirtyKeys.add(key);
            added = true;
          }
        }
      } else {
        for (const key of cards.keys()) {
          dirtyKeys.add(key);
          added = true;
        }
      }
      if (added) scheduleRafFlush();
    });

function flushDirty(allowRetryZero = false) {
  if (stopped || dirtyKeys.size === 0) return;
  const keys = [...dirtyKeys];
  dirtyKeys.clear();
  // 先统一读取所有脏卡片高度，再统一写回 gridRowEnd，避免 N 次读写交替触发强制回流。
  const measurements: Array<{ entry: CardEntry; height: number }> = [];
  for (const key of keys) {
    const entry = cards.get(key);
    if (!entry) continue;
    measurements.push({ entry, height: entry.element.getBoundingClientRect().height });
  }
  let hasZero = false;
  for (const { entry, height } of measurements) {
    if (height <= 0) {
      hasZero = true;
      dirtyKeys.add(entry.key);
      continue;
    }
    const nextSpan = Math.max(1, Math.ceil((height + 8) / 12));
    if (entry.span !== nextSpan) {
      entry.span = nextSpan;
      entry.wrapper.style.gridRowEnd = `span ${nextSpan}`;
    }
  }
  if (allowRetryZero && hasZero) scheduleMicrotaskFlush();
}

function scheduleMicrotaskFlush() {
  if (stopped || microtaskScheduled) return;
  microtaskScheduled = true;
  Promise.resolve().then(() => {
    microtaskScheduled = false;
    flushDirty(false);
  });
}

function scheduleRafFlush() {
  if (stopped || rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    flushDirty(false);
  });
}

function observeCard(wrapper: HTMLElement | null, key: string) {
  const element = wrapper?.firstElementChild ?? null;
  const previous = cards.get(key);
  if (previous?.element === element && previous?.wrapper === wrapper) return;
  if (previous) {
    resizeObserver?.unobserve?.(previous.element);
    elementToKey.delete(previous.element);
    cards.delete(key);
    dirtyKeys.delete(key);
    if (dirtyKeys.size === 0 && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  if (!wrapper || !element) return;
  const entry: CardEntry = { key, wrapper, element, span: 1 };
  cards.set(key, entry);
  elementToKey.set(element, key);
  dirtyKeys.add(key);
  resizeObserver?.observe(element);
}

onMounted(() => flushDirty(true));
onUpdated(() => flushDirty(true));
onUnmounted(() => {
  stopped = true;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  resizeObserver?.disconnect();
  cards.clear();
  dirtyKeys.clear();
});
</script>
<style scoped>
.secondhand-waterfall { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); grid-auto-rows:4px; gap:8px; }
.secondhand-grid-item { min-width:0; align-self:start; }
@media(max-width:1100px) { .secondhand-waterfall { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media(max-width:720px) { .secondhand-waterfall { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
