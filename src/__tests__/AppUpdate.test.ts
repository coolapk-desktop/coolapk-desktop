import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { os: 'macos', arch: 'aarch64' },
  distribution: vi.fn(),
  checkLatestRelease: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  cleanup: vi.fn(),
  available: vi.fn(),
  installError: vi.fn(),
  quitApp: vi.fn(),
  flushSettings: vi.fn(),
  showToast: vi.fn(),
  desktopNotify: vi.fn(),
  push: vi.fn(),
  settings: {
    updateChannel: 'stable', ignoredUpdateVersion: '', ignoreAllUpdates: false,
    checkUpdateOnStartup: false, autoCleanCache: false, desktopNotifications: false,
    notifyDownloadComplete: true, updateSpeedLimitKBps: 0,
  },
}));
vi.mock('../utils/platform', () => ({ getPlatformInfo: async () => mocks.platform }));
vi.mock('../utils/updateChecker', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/updateChecker')>(),
  checkLatestRelease: mocks.checkLatestRelease,
}));
vi.mock('../api/coolapk', () => ({ CoolapkTauriAPI: {
  getUpdateDistribution: mocks.distribution, downloadUpdate: mocks.downloadUpdate,
  installUpdate: mocks.installUpdate, cleanupUpdatePackages: mocks.cleanup,
  isUpdatePackageAvailable: mocks.available, takeUpdateInstallError: mocks.installError,
  quitApp: mocks.quitApp,
} }));
vi.mock('../stores/auth', () => ({ useAuthStore: () => ({ initAuth: vi.fn() }) }));
vi.mock('../stores/settings', async () => {
  const { reactive } = await import('vue');
  mocks.settings = reactive(mocks.settings);
  return { useSettingsStore: () => ({
  settings: mocks.settings, flushSettings: mocks.flushSettings, refreshAutoZoom: vi.fn(),
}) };
});
// 更新器会把自己的下载任务镜像进下载中心；这里给出对应的 no-op 接口，
// 断言仍集中在更新器自身的提示与弹窗行为上。
vi.mock('../stores/downloads', () => ({
  useDownloadStore: () => ({
    initialize: vi.fn(),
    appendUpdate: vi.fn(() => ({ id: 'update-task' })),
    updateUpdateProgress: vi.fn(),
    markUpdateReady: vi.fn(),
    markUpdateFailed: vi.fn(),
    removeUpdateTask: vi.fn(),
  }),
}));
vi.mock('../stores/pageTabs', () => ({ usePageTabsStore: () => ({ getGeneration: () => 0, syncRoute: vi.fn() }) }));
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/home', fullPath: '/home' }),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('../utils/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../utils/desktopNotify', () => ({ desktopNotify: mocks.desktopNotify }));
vi.mock('../utils/routeTransition', () => ({ useSidebarTransition: () => ({ isSidebarTransitionActive: false, resetSidebarTransition: vi.fn() }) }));
vi.mock('../utils/hotkeys', () => ({ registerGlobalHotkeys: () => vi.fn() }));
vi.mock('../utils/selection', () => ({ registerGlobalSelectionClear: () => vi.fn() }));
vi.mock('../utils/anchorClick', () => ({ handleAnchorClick: vi.fn() }));
vi.mock('../utils/diagnosticLogger', () => ({ logDiagnostic: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
import App from '../App.vue';

function mountApp() {
  return mount(App, { global: { stubs: {
    AppShell: { template: '<div><slot /></div>' },
    AppDialog: { props: ['isOpen', 'title'], template: '<section v-if="isOpen"><h2>{{ title }}</h2><slot /></section>' },
    PublishDialog: true, ImageViewer: true, SearchCommand: true, LoginModal: true,
    AppConfirmHost: true, AppContextMenu: true, ShuzilmDeviceGuideModal: true, 'router-view': true,
  } } });
}

describe('桌面自动更新交互', () => {
  let wrapper: ReturnType<typeof mountApp> | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.updateChannel = 'stable';
    mocks.platform.os = 'macos';
    mocks.platform.arch = 'aarch64';
    mocks.distribution.mockResolvedValue('installer');
    mocks.installError.mockResolvedValue(null);
    mocks.cleanup.mockResolvedValue(undefined);
    mocks.available.mockResolvedValue(true);
    mocks.installUpdate.mockResolvedValue('started');
    mocks.flushSettings.mockResolvedValue(undefined);
    mocks.quitApp.mockResolvedValue(undefined);
    mocks.downloadUpdate.mockResolvedValue('/cache/coolapk-desktop_9.9.9_aarch64-12-34.dmg');
  });
  afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

  it.each([
    ['macos', 'aarch64', 'installer', 'coolapk-desktop_9.9.9_aarch64.dmg'],
    ['linux', 'x86_64', 'portable', 'coolapk-desktop_9.9.9_amd64.AppImage'],
    ['linux', 'x86_64', 'deb', 'coolapk-desktop_9.9.9_amd64.deb'],
    ['linux', 'x86_64', 'rpm', 'coolapk-desktop-9.9.9-1.x86_64.rpm'],
  ])('恢复 %s %s %s 待安装包并安装重启', async (os, arch, packageType, fileName) => {
    mocks.platform.os = os;
    mocks.platform.arch = arch;
    mocks.distribution.mockResolvedValue(packageType);
    const path = `/cache/${fileName}`;
    localStorage.setItem('coolapk_pending_update', JSON.stringify({
      version: '9.9.9', path, fileName, packageType, releaseNotes: '新版说明',
    }));
    wrapper = mountApp();
    await flushPromises();
    expect(wrapper.text()).toContain('更新包已下载');
    expect(wrapper.text()).toContain('新版说明');
    if (['deb', 'rpm'].includes(packageType)) expect(wrapper.text()).toContain('管理员授权');
    const install = wrapper.findAll('button').find((button) => button.text() === '立即更新')!;
    await install.trigger('click');
    await flushPromises();
    expect(mocks.installUpdate).toHaveBeenCalledWith(path, packageType === 'portable');
    expect(mocks.quitApp).toHaveBeenCalledOnce();
    expect(mocks.downloadUpdate).not.toHaveBeenCalled();
  });

  it('下载完成但系统桌面通知关闭时，只给一次可跳转通知设置的轻量提示', async () => {
    mocks.checkLatestRelease.mockResolvedValue({ hasNew: true, latestVersion: 'v9.9.9',
      installerUrl: 'https://github.com/download/new.dmg', installerName: 'coolapk-desktop_9.9.9_aarch64.dmg',
      packageType: 'installer', releaseNotes: '更新说明',
    });
    mocks.settings.notifyDownloadComplete = true;
    mocks.settings.desktopNotifications = false;
    wrapper = mountApp();
    await flushPromises();
    window.dispatchEvent(new Event('check-for-update'));
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text().includes('后台下载更新'))!.trigger('click');
    await flushPromises();
    // 系统通知总开关关闭时不再尝试系统气泡，改为应用内提示并保留设置入口。
    expect(mocks.desktopNotify).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledOnce();
    const [message, type, , action] = mocks.showToast.mock.calls[0]!;
    expect(String(message)).toContain('更新包已下载完成');
    expect(type).toBe('info');
    action.onClick();
    expect(mocks.push).toHaveBeenCalledWith('/settings/notifications');
  });

  it('系统桌面通知开启时仍走系统气泡，不再额外弹应用内提示', async () => {
    mocks.checkLatestRelease.mockResolvedValue({ hasNew: true, latestVersion: 'v9.9.9',
      installerUrl: 'https://github.com/download/new.dmg', installerName: 'coolapk-desktop_9.9.9_aarch64.dmg',
      packageType: 'installer', releaseNotes: '更新说明',
    });
    mocks.settings.notifyDownloadComplete = true;
    mocks.settings.desktopNotifications = true;
    wrapper = mountApp();
    await flushPromises();
    window.dispatchEvent(new Event('check-for-update'));
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text().includes('后台下载更新'))!.trigger('click');
    await flushPromises();
    expect(mocks.desktopNotify).toHaveBeenCalledOnce();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('手动检查 macOS 更新后可以下载并记录待安装包', async () => {
    mocks.checkLatestRelease.mockResolvedValue({ hasNew: true, latestVersion: 'v9.9.9',
      installerUrl: 'https://github.com/download/new.dmg', installerName: 'coolapk-desktop_9.9.9_aarch64.dmg',
      packageType: 'installer', releaseNotes: '更新说明',
    });
    wrapper = mountApp();
    await flushPromises();
    window.dispatchEvent(new Event('check-for-update'));
    await flushPromises();
    expect(mocks.checkLatestRelease).toHaveBeenCalledWith('stable', undefined, 'installer');
    await wrapper.findAll('button').find((button) => button.text().includes('后台下载更新'))!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('更新包已下载');
    expect(JSON.parse(localStorage.getItem('coolapk_pending_update')!)).toMatchObject({ version: '9.9.9', packageType: 'installer' });
  });

  it('安装授权取消时保留下载记录和当前应用', async () => {
    mocks.platform.os = 'linux';
    mocks.platform.arch = 'x86_64';
    mocks.distribution.mockResolvedValue('deb');
    mocks.installUpdate.mockRejectedValue('用户取消管理员授权');
    localStorage.setItem('coolapk_pending_update', JSON.stringify({
      version: '9.9.9', path: '/cache/coolapk-desktop_9.9.9_amd64.deb', packageType: 'deb',
    }));
    wrapper = mountApp();
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === '立即更新')!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('用户取消管理员授权');
    expect(mocks.quitApp).not.toHaveBeenCalled();
    expect(localStorage.getItem('coolapk_pending_update')).not.toBeNull();
  });

  it('拒绝从 AppImage 切换到 deb 的缓存包', async () => {
    mocks.platform.os = 'linux';
    mocks.platform.arch = 'x86_64';
    mocks.distribution.mockResolvedValue('portable');
    localStorage.setItem('coolapk_pending_update', JSON.stringify({
      version: '9.9.9', path: '/cache/coolapk-desktop_9.9.9_amd64.deb', packageType: 'deb',
    }));
    wrapper = mountApp();
    await flushPromises();
    expect(wrapper.text()).not.toContain('更新包已下载');
    expect(localStorage.getItem('coolapk_pending_update')).toBeNull();
  });

  it('在重新启动后显示更新助手的失败原因', async () => {
    mocks.installError.mockResolvedValue('新版程序启动失败，已恢复旧版');
    wrapper = mountApp();
    await flushPromises();
    expect(wrapper.text()).toContain('已恢复旧版');
  });

  it('切回稳定版后清除已下载测试包并检查正式版', async () => {
    mocks.settings.updateChannel = 'beta';
    mocks.checkLatestRelease.mockResolvedValue({ hasNew: false, latestVersion: 'v1.30.0' });
    localStorage.setItem('coolapk_pending_update', JSON.stringify({
      version: '9.9.9-beta.1', path: '/cache/coolapk-desktop_9.9.9-beta.1_aarch64.dmg', packageType: 'installer',
    }));
    wrapper = mountApp();
    await flushPromises();
    expect(wrapper.text()).toContain('更新包已下载');
    mocks.settings.updateChannel = 'stable';
    await flushPromises();
    expect(wrapper.text()).not.toContain('更新包已下载');
    expect(localStorage.getItem('coolapk_pending_update')).toBeNull();
    expect(mocks.checkLatestRelease).toHaveBeenCalledWith('stable', undefined, 'installer');
  });

  it('稳定渠道启动时不恢复缓存测试包', async () => {
    localStorage.setItem('coolapk_pending_update', JSON.stringify({
      version: '9.9.9-beta.1', path: '/cache/coolapk-desktop_9.9.9-beta.1_aarch64.dmg', packageType: 'installer',
    }));
    wrapper = mountApp();
    await flushPromises();
    expect(wrapper.text()).not.toContain('更新包已下载');
    expect(localStorage.getItem('coolapk_pending_update')).toBeNull();
  });

  it('下载途中关闭测试渠道后，不保存测试包并重新检查正式版', async () => {
    let finishDownload!: (path: string) => void;
    mocks.downloadUpdate.mockImplementation(() => new Promise<string>((resolve) => { finishDownload = resolve; }));
    mocks.checkLatestRelease.mockImplementation(async (channel) => channel === 'beta' ? {
      hasNew: true, latestVersion: 'v9.9.9-beta.1', installerUrl: 'beta-url',
      installerName: 'coolapk-desktop_9.9.9-beta.1_aarch64.dmg', packageType: 'installer',
    } : { hasNew: false, latestVersion: 'v1.30.0' });
    wrapper = mountApp();
    await flushPromises();
    mocks.settings.updateChannel = 'beta';
    await flushPromises();
    expect(mocks.downloadUpdate).toHaveBeenCalledOnce();
    mocks.settings.updateChannel = 'stable';
    await flushPromises();
    finishDownload('/cache/coolapk-desktop_9.9.9-beta.1_aarch64.dmg');
    await flushPromises();
    expect(localStorage.getItem('coolapk_pending_update')).toBeNull();
    expect(wrapper.text()).not.toContain('更新包已下载');
    expect(mocks.checkLatestRelease).toHaveBeenLastCalledWith('stable', undefined, 'installer');
  });
});
