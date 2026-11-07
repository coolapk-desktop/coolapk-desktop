import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { CoolapkTauriAPI } from '../api/coolapk';
import { showToast } from '../utils/toast';
import { desktopNotify } from '../utils/desktopNotify';
import { useSettingsStore } from './settings';
import type { DownloadStatus, DownloadTask } from '../types/download';

const STORAGE_KEY = 'coolapk_desktop_downloads_v1';
const ACTIVE_STATUSES: DownloadStatus[] = ['queued', 'downloading', 'paused'];
// 进度类字段更新极其频繁（每个进度事件一次），单独节流写盘；状态/路径/错误必须立即落盘。
const PROGRESS_KEYS = new Set(['downloaded', 'total', 'speed']);
const PERSIST_THROTTLE_MS = 600;
// 完成/失败提示的合并窗口：同一批结束的任务只汇总一条提示，避免多任务同时完成时刷屏。
const NOTICE_BATCH_MS = 900;

export interface EnqueueResult {
  task: DownloadTask;
  /** 是否复用了同应用同版本的已有任务 */
  reused: boolean;
  /** 复用失败/暂停任务时是否真的重新排队（调用方据此给出准确文案） */
  resumed: boolean;
  /** 复用时任务的原始状态 */
  previousStatus: DownloadStatus | null;
}

type NativeDownloadEvent = {
  taskId?: string;
  status?: string;
  downloaded?: number;
  total?: number;
  speed?: number;
  path?: string;
  partialPath?: string;
  publicPath?: string;
  error?: string;
};

function now() {
  return Date.now();
}

function createTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `download-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readTasks(): DownloadTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is DownloadTask => item && typeof item.id === 'string' && typeof item.packageName === 'string')
      .map((item) => ({
        ...item,
        downloadDir: typeof item.downloadDir === 'string' ? item.downloadDir : '',
        targetPath: typeof item.targetPath === 'string' ? item.targetPath : '',
        partialPath: typeof item.partialPath === 'string' ? item.partialPath : '',
        publicPath: typeof item.publicPath === 'string' ? item.publicPath : '',
        status: ACTIVE_STATUSES.includes(item.status) ? 'paused' : item.status,
        downloaded: Number(item.downloaded) || 0,
        total: Number(item.total) || 0,
        speed: 0,
        retryCount: Number(item.retryCount) || 0,
        error: typeof item.error === 'string' ? item.error : '',
      }));
  } catch {
    return [];
  }
}

function writeTasks(tasks: DownloadTask[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (error) {
    console.warn('保存下载历史失败:', error);
  }
}

function normalizeStatus(value: string | undefined): DownloadStatus | null {
  if (value === 'starting' || value === 'downloading') return 'downloading';
  if (value === 'paused') return 'paused';
  if (value === 'completed') return 'completed';
  if (value === 'canceled') return 'canceled';
  if (value === 'failed') return 'failed';
  return null;
}

function extensionFor(options: { fileName?: string; kind?: string }) {
  const source = options.fileName || '';
  const matched = source.match(/\.(apk|xapk|apks)$/i);
  if (matched) return matched[1].toLowerCase();
  return options.kind === 'xapk' || options.kind === 'apks' ? options.kind : 'apk';
}

function buildFileName(options: {
  title: string;
  packageName: string;
  versionName?: string;
  versionCode?: string | number;
  apkId?: string | number;
  fileName?: string;
  kind?: string;
}) {
  if (options.fileName?.trim()) return options.fileName.trim();
  const title = options.title.trim() || options.packageName;
  const version = options.versionName?.trim() || '未知版本';
  const versionCode = String(options.versionCode ?? '').trim() || '0';
  const apkId = String(options.apkId ?? '').trim() || 'unknown';
  return `${title}-${version}-${versionCode}-${apkId}.${extensionFor(options)}`;
}

export const useDownloadStore = defineStore('downloads', () => {
  const tasks = ref<DownloadTask[]>(readTasks());
  const runningIds = new Set<string>();
  let initialized = false;
  let eventUnlisten: UnlistenFn | null = null;
  let saveErrorUnlisten: UnlistenFn | null = null;
  let pumpQueued = false;
  // 批量暂停闸门：置位期间 pump() 直接返回，避免暂停循环把排队任务提升为下载中。
  const pausedAll = ref(false);
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const completedNotices = new Map<string, DownloadTask>();
  const failedNotices = new Map<string, DownloadTask>();
  const notifiedNoticeKeys = new Set<string>();
  let persistFlushBound = false;

  const activeTasks = computed(() => tasks.value.filter((task) => ACTIVE_STATUSES.includes(task.status)));
  const historyTasks = computed(() => tasks.value.filter((task) => !ACTIVE_STATUSES.includes(task.status)));
  const activeCount = computed(() => activeTasks.value.length);
  const totalSpeed = computed(() => {
    return activeTasks.value.reduce((acc, task) => {
      return task.status === 'downloading' && task.speed > 0 ? acc + task.speed : acc;
    }, 0);
  });
  const completedTotalBytes = computed(() => {
    return tasks.value.reduce((acc, task) => {
      return task.status === 'completed' ? acc + (task.total || task.downloaded || 0) : acc;
    }, 0);
  });

  function persist() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    writeTasks(tasks.value);
  }

  /** 把节流中的进度改动立即落盘，窗口隐藏或卸载时调用，避免丢失最新进度。 */
  function flushPersist() {
    if (!persistTimer) return;
    clearTimeout(persistTimer);
    persistTimer = null;
    writeTasks(tasks.value);
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writeTasks(tasks.value);
    }, PERSIST_THROTTLE_MS);
  }

  function findTask(taskId: string) {
    return tasks.value.find((task) => task.id === taskId);
  }

  function patchTask(taskId: string, patch: Partial<DownloadTask>) {
    const task = findTask(taskId);
    if (!task) return;
    const previousStatus = task.status;
    Object.assign(task, patch, { updatedAt: now() });
    const statusChanged = patch.status !== undefined && patch.status !== previousStatus;
    const progressOnly = Object.keys(patch).every((key) => PROGRESS_KEYS.has(key) || key === 'status');
    // 只有「状态没变、仅进度变化」的事件才节流；其余（状态切换/错误/路径）立即持久化。
    if (!statusChanged && progressOnly) schedulePersist();
    else persist();
  }

  function applyNativeEvent(event: NativeDownloadEvent) {
    if (!event.taskId) return;
    const task = findTask(event.taskId);
    if (!task) return;
    const status = normalizeStatus(event.status);
    const patch: Partial<DownloadTask> = {};
    if (status) patch.status = status;
    if (typeof event.downloaded === 'number' && Number.isFinite(event.downloaded)) patch.downloaded = Math.max(0, event.downloaded);
    if (typeof event.total === 'number' && Number.isFinite(event.total) && event.total > 0) patch.total = event.total;
    if (typeof event.speed === 'number' && Number.isFinite(event.speed)) patch.speed = Math.max(0, event.speed);
    if (status === 'paused') patch.speed = 0;
    if (event.path) patch.targetPath = event.path;
    if (event.partialPath) patch.partialPath = event.partialPath;
    if (event.publicPath) patch.publicPath = event.publicPath;
    if (event.error) patch.error = event.error;
    if (status === 'completed') {
      patch.completedAt = now();
      patch.error = '';
      patch.speed = 0;
    }
    if (status === 'failed') {
      patch.error = event.error || task.error || '下载失败';
      patch.speed = 0;
    }
    // 取消后安装包已不完整，进度必须归零，否则「重试/继续」会显示虚假的旧进度。
    if (status === 'canceled') {
      patch.downloaded = 0;
      patch.speed = 0;
    }
    patchTask(event.taskId, patch);
    if (status === 'completed' || status === 'failed') queueFinishNotice(event.taskId, status);
    if (status === 'completed' || status === 'failed' || status === 'paused' || status === 'canceled') void pump();
  }

  function bindPersistFlushHandlers() {
    if (persistFlushBound || typeof document === 'undefined') return;
    persistFlushBound = true;
    // 窗口隐藏或页面卸载时补写一次，防止节流窗口内的最新进度丢失。
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPersist();
    });
    window.addEventListener('pagehide', () => flushPersist());
  }

  function truncateNoticeText(text: string, max = 48) {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  /**
   * 把完成/失败任务放进合并窗口，窗口结束时统一提示一次。
   * 同一任务同一结果只提示一次，多任务同时结束时汇总成一条，避免刷屏。
   */
  function queueFinishNotice(taskId: string, kind: 'completed' | 'failed') {
    const task = findTask(taskId);
    if (!task) return;
    const key = `${taskId}:${kind}:${task.completedAt || task.updatedAt}`;
    if (notifiedNoticeKeys.has(key)) return;
    // 去重集合不会无限增长：超过阈值时整体清空，最坏只是一次重复提示。
    if (notifiedNoticeKeys.size > 200) notifiedNoticeKeys.clear();
    notifiedNoticeKeys.add(key);
    if (kind === 'completed') {
      failedNotices.delete(taskId);
      completedNotices.set(taskId, task);
    } else {
      completedNotices.delete(taskId);
      failedNotices.set(taskId, task);
    }
    if (noticeTimer) return;
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      flushFinishNotices();
    }, NOTICE_BATCH_MS);
  }

  function flushFinishNotices() {
    const completed = [...completedNotices.values()];
    const failed = [...failedNotices.values()];
    completedNotices.clear();
    failedNotices.clear();
    if (completed.length === 0 && failed.length === 0) return;
    const settings = useSettingsStore().settings;
    // 未开启下载完成提醒时完全不打扰用户；更新包的提示由 App.vue 单独负责。
    if (!settings.notifyDownloadComplete) return;
    const parts: string[] = [];
    if (completed.length === 1) parts.push(`「${completed[0].title}」下载完成`);
    else if (completed.length > 1) parts.push(`${completed.length} 个任务已下载完成`);
    if (failed.length === 1) {
      parts.push(`「${failed[0].title}」下载失败${failed[0].error ? `：${truncateNoticeText(failed[0].error)}` : ''}`);
    } else if (failed.length > 1) {
      parts.push(`${failed.length} 个任务下载失败`);
    }
    const message = parts.join('；');
    const hasFailure = failed.length > 0;
    if (settings.desktopNotifications) {
      // 已开启系统桌面通知时走系统气泡，不再重复弹应用内提示。
      void desktopNotify(
        {
          title: hasFailure ? (completed.length > 0 ? '下载完成 / 下载失败' : '下载失败') : '下载完成',
          body: message,
        },
        settings.notificationSound,
      );
      return;
    }
    showToast(message, hasFailure ? 'error' : 'success', 4000, {
      label: '打开下载中心',
      // 懒加载路由，避免 store 在单元测试里拉起整个应用路由表。
      onClick: () => { void import('../router').then(({ router }) => router.push('/downloads')); },
    });
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    bindPersistFlushHandlers();
    if (/android/i.test(navigator.userAgent)) {
      saveErrorUnlisten = await listen<string>('android-file-save-error', (event) => {
        showToast(`安装包已下载到应用目录，保存到公共目录失败：${event.payload}`, 'error', 6000);
      });
    }
    // 应用重启后原生下载通道已经不存在，恢复成暂停状态，保留 .part 文件供继续下载。
    for (const task of tasks.value) {
      if (ACTIVE_STATUSES.includes(task.status)) task.status = 'paused';
      // 前端无法直接探测 .part 是否还在（fs 插件未授予 exists 权限，见 batch6 报告）；
      // 有进度却没有断点路径，说明断点大概率已随换设备/清目录丢失，给出保守提示，
      // 不清空进度数字，用户可用「重新开始」自行决定重下。
      if (task.status === 'paused' && task.downloaded > 0 && !task.partialPath && !task.error) {
        task.error = '断点文件可能已失效，可重新开始';
      }
    }
    persist();
    try {
      eventUnlisten = await listen<NativeDownloadEvent>('apk-download-progress', (event) => applyNativeEvent(event.payload));
    } catch (error) {
      console.warn('监听下载进度失败:', error);
    }
  }

  async function pump() {
    // 批量暂停期间不允许提升排队任务，否则「全部暂停」只暂停了一个快照。
    if (pausedAll.value) return;
    if (pumpQueued) return;
    pumpQueued = true;
    await Promise.resolve();
    pumpQueued = false;
    const settingsStore = useSettingsStore();
    const limit = [1, 2, 3, 4, 5, 6, 8].includes(settingsStore.settings.maxConcurrentDownloads)
      ? settingsStore.settings.maxConcurrentDownloads
      : 3;
    while (runningIds.size < limit) {
      const task = tasks.value.find((item) => item.status === 'queued' && !runningIds.has(item.id));
      if (!task) break;
      runningIds.add(task.id);
      patchTask(task.id, { status: 'downloading', error: '' });
      void runTask(task).finally(() => {
        runningIds.delete(task.id);
        void pump();
      });
    }
  }

  async function runTask(task: DownloadTask) {
    const settingsStore = useSettingsStore();
    try {
      const result = await CoolapkTauriAPI.startApkDownload({
        taskId: task.id,
        packageName: task.packageName,
        apkName: task.packageName,
        apkId: task.apkId,
        versionCode: task.versionCode,
        fileName: task.fileName,
        dir: task.downloadDir,
        // 系统默认目录不保存操作系统专属的绝对路径，允许换平台后按文件名重新定位断点文件。
        targetPath: task.downloadDir ? task.targetPath : '',
        extraAnalysisData: task.extraAnalysisData,
      });
      const status = normalizeStatus(result?.status) || 'completed';
      // 原生返回 downloaded: 0 是有效值（例如刚从断点重新开始），不能用 || 吞掉。
      const downloaded = typeof result?.downloaded === 'number' && Number.isFinite(result.downloaded)
        ? Math.max(0, result.downloaded)
        : undefined;
      patchTask(task.id, {
        status,
        downloaded: downloaded ?? task.downloaded,
        total: Number(result?.total) || task.total,
        targetPath: result?.path || task.targetPath,
        partialPath: result?.partialPath || task.partialPath,
        publicPath: result?.publicPath || task.publicPath,
        completedAt: status === 'completed' ? now() : task.completedAt,
        error: '',
      });
    } catch (error) {
      patchTask(task.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        retryCount: task.retryCount + 1,
        speed: 0,
      });
    }
  }

  function enqueue(options: {
    title: string;
    packageName: string;
    versionName?: string;
    versionCode?: string | number;
    apkId?: string | number;
    logoUrl?: string;
    fileName?: string;
    kind?: 'apk' | 'xapk' | 'apks';
    extraAnalysisData?: string;
    total?: number;
  }): EnqueueResult {
    const versionName = options.versionName?.trim() || '';
    const existing = tasks.value.find((task) => task.packageName === options.packageName && task.versionName === versionName && task.status !== 'canceled');
    if (existing) {
      // 命中失败/暂停任务时必须真正重新排队，不能只把旧任务原样返回给调用方去谎报「已加入队列」。
      const previousStatus = existing.status;
      const resumed = previousStatus === 'failed' || previousStatus === 'paused';
      if (resumed) void resume(existing.id);
      return { task: existing, reused: true, resumed, previousStatus };
    }
    const createdAt = now();
    const kind = options.kind || 'apk';
    const task: DownloadTask = {
      id: createTaskId(),
      kind,
      title: options.title.trim() || options.packageName,
      packageName: options.packageName,
      versionName,
      versionCode: String(options.versionCode ?? ''),
      apkId: String(options.apkId ?? ''),
      logoUrl: options.logoUrl || '',
      fileName: buildFileName({ ...options, kind }),
      extraAnalysisData: options.extraAnalysisData || '',
      downloadDir: useSettingsStore().settings.downloadPath,
      targetPath: '',
      partialPath: '',
      status: 'queued',
      downloaded: 0,
      total: typeof options.total === 'number' && options.total > 0 ? options.total : 0,
      speed: 0,
      retryCount: 0,
      error: '',
      createdAt,
      updatedAt: createdAt,
      completedAt: 0,
    };
    tasks.value.unshift(task);
    persist();
    void pump();
    return { task, reused: false, resumed: false, previousStatus: null };
  }

  async function pause(taskId: string) {
    const task = findTask(taskId);
    if (!task) return;
    if (task.status === 'queued') {
      patchTask(taskId, { status: 'paused' });
      return;
    }
    if (task.status !== 'downloading') return;
    patchTask(taskId, { status: 'paused', speed: 0 });
    try {
      await CoolapkTauriAPI.pauseApkDownload(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = findTask(taskId);
      // 等待原生暂停期间，进度事件可能已把任务推进到完成/失败/取消；
      // 此时不能再硬拉回 downloading，否则会造出「下载中但无速度、无人调度」的假状态。
      if (!current || current.status !== 'paused') return;
      if (pausedAll.value) {
        // 批量暂停闸门开启时 pump() 不工作，回滚成 downloading 会永久卡住任务；
        // 保持 paused 并把失败原因暴露出来，由用户点「继续」重新调度。
        patchTask(taskId, { error: `暂停失败：${message}，可点击继续重试` });
        showToast(`「${current.title}」暂停失败：${message}`, 'error');
        return;
      }
      patchTask(taskId, { status: 'downloading', speed: 0, error: '' });
      showToast(`「${current.title}」暂停失败：${message}`, 'error');
    }
  }

  /** 继续：保留已下载的断点进度。 */
  async function resume(taskId: string) {
    const task = findTask(taskId);
    if (!task || !['paused', 'failed', 'canceled'].includes(task.status)) return;
    patchTask(taskId, { status: 'queued', error: '', speed: 0 });
    await pump();
  }

  /** 重新开始：丢弃已有进度与断点文件，从头下载。 */
  async function restart(taskId: string) {
    const task = findTask(taskId);
    if (!task || !['paused', 'failed', 'canceled'].includes(task.status)) return;
    patchTask(taskId, { status: 'queued', downloaded: 0, speed: 0, partialPath: '', error: '' });
    await pump();
  }

  async function cancel(taskId: string) {
    const task = findTask(taskId);
    if (!task) return;
    // 取消后安装包不再完整：进度与断点路径都要清空，避免下次继续时进度虚高。
    if (task.status === 'queued' || task.status === 'paused' || task.status === 'failed') {
      patchTask(taskId, { status: 'canceled', downloaded: 0, speed: 0, partialPath: '', error: '' });
      return;
    }
    if (task.status !== 'downloading') return;
    patchTask(taskId, { status: 'canceled', downloaded: 0, speed: 0, partialPath: '', error: '' });
    try {
      await CoolapkTauriAPI.cancelApkDownload(taskId);
    } catch (error) {
      patchTask(taskId, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function retry(taskId: string) {
    await resume(taskId);
  }

  async function remove(taskId: string, deleteFile = false) {
    const task = findTask(taskId);
    if (!task) return;
    if (task.status === 'downloading') await cancel(taskId);
    if (deleteFile) {
      try {
        await CoolapkTauriAPI.deleteApkDownloadFile(task.targetPath, task.partialPath, task.downloadDir, task.publicPath);
      } catch (error) {
        // 跨平台迁移后旧绝对路径可能已经不属于当前系统，删除记录不能被这个历史路径阻塞。
        if (task.publicPath) {
          showToast(`删除安装包失败，已保留下载记录：${String(error)}`, 'error');
          return;
        }
        console.warn('删除下载文件失败，将继续删除任务记录:', error);
      }
    }
    tasks.value = tasks.value.filter((item) => item.id !== taskId);
    // 任务已删除，取消还在合并窗口里的完成/失败提示，避免提示已不存在的任务。
    completedNotices.delete(taskId);
    failedNotices.delete(taskId);
    persist();
  }

  async function open(task: DownloadTask) {
    await CoolapkTauriAPI.openApkDownloadDirectory(task.downloadDir);
  }

  async function install(task: DownloadTask) {
    if (task.status !== 'completed' || !task.targetPath || !/\.apk$/i.test(task.targetPath)) return;
    try {
      const result = await CoolapkTauriAPI.installApkDownload(task.targetPath);
      if (result === 'permission_required') showToast('请允许安装未知应用，返回后再次点击安装', 'info', 6000);
    } catch (error) {
      showToast(`启动安装失败：${String(error)}`, 'error');
    }
  }

  async function openDirectory(dir?: string) {
    const target = dir || useSettingsStore().settings.downloadPath || '';
    await CoolapkTauriAPI.openApkDownloadDirectory(target);
  }

  async function pauseAll() {
    // 闸门必须在取快照之前置位：暂停循环是异步的，期间任何 pump()（完成回调、事件回调）
    // 都会把排队任务提升为下载中，导致「全部暂停」只停住了一部分任务。
    pausedAll.value = true;
    // 循环内可能因事件回调新增 downloading 任务，重新取一次快照直到没有可暂停任务。
    let guard = 0;
    try {
      while (guard < 5) {
        guard += 1;
        const active = activeTasks.value.filter((task) => task.status === 'downloading' || task.status === 'queued');
        if (active.length === 0) break;
        for (const task of active) {
          await pause(task.id);
        }
      }
    } finally {
      pausedAll.value = false;
    }
  }

  async function resumeAll() {
    // 先放开闸门再统一排队，最后一次性 pump，保证「全部继续」能立即恢复调度。
    pausedAll.value = false;
    const paused = activeTasks.value.filter((task) => task.status === 'paused');
    for (const task of paused) {
      patchTask(task.id, { status: 'queued', error: '', speed: 0 });
    }
    await pump();
  }

  /** 一键清空失败记录：只移除 failed 任务，不触碰进行中/已完成的历史。 */
  async function clearFailed(deleteFiles = false) {
    const targets = tasks.value.filter((task) => task.status === 'failed');
    for (const task of targets) {
      await remove(task.id, deleteFiles);
    }
  }

  async function clearHistory(deleteFiles = false) {
    const targets = [...historyTasks.value];
    for (const task of targets) {
      await remove(task.id, deleteFiles);
    }
  }

  watch(
    () => useSettingsStore().settings.maxConcurrentDownloads,
    () => void pump(),
  );

  return {
    tasks,
    activeTasks,
    historyTasks,
    activeCount,
    totalSpeed,
    completedTotalBytes,
    pausedAll,
    initialize,
    enqueue,
    pump,
    pause,
    resume,
    restart,
    cancel,
    retry,
    remove,
    open,
    openDirectory,
    install,
    pauseAll,
    resumeAll,
    clearHistory,
    clearFailed,
    applyNativeEvent,
    get eventUnlisten() { return eventUnlisten; },
  };
});
