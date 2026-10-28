import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../stores/app';
import { useSettingsStore } from '../../../stores/settings';
import { getMemoryCachedResourceSync, loadImageResource } from '../../../utils/resourceCache';
import ImageViewer from '../ImageViewer.vue';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/app', () => ({
  onBackButtonPress: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('../../../utils/resourceCache', async importOriginal => ({
  ...await importOriginal<typeof import('../../../utils/resourceCache')>(),
  loadImageResource: vi.fn(),
  normalizeResourceUrl: (url: string) => url,
  getMemoryCachedResourceSync: vi.fn(() => null),
}));

const loadResourceMock = vi.mocked(loadImageResource);
const memoryCacheMock = vi.mocked(getMemoryCachedResourceSync);

describe('原图加载成功后隐藏入口', () => {
  it('无图模式允许详情来源的大图，关闭详情开关后隐藏查看器', async () => {
    const settings = useSettingsStore();
    settings.settings.noImageMode = settings.settings.showImagesInDetail = true;
    const store = useAppStore();
    const wrapper = mount(ImageViewer, { global: { stubs: { Teleport: true } } });
    try {
      store.openImageViewer(['https://img.example/detail.jpg'], 0, { fromDetail: true });
      await flushPromises();
      expect(wrapper.find('.no-image-detail-enabled .viewer-img').exists()).toBe(true);
      settings.settings.showImagesInDetail = false;
      await flushPromises();
      expect(wrapper.find('.image-viewer-backdrop').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  beforeEach(() => {
    loadResourceMock.mockImplementation(async url => dataOf(url));
    memoryCacheMock.mockReturnValue(null);
    useSettingsStore().settings.autoLoadOriginalImage = false;
    useSettingsStore().settings.imageQuality = 'hd';
  });

  it('手动加载原图成功后立即隐藏按钮和空工具栏，不显示成功提示', async () => {
    const { wrapper } = await mountViewer();
    expect(wrapper.get('.viewer-bottombar .raw-image-btn').text()).toBe('查看原图');
    await wrapper.get('.raw-image-btn').trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('已加载原图');
    expect(wrapper.find('.raw-image-btn').exists()).toBe(false);
    expect(wrapper.find('.viewer-bottombar').exists()).toBe(false);
    wrapper.unmount();
  });

  it('开启自动加载原图时，加载成功后不显示成功提示', async () => {
    useSettingsStore().settings.autoLoadOriginalImage = true;
    const { wrapper } = await mountViewer();
    expect(wrapper.get('.viewer-img').attributes('src')).toBe(dataOf('https://img.example/0.jpg'));
    expect(wrapper.find('.raw-image-btn').exists()).toBe(false);
    wrapper.unmount();
  });

  it('切到未加载原图的图片显示入口，返回已加载的图片隐藏入口', async () => {
    const { wrapper } = await mountViewer();
    await wrapper.get('.raw-image-btn').trigger('click');
    await flushPromises();
    await wrapper.get('.nav-next').trigger('click');
    await flushPromises();
    expect(wrapper.get('.raw-image-btn').text()).toBe('查看原图');
    await wrapper.get('.nav-prev').trigger('click');
    await flushPromises();
    expect(wrapper.find('.raw-image-btn').exists()).toBe(false);
    wrapper.unmount();
  });
});

/** 与资源缓存的真实行为一致：返回可区分的 data URL，便于断言画面上是哪一张。 */
function dataOf(url: string): string {
  return `data:image/png;base64,${btoa(url)}`;
}

interface Point {
  clientX: number;
  clientY: number;
}

function point(clientX: number, clientY: number): Point {
  return { clientX, clientY };
}

/** jsdom 没有 TouchEvent，这里手工挂 touches 后派发同名事件。 */
function dispatchTouch(target: Element, type: string, touches: Point[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
}

async function mountViewer(count = 3, index = 0) {
  const store = useAppStore();
  const wrapper = mount(ImageViewer, { global: { stubs: { Teleport: true } } });
  // 与线上一致：先挂载再打开，触发 viewerData 侦听器同步 currentIndex。
  store.openImageViewer(
    Array.from({ length: count }, (_, i) => `https://img.example/${i}.jpg`),
    index,
  );
  await flushPromises();
  if (wrapper.find('.viewer-img').exists()) await loadImageDimensions(wrapper, 200, 100);
  return { wrapper, store, stage: wrapper.get('.image-stage').element };
}

async function loadImageDimensions(wrapper: ReturnType<typeof mount>, width: number, height: number) {
  const image = wrapper.get('.viewer-img').element;
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  await wrapper.get('.viewer-img').trigger('load');
}

async function swipe(stage: Element, from: Point, to: Point) {
  dispatchTouch(stage, 'touchstart', [from]);
  dispatchTouch(stage, 'touchmove', [to]);
  dispatchTouch(stage, 'touchend', []);
  await flushPromises();
}

function counter(wrapper: ReturnType<typeof mount>): string {
  return wrapper.get('.counter-text').text();
}

describe('按实际尺寸缩放图片，避免合成图层放大接缝', () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  beforeEach(() => {
    loadResourceMock.mockImplementation(async url => dataOf(url));
    memoryCacheMock.mockReturnValue(null);
    useSettingsStore().settings.autoLoadOriginalImage = false;
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1000 },
      innerHeight: { configurable: true, value: 800 },
    });
  });
  afterEach(() => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: originalWidth },
      innerHeight: { configurable: true, value: originalHeight },
    });
  });

  it('大图按视口适配，放大修改宽高，旋转和平移不通过 transform 缩放', async () => {
    const { wrapper } = await mountViewer();
    await loadImageDimensions(wrapper, 4000, 3000);
    const image = wrapper.get('.viewer-img').element as HTMLImageElement;
    expect(image.style.width).toBe('900px');
    expect(image.style.height).toBe('675px');
    await wrapper.get('.image-stage').trigger('wheel', { deltaY: -1 });
    await wrapper.get('.image-stage').trigger('wheel', { deltaY: -1 });
    await wrapper.get('.image-stage').trigger('wheel', { deltaY: -1 });
    expect(wrapper.get('.zoom-text').text()).toBe('145%');
    expect(image.style.width).toBe('1305px');
    expect(image.style.height).toBe('978.75px');
    expect(image.style.maxWidth).toBe('none');
    expect(image.style.transform).not.toContain('scale(');
    await wrapper.get('[title="向右旋转 90°"]').trigger('click');
    expect(image.style.transform).toContain('rotate(90deg)');
    expect(image.style.width).toBe('1305px');
    await wrapper.get('[title="重置"]').trigger('click');
    expect(image.style.width).toBe('900px');
    expect(image.style.transform).toContain('rotate(0deg)');
    wrapper.unmount();
  });

  it('桌面不将小图片默认放大，窄窗口改用移动端全宽适配', async () => {
    const { wrapper } = await mountViewer();
    const image = wrapper.get('.viewer-img').element as HTMLImageElement;
    expect(image.style.width).toBe('200px');
    await loadImageDimensions(wrapper, 4000, 3000);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    expect(image.style.width).toBe('500px');
    expect(image.style.height).toBe('375px');
    wrapper.unmount();
  });

  it('大图放大超过舞台后，实况视频与封面保持相同尺寸和中心', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const { wrapper, store } = await mountViewer();
    store.openImageViewer([{
      sourceUrl: 'https://img.example/live.jpg',
      liveVideoUrl: 'https://video.coolapk.com/live/test.mp4',
      isLivePhoto: true,
    }]);
    await flushPromises();
    await loadImageDimensions(wrapper, 4000, 3000);
    await wrapper.get('.image-stage').trigger('dblclick');
    const image = wrapper.get('.viewer-img').element as HTMLImageElement;
    const video = wrapper.get('.viewer-live-video').element as HTMLVideoElement;
    expect(image.style.width).toBe('1620px');
    for (const property of ['width', 'height', 'left', 'top', 'margin', 'transform'] as const) {
      expect(video.style[property]).toBe(image.style[property]);
    }
    expect(video.style.left).toBe('calc(50% - 810px)');
    wrapper.unmount();
  });

  it('切图保存旧图尺寸，新图加载后使用自身比例并重置缩放', async () => {
    const { wrapper } = await mountViewer();
    await wrapper.get('[title="放大"]').trigger('click');
    await wrapper.get('.nav-next').trigger('click');
    await flushPromises();
    const ghost = wrapper.get('.viewer-ghost').element as HTMLImageElement;
    expect(ghost.style.width).toBe('250px');
    expect(ghost.style.height).toBe('125px');
    expect(ghost.style.transform).not.toContain('scale(');
    await loadImageDimensions(wrapper, 100, 300);
    const image = wrapper.get('.viewer-img').element as HTMLImageElement;
    expect(image.style.width).toBe('100px');
    expect(image.style.height).toBe('300px');
    expect(wrapper.get('.zoom-text').text()).toBe('100%');
    wrapper.unmount();
  });
});

describe('仅移动端单击图片退出', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Android');
    loadResourceMock.mockImplementation(async url => dataOf(url));
    memoryCacheMock.mockReturnValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('移动端单击图片退出，并等待双击窗口', async () => {
    const { wrapper, store } = await mountViewer();
    const image = wrapper.get('.viewer-img').element;
    dispatchTouch(image, 'touchstart', [point(100, 100)]);
    dispatchTouch(image, 'touchend', []);
    await wrapper.get('.viewer-img').trigger('click');
    expect(store.activeImageViewer).not.toBeNull();
    await vi.advanceTimersByTimeAsync(301);
    expect(store.activeImageViewer).toBeNull();
    wrapper.unmount();
  });

  it('桌面端单击图片仍保持查看', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Windows NT 10.0');
    const { wrapper, store } = await mountViewer();
    await wrapper.get('.viewer-img').trigger('click');
    await vi.advanceTimersByTimeAsync(301);
    expect(store.activeImageViewer).not.toBeNull();
    wrapper.unmount();
  });

  it('移动端双击缩放，取消单击退出', async () => {
    const { wrapper, store, stage } = await mountViewer();
    dispatchTouch(stage, 'touchstart', [point(100, 100)]);
    dispatchTouch(stage, 'touchend', []);
    await vi.advanceTimersByTimeAsync(100);
    dispatchTouch(stage, 'touchstart', [point(100, 100)]);
    dispatchTouch(stage, 'touchend', []);
    await wrapper.get('.viewer-img').trigger('click');
    await vi.advanceTimersByTimeAsync(400);
    expect(store.activeImageViewer).not.toBeNull();
    expect(wrapper.get('.zoom-text').text()).toBe('300%');
    wrapper.unmount();
  });

  it('单击后开始滑动取消退出，切图补发点击不会关闭', async () => {
    const { wrapper, store, stage } = await mountViewer();
    dispatchTouch(stage, 'touchstart', [point(100, 100)]);
    dispatchTouch(stage, 'touchend', []);
    await vi.advanceTimersByTimeAsync(100);
    await swipe(stage, point(300, 400), point(180, 400));
    await wrapper.get('.viewer-img').trigger('click');
    await vi.advanceTimersByTimeAsync(400);
    expect(store.activeImageViewer).not.toBeNull();
    expect(counter(wrapper)).toBe('2 / 3');
    wrapper.unmount();
  });

  it('捏合和取消触摸不会误关，旧查看器的计时不会关闭新查看器', async () => {
    const { wrapper, store, stage } = await mountViewer();
    dispatchTouch(stage, 'touchstart', [point(100, 100), point(200, 100)]);
    dispatchTouch(stage, 'touchend', []);
    await wrapper.get('.viewer-img').trigger('click');
    await vi.advanceTimersByTimeAsync(500);
    expect(store.activeImageViewer).not.toBeNull();
    dispatchTouch(stage, 'touchstart', [point(100, 100)]);
    dispatchTouch(stage, 'touchcancel', []);
    await vi.advanceTimersByTimeAsync(500);
    expect(store.activeImageViewer).not.toBeNull();
    await wrapper.get('.viewer-img').trigger('click');
    store.openImageViewer(['https://img.example/new.jpg']);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(400);
    expect(store.activeImageViewer).not.toBeNull();
    wrapper.unmount();
  });
});

describe.each(['Android', 'Desktop'])('全平台取消最大缩放限制：%s', userAgent => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    loadResourceMock.mockImplementation(async url => dataOf(url));
    memoryCacheMock.mockReturnValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it('按钮和滚轮都能持续放大，重置后恢复默认尺寸', async () => {
    const { wrapper } = await mountViewer();
    for (let i = 0; i < 40; i++) await wrapper.get('[title="放大"]').trigger('click');
    expect(wrapper.get('.zoom-text').text()).toBe('1100%');
    for (let i = 0; i < 60; i++) await wrapper.get('.image-stage').trigger('wheel', { deltaY: -1 });
    expect(wrapper.get('.zoom-text').text()).toBe('2000%');
    await wrapper.get('[title="重置"]').trigger('click');
    expect(wrapper.get('.zoom-text').text()).toBe('100%');
    wrapper.unmount();
  });
});

describe.each(['Android', 'Desktop'])('移动布局官方长图阅读策略：%s', userAgent => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(400);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    loadResourceMock.mockImplementation(async url => dataOf(url));
    memoryCacheMock.mockReturnValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it('超长图按宽度从顶部显示，可滑动读到底部且不会误关闭', async () => {
    const { wrapper, store, stage } = await mountViewer();
    await loadImageDimensions(wrapper, 1000, 20000);
    const image = wrapper.get('.viewer-img').element as HTMLImageElement;
    expect(image.style.width).toBe('400px');
    expect(image.style.height).toBe('8000px');
    expect(image.style.top).toBe('calc(50% - 400px)');
    await swipe(stage, point(200, 600), point(200, -10000));
    expect(image.style.transform).toContain('translate(0px, -7200px)');
    await swipe(stage, point(200, 200), point(200, 10000));
    expect(image.style.transform).toContain('translate(0px, 0px)');
    expect(store.activeImageViewer).not.toBeNull();
    await swipe(stage, point(300, 400), point(100, 400));
    expect(counter(wrapper)).toBe('2 / 3');
    wrapper.unmount();
  });

  it('横屏移动布局长图使用屏幕高度的 9/16 作为阅读宽度，实况图片保持全图适配', async () => {
    // 桌面窄窗口保持在移动布局断点内，真移动设备允许使用更宽的横屏。
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(userAgent === 'Android' ? 800 : 700);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
    const { wrapper, store } = await mountViewer();
    await loadImageDimensions(wrapper, 1000, 20000);
    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.width).toBe('225px');
    store.openImageViewer([{ sourceUrl: 'https://img.example/live.jpg', livePhotoEnable: 1, liveVideoUrl: 'https://img.example/live.mp4' }]);
    await flushPromises();
    await loadImageDimensions(wrapper, 1000, 20000);
    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.width).toBe('20px');
    wrapper.unmount();
  });

  it('长宽比与视口共同决定阅读模式，普通竖图仍完整显示', async () => {
    const { wrapper } = await mountViewer();
    await loadImageDimensions(wrapper, 1000, 2000);
    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.height).toBe('800px');
    await loadImageDimensions(wrapper, 1000, 2500);
    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.height).toBe('1000px');
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(300);
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.height).toBe('750px');
    wrapper.unmount();
  });

  it('高分辨率普通图按像素尺寸动态放大，双指可超过旧的四倍限制', async () => {
    const { wrapper, stage } = await mountViewer();
    await loadImageDimensions(wrapper, 4000, 2000);
    await wrapper.get('.image-stage').trigger('dblclick');
    expect(wrapper.get('.zoom-text').text()).toBe('1000%');
    dispatchTouch(stage, 'touchstart', [point(100, 400), point(200, 400)]);
    dispatchTouch(stage, 'touchmove', [point(0, 400), point(1000, 400)]);
    dispatchTouch(stage, 'touchend', []);
    await flushPromises();
    expect(wrapper.get('.zoom-text').text()).toBe('10000%');
    wrapper.unmount();
  });

  it('按实际舞台高度顶部对齐，鼠标也能拖动阅读长图', async () => {
    const { wrapper, stage } = await mountViewer();
    // 模拟顶栏占用空间后的实际舞台，避免只验证 jsdom 的零尺寸回退。
    Object.defineProperties(stage, { clientWidth: { value: 400 }, clientHeight: { value: 740 } });
    await loadImageDimensions(wrapper, 1000, 20000);
    const image = wrapper.get('.viewer-img').element as HTMLImageElement;
    expect(image.style.width).toBe('400px');
    expect(image.style.top).toBe('calc(50% - 370px)');
    await wrapper.get('.viewer-img').trigger('mousedown', { button: 0, clientX: 200, clientY: 600 });
    await wrapper.get('.image-stage').trigger('mousemove', { clientX: 200, clientY: -10000 });
    expect(image.style.transform).toContain('translate(0px, -7260px)');
    wrapper.unmount();
  });
});

describe('图片查看器触摸手势', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // 每个用例都重新装好默认实现：restoreAllMocks 会清掉工厂里的实现。
    loadResourceMock.mockImplementation(async (url: string) => dataOf(String(url)));
    memoryCacheMock.mockReturnValue(null);
  });

  it('单指左滑切换到下一张', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);
    expect(counter(wrapper)).toBe('1 / 3');

    await swipe(stage, point(300, 400), point(180, 405));

    expect(counter(wrapper)).toBe('2 / 3');
    wrapper.unmount();
  });

  it('单指右滑回到上一张', async () => {
    const { wrapper, stage } = await mountViewer(3, 2);
    expect(counter(wrapper)).toBe('3 / 3');

    await swipe(stage, point(120, 400), point(260, 395));

    expect(counter(wrapper)).toBe('2 / 3');
    wrapper.unmount();
  });

  it('位移不足阈值时不切图', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);

    await swipe(stage, point(300, 400), point(272, 402));

    expect(counter(wrapper)).toBe('1 / 3');
    wrapper.unmount();
  });

  it('滑动切图时旧画面滑出、新画面滑入，而不是硬切', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);

    await swipe(stage, point(300, 400), point(180, 405));

    expect(counter(wrapper)).toBe('2 / 3');
    const ghost = wrapper.get('.viewer-ghost');
    // 幽灵层承接上一张，朝左侧继续滑出。
    expect(ghost.attributes('src')).toBe(dataOf('https://img.example/0.jpg'));
    expect(ghost.attributes('style')).toMatch(/translate\(-\d+px/);
    expect(ghost.classes()).toContain('is-sliding');
    // 新画面从右侧滑入，最终停在居中位置。
    const img = wrapper.get('.viewer-img');
    expect(img.classes()).toContain('is-sliding');
    expect(img.attributes('style')).toContain('translate(0px, 0px)');
    wrapper.unmount();
  });

  it('点击左右导航切图同样走过渡', async () => {
    const { wrapper } = await mountViewer(3, 1);

    await wrapper.get('.nav-next').trigger('click');
    await flushPromises();

    expect(counter(wrapper)).toBe('3 / 3');
    expect(wrapper.get('.viewer-ghost').attributes('src')).toBe(dataOf('https://img.example/1.jpg'));
    wrapper.unmount();
  });

  it('位移不足阈值回弹时也走过渡，不再硬切', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);

    await swipe(stage, point(300, 400), point(272, 400));

    expect(counter(wrapper)).toBe('1 / 3');
    expect(wrapper.get('.viewer-img').classes()).toContain('is-sliding');
    expect(wrapper.get('.viewer-img').attributes('style')).toContain('translate(0px, 0px)');
    wrapper.unmount();
  });

  it('新手势会打断进行中的切图过渡', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);

    await swipe(stage, point(300, 400), point(180, 405));
    expect(wrapper.find('.viewer-ghost').exists()).toBe(true);

    dispatchTouch(stage, 'touchstart', [point(500, 400)]);
    await flushPromises();

    expect(wrapper.find('.viewer-ghost').exists()).toBe(false);
    expect(wrapper.get('.viewer-img').classes()).not.toContain('is-sliding');
    wrapper.unmount();
  });

  it('上滑既不切图也不关闭', async () => {
    const { wrapper, store, stage } = await mountViewer(3, 0);

    await swipe(stage, point(200, 400), point(120, 200));

    expect(counter(wrapper)).toBe('1 / 3');
    expect(store.activeImageViewer).not.toBeNull();
    wrapper.unmount();
  });

  it('放大后横滑是平移而不是切图', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);
    await wrapper.get('.image-stage').trigger('dblclick');

    await swipe(stage, point(300, 400), point(180, 400));

    expect(counter(wrapper)).toBe('1 / 3');
    expect(wrapper.get('.viewer-img').attributes('style')).toContain('translate(-120px');
    wrapper.unmount();
  });

  it('第一张继续右滑有边界阻尼且不会越界', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);

    await swipe(stage, point(200, 400), point(340, 400));

    expect(counter(wrapper)).toBe('1 / 3');
    wrapper.unmount();
  });

  it('滑动结束后的补发点击不会误关查看器', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { wrapper, store, stage } = await mountViewer(3, 1);

    await swipe(stage, point(300, 400), point(180, 400));
    expect(counter(wrapper)).toBe('3 / 3');

    await wrapper.get('.image-viewer-backdrop').trigger('click');
    expect(store.activeImageViewer).not.toBeNull();

    now.mockReturnValue(1_000_500);
    await wrapper.get('.image-viewer-backdrop').trigger('click');
    expect(store.activeImageViewer).toBeNull();
    wrapper.unmount();
  });

  it('没有滑动时点击背景仍然关闭查看器', async () => {
    const { wrapper, store } = await mountViewer(3, 0);

    await wrapper.get('.image-viewer-backdrop').trigger('click');

    expect(store.activeImageViewer).toBeNull();
    wrapper.unmount();
  });

  it('多指手势不触发切图', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);

    dispatchTouch(stage, 'touchstart', [point(300, 400)]);
    dispatchTouch(stage, 'touchmove', [
      point(180, 400),
      point(320, 420),
    ]);
    dispatchTouch(stage, 'touchend', []);
    await flushPromises();

    expect(counter(wrapper)).toBe('1 / 3');
    wrapper.unmount();
  });

  it('触摸取消不切图', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);

    dispatchTouch(stage, 'touchstart', [point(300, 400)]);
    dispatchTouch(stage, 'touchmove', [point(150, 400)]);
    dispatchTouch(stage, 'touchcancel', []);
    await flushPromises();

    expect(counter(wrapper)).toBe('1 / 3');
    wrapper.unmount();
  });

  it('双指捏合按距离比例缩放', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);

    dispatchTouch(stage, 'touchstart', [point(200, 300), point(240, 300)]);
    dispatchTouch(stage, 'touchmove', [point(180, 300), point(260, 300)]);
    await flushPromises();

    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.width).toBe('400px');

    // 捏合结束后不切换图片。
    dispatchTouch(stage, 'touchend', []);
    await flushPromises();
    expect(counter(wrapper)).toBe('1 / 3');
    wrapper.unmount();
  });

  it('捏合缩放不再限制最大倍数', async () => {
    const { wrapper, stage } = await mountViewer(3, 0);

    dispatchTouch(stage, 'touchstart', [point(200, 300), point(210, 300)]);
    dispatchTouch(stage, 'touchmove', [point(100, 300), point(310, 300)]);
    await flushPromises();

    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.width).toBe('4200px');
    wrapper.unmount();
  });

  it('双击放大到 1.8 倍，再双击还原', async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const { wrapper, stage } = await mountViewer(3, 0);

    const tap = async () => {
      dispatchTouch(stage, 'touchstart', [point(300, 400)]);
      dispatchTouch(stage, 'touchend', []);
      await flushPromises();
    };

    await tap();
    clock += 120;
    await tap();
    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.width).toBe('360px');

    clock += 120;
    await tap();
    clock += 120;
    await tap();
    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.width).toBe('200px');

    wrapper.unmount();
  });

  it('两次点击间隔过长不会触发双击缩放', async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const { wrapper, stage } = await mountViewer(3, 0);

    dispatchTouch(stage, 'touchstart', [point(300, 400)]);
    dispatchTouch(stage, 'touchend', []);
    await flushPromises();
    clock += 900;
    dispatchTouch(stage, 'touchstart', [point(300, 400)]);
    dispatchTouch(stage, 'touchend', []);
    await flushPromises();

    expect((wrapper.get('.viewer-img').element as HTMLImageElement).style.width).toBe('200px');
    wrapper.unmount();
  });

  it('单指下滑超过阈值关闭查看器', async () => {
    const { wrapper, store, stage } = await mountViewer(3, 1);

    dispatchTouch(stage, 'touchstart', [point(200, 300)]);
    dispatchTouch(stage, 'touchmove', [point(205, 500)]);
    dispatchTouch(stage, 'touchend', []);
    await flushPromises();

    expect(store.activeImageViewer).toBeNull();
    wrapper.unmount();
  });

  it('单指下滑不足阈值只回弹不关闭', async () => {
    const { wrapper, store, stage } = await mountViewer(3, 1);

    dispatchTouch(stage, 'touchstart', [point(200, 300)]);
    dispatchTouch(stage, 'touchmove', [point(205, 380)]);
    dispatchTouch(stage, 'touchend', []);
    await flushPromises();

    expect(store.activeImageViewer).not.toBeNull();
    expect(wrapper.get('.viewer-img').attributes('style')).toContain('translate(0px, 0px)');
    wrapper.unmount();
  });

  it('切走再切回会重新加载这一张，不会停在上一次的画面', async () => {
    const pending = new Map<string, Array<(value: string) => void>>();
    loadResourceMock.mockImplementation((url: string) => {
      if (String(url).endsWith('/0.jpg')) {
        return new Promise<string>((resolve) => {
          const list = pending.get(String(url)) ?? [];
          list.push(resolve);
          pending.set(String(url), list);
        });
      }
      return Promise.resolve(dataOf(String(url)));
    });

    const { wrapper, stage } = await mountViewer(3, 0);
    // 第一张的原图还在下载，此时切走。
    expect(wrapper.find('.viewer-loading').exists()).toBe(true);

    await swipe(stage, point(300, 400), point(180, 405));
    expect(counter(wrapper)).toBe('2 / 3');
    expect(wrapper.get('.viewer-img').attributes('src')).toBe(dataOf('https://img.example/1.jpg'));

    const url0 = 'https://img.example/0.jpg';
    const before = (pending.get(url0) ?? []).length;

    await swipe(stage, point(180, 400), point(300, 400));
    expect(counter(wrapper)).toBe('1 / 3');

    const requests = pending.get(url0) ?? [];
    // 关键回归：切回来必须重新发起这一张的加载，而不是被"加载中"标记永久跳过。
    expect(requests.length).toBe(before + 1);

    requests[requests.length - 1](dataOf(url0));
    await flushPromises();
    expect(wrapper.get('.viewer-img').attributes('src')).toBe(dataOf(url0));
    wrapper.unmount();
  });

  it('打开查看器会预读左右相邻图片', async () => {
    const { wrapper } = await mountViewer(3, 1);

    const requested = loadResourceMock.mock.calls.map(([url]) => String(url));
    expect(requested).toContain('https://img.example/0.jpg');
    expect(requested).toContain('https://img.example/2.jpg');
    // 预读只预热缓存，不能改变当前显示。
    expect(wrapper.get('.viewer-img').attributes('src')).toBe(dataOf('https://img.example/1.jpg'));
    wrapper.unmount();
  });

  it('命中内存缓存时直接出图，不显示加载中', async () => {
    memoryCacheMock.mockImplementation((url?: string) => (
      url && url.includes('/1.jpg') ? 'data:image/png;base64,CACHED' : null
    ));

    const { wrapper } = await mountViewer(3, 1);

    expect(wrapper.find('.viewer-loading').exists()).toBe(false);
    expect(wrapper.get('.viewer-img').attributes('src')).toBe('data:image/png;base64,CACHED');
    wrapper.unmount();
  });
});
