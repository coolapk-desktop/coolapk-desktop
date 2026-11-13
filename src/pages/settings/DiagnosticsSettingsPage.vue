<template>
  <div class="settings-section">
    <h3 class="section-title">诊断日志</h3>

    <div class="info-banner">
      <i class="fas fa-shield-halved" aria-hidden="true"></i>
      <span>日志保存在本机，仅在你主动复制、导出或手动附加到 GitHub Issue 时离开应用。每个文件最多 2 MB，最多保留 5 个日志文件（含当前文件）。</span>
    </div>

    <div class="setting-group">
      <h4 class="group-title">本机日志</h4>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">详细调试日志</span>
          <span class="row-sub">本次运行记录详细调试信息，便于定位接口请求、页面状态或性能问题</span>
        </div>
        <AppSwitch :model-value="verbose" @update:model-value="onVerboseChange" />
      </div>

      <div class="toolbar">
        <AppButton variant="secondary" size="sm" icon="fas fa-rotate-right" :loading="loading" :disabled="savingLogs" @click="loadLogs">刷新</AppButton>
        <AppButton variant="secondary" size="sm" icon="fas fa-copy" :disabled="loading || savingLogs" @click="copyLogs">复制全部日志</AppButton>
        <AppButton variant="secondary" size="sm" icon="fas fa-file-export" :disabled="loading || savingLogs" @click="exportLogs">导出全部日志</AppButton>
        <AppButton variant="danger" size="sm" icon="fas fa-trash-can" :disabled="loading || savingLogs || snapshot.files.length === 0" @click="clearLogs">清空日志</AppButton>
      </div>

      <div class="filters">
        <select v-model="level" aria-label="日志级别" class="select-control filter-level">
          <option value="all">全部级别</option>
          <option value="error">错误</option>
          <option value="warn">警告</option>
          <option value="info">信息</option>
        </select>
        <input v-model="keyword" class="text-input filter-search" type="search" placeholder="搜索日志内容" aria-label="搜索日志内容" />
        <div v-if="canShowAll" class="show-all-toggle">
          <span class="toggle-label">显示全部行</span>
          <AppSwitch :model-value="showAll" @update:model-value="toggleShowAll" />
        </div>
      </div>

      <p v-if="error" class="extract-tip error-tip" role="alert">
        <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
        <span>{{ error }}</span>
      </p>

      <div class="setting-card">
        <div class="card-header">
          <span class="card-key">日志输出</span>
          <span class="meta lines-summary">{{ snapshot.files.length }} 个文件 · {{ linesSummary }}</span>
        </div>
        <pre class="log-content custom-scrollbar">{{ visibleLines.length ? visibleLines.join('\n') : '暂无日志' }}</pre>
        <div class="path-row">
          <span class="path-label">日志目录</span>
          <code class="mono-pill">{{ snapshot.directory || '正在获取…' }}</code>
        </div>
      </div>
    </div>

    <section class="setting-group report-reader">
      <h4 class="group-title">读取日志附件</h4>
      <p class="tray-tip">
        <i class="fas fa-info-circle" aria-hidden="true"></i>
        <span>可读取旧版客户端生成的诊断日志附件：粘贴反馈私信中的图片或 ZIP 链接，或选择保存的 PNG 原图、ZIP 文件。请勿使用聊天缩略图或截图。</span>
      </p>

      <div class="toolbar">
        <input v-model="reportUrl" type="url" class="text-input report-url-input" placeholder="https://image.coolapk.com/feed/…png 或 …zip" aria-label="日志附件地址" />
        <div class="report-actions">
          <AppButton variant="secondary" size="sm" icon="fas fa-link" :loading="readingReport" :disabled="!reportUrl.trim() || readingReport" @click="readReportUrl">读取链接</AppButton>
          <label class="report-file-button" :class="{ 'is-disabled': readingReport }">
            <i class="fas fa-paperclip" aria-hidden="true"></i>
            <span>选择附件</span>
            <input type="file" accept="image/png,application/zip,.png,.zip" :disabled="readingReport" @change="readReportFile" />
          </label>
        </div>
      </div>

      <p v-if="reportError" class="extract-tip error-tip" role="alert">
        <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
        <span>{{ reportError }}</span>
      </p>

      <div v-if="report" class="setting-card">
        <div class="card-header">
          <span class="meta">v{{ report.version }} · {{ report.platform }} · {{ formatDiagnosticTime(report.createdAt) }}</span>
          <span class="badge-on">附件校验通过</span>
        </div>
        <pre class="log-content custom-scrollbar">{{ report.log }}</pre>
        <div class="toolbar card-actions">
          <AppButton variant="secondary" size="sm" icon="fas fa-copy" @click="copyReport">复制报告日志</AppButton>
          <AppButton variant="secondary" size="sm" icon="fas fa-file-export" @click="exportReport">导出报告日志</AppButton>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { CoolapkTauriAPI } from '../../api/coolapk';
import AppButton from '../../components/common/AppButton.vue';
import AppSwitch from '../../components/common/AppSwitch.vue';
import { requestConfirmation } from '../../utils/confirm';
import { showToast } from '../../utils/toast';
import { getVerboseDiagnosticLogging, setVerboseDiagnosticLogging } from '../../utils/diagnosticLogger';
import { readDiagnosticImageUrl } from '../../utils/feedbackDiagnostics';
import { MAX_DIAGNOSTIC_IMAGE_BYTES, unpackDiagnosticImage, formatDiagnosticTime, type DiagnosticReport } from '../../utils/diagnosticImage';

const props = withDefaults(defineProps<{ reportUrl?: string }>(), { reportUrl: '' });
const reportUrl = ref(props.reportUrl);
const readingReport = ref(false);
const reportError = ref('');
const report = ref<DiagnosticReport | null>(null);

async function readReport(loader: () => Promise<DiagnosticReport>) {
  if (readingReport.value) return;
  readingReport.value = true;
  report.value = null;
  reportError.value = '';
  try { report.value = await loader(); }
  catch (cause) { reportError.value = `读取日志附件失败：${String(cause)}`; }
  finally { readingReport.value = false; }
}

function readReportUrl() {
  return readReport(() => readDiagnosticImageUrl(reportUrl.value));
}

async function readReportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await readReport(async () => {
    if (file.size > MAX_DIAGNOSTIC_IMAGE_BYTES) throw new Error('日志附件超过 2 MB');
    return unpackDiagnosticImage(new Uint8Array(await file.arrayBuffer()));
  });
  input.value = '';
}

async function copyReport() {
  if (!report.value) return;
  try { await copyText(report.value.log); showToast('报告日志已复制'); }
  catch (cause) { showToast(`复制失败：${String(cause)}`, 'error'); }
}

async function exportReport() {
  if (!report.value) return;
  const content = report.value.log;
  try {
    if (/android/i.test(navigator.userAgent)) {
      await CoolapkTauriAPI.exportJsonFile('coolapk-feedback-diagnostics.txt', content);
      showToast('报告日志已导出');
      return;
    }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: 'coolapk-feedback-diagnostics.txt', filters: [{ name: '文本日志', extensions: ['txt'] }] });
    if (path) { await writeTextFile(path, content); showToast('报告日志已导出'); }
  } catch (cause) { showToast(`导出失败：${String(cause)}，也可以复制报告日志`, 'error'); }
}

interface DiagnosticSnapshot {
  files: Array<{ name: string; size: number; modifiedAt: number }>;
  content: string;
  directory: string;
  truncated?: boolean;
  lineLimit?: number | null;
}

const snapshot = ref<DiagnosticSnapshot>({ files: [], content: '', directory: '' });
/** 「显示全部行」时按需加载的完整日志；null 表示尚未加载。 */
const fullContent = ref<string | null>(null);
const loading = ref(false);
const savingLogs = ref(false);
const error = ref('');
const level = ref('all');
const keyword = ref('');
const verbose = ref(false);
/** 展示最多只渲染最近 1000 行；复制与导出始终使用完整日志，避免卡住 UI。 */
const VIEW_LINE_LIMIT = 1000;
const showAll = ref(false);

/** 当前用于展示与筛选的日志内容：显示全部且完整日志已加载时用完整日志，否则用快照（后端已按行截取）。 */
const displayContent = computed(() => (showAll.value && fullContent.value !== null) ? fullContent.value : snapshot.value.content);

/** 按级别/关键词过滤后的展示行（不做行数截断）。 */
const filteredLines = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return displayContent.value.split('\n').filter((line) => {
    if (level.value !== 'all' && !line.toLowerCase().includes(`[${level.value}]`)) return false;
    return !query || line.toLowerCase().includes(query);
  });
});

/** 后端已按行截取（truncated）或筛选后超过展示上限时，需要「显示全部」开关。 */
const canShowAll = computed(() => !!snapshot.value.truncated || filteredLines.value.length > VIEW_LINE_LIMIT);

const visibleLines = computed(() => showAll.value ? filteredLines.value : filteredLines.value.slice(-VIEW_LINE_LIMIT));

/** 明确区分「屏幕显示的行」与「复制/导出内容」，两者不一致时必须标注。 */
const linesSummary = computed(() => {
  const total = filteredLines.value.length;
  if (showAll.value && fullContent.value !== null) return `已显示全部 ${total} 行（筛选后）`;
  if (snapshot.value.truncated) {
    return `仅显示最近 ${snapshot.value.lineLimit ?? VIEW_LINE_LIMIT} 行（复制/导出仍包含全部日志）`;
  }
  if (total <= VIEW_LINE_LIMIT) return `${total} 行结果`;
  if (showAll.value) return `已显示全部 ${total} 行（筛选后）`;
  return `仅显示最近 ${VIEW_LINE_LIMIT} 行（共 ${total} 行；复制/导出仍包含全部日志）`;
});

async function readLatestLogs(): Promise<string> {
  const latest = await invoke<DiagnosticSnapshot>('get_diagnostic_logs');
  snapshot.value = latest;
  fullContent.value = null;
  return latest.content;
}

/** 页面展示走 Rust 侧按行截取的尾部快照，不再前端拉全量后裁剪。 */
async function loadLogs() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  showAll.value = false;
  fullContent.value = null;
  try {
    snapshot.value = await invoke<DiagnosticSnapshot>('get_diagnostic_logs_tail', { lines: VIEW_LINE_LIMIT });
  } catch (cause) {
    error.value = `读取日志失败：${String(cause)}`;
  } finally {
    loading.value = false;
  }
}

/** 勾选「显示全部行」且当前快照是后端截取的尾部时，按需加载完整日志。 */
async function onShowAllChange(checked: boolean) {
  if (!checked || !snapshot.value.truncated || fullContent.value !== null) return;
  try {
    fullContent.value = (await invoke<DiagnosticSnapshot>('get_diagnostic_logs')).content;
  } catch (cause) {
    showAll.value = false;
    showToast(`读取完整日志失败：${String(cause)}`, 'error');
  }
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('当前平台无法复制到剪贴板');
}

async function copyLogs() {
  if (loading.value || savingLogs.value) return;
  savingLogs.value = true;
  try {
    await copyText(await readLatestLogs());
    showToast('日志已复制');
  } catch (cause) {
    showToast(`复制日志失败：${String(cause)}`, 'error');
  } finally {
    savingLogs.value = false;
  }
}

async function exportLogs() {
  if (loading.value || savingLogs.value) return;
  savingLogs.value = true;
  try {
    const content = await readLatestLogs();
    if (!content) { showToast('暂无日志'); return; }
    if (/android/i.test(navigator.userAgent)) {
      const path = await CoolapkTauriAPI.exportJsonFile('coolapk-diagnostics.txt', content);
      showToast(`日志已保存：${path}`, 'success', 5000);
      return;
    }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: 'coolapk-diagnostics.txt',
      filters: [{ name: '文本日志', extensions: ['txt'] }],
    });
    if (!path) return;
    await writeTextFile(path, content);
    showToast(`日志已保存：${path}`, 'success', 5000);
  } catch (cause) {
    showToast(`导出日志失败：${String(cause)}`, 'error');
  } finally {
    savingLogs.value = false;
  }
}

async function clearLogs() {
  const confirmed = await requestConfirmation({
    title: '清空诊断日志',
    message: '确定清空本机保存的诊断日志吗？',
    confirmText: '清空',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await invoke('clear_diagnostic_logs');
    await loadLogs();
    showToast('日志已清空');
  } catch (cause) {
    showToast(`清空日志失败：${String(cause)}`, 'error');
  }
}

async function onVerboseChange(checked: boolean) {
  const previous = verbose.value;
  verbose.value = checked;
  try {
    await setVerboseDiagnosticLogging(checked);
  } catch (cause) {
    verbose.value = previous;
    showToast(`切换详细日志失败：${String(cause)}`, 'error');
  }
}

function toggleShowAll(checked: boolean) {
  showAll.value = checked;
  void onShowAllChange(checked);
}

onMounted(() => {
  void loadLogs();
  if (props.reportUrl) void readReportUrl();
  void getVerboseDiagnosticLogging().then((value) => { verbose.value = value; });
});
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
  container-name: diagnostics-settings;
}

.section-title {
  margin: 0;
  font-size: var(--font-size-title-md);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
  padding-bottom: var(--space-3);
}

.info-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  background: var(--background);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  line-height: 1.6;
  min-width: 0;
  overflow-wrap: anywhere;
}

.info-banner i {
  margin-top: 3px;
  color: var(--brand-primary);
  flex-shrink: 0;
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

.toolbar,
.filters,
.report-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.select-control,
.text-input {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  outline: none;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.select-control {
  cursor: pointer;
}

.filter-level {
  flex: 0 0 auto;
  min-width: 120px;
}

.filter-search,
.report-url-input {
  flex: 1 1 200px;
}

.select-control:hover,
.select-control:focus,
.text-input:hover,
.text-input:focus {
  border-color: var(--brand-primary);
}

.show-all-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  white-space: nowrap;
}

.setting-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  min-width: 0;
  max-width: 100%;
}

.card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.card-key {
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  color: var(--text-tertiary);
}

.meta {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  overflow-wrap: anywhere;
}

.log-content {
  min-height: 240px;
  max-height: 55vh;
  overflow: auto;
  margin: 0;
  padding: var(--space-3);
  background-color: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-control);
  color: var(--text-primary);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: var(--font-size-caption);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.path-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.path-label {
  color: var(--text-tertiary);
  font-size: var(--font-size-caption);
  flex-shrink: 0;
}

.mono-pill {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  background-color: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-control);
  padding: 2px 8px;
  max-width: 100%;
  min-width: 0;
  word-break: break-all;
}

.badge-on {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: var(--radius-control);
  background-color: var(--brand-soft);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--brand-primary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
}

.extract-tip {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  font-size: var(--font-size-caption);
  line-height: 1.5;
  min-width: 0;
  overflow-wrap: anywhere;
}

.extract-tip i {
  margin-top: 2px;
  flex-shrink: 0;
}

.error-tip {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: var(--danger);
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

.report-reader {
  border-top: 1px solid var(--border-light);
  padding-top: var(--space-4);
}

.report-file-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background-color: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-fast) var(--ease-default);
}

.report-file-button:hover {
  background-color: var(--surface-hover);
  border-color: var(--text-tertiary);
}

.report-file-button.is-disabled {
  opacity: 0.6;
  pointer-events: none;
}

.report-file-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}

.card-actions {
  justify-content: flex-end;
}

@media (max-width: 600px) {
  .filter-level,
  .filter-search,
  .report-url-input {
    flex: 1 1 100%;
    width: 100%;
  }

  .card-actions {
    justify-content: flex-start;
  }
}

@container diagnostics-settings (max-width: 560px) {
  .filter-level,
  .filter-search,
  .report-url-input {
    flex: 1 1 100%;
    width: 100%;
  }

  .card-actions {
    justify-content: flex-start;
  }
}
</style>
