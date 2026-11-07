<template>
  <div class="page-container custom-scrollbar downloads-page">
    <!-- 头部标题与设置 -->
    <header class="downloads-header">
      <div class="header-main">
        <div class="header-icon-badge">
          <i class="fas fa-download"></i>
        </div>
        <h1 class="downloads-title">下载管理</h1>
      </div>
      <div class="header-actions">
        <AppButton
          variant="secondary"
          size="sm"
          icon="fas fa-folder-open"
          :title="downloadDirTooltip"
          @click="downloadStore.openDirectory()"
        >
          打开目录
        </AppButton>
        <AppButton
          variant="secondary"
          size="sm"
          icon="fas fa-sliders"
          @click="router.push('/settings/downloads')"
        >
          下载设置
        </AppButton>
      </div>
    </header>

    <!-- 顶部数据概览卡片 -->
    <div class="download-summary-row">
      <!-- 进行中 -->
      <div class="summary-card card-active">
        <div class="summary-icon-wrap active-icon">
          <i class="fas fa-cloud-arrow-down"></i>
        </div>
        <div class="summary-body">
          <div class="summary-top">
            <span class="summary-label">进行中<span class="summary-label-extra">任务</span></span>
            <span v-if="allTransferSpeed > 0" class="speed-badge">
              <i class="fas fa-bolt"></i> {{ formatBytes(allTransferSpeed) }}/s
            </span>
          </div>
          <div class="summary-value-wrap">
            <strong class="summary-value">{{ allActiveCount }}</strong>
            <span class="summary-hint">{{ activeTasksHint }}</span>
          </div>
        </div>
      </div>

      <!-- 已完成 -->
      <div class="summary-card card-completed">
        <div class="summary-icon-wrap completed-icon">
          <i class="fas fa-circle-check"></i>
        </div>
        <div class="summary-body">
          <div class="summary-top">
            <span class="summary-label">已完成<span class="summary-label-extra">任务</span></span>
          </div>
          <div class="summary-value-wrap">
            <strong class="summary-value">{{ completedCount }}</strong>
            <span class="summary-hint">{{ completedTasksHint }}</span>
          </div>
        </div>
      </div>

      <!-- 存储占用 -->
      <div class="summary-card card-storage">
        <div class="summary-icon-wrap storage-icon">
          <i class="fas fa-hard-drive"></i>
        </div>
        <div class="summary-body">
          <div class="summary-top">
            <span class="summary-label">安装包<span class="summary-label-extra">占用</span></span>
          </div>
          <div class="summary-value-wrap">
            <strong class="summary-value">{{ formatBytes(downloadStore.completedTotalBytes) }}</strong>
            <span class="summary-hint" :title="downloadDirTooltip">{{ storageCardHint }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 工具栏：胶囊 Tab 切换与批量快捷操作 -->
    <div class="downloads-toolbar">
      <div class="toolbar-tab-groups">
        <div class="segmented-control status-tabs" role="tablist" aria-label="任务状态">
          <button
            :class="['segmented-tab', { active: selectedTab === 'active' }]"
            type="button"
            @click="selectedTab = 'active'"
          >
            <i class="fas fa-list-check"></i>
            <span>当前任务</span>
            <span class="tab-badge">{{ currentActiveCount }}</span>
          </button>
          <button
            :class="['segmented-tab', { active: selectedTab === 'history' }]"
            type="button"
            @click="selectedTab = 'history'"
          >
            <i class="fas fa-clock-rotate-left"></i>
            <span>下载历史</span>
            <span class="tab-badge">{{ currentHistoryCount }}</span>
          </button>
        </div>
      </div>

      <div class="toolbar-batch-actions">
        <template v-if="selectedTab === 'active' && activeTasks.length > 0">
          <AppButton
            v-if="hasActiveDownloading"
            variant="secondary"
            size="sm"
            icon="fas fa-pause"
            @click="downloadStore.pauseAll()"
          >
            全部暂停
          </AppButton>
          <AppButton
            v-if="hasActivePaused"
            variant="secondary"
            size="sm"
            icon="fas fa-play"
            @click="downloadStore.resumeAll()"
          >
            全部继续
          </AppButton>
        </template>
        <template v-else-if="selectedTab === 'history' && downloadStore.historyTasks.length > 0">
          <AppButton
            v-if="failedHistoryCount > 0"
            variant="ghost"
            size="sm"
            icon="fas fa-circle-exclamation"
            @click="handleClearFailed"
          >
            清空失败记录
          </AppButton>
          <AppButton
            variant="ghost"
            size="sm"
            icon="fas fa-trash-can"
            @click="handleClearHistory"
          >
            清空历史
          </AppButton>
        </template>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="visibleTasks.length === 0" class="downloads-empty">
      <EmptyState
        :icon="selectedTab === 'active' ? 'fas fa-cloud-arrow-down' : 'fas fa-clock-rotate-left'"
        :title="selectedTab === 'active' ? '暂无正在进行的下载任务' : '暂无下载历史记录'"
        :description="selectedTab === 'active' ? (isAndroid ? '在应用或游戏详情页点击下载，即可加入队列' : '在应用或游戏详情页点击“下载到电脑”即可加入队列') : '完成、失败和取消的安装包记录会保存在这里'"
      />
      <div v-if="selectedTab === 'active'" class="empty-action">
        <AppButton variant="secondary" size="sm" icon="fas fa-compass" @click="router.push('/apps')">
          去发现热门应用
        </AppButton>
      </div>
    </div>

    <!-- 任务卡片列表 -->
    <div v-else class="download-list">
      <TransitionGroup name="task-item">
        <article v-for="task in visibleTasks" :key="task.id" class="download-card">
          <!-- 应用图标 -->
          <div class="download-icon-wrap">
            <AppImage v-if="task.logoUrl" :src="task.logoUrl" :alt="task.title" image-class="download-icon" />
            <div v-else class="fallback-icon-wrap">
              <i class="fas fa-cube"></i>
            </div>
          </div>

          <!-- 任务主体 -->
          <div class="download-main">
            <!-- 标题、格式与状态徽标 -->
            <div class="download-title-row">
              <h3 class="download-task-title" :title="task.title">{{ task.title }}</h3>
              <span class="download-kind-badge">{{ kindBadgeText(task) }}</span>
              <span :class="['download-status-badge', `status-${task.status}`]">
                <span v-if="task.status === 'downloading'" class="status-pulse-dot"></span>
                <i v-else :class="statusIcon(task.status)" class="status-badge-icon"></i>
                {{ statusText(task.status) }}
              </span>
            </div>

            <!-- 元信息（版本号、文件大小、包名、文件名） -->
            <div class="download-meta">
              <span v-if="task.versionName" class="meta-version">v{{ task.versionName }}</span>
              <span v-if="taskSizeText(task)" class="meta-size">
                <i class="fas fa-file-arrow-down meta-size-icon"></i>
                {{ taskSizeText(task) }}
              </span>
              <span class="meta-pkg" :title="task.packageName">{{ task.packageName }}</span>
              <span class="meta-dot">·</span>
              <span class="meta-filename" :title="task.fileName">{{ task.fileName }}</span>
            </div>

            <!-- 进度条与实时速率信息（进行中类状态显示） -->
            <div
              v-if="task.status === 'downloading' || task.status === 'paused' || task.status === 'queued' || task.status === 'failed'"
              class="download-progress-section"
            >
              <div class="download-progress-track">
                <div
                  :class="['download-progress-fill', `fill-${task.status}`]"
                  :style="{ width: `${progressPercent(task)}%` }"
                ></div>
              </div>
              <div class="download-progress-metrics">
                <div class="metrics-left">
                  <span class="progress-size">{{ progressSizeText(task) }}</span>
                  <span class="progress-percent">({{ progressPercent(task) }}%)</span>
                </div>
                <div class="metrics-right">
                  <span v-if="task.status === 'downloading' && task.speed > 0" class="speed-text">
                    <i class="fas fa-bolt"></i> {{ formatBytes(task.speed) }}/s
                  </span>
                  <span v-if="remainingTimeText(task)" class="eta-text">
                    剩余 {{ remainingTimeText(task) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 失败错误提示 -->
            <div v-if="task.error" class="download-error-box" :title="task.error">
              <i class="fas fa-circle-exclamation"></i>
              <span>{{ task.error }}</span>
            </div>

            <!-- 已完成存储路径 -->
            <div
              v-if="task.targetPath && task.status === 'completed'"
              class="download-completed-path"
              :title="isAndroid ? task.fileName : task.targetPath"
            >
              <i class="fas fa-folder"></i>
              <span>{{ isAndroid ? (task.publicPath ? '已保存到公共目录' : '已保存到应用目录') : task.targetPath }}</span>
            </div>
          </div>

          <!-- 操作按钮组 -->
          <div class="download-actions">
            <!-- 更新包下载中：不支持暂停/取消（Rust 侧无对应命令），不提供按钮避免误导 -->
            <template v-if="isUpdateTask(task) && task.status === 'downloading'"></template>

            <!-- 更新包排队中：已登记但首个进度未到，没有可暂停/取消的下载，
                 但用户仍应有单条「删除记录」入口，操作区不能为空 -->
            <template v-else-if="isUpdateTask(task) && task.status === 'queued'">
              <AppButton variant="ghost" size="sm" icon="fas fa-trash-can" @click="removeTask(task)">
                删除记录
              </AppButton>
            </template>

            <!-- 下载中：暂停 / 取消 -->
            <template v-else-if="task.status === 'downloading'">
              <AppButton variant="secondary" size="sm" icon="fas fa-pause" @click="downloadStore.pause(task.id)">
                暂停
              </AppButton>
              <AppButton variant="ghost" size="sm" icon="fas fa-xmark" @click="downloadStore.cancel(task.id)">
                取消
              </AppButton>
            </template>

            <!-- 排队中：取消 -->
            <template v-else-if="task.status === 'queued' && !isUpdateTask(task)">
              <AppButton variant="ghost" size="sm" icon="fas fa-ban" @click="downloadStore.cancel(task.id)">
                取消
              </AppButton>
            </template>

            <!-- 暂停中：继续 / 删除 -->
            <template v-else-if="task.status === 'paused' && !isUpdateTask(task)">
              <AppButton variant="primary" size="sm" icon="fas fa-play" @click="downloadStore.resume(task.id)">
                继续
              </AppButton>
              <AppButton variant="ghost" size="sm" icon="fas fa-trash-can" @click="removeTask(task)">
                删除记录
              </AppButton>
            </template>

            <!-- 更新包失败：重试通过 window 事件交回 App.vue 重新发起下载（更新器不支持断点续传） -->
            <template v-else-if="isUpdateTask(task) && task.status === 'failed'">
              <AppButton variant="primary" size="sm" icon="fas fa-rotate-right" @click="retryUpdate(task)">
                重试
              </AppButton>
              <AppButton variant="ghost" size="sm" icon="fas fa-trash-can" @click="removeTask(task)">
                删除记录
              </AppButton>
            </template>

            <!-- 失败或已取消：继续断点 / 重新开始 / 删除 -->
            <template v-else-if="(task.status === 'failed' || task.status === 'canceled') && !isUpdateTask(task)">
              <AppButton variant="primary" size="sm" icon="fas fa-rotate-right" @click="downloadStore.retry(task.id)">
                {{ task.downloaded > 0 ? '继续下载' : '重试' }}
              </AppButton>
              <AppButton
                v-if="task.downloaded > 0"
                variant="secondary"
                size="sm"
                icon="fas fa-arrow-rotate-left"
                @click="downloadStore.restart(task.id)"
              >
                重新开始
              </AppButton>
              <AppButton variant="ghost" size="sm" icon="fas fa-trash-can" @click="removeTask(task)">
                删除记录
              </AppButton>
            </template>

            <!-- 更新包完成：安装入口通过 window 事件交回 App.vue（含 portable/deb/rpm 分支） -->
            <template v-else-if="isUpdateTask(task) && task.status === 'completed'">
              <AppButton variant="primary" size="sm" icon="fas fa-arrows-rotate" @click="installUpdate(task)">
                安装
              </AppButton>
              <AppButton variant="ghost" size="sm" icon="fas fa-trash-can" @click="removeTask(task)">
                删除记录
              </AppButton>
            </template>

            <!-- 已完成：打开位置 / 删除 -->
            <template v-else-if="task.status === 'completed' && !isUpdateTask(task)">
              <AppButton v-if="isAndroid && /\.apk$/i.test(task.targetPath)" variant="primary" size="sm" icon="fas fa-download" @click="downloadStore.install(task)">
                安装
              </AppButton>
              <AppButton variant="secondary" size="sm" icon="fas fa-folder-open" @click="downloadStore.open(task)">
                文件位置
              </AppButton>
              <AppButton variant="ghost" size="sm" icon="fas fa-trash-can" @click="removeTask(task)">
                删除记录
              </AppButton>
            </template>
          </div>
        </article>
      </TransitionGroup>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import AppImage from '../components/common/AppImage.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { isUpdateTask, useDownloadStore } from '../stores/downloads';
import { useSettingsStore } from '../stores/settings';
import { requestConfirmation } from '../utils/confirm';
import type { DownloadStatus, DownloadTask } from '../types/download';

const route = useRoute();
const isAndroid = /android/i.test(navigator.userAgent);
const router = useRouter();
const downloadStore = useDownloadStore();
const settingsStore = useSettingsStore();
const selectedTab = ref<'active' | 'history'>('active');

watch(
  () => route.query.tab, (tab) => {
    selectedTab.value = tab === 'history' ? 'history' : 'active';
  },
  { immediate: true },
);

const activeTasks = computed(() => downloadStore.activeTasks);
const visibleTasks = computed(() => selectedTab.value === 'active' ? activeTasks.value : downloadStore.historyTasks);
const downloadCompletedCount = computed(() => downloadStore.tasks.filter((task) => task.status === 'completed').length);
const completedCount = computed(() => downloadCompletedCount.value);
const allActiveCount = computed(() => downloadStore.activeCount);
const allTransferSpeed = computed(() => downloadStore.totalSpeed);
const currentActiveCount = computed(() => downloadStore.activeCount);
const currentHistoryCount = computed(() => downloadStore.historyTasks.length);
const failedHistoryCount = computed(() => downloadStore.historyTasks.filter((task) => task.status === 'failed').length);
const downloadDirTooltip = computed(() => settingsStore.settings.downloadPath || '保存至系统默认下载目录');

const hasActiveDownloading = computed(() =>
  activeTasks.value.some((task) => task.status === 'downloading' || task.status === 'queued')
);
const hasActivePaused = computed(() =>
  activeTasks.value.some((task) => task.status === 'paused')
);

const activeTasksHint = computed(() => {
  if (allActiveCount.value === 0) return '队列空闲';
  if (hasActiveDownloading.value) return '正在下载';
  return '下载已暂停';
});

const completedTasksHint = computed(() => {
  if (completedCount.value === 0) return '暂无完成记录';
  return '下载已完成';
});

const storageCardHint = computed(() => {
  if (downloadCompletedCount.value === 0) return '暂无占用';
  return `共 ${downloadCompletedCount.value} 个安装包`;
});

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function progressPercent(task: DownloadTask) {
  if (!task.total) return task.downloaded > 0 ? 5 : 0;
  return Math.min(100, Math.max(0, Math.round((task.downloaded / task.total) * 100)));
}

function progressSizeText(task: DownloadTask) {
  return task.total ? `${formatBytes(task.downloaded)} / ${formatBytes(task.total)}` : formatBytes(task.downloaded);
}

function taskSizeText(task: DownloadTask) {
  const bytes = task.total || task.downloaded || 0;
  return bytes > 0 ? formatBytes(bytes) : '';
}

function remainingTimeText(task: DownloadTask) {
  if (task.status !== 'downloading' || !task.speed || task.speed <= 0 || !task.total || task.downloaded >= task.total) {
    return '';
  }
  const remainingBytes = task.total - task.downloaded;
  const seconds = Math.ceil(remainingBytes / task.speed);
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}小时${m}分` : `${h}小时`;
}

function kindBadgeText(task: DownloadTask) {
  // 更新包任务的 kind 是 'update'，直接大写展示（UPDATE）对用户没有意义，给中文徽标。
  if (isUpdateTask(task)) return '应用更新';
  return task.kind.toUpperCase();
}

/** 请求 App.vue 打开待安装弹窗并启动更新安装（载荷仅带版本号用于诊断日志）。 */
function installUpdate(task: DownloadTask) {
  window.dispatchEvent(new CustomEvent('coolapk:install-update', { detail: { version: task.versionName } }));
}

/** 请求 App.vue 重新发起更新包下载（更新器不支持断点，只能整体重下）。 */
function retryUpdate(_task: DownloadTask) {
  window.dispatchEvent(new CustomEvent('coolapk:retry-update'));
}

function statusIcon(status: DownloadStatus) {
  return {
    queued: 'fas fa-clock',
    downloading: 'fas fa-arrow-down',
    paused: 'fas fa-pause',
    completed: 'fas fa-check',
    failed: 'fas fa-circle-exclamation',
    canceled: 'fas fa-ban',
  }[status];
}

function statusText(status: DownloadStatus) {
  return {
    queued: '排队中',
    downloading: '下载中',
    paused: '已暂停',
    completed: '已完成',
    failed: '下载失败',
    canceled: '已取消',
  }[status];
}

async function removeTask(task: DownloadTask) {
  // 更新包文件由更新器管理（含待安装校验），删除记录不动文件，也无需确认弹窗。
  if (isUpdateTask(task)) {
    await downloadStore.removeUpdateTask(task.id);
    return;
  }
  const deleteFile =
    task.status !== 'completed' ||
    (await requestConfirmation({
      title: '删除下载记录',
      message: isAndroid ? '是否同时删除应用目录和公共下载目录中的安装包文件？' : '是否同时删除电脑上已保存的安装包文件？',
      confirmText: '删除文件',
      danger: true,
    }));
  await downloadStore.remove(task.id, deleteFile);
}

async function handleClearHistory() {
  if (downloadStore.historyTasks.length === 0) return;
  const confirmed = await requestConfirmation({
    title: '清空下载历史',
    message: '确定要清空全部下载历史记录吗？（已下载的安装包文件不会被删除）',
    confirmText: '清空记录',
    danger: true,
  });
  if (confirmed) {
    await downloadStore.clearHistory(false);
  }
}

async function handleClearFailed() {
  if (failedHistoryCount.value === 0) return;
  const confirmed = await requestConfirmation({
    title: '清空失败记录',
    message: '确定要清空全部下载失败的记录吗？（已下载的断点文件不会被删除）',
    confirmText: '清空记录',
    danger: true,
  });
  if (confirmed) {
    await downloadStore.clearFailed(false);
  }
}

onMounted(async () => {
  await downloadStore.initialize();
  void downloadStore.pump();
});
</script>

<style scoped>
.downloads-page {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: var(--space-6) var(--space-8) var(--space-10);
  box-sizing: border-box;
}

/* 顶部标题栏 */
.downloads-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.header-main {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}

.header-icon-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: var(--radius-control);
  background: var(--brand-soft);
  color: var(--brand-primary);
  font-size: 18px;
}

.downloads-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-size-title-lg);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

/* 顶部统计卡片 */
.download-summary-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-card);
  background: var(--surface);
  transition: all var(--duration-fast) var(--ease-default);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.summary-card:hover {
  border-color: var(--border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}

.summary-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  border-radius: 10px;
  font-size: 17px;
}

.active-icon {
  background: var(--brand-soft);
  color: var(--brand-primary);
}

.completed-icon {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.storage-icon {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}

.summary-body {
  min-width: 0;
  flex: 1;
}

.summary-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.summary-label {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: var(--font-weight-medium);
}

.speed-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--brand-soft);
  color: var(--brand-primary);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
}

.summary-value-wrap {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
  min-width: 0;
}

.summary-value {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: var(--font-weight-bold);
  line-height: 1.2;
  white-space: nowrap;
}

.summary-hint {
  color: var(--text-tertiary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 工具栏与分段胶囊 Tab */
.downloads-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.toolbar-tab-groups {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.segmented-control {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: var(--radius-control);
  background: var(--background-secondary);
  border: 1px solid var(--border-light);
}

.segmented-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 0;
  border-radius: calc(var(--radius-control) - 2px);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  transition: all var(--duration-fast) var(--ease-default);
}

.segmented-tab i {
  font-size: 13px;
}

.segmented-tab.active {
  background: var(--surface);
  color: var(--brand-primary);
  font-weight: var(--font-weight-semibold);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.tab-badge {
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--surface-hover);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  transition: all var(--duration-fast) var(--ease-default);
}

.segmented-tab.active .tab-badge {
  background: var(--brand-soft);
  color: var(--brand-primary);
}

.toolbar-batch-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 空状态 */
.downloads-empty {
  padding: var(--space-8) 0;
  text-align: center;
}

.empty-action {
  margin-top: var(--space-3);
}

/* 任务列表与卡片 */
.download-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.download-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  transition: all var(--duration-fast) var(--ease-default);
}

.download-card:hover {
  border-color: var(--border);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
}

/* 图标 */
.download-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  flex: 0 0 56px;
  overflow: hidden;
  border-radius: 14px;
  background: var(--background-secondary);
  border: 1px solid var(--border-light);
}

.download-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fallback-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--brand-soft);
  color: var(--brand-primary);
  font-size: 24px;
}

/* 主信息区 */
.download-main {
  min-width: 0;
  flex: 1;
}

.download-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.download-task-title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-kind-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.04em;
}

.download-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
}

.status-badge-icon {
  font-size: 10px;
}

/* 状态色与呼吸点 */
.status-downloading {
  background: var(--brand-soft);
  color: var(--brand-primary);
}

.status-pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-primary);
  box-shadow: 0 0 0 0 rgba(16, 183, 104, 0.7);
  animation: status-pulse 1.8s infinite;
}

@keyframes status-pulse {
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(16, 183, 104, 0.7);
  }
  70% {
    transform: scale(1);
    box-shadow: 0 0 0 6px rgba(16, 183, 104, 0);
  }
  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(16, 183, 104, 0);
  }
}

.status-paused {
  background: rgba(245, 159, 0, 0.12);
  color: var(--warning);
}

.status-queued {
  background: rgba(47, 128, 237, 0.12);
  color: var(--info);
}

.status-completed {
  background: var(--brand-soft);
  color: var(--brand-primary);
}

.status-failed {
  background: rgba(240, 68, 68, 0.1);
  color: var(--danger);
}

.status-canceled {
  background: var(--surface-hover);
  color: var(--text-tertiary);
}

/* 元信息行 */
.download-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 5px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
}

.meta-version {
  padding: 0 5px;
  border-radius: 3px;
  background: var(--background-secondary);
  color: var(--text-secondary);
  font-size: 11px;
}

.meta-size {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-radius: 3px;
  background: var(--brand-soft);
  color: var(--brand-primary);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  flex-shrink: 0;
}

.meta-size-icon {
  font-size: 10px;
}

.meta-pkg {
  flex-shrink: 0;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-dot {
  opacity: 0.6;
}

.meta-filename {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 进度条与指标 */
.download-progress-section {
  margin-top: 8px;
}

.download-progress-track {
  height: 8px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--background-secondary);
}

.download-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--brand-primary);
  transition: width 200ms ease;
}

.fill-paused {
  background: var(--warning);
}

.fill-failed {
  background: var(--danger);
}

.download-progress-metrics {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: 5px;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.metrics-left,
.metrics-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.progress-size {
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
}

.progress-percent {
  color: var(--brand-primary);
  font-weight: var(--font-weight-semibold);
}

.speed-text {
  color: var(--brand-primary);
  font-weight: var(--font-weight-medium);
}

.eta-text {
  color: var(--text-tertiary);
}

/* 错误提示框 */
.download-error-box {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(240, 68, 68, 0.08);
  color: var(--danger);
  font-size: 12px;
}

/* 完成路径行 */
.download-completed-path {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-completed-path span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 操作按钮 */
.download-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

/* 列表过渡动效 */
.task-item-enter-active,
.task-item-leave-active {
  transition: all var(--duration-normal) var(--ease-default);
}

.task-item-enter-from,
.task-item-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* 响应式调整 */
@media (max-width: 900px) {
  .downloads-page {
    padding: var(--space-4);
  }

  .download-summary-row {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  .download-card {
    flex-wrap: wrap;
    min-width: 0;
  }

  /* 长包名与文件名单独占行，在卡片内断行，不能靠页面横向滚动查看。 */
  .download-meta { flex-wrap: wrap; }
  .meta-pkg, .meta-filename { flex: 1 1 100%; max-width: 100%; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
  .meta-dot { display: none; }
  .download-title-row { flex-wrap: wrap; }
  .download-task-title { flex: 1 1 100%; white-space: normal; overflow-wrap: anywhere; }
  .download-progress-metrics, .metrics-left, .metrics-right { flex-wrap: wrap; min-width: 0; overflow-wrap: anywhere; }

  .downloads-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .toolbar-tab-groups {
    width: 100%;
    flex-wrap: wrap;
    gap: 8px;
  }

  .toolbar-tab-groups .segmented-control {
    max-width: 100%;
    flex-wrap: wrap;
  }

  .segmented-tab {
    padding: 6px 10px;
    white-space: nowrap;
  }

  .download-actions {
    width: 100%;
    justify-content: flex-start;
    /* 放大字体时允许按钮换行，避免缩进与按钮共同撑宽任务卡片。 */
    padding-left: 0;
    flex-wrap: wrap;
    margin-top: var(--space-2);
  }
}

/* 手机卡片把元信息和进度放到完整行，长包名不挤占应用标题旁边的狭窄空间。 */
@media (max-width: 600px) {
  .downloads-page { padding: 12px 16px 24px; }

  /* 顶栏已有页面标题，手机仅保留辅助操作和可供读屏识别的标题。 */
  .downloads-header { margin-bottom: 16px; justify-content: flex-end; }
  .header-main { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .header-actions { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .header-actions :deep(.app-button) { min-height: 36px; justify-content: center; }

  /* 三项统计合成一张摘要卡，数值允许换行以兼容系统大字体。 */
  .download-summary-row { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; padding: 16px 0; margin-bottom: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
  .summary-card { min-width: 0; padding: 0 10px; border: 0; border-radius: 0; background: transparent; box-shadow: none; align-items: flex-start; }
  .summary-card + .summary-card { border-left: 1px solid var(--border); }
  .summary-icon-wrap, .summary-hint, .summary-label-extra { display: none; }
  .summary-top { flex-wrap: wrap; gap: 4px; }
  .summary-label { font-size: 12px; line-height: 1.5; }
  .summary-value-wrap { margin-top: 6px; }
  .summary-value { font-size: 20px; line-height: 1.25; white-space: normal; overflow-wrap: anywhere; }
  .speed-badge { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }

  /* 窄屏使用轻量状态按钮，方便切换当前任务和下载历史。 */
  .downloads-toolbar { gap: 10px; margin-bottom: 16px; }
  .toolbar-tab-groups { flex-direction: column; align-items: stretch; gap: 12px; }
  .status-tabs { display: flex; padding: 0; gap: 8px; border: 0; background: transparent; }
  .status-tabs .segmented-tab { min-height: 36px; padding: 6px 10px; border-radius: 8px; font-size: 13px; }
  .status-tabs .segmented-tab > i { display: none; }
  .status-tabs .segmented-tab.active { background: var(--brand-soft); box-shadow: none; }
  .toolbar-batch-actions:empty { display: none; }
  .toolbar-batch-actions { flex-wrap: wrap; }

  /* 空状态在筛选下方自然排布，发现入口紧跟说明，不再分散在页面底部。 */
  .downloads-empty { padding: 28px 8px 32px; border: 1px dashed var(--border); border-radius: 12px; }
  .downloads-empty :deep(.empty-state) { padding: 0; }
  .downloads-empty :deep(.empty-icon) { font-size: 32px; margin-bottom: 16px; }
  .downloads-empty :deep(.empty-title) { font-size: 16px; line-height: 1.5; }
  .downloads-empty :deep(.empty-desc) { font-size: 13px; line-height: 1.7; max-width: 260px; }
  .downloads-empty > .empty-action { margin-top: 20px; }

  .download-card { display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: start; column-gap: 12px; }
  .download-icon-wrap { width: 48px; height: 48px; grid-column: 1; grid-row: 1; }
  .download-main { display: contents; }
  .download-title-row { grid-column: 2; grid-row: 1; }
  .download-meta, .download-progress-section, .download-error-box, .download-completed-path, .download-actions { grid-column: 1 / -1; }
}
</style>
