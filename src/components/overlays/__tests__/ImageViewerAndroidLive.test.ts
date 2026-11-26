import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';
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

it('Android 的 HDR 按钮把有 HDR 标记的原图地址交给原生查看器', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14)');
  const supported = vi.spyOn(CoolapkTauriAPI, 'supportsHdrImageViewer').mockResolvedValue(true);
  const open = vi.spyOn(CoolapkTauriAPI, 'openHdrImageViewer').mockResolvedValue(undefined);
  const store = useAppStore();
  const wrapper = mount(ImageViewer, { global: { stubs: { Teleport: true } } });
  vi.spyOn(tauriCore, 'isTauri').mockReturnValue(true);
  const original = 'https://image.coolapk.com/feed/scene-xhdr@1920x1080.jpg';
  try {
    store.openImageViewer([{ sourceUrl: 'https://image.coolapk.com/feed/scene.jpg', compressedUrl: `${original}.m.jpg` }], 0);
    await flushPromises();
    expect(supported).toHaveBeenCalledOnce();
    await wrapper.get('button.topbar-hdr-badge').trigger('click');
    expect(open).toHaveBeenCalledWith(original);
  } finally { wrapper.unmount(); }
});

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
