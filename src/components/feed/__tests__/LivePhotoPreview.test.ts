import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, KeepAlive, ref, nextTick } from 'vue';
import LivePhotoPreview from '../LivePhotoPreview.vue';
import type { FeedImageItem } from '../../../utils/livePhoto';

const liveItem: FeedImageItem = {
  key: 'live-1',
  sourceUrl: 'https://img.example/1.jpg',
  coverUrl: 'https://img.example/1.jpg',
  liveVideoUrl: 'https://video.example/1.mp4',
  isLivePhoto: true,
};

const gifItem: FeedImageItem = {
  key: 'gif-1',
  sourceUrl: 'https://image.coolapk.com/test@1200x2608.gif',
  coverUrl: 'https://image.coolapk.com/test@1200x2608.gif',
  liveVideoUrl: '',
  isLivePhoto: false,
};

const imageStub = defineComponent({
  props: ['src', 'imageClass', 'hideSpinner'],
  emits: ['load', 'error'],
  setup: (props, { emit }) => () => h('img', {
    src: props.src,
    class: props.imageClass,
    onLoad: (event: Event) => emit('load', event),
    onError: (event: Event) => emit('error', event),
  }),
});

const originalMatchMedia = window.matchMedia;

/** jsdom 的 matchMedia 桩固定返回 false，这里按用例覆盖指针类型。 */
function stubPointer(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query.includes('coarse'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('LivePhotoPreview 触摸端播放', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  function mountPreview(withParentClick = false) {
    const onParentClick = vi.fn();
    const wrapper = mount(LivePhotoPreview, {
      props: { item: liveItem, contentId: 1, contentType: 'feed' as const },
      ...(withParentClick ? { attrs: { onClick: onParentClick } } : {}),
    });
    return { wrapper, onParentClick };
  }

  it('触摸端点 Live 角标就地播放且不冒泡到宫格', async () => {
    stubPointer(true);
    const { wrapper, onParentClick } = mountPreview(true);

    expect(wrapper.find('.live-photo-video').exists()).toBe(false);

    await wrapper.get('.live-badge').trigger('click');
    await flushPromises();

    expect(wrapper.find('.live-photo-video').exists()).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('再次点击角标暂停播放', async () => {
    stubPointer(true);
    const { wrapper } = mountPreview();

    await wrapper.get('.live-badge').trigger('click');
    await flushPromises();
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    expect(wrapper.find('.live-photo-video').exists()).toBe(true);

    await wrapper.get('.live-badge').trigger('click');
    await flushPromises();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    // 回归：暂停后视频节点必须离开 DOM，否则画面会停在视频的某一帧上
    // （看起来像另一张图），而不是回到这一项自己的静态封面。
    expect(wrapper.find('.live-photo-video').exists()).toBe(false);

    // 再次点击能重新挂载并播放，不需要重新解析地址。
    await wrapper.get('.live-badge').trigger('click');
    await flushPromises();
    expect(wrapper.find('.live-photo-video').exists()).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('桌面端点击不拦截，仍然冒泡打开查看器', async () => {
    stubPointer(false);
    const { wrapper, onParentClick } = mountPreview(true);

    await wrapper.get('.live-badge').trigger('click');
    await flushPromises();

    expect(onParentClick).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('页面进入后台后停止视频下载并卸载播放器，返回保留静态封面', async () => {
    stubPointer(true);
    const visible = ref(true);
    const wrapper = mount(defineComponent(() => () => h(KeepAlive, null, {
      default: () => visible.value ? h(LivePhotoPreview, { item: liveItem }) : h('div'),
    })));
    const preview = wrapper.getComponent(LivePhotoPreview);
    await preview.get('.live-badge').trigger('click');
    await flushPromises();
    const video = preview.get('video').element as HTMLVideoElement;
    visible.value = false;
    await nextTick();
    expect(video.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(preview.find('video').exists()).toBe(false);
    visible.value = true;
    await flushPromises();
    expect(wrapper.find('video').exists()).toBe(false);
    wrapper.unmount();
  });

  it('九张 GIF 默认只加载静态封面，悬浮仅挂载当前动图，移出释放', async () => {
    stubPointer(false);
    const wrapper = mount(defineComponent(() => () => h('div', Array.from({ length: 9 }, (_, index) =>
      h(LivePhotoPreview, { item: { ...gifItem, key: `gif-${index}` } })))), {
      global: { stubs: { AppImage: imageStub } },
    });
    const previews = wrapper.findAllComponents(LivePhotoPreview);
    expect(wrapper.findAll('.gif-badge')).toHaveLength(9);
    expect(wrapper.findAll('img')).toHaveLength(9);
    expect(wrapper.findAll('img').every(img => img.attributes('src') === `${gifItem.sourceUrl}.m.jpg`)).toBe(true);
    await previews[0].trigger('mouseenter');
    expect(wrapper.findAll('.gif-preview-image')).toHaveLength(1);
    expect(previews[0].get('.gif-preview-image').attributes('src')).toBe(gifItem.sourceUrl);
    expect(previews[0].get('.gif-preview-image').attributes('style')).toContain('opacity: 0');
    expect(previews[0].find('.live-photo-loading').exists()).toBe(false);
    expect(previews[0].findAll('img')).toHaveLength(2);
    await previews[0].get('.gif-preview-image').trigger('load');
    expect(previews[0].classes()).toContain('is-playing');
    expect(previews[0].get('.gif-preview-image').attributes('style')).toContain('opacity: 1');
    await previews[0].trigger('mouseleave');
    expect(wrapper.find('.gif-preview-image').exists()).toBe(false);
    expect(previews[0].classes()).not.toContain('is-playing');
    wrapper.unmount();
  });

  it('触摸端点 GIF 角标播放和暂停，点图片仍可冒泡打开查看器', async () => {
    stubPointer(true);
    const onClick = vi.fn();
    const wrapper = mount(LivePhotoPreview, {
      props: { item: gifItem }, attrs: { onClick }, global: { stubs: { AppImage: imageStub } },
    });
    await wrapper.trigger('mouseenter');
    expect(wrapper.find('.gif-preview-image').exists()).toBe(false);
    await wrapper.get('.gif-badge').trigger('click');
    expect(wrapper.find('.gif-preview-image').exists()).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    await wrapper.get('.gif-badge').trigger('click');
    expect(wrapper.find('.gif-preview-image').exists()).toBe(false);
    await wrapper.get('img').trigger('click');
    expect(onClick).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('单张 GIF 可自动播放，鼠标移出不暂停，关闭自动播放后释放', async () => {
    stubPointer(false);
    const wrapper = mount(LivePhotoPreview, {
      props: { item: gifItem, gifAutoPlay: true }, global: { stubs: { AppImage: imageStub } },
    });
    await flushPromises();
    expect(wrapper.find('.gif-preview-image').exists()).toBe(true);
    await wrapper.trigger('mouseleave');
    expect(wrapper.find('.gif-preview-image').exists()).toBe(true);
    await wrapper.setProps({ gifAutoPlay: false, autoPlayGif: false });
    expect(wrapper.find('.gif-preview-image').exists()).toBe(false);
    wrapper.unmount();
  });

  it('关闭自动播放后不悬浮加载 GIF，桌面点击角标仍打开查看器', async () => {
    stubPointer(false);
    const onClick = vi.fn();
    const wrapper = mount(LivePhotoPreview, {
      props: { item: gifItem, autoPlayGif: false }, attrs: { onClick }, global: { stubs: { AppImage: imageStub } },
    });
    await wrapper.trigger('mouseenter');
    expect(wrapper.find('.gif-preview-image').exists()).toBe(false);
    await wrapper.get('.gif-badge').trigger('click');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.gif-preview-image').exists()).toBe(false);
    wrapper.unmount();
  });

  it('切换图片或页面进入后台时卸载 GIF 预览', async () => {
    stubPointer(false);
    const visible = ref(true);
    const wrapper = mount(defineComponent(() => () => h(KeepAlive, null, {
      default: () => visible.value ? h(LivePhotoPreview, { item: gifItem }) : h('div'),
    })), { global: { stubs: { AppImage: imageStub } } });
    const preview = wrapper.getComponent(LivePhotoPreview);
    await preview.trigger('mouseenter');
    expect(preview.find('.gif-preview-image').exists()).toBe(true);
    visible.value = false;
    await nextTick();
    expect(preview.find('.gif-preview-image').exists()).toBe(false);
    visible.value = true;
    await nextTick();
    expect(preview.find('.gif-preview-image').exists()).toBe(false);
    wrapper.unmount();
  });
});
