<template>
  <div ref="viewport" class="discovery-pager" @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="cancel" @touchmove="preventSwipeScroll" @click.capture="blockClick">
    <div ref="track" class="discovery-pager-track">
      <section v-for="(tab, index) in tabs" :key="tab.key" :class="['discovery-pager-page', { 'is-nearby': Math.abs(index - activeIndex) <= 1 }]" :style="{ left: `${index * 100}%` }" :inert="index !== activeIndex ? true : undefined" :aria-hidden="index !== activeIndex">
        <slot v-if="visited.has(tab.key) || Math.abs(index - activeIndex) <= 1" :tab="tab" />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { DiscoveryTab } from '../../types/discovery';
import { observeResizeOnFrame } from '../../utils/observeResizeOnFrame';

const props = defineProps<{ tabs: DiscoveryTab[]; activeKey: string }>();
const emit = defineEmits<{ select: [key: string]; prepare: [key: string]; progress: [position: number] }>();
const viewport = ref<HTMLElement>();
const track = ref<HTMLElement>();
let width = 1, position = 0, moveFrame = 0;
const visited = ref(new Set<string>([props.activeKey]));
const activeIndex = computed(() => Math.max(0, props.tabs.findIndex(tab => tab.key === props.activeKey)));
let stopObservingResize: (() => void) | undefined;
let animation = 0;
let prepareTimer = 0;
let drag: { id: number; x: number; y: number; time: number; index: number; horizontal: boolean } | undefined;
let suppressClickUntil = 0;

function setPosition(value: number) {
  position = value;
  if (track.value) track.value.style.transform = `translate3d(${-value * width}px, 0, 0)`;
  emit('progress', value);
}
function schedulePrepareNeighbors() {
  clearTimeout(prepareTimer);
  prepareTimer = window.setTimeout(() => {
    prepareTimer = 0;
    if (!drag) prepareNeighbors();
  }, 0);
}
function settle(target: number) {
  cancelAnimationFrame(animation);
  clearTimeout(prepareTimer);
  const from = position, started = performance.now();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(from - target) < .001) {
    setPosition(target);
    schedulePrepareNeighbors();
    return;
  }
  const tick = (now: number) => {
    const fraction = Math.min(1, (now - started) / 280);
    setPosition(from + (target - from) * (1 - Math.pow(1 - fraction, 3)));
    if (fraction < 1) animation = requestAnimationFrame(tick);
    else schedulePrepareNeighbors();
  };
  animation = requestAnimationFrame(tick);
}
function start(event: PointerEvent) {
  if (event.pointerType !== 'touch' || event.isPrimary === false || !viewport.value || viewport.value.closest('.prevent-mobile-layout') || window.innerWidth > 720) return;
  if ((event.target as HTMLElement).closest('input, textarea, a, [data-discovery-horizontal-scroll]')) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), index: activeIndex.value, horizontal: false };
}
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.horizontal) {
    if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { drag = undefined; return; }
    if (Math.abs(dx) <= 8) return;
    drag.horizontal = true;
    cancelAnimationFrame(animation);
    viewport.value?.setPointerCapture(event.pointerId);
  }
  pendingPosition = Math.max(0, Math.min(props.tabs.length - 1, drag.index - dx / width));
  if (!moveFrame) moveFrame = requestAnimationFrame(() => { moveFrame = 0; setPosition(pendingPosition); });
}
let pendingPosition = 0;
function flushMove() {
  if (moveFrame) { cancelAnimationFrame(moveFrame); moveFrame = 0; setPosition(pendingPosition); }
}
function prepareNeighbors() {
  for (const index of [activeIndex.value - 1, activeIndex.value + 1]) {
    if (props.tabs[index]) emit('prepare', props.tabs[index].key);
  }
}
function finish(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return;
  const gesture = drag; drag = undefined;
  if (!gesture.horizontal) return;
  flushMove();
  suppressClickUntil = performance.now() + 350;
  viewport.value?.releasePointerCapture(event.pointerId);
  const dx = event.clientX - gesture.x;
  const fast = Math.abs(dx) > 24 && Math.abs(dx) / Math.max(1, performance.now() - gesture.time) > .35;
  const target = Math.max(0, Math.min(props.tabs.length - 1, gesture.index + (Math.abs(dx) > width * .2 || fast ? (dx < 0 ? 1 : -1) : 0)));
  const tab = props.tabs[target];
  if (tab) emit('select', tab.key);
  // 话题 / 网页等入口可能打开新页面，原发现频道仍停留在当前页。
  settle(activeIndex.value);
}
function cancel() {
  flushMove();
  if (drag && viewport.value?.hasPointerCapture?.(drag.id)) viewport.value.releasePointerCapture(drag.id);
  drag = undefined; settle(activeIndex.value);
}
function preventSwipeScroll(event: TouchEvent) { if (drag?.horizontal && event.cancelable) event.preventDefault(); }
function blockClick(event: MouseEvent) { if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); } }
watch(activeIndex, value => {
  visited.value.add(props.tabs[value]?.key || props.activeKey);
  if (!drag) settle(value);
});
onMounted(() => {
  width = viewport.value?.clientWidth || 1;
  setPosition(activeIndex.value);
  if (viewport.value) stopObservingResize = observeResizeOnFrame(viewport.value, () => {
    const nextWidth = viewport.value?.clientWidth || 1;
    if (nextWidth !== width) { width = nextWidth; cancel(); }
  });
});
onUnmounted(() => { stopObservingResize?.(); cancelAnimationFrame(animation); cancelAnimationFrame(moveFrame); clearTimeout(prepareTimer); });
</script>

<style scoped>
.discovery-pager { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.discovery-pager-track { position: relative; width: 100%; height: 100%; will-change: transform; }
.discovery-pager-page { position: absolute; top: 0; width: 100%; height: 100%; display: flex; flex-direction: column; min-width: 0; contain: layout style; }
.discovery-pager-page:not(.is-nearby) { content-visibility: hidden; }
.discovery-pager-page[aria-hidden="true"] :deep(*),
.discovery-pager-page[aria-hidden="true"] :deep(*::before),
.discovery-pager-page[aria-hidden="true"] :deep(*::after) { animation-play-state: paused !important; }
</style>
