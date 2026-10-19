import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createMemoryHistory, createRouter } from 'vue-router';
import { APP_VERSION } from '../../../constants/version';

const mocks = vi.hoisted(() => ({
  getCacheInfo: vi.fn().mockResolvedValue({ bytes: 52.8 * 1024 * 1024, imageBytes: 48.4 * 1024 * 1024, webviewBytes: 0, updateBytes: 4.4 * 1024 * 1024, path: 'C:\\Cache' }),
  getTabConfig: vi.fn().mockResolvedValue({ data: { 'search.tab': 'all,product,feed,apk' } }),
  clearAppCache: vi.fn().mockResolvedValue({ bytes: 0 }),
  cleanExpiredCache: vi.fn().mockResolvedValue(undefined),
  openCacheDirectory: vi.fn().mockResolvedValue('C:\\Cache'),
  getHitHistory: vi.fn().mockResolvedValue({ data: [] }),
  getFavoriteList: vi.fn().mockResolvedValue({ data: [] }),
  exportJsonFile: vi.fn().mockResolvedValue('C:\\Downloads\\export.json'),
  openUrl: vi.fn().mockResolvedValue(undefined),
  listAccounts: vi.fn().mockResolvedValue({ data: [] }),
  getUserCookie: vi.fn().mockResolvedValue(''),
  open: vi.fn().mockResolvedValue(null),
  enable: vi.fn().mockResolvedValue(undefined),
  disable: vi.fn().mockResolvedValue(undefined),
  isEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));
vi.mock('../../../utils/resourceCache', () => ({
  clearResourceCache: vi.fn().mockResolvedValue(undefined),
  clearResourceMemoryCache: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/plugin-autostart', () => ({ enable: mocks.enable, disable: mocks.disable, isEnabled: mocks.isEnabled }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn(() => false),
}));
vi.mock('../../../utils/devicePresets', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../utils/devicePresets')>(),
  loadDevicePresets: vi.fn().mockResolvedValue([
    { id: 'official-13-pro', brand: 'Xiaomi', label: 'Xiaomi 13 pro', device: 'nuwa', model: '2210132C' },
    { id: 'official-k80', brand: 'Redmi', label: 'REDMI K80', device: 'zorn', model: '24117RK2CC' },
  ]),
}));
// Windows 10 动态磁贴设置区块仅在 isWindows10 为真时渲染，此处默认声明为真以便覆盖。
vi.mock('../../../utils/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/platform')>();
  return {
    ...actual,
    getPlatformInfo: vi.fn().mockResolvedValue({
      os: 'windows',
      arch: 'x86_64',
      isWindows10: true,
      supportsLiveTile: true,
    }),
  };
});

import AppearanceSettingsPage from '../AppearanceSettingsPage.vue';
import AccountSettingsPage from '../AccountSettingsPage.vue';
import AboutSettingsPage from '../AboutSettingsPage.vue';
import ContentSettingsPage from '../ContentSettingsPage.vue';
import DeviceSettingsPage from '../DeviceSettingsPage.vue';
import DownloadSettingsPage from '../DownloadSettingsPage.vue';
import NetworkSettingsPage from '../NetworkSettingsPage.vue';
import NotificationSettingsPage from '../NotificationSettingsPage.vue';
import PrivacySettingsPage from '../PrivacySettingsPage.vue';
import StartupSettingsPage from '../StartupSettingsPage.vue';
import SettingsLayout from '../SettingsLayout.vue';
import ShortcutSettingsPage from '../ShortcutSettingsPage.vue';
import { normalizeSettings, useSettingsStore } from '../../../stores/settings';
import { getPlatformInfo } from '../../../utils/platform';

const RouterViewStub = { template: '<div><slot :Component="null" /></div>' };
const RouterLinkStub = { props: ['to'], template: '<a><slot /></a>' };

function mountPage(component: Parameters<typeof mount>[0]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(component, { global: { plugins: [pinia], stubs: { 'router-link': RouterLinkStub, 'router-view': RouterViewStub } } });
  return { wrapper, settings: useSettingsStore(pinia) };
}

describe('设置页面交互', () => {
  it('外观页只提供一个默认关闭的液态玻璃总开关', async () => {
    const { wrapper, settings } = mountPage(AppearanceSettingsPage);
    try {
      const rows = wrapper.findAll('.setting-row');
      const glassRows = rows.filter(row => row.text().includes('液态玻璃'));
      expect(glassRows).toHaveLength(1);
      expect(settings.settings.headerGlass).toBe(false);
      await glassRows[0].get('.switch-input').setValue(true);
      expect(settings.settings.headerGlass).toBe(true);
      await glassRows[0].get('.switch-input').setValue(false);
      expect(settings.settings.headerGlass).toBe(false);
    } finally { wrapper.unmount(); }
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as any).__TAURI_INTERNALS__;
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('外观页覆盖主题、强调色、字体、字号、密度和栏目显隐', async () => {
    const { wrapper, settings } = mountPage(AppearanceSettingsPage);
    await wrapper.findAll('.theme-card')[1].trigger('click');
    await wrapper.findAll('.accent-swatch')[1].trigger('click');
    vi.mocked(invoke).mockResolvedValueOnce('Noto Sans SC');
    await wrapper.get('.font-picker-button').trigger('click');
    await flushPromises();
    await wrapper.findAll('.density-card')[2].trigger('click');
    await wrapper.findAll('.setting-row').find((row) => row.text().includes('显示顶部页面标签栏'))!.find('.switch-input').setValue(false);
    await wrapper.findAll('.setting-row').find((row) => row.text().includes('禁止窄窗口自动切换手机模式'))!.find('.switch-input').setValue(true);
    await wrapper.findAll('.setting-row').find((row) => row.text().includes('评论显示在右侧'))!.find('.switch-input').setValue(false);
    await wrapper.findAll('.zoom-btn')[3].trigger('click');
    await wrapper.find('.nav-toggle-card input').setValue(false);
    expect(wrapper.find('.nav-main-grid').text()).not.toContain('应用');
    expect(wrapper.find('.nav-main-grid').text()).not.toContain('下载');
    expect(wrapper.find('.nav-main-grid').text()).toContain('更多服务');
    expect(wrapper.find('.nav-more-services-settings').exists()).toBe(false);
    expect(wrapper.findAll('.nav-toggle-card').some((card) => card.text().includes('应用'))).toBe(false);
    expect(wrapper.findAll('.nav-toggle-card').some((card) => card.text().includes('下载'))).toBe(false);
    expect(settings.settings.theme).toBe('dark');
    expect(settings.settings.accentColor).toBe('blue');
    expect(settings.settings.fontFamily).toBe('Noto Sans SC');
    expect(settings.settings.density).toBe('compact');
    expect(settings.settings.showPageTabBar).toBe(false);
    expect(settings.settings.disableAutoMobileMode).toBe(true);
    expect(settings.settings.desktopCommentsOnRight).toBe(false);
    expect(settings.settings.fontSize).toBe(16);
    const appearanceRows = wrapper.findAll('.setting-row');
    const desktopDetailRow = appearanceRows.find((row) => row.text().includes('点击动态进入详情页'))!;
    await desktopDetailRow.find('.switch-input').setValue(true);
    expect(settings.settings.desktopFeedDetailOnClick).toBe(true);
    expect(settings.settings.desktopCommentsOnRight).toBe(false);
    const rightCommentsRow = appearanceRows.find((row) => row.text().includes('评论显示在右侧'))!;
    await rightCommentsRow.find('.switch-input').setValue(true);
    expect(settings.settings.desktopCommentsOnRight).toBe(true);
    expect(appearanceRows.some(row => row.text().includes('默认显示右侧评论'))).toBe(false);
    expect(settings.settings.navVisibility?.home).toBe(false);
  });

  it('导航与个人中心栏目默认折叠，展开和收起不改变已保存的开关', async () => {
    const { wrapper, settings } = mountPage(AppearanceSettingsPage);
    const main = wrapper.get<HTMLDetailsElement>('.nav-main-disclosure');
    const personal = wrapper.get<HTMLDetailsElement>('.nav-more-settings');
    expect(main.element.open).toBe(false);
    expect(personal.element.open).toBe(false);
    await main.get('summary').trigger('click');
    expect(main.element.open).toBe(true);
    await main.get('.nav-toggle-card input').setValue(false);
    expect(settings.settings.navVisibility?.home).toBe(false);
    await main.get('summary').trigger('click');
    expect(main.element.open).toBe(false);
    expect(settings.settings.navVisibility?.home).toBe(false);
    await personal.get('summary').trigger('click');
    expect(personal.element.open).toBe(true);
    await personal.get('.nav-more-master-row input').setValue(false);
    expect(settings.settings.navVisibility?.my).toBe(false);
    expect(personal.find('.nav-more-grid').exists()).toBe(false);
    await personal.get('summary').trigger('click');
    expect(personal.element.open).toBe(false);
    expect(settings.settings.navVisibility?.my).toBe(false);
    wrapper.unmount();
  });

  it('外观设置可选择浅灰底色、自定义颜色并恢复默认', async () => {
    const { wrapper, settings } = mountPage(AppearanceSettingsPage);
    try {
      const options = wrapper.findAll('.light-background-option');
      await options.find(option => option.text().includes('柔和浅灰'))!.trigger('click');
      expect(settings.settings.lightBackgroundColor).toBe('#e5e7eb');
      await wrapper.get('input[type="color"]').setValue('#e6eee8');
      expect(settings.settings.lightBackgroundColor).toBe('#e6eee8');
      await options.find(option => option.text().includes('默认'))!.trigger('click');
      expect(settings.settings.lightBackgroundColor).toBe('');
    } finally { wrapper.unmount(); }
  });

  it('内容页覆盖正文、链接和关键词设置', async () => {
    const { wrapper, settings } = mountPage(ContentSettingsPage);
    expect(wrapper.text()).not.toContain('进入详情时展示图片');
    const selects = wrapper.findAll('select');
    await selects[0].setValue('18');
    await wrapper.get('.text-input').setValue('广告');
    await wrapper.get('.keyword-input-row button').trigger('click');
    await wrapper.get('.text-input').setValue('广告');
    await wrapper.get('.keyword-input-row button').trigger('click');
    expect(settings.settings.collapseLines).toBe(18);
    const backgroundRow = wrapper.findAll('.setting-row').find(row => row.text().includes('显示动态背景图'))!;
    await backgroundRow.get('.switch-input').setValue(false);
    expect(settings.settings.showFeedBackground).toBe(false);
    expect(wrapper.text()).not.toContain('默认评论排序');
    const contentRows = wrapper.findAll('.setting-row');
    await contentRows.find((row) => row.text().includes('Live 图片自动播放声音'))!.find('.switch-input').setValue(true);
    await contentRows.find((row) => row.text().includes('不再提醒 Live 图片编码问题'))!.find('.switch-input').setValue(true);
    await contentRows.find((row) => row.text().includes('打开图片自动加载原图'))!.find('.switch-input').setValue(false);
    expect(settings.settings.autoPlayLivePhotoSound).toBe(true);
    expect(settings.settings.suppressUnsupportedLivePhotoCodecPrompt).toBe(true);
    expect(settings.settings.autoLoadOriginalImage).toBe(false);
    const noImageRow = contentRows.find((row) => row.text().includes('无图模式'))!;
    await noImageRow.find('.switch-input').setValue(true);
    expect(settings.settings.noImageMode).toBe(true);
    const detailImagesRow = wrapper.findAll('.setting-row').find(row => row.text().includes('进入详情时展示图片'))!;
    await detailImagesRow.get('.switch-input').setValue(true);
    expect(settings.settings.showImagesInDetail).toBe(true);
    expect(settings.settings.blockedKeywords).toEqual(['广告']);
    await wrapper.get('.chip-remove').trigger('click');
    expect(settings.settings.blockedKeywords).toEqual([]);
  });

  it('内容偏好可调整搜索分类顺序，综合固定，支持恢复默认', async () => {
    const { wrapper, settings } = mountPage(ContentSettingsPage);
    await flushPromises();
    const disclosure = wrapper.get<HTMLDetailsElement>('.search-order-group');
    expect(disclosure.element.open).toBe(false);
    expect(wrapper.find('.search-order-list').exists()).toBe(false);
    disclosure.element.open = true;
    await disclosure.trigger('toggle');
    const labels = () => wrapper.findAll('.search-order-label').map(item => item.text());
    expect(labels()).toEqual(['综合', '数码', '动态', '应用']);
    expect(wrapper.find('.search-order-actions').exists()).toBe(false);
    expect(wrapper.get('.search-order-fixed').find('button').exists()).toBe(false);
    await wrapper.get('[aria-label="拖动调整应用顺序"]').trigger('keydown', { key: 'ArrowUp', altKey: true });
    await wrapper.get('[aria-label="拖动调整应用顺序"]').trigger('keydown', { key: 'ArrowUp', altKey: true });
    expect(labels()).toEqual(['综合', '应用', '数码', '动态']);
    expect(settings.settings.searchTabOrder).toEqual(['apk', 'product', 'feed']);
    await wrapper.get('[aria-label="拖动调整应用顺序"]').trigger('keydown', { key: 'ArrowDown', altKey: true });
    expect(settings.settings.searchTabOrder).toEqual(['product', 'apk', 'feed']);
    await wrapper.get('.search-order-heading button').trigger('click');
    expect(settings.settings.searchTabOrder).toEqual([]);
    expect(labels()).toEqual(['综合', '数码', '动态', '应用']);
    disclosure.element.open = false;
    await disclosure.trigger('toggle');
    expect(wrapper.find('.search-order-list').exists()).toBe(false);
    wrapper.unmount();
  });

  it('通知页覆盖通知开关和轮询间隔', async () => {
    const { wrapper, settings } = mountPage(NotificationSettingsPage);
    const switches = wrapper.findAll('.switch-input');
    await switches[3].setValue(true);
    await wrapper.find('select').setValue('30');
    expect(settings.settings.desktopNotifications).toBe(true);
    expect(settings.settings.notificationPollInterval).toBe(30);
  });

  it('隐私页同步设备签名', async () => {
    const { wrapper, settings } = mountPage(PrivacySettingsPage);
    await wrapper.get('.text-input').setValue('测试设备');
    expect(settings.settings.deviceSignature).toBe('测试设备');
  });

  it('启动页覆盖首页、Windows 10 动态磁贴开关与数据源、开发预览说明、关闭行为、更新渠道和窗口行为', async () => {
    const { wrapper, settings } = mountPage(StartupSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain('Windows 10 动态磁贴（开发预览）');
    expect(wrapper.find('.live-tile-guide').text()).toContain('dev-live-tile.ps1');

    const findRow = (label: string) =>
      wrapper.findAll('.setting-row').find((row) => row.find('.row-label').text() === label)!;
    await findRow('启动后默认页签').find('select').setValue('secondhand');
    await findRow('实验性功能').find('.switch-input').setValue(true);
    await findRow('更新渠道').find('select').setValue('beta');
    await findRow('启用动态磁贴').find('.switch-input').setValue(true);
    await findRow('磁贴数据源').find('select').setValue('hot');
    await findRow('关闭主窗口时').find('select').setValue('tray');
    await findRow('窗口置顶').find('.switch-input').setValue(true);

    expect(settings.settings.defaultHomeTab).toBe('secondhand');
    expect(settings.settings.liveTileEnabled).toBe(true);
    expect(settings.settings.liveTileSource).toBe('hot');
    expect(settings.settings.closeToTray).toBe(true);
    expect(settings.settings.experimentalFeatures).toBe(true);
    expect(settings.settings.updateChannel).toBe('beta');
    expect(settings.settings.alwaysOnTop).toBe(true);
  });

  it('非 Windows 10 环境下隐藏动态磁贴设置区块', async () => {
    vi.mocked(getPlatformInfo).mockResolvedValueOnce({
      os: 'windows',
      arch: 'x86_64',
      isWindows10: false,
      supportsLiveTile: false,
    });
    const { wrapper } = mountPage(StartupSettingsPage);
    await flushPromises();
    expect(wrapper.text()).not.toContain('Windows 10 动态磁贴（开发预览）');
  });

  it('磁贴开关默认关闭、数据源默认推荐，且非法值被归一化回默认', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const settings = useSettingsStore(pinia);
    await settings.initializeSettings();
    expect(settings.settings.liveTileEnabled).toBe(false);
    expect(settings.settings.liveTileSource).toBe('index_v8');

    // 非法值必须被白名单拒绝并回落，而不是被静默丢弃导致 undefined
    const normalized = normalizeSettings({ liveTileEnabled: 'invalid', liveTileSource: 'not_a_source' } as never);
    expect(normalized.liveTileEnabled).toBe(false);
    expect(normalized.liveTileSource).toBe('index_v8');
  });

  it('设备页覆盖设备指纹输入、预设、警告和恢复默认', async () => {
    const { wrapper, settings } = mountPage(DeviceSettingsPage);
    await flushPromises();
    await wrapper.find('.switch-input').setValue(true);
    expect(wrapper.findAll('.catalog-field > .row-label').map(label => label.text())).toEqual(['品牌', '系列', '机型', '型号']);
    expect(wrapper.get('[aria-label="机型系列"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[aria-label="机型系列"]').text()).toContain('请先选择品牌');
    const inputs = wrapper.findAll('input[type="text"]');
    Object.assign(settings.settings.deviceFingerprint, { deviceId: 'saved-id', androidVersion: '15', build: 'actual-build', sdkInt: '35' });
    await wrapper.get('[aria-label="搜索官方机型表"]').setValue('nuwa');
    await wrapper.get('[aria-label="机型品牌"]').setValue('xiaomi');
    await wrapper.get('[aria-label="机型系列"]').setValue('数字系列');
    await wrapper.get('[aria-label="机型名称"]').setValue('Xiaomi 13 pro');
    expect(wrapper.get('[aria-label="官方机型表"]').text()).toContain('2210132C');
    expect(wrapper.get('[aria-label="官方机型表"]').text()).not.toContain('24117RK2CC');
    await wrapper.get('[aria-label="官方机型表"]').setValue('official-13-pro');
    expect(settings.settings.deviceFingerprint.model).toBe('2210132C');
    expect(wrapper.get('.catalog-selection').text()).toBe('已选择：Xiaomi > 数字系列 > Xiaomi 13 pro > 2210132C');
    expect(settings.settings.deviceFingerprint.androidVersion).toBe('15');
    expect(settings.settings.deviceFingerprint.build).toBe('actual-build');
    expect(settings.settings.deviceFingerprint.sdkInt).toBe('35');
    await wrapper.get('[aria-label="ROM 信息"]').setValue('HyperOS_3.0; 3.0.310.0');
    expect(wrapper.get('.preview-box').text()).toContain('; HyperOS_3.0; 3.0.310.0)');
    await wrapper.get('[aria-label="官方机型表"]').setValue('');
    expect((wrapper.get('[aria-label="官方机型表"]').element as HTMLSelectElement).value).toBe('');
    const appCodeInput = inputs.find((i) => i.attributes('placeholder') === '2610162') || inputs[5];
    await appCodeInput.setValue('2600000');
    expect(wrapper.find('.version-warning').exists()).toBe(true);
    await wrapper.get('.reset-button').trigger('click');
    expect(settings.settings.deviceFingerprint.model).toBe('23113RKC6C');
    expect(settings.settings.deviceFingerprint.appCode).toBe('2610162');
    expect(settings.settings.deviceFingerprint.sdkInt).toBe('36');
    expect(settings.settings.deviceFingerprint.deviceId).toBe('saved-id');
    expect(settings.settings.deviceFingerprint.rom).toBe('');
  });

  it('设备页支持数盟设备 ID 输入、智能提取与保存', async () => {
    const { wrapper, settings } = mountPage(DeviceSettingsPage);
    await flushPromises();
    const deviceIdInput = wrapper.find('.full-width-input');
    await deviceIdInput.setValue('设备ID: DU-MOCK-SAMPLE-DEVICE-ID-12345\nShuzlmID: DU-MOCK-SAMPLE-DEVICE-ID-12345');
    expect(wrapper.find('.success-tip').exists()).toBe(true);
    await wrapper.find('.primary-btn').trigger('click');
    expect(settings.settings.deviceFingerprint.deviceId).toBe('DU-MOCK-SAMPLE-DEVICE-ID-12345');
  });

  it('设备页展示原生默认机型和默认 UA', async () => {
    vi.mocked(invoke).mockImplementation(async (command) => command === 'get_device_info' ? {
      code: 200, data: { loggedIn: true, deviceCode: 'encoded-device', defaultProfile: {
        source: 'native', brand: 'Apple', model: 'iPhone17,3', userAgent: 'native-ios-user-agent',
      } },
    } : undefined);
    const { wrapper } = mountPage(DeviceSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain('Apple iPhone17,3（本机真实设备）');
    expect(wrapper.get('.native-ua').text()).toBe('native-ios-user-agent');
    await wrapper.find('.switch-input').setValue(true);
    expect(wrapper.find('.native-ua').exists()).toBe(false);
    wrapper.unmount();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it('设备页仅点击生成按钮后为登录账号启用生成值，不覆盖手动配置', async () => {
    const manual = { loggedIn: true, deviceCode: 'manual-code', deviceId: 'DUmanual123456', deviceIdSource: 'manual' };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_device_info' || command === 'use_saved_device_identity') return { code: 200, data: manual };
      if (command === 'generate_device_identity') return { code: 200, data: { ...manual, deviceId: 'DUgenerated123456', deviceIdSource: 'generated_account' } };
      return undefined;
    });
    const { wrapper, settings } = mountPage(DeviceSettingsPage);
    settings.settings.deviceFingerprint.deviceId = 'DUmanual123456';
    try {
      await flushPromises();
      expect(invoke).not.toHaveBeenCalledWith('generate_device_identity');
      const generate = wrapper.findAll('button').find(button => button.text() === '自动生成并使用')!;
      await generate.trigger('click');
      await flushPromises();
      expect(invoke).toHaveBeenCalledWith('generate_device_identity');
      expect(wrapper.text()).toContain('当前账号已保存（DUgenerated123456）');
      expect(settings.settings.deviceFingerprint.deviceId).toBe('DUmanual123456');
      await wrapper.findAll('button').find(button => button.text() === '使用手动配置')!.trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('手动配置（DUmanual123456）');
    } finally { wrapper.unmount(); vi.mocked(invoke).mockResolvedValue(undefined); }
  });

  it('生成期间禁用按钮，失败后保留原设备信息并允许重试', async () => {
    let rejectGeneration!: (reason: Error) => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_device_info') return { code: 200, data: { loggedIn: false, deviceCode: 'guest', deviceId: 'DUguest123456', deviceIdSource: 'generated_guest' } };
      if (command === 'generate_device_identity') return await new Promise((_resolve, reject) => { rejectGeneration = reject; });
      return undefined;
    });
    const { wrapper } = mountPage(DeviceSettingsPage);
    try {
      await flushPromises();
      const generate = wrapper.findAll('button').find(button => button.text() === '自动生成并使用')!;
      await generate.trigger('click');
      expect(generate.attributes('disabled')).toBeDefined();
      rejectGeneration(new Error('获取失败'));
      await flushPromises();
      expect(generate.attributes('disabled')).toBeUndefined();
      expect(wrapper.text()).toContain('游客自动生成（DUguest123456）');
    } finally { wrapper.unmount(); vi.mocked(invoke).mockResolvedValue(undefined); }
  });

  it('下载页展示缓存总量与明细', async () => {
    const { wrapper } = mountPage(DownloadSettingsPage);
    await flushPromises();
    expect(wrapper.get('.cache-total-value').text()).toContain('48.4 MB');
    expect(wrapper.get('.cache-breakdown').text()).toContain('图片');
    expect(wrapper.get('.cache-breakdown').text()).toContain('48.4 MB');
    expect(wrapper.get('.cache-breakdown').text()).toContain('独立保留');
    expect(wrapper.text()).not.toContain('HTTP 代理');
    expect(mocks.getCacheInfo).toHaveBeenCalled();
  });

  it('网络页应用全局代理地址', async () => {
    const { wrapper, settings } = mountPage(NetworkSettingsPage);
    await flushPromises();
    (window as any).__TAURI_INTERNALS__ = {};
    await wrapper.get('#proxy-type').setValue('socks5h');
    await wrapper.get('#proxy-address').setValue('127.0.0.1:7890');
    await wrapper.findAll('.action-button')[1].trigger('click');
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('set_network_proxy', { proxyUrl: 'socks5h://127.0.0.1:7890' });
    expect(settings.settings.networkProxyUrl).toBe('socks5h://127.0.0.1:7890');
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('网络页测试草稿代理时不应用设置', async () => {
    const { wrapper, settings } = mountPage(NetworkSettingsPage);
    await flushPromises();
    await wrapper.get('#proxy-type').setValue('socks4');
    await wrapper.get('#proxy-address').setValue('127.0.0.1:1080');
    vi.mocked(invoke).mockResolvedValueOnce({ statusCode: 200, elapsedMs: 42 });
    await wrapper.findAll('.action-button')[0].trigger('click');
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('test_network_proxy', { proxyUrl: 'socks4://127.0.0.1:1080' });
    expect(wrapper.get('[role="status"]').text()).toContain('42 ms');
    expect(settings.settings.networkProxyUrl).toBe('');
  });

  it('PC 设置保留左侧分类栏，窄窗口禁用手机模式后仍使用 PC 布局', async () => {
    vi.stubGlobal('innerWidth', 1024);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/:category', component: { template: '<div />' } }] });
    await router.push('/settings/appearance');
    await router.isReady();
    const pinia = createPinia();
    const settings = useSettingsStore(pinia);
    const wrapper = mount(SettingsLayout, { global: { plugins: [pinia, router], stubs: { 'router-view': RouterViewStub } } });
    expect(wrapper.findAll('.settings-menu-item')).toHaveLength(13);
    expect(wrapper.get('.settings-sidebar .settings-title').text()).toBe('设置中心');
    expect(wrapper.get('.settings-menu-item.is-active').text()).toBe('外观设置');
    expect(wrapper.find('.settings-category-trigger').exists()).toBe(false);
    await wrapper.get('a[href="/settings/diagnostics"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/diagnostics');
    expect(wrapper.get('.settings-menu-item.is-active').text()).toBe('诊断日志');

    vi.stubGlobal('innerWidth', 390);
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    await wrapper.get('.settings-category-trigger').trigger('click');
    settings.settings.disableAutoMobileMode = true;
    await flushPromises();
    expect(wrapper.find('.settings-sidebar').exists()).toBe(true);
    expect(wrapper.find('.settings-category-trigger').exists()).toBe(false);
    expect(wrapper.find('.settings-category-backdrop').exists()).toBe(false);
    expect(wrapper.get('.settings-layout-card').classes()).not.toContain('is-mobile');
    settings.settings.disableAutoMobileMode = false;
    await flushPromises();
    expect(wrapper.find('.settings-category-panel').exists()).toBe(false);
    wrapper.unmount();
  });

  it('移动设置下拉菜单包含全部分类，切换分类与返回时同步当前页面', async () => {
    vi.stubGlobal('innerWidth', 390);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings/:category', component: { template: '<div />' } }] });
    await router.push('/settings/appearance');
    await router.isReady();
    const wrapper = mount(SettingsLayout, { global: { plugins: [createPinia(), router], stubs: { 'router-view': RouterViewStub } } });
    await wrapper.get('.settings-category-trigger').trigger('click');
    expect(wrapper.findAll('.settings-category-card')).toHaveLength(13);
    expect(wrapper.text()).toContain('网络代理');
    expect(wrapper.text()).toContain('诊断日志');
    expect(wrapper.text()).toContain('账号与安全');
    expect(wrapper.text()).toContain('个人信息');
    expect(wrapper.text()).toContain('设备信息');
    const trigger = wrapper.get('.settings-category-trigger');
    expect(trigger.text()).toContain('外观设置');
    expect(wrapper.get('.settings-category-card.is-active').text()).toContain('外观设置');
    await wrapper.findAll('.settings-category-card').find(card => card.text() === '诊断日志')!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings/diagnostics');
    await router.push('/settings/about');
    await flushPromises();
    expect(trigger.text()).toContain('关于酷安');
    router.back();
    await flushPromises();
    expect(trigger.text()).toContain('诊断日志');
    expect(wrapper.find('.settings-category-panel').exists()).toBe(false);
    await trigger.trigger('click');
    await wrapper.get('.settings-category-backdrop').trigger('click');
    expect(wrapper.find('.settings-category-panel').exists()).toBe(false);
    await trigger.trigger('click');
    await wrapper.get('.settings-category-panel').trigger('keydown', { key: 'Escape' });
    expect(trigger.attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
  });

  it('快捷键页展示全部快捷键并可设置私信回车行为', async () => {
    const { wrapper, settings } = mountPage(ShortcutSettingsPage);
    expect(wrapper.findAll('.setting-row')).toHaveLength(12);
    expect(wrapper.text()).toContain('Ctrl+K');
    expect(wrapper.text()).toContain('Esc');
    expect(wrapper.text()).toContain('C');
    await wrapper.get('select').setValue('newline');
    expect(settings.settings.messageEnterBehavior).toBe('newline');
  });

  it('关于页展示版本信息并支持打开链接和检查更新', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stargazers_count: 1200, forks_count: 12, open_issues_count: 3 }) }));
    const eventSpy = vi.spyOn(window, 'dispatchEvent');
    const { wrapper } = mountPage(AboutSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain(APP_VERSION);
    expect(wrapper.get('.about-channel').text()).toBe(`${APP_VERSION.includes('-') ? '测试版' : '稳定版'} · 稳定版更新渠道`);
    expect(wrapper.text()).toContain('1.2k');
    await wrapper.get('.about-head button').trigger('click');
    expect(eventSpy).toHaveBeenCalled();
    await wrapper.find('[title="打开项目主页"]').trigger('click');
    expect(mocks.openUrl).toHaveBeenCalledWith('https://github.com/coolapk-desktop/coolapk-desktop', 'system');
    expect(wrapper.text()).toContain('coolapk-desktop · GitHub');
    mocks.openUrl.mockClear();
    const feedbackButton = wrapper.findAll('button').find(button => button.text().includes('提交反馈'))!;
    await feedbackButton.trigger('click');
    const [issueUrl, target] = mocks.openUrl.mock.calls[0]!;
    expect(target).toBe('system');
    expect(new URL(String(issueUrl)).href).toContain('github.com/coolapk-desktop/coolapk-desktop/issues/new');
    expect(new URL(String(issueUrl)).searchParams.get('body')).toContain(APP_VERSION);
    vi.unstubAllGlobals();
  });

  it('关于页切换更新渠道时仍保留安装版本类型', async () => {
    const { wrapper, settings } = mountPage(AboutSettingsPage);
    settings.settings.updateChannel = 'beta';
    await flushPromises();
    expect(wrapper.get('.about-channel').text()).toBe(`${APP_VERSION.includes('-') ? '测试版' : '稳定版'} · 测试版更新渠道`);
  });

  it('账号页在没有本地账户时展示空状态', async () => {
    const { wrapper } = mountPage(AccountSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain('暂无保存的账户');
    expect(mocks.listAccounts).toHaveBeenCalled();
  });
});
