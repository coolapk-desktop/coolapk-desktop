import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { buildDeviceUserAgent, normalizeSettings, useSettingsStore } from '../../stores/settings';
import type { AppSettings } from '../../types/settings';

const fileStoreState = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const store = {
    entries: async <T>() => Array.from(values.entries()) as Array<[string, T]>,
    keys: async () => Array.from(values.keys()),
    set: async (key: string, value: unknown) => { values.set(key, value); },
    delete: async (key: string) => values.delete(key),
    save: vi.fn(async () => undefined),
  };
  return { values, store, load: vi.fn(async () => store) };
});

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: fileStoreState.load } }));

describe('settings store', () => {
  it('图片自适应排列默认关闭，保留保存的布尔值并忽略无效配置', () => {
    expect(normalizeSettings({}).adaptiveFeedImages).toBe(false);
    expect(normalizeSettings({ adaptiveFeedImages: true }).adaptiveFeedImages).toBe(true);
    expect(normalizeSettings({ adaptiveFeedImages: false }).adaptiveFeedImages).toBe(false);
    expect(normalizeSettings({ adaptiveFeedImages: 'true' }).adaptiveFeedImages).toBe(false);
  });
  it('液态玻璃总开关默认关闭，保留已保存的选择', () => {
    expect(normalizeSettings({}).headerGlass).toBe(false);
    expect(normalizeSettings({ headerGlass: true }).headerGlass).toBe(true);
    expect(normalizeSettings({ headerGlass: false }).headerGlass).toBe(false);
  });

  it('液态玻璃总开关即时应用', async () => {
    const store = useSettingsStore();
    expect(document.documentElement.getAttribute('data-header-glass')).toBe('off');
    store.settings.headerGlass = true;
    await nextTick();
    expect(document.documentElement.getAttribute('data-header-glass')).toBe('on');
    store.settings.headerGlass = false;
    await nextTick();
    expect(document.documentElement.getAttribute('data-header-glass')).toBe('off');
  });

  it('旧配置默认显示动态背景，并保留用户关闭的选择', () => {
    expect(normalizeSettings({}).showFeedBackground).toBe(true);
    expect(normalizeSettings({ showFeedBackground: false }).showFeedBackground).toBe(false);
  });
  it('自定义浅色底色即时应用，恢复默认后移除自定义变量', async () => {
    const store = useSettingsStore();
    store.settings.lightBackgroundColor = '#e5e7eb';
    await nextTick();
    expect(document.documentElement.getAttribute('data-light-background')).toBe('custom');
    expect(document.documentElement.style.getPropertyValue('--light-custom-page')).toBe('#e5e7eb');
    store.settings.lightBackgroundColor = '';
    await nextTick();
    expect(document.documentElement.hasAttribute('data-light-background')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--light-custom-page')).toBe('');
    expect(normalizeSettings({ lightBackgroundColor: 'bad' }).lightBackgroundColor).toBe('');
  });
  it('详情显示图片默认关闭，并保留已保存的开关', () => {
    expect(normalizeSettings({}).showImagesInDetail).toBe(false);
    expect(normalizeSettings({ showImagesInDetail: true }).showImagesInDetail).toBe(true);
  });
  it('旧配置默认开启滚动隐藏导航，并保留用户明确关闭的选择', () => {
    expect(normalizeSettings({}).autoHideMobileNavigation).toBe(true);
    expect(normalizeSettings({ autoHideMobileNavigation: false }).autoHideMobileNavigation).toBe(false);
  });
  it('applies a client proxy on every platform and keeps the saved value after success', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    const store = useSettingsStore();
    expect(await store.setNetworkProxyUrl(' http://127.0.0.1:7890 ')).toBe(true);
    expect(invoke).toHaveBeenCalledWith('set_network_proxy', { proxyUrl: 'http://127.0.0.1:7890' });
    expect(store.settings.networkProxyUrl).toBe('http://127.0.0.1:7890');
    expect(await store.setNetworkProxyUrl('')).toBe(true);
    expect(invoke).toHaveBeenCalledWith('set_network_proxy', { proxyUrl: null });
    expect(store.settings.networkProxyUrl).toBe('');
  });

  it('does not save a proxy address when the native client rejects it', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = useSettingsStore();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('invalid proxy'));
    expect(await store.setNetworkProxyUrl('invalid')).toBe(false);
    expect(store.settings.networkProxyUrl).toBe('');
    warning.mockRestore();
  });

  it('moves the previous download proxy into the global proxy setting', () => {
    expect(normalizeSettings({ proxyUrl: 'http://127.0.0.1:7890' }).networkProxyUrl).toBe('http://127.0.0.1:7890');
    expect(normalizeSettings({ proxyUrl: 'http://old:7890', networkProxyUrl: 'http://new:7890' }).networkProxyUrl).toBe('http://new:7890');
  });

  it('synchronizes selected device identity while preserving saved device IDs', async () => {
    setActivePinia(createPinia());
    const store = useSettingsStore();
    (window as any).__TAURI_INTERNALS__ = {};
    Object.assign(store.settings.deviceFingerprint, {
      customFingerprint: true, manufacturer: 'Samsung', brand: 'samsung',
      model: 'SM-S9280', deviceId: 'saved-id', androidVersion: '15', sdkInt: '35',
    });
    await store.syncDeviceProfile(store.settings);
    expect(invoke).toHaveBeenCalledWith('update_device_profile', {
      profile: expect.objectContaining({ manufacturer: 'Samsung', brand: 'samsung', model: 'SM-S9280', deviceId: 'saved-id', sdkInt: '35' }),
    });
    expect(buildDeviceUserAgent(store.settings.deviceFingerprint)).toContain('(#Build; samsung; SM-S9280; AQ3A.250226.002; 15)');
    store.settings.deviceFingerprint.rom = 'HyperOS_3.0; 3.0.310.0';
    await store.syncDeviceProfile(store.settings);
    expect(invoke).toHaveBeenLastCalledWith('update_device_profile', {
      profile: expect.objectContaining({ userAgent: expect.stringContaining('; HyperOS_3.0; 3.0.310.0)') }),
    });
    store.settings.deviceFingerprint.customFingerprint = false;
    await store.syncDeviceProfile(store.settings);
    expect(invoke).toHaveBeenLastCalledWith('update_device_profile', { profile: { deviceId: 'saved-id' } });
  });

  it('migrates legacy device settings and preserves custom ROM information', () => {
    const legacy = normalizeSettings({ deviceFingerprint: { androidVersion: '15', model: '2210132C', deviceId: 'saved-id' } });
    expect(legacy.deviceFingerprint.rom).toBe('');
    expect(legacy.deviceFingerprint.deviceId).toBe('saved-id');
    expect(buildDeviceUserAgent(legacy.deviceFingerprint)).toContain('; 15) +CoolMarket/');
    const custom = normalizeSettings({ deviceFingerprint: { rom: ' HyperOS_3.0; 3.0.310.0 ' } });
    expect(custom.deviceFingerprint.rom).toBe('HyperOS_3.0; 3.0.310.0');
    expect(buildDeviceUserAgent({ ...legacy.deviceFingerprint, androidVersion: '', rom: ' ' })).toContain('; 16) +CoolMarket/');
  });

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    delete (window as any).__TAURI_INTERNALS__;
    fileStoreState.values.clear();
    fileStoreState.load.mockClear();
    fileStoreState.store.save.mockClear();
    vi.mocked(invoke).mockClear();
  });

  const defaults: Partial<AppSettings> = {
    theme: 'system',
    density: 'standard',
    fontFamily: '',
    fontSize: 15,
    zoom: 100,
    accentColor: 'green',
    collapseLines: 12,
    autoPlayGif: true,
    autoPlayLivePhotoSound: false,
    suppressUnsupportedLivePhotoCodecPrompt: false,
    autoLoadOriginalImage: true,
    noImageMode: false,
    imageQuality: 'hd',
    messageEnterBehavior: 'send',
    favoriteCollectionViewMode: 'large',
    favoriteCollectionSortMode: 'default',
    favoriteCollectionSortDirection: 'asc',
    desktopCommentsOnRight: false,
    desktopFeedDetailOnClick: false,
  };

  it('loads default settings when localStorage is empty', () => {
    const store = useSettingsStore();
    expect(store.settings.theme).toBe(defaults.theme);
    expect(store.settings.fontFamily).toBe(defaults.fontFamily);
    expect(store.settings.fontSize).toBe(defaults.fontSize);
    expect(store.settings.accentColor).toBe(defaults.accentColor);
    expect(store.settings.imageQuality).toBe(defaults.imageQuality);
    expect(store.settings.autoPlayLivePhotoSound).toBe(defaults.autoPlayLivePhotoSound);
    expect(store.settings.suppressUnsupportedLivePhotoCodecPrompt).toBe(defaults.suppressUnsupportedLivePhotoCodecPrompt);
    expect(store.settings.autoLoadOriginalImage).toBe(defaults.autoLoadOriginalImage);
    expect(store.settings.noImageMode).toBe(defaults.noImageMode);
    expect(store.settings.favoriteCollectionViewMode).toBe(defaults.favoriteCollectionViewMode);
    expect(store.settings.favoriteCollectionSortMode).toBe(defaults.favoriteCollectionSortMode);
    expect(store.settings.favoriteCollectionSortDirection).toBe(defaults.favoriteCollectionSortDirection);
    expect(store.settings.desktopCommentsOnRight).toBe(defaults.desktopCommentsOnRight);
    expect(store.settings.desktopFeedDetailOnClick).toBe(defaults.desktopFeedDetailOnClick);
    expect(store.settings.navVisibility?.albums).toBe(true);
    expect(store.settings.navVisibility?.pictures).toBe(true);
    expect(store.settings.navVisibility?.downloads).toBe(true);
    expect(store.settings.rememberWindowState).toBe(true);
    expect(store.settings.showPageTabBar).toBe(true);
    expect(store.settings.disableAutoMobileMode).toBe(false);
    expect(store.settings.myRecentPinned).toBe(false);
    expect(store.settings.messageEnterBehavior).toBe(defaults.messageEnterBehavior);
  });

  it('保存并重新载入搜索分类顺序，旧设置沿用默认，损坏顺序会被规范化', async () => {
    expect(normalizeSettings({}).searchTabOrder).toEqual([]);
    expect(normalizeSettings({ searchTabOrder: ['all', 'apk', 'apk', '', 5, 'future'] }).searchTabOrder).toEqual(['apk', 'future']);
    const store = useSettingsStore();
    store.settings.searchTabOrder = ['apk', 'product', 'feed'];
    await nextTick();
    const reloaded = useSettingsStore(createPinia());
    expect(reloaded.settings.searchTabOrder).toEqual(['apk', 'product', 'feed']);
    reloaded.settings.searchTabOrder = [];
    await nextTick();
    expect(useSettingsStore(createPinia()).settings.searchTabOrder).toEqual([]);
  });

  it('normalizes malformed values and preserves valid nested settings', () => {
    const normalized = normalizeSettings({
      theme: 'invalid',
      fontFamily: 'Noto Sans SC',
      fontSize: 999,
      zoom: 1,
      updateChannel: 'beta',
      experimentalFeatures: false,
      blockedKeywords: ['广告', '', '广告', 123],
      navVisibility: { albums: false, pictures: 'false', downloads: false },
      deviceFingerprint: { customFingerprint: true, darkMode: '1' },
      autoPlayLivePhotoSound: true,
      suppressUnsupportedLivePhotoCodecPrompt: true,
      autoLoadOriginalImage: false,
      noImageMode: true,
      favoriteCollectionViewMode: 'double',
      favoriteCollectionSortMode: 'item-count-desc',
      myRecentPinned: true,
      showPageTabBar: false,
      disableAutoMobileMode: true,
      topicHubShowCommentsByDefault: false,
      messageEnterBehavior: 'newline',
    });
    expect(normalized.theme).toBe('system');
    expect(normalized.fontFamily).toBe('Noto Sans SC');
    expect(normalized.fontSize).toBe(20);
    expect(normalized.zoom).toBe(50);
    expect(normalized.updateChannel).toBe('stable');
    expect(normalized.blockedKeywords).toEqual(['广告']);
    expect(normalized.navVisibility?.albums).toBe(false);
    expect(normalized.navVisibility?.pictures).toBe(true);
    expect(normalized.navVisibility?.downloads).toBe(false);
    expect(normalized.deviceFingerprint.customFingerprint).toBe(true);
    expect(normalized.deviceFingerprint.darkMode).toBe('1');
    expect(normalized.autoPlayLivePhotoSound).toBe(true);
    expect(normalized.suppressUnsupportedLivePhotoCodecPrompt).toBe(true);
    expect(normalized.autoLoadOriginalImage).toBe(false);
    expect(normalized.noImageMode).toBe(true);
    expect(normalized.favoriteCollectionViewMode).toBe('double');
    expect(normalized.favoriteCollectionSortMode).toBe('item-count');
    expect(normalized.favoriteCollectionSortDirection).toBe('desc');
    expect(normalized.myRecentPinned).toBe(true);
    expect(normalized.showPageTabBar).toBe(false);
    expect(normalized.disableAutoMobileMode).toBe(true);
    expect(normalized.desktopCommentsOnRight).toBe(false);
    expect(normalized.messageEnterBehavior).toBe('newline');
    expect(normalizeSettings({}).desktopFeedDetailOnClick).toBe(false);
    expect(normalizeSettings({ desktopFeedDetailOnClick: 'yes' }).desktopFeedDetailOnClick).toBe(false);
    expect(normalizeSettings({ desktopFeedDetailOnClick: true }).desktopFeedDetailOnClick).toBe(true);
    expect(normalizeSettings({ rememberWindowState: false }).rememberWindowState).toBe(false);
  });

  it('忽略旧版评论排序设置', () => {
    expect(Object.prototype.hasOwnProperty.call(normalizeSettings({ commentSort: 'hot' }), 'commentSort')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(normalizeSettings({ commentSort: 'latest' }), 'commentSort')).toBe(false);
  });

  it('新安装与旧版升级均默认关闭右侧评论，首次迁移后保留用户的新选择', () => {
    expect(normalizeSettings({}).desktopCommentsOnRight).toBe(false);
    // 旧版已持久化的 true 也必须在第一次升级时重置。
    expect(normalizeSettings({ desktopCommentsOnRight: true }).desktopCommentsOnRight).toBe(false);
    expect(normalizeSettings({ topicHubShowCommentsByDefault: true, desktopFeedDetailOnClick: true }).desktopCommentsOnRight).toBe(false);
    const migrated = normalizeSettings({
      desktopCommentsOnRight: true, topicHubShowCommentsByDefault: true, desktopFeedDetailOnClick: true, theme: 'dark',
    });
    expect(migrated.desktopCommentsOnRight).toBe(false);
    expect(migrated.desktopCommentsDefaultOffMigrated).toBe(true);
    expect(migrated.theme).toBe('dark');
    // 标记完成后，用户再次打开或关闭时都应该保留其选择。
    expect(normalizeSettings({ ...migrated, desktopCommentsOnRight: true }).desktopCommentsOnRight).toBe(true);
    expect(normalizeSettings({ ...migrated, desktopCommentsOnRight: false }).desktopCommentsOnRight).toBe(false);
    expect(normalizeSettings({ ...migrated, desktopCommentsOnRight: 'true' }).desktopCommentsOnRight).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(migrated, 'topicHubShowCommentsByDefault')).toBe(false);
  });

  it('升级时将关闭状态持久化到 settings.json，手动重新打开不会被再次重置', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    fileStoreState.values.set('desktopCommentsOnRight', true);
    fileStoreState.values.set('theme', 'dark');
    const store = useSettingsStore();
    await store.initializeSettings();
    expect(store.settings.desktopCommentsOnRight).toBe(false);
    expect(store.settings.theme).toBe('dark');
    expect(fileStoreState.values.get('desktopCommentsOnRight')).toBe(false);
    expect(fileStoreState.values.get('desktopCommentsDefaultOffMigrated')).toBe(true);

    store.settings.desktopCommentsOnRight = true;
    await nextTick();
    await store.flushSettings();
    expect(fileStoreState.values.get('desktopCommentsOnRight')).toBe(true);
    const persisted = normalizeSettings(Object.fromEntries(fileStoreState.values));
    expect(persisted.desktopCommentsOnRight).toBe(true);
  });

  it('保留服务端动态首页频道的排序和隐藏状态', () => {
    const normalized = normalizeSettings({
      homeTabOrder: ['V9_HOME_TAB_HEADLINE', '__hidden__V11_HOME_TAB_NEWS', '', 'V9_HOME_TAB_HEADLINE'],
    });
    expect(normalized.homeTabOrder).toEqual([
      'V9_HOME_TAB_HEADLINE',
      '__hidden__V11_HOME_TAB_NEWS',
    ]);
  });

  it('falls back to legacy localStorage when the JSON store cannot load', async () => {
    localStorage.setItem('coolapk_desktop_settings', JSON.stringify({ theme: 'dark', fontSize: 19 }));
    (window as any).__TAURI_INTERNALS__ = {};
    fileStoreState.load.mockRejectedValueOnce(new Error('store unavailable'));
    const store = useSettingsStore();
    await store.initializeSettings();
    expect(store.settings.theme).toBe('dark');
    expect(store.settings.fontSize).toBe(19);
  });

  it('setTheme updates theme in settings', () => {
    const store = useSettingsStore();
    store.setTheme('dark');
    expect(store.settings.theme).toBe('dark');
  });

  it('Android 主题切换时同步状态栏背景和图标模式', async () => {
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Android');
    try {
      (window as any).__TAURI_INTERNALS__ = {};
      const store = useSettingsStore();
      store.setTheme('dark');
      await nextTick();
      expect(invoke).toHaveBeenCalledWith('set_android_system_bar_theme', { dark: true, profile: false, dimmed: false });
      store.setTheme('light');
      await nextTick();
      expect(invoke).toHaveBeenCalledWith('set_android_system_bar_theme', { dark: false, profile: false, dimmed: false });
      store.setAndroidProfileBackground(true);
      expect(invoke).toHaveBeenCalledWith('set_android_system_bar_theme', { dark: false, profile: true, dimmed: false });
      store.setTheme('dark');
      await nextTick();
      expect(invoke).toHaveBeenCalledWith('set_android_system_bar_theme', { dark: true, profile: true, dimmed: false });
      store.setAndroidProfileBackground(false);
      expect(invoke).toHaveBeenCalledWith('set_android_system_bar_theme', { dark: true, profile: false, dimmed: false });
    } finally {
      userAgent.mockRestore();
    }
  });

  it('Android 回复遮罩随主题更新，最后一个弹层关闭后恢复状态栏', async () => {
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Android');
    try {
      (window as any).__TAURI_INTERNALS__ = {};
      const store = useSettingsStore();
      store.setTheme('light');
      const first = Symbol('first');
      const second = Symbol('second');
      store.setAndroidSystemBarDimmed(first, true);
      expect(invoke).toHaveBeenCalledWith('set_android_system_bar_theme', { dark: false, profile: false, dimmed: true });
      store.setAndroidSystemBarDimmed(second, true);
      store.setAndroidSystemBarDimmed(first, false);
      store.setTheme('dark');
      await nextTick();
      expect(invoke).toHaveBeenCalledWith('set_android_system_bar_theme', { dark: true, profile: false, dimmed: true });
      store.setAndroidSystemBarDimmed(second, false);
      expect(invoke).toHaveBeenCalledWith('set_android_system_bar_theme', { dark: true, profile: false, dimmed: false });
    } finally { userAgent.mockRestore(); }
  });

  it('setTheme persists to localStorage across new store instances', async () => {
    const store = useSettingsStore();
    store.setTheme('dark');
    await nextTick();
    const saved = JSON.parse(localStorage.getItem('coolapk_desktop_settings')!);
    expect(saved.theme).toBe('dark');
  });

  it('toggleSidebar flips collapsed state', () => {
    const store = useSettingsStore();
    expect(store.settings.sidebarCollapsed).toBe(false);
    store.toggleSidebar();
    expect(store.settings.sidebarCollapsed).toBe(true);
    store.toggleSidebar();
    expect(store.settings.sidebarCollapsed).toBe(false);
  });

  it('setZoom clamps values to 50-200 range', () => {
    const store = useSettingsStore();
    store.setZoom(300);
    expect(store.settings.zoom).toBe(200);
    store.setZoom(10);
    expect(store.settings.zoom).toBe(50);
    store.setZoom(120);
    expect(store.settings.zoom).toBe(120);
    expect(store.settings.zoomManuallySet).toBe(true);
  });

  it('refreshAutoZoom only resets automatic zoom', () => {
    const store = useSettingsStore();
    store.settings.zoom = 150;
    store.settings.zoomManuallySet = false;
    store.refreshAutoZoom();
    expect(store.settings.zoom).toBe(100);
    store.settings.zoom = 160;
    store.settings.zoomManuallySet = true;
    store.refreshAutoZoom();
    expect(store.settings.zoom).toBe(160);
  });

  it('applies theme and zoom to the document when the app element exists', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const store = useSettingsStore();
    store.setTheme('dark');
    await nextTick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    store.setTheme('light');
    await nextTick();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    store.setZoom(125);
    await nextTick();
    const app = document.getElementById('app')!;
    expect(app.style.transform).toBe('scale(1.25)');
    expect(app.style.width).toBe('80vw');
  });

  it('切换无图模式时同步页面根节点', async () => {
    const store = useSettingsStore();
    store.settings.noImageMode = true;
    await nextTick();
    expect(document.documentElement.getAttribute('data-no-image-mode')).toBe('true');
    store.settings.noImageMode = false;
    await nextTick();
    expect(document.documentElement.hasAttribute('data-no-image-mode')).toBe(false);
  });

  it('切换字体时同步页面根节点', async () => {
    const store = useSettingsStore();
    store.settings.fontFamily = 'Noto Sans SC';
    await nextTick();
    expect(document.documentElement.style.getPropertyValue('--font-family-base')).toContain('Noto Sans SC');
    store.settings.fontFamily = '';
    await nextTick();
    expect(document.documentElement.style.getPropertyValue('--font-family-base')).toBe('');
  });

  it('修改视觉设置时不重复调用原生系统设置', async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    fileStoreState.values.set('closeToTray', true);
    const store = useSettingsStore();
    await store.initializeSettings();
    vi.mocked(invoke).mockClear();

    store.settings.fontSize = 17;
    await nextTick();
    expect(invoke).not.toHaveBeenCalled();

    store.settings.closeToTray = false;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('set_close_to_tray', { enabled: false });
  });

  it('关闭实验性功能时立即退回稳定更新渠道', () => {
    const store = useSettingsStore();
    store.settings.experimentalFeatures = true;
    store.settings.updateChannel = 'beta';
    store.settings.experimentalFeatures = false;
    expect(store.settings.updateChannel).toBe('stable');
  });

  it('setAccent changes accent color', () => {
    const store = useSettingsStore();
    store.setAccent('blue');
    expect(store.settings.accentColor).toBe('blue');
    store.setAccent('violet');
    expect(store.settings.accentColor).toBe('violet');
  });

  it('toggleNavVisibility toggles specific nav item', () => {
    const store = useSettingsStore();
    expect(store.settings.navVisibility?.home).toBe(true);
    store.toggleNavVisibility('home');
    expect(store.settings.navVisibility?.home).toBe(false);
    store.toggleNavVisibility('home');
    expect(store.settings.navVisibility?.home).toBe(true);
  });

  it('recreates navigation visibility when a legacy setting omits it', () => {
    const store = useSettingsStore();
    (store.settings as any).navVisibility = undefined;
    store.toggleNavVisibility('pictures');
    expect(store.settings.navVisibility?.pictures).toBe(false);
  });

  it('ignoreUpdateVersion sets the ignored version', () => {
    const store = useSettingsStore();
    store.ignoreUpdateVersion('2.0.0');
    expect(store.settings.ignoredUpdateVersion).toBe('2.0.0');
  });

  it('setIgnoreAllUpdates toggles update ignoring', () => {
    const store = useSettingsStore();
    store.setIgnoreAllUpdates(true);
    expect(store.settings.ignoreAllUpdates).toBe(true);
    store.setIgnoreAllUpdates(false);
    expect(store.settings.ignoreAllUpdates).toBe(false);
  });

  it('resetUpdateNotifications clears update ignore state', () => {
    const store = useSettingsStore();
    store.ignoreUpdateVersion('2.0.0');
    store.setIgnoreAllUpdates(true);
    store.resetUpdateNotifications();
    expect(store.settings.ignoredUpdateVersion).toBe('');
    expect(store.settings.ignoreAllUpdates).toBe(false);
  });
});
