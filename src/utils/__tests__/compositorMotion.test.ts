import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  animateTransformSlide,
  cancelTransformSlide,
  prefersReducedMotion,
  READING_MOTION_DURATION_MS,
  READING_MOTION_EASING,
  readTranslateOffset,
} from '../compositorMotion';

describe('compositorMotion', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-reduce-motion');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-reduce-motion');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('prefersReducedMotion 同时识别自定义属性和系统媒体查询', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);

    document.documentElement.setAttribute('data-reduce-motion', 'true');
    expect(prefersReducedMotion()).toBe(true);

    document.documentElement.removeAttribute('data-reduce-motion');
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
  });

  it('readTranslateOffset 正确解析 matrix 与 none 变换', () => {
    const el = document.createElement('div');
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ transform: 'matrix(1, 0, 0, 1, 24, -68.5)' } as CSSStyleDeclaration);
    expect(readTranslateOffset(el, 'x')).toBe(24);
    expect(readTranslateOffset(el, 'y')).toBe(-68.5);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ transform: 'none' } as CSSStyleDeclaration);
    expect(readTranslateOffset(el, 'y')).toBe(0);
    expect(readTranslateOffset(null, 'y')).toBe(0);
  });

  it('animateTransformSlide 在禁用动效、微小位移或缺少 animate 时直接完成', () => {
    const el = document.createElement('div');
    const onFinish = vi.fn();
    expect(animateTransformSlide(el, 'y', 0, 0.2, { onFinish })).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);

    document.documentElement.setAttribute('data-reduce-motion', 'true');
    const onReducedFinish = vi.fn();
    el.animate = vi.fn();
    expect(animateTransformSlide(el, 'y', 0, 80, { onFinish: onReducedFinish })).toBeNull();
    expect(el.animate).not.toHaveBeenCalled();
    expect(onReducedFinish).toHaveBeenCalledTimes(1);
  });

  it('animateTransformSlide 启动 translate3d 合成层动画并支持中断取消与收尾清理', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    const el = document.createElement('div');
    const anim1 = { cancel: vi.fn(), onfinish: null as null | (() => void), oncancel: null as null | (() => void) };
    const anim2 = { cancel: vi.fn(), onfinish: null as null | (() => void), oncancel: null as null | (() => void) };
    const animateSpy = vi.fn().mockReturnValueOnce(anim1).mockReturnValueOnce(anim2);
    el.animate = animateSpy as unknown as typeof el.animate;

    const onFinish1 = vi.fn();
    const onFinish2 = vi.fn();
    const returned1 = animateTransformSlide(el, 'y', 88, 0, { onFinish: onFinish1 });
    expect(returned1).toBe(anim1);
    expect(el.style.willChange).toBe('transform');
    expect(animateSpy).toHaveBeenCalledWith(
      [{ transform: 'translate3d(0, 88px, 0)' }, { transform: 'translate3d(0, 0px, 0)' }],
      { duration: READING_MOTION_DURATION_MS, easing: READING_MOTION_EASING, fill: 'none' },
    );

    const returned2 = animateTransformSlide(el, 'y', 32, 88, { onFinish: onFinish2 });
    expect(returned2).toBe(anim2);
    expect(anim1.cancel).toHaveBeenCalledTimes(1);

    anim2.onfinish?.();
    expect(el.style.willChange).toBe('');
    expect(onFinish2).toHaveBeenCalledTimes(1);

    cancelTransformSlide(el);
    expect(anim2.cancel).not.toHaveBeenCalled();
  });
});
