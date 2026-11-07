import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import FeedVideoCard from '../FeedVideoCard.vue';

const { resolveVideoUrl } = vi.hoisted(() => ({ resolveVideoUrl: vi.fn() }));
vi.mock('../../../api/runtime', () => ({ isWebBuild: true }));
vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: { resolveVideoUrl } }));

it('Web 先使用视频直链，播放失败后才请求备用地址', async () => {
  const direct = 'https://video.weibocdn.com/direct.mp4';
  const fallback = 'https://video.weibocdn.com/fallback.mp4';
  resolveVideoUrl.mockResolvedValue({ data: { url: fallback } });
  const wrapper = mount(FeedVideoCard, {
    props: { feed: { videoUrl: direct, mediaInfo: { requestParams: { provider: 'params' } } } },
  });
  try {
    expect(wrapper.get('video').attributes('src')).toBe(direct);
    expect(wrapper.get('video').attributes('preload')).toBe('none');
    expect(resolveVideoUrl).not.toHaveBeenCalled();
    await wrapper.get('video').trigger('error');
    await flushPromises();
    expect(resolveVideoUrl).toHaveBeenCalledExactlyOnceWith('params');
    expect(wrapper.get('video').attributes('src')).toBe(fallback);
  } finally {
    wrapper.unmount();
  }
});
