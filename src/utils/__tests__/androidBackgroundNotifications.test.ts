import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive, nextTick } from 'vue';
const mocks = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined), permission: vi.fn().mockResolvedValue(true) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('../desktopNotify', () => ({ ensureAndroidNotificationPermission: mocks.permission }));
vi.mock('../toast', () => ({ showToast: vi.fn() }));
import { setupAndroidBackgroundNotifications } from '../androidBackgroundNotifications';
const settle = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('Android 后台消息检查', () => {
  it('启用后启动，退出账号后停止，不启动匿名轮询', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    const settings = reactive({ androidBackgroundNotifications: true, desktopNotifications: true, notificationPollInterval: 5, notifyReplies: true, notifyAt: true, notifyPm: true }) as any;
    const account = reactive({ uid: '123' });
    const stop = setupAndroidBackgroundNotifications(() => settings, () => account.uid);
    await settle();
    expect(mocks.invoke).toHaveBeenLastCalledWith('configure_android_background_notifications', { config: { enabled: true, uid: '123', intervalMinutes: 5, notifyReplies: true, notifyAt: true, notifyPm: true, sound: false } });
    settings.likeNotificationMuteUntil = 1700000000000;
    await settle();
    expect(mocks.invoke).toHaveBeenLastCalledWith('configure_android_background_notifications', { config: { enabled: true, uid: '123', intervalMinutes: 5, notifyReplies: true, notifyAt: true, notifyPm: true, likeMuteUntil: 1700000000000, sound: false } });
    account.uid = '';
    await settle();
    expect(mocks.invoke.mock.calls.at(-1)?.[1].config.enabled).toBe(false);
    stop();
  });
  it('拒绝通知授权后恢复关闭状态并停止后台服务', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    mocks.permission.mockResolvedValueOnce(false);
    const settings = reactive({ androidBackgroundNotifications: true, desktopNotifications: true, notificationPollInterval: 1 }) as any;
    const stop = setupAndroidBackgroundNotifications(() => settings, () => '1');
    await settle();
    await settle();
    expect(settings.androidBackgroundNotifications).toBe(false);
    expect(mocks.invoke.mock.calls.at(-1)?.[1].config.enabled).toBe(false);
    stop();
  });
});
