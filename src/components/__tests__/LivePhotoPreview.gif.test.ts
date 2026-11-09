import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { FeedImageItem } from '../../utils/livePhoto';

const mocks = vi.hoisted(() => ({
  observeResourceVisibility: vi.fn(() => () => {}),
  resolveLivePhotoVideo: vi.fn(),
  isCoarsePointer: vi.fn(() => false),
}));

vi.mock('../../utils/resourceVisibility', () => ({
  observeResourceVisibility: mocks.observeResourceVisibility,
}));
vi.mock('../../utils/livePhoto', async () => {
  const actual = await vi.importActual<typeof import('../../utils/livePhoto')>('../../utils/livePhoto');
  return { ...actual, resolveLivePhotoVideo: mocks.resolveLivePhotoVideo };
});
vi.mock('../../utils/platform', () => ({ isCoarsePointer: mocks.isCoarsePointer }));
vi.mock('../../utils/liveVideoCodec', () => ({ logLiveVideoState: vi.fn() }));

import LivePhotoPreview from '../feed/LivePhotoPreview.vue';

function gifItem(): FeedImageItem {
  return {
    key: 'gif-1',
    sourceUrl: 'https://img.example.com/anim.gif',
    coverUrl: 'https://img.example.com/cover.jpg',
    liveVideoUrl: '',
    isLivePhoto: false,
  };
}

// AppImage 桩：把 load/error 事件透传出来，src 原样交给 <img>。
const AppImageStub = {
  props: ['src'],
  template: '<img :src="src" @load="$emit(\'load\')" @error="$emit(\'error\')" />',
};

function mountPreview(item: FeedImageItem) {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(LivePhotoPreview, {
    props: { item },
    global: { plugins: [pinia], stubs: { AppImage: AppImageStub } },
  });
}

describe('LivePhotoPreview GIF 失败占位与重试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GIF 加载失败：出现可见失败占位（不再静默空白），且不会被当成用户暂停', async () => {
    const wrapper = mountPreview(gifItem());
    await wrapper.trigger('mouseenter');
    await flushPromises();
    expect(wrapper.find('img[alt="GIF 动图预览"]').exists()).toBe(true);
    expect(wrapper.find('.gif-error-placeholder').exists()).toBe(false);

    await wrapper.find('img[alt="GIF 动图预览"]').trigger('error');
    await flushPromises();

    // 失败占位可见；gif 图卸载回静态封面
    expect(wrapper.find('.gif-error-placeholder').exists()).toBe(true);
    expect(wrapper.find('img[alt="GIF 动图预览"]').exists()).toBe(false);

    // 再次悬浮（网络恢复）：占位消失，GIF 重新挂载重试，不再被 autoGifPaused 拦截
    await wrapper.trigger('mouseleave');
    await flushPromises();
    await wrapper.trigger('mouseenter');
    await flushPromises();
    expect(wrapper.find('.gif-error-placeholder').exists()).toBe(false);
    expect(wrapper.find('img[alt="GIF 动图预览"]').exists()).toBe(true);
  });

  it('点击失败占位可就地重试：卸载错误图并重新挂载 GIF', async () => {
    const wrapper = mountPreview(gifItem());
    await wrapper.trigger('mouseenter');
    await flushPromises();
    await wrapper.find('img[alt="GIF 动图预览"]').trigger('error');
    await flushPromises();

    await wrapper.find('.gif-error-placeholder').trigger('click');
    await flushPromises();
    expect(wrapper.find('.gif-error-placeholder').exists()).toBe(false);
    expect(wrapper.find('img[alt="GIF 动图预览"]').exists()).toBe(true);
  });
});
