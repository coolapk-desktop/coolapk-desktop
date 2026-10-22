<template>
  <div class="settings-section">
    <h3 class="section-title">诊断日志</h3>
    <p class="description">日志保存在本机，仅在你主动复制、导出或手动附加到 GitHub Issue 时离开应用。每个文件最多 2 MB，最多保留 4 个旧文件。</p>

    <div class="toolbar">
      <AppButton variant="secondary" size="sm" :loading="loading" :disabled="savingLogs" @click="loadLogs">刷新</AppButton>
      <AppButton variant="secondary" size="sm" :disabled="loading || savingLogs" @click="copyLogs">复制日志</AppButton>
      <AppButton variant="secondary" size="sm" :disabled="loading || savingLogs" @click="exportLogs">导出日志</AppButton>
      <AppButton variant="danger" size="sm" :disabled="loading || savingLogs || snapshot.files.length === 0" @click="clearLogs">清空日志</AppButton>
    </div>
    <label class="verbose-toggle"><input v-model="verbose" type="checkbox" @change="changeVerbose" /> 本次运行记录详细调试信息</label>

    <div class="filters">
      <select v-model="level" aria-label="日志级别" class="control">
        <option value="all">全部级别</option>
        <option value="error">错误</option>
        <option value="warn">警告</option>
        <option value="info">信息</option>
      </select>
      <input v-model="keyword" class="control search" type="search" placeholder="搜索日志内容" aria-label="搜索日志内容" />
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>
    <p class="meta">{{ snapshot.files.length }} 个文件 · {{ visibleLines.length }} 行结果</p>
    <pre class="log-content custom-scrollbar">{{ visibleLines.length ? visibleLines.join('\n') : '暂无日志' }}</pre>
    <p class="path">日志目录：{{ snapshot.directory || '正在获取…' }}</p>
    <section class="report-reader">
      <h4>读取日志附件</h4>
      <p class="description">可读取旧版客户端生成的诊断日志附件：粘贴反馈私信中的图片或 ZIP 链接，或选择保存的 PNG 原图、ZIP 文件。请勿使用聊天缩略图或截图。</p>
      <div class="toolbar">
        <input v-model="reportUrl" type="url" class="control search" placeholder="https://image.coolapk.com/feed/…png 或 …zip" aria-label="日志附件地址" />
        <AppButton variant="secondary" size="sm" :loading="readingReport" :disabled="!reportUrl.trim() || readingReport" @click="readReportUrl">读取链接</AppButton>
        <label class="control report-file-button">选择附件<input type="file" accept="image/png,application/zip,.png,.zip" :disabled="readingReport" @change="readReportFile" /></label>
      </div>
      <p v-if="reportError" class="error-text" role="alert">{{ reportError }}</p>
      <template v-if="report">
        <p class="meta">v{{ report.version }} · {{ report.platform }} · {{ formatDiagnosticTime(report.createdAt) }} · 附件校验通过</p>
        <div class="toolbar">
          <AppButton variant="secondary" size="sm" @click="copyReport">复制报告日志</AppButton>
          <AppButton variant="secondary" size="sm" @click="exportReport">导出报告日志</AppButton>
        </div>
        <pre class="log-content">{{ report.log }}</pre>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { CoolapkTauriAPI } from '../../api/coolapk';
import AppButton from '../../components/common/AppButton.vue';
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
}

const snapshot = ref<DiagnosticSnapshot>({ files: [], content: '', directory: '' });
const loading = ref(false);
const savingLogs = ref(false);
const error = ref('');
const level = ref('all');
const keyword = ref('');
const verbose = ref(false);

const visibleLines = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return snapshot.value.content.split('\n').filter((line) => {
    if (level.value !== 'all' && !line.toLowerCase().includes(`[${level.value}]`)) return false;
    return !query || line.toLowerCase().includes(query);
  }).slice(-1000);
});

async function readLatestLogs(): Promise<string> {
  const latest = await invoke<DiagnosticSnapshot>('get_diagnostic_logs');
  snapshot.value = latest;
  return latest.content;
}

async function loadLogs() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    await readLatestLogs();
  } catch (cause) {
    error.value = `读取日志失败：${String(cause)}`;
  } finally {
    loading.value = false;
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

async function changeVerbose() {
  try {
    await setVerboseDiagnosticLogging(verbose.value);
  } catch (cause) {
    verbose.value = !verbose.value;
    showToast(`切换详细日志失败：${String(cause)}`, 'error');
  }
}

onMounted(() => {
  void loadLogs();
  if (props.reportUrl) void readReportUrl();
  void getVerboseDiagnosticLogging().then((value) => { verbose.value = value; });
});
</script>

<style scoped>
.settings-section { max-width: 900px; display: flex; flex-direction: column; gap: 14px; }
.section-title { margin: 0; color: var(--text-primary); }
.description, .meta, .path { margin: 0; color: var(--text-secondary); font-size: 13px; }
.toolbar, .filters { display: flex; flex-wrap: wrap; gap: 8px; }
.verbose-toggle { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; }
.control { min-height: 34px; padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); color: var(--text-primary); }
.search { flex: 1; min-width: 170px; }
.log-content { min-height: 280px; max-height: 60vh; overflow: auto; margin: 0; padding: 14px; background: var(--surface-hover); border: 1px solid var(--border); border-radius: var(--radius-control); color: var(--text-primary); font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.error-text { color: var(--danger); margin: 0; }
.path { overflow-wrap: anywhere; }
.report-reader { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border); padding-top: 16px; }
.report-reader h4 { margin: 0; color: var(--text-primary); }
.report-file-button { display: inline-flex; align-items: center; position: relative; cursor: pointer; }
.report-file-button input { position: absolute; inset: 0; opacity: 0; width: 100%; cursor: pointer; }
</style>
