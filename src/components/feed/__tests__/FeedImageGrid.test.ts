import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../stores/app';
import { useSettingsStore } from '../../../stores/settings';
import { ref } from 'vue';
import { detailImageScopeKey } from '../../../composables/useNoImageMode';

const mocks = vi.hoisted(() => ({
  openImageInSystemViewer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    openImageInSystemViewer: mocks.openImageInSystemViewer,
    getImageDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA'),
  },
}));

import FeedImageGrid from '../FeedImageGrid.vue';

const originalUserAgent = navigator.userAgent;
const originalPlatform = navigator.platform;

function stubIOSDevice() {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15',
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'platform', { value: 'iPhone', configurable: true });
}

function mountGrid() {
  return mount(FeedImageGrid, {
    props: { images: ['https://img.example/1.jpg', 'https://img.example/2.jpg'] },
    global: { stubs: { LivePhotoPreview: true } },
  });
}

describe('FeedImageGrid 点击打开方式', () => {
  it('无图模式下详情配图可进入大图查看器，列表继续隐藏配图', async () => {
    const settings = useSettingsStore();
    settings.settings.noImageMode = settings.settings.showImagesInDetail = true;
    settings.settings.imageOpenMode = 'internal';
    const list = mountGrid();
    const detail = mount(FeedImageGrid, { props: { images: ['https://img.example/detail.jpg'] }, global: { provide: { [detailImageScopeKey as symbol]: ref(true) }, stubs: { LivePhotoPreview: true } } });
    try {
      expect(list.find('.feed-image-grid').exists()).toBe(false);
      await detail.get('.grid-item').trigger('click');
      expect(useAppStore().activeImageViewer?.fromDetail).toBe(true);
      expect(settings.settings.noImageMode).toBe(true);
    } finally { list.unmount(); detail.unmount(); }
  });
  it('retains measured image ratios across recycling so long-image layout does not jump', async () => {
    const images = ['https://img.example/tall.jpg'];
    const first = mount(FeedImageGrid, { props: { images }, global: { stubs: { LivePhotoPreview: true } } });
    first.findComponent({ name: 'LivePhotoPreview' }).vm.$emit('load', { target: { naturalWidth: 800, naturalHeight: 2400 } });
    await flushPromises();
    const ratios = first.emitted('update:imageRatios')?.[0]?.[0] as Record<string, number>;
    expect(first.find('.long-image-badge').exists()).toBe(true);
    first.unmount();
    const restored = mount(FeedImageGrid, { props: { images, imageRatios: ratios }, global: { stubs: { LivePhotoPreview: true } } });
    expect(restored.find('.long-image-badge').exists()).toBe(true);
    expect(restored.find('.grid-item').classes()).toContain('has-natural-size');
    restored.unmount();
  });
  it.each([[1200, 800], [800, 1080]])('保留普通单图的布局比例，避免图片释放或子树重建后高度塌缩（%s×%s）', async (width, height) => {
    const images = ['https://img.example/single.jpg'];
    const first = mount(FeedImageGrid, { props: { images }, global: { stubs: { LivePhotoPreview: true } } });
    first.findComponent({ name: 'LivePhotoPreview' }).vm.$emit('load', { target: { naturalWidth: width, naturalHeight: height } });
    await flushPromises();
    const ratios = first.emitted('update:imageRatios')?.[0]?.[0] as Record<string, number>;
    expect((first.get('.grid-item').element as HTMLElement).style.aspectRatio).toBe(`${width / height} / 1`);
    first.unmount();
    const restored = mount(FeedImageGrid, { props: { images, imageRatios: ratios }, global: { stubs: { LivePhotoPreview: true } } });
    // 图片尚未重新加载时，父卡片保存的尺寸就应当能撑住布局。
    expect((restored.get('.grid-item').element as HTMLElement).style.aspectRatio).toBe(`${width / height} / 1`);
    expect(restored.find('.is-long-image').exists()).toBe(false);
    restored.unmount();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', { value: originalUserAgent, configurable: true });
    Object.defineProperty(window.navigator, 'platform', { value: originalPlatform, configurable: true });
  });

  it('桌面端选择系统查看器时交给系统打开', async () => {
    useSettingsStore().settings.imageOpenMode = 'system';
    const wrapper = mountGrid();

    await wrapper.findAll('.grid-item')[0].trigger('click');
    await flushPromises();

    expect(mocks.openImageInSystemViewer).toHaveBeenCalledTimes(1);
    expect(useAppStore().activeImageViewer).toBeNull();
    wrapper.unmount();
  });

  it('iOS 上即使选了系统查看器也回落到内置查看器', async () => {
    stubIOSDevice();
    useSettingsStore().settings.imageOpenMode = 'system';
    const wrapper = mountGrid();

    await wrapper.findAll('.grid-item')[0].trigger('click');
    await flushPromises();

    expect(mocks.openImageInSystemViewer).not.toHaveBeenCalled();
    expect(useAppStore().activeImageViewer?.currentIndex).toBe(0);
    wrapper.unmount();
  });

  it('iOS 内置查看器模式按点击顺序打开对应图片', async () => {
    stubIOSDevice();
    const wrapper = mountGrid();

    await wrapper.findAll('.grid-item')[1].trigger('click');
    await flushPromises();

    expect(useAppStore().activeImageViewer?.currentIndex).toBe(1);
    wrapper.unmount();
  });
});
