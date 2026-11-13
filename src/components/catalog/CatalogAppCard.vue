<template>
  <div class="app-card" :class="{ 'rank-card': rank }" @click="emit('open')">
    <span v-if="rank" class="rank-number" :class="{ 'rank-leading': rank <= 3 }" :aria-label="`第 ${rank} 名`">{{ rank }}</span>
    <AppImage :src="icon" alt="" image-class="app-icon" />
    <div class="app-info">
      <div class="title-row">
        <span class="app-name" :title="title">{{ title }}</span>
        <span v-if="version" class="version-tag" :title="version">{{ version }}</span>
      </div>
      <span v-if="description" class="app-desc">{{ description }}</span>
      <div v-if="score || size || downloads" class="app-meta">
        <span v-if="score" class="score"><i class="fas fa-star" aria-hidden="true"></i> {{ score }}</span>
        <span v-if="size" class="meta-item"><i class="fas fa-hdd" aria-hidden="true"></i> {{ size }}</span>
        <span v-if="downloads" class="meta-item"><i class="fas fa-download" aria-hidden="true"></i> {{ downloads }}</span>
      </div>
    </div>
    <AppButton variant="secondary" size="sm" icon="fas fa-arrow-right" class="action-btn" :aria-label="`查看 ${title}`" @click.stop="emit('open')">
      查看
    </AppButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AppButton from '../common/AppButton.vue';
import AppImage from '../common/AppImage.vue';

const props = withDefaults(defineProps<{
  app: Record<string, unknown>;
  rank?: number;
  fallbackTitle?: string;
}>(), { fallbackTitle: '应用' });
const emit = defineEmits<{ open: [] }>();

function field(...keys: string[]): string {
  for (const key of keys) {
    const value = props.app[key];
    if ((typeof value === 'string' || typeof value === 'number') && value) return String(value);
  }
  return '';
}

const title = computed(() => field('title', 'shorttitle', 'name') || props.fallbackTitle);
const icon = computed(() => field('icon', 'apkRomIcon', 'logo', 'pic') || 'https://c2.coolapk.com/coolmarket/apk/default_avatar.png');
const version = computed(() => field('version', 'apkversionname', 'versionName'));
const description = computed(() => field('subTitle', 'description', 'packageName', 'package_name', 'apkname', 'category'));
const score = computed(() => field('score', 'ratingAverageScore', 'rating_average_score'));
const size = computed(() => field('apkSizeFormatted', 'size', 'apksize'));
const downloads = computed(() => field('downCountFormatted', 'downnum', 'downCount'));
</script>

<style>
.catalog-app-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(auto-fill, minmax(min(380px, 100%), 1fr));
  gap: var(--space-4);
}

@media (max-width: 720px) {
  .catalog-app-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<style scoped>
.rank-number {
  flex: 0 0 26px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-control);
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-bold);
  font-variant-numeric: tabular-nums;
}

.rank-leading {
  background: var(--brand-soft);
}

.rank-leading {
  color: var(--brand-active);
  color: color-mix(in srgb, var(--brand-active) 88%, var(--text-primary));
}

.app-card {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  cursor: pointer;
  transition: all var(--duration-fast);
}

.app-card:hover {
  border-color: var(--brand-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transform: translateY(-2px);
}

.app-icon {
  width: 58px;
  height: 58px;
  border-radius: var(--radius-control);
  object-fit: cover;
  flex-shrink: 0;
}

.app-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.app-name {
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.version-tag {
  min-width: 0;
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-tertiary);
  background-color: var(--surface-hover);
  padding: 1px 5px;
  border-radius: var(--radius-xs);
}

.app-desc {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.score {
  color: #f59e0b;
  font-weight: bold;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.action-btn {
  flex-shrink: 0;
}

@media (max-width: 720px) {
  .app-card {
    width: 100%;
    min-width: 0;
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr) auto;
    gap: 10px;
    padding: 12px;
  }

  .rank-card {
    grid-template-columns: 26px 58px minmax(0, 1fr) auto;
  }

  .app-info,
  .title-row {
    min-width: 0;
  }

  .app-meta {
    flex-wrap: wrap;
    gap: 4px 8px;
  }
}
</style>
