import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackInitialScrollAnchor } from '../initialScrollAnchor';

describe('初次滚动定位跟随异步布局', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

  function setup() {
    document.body.innerHTML = '<main style="overflow-y:auto"><article><section>目标</section></article></main>';
    let notify!: () => void;
    const observed: Element[] = [];
    const disconnect = vi.fn();
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notify = callback; } observe(element: Element) { observed.push(element); } disconnect = disconnect; });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const align = vi.fn();
    const stop = trackInitialScrollAnchor(document.querySelector('section')!, align);
    const paint = () => { const tasks = [...frames.values()]; frames.clear(); tasks.forEach(callback => callback(0)); };
    return { notify, observed, align, stop, frames, disconnect, paint, root: document.querySelector('main')! };
  }

  it('观察正文祖先，完整正文和图片后到时合并到下一帧重新定位', () => {
    const task = setup();
    expect(task.observed.map(element => element.tagName)).toEqual(['SECTION', 'ARTICLE', 'MAIN']);
    task.notify(); task.notify();
    expect(task.frames.size).toBe(1);
    task.paint();
    task.notify(); task.paint();
    expect(task.align).toHaveBeenCalledTimes(2);
    task.stop();
  });

  it.each(['wheel', 'touchmove', 'pointerdown', 'keydown'])('用户通过 %s 开始阅读后，迟到的布局更新不再拉回', event => {
    const task = setup();
    task.notify();
    task.root.dispatchEvent(event === 'keydown' ? new KeyboardEvent(event, { key: 'PageDown', bubbles: true }) : new Event(event, { bubbles: true }));
    task.notify(); task.paint();
    expect(task.align).not.toHaveBeenCalled();
    expect(task.disconnect).toHaveBeenCalledOnce();
  });

  it('离开页面取消待执行的定位，重复释放无副作用', () => {
    const task = setup();
    task.notify(); task.stop(); task.stop(); task.paint();
    expect(task.align).not.toHaveBeenCalled();
    expect(task.disconnect).toHaveBeenCalledOnce();
  });
});
