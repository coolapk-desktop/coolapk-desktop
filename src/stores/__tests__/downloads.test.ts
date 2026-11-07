import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

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
import { useSettingsStore } from '../settings';

const tick = () => Promise.resolve();

/** 让 pump() 的微任务队列跑完，任务真正进入原生下载调用。 */
async function settlePump() {
  await tick();
  await tick();
  await tick();
}

describe('下载管理队列', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.startApkDownload.mockReset();
    mocks.pauseApkDownload.mockResolvedValue(undefined);
    mocks.cancelApkDownload.mockResolvedValue(undefined);
    mocks.deleteApkDownloadFile.mockResolvedValue(undefined);
    mocks.openApkDownloadDirectory.mockResolvedValue(undefined);
    mocks.desktopNotify.mockResolvedValue(undefined);
  });

  it('删除安装包时同时传递公共副本地址，删除失败时保留记录', async () => {
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '示例', packageName: 'demo.delete', versionName: '1' });
    store.applyNativeEvent({ taskId: task.id, status: 'completed', path: '/download/demo.apk', publicPath: 'content://media/external/downloads/1' });
    mocks.deleteApkDownloadFile.mockRejectedValueOnce(new Error('无写入权限'));
    await store.remove(task.id, true);
    expect(store.tasks.some(item => item.id === task.id)).toBe(true);
    expect(mocks.deleteApkDownloadFile).toHaveBeenCalledWith(task.targetPath, task.partialPath, task.downloadDir, task.publicPath);
    await store.remove(task.id, true);
    expect(store.tasks.some(item => item.id === task.id)).toBe(false);
  });

  it('仅将已完成的 APK 交给安装器，跳过拆分安装包和未完成任务', async () => {
    const store = useDownloadStore();
    const task = { status: 'completed', targetPath: '/downloads/app.apk' } as any;
    await store.install(task);
    expect(mocks.installApkDownload).toHaveBeenCalledWith('/downloads/app.apk');
    mocks.installApkDownload.mockClear();
    await store.install({ ...task, status: 'downloading' });
    await store.install({ ...task, targetPath: '/downloads/app.xapk' });
    expect(mocks.installApkDownload).not.toHaveBeenCalled();
  });

  it('按并发设置调度队列，并在任务完成后补充下一个任务', async () => {
    const pending: Array<(value: any) => void> = [];
    mocks.startApkDownload.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const settings = useSettingsStore();
    settings.settings.maxConcurrentDownloads = 2;
    const store = useDownloadStore();

    store.enqueue({ title: '应用一', packageName: 'com.demo.one', versionName: '1.0.0' });
    store.enqueue({ title: '应用二', packageName: 'com.demo.two', versionName: '1.0.0' });
    store.enqueue({ title: '应用三', packageName: 'com.demo.three', versionName: '1.0.0' });
    await settlePump();

    expect(mocks.startApkDownload).toHaveBeenCalledTimes(2);
    expect(store.tasks.filter((task) => task.status === 'queued')).toHaveLength(1);

    pending.shift()!({ status: 'completed', downloaded: 10, total: 10, path: 'C:\\Downloads\\one.apk' });
    await settlePump();
    expect(mocks.startApkDownload).toHaveBeenCalledTimes(3);
  });

  it('同一应用和版本不会重复加入队列，并保留官方风格的文件名字段', () => {
    const store = useDownloadStore();
    const first = store.enqueue({
      title: '示例应用',
      packageName: 'com.demo.app',
      versionName: '1.7.3',
      versionCode: 173,
      apkId: 42,
    });
    const second = store.enqueue({
      title: '示例应用',
      packageName: 'com.demo.app',
      versionName: '1.7.3',
      versionCode: 173,
      apkId: 42,
    });

    expect(second.task.id).toBe(first.task.id);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(first.task.fileName).toBe('示例应用-1.7.3-173-42.apk');
    expect(store.tasks).toHaveLength(1);
  });

  it('暂停任务仍保留在当前任务，不会归入下载历史', async () => {
    let resolveDownload!: (value: any) => void;
    mocks.startApkDownload.mockImplementation(() => new Promise((resolve) => { resolveDownload = resolve; }));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '暂停应用', packageName: 'com.demo.paused', versionName: '1.0.0' });
    await settlePump();

    await store.pause(task.id);

    expect(task.status).toBe('paused');
    expect(store.activeTasks).toHaveLength(1);
    expect(store.historyTasks).toHaveLength(0);

    resolveDownload({ status: 'paused', downloaded: 1, total: 2 });
    await settlePump();
  });

  it('暂停事件会清零下载速度', () => {
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '速度应用', packageName: 'com.demo.speed', versionName: '1.0.0' });

    store.applyNativeEvent({ taskId: task.id, status: 'paused', downloaded: 16 * 1024 * 1024, total: 100 * 1024 * 1024, speed: 16 * 1024 * 1024 });

    expect(task.status).toBe('paused');
    expect(task.speed).toBe(0);
  });

  it('继续下载的起始事件不会清除已知总大小', () => {
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '续传应用', packageName: 'com.demo.resume', versionName: '1.0.0' });

    store.applyNativeEvent({ taskId: task.id, status: 'downloading', downloaded: 20, total: 100, speed: 5 });
    store.applyNativeEvent({ taskId: task.id, status: 'starting', downloaded: 20, total: 0, speed: 0 });

    expect(task.total).toBe(100);
    expect(task.downloaded).toBe(20);
  });

  it('计算当前所有下载中的合并总速度与已完成任务总体积', () => {
    const store = useDownloadStore();
    const { task: task1 } = store.enqueue({ title: '任务一', packageName: 'com.demo.t1', versionName: '1.0.0' });
    const { task: task2 } = store.enqueue({ title: '任务二', packageName: 'com.demo.t2', versionName: '1.0.0' });

    store.applyNativeEvent({ taskId: task1.id, status: 'downloading', downloaded: 50, total: 100, speed: 1024 });
    store.applyNativeEvent({ taskId: task2.id, status: 'downloading', downloaded: 30, total: 200, speed: 2048 });

    expect(store.totalSpeed).toBe(3072);

    store.applyNativeEvent({ taskId: task1.id, status: 'completed', downloaded: 100, total: 100, speed: 0 });
    expect(store.totalSpeed).toBe(2048);
    expect(store.completedTotalBytes).toBe(100);
  });

  it('支持全部暂停、全部继续与清空下载历史', async () => {
    mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
    const store = useDownloadStore();
    const { task: task1 } = store.enqueue({ title: '批量一', packageName: 'com.demo.b1', versionName: '1.0.0' });
    const { task: task2 } = store.enqueue({ title: '批量二', packageName: 'com.demo.b2', versionName: '1.0.0' });
    await settlePump();

    store.applyNativeEvent({ taskId: task1.id, status: 'downloading', downloaded: 10, total: 100, speed: 100 });
    store.applyNativeEvent({ taskId: task2.id, status: 'downloading', downloaded: 20, total: 200, speed: 200 });

    await store.pauseAll();
    expect(task1.status).toBe('paused');
    expect(task2.status).toBe('paused');

    await store.resumeAll();
    expect(['queued', 'downloading']).toContain(task1.status);
    expect(['queued', 'downloading']).toContain(task2.status);

    // 变为完成状态（进入历史）
    store.applyNativeEvent({ taskId: task1.id, status: 'completed', downloaded: 100, total: 100 });
    expect(store.historyTasks).toHaveLength(1);

    await store.clearHistory();
    expect(store.historyTasks).toHaveLength(0);
  });

  it('调用 openDirectory 打开指定或默认下载目录', async () => {
    const store = useDownloadStore();
    await store.openDirectory('D:\\CustomDownloads');
    expect(mocks.openApkDownloadDirectory).toHaveBeenCalledWith('D:\\CustomDownloads');
  });

  it('命中失败或暂停的同版本任务时真正重新排队，不再谎报已加入队列', async () => {
    const pending: Array<{ resolve: (value: any) => void; reject: (error: any) => void }> = [];
    mocks.startApkDownload.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '复用应用', packageName: 'com.demo.reuse', versionName: '2.0.0' });
    await settlePump();
    expect(task.status).toBe('downloading');

    // 暂停后原生通道返回，runTask 结束并释放并发位
    await store.pause(task.id);
    pending.shift()!.resolve({ status: 'paused', downloaded: 5, total: 100 });
    await settlePump();
    expect(task.status).toBe('paused');

    const pausedHit = store.enqueue({ title: '复用应用', packageName: 'com.demo.reuse', versionName: '2.0.0' });
    expect(pausedHit.reused).toBe(true);
    expect(pausedHit.resumed).toBe(true);
    expect(pausedHit.previousStatus).toBe('paused');
    expect(pausedHit.task.id).toBe(task.id);
    await settlePump();
    expect(task.status).toBe('downloading');

    // 原生失败后释放并发位，再次点击下载同样重新排队
    pending.shift()!.reject(new Error('网络中断'));
    await settlePump();
    expect(task.status).toBe('failed');

    const failedHit = store.enqueue({ title: '复用应用', packageName: 'com.demo.reuse', versionName: '2.0.0' });
    expect(failedHit.reused).toBe(true);
    expect(failedHit.resumed).toBe(true);
    expect(failedHit.previousStatus).toBe('failed');
    await settlePump();
    expect(['queued', 'downloading']).toContain(task.status);
    expect(store.tasks).toHaveLength(1);
  });

  it('已完成任务再次点击下载时返回真实完成状态，不重新排队', async () => {
    mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '完成应用', packageName: 'com.demo.done', versionName: '3.0.0' });
    await settlePump();
    store.applyNativeEvent({ taskId: task.id, status: 'completed', downloaded: 10, total: 10 });
    mocks.startApkDownload.mockClear();

    const hit = store.enqueue({ title: '完成应用', packageName: 'com.demo.done', versionName: '3.0.0' });
    expect(hit.reused).toBe(true);
    expect(hit.resumed).toBe(false);
    expect(hit.task.status).toBe('completed');
    await settlePump();
    expect(mocks.startApkDownload).not.toHaveBeenCalled();
  });

  it('全部暂停期间的闸门阻止 pump 把排队任务提升为下载中', async () => {
    let resolveFirst!: (value: any) => void;
    let resolvePause!: () => void;
    mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
    mocks.startApkDownload.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const settings = useSettingsStore();
    settings.settings.maxConcurrentDownloads = 1;
    const store = useDownloadStore();

    const first = store.enqueue({ title: '闸门一', packageName: 'com.demo.gate1', versionName: '1.0.0' }).task;
    await settlePump();
    expect(first.status).toBe('downloading');

    // 暂停循环卡在原生暂停调用上（第一个任务仍在下载中）
    mocks.pauseApkDownload.mockImplementationOnce(() => new Promise((resolve) => { resolvePause = () => resolve(undefined); }));
    const pausing = store.pauseAll();
    await settlePump();
    expect(store.pausedAll).toBe(true);

    // 闸门期间第一个任务完成，runTask 的 finally 会立即 pump()；新任务也在此时入队
    resolveFirst({ status: 'completed', downloaded: 10, total: 10, path: '/downloads/gate1.apk' });
    const second = store.enqueue({ title: '闸门二', packageName: 'com.demo.gate2', versionName: '1.0.0' }).task;
    await settlePump();
    expect(mocks.startApkDownload).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('queued');

    resolvePause();
    await pausing;
    expect(store.pausedAll).toBe(false);
    expect(first.status).toBe('completed');
    expect(second.status).toBe('paused');

    // 放开闸门后「全部继续」应立即恢复调度
    await store.resumeAll();
    await settlePump();
    expect(mocks.startApkDownload).toHaveBeenCalledTimes(2);
    expect(second.status).toBe('downloading');
  });

  it('取消后进度归零，重试不会显示虚假的旧进度', async () => {
    mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '取消应用', packageName: 'com.demo.cancel', versionName: '1.0.0' });
    await settlePump();
    store.applyNativeEvent({ taskId: task.id, status: 'downloading', downloaded: 512, total: 2048, partialPath: '/tmp/a.part' });
    expect(task.downloaded).toBe(512);

    await store.cancel(task.id);
    expect(task.status).toBe('canceled');
    expect(task.downloaded).toBe(0);
    expect(task.partialPath).toBe('');
    expect(mocks.cancelApkDownload).toHaveBeenCalledWith(task.id);
  });

  it('原生取消事件同样把进度归零', () => {
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '取消事件', packageName: 'com.demo.cancel2', versionName: '1.0.0' });
    store.applyNativeEvent({ taskId: task.id, status: 'downloading', downloaded: 900, total: 1000 });
    store.applyNativeEvent({ taskId: task.id, status: 'canceled', downloaded: 900, total: 1000 });
    expect(task.downloaded).toBe(0);
  });

  it('重新开始会清空断点进度，继续下载则保留', async () => {
    mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '断点应用', packageName: 'com.demo.restart', versionName: '1.0.0' });
    await settlePump();
    store.applyNativeEvent({ taskId: task.id, status: 'failed', downloaded: 400, total: 800, partialPath: '/tmp/b.part' });
    expect(task.downloaded).toBe(400);

    await store.restart(task.id);
    expect(task.downloaded).toBe(0);
    expect(task.partialPath).toBe('');
    expect(['queued', 'downloading']).toContain(task.status);
  });

  it('进度事件的持久化被节流，状态变更仍然立即落盘', async () => {
    vi.useFakeTimers();
    try {
      mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
      const store = useDownloadStore();
      const { task } = store.enqueue({ title: '节流应用', packageName: 'com.demo.throttle', versionName: '1.0.0' });
      await vi.advanceTimersByTimeAsync(0);
      expect(task.status).toBe('downloading');

      // jsdom 的 Storage 方法挂在原型上，必须 spy 原型才能拦截到写入
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      setItem.mockClear();
      for (let i = 1; i <= 20; i += 1) {
        store.applyNativeEvent({ taskId: task.id, status: 'downloading', downloaded: i, total: 100, speed: 1 });
      }
      // 20 个进度事件合并成 0 次同步写入（节流窗口内）
      expect(setItem).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(700);
      expect(setItem).toHaveBeenCalledTimes(1);

      // 状态变化（完成）立即持久化
      store.applyNativeEvent({ taskId: task.id, status: 'completed', downloaded: 100, total: 100 });
      expect(setItem).toHaveBeenCalledTimes(2);
      setItem.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('同批完成的任务只汇总一条提示，并带打开下载中心入口', async () => {
    vi.useFakeTimers();
    try {
      mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
      const store = useDownloadStore();
      const first = store.enqueue({ title: '汇总一', packageName: 'com.demo.notice1', versionName: '1.0.0' }).task;
      const second = store.enqueue({ title: '汇总二', packageName: 'com.demo.notice2', versionName: '1.0.0' }).task;
      await vi.advanceTimersByTimeAsync(0);

      store.applyNativeEvent({ taskId: first.id, status: 'completed', downloaded: 10, total: 10 });
      store.applyNativeEvent({ taskId: second.id, status: 'completed', downloaded: 10, total: 10 });
      expect(mocks.showToast).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(mocks.showToast).toHaveBeenCalledTimes(1);
      const [message, type, , action] = mocks.showToast.mock.calls[0]!;
      expect(message).toContain('2 个任务已下载完成');
      expect(type).toBe('success');
      expect(action.label).toBe('打开下载中心');
    } finally {
      vi.useRealTimers();
    }
  });

  it('失败任务同样提示，开启系统桌面通知时不再重复弹应用内提示', async () => {
    vi.useFakeTimers();
    try {
      mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
      const settings = useSettingsStore();
      const store = useDownloadStore();
      const { task } = store.enqueue({ title: '失败应用', packageName: 'com.demo.noticefail', versionName: '1.0.0' });
      await vi.advanceTimersByTimeAsync(0);

      mocks.showToast.mockClear();
      store.applyNativeEvent({ taskId: task.id, status: 'failed', error: '连接被重置' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(mocks.showToast).toHaveBeenCalledTimes(1);
      const [message, type] = mocks.showToast.mock.calls[0]!;
      expect(message).toContain('下载失败');
      expect(message).toContain('连接被重置');
      expect(type).toBe('error');
      expect(mocks.desktopNotify).not.toHaveBeenCalled();

      settings.settings.desktopNotifications = true;
      const second = store.enqueue({ title: '系统通知应用', packageName: 'com.demo.noticefail2', versionName: '1.0.0' }).task;
      await vi.advanceTimersByTimeAsync(0);
      mocks.showToast.mockClear();
      store.applyNativeEvent({ taskId: second.id, status: 'completed', downloaded: 5, total: 5 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(mocks.desktopNotify).toHaveBeenCalledTimes(1);
      expect(mocks.showToast).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('关闭下载完成提醒时既不弹提示也不发系统通知', async () => {
    vi.useFakeTimers();
    try {
      mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
      const settings = useSettingsStore();
      settings.settings.notifyDownloadComplete = false;
      settings.settings.desktopNotifications = true;
      const store = useDownloadStore();
      const { task } = store.enqueue({ title: '静默应用', packageName: 'com.demo.silent', versionName: '1.0.0' });
      await vi.advanceTimersByTimeAsync(0);

      store.applyNativeEvent({ taskId: task.id, status: 'completed', downloaded: 5, total: 5 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(mocks.showToast).not.toHaveBeenCalled();
      expect(mocks.desktopNotify).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('原生返回 downloaded: 0 时不会被旧进度覆盖', async () => {
    mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '归零应用', packageName: 'com.demo.zero', versionName: '1.0.0' });
    await settlePump();
    store.applyNativeEvent({ taskId: task.id, status: 'paused', downloaded: 800, total: 1000 });
    await store.restart(task.id);
    mocks.startApkDownload.mockImplementationOnce(() => Promise.resolve({ status: 'completed', downloaded: 0, total: 1000, path: '/downloads/zero.apk' }));
    store.applyNativeEvent({ taskId: task.id, status: 'paused' });
    await store.resume(task.id);
    await settlePump();
    expect(task.downloaded).toBe(0);
  });
});

describe('batch6：pause 回滚 / 启动断点提示 / 清空失败记录', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.startApkDownload.mockReset();
    mocks.pauseApkDownload.mockResolvedValue(undefined);
    mocks.showToast.mockClear();
  });

  it('原生暂停失败且不在批量暂停期间时回滚为下载中，并提示错误', async () => {
    mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '回滚应用', packageName: 'com.demo.rollback', versionName: '1.0.0' });
    await settlePump();
    expect(task.status).toBe('downloading');

    mocks.pauseApkDownload.mockRejectedValueOnce(new Error('通道未就绪'));
    await store.pause(task.id);

    expect(task.status).toBe('downloading');
    expect(task.error).toBe('');
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('暂停失败'), 'error');
  });

  it('批量暂停期间原生暂停失败时保持 paused，不再回滚成无人调度的 downloading', async () => {
    mocks.startApkDownload.mockImplementation(() => new Promise(() => {}));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '闸门应用', packageName: 'com.demo.gate', versionName: '1.0.0' });
    await settlePump();
    store.applyNativeEvent({ taskId: task.id, status: 'downloading', downloaded: 10, total: 100 });

    mocks.pauseApkDownload.mockRejectedValue(new Error('暂停失败'));
    await store.pauseAll();

    expect(task.status).toBe('paused');
    expect(task.error).toContain('暂停失败');
    // 放开闸门后用户可继续，任务能被重新调度
    mocks.pauseApkDownload.mockResolvedValue(undefined);
    await store.resume(task.id);
    await settlePump();
    // 闸门已放开：任务重新排队（此刻 runTask 的旧 Promise 仍占用 runningIds，
    // 等它返回后 pump 会再次调度，这里只验证不再卡死在 paused）。
    expect(['queued', 'downloading']).toContain(task.status);
    expect(task.error).toBe('');
  });

  it('事件已把任务推进到完成态时，暂停失败不再把任务硬拉回 downloading', async () => {
    let resolveDownload!: (value: any) => void;
    mocks.startApkDownload.mockImplementation(() => new Promise((resolve) => { resolveDownload = resolve; }));
    const store = useDownloadStore();
    const { task } = store.enqueue({ title: '竞态应用', packageName: 'com.demo.race', versionName: '1.0.0' });
    await settlePump();

    // 不等待原生暂停返回，先让原生下载完成并广播事件
    mocks.pauseApkDownload.mockImplementation(() => {
      resolveDownload({ status: 'completed', downloaded: 100, total: 100, path: '/x.apk' });
      return Promise.reject(new Error('已完成无法暂停'));
    });
    await store.pause(task.id);

    expect(task.status).toBe('completed');
  });

  it('启动恢复时对有进度但缺断点路径的任务给出保守提示，并保留进度数字', async () => {
    const seeded = [{
      id: 'seed-1', kind: 'apk', title: '断点应用', packageName: 'com.demo.stale', versionName: '1.0.0',
      versionCode: '1', apkId: '1', logoUrl: '', fileName: 'a.apk', extraAnalysisData: '',
      downloadDir: '', targetPath: '', partialPath: '', publicPath: '',
      status: 'downloading', downloaded: 4096, total: 8192, speed: 0, retryCount: 0,
      error: '', createdAt: 1, updatedAt: 1, completedAt: 0,
    }];
    localStorage.setItem('coolapk_desktop_downloads_v1', JSON.stringify(seeded));
    setActivePinia(createPinia());
    const store = useDownloadStore();
    await store.initialize();

    const task = store.tasks.find((item) => item.id === 'seed-1')!;
    expect(task.status).toBe('paused');
    expect(task.error).toContain('断点文件可能已失效');
    expect(task.downloaded).toBe(4096);
  });

  it('clearFailed 只清空失败记录，可按需删除文件', async () => {
    const store = useDownloadStore();
    const failed = store.enqueue({ title: '失败应用', packageName: 'com.demo.fail', versionName: '1.0.0' });
    const done = store.enqueue({ title: '完成应用', packageName: 'com.demo.done', versionName: '1.0.0' });
    store.applyNativeEvent({ taskId: failed.task.id, status: 'failed', error: '网络中断' });
    store.applyNativeEvent({ taskId: done.task.id, status: 'completed', downloaded: 1, total: 1 });

    await store.clearFailed(true);

    expect(store.tasks.some((item) => item.id === failed.task.id)).toBe(false);
    expect(store.tasks.some((item) => item.id === done.task.id)).toBe(true);
    expect(mocks.deleteApkDownloadFile).toHaveBeenCalledTimes(1);
  });
});
