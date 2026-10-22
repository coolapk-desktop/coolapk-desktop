import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../stores/app';
import { CoolapkTauriAPI } from '../../../api/coolapk';
import * as codecs from '../../../utils/liveVideoCodec';
import ImageViewer from '../ImageViewer.vue';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: vi.fn().mockResolvedValue(vi.fn()) }));
vi.mock('../../../utils/resourceCache', async importOriginal => ({
  ...await importOriginal<typeof import('../../../utils/resourceCache')>(),
  loadImageResource: vi.fn(async () => 'data:image/png;base64,AA=='),
  normalizeResourceUrl: (url: string) => url,
  getMemoryCachedResourceSync: vi.fn(() => null),
}));
afterEach(() => vi.restoreAllMocks());

it('Android WebView 拒绝能力查询时仍调用播放器，成功出帧后显示实况', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 12)');
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
  } finally {
    wrapper.unmount();
    if (originalCapabilities) Object.defineProperty(navigator, 'mediaCapabilities', originalCapabilities);
    else Reflect.deleteProperty(navigator, 'mediaCapabilities');
  }
});
