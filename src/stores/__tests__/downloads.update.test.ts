import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// 与 downloads.test.ts 相同的模块 mock：store 不真正触达 Tauri 后端。
const mocks = vi.hoisted(() => ({
  startApkDownload: vi.fn(),
  pauseApkDownload: vi.fn().mockResolvedValue(undefined),
  cancelApkDownload: vi.fn().mockResolvedValue(undefined),
  deleteApkDownloadFile: vi.fn().mockResolvedValue(undefined),
  openApkDownloadDirectory: vi.fn().mockResolvedValue(undefined),
  installApkDownload: vi.fn().mockResolvedValue('started'),
  showToast: vi.fn(),
  desktopNotify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));
vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../../utils/desktopNotify', () => ({ desktopNotify: mocks.desktopNotify }));

import { useDownloadStore } from '../downloads';

const tick = () => Promise.resolve();

async function settlePump() {
  await tick();
  await tick();
  await tick();
}

describe('下载中心的更新包任务', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.startApkDownload.mockReset();
    mocks.startApkDownload.mockResolvedValue({ status: 'completed' });
  });

  it('更新任务生命周期：登记 → 进度 → 完成 → 删除记录', async () => {
    const store = useDownloadStore();
    const task = store.appendUpdate({ version: '1.8.0', fileName: 'coolapk-setup.exe', total: 0 });

    expect(task.status).toBe('queued');
    expect(task.versionName).toBe('1.8.0');
    // pinia 返回响应式代理，用结构相等比较。
    expect(store.tasks[0]).toStrictEqual(task);

    store.updateUpdateProgress(task.id, 1024, 4096);
    expect(task.status).toBe('downloading');
    expect(task.downloaded).toBe(1024);
    expect(task.total).toBe(4096);

    store.markUpdateReady(task.id, '/cache/coolapk-setup.exe');
    expect(task.status).toBe('completed');
    expect(task.targetPath).toBe('/cache/coolapk-setup.exe');
    expect(task.downloaded).toBe(4096);

    await store.removeUpdateTask(task.id);
    expect(store.tasks.some((item) => item.id === task.id)).toBe(false);
  });

  it('更新任务失败：记录错误，重试复用同一条记录并归零进度', () => {
    const store = useDownloadStore();
    const task = store.appendUpdate({ version: '1.8.0' });
    store.updateUpdateProgress(task.id, 500, 4096);
    store.markUpdateFailed(task.id, '网络中断');
    expect(task.status).toBe('failed');
    expect(task.error).toBe('网络中断');
    expect(task.retryCount).toBe(1);

    // App.vue 重发下载时 appendUpdate 复用记录，清空进度（更新器不支持断点续传）。
    const reused = store.appendUpdate({ version: '1.8.0' });
    expect(reused.id).toBe(task.id);
    expect(reused.status).toBe('queued');
    expect(reused.downloaded).toBe(0);
    expect(reused.error).toBe('');
  });

  it('更新任务不进入 apk 原生下载队列，也不占用并发调度', async () => {
    const store = useDownloadStore();
    store.appendUpdate({ version: '1.8.0' });
    await settlePump();
    expect(mocks.startApkDownload).not.toHaveBeenCalled();
    expect(store.tasks[0]!.status).toBe('queued');
  });

  it('下载中心不把更新任务当 apk 处理：安装/打开目录/暂停全部跳过', async () => {
    const store = useDownloadStore();
    const task = store.appendUpdate({ version: '1.8.0' });
    store.updateUpdateProgress(task.id, 10, 100);

    // 即使路径长得像 apk，也绝不能交给 apk 安装器。
    store.markUpdateReady(task.id, '/cache/coolapk.apk');
    await store.install(task);
    expect(mocks.installApkDownload).not.toHaveBeenCalled();

    await store.open(task);
    expect(mocks.openApkDownloadDirectory).not.toHaveBeenCalled();

    await store.pause(task.id);
    expect(task.status).toBe('completed'); // 不可暂停，状态不被改成 paused
    expect(mocks.pauseApkDownload).not.toHaveBeenCalled();

    await store.retry(task.id);
    expect(mocks.startApkDownload).not.toHaveBeenCalled();

    await store.pauseAll();
    expect(task.status).toBe('completed');
  });

  it('应用重启后未完成的更新任务标记为失败，而不是假装可继续', () => {
    const raw = [{
      id: 'update-1.8.0', kind: 'update', title: '酷安桌面版', packageName: 'app-update',
      versionName: '1.8.0', versionCode: '', apkId: '', logoUrl: '', fileName: 'coolapk-setup.exe',
      extraAnalysisData: '', downloadDir: '', targetPath: '', partialPath: '', publicPath: '',
      status: 'downloading', downloaded: 100, total: 200, speed: 0, retryCount: 0, error: '',
      createdAt: 1, updatedAt: 1, completedAt: 0, packageType: 'nsis', updateUrl: 'https://example.com/x',
    }];
    localStorage.setItem('coolapk_desktop_downloads_v1', JSON.stringify(raw));
    const store = useDownloadStore();
    void store.initialize();
    const task = store.tasks.find((item) => item.id === 'update-1.8.0');
    expect(task?.status).toBe('failed');
    expect(task?.error).toContain('重试');
    // 扩展字段随持久化往返保留。
    expect((store.tasks[0] as unknown as { packageType: string }).packageType).toBe('nsis');
  });
});
