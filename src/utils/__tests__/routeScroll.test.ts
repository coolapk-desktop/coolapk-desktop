import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreRouteScrollPosition, saveRouteScrollPosition } from '../routeScroll';

describe('route scroll restoration', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('从评论返回时恢复正文位置，并将原本未滚动的裁切外框归零', async () => {
    document.body.innerHTML = '<main class="app-main-content"><div class="app-page-content"><div class="route-transition-stage"><div class="feed-scroll-container custom-scrollbar"></div></div></div></main>';
    const root = document.querySelector<HTMLElement>('main')!;
    const frame = document.querySelector<HTMLElement>('.app-page-content')!;
    const stage = document.querySelector<HTMLElement>('.route-transition-stage')!;
    const list = document.querySelector<HTMLElement>('.feed-scroll-container')!;
    Object.defineProperties(list, { clientHeight: { value: 600 }, scrollHeight: { value: 4000 } });
    list.scrollTop = 1200;
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    saveRouteScrollPosition('/home-before-comments');
    // 模拟详情评论定位带动共享外框，同时缓存列表短暂离开布局。
    root.scrollTop = 80; frame.scrollTop = 160; stage.scrollTop = 240; list.scrollTop = 0;
    await restoreRouteScrollPosition('/home-before-comments');
    // 即便返回动画帧尚未调度，首帧也不能先展示列表顶部。
    expect(list.scrollTop).toBe(1200);
    while (callbacks.length) callbacks.shift()!(0);
    expect(list.scrollTop).toBe(1200);
    expect([root.scrollTop, frame.scrollTop, stage.scrollTop]).toEqual([0, 0, 0]);
  });

  it.each(['new-page', 'comments-entry'])('快速切到 %s 后，旧页面的待执行恢复不能再写入位置', async destination => {
    document.body.innerHTML = '<main class="app-main-content"></main>';
    const root = document.querySelector<HTMLElement>('main')!;
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    root.scrollTop = 140;
    saveRouteScrollPosition('/old-page');
    await restoreRouteScrollPosition('/old-page');
    root.scrollTop = 0;
    if (destination === 'new-page') await restoreRouteScrollPosition('/never-visited-page');
    else saveRouteScrollPosition('/leaving-for-comments');
    // 即使已经出队而无法取消的浏览器回调随后执行，也不能覆盖新页面。
    while (callbacks.length) callbacks.shift()!(0);
    expect(root.scrollTop).toBe(0);
  });

  it('restores the recorded page scroll container without scanning every descendant style', async () => {
    const root = document.createElement('main');
    root.className = 'app-main-content';
    const page = document.createElement('section');
    page.className = 'page-container';
    for (let index = 0; index < 100; index += 1) page.append(document.createElement('div'));
    root.append(page);
    document.body.append(root);

    Object.defineProperties(page, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 600 },
    });
    page.scrollTop = 240;

    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle');
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    saveRouteScrollPosition('/scroll-test');
    page.scrollTop = 0;
    await restoreRouteScrollPosition('/scroll-test');

    expect(page.scrollTop).toBe(240);
    expect(getComputedStyleSpy).not.toHaveBeenCalled();
  });

  it('按节点身份恢复，已销毁页面的位置不会写入同路由的新实例', async () => {
    document.body.innerHTML = '<main class="app-main-content"><section data-route-scroll></section></main>';
    const oldPage = document.querySelector<HTMLElement>('section')!;
    oldPage.scrollTop = 240;
    saveRouteScrollPosition('/recreated-page');
    const newPage = document.createElement('section');
    newPage.setAttribute('data-route-scroll', '');
    oldPage.replaceWith(newPage);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    await restoreRouteScrollPosition('/recreated-page');
    expect(newPage.scrollTop).toBe(0);
  });

  it('缓存列表暂时没有溢出时仍恢复位置，共用外框按路由分别记录', async () => {
    document.body.innerHTML = '<main class="app-main-content"><section data-route-scroll></section></main>';
    const root = document.querySelector<HTMLElement>('main')!;
    const page = document.querySelector<HTMLElement>('section')!;
    root.scrollTop = 10; page.scrollTop = 300;
    saveRouteScrollPosition('/cached-a');
    root.scrollTop = 20; page.scrollTop = 400;
    saveRouteScrollPosition('/cached-b');
    root.scrollTop = page.scrollTop = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    await restoreRouteScrollPosition('/cached-a');
    expect([root.scrollTop, page.scrollTop]).toEqual([10, 300]);
    await restoreRouteScrollPosition('/cached-b');
    expect([root.scrollTop, page.scrollTop]).toEqual([20, 400]);
  });
});
