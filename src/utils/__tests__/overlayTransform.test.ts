import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelOverlayMorph,
  captureOverlayTriggerAnchor,
  runOverlayEnterMorph,
  runOverlayLeaveMorph,
  trackOverlayTriggerPointerCandidate,
} from '../overlayTransform';

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
  const animations: Array<{
    keyframes: Keyframe[];
    options?: KeyframeAnimationOptions;
    finish: () => void;
    cancel: ReturnType<typeof vi.fn>;
  }> = [];
  target.animate = vi.fn((keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) => {
    const anim: any = {
      keyframes: Array.isArray(keyframes) ? keyframes : [],
      options: typeof options === 'object' ? options : undefined,
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

describe('overlayTransform', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-reduce-motion');
  });

  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-reduce-motion');
    vi.restoreAllMocks();
  });

  it('从触发按钮打开浮层时执行带 inset 圆角裁剪的容器形变，关闭时精准缩回原按钮', () => {
    const trigger = document.createElement('button');
    trigger.dataset.overlayTrigger = 'publish';
    trigger.style.borderRadius = '24px';
    mockRect(trigger, { left: 176, top: 720, width: 48, height: 44 });
    const icon = document.createElement('span');
    trigger.appendChild(icon);
    document.body.appendChild(trigger);

    const wrapper = document.createElement('div');
    const dialog = document.createElement('div');
    dialog.className = 'dialog-container';
    dialog.style.borderRadius = '16px';
    mockRect(dialog, { left: 20, top: 140, width: 360, height: 500 });
    const enterAnims = mockAnimate(dialog);
    wrapper.appendChild(dialog);
    document.body.appendChild(wrapper);

    trackOverlayTriggerPointerCandidate(icon);
    const enterDone = vi.fn();
    runOverlayEnterMorph(wrapper, '.dialog-container', 'publish', enterDone);

    expect(enterAnims).toHaveLength(1);
    expect(dialog.style.transformOrigin).toBe('0 0');
    const frames = enterAnims[0]!.keyframes;
    expect(frames.length).toBeGreaterThan(2);
    expect(String(frames[0]?.clipPath)).toContain('inset(');
    expect(String(frames[0]?.transform)).toContain('translate3d(');
    enterAnims[0]!.finish();
    expect(enterDone).toHaveBeenCalledTimes(1);

    const leaveDone = vi.fn();
    runOverlayLeaveMorph(wrapper, '.dialog-container', 'publish', leaveDone);
    expect(enterAnims).toHaveLength(2);
    const leaveFrames = enterAnims[1]!.keyframes;
    expect(String(leaveFrames[leaveFrames.length - 1]?.clipPath)).toContain('inset(');
    enterAnims[1]!.finish();
    expect(leaveDone).toHaveBeenCalledTimes(1);
  });

  it('快捷键打开浮层且无触发按钮锚点时，降级为居中流体弹簧微缩放进退场', () => {
    const wrapper = document.createElement('div');
    const surface = document.createElement('div');
    surface.className = 'search-modal';
    mockRect(surface, { left: 100, top: 80, width: 640, height: 420 });
    const anims = mockAnimate(surface);
    wrapper.appendChild(surface);
    document.body.appendChild(wrapper);

    const enterDone = vi.fn();
    runOverlayEnterMorph(wrapper, '.search-modal', 'search', enterDone);
    expect(anims).toHaveLength(1);
    expect(surface.style.transformOrigin).toBe('center center');
    expect(anims[0]!.keyframes[0]).toMatchObject({ opacity: 0 });
    expect(String(anims[0]!.keyframes[0]?.transform)).toContain('scale3d(0.94');
    anims[0]!.finish();
    expect(enterDone).toHaveBeenCalledTimes(1);
  });

  it('开启减弱动效时直接完成回调，cancelOverlayMorph 会中止正在播放的动画', () => {
    const trigger = document.createElement('button');
    mockRect(trigger, { left: 20, top: 20, width: 120, height: 36 });
    document.body.appendChild(trigger);

    const wrapper = document.createElement('div');
    const surface = document.createElement('div');
    surface.className = 'dialog-container';
    mockRect(surface, { left: 50, top: 50, width: 400, height: 300 });
    const anims = mockAnimate(surface);
    wrapper.appendChild(surface);
    document.body.appendChild(wrapper);

    captureOverlayTriggerAnchor('publish', trigger);
    const doneDuringRun = vi.fn();
    runOverlayEnterMorph(wrapper, '.dialog-container', 'publish', doneDuringRun);
    expect(anims).toHaveLength(1);
    cancelOverlayMorph(wrapper);
    expect(anims[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(doneDuringRun).toHaveBeenCalledTimes(1);

    document.documentElement.setAttribute('data-reduce-motion', 'true');
    captureOverlayTriggerAnchor('publish', trigger);
    const doneReduced = vi.fn();
    runOverlayEnterMorph(wrapper, '.dialog-container', 'publish', doneReduced);
    expect(doneReduced).toHaveBeenCalledTimes(1);
    expect(anims).toHaveLength(1);
  });
});
