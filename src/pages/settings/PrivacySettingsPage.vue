<template>
  <div class="settings-section">
    <h3 class="section-title">隐私设置</h3>

    <div class="setting-group">
      <h4 class="group-title">发帖设备信息</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">发帖显示设备信息</span>
          <span class="row-sub">发布动态时在正文末尾自动附加设备签名</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.publishDeviceSignature" />
      </div>

      <div v-if="settingsStore.settings.publishDeviceSignature" class="setting-row">
        <div class="row-info">
          <span class="row-label">设备签名</span>
          <span class="row-sub">自定义附加在动态末尾的设备信息文本</span>
        </div>
        <input
          v-model="settingsStore.settings.deviceSignature"
          type="text"
          class="text-input"
          placeholder="如：酷安桌面版"
          maxlength="40"
        />
      </div>
      <p class="tray-tip">
        <i class="fas fa-info-circle"></i>
        <span>示例效果：{{ settingsStore.settings.publishDeviceSignature && settingsStore.settings.deviceSignature ? `... 来自 ${settingsStore.settings.deviceSignature}` : '未开启' }}</span>
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">账号隐私</h4>
      <p class="tray-tip">
        <i class="fas fa-info-circle"></i>
        <span>“允许通过酷安号搜索我”等账号级隐私设置由酷安官方服务器管理，桌面客户端暂未开放对应接口，请在酷安 App 中设置。</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings';
import AppSwitch from '../../components/common/AppSwitch.vue';

const settingsStore = useSettingsStore();
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
  container-name: privacy-settings;
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

.text-input {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  outline: none;
  width: 220px;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.text-input:hover,
.text-input:focus {
  border-color: var(--brand-primary);
}

.tray-tip {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.5;
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.tray-tip i {
  margin-top: 2px;
  flex-shrink: 0;
}

.tray-tip span {
  min-width: 0;
}

@media (max-width: 600px) {
  .text-input {
    width: 100%;
  }
}

@container privacy-settings (max-width: 560px) {
  .text-input {
    width: 100%;
  }
}
</style>
