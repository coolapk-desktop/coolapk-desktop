import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStore } from '../../stores/app';
import { useSettingsStore } from '../../stores/settings';

const mocks = vi.hoisted(() => ({
  loadImageResource: vi.fn(),
  showToast: vi.fn(),
  clipboardWriteText: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getImageDataUrl: vi.fn(),
    saveImage: vi.fn(),
    getLivePhotoVideoHeader: vi.fn(),
  },
}));
vi.mock('../../utils/resourceCache', () => ({
  getMemoryCachedResourceSync: vi.fn(() => null),
  loadImageResource: mocks.loadImageResource,
  normalizeResourceUrl: (url: string) => url,
  retainResourceUrl: vi.fn(() => () => {}),
}));
vi.mock('../../utils/platform', () => ({ isTouchMobilePlatform: () => false }));
vi.mock('../../utils/livePhoto', () => ({
  normalizeFeedImageItems: (items: unknown) => items,
  resolveLivePhotoVideo: vi.fn(),
}));
vi.mock('../../utils/liveVideoCodec', () => ({
  detectLiveVideoCodec: () => null,
  getLiveVideoCodecSupport: vi.fn(async () => 'unknown'),
  waitForDecodedVideoFrame: vi.fn(),
  logLiveVideoState: vi.fn(),
}));
vi.mock('../../utils/androidBackButton', () => ({ useAndroidBackButton: vi.fn() }));
vi.mock('../../utils/livePhotoCodecPrompt', () => ({ showLivePhotoCodecPrompt: vi.fn() }));
vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));

import ImageViewer from '../overlays/ImageViewer.vue';

// 酷安 CDN 原图地址：显示地址会带 .m.jpg 后缀，原图地址不带后缀。
const SOURCE = 'https://image.coolapk.com/p1.jpg';
const HD_URL = 'https://image.coolapk.com/p1.jpg.m.jpg';
const ORIGINAL_URL = 'https://image.coolapk.com/p1.jpg';

type Item = { sourceUrl: string; coverUrl: string; liveVideoUrl: string; isLivePhoto: boolean };

function mountViewer(items: Item[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 固定显示地址为 HD 变体（.m.jpg），与原图地址区分开；关闭自动加载原图。
  const settingsStore = useSettingsStore();
  settingsStore.settings.imageQuality = 'hd';
  settingsStore.settings.autoLoadOriginalImage = false;
  const appStore = useAppStore();
  appStore.openImageViewer(items as never, 0);
  return mount(ImageViewer, { global: { plugins: [pinia], stubs: { AppButton: true, teleport: true } } });
}

function img(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('img.viewer-img');
}

async function failCurrentImage(wrapper: ReturnType<typeof mount>) {
  // resolveImageData 失败后回退把原 url 交给 <img>，由 <img> error 进入失败态。
  await img(wrapper).trigger('error');
  await flushPromises();
  expect(wrapper.find('.viewer-load-error').exists()).toBe(true);
}

describe('ImageViewer 失败重试变体回退 / 复制链接', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.clipboardWriteText },
    });
  });

  it('HD 显示地址失败后重试：改试原图地址，最后一次请求 URL ≠ 首次 URL', async () => {
    mocks.loadImageResource.mockRejectedValue(new Error('404'));
    const wrapper = mountViewer([{ sourceUrl: SOURCE, coverUrl: SOURCE, liveVideoUrl: '', isLivePhoto: false }]);
    await flushPromises();

    // 首次请求的是 HD 显示地址
    expect(mocks.loadImageResource).toHaveBeenLastCalledWith(HD_URL, expect.anything());
    await failCurrentImage(wrapper);

    await wrapper.find('.viewer-retry-btn').trigger('click');
    await flushPromises();

    // 重试请求的是原图地址，不再重复打同一死链
    const calls = mocks.loadImageResource.mock.calls.map(c => c[0]);
    expect(calls[calls.length - 1]).toBe(ORIGINAL_URL);
    expect(calls[calls.length - 1]).not.toBe(calls[0]);
    expect(calls).not.toContain(HD_URL + HD_URL);
    expect(calls.filter(u => u === HD_URL)).toHaveLength(1);
  });

  it('回退到原图后仍失败：失败态可再次点击重试', async () => {
    mocks.loadImageResource.mockRejectedValue(new Error('404'));
    const wrapper = mountViewer([{ sourceUrl: SOURCE, coverUrl: SOURCE, liveVideoUrl: '', isLivePhoto: false }]);
    await flushPromises();
    await failCurrentImage(wrapper);

    await wrapper.find('.viewer-retry-btn').trigger('click');
    await flushPromises();
    await failCurrentImage(wrapper);

    // 第二次重试仍可发起请求（原图候选），不会被永久锁死
    await wrapper.find('.viewer-retry-btn').trigger('click');
    await flushPromises();
    const calls = mocks.loadImageResource.mock.calls.map(c => c[0]);
    expect(calls.filter(u => u === ORIGINAL_URL).length).toBeGreaterThanOrEqual(2);
  });

  it('复制链接：复制原图原始 URL，不含 HD 后缀变体', async () => {
    mocks.clipboardWriteText.mockResolvedValue(undefined);
    const wrapper = mountViewer([{ sourceUrl: SOURCE, coverUrl: SOURCE, liveVideoUrl: '', isLivePhoto: false }]);
    await flushPromises();

    const copyBtn = wrapper.findAll('button').find(b => b.attributes('title') === '复制链接');
    expect(copyBtn).toBeTruthy();
    await copyBtn!.trigger('click');
    await flushPromises();

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith(ORIGINAL_URL);
    const copied = mocks.clipboardWriteText.mock.calls[0]![0] as string;
    expect(copied).not.toBe(HD_URL);
    expect(copied).not.toMatch(/\.m\.jpg$/);
  });
});
