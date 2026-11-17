import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildContainerMorphKeyframes,
  captureRouteTransitionAnchor,
  computeLocalStageRect,
  consumeForwardTransitionAnchor,
  createRouteMorphCoordinator,
  findVisibleAnchorElement,
  getDetailTransitionTargetKey,
  isLocalRectVisibleInStage,
  isRouteContainerMorphing,
  setInteractiveBackHandoffBox,
} from '../containerTransform';

function mockRect(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
}

function mockAnimate(target: HTMLElement) {
  const animations: Array<{ keyframes: Keyframe[]; finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
  target.animate = vi.fn((keyframes: Keyframe[] | PropertyIndexedKeyframes | null) => {
    const anim: any = {
      keyframes: Array.isArray(keyframes) ? keyframes : [],
      onfinish: null as null | (() => void),
      oncancel: null as null | (() => void),
      cancel: vi.fn(),
      finish: () => anim.onfinish?.(),
    };
    animations.push(anim);
    return anim;
  });
  return animations;
}

describe('containerTransform', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-reduce-motion');
  });

  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-reduce-motion');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('从详情路由提取标准共享容器键值', () => {
    expect(getDetailTransitionTargetKey('/feed/42')).toBe('feed:42');
    expect(getDetailTransitionTargetKey('/question/100?scrollTo=answers')).toBe('question:100');
    expect(getDetailTransitionTargetKey('/app/com.coolapk.market%2Fbeta')).toBe('app:com.coolapk.market/beta');
    expect(getDetailTransitionTargetKey('/')).toBe('');
  });

  it('在全局 transform scale 缩放下精确把视口矩形换算成舞台逻辑像素', () => {
    const stage = document.createElement('div');
    Object.defineProperty(stage, 'offsetWidth', { configurable: true, value: 1000 });
    Object.defineProperty(stage, 'offsetHeight', { configurable: true, value: 800 });
    // 模拟 #app transform: scale(0.8)
    mockRect(stage, { left: 40, top: 20, width: 800, height: 640 });

    const local = computeLocalStageRect(
      { left: 200, top: 100, width: 320, height: 160, borderRadius: 11.2 },
      stage,
    );
    expect(local.left).toBeCloseTo(200, 3);
    expect(local.top).toBeCloseTo(100, 3);
    expect(local.width).toBeCloseTo(400, 3);
    expect(local.height).toBeCloseTo(200, 3);
    expect(local.borderRadius).toBeCloseTo(14, 3);
    expect(isLocalRectVisibleInStage(local)).toBe(true);
    expect(isLocalRectVisibleInStage({ ...local, top: -250, height: 200 })).toBe(false);
  });

  it('生成等比例缩放配合 inset 圆角裁剪关键帧，不会出现文字拉伸', () => {
    const frames = buildContainerMorphKeyframes(
      { left: 40, top: 120, width: 400, height: 200, borderRadius: 14 },
      { left: 0, top: 0, width: 1000, height: 800, borderRadius: 0 },
      1000,
      800,
      { steps: 4, opacityRange: [0, 1, 0.25, 0.75] },
    );
    expect(frames).toHaveLength(5);
    expect(frames[0]?.transform).toBe('translate3d(40.00px, 120.00px, 0) scale(0.40000)');
    expect(frames[0]?.clipPath).toBe('inset(0px 0.00px 300.00px 0px round 35.00px)');
    expect(frames[0]?.opacity).toBe(0);
    expect(frames[2]?.opacity).toBe(0.5);
    expect(frames[4]?.transform).toBe('translate3d(0.00px, 0.00px, 0) scale(1.00000)');
    expect(frames[4]?.clipPath).toBe('inset(0px 0.00px 0.00px 0px round 0.00px)');
    expect(frames[4]?.opacity).toBe(1);
  });

  it('查找可见源卡片时自动跳过隐藏分页和退出中页面', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <section aria-hidden="true"><article data-feed-id="42"></article></section>
      <section class="route-leaving-active"><article data-feed-id="42"></article></section>
      <section><article id="live-card" data-feed-id="42"></article></section>
    `;
    document.body.appendChild(root);
    const cards = root.querySelectorAll<HTMLElement>('[data-feed-id="42"]');
    cards.forEach((card) => mockRect(card, { left: 10, top: 100, width: 340, height: 220 }));
    expect(findVisibleAnchorElement(root, 'feed:42')?.id).toBe('live-card');
  });

  it('卡片展开转场完成后清理遮罩、快照节点并恢复源卡片可见性', () => {
    const stage = document.createElement('div');
    Object.defineProperty(stage, 'offsetWidth', { configurable: true, value: 900 });
    Object.defineProperty(stage, 'offsetHeight', { configurable: true, value: 700 });
    mockRect(stage, { left: 0, top: 0, width: 900, height: 700 });

    const listPage = document.createElement('div');
    const sourceCard = document.createElement('article');
    sourceCard.setAttribute('data-feed-id', '42');
    sourceCard.style.backgroundColor = 'rgb(255, 255, 255)';
    mockRect(sourceCard, { left: 24, top: 140, width: 340, height: 220 });
    listPage.appendChild(sourceCard);

    const detailPage = document.createElement('div');
    stage.appendChild(listPage);
    stage.appendChild(detailPage);
    document.body.appendChild(stage);

    const listAnims = mockAnimate(listPage);
    const detailAnims = mockAnimate(detailPage);
    // 让动态注入的遮罩/背板/幽灵层也具备 animate mock
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const el = origCreateElement(tag, options);
      mockAnimate(el as HTMLElement);
      return el;
    });

    captureRouteTransitionAnchor(sourceCard, 'feed:42', '/');
    const coordinator = createRouteMorphCoordinator();
    coordinator.prepare({
      mode: 'container-expand',
      targetKey: 'feed:42',
      mobile: true,
      fromPath: '/',
      toPath: '/feed/42',
    });

    const leaveDone = vi.fn();
    const enterDone = vi.fn();
    coordinator.onBeforeLeave(listPage);
    coordinator.onBeforeEnter(detailPage);
    coordinator.onLeave(listPage, leaveDone);
    coordinator.onEnter(detailPage, enterDone);

    expect(isRouteContainerMorphing.value).toBe(true);
    expect(sourceCard.style.visibility).toBe('hidden');
    expect(stage.querySelector('.route-container-scrim')).not.toBeNull();
    expect(stage.querySelector('.route-container-surface-bg')).not.toBeNull();
    expect(stage.querySelector('.route-container-ghost')).not.toBeNull();
    expect(listAnims.length).toBeGreaterThanOrEqual(1);
    expect(detailAnims.length).toBe(1);

    detailAnims[0]!.finish();
    expect(isRouteContainerMorphing.value).toBe(false);
    expect(sourceCard.style.visibility).toBe('');
    expect(stage.querySelector('.route-container-scrim')).toBeNull();
    expect(stage.querySelector('.route-container-ghost')).toBeNull();
    expect(leaveDone).toHaveBeenCalledTimes(1);
    expect(enterDone).toHaveBeenCalledTimes(1);
  });

  it('开启减少动态过渡或缺乏 WAAPI 时同步完成且不留存状态', () => {
    document.documentElement.setAttribute('data-reduce-motion', 'true');
    const stage = document.createElement('div');
    const detailPage = document.createElement('div');
    stage.appendChild(detailPage);
    document.body.appendChild(stage);

    const coordinator = createRouteMorphCoordinator();
    coordinator.prepare({
      mode: 'container-expand',
      targetKey: 'feed:7',
      mobile: false,
      fromPath: '/',
      toPath: '/feed/7',
    });
    const enterDone = vi.fn();
    coordinator.onEnter(detailPage, enterDone);
    expect(enterDone).toHaveBeenCalledTimes(1);
    expect(isRouteContainerMorphing.value).toBe(false);
    expect(consumeForwardTransitionAnchor('feed:7')).toBeNull();
  });

  it('返回收起时若缓存列表卡片的图片尚处于延迟恢复阶段，会复用历史快照中的已加载图片预览镜像', async () => {
    const stage = document.createElement('div');
    mockRect(stage, { left: 0, top: 0, width: 400, height: 800 });

    const listCard = document.createElement('article');
    listCard.className = 'feed-card';
    listCard.dataset.feedId = '77';
    mockRect(listCard, { left: 12, top: 180, width: 376, height: 180 });
    const loadedImg = document.createElement('img');
    loadedImg.setAttribute('src', 'data:image/png;base64,iVBOR');
    listCard.appendChild(loadedImg);

    const listPage = document.createElement('div');
    listPage.appendChild(listCard);
    stage.appendChild(listPage);

    const detailPage = document.createElement('div');
    stage.appendChild(detailPage);
    document.body.appendChild(stage);

    const created = new Set<HTMLElement>();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const el = origCreate(tag, options);
      mockAnimate(el);
      created.add(el);
      return el;
    });
    mockAnimate(listPage);
    mockAnimate(detailPage);

    captureRouteTransitionAnchor(listCard, 'feed:77', '/');
    consumeForwardTransitionAnchor('feed:77', '/');

    // 模拟 KeepAlive 返回恢复期间图片尚未被 IntersectionObserver 填回 src
    loadedImg.removeAttribute('src');

    const coordinator = createRouteMorphCoordinator();
    coordinator.prepare({
      mode: 'container-collapse',
      targetKey: 'feed:77',
      mobile: true,
      fromPath: '/feed/77',
      toPath: '/',
    });
    const leaveDone = vi.fn();
    const enterDone = vi.fn();
    coordinator.onLeave(detailPage, leaveDone);
    coordinator.onEnter(listPage, enterDone);
    await Promise.resolve();
    await Promise.resolve();

    const ghost = Array.from(created).find((el) => el.classList.contains('route-container-ghost'));
    expect(ghost?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBOR');
    coordinator.cancel();
  });

  it('提取商品、直播与好物榜路由标识，并将交互左滑交接盒无缝承接到 container-collapse 起点', async () => {
    expect(getDetailTransitionTargetKey('/product/88')).toBe('product:88');
    expect(getDetailTransitionTargetKey('/live/9')).toBe('live:9');
    expect(getDetailTransitionTargetKey('/goods/lists/12')).toBe('feed:12');
    expect(getDetailTransitionTargetKey('/goods/ranking/5')).toBe('feed:5');

    const root = document.createElement('div');
    const productEl = document.createElement('article');
    productEl.setAttribute('data-transition-anchor', 'product:88');
    mockRect(productEl, { left: 16, top: 140, width: 170, height: 220 });
    root.appendChild(productEl);
    expect(findVisibleAnchorElement(root, 'product:88')).toBe(productEl);

    const stage = document.createElement('div');
    mockRect(stage, { left: 0, top: 0, width: 400, height: 800 });
    const listPage = document.createElement('div');
    listPage.appendChild(productEl);
    stage.appendChild(listPage);
    const detailPage = document.createElement('div');
    stage.appendChild(detailPage);
    document.body.appendChild(stage);

    const created = new Set<HTMLElement>();
    const animMap = new Map<HTMLElement, ReturnType<typeof mockAnimate>>();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const el = origCreate(tag, options);
      animMap.set(el, mockAnimate(el));
      created.add(el);
      return el;
    });
    mockAnimate(listPage);
    mockAnimate(detailPage);

    setInteractiveBackHandoffBox(
      { left: 96, top: 24, width: 340, height: 680, borderRadius: 18 },
      { bgScale: 0.982, scrimOpacity: 0.35 },
    );

    const coordinator = createRouteMorphCoordinator();
    coordinator.prepare({
      mode: 'container-collapse',
      targetKey: 'product:88',
      mobile: true,
      fromPath: '/product/88',
      toPath: '/digital',
    });
    const leaveDone = vi.fn();
    const enterDone = vi.fn();
    coordinator.onLeave(detailPage, leaveDone);
    coordinator.onEnter(listPage, enterDone);
    await Promise.resolve();
    await Promise.resolve();

    const ghost = Array.from(created).find((el) => el.classList.contains('route-container-ghost'));
    expect(ghost).toBeDefined();
    const ghostFrames = animMap.get(ghost!)?.[0]?.keyframes;
    expect(String(ghostFrames?.[0]?.transform)).toContain('translate3d(96.00px, 24.00px, 0)');
    coordinator.cancel();
  });

  it('Android WebView 下自动启用纯合成层快速路径：跳过卡片克隆与背景缩放且零 clip-path 裁剪', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S9280) AppleWebKit/537.36' });

    const stage = document.createElement('div');
    mockRect(stage, { left: 0, top: 0, width: 373, height: 812 });

    const listPage = document.createElement('div');
    const sourceCard = document.createElement('article');
    sourceCard.setAttribute('data-feed-id', '99');
    mockRect(sourceCard, { left: 12, top: 200, width: 349, height: 180 });
    listPage.appendChild(sourceCard);

    const detailPage = document.createElement('div');
    stage.appendChild(listPage);
    stage.appendChild(detailPage);
    document.body.appendChild(stage);

    const animMap = new Map<HTMLElement, ReturnType<typeof mockAnimate>>();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const el = origCreate(tag, options);
      animMap.set(el, mockAnimate(el));
      return el;
    });
    const listAnims = mockAnimate(listPage);
    const detailAnims = mockAnimate(detailPage);

    captureRouteTransitionAnchor(sourceCard, 'feed:99', '/');
    const coordinator = createRouteMorphCoordinator();
    coordinator.prepare({
      mode: 'container-expand',
      targetKey: 'feed:99',
      mobile: true,
      fromPath: '/',
      toPath: '/feed/99',
    });

    const leaveDone = vi.fn();
    const enterDone = vi.fn();
    coordinator.onBeforeLeave(listPage);
    coordinator.onBeforeEnter(detailPage);
    coordinator.onLeave(listPage, leaveDone);
    coordinator.onEnter(detailPage, enterDone);

    expect(listAnims).toHaveLength(0);
    expect(stage.querySelector('.route-container-ghost')).toBeNull();
    const surfaceBg = stage.querySelector<HTMLElement>('.route-container-surface-bg');
    expect(surfaceBg).not.toBeNull();
    const surfaceFrames = animMap.get(surfaceBg!)?.[0]?.keyframes || [];
    expect(surfaceFrames.length).toBe(2);
    expect(surfaceFrames.every((frame) => frame.clipPath === undefined)).toBe(true);
    expect(detailAnims).toHaveLength(1);
    expect(detailAnims[0]!.keyframes.every((frame) => frame.clipPath === undefined)).toBe(true);
    expect(detailPage.style.transformOrigin).toBe('center center');

    detailAnims[0]!.finish();
    expect(leaveDone).toHaveBeenCalledTimes(1);
    expect(enterDone).toHaveBeenCalledTimes(1);
  });
});
