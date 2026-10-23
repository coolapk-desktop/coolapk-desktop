import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../stores/app';
import { CoolapkTauriAPI } from '../../../api/coolapk';
import * as codecs from '../../../utils/liveVideoCodec';
import { showLivePhotoCodecPrompt } from '../../../utils/livePhotoCodecPrompt';
import ImageViewer from '../ImageViewer.vue';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: vi.fn().mockResolvedValue(vi.fn()) }));
vi.mock('../../../utils/livePhotoCodecPrompt', () => ({ showLivePhotoCodecPrompt: vi.fn() }));
vi.mock('../../../utils/resourceCache', async importOriginal => ({
  ...await importOriginal<typeof import('../../../utils/resourceCache')>(),
  loadImageResource: vi.fn(async () => 'data:image/png;base64,AA=='),
  normalizeResourceUrl: (url: string) => url,
  getMemoryCachedResourceSync: vi.fn(() => null),
}));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it.each(['Mozilla/5.0 (Linux; Android 12)', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'])('%s 拒绝能力查询时仍调用播放器，成功出帧后显示实况', async userAgent => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  const originalCapabilities = Object.getOwnPropertyDescriptor(navigator, 'mediaCapabilities');
  Object.defineProperty(navigator, 'mediaCapabilities', { configurable: true, value: { decodingInfo: vi.fn().mockResolvedValue({ supported: false }) } });
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(CoolapkTauriAPI, 'getLivePhotoVideoHeader').mockResolvedValue('AA==');
  vi.spyOn(codecs, 'detectLiveVideoCodec').mockReturnValue({ id: 'hvc1', name: 'HEVC/H.265', container: 'mp4', mimeCodec: 'hvc1.1.6.L93.B0' });
  vi.spyOn(codecs, 'waitForDecodedVideoFrame').mockResolvedValue(true);
  const store = useAppStore();
  const wrapper = mount(ImageViewer, { global: { stubs: { Teleport: true } } });
  try {
    store.openImageViewer([{ sourceUrl: 'https://image.coolapk.com/1.jpg', liveVideoUrl: 'https://video.coolapk.com/1.mp4', livePhotoEnable: 1 }], 0);
    await flushPromises();
    expect(play).toHaveBeenCalled();
    expect(wrapper.get('.live-play-btn').text()).toBe('实况');
    expect(wrapper.get('.viewer-live-video').attributes('style')).toContain('opacity: 1');
    expect(wrapper.text()).not.toContain('不支持');
    expect(showLivePhotoCodecPrompt).not.toHaveBeenCalled();
  } finally {
    wrapper.unmount();
    if (originalCapabilities) Object.defineProperty(navigator, 'mediaCapabilities', originalCapabilities);
    else Reflect.deleteProperty(navigator, 'mediaCapabilities');
  }
});

it.each([
  ['NotSupportedError', true],
  ['NotAllowedError', false],
  ['AbortError', false],
] as const)('实际播放抛出 %s 时仅对格式错误显示解码提示', async (name, shouldPrompt) => {
  vi.spyOn(codecs, 'getLiveVideoCodecSupport').mockResolvedValue('unsupported');
  vi.spyOn(codecs, 'detectLiveVideoCodec').mockReturnValue({ id: 'hvc1', name: 'HEVC/H.265', container: 'mp4' });
  vi.spyOn(CoolapkTauriAPI, 'getLivePhotoVideoHeader').mockResolvedValue('AA==');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('播放失败', name));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const wrapper = mount(ImageViewer, { global: { stubs: { Teleport: true } } });
  try {
    useAppStore().openImageViewer([{ sourceUrl: 'https://image.coolapk.com/1.jpg', liveVideoUrl: 'https://video.coolapk.com/1.mp4', livePhotoEnable: 1 }], 0);
    await flushPromises();
    expect(showLivePhotoCodecPrompt).toHaveBeenCalledTimes(shouldPrompt ? 1 : 0);
    expect(wrapper.get('.viewer-live-video').attributes('style')).toContain('opacity: 0');
  } finally {
    wrapper.unmount();
  }
});

it.each([[2, false], [3, true], [4, true]] as const)('播放器上报媒体错误 %s 时只对格式或解码失败显示提示', async (code, shouldPrompt) => {
  // 即使能力查询认为支持，播放器实际解码失败也必须给出准确提示。
  vi.spyOn(codecs, 'getLiveVideoCodecSupport').mockResolvedValue('supported');
  vi.spyOn(codecs, 'detectLiveVideoCodec').mockReturnValue({ id: 'hvc1', name: 'HEVC/H.265', container: 'mp4' });
  vi.spyOn(codecs, 'waitForDecodedVideoFrame').mockResolvedValue(false);
  vi.spyOn(CoolapkTauriAPI, 'getLivePhotoVideoHeader').mockResolvedValue('AA==');
  vi.spyOn(CoolapkTauriAPI, 'resolveLivePhotoVideo').mockResolvedValue('');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const wrapper = mount(ImageViewer, { global: { stubs: { Teleport: true } } });
  try {
    useAppStore().openImageViewer([{ sourceUrl: 'https://image.coolapk.com/1.jpg', liveVideoUrl: 'https://video.coolapk.com/1.mp4', livePhotoEnable: 1 }], 0);
    await flushPromises();
    const video = wrapper.get('.viewer-live-video');
    Object.defineProperty(video.element, 'error', { configurable: true, value: { code } });
    await video.trigger('error');
    await flushPromises();
    expect(showLivePhotoCodecPrompt).toHaveBeenCalledTimes(shouldPrompt ? 1 : 0);
  } finally {
    wrapper.unmount();
  }
});
