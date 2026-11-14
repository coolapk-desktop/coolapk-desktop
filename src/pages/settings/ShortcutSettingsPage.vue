<template>
  <div class="settings-section">
    <h3 class="section-title">快捷键列表</h3>

    <div class="setting-group">
      <h4 class="group-title">消息输入</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">私信输入框回车行为</span>
          <span class="row-sub">自定义在私信对话中按下 Enter 时发送消息或插入换行</span>
        </div>
        <select v-model="settingsStore.settings.messageEnterBehavior" class="select-control" aria-label="私信输入框回车行为">
          <option value="send">Enter 发送，Shift+Enter 换行</option>
          <option value="newline">Enter 换行，Ctrl/⌘+Enter 发送</option>
        </select>
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">键盘快捷键</h4>
      <div v-for="sc in shortcuts" :key="sc.key" class="setting-row">
        <div class="row-info">
          <span class="row-label">{{ sc.label }}</span>
          <span class="row-sub">{{ sc.desc }}</span>
        </div>
        <kbd class="shortcut-kbd">{{ sc.key }}</kbd>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { SHORTCUT_DEFINITIONS, usePlatformShortcuts } from '../../utils/shortcuts';
import { useSettingsStore } from '../../stores/settings';

const { formatShortcut } = usePlatformShortcuts();
const settingsStore = useSettingsStore();
const shortcuts = computed(() => SHORTCUT_DEFINITIONS.map((shortcut) => ({
  ...shortcut,
  key: formatShortcut(shortcut.key, shortcut.macKey),
})));
</script>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: 760px;
  min-width: 0;
  box-sizing: border-box;
  container-type: inline-size;
  container-name: shortcut-settings;
}

.section-title {
  font-size: var(--font-size-title-md);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
  padding-bottom: var(--space-3);
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.group-title {
  margin: 0;
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.setting-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-light);
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 200px;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.row-label {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.row-sub {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.shortcut-kbd {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 4px 10px;
  font-family: var(--font-mono, Consolas, monospace);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  max-width: 100%;
  overflow-wrap: anywhere;
  flex-shrink: 0;
}

.select-control {
  width: 220px;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.select-control:hover,
.select-control:focus {
  border-color: var(--brand-primary);
}

@media (max-width: 600px) {
  .select-control {
    width: 100%;
  }
}

@container shortcut-settings (max-width: 560px) {
  .select-control {
    width: 100%;
  }
}
</style>
