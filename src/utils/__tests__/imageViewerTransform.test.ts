import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureImageViewerAnchor,
  computeFittedViewerImageBox,
  consumePendingImageViewerAnchor,
  findMatchingImageThumb,
  runImageViewerEnterMorph,
  runImageViewerLeaveMorph,
  trackImageViewerPointerCandidate,
} from '../imageViewerTransform';

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

describe('imageViewerTransform', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-reduce-motion');
  });

  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-reduce-motion');
    vi.restoreAllMocks();
  });

  it('按舞台和视口边界居中拟合竖图与横图的目标矩形', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const stageRect = { left: 0, top: 40, width: 1200, height: 760 } as DOMRect;

    const wide = computeFittedViewerImageBox(stageRect, 2);
    expect(wide.width).toBeCloseTo(1080, 1);
    expect(wide.height).toBeCloseTo(540, 1);
    expect(wide.left).toBeCloseTo(60, 1);

    const tall = computeFittedViewerImageBox(stageRect, 0.5);
    expect(tall.height).toBeCloseTo(704, 1);
    expect(tall.width).toBeCloseTo(352, 1);
  });

  it('能定位页面中的匹配缩略图并过滤查看器自身节点，同时解析 URL @WxH 真实纵横比', () => {
    const thumbWrap = document.createElement('div');
    thumbWrap.setAttribute('data-context-image-url', 'https://img.example/pic@900x1200.jpg');
    const thumbImg = document.createElement('img');
    thumbImg.src = 'https://img.example/pic@900x1200.jpg.m.jpg';
    mockRect(thumbWrap, { left: 40, top: 200, width: 120, height: 120 });
    mockRect(thumbImg, { left: 40, top: 200, width: 120, height: 120 });
    thumbWrap.appendChild(thumbImg);
    document.body.appendChild(thumbWrap);

    captureImageViewerAnchor(thumbWrap, 'https://img.example/pic@900x1200.jpg');
    const consumed = consumePendingImageViewerAnchor();
    expect(consumed?.left).toBe(40);
    expect(consumed?.width).toBe(120);
    expect(consumed?.aspectRatio).toBeCloseTo(0.75, 2);

    const matched = findMatchingImageThumb('https://img.example/pic@900x1200.jpg');
    expect(matched?.element).toBe(thumbWrap);
    expect(matched?.aspectRatio).toBeCloseTo(0.75, 2);

    // 多个列表项出现同图时优先命中同一九宫格作用域内的缩略图。
    const gridA = document.createElement('div');
    gridA.className = 'feed-image-grid';
    const dupThumbA = document.createElement('div');
    dupThumbA.setAttribute('data-context-image-url', 'https://img.example/pic@900x1200.jpg');
    mockRect(dupThumbA, { left: 240, top: 200, width: 120, height: 120 });
    gridA.appendChild(dupThumbA);
    document.body.appendChild(gridA);
    const scopedMatched = findMatchingImageThumb('https://img.example/pic@900x1200.jpg', gridA);
    expect(scopedMatched?.element).toBe(dupThumbA);
  });

  it('非 1:1 竖图使用裁切容器盒与 cover 拟合展开收起，隐藏源缩略图不出现溢出或拉伸', () => {
    const thumbWrap = document.createElement('div');
    mockRect(thumbWrap, { left: 40, top: 180, width: 120, height: 120 });
    document.body.appendChild(thumbWrap);

    const backdrop = document.createElement('div');
    const stage = document.createElement('div');
    stage.className = 'image-stage';
    mockRect(stage, { left: 0, top: 40, width: 1000, height: 760 });
    const viewerImg = document.createElement('img');
    viewerImg.className = 'viewer-img';
    Object.defineProperty(viewerImg, 'complete', { value: true });
    Object.defineProperty(viewerImg, 'naturalWidth', { value: 900 });
    Object.defineProperty(viewerImg, 'naturalHeight', { value: 1200 });
    stage.appendChild(viewerImg);
    backdrop.appendChild(stage);
    document.body.appendChild(backdrop);

    const makeAnim = () => {
      const anim: any = {
        onfinish: null as null | (() => void),
        oncancel: null as null | (() => void),
        cancel: vi.fn(),
        finish: () => anim.onfinish?.(),
      };
      return anim;
    };

    const backdropAnims: any[] = [];
    backdrop.animate = vi.fn(() => {
      const a = makeAnim();
      backdropAnims.push(a);
      return a;
    });

    const proxyBoxAnims: Array<{ anim: any; keyframes: any[] }> = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      const el = origCreate(tag, options);
      (el as HTMLElement).animate = vi.fn((keyframes: any) => {
        const a = makeAnim();
        proxyBoxAnims.push({ anim: a, keyframes });
        return a;
      });
      return el;
    });

    const enterDone = vi.fn();
    runImageViewerEnterMorph(backdrop, {
      left: 40,
      top: 180,
      width: 120,
      height: 120,
      borderRadius: 12,
      aspectRatio: 0.75,
      src: 'https://img.example/1.jpg',
      element: thumbWrap,
    }, enterDone, { preferredSrc: 'https://img.example/1_hd.jpg' });

    expect(thumbWrap.style.visibility).toBe('hidden');
    expect(proxyBoxAnims.length).toBe(1);
    const enterFrames = proxyBoxAnims[0]!.keyframes;
    // 验证通过容器宽高 + border-radius 裁切，而不是不等比 transform scale 挤压。
    expect(enterFrames[0]).toMatchObject({ width: '120px', height: '120px', borderRadius: '12px' });
    expect(enterFrames[1]!.transform).toBeUndefined();
    const proxyImg = document.querySelector<HTMLImageElement>('.viewer-morph-proxy-img');
    expect(proxyImg?.src).toBe('https://img.example/1_hd.jpg');

    proxyBoxAnims[0]!.anim.finish();
    expect(enterDone).toHaveBeenCalledTimes(1);
    expect(thumbWrap.style.visibility).toBe('');
    expect(viewerImg.style.opacity).toBe('');
    expect(document.querySelector('.viewer-morph-proxy')).toBeNull();

    // 普通关闭（非下滑）缩回 1:1 源缩略图方框且动画结束后恢复可见。
    const normalLeaveDone = vi.fn();
    runImageViewerLeaveMorph(backdrop, {
      displayRect: { left: 200, top: 80, width: 520, height: 693 } as DOMRect,
      src: 'https://img.example/1_hd.jpg',
      targetThumb: { left: 40, top: 180, width: 120, height: 120, borderRadius: 12, aspectRatio: 0.75, src: 'https://img.example/1.jpg', element: thumbWrap },
      closedBySwipe: false,
    }, normalLeaveDone);
    expect(thumbWrap.style.visibility).toBe('hidden');
    expect(proxyBoxAnims.length).toBe(2);
    expect(proxyBoxAnims[1]!.keyframes[1]).toMatchObject({ width: '120px', height: '120px', borderRadius: '12px' });
    proxyBoxAnims[1]!.anim.finish();
    expect(normalLeaveDone).toHaveBeenCalledTimes(1);
    expect(thumbWrap.style.visibility).toBe('');
    expect(document.querySelector('.viewer-morph-proxy')).toBeNull();

    const swipeLeaveDone = vi.fn();
    runImageViewerLeaveMorph(backdrop, {
      displayRect: { left: 100, top: 100, width: 500, height: 500 } as DOMRect,
      src: 'https://img.example/1.jpg',
      targetThumb: { left: 40, top: 180, width: 120, height: 120, borderRadius: 8, aspectRatio: 1, src: 'https://img.example/1.jpg' },
      closedBySwipe: true,
    }, swipeLeaveDone);
    // 下滑关闭只淡出背景，不再创建回缩代理图
    expect(proxyBoxAnims.length).toBe(2);
    backdropAnims[backdropAnims.length - 1]!.finish();
    expect(swipeLeaveDone).toHaveBeenCalledTimes(1);
  });

  it('从酷图墙、数码截图、私信与通知缩略图指针按下时自动捕获看图锚点', () => {
    const selectors = [
      { cls: 'pic-thumb', url: 'https://img.example/wall@600x800.jpg' },
      { cls: 'screenshot-item', url: 'https://img.example/shot@1080x1920.png' },
      { cls: 'msg-pic-only-card', url: 'https://img.example/chat.jpg' },
      { cls: 'notify-image', url: 'https://img.example/notify.jpg' },
    ];
    for (const [idx, entry] of selectors.entries()) {
      const wrap = document.createElement('div');
      wrap.className = entry.cls;
      wrap.setAttribute('data-context-image-url', entry.url);
      const img = document.createElement('img');
      img.src = entry.url;
      mockRect(wrap, { left: 20 + idx * 90, top: 100, width: 80, height: 80 });
      wrap.appendChild(img);
      document.body.appendChild(wrap);

      trackImageViewerPointerCandidate(img);
      const consumed = consumePendingImageViewerAnchor();
      expect(consumed?.left).toBe(20 + idx * 90);
      expect(consumed?.src).toBe(entry.url);
    }
  });
});
