import { describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';
import { createAndroidRootBackHandler } from '../androidRootBack';

function setup(path = '/', back: string | null = null) {
  const route = { path };
  const router = {
    currentRoute: { value: route },
    options: { history: { state: { back } } },
    back: vi.fn(),
    replace: vi.fn(),
  } as unknown as Router;
  let time = 1000;
  const quit = vi.fn().mockResolvedValue(undefined);
  const toast = vi.fn();
  const handler = createAndroidRootBackHandler(router, quit, toast, () => time);
  return { ...handler, router, route, quit, toast, advance: (ms: number) => { time += ms; } };
}

describe('Android 首页返回', () => {
  it('首页即使有历史也先提示，2 秒内再次返回才退出，并防止重复退出', () => {
    const state = setup('/', '/feed/1');
    state.handle();
    expect(state.toast).toHaveBeenCalledWith('再按一次返回键退出', 'info');
    expect(state.quit).not.toHaveBeenCalled();
    expect(state.router.back).not.toHaveBeenCalled();
    state.advance(1500);
    state.handle();
    state.handle();
    expect(state.quit).toHaveBeenCalledOnce();
  });

  it('超过时间窗口需重新提示', () => {
    const state = setup();
    state.handle();
    state.advance(2001);
    state.handle();
    expect(state.toast).toHaveBeenCalledTimes(2);
    expect(state.quit).not.toHaveBeenCalled();
  });

  it('详情页返回历史，深链详情没有历史时回首页', () => {
    const detail = setup('/feed/1', '/');
    detail.handle();
    expect(detail.router.back).toHaveBeenCalledOnce();
    expect(detail.quit).not.toHaveBeenCalled();
    const deepLink = setup('/feed/1');
    deepLink.handle();
    expect(deepLink.router.replace).toHaveBeenCalledWith('/');
    expect(deepLink.quit).not.toHaveBeenCalled();
    const topic = setup('/topic/xyz');
    topic.handle();
    expect(topic.router.replace).toHaveBeenCalledWith('/topics');
  });

  it('路由变化后清除退出计时', () => {
    const state = setup();
    state.handle();
    state.reset();
    state.handle();
    expect(state.quit).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledTimes(2);
  });

  it('退出失败后提示并允许重试', async () => {
    const state = setup();
    state.quit.mockRejectedValueOnce(new Error('failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.handle();
    state.handle();
    await vi.waitFor(() => expect(state.toast).toHaveBeenCalledWith('退出失败，请重试', 'error'));
    state.handle();
    state.handle();
    expect(state.quit).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
