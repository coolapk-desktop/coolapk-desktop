import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// 与 downloads.test.ts 相同的模块 mock：store 不真正触达 Tauri 后端。
const mocks = vi.hoisted(() => ({
  startApkDownload: vi.fn().mockResolvedValue({ status: 'completed' }),
  pauseApkDownload: vi.fn().mockResolvedValue(undefined),
  cancelApkDownload: vi.fn().mockResolvedValue(undefined),
  deleteApkDownloadFile: vi.fn().mockResolvedValue(undefined),
  openApkDownloadDirectory: vi.fn().mockResolvedValue(undefined),
  installApkDownload: vi.fn().mockResolvedValue('started'),
  showToast: vi.fn(),
  desktopNotify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../../utils/desktopNotify', () => ({ desktopNotify: mocks.desktopNotify }));

import { useDownloadStore } from '../downloads';

const tick = () => Promise.resolve();

describe('batch11：enqueue 匹配键与批量清理/重启/取消', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.deleteApkDownloadFile.mockResolvedValue(undefined);
    mocks.cancelApkDownload.mockResolvedValue(undefined);
  });

  it('同应用同版本但不同 apkId：不误命中旧任务，各自入队', () => {
    const store = useDownloadStore();
    const a = store.enqueue({ title: '应用', packageName: 'com.demo.multi', versionName: '1.0.0', apkId: 11 });
    const b = store.enqueue({ title: '应用', packageName: 'com.demo.multi', versionName: '1.0.0', apkId: 22 });
    expect(b.reused).toBe(false);
    expect(b.task.id).not.toBe(a.task.id);
    expect(store.tasks.filter((t) => t.packageName === 'com.demo.multi')).toHaveLength(2);
  });

  it('同来源重复点击仍然复用同一条任务（含失败任务重新排队）', async () => {
    const store = useDownloadStore();
    const first = store.enqueue({ title: '应用', packageName: 'com.demo.same', versionName: '2.0.0', apkId: 7 });
    const again = store.enqueue({ title: '应用', packageName: 'com.demo.same', versionName: '2.0.0', apkId: 7 });
    expect(again.reused).toBe(true);
    expect(again.task.id).toBe(first.task.id);

    first.task.status = 'failed';
    const resumed = store.enqueue({ title: '应用', packageName: 'com.demo.same', versionName: '2.0.0', apkId: 7 });
    expect(resumed.reused).toBe(true);
    expect(resumed.resumed).toBe(true);
    expect(resumed.task.id).toBe(first.task.id);
    await tick();
  });

  it('同应用同版本同 apkId 但 kind 不同（apk vs xapk）：不互相命中', () => {
    const store = useDownloadStore();
    const apk = store.enqueue({ title: '应用', packageName: 'com.demo.kind', versionName: '1.0.0', apkId: 9, kind: 'apk' });
    const xapk = store.enqueue({ title: '应用', packageName: 'com.demo.kind', versionName: '1.0.0', apkId: 9, kind: 'xapk' });
    expect(xapk.reused).toBe(false);
    expect(xapk.task.id).not.toBe(apk.task.id);
  });

  it('clearFailed 清理失败的更新任务不写删除墓碑，单条删除记录才写', async () => {
    const store = useDownloadStore();
    const updateTask = store.appendUpdate({ version: '1.8.0' });
    store.markUpdateFailed(updateTask.id, '网络中断');

    await store.clearFailed(false);
    expect(store.tasks.some((t) => t.id === updateTask.id)).toBe(false);
    // 批量清理不是用户「删除记录」，该版本的自动更新提示不能被永久挡住。
    expect(store.isUpdateVersionDeleted('1.8.0')).toBe(false);

    const updateTask2 = store.appendUpdate({ version: '1.9.0' });
    store.markUpdateFailed(updateTask2.id, '网络中断');
    await store.removeUpdateTask(updateTask2.id);
    expect(store.isUpdateVersionDeleted('1.9.0')).toBe(true);
  });

  it('restart 先删除原生断点文件（只传 partial），失败不阻塞重新排队', async () => {
    // 让原生下载挂起，避免 enqueue 触发的 pump 在断言前把任务推进到 completed。
    mocks.startApkDownload.mockReturnValue(new Promise(() => {}));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '重启应用', packageName: 'com.demo.restart', versionName: '1.0.0' });
    task.status = 'paused';
    task.partialPath = '/data/重启应用-1.0.0.apk.part';
    task.downloaded = 500;

    mocks.deleteApkDownloadFile.mockRejectedValueOnce(new Error('磁盘被占用'));
    const partialBefore = task.partialPath;
    await store.restart(task.id);
    // 只删断点：targetPath/publicPath 必须传空，避免误删已完成的安装包。
    expect(mocks.deleteApkDownloadFile).toHaveBeenCalledWith('', partialBefore, task.downloadDir, '');
    // 删断点失败也要提示，且不阻塞排队。
    expect(mocks.showToast).toHaveBeenCalled();
    // 重新排队后 pump 可能立即把它提升为 downloading；关键是进度与断点已清、不再是旧状态。
    expect(['queued', 'downloading']).toContain(task.status);
    expect(task.downloaded).toBe(0);
    expect(task.partialPath).toBe('');
  });

  it('已取消的任务不再接受原生进度事件，不会被拉回 downloading', async () => {
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '取消应用', packageName: 'com.demo.cancel', versionName: '1.0.0' });
    task.status = 'downloading';
    await store.cancel(task.id);
    expect(task.status).toBe('canceled');

    // 原生取消失败后的迟到进度事件不得复活任务。
    store.applyNativeEvent({ taskId: task.id, status: 'downloading', downloaded: 123, total: 1000 });
    expect(task.status).toBe('canceled');
    expect(task.downloaded).toBe(0);
  });

  it('删除下载中任务且原生取消失败时：删除文件仍能用取消前的断点路径补删 .part（用户可见口径：删除后磁盘不残留孤儿 .part）', async () => {
    // 挂起原生下载，避免 pump 在断言前把任务推进到 completed。
    mocks.startApkDownload.mockReturnValue(new Promise(() => {}));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '删除断点应用', packageName: 'com.demo.removepart', versionName: '1.0.0' });
    task.status = 'downloading';
    task.partialPath = '/data/删除断点应用-1.0.0.apk.part';

    mocks.cancelApkDownload.mockRejectedValueOnce(new Error('通道已断开'));
    await store.remove(task.id, true);
    // 取消失败时记录里的 partialPath 已被 cancel 清空，删除必须回退到取消前的快照路径。
    expect(mocks.deleteApkDownloadFile).toHaveBeenCalledWith(task.targetPath, '/data/删除断点应用-1.0.0.apk.part', task.downloadDir, task.publicPath);
    // 记录仍被删除（现有语义：取消不回滚、删除不因取消失败而保留记录）。
    expect(store.tasks.some((t) => t.id === task.id)).toBe(false);
  });

  it('删除下载中任务且原生取消成功时：不再用快照路径重复调用删除（用户可见口径：正常取消删除不产生多余文件操作）', async () => {
    mocks.startApkDownload.mockReturnValue(new Promise(() => {}));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '正常删除应用', packageName: 'com.demo.removeok', versionName: '1.0.0' });
    task.status = 'downloading';
    task.partialPath = '/data/正常删除应用-1.0.0.apk.part';

    await store.remove(task.id, true);
    // 原生取消成功时 Rust 侧已删除 .part，前端不传快照路径做无意义调用。
    expect(mocks.deleteApkDownloadFile).toHaveBeenCalledWith(task.targetPath, '', task.downloadDir, task.publicPath);
    expect(store.tasks.some((t) => t.id === task.id)).toBe(false);
  });

  it('cancel 原生失败时保持已取消并暴露可重试的错误信息', async () => {
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '取消失败应用', packageName: 'com.demo.cancelfail', versionName: '1.0.0' });
    task.status = 'downloading';
    mocks.cancelApkDownload.mockRejectedValueOnce(new Error('通道已断开'));
    await store.cancel(task.id);
    expect(task.status).toBe('canceled');
    expect(task.error).toContain('取消失败');
    expect(mocks.showToast).toHaveBeenCalled();
  });
});
