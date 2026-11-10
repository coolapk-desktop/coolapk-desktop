<template>
  <figure class="stats-chart">
    <figcaption>
      <h4>{{ title }}</h4>
      <span v-if="unknown" class="chart-unknown">未知 {{ formatNumber(unknown) }} {{ unit }}</span>
    </figcaption>
    <template v-if="points.length">
      <div class="chart-value" aria-hidden="true">
        <strong>{{ formatNumber(activePoint.value) }}</strong>
        <span>{{ unit }} · {{ activePoint.label }}</span>
      </div>
      <div class="chart-frame">
        <div class="chart-y-axis" aria-hidden="true">
          <span v-for="tick in yTicks" :key="tick">{{ formatNumber(tick) }}</span>
        </div>
        <div
          class="chart-plot"
          role="slider"
          tabindex="0"
          :aria-label="title"
          :aria-valuemin="1"
          :aria-valuemax="points.length"
          :aria-valuenow="activeIndex + 1"
          :aria-valuetext="`${activePoint.label}，${activePoint.value} ${unit}`"
          @pointermove="previewPoint"
          @pointerdown="selectPoint"
          @pointerleave="preview = null"
          @keydown="handleKey"
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line v-for="y in gridLines" :key="y" x1="0" x2="100" :y1="y" :y2="y" class="chart-grid" />
            <rect
              v-for="(point, index) in points"
              :key="point.label"
              class="chart-bar"
              :class="{ 'is-active': index === activeIndex }"
              :x="point.x - barWidth / 2"
              :y="point.y"
              :width="barWidth"
              :height="100 - point.y"
            />
            <line :x1="activePoint.x" :x2="activePoint.x" y1="0" y2="100" class="chart-guide" vector-effect="non-scaling-stroke" />
          </svg>
          <span class="chart-marker" :style="{ left: `${activePoint.x}%`, top: `${activePoint.y}%` }" aria-hidden="true" />
          <span v-for="tick in xTicks" :key="tick.x" class="chart-x-label" :style="{ left: `${tick.x}%` }" aria-hidden="true">{{ tick.label }}</span>
        </div>
      </div>
    </template>
    <p v-else class="chart-empty">{{ emptyText }}</p>
  </figure>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  title: string;
  unit: string;
  rows: { label: string; value: number }[];
  unknown: number;
  emptyText: string;
}>();

const formatNumber = new Intl.NumberFormat('zh-CN').format;
const gridLines = [0, 25, 50, 75, 100];
const selected = ref<number | null>(null);
const preview = ref<number | null>(null);
const max = computed(() => props.rows.reduce((highest, row) => Math.max(highest, row.value), 0));
// 纵轴使用整齐的 1、2、5 倍刻度，切换口径时从零重新缩放。
const step = computed(() => {
  const target = Math.max(1, max.value / 4);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  return ([1, 2, 5, 10].find(value => value * magnitude >= target) ?? 10) * magnitude;
});
const yTicks = computed(() => gridLines.map((_, index) => (4 - index) * step.value));
// 每级占用同宽的横轴区间，柱体居中。
const slotWidth = computed(() => 100 / Math.max(1, props.rows.length));
const barWidth = computed(() => Math.min(12, slotWidth.value * 0.64));
const points = computed(() => props.rows.map((row, index) => ({
  ...row,
  x: (index + 0.5) * slotWidth.value,
  y: 100 - (row.value / (step.value * 4)) * 100,
})));
const peak = computed(() => props.rows.findIndex(row => row.value === max.value));
const activeIndex = computed(() => Math.max(0, Math.min(points.value.length - 1, preview.value ?? selected.value ?? peak.value)));
const activePoint = computed(() => points.value[activeIndex.value] ?? { x: 50, y: 100, label: '', value: 0 });
const xTicks = computed(() => {
  const count = Math.min(points.value.length, 5);
  return Array.from({ length: count }, (_, tick) => {
    const index = count === 1 ? 0 : Math.round(tick * (points.value.length - 1) / (count - 1));
    return { x: points.value[index].x, label: points.value[index].label };
  });
});

function pointAt(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!rect.width || points.value.length < 2) return null;
  const x = (event.clientX - rect.left) / rect.width * 100;
  return Math.max(0, Math.min(points.value.length - 1, Math.floor(x / slotWidth.value)));
}

function previewPoint(event: PointerEvent) {
  if (event.pointerType !== 'touch') preview.value = pointAt(event);
}

function selectPoint(event: PointerEvent) {
  selected.value = pointAt(event);
  preview.value = null;
}

function handleKey(event: KeyboardEvent) {
  const next = { ArrowLeft: activeIndex.value - 1, ArrowDown: activeIndex.value - 1, ArrowRight: activeIndex.value + 1, ArrowUp: activeIndex.value + 1, Home: 0, End: points.value.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  selected.value = Math.max(0, Math.min(points.value.length - 1, next));
  preview.value = null;
}
</script>

<style scoped>
.stats-chart { min-width: 0; margin: 0; --chart-color: var(--brand-primary); }
figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
h4 { margin: 0; font-size: 15px; font-weight: 650; }
.chart-unknown, .chart-value span, .chart-empty { color: var(--text-secondary); font-size: 13px; }
.chart-unknown { flex-shrink: 0; }
.chart-value { display: flex; gap: 8px; align-items: baseline; min-height: 30px; margin: 0 0 8px; }
.chart-value strong { font-size: 22px; line-height: 1.15; font-variant-numeric: tabular-nums; }
.chart-value span { min-width: 0; overflow-wrap: anywhere; }
.chart-frame { display: grid; grid-template-columns: minmax(2.25em, auto) minmax(0, 1fr); gap: 8px; padding: 7px 6px 25px 0; }
.chart-y-axis { display: flex; flex-direction: column; justify-content: space-between; margin-block: -0.55em; text-align: right; }
.chart-y-axis, .chart-x-label { font-size: 11px; line-height: 1.1; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.chart-plot { position: relative; height: clamp(220px, 36vh, 360px); min-width: 0; cursor: crosshair; touch-action: pan-y; }
.chart-plot:focus-visible { outline: 2px solid var(--chart-color); outline-offset: 3px; }
svg { display: block; width: 100%; height: 100%; overflow: visible; }
.chart-grid { stroke: var(--border); stroke-width: 1; vector-effect: non-scaling-stroke; }
.chart-bar { fill: var(--chart-color); fill-opacity: 0.48; }
.chart-bar.is-active { fill-opacity: 0.9; }
.chart-guide { stroke: var(--chart-color); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.6; }
.chart-marker { position: absolute; width: 10px; height: 10px; border: 2px solid var(--surface); border-radius: 50%; background: var(--chart-color); transform: translate(-50%, -50%); pointer-events: none; }
.chart-x-label { position: absolute; top: calc(100% + 9px); transform: translateX(-50%); white-space: nowrap; pointer-events: none; }
.chart-empty { margin: 0; padding: 22px 14px; border-radius: 8px; background: var(--background-secondary); }
</style>
