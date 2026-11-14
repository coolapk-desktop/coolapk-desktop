<template>
  <div class="settings-section">
    <h3 class="section-title">通知设置</h3>

    <div class="setting-group">
      <h4 class="group-title">提醒类型</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">回复提醒</span>
          <span class="row-sub">有人评论或回复你的动态时通知</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.notifyReplies" />
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">@提醒</span>
          <span class="row-sub">有人在动态中提到你时通知</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.notifyAt" />
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">私信提醒</span>
          <span class="row-sub">收到私信消息时通知</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.notifyPm" />
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">{{ isWebBuild ? '浏览器通知' : isAndroid ? '系统通知' : '桌面通知' }}</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">{{ isWebBuild ? '浏览器通知' : isAndroid ? '系统通知' : '系统桌面通知' }}</span>
          <span class="row-sub">{{ isWebBuild ? '页面打开期间，由浏览器提醒新消息' : isAndroid ? '通过系统通知提醒新消息，需要允许通知权限' : '应用在后台或最小化到托盘时，通过系统通知气泡提醒新消息' }}</span>
        </div>
        <AppSwitch :model-value="settingsStore.settings.desktopNotifications" @update:model-value="setNotifications" />
      </div>
      <div v-if="isAndroid && settingsStore.settings.desktopNotifications" class="setting-row">
        <div class="row-info">
          <span class="row-label">后台消息检查</span>
          <span class="row-sub">开启后显示常驻通知，切到后台仍检查消息。系统省电或服务时限可能暂停检查，重新打开应用后恢复；退出账号或关闭此开关即停止。</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.androidBackgroundNotifications" />
      </div>
      <div v-if="settingsStore.settings.desktopNotifications" class="setting-row">
        <div class="row-info">
          <span class="row-label">通知提示音</span>
          <span class="row-sub">收到新通知时播放提示音</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.notificationSound" />
      </div>
      <div v-if="settingsStore.settings.desktopNotifications" class="setting-row">
        <div class="row-info">
          <span class="row-label">通知轮询间隔</span>
          <span class="row-sub">后台检测新消息的频率，越短越及时但更耗电</span>
        </div>
        <select v-model.number="settingsStore.settings.notificationPollInterval" class="select-control">
          <option :value="1">1 分钟 (推荐)</option>
          <option :value="5">5 分钟</option>
          <option :value="10">10 分钟</option>
          <option :value="30">30 分钟</option>
        </select>
      </div>
      <p class="tray-tip">
        <i class="fas fa-info-circle"></i>
        <span>{{ isWebBuild ? '开启时需要允许此站点发送通知。' : '桌面通知需要系统授权，首次提醒时会自动请求权限。' }}</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings';
import { isWebBuild } from '../../api/runtime';
import AppSwitch from '../../components/common/AppSwitch.vue';

const settingsStore = useSettingsStore();
const isAndroid = !isWebBuild && /android/i.test(navigator.userAgent);

async function setNotifications(enabled: boolean) {
  if (isWebBuild && enabled) {
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission().catch(() => 'denied');
    if (permission !== 'granted') return;
  }
  settingsStore.settings.desktopNotifications = enabled;
}
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
  container-name: notification-settings;
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

.select-control {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  width: 220px;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.select-control:hover,
.select-control:focus {
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
  .select-control {
    width: 100%;
  }
}

@container notification-settings (max-width: 560px) {
  .select-control {
    width: 100%;
  }
}
</style>
