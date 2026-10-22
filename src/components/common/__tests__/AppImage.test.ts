import { flushPromises, mount } from '@vue/test-utils';
import { mockObjectUrls } from '../../../test-utils/objectUrls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, KeepAlive, ref, nextTick } from 'vue';
import { clearResourceMemoryCache } from '../../../utils/resourceCache';
import { useSettingsStore } from '../../../stores/settings';

const mocks = vi.hoisted(() => ({
  getImageDataUrl: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getImageDataUrl: mocks.getImageDataUrl,
  },
}));

import AppImage from '../AppImage.vue';
import AppAvatar from '../AppAvatar.vue';
import { detailImageScopeKey } from '../../../composables/useNoImageMode';

describe('AppImage', () => {
  let blobs: Map<string, Blob>;
  it('无图模式只放行详情图片，后台列表仍不加载，关闭详情选项后立即隐藏', async () => {
    const settings = useSettingsStore();
    settings.settings.noImageMode = settings.settings.showImagesInDetail = true;
    const list = mount(AppImage, { props: { src: 'https://image.coolapk.com/list.jpg' } });
    const detail = mount(AppImage, { props: { src: 'https://image.coolapk.com/detail.jpg' }, global: { provide: { [detailImageScopeKey as symbol]: ref(true) } } });
    try {
      await flushPromises();
      expect(list.find('img').exists()).toBe(false);
      expect(detail.find('img').exists()).toBe(true);
      expect(mocks.getImageDataUrl).toHaveBeenCalledTimes(1);
      settings.settings.showImagesInDetail = false;
      await flushPromises();
      expect(detail.find('.app-image-container').exists()).toBe(false);
      expect(settings.settings.noImageMode).toBe(true);
    } finally { list.unmount(); detail.unmount(); }
  });
  beforeEach(() => {
    clearResourceMemoryCache();
    blobs = mockObjectUrls();
    mocks.getImageDataUrl.mockReset();
    mocks.getImageDataUrl.mockResolvedValue('data:image/jpeg;base64,YWJj');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('保留原始图片地址供右键菜单保存', async () => {
    const sourceUrl = 'http://image.coolapk.com/feed/test.jpg';
    const wrapper = mount(AppImage, { props: { src: sourceUrl } });

    await flushPromises();

    const image = wrapper.get('img');
    expect(await blobs.get(image.attributes('src')!)!.text()).toBe('abc');
    expect(image.attributes('data-original-url')).toBe('https://image.coolapk.com/feed/test.jpg');
    expect(mocks.getImageDataUrl).toHaveBeenCalledWith('https://image.coolapk.com/feed/test.jpg', expect.any(Object));
    wrapper.unmount();
  });

  it('无图模式下不挂载图片组件也不请求图片', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.settings.noImageMode = true;
    const wrapper = mount(AppImage, { props: { src: 'https://image.coolapk.com/feed/test.jpg' } });

    await flushPromises();

    expect(wrapper.find('.app-image-container').exists()).toBe(false);
    expect(mocks.getImageDataUrl).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('后台保留页面卸载图片节点，返回时从缓存恢复', async () => {
    const visible = ref(true);
    const host = defineComponent(() => () => h(KeepAlive, null, {
      default: () => visible.value ? h(AppImage, { src: 'https://img.example/retained.jpg' }) : h('div'),
    }));
    const wrapper = mount(host);
    await flushPromises();
    const image = wrapper.getComponent(AppImage);
    const cachedSrc = wrapper.get('img').attributes('src');
    expect(image.find('img').exists()).toBe(true);
    visible.value = false;
    await nextTick();
    expect(image.find('img').exists()).toBe(false);
    visible.value = true;
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe(cachedSrc);
    expect(mocks.getImageDataUrl).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('屏幕外不加载，进入附近后加载，远离后释放并丢弃迟到的结果', async () => {
    let notify!: IntersectionObserverCallback;
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe() {}
      unobserve = unobserve;
      disconnect = disconnect;
    });
    let finish!: (value: string) => void;
    mocks.getImageDataUrl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = mount(AppImage, { props: { src: 'https://img.example/nearby.jpg' } });
    await flushPromises();
    const container = wrapper.get('.app-image-container').element;
    const setVisible = async (isIntersecting: boolean) => {
      notify([{ target: container, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
      await flushPromises();
    };
    expect(mocks.getImageDataUrl).not.toHaveBeenCalled();
    await setVisible(true);
    expect(mocks.getImageDataUrl).toHaveBeenCalledTimes(1);
    await setVisible(false);
    finish('data:image/png;base64,bmVhcmJ5');
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(false);
    await setVisible(true);
    expect(await blobs.get(wrapper.get('img').attributes('src')!)!.text()).toBe('nearby');
    await setVisible(false);
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
    expect(unobserve).toHaveBeenCalledWith(container);
    expect(disconnect).toHaveBeenCalled();
  });

  it('头像装扮随后台页面释放，返回时恢复且不重复下载', async () => {
    const visible = ref(true);
    const wrapper = mount(defineComponent(() => () => h(KeepAlive, null, {
      default: () => visible.value ? h(AppAvatar, {
        src: 'https://img.example/avatar.jpg', pluginUrl: 'https://img.example/plugin.png',
      }) : h('div'),
    })));
    await flushPromises();
    const avatar = wrapper.getComponent(AppAvatar);
    expect(avatar.find('.avatar-plugin-img').exists()).toBe(true);
    visible.value = false;
    await nextTick();
    expect(avatar.find('.avatar-plugin-img').exists()).toBe(false);
    expect(avatar.find('img').exists()).toBe(false);
    visible.value = true;
    await flushPromises();
    expect(wrapper.find('.avatar-plugin-img').exists()).toBe(true);
    expect(mocks.getImageDataUrl).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
