import { beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNotificationStore } from '../../stores/notifications';
import { markNotificationRead } from '../notificationRead';

const mocks = vi.hoisted(() => ({ read: vi.fn(), count: vi.fn(), report: vi.fn(), toast: vi.fn(), auth: { isLoggedIn: true, user: { uid: '100' } } }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: { readNotification: mocks.read, getNotificationCount: mocks.count, reportNotificationClick: mocks.report } }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('../toast', () => ({ showToast: mocks.toast }));
vi.mock('../diagnosticLogger', () => ({ logDiagnostic: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  mocks.auth.user.uid = '100';
  mocks.auth.isLoggedIn = true;
  mocks.report.mockResolvedValue({});
});

const item = () => ({ id: 'different-row-id', url: '/feed/333?notificationV18Id=9007199254740993&notificationV18Type=subitem' });

it('同一已读请求进行中合并重复点击，并采用服务端数量而非本地减一', async () => {
  const store = useNotificationStore();
  store.applyServerResponse({ notification_v18: 5, dateline: 1 });
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const first = markNotificationRead(item(), 'notification', '100');
  const second = markNotificationRead(item(), 'notification', '100');
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(store.notificationCount).toBe(5);
  resolve({ data: { notifyCount: { notification_v18: 0, dateline: 2 } } });
  await Promise.all([first, second]);
  expect(store.notificationCount).toBe(0);
});

it('已读响应没有 NotifyCount 时重新查询计数，缺少时不猜测', async () => {
  mocks.read.mockResolvedValueOnce({ data: {} });
  mocks.count.mockResolvedValueOnce({ data: { notification_v18: 2, dateline: 2 } });
  const store = useNotificationStore();
  store.applyServerResponse({ notification_v18: 3, dateline: 1 });
  await markNotificationRead(item(), 'notification', '100');
  expect(mocks.count).toHaveBeenCalledOnce();
  expect(store.notificationCount).toBe(2);
});

it('切换账号后旧已读请求不能修改新账号角标', async () => {
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const task = markNotificationRead(item(), 'notification', '100');
  mocks.auth.user.uid = '200';
  const store = useNotificationStore();
  store.reset();
  store.applyServerResponse({ notification_v18: 4, dateline: 1 });
  resolve({ data: { notifyCount: { notification_v18: 0, dateline: 100 } } });
  await task;
  expect(store.notificationCount).toBe(4);
});

it('全部已读完成后，先发出的单条已读响应不能恢复角标', async () => {
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const store = useNotificationStore();
  store.applyServerResponse({ notification_v18: 2, dateline: 1 });
  const task = markNotificationRead(item(), 'notification', '100');
  store.markNotificationsCleared(true);
  resolve({ data: { notifyCount: { notification_v18: 1, dateline: 2 } } });
  await task;
  expect(store.notificationCount).toBe(0);
});
