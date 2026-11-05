import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_COOLAPK_CAPTCHA_ID,
  extractCaptchaParamsFromError,
  loadNECaptchaScript,
  verifyWithCaptcha,
} from '../neteaseCaptcha';

describe('neteaseCaptcha', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = '';
    delete (window as any).initNECaptcha;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.initNECaptcha;
  });

  it('exports default coolapk captcha id', () => {
    expect(DEFAULT_COOLAPK_CAPTCHA_ID).toBe('414e5c9b866a03db03f860a1a9101672');
  });

  it('解析仅返回 403 的验证码响应，且不误判普通 403', () => {
    expect(extractCaptchaParamsFromError(JSON.stringify({ code: 403, messageStatus: 'err_request_captcha_v2' }))).toEqual({ captchaId: DEFAULT_COOLAPK_CAPTCHA_ID, captchaField: '' });
    expect(extractCaptchaParamsFromError(JSON.stringify({ code: 403, message: '无权访问' }))).toBeNull();
  });

  it('优先使用上层挂在错误对象上的业务信封', () => {
    const error = Object.assign(new Error('接口返回错误'), {
      coolapkEnvelope: { code: 403, messageStatus: 'err_request_captcha_v2', messageExtra: { captchaId: 'attached', captchaField: '_v2_post_token' } },
    });
    expect(extractCaptchaParamsFromError(error)).toEqual({ captchaId: 'attached', captchaField: '_v2_post_token' });
  });

  it.each(['', '_v2_post_token'])('保留服务端验证码字段，包括空字段 Cookie 模式：%s', (captchaField) => {
    for (const messageExtra of [{ captchaId: 'test', captchaField }, JSON.stringify({ captchaId: 'test', captchaField })]) {
      expect(extractCaptchaParamsFromError({ code: 403, messageStatus: 'err_request_captcha_v2', messageExtra }))
        .toEqual({ captchaId: 'test', captchaField });
    }
  });

  it('loads the script tag into DOM', async () => {
    const promise = loadNECaptchaScript();
    const script = document.querySelector('script[src*="load.min.js"]');
    expect(script).toBeTruthy();

    (window as any).initNECaptcha = vi.fn();
    script?.dispatchEvent(new Event('load'));
    await promise;
  });

  it('脚本失败后移除标签，并让并发调用共享失败后重新加载', async () => {
    const first = loadNECaptchaScript();
    expect(loadNECaptchaScript()).toBe(first);
    const failure = expect(first).rejects.toThrow('脚本加载失败');
    const failedScript = document.querySelector('script')!;
    failedScript.dispatchEvent(new Event('error'));
    await failure;
    expect(failedScript.isConnected).toBe(false);

    const retry = loadNECaptchaScript();
    const newScript = document.querySelector('script')!;
    expect(newScript).not.toBe(failedScript);
    window.initNECaptcha = vi.fn();
    newScript.dispatchEvent(new Event('load'));
    await retry;
  });

  it.each([false, true])('脚本无事件时超时清理，已有标签=%s', async (existing) => {
    vi.useFakeTimers();
    if (existing) {
      // 模拟旧代码遗留的失败标签，历史 error 事件不会再次触发。
      const script = document.createElement('script');
      script.src = 'https://cstaticdun.126.net/load.min.js';
      document.head.appendChild(script);
      script.dispatchEvent(new Event('error'));
    }
    const failure = expect(loadNECaptchaScript()).rejects.toThrow('脚本加载超时');
    await vi.advanceTimersByTimeAsync(15_000);
    await failure;
    expect(document.querySelector('script')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    const retry = loadNECaptchaScript();
    window.initNECaptcha = vi.fn();
    document.querySelector('script')!.dispatchEvent(new Event('load'));
    await retry;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('脚本加载后没有初始化函数也会清理标签并允许重试', async () => {
    const failure = expect(loadNECaptchaScript()).rejects.toThrow('初始化函数不可用');
    document.querySelector('script')!.dispatchEvent(new Event('load'));
    await failure;
    expect(document.querySelector('script')).toBeNull();
  });

  it('resolves formatted token on successful validation', async () => {
    const popUp = vi.fn(() => { throw new Error('[NECaptcha] apiVersion: 2 unsupport popUp'); });
    const verify = vi.fn();
    (window as any).initNECaptcha = vi.fn((config, onLoad) => {
      const mockInstance = {
        popUp,
        verify,
        refresh: vi.fn(),
        destroy: vi.fn(),
      };
      if (onLoad) onLoad(mockInstance);
      if (config.onReady) config.onReady(mockInstance);
      // Simulate verify success
      if (config.onVerify) {
        config.onVerify(null, { validate: 'mock_validate_hash_12345' });
      }
    });

    const token = await verifyWithCaptcha('414e5c9b866a03db03f860a1a9101672');
    expect(token).toBe('NEC:414e5c9b:mock_validate_hash_12345');
    expect(verify).toHaveBeenCalledOnce();
    expect(popUp).not.toHaveBeenCalled();
    expect(window.initNECaptcha).toHaveBeenCalledWith(expect.objectContaining({ mode: 'popup', apiVersion: 2 }), expect.any(Function), expect.any(Function));
  });

  it('rejects on user cancellation or verify error', async () => {
    (window as any).initNECaptcha = vi.fn((config, onLoad) => {
      const mockInstance = {
        popUp: vi.fn(),
        verify: vi.fn(),
        refresh: vi.fn(),
        destroy: vi.fn(),
      };
      if (onLoad) onLoad(mockInstance);
      if (config.onClose) {
        config.onClose();
      }
    });

    await expect(verifyWithCaptcha()).rejects.toThrow('用户取消了人机验证');
  });

  it('SDK 初始化不回调会超时，迟到的实例会被销毁', async () => {
    vi.useFakeTimers();
    let loaded: ((instance: any) => void) | undefined;
    window.initNECaptcha = vi.fn((_config, onLoad) => { loaded = onLoad; });
    const failure = expect(verifyWithCaptcha()).rejects.toThrow('验证码初始化超时');
    await vi.advanceTimersByTimeAsync(15_000);
    await failure;
    const instance = { verify: vi.fn(), refresh: vi.fn(), destroy: vi.fn() };
    loaded!(instance);
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(instance.verify).not.toHaveBeenCalled();
    expect(document.querySelector('[id^="ne-captcha-"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('弹窗后没有验证或关闭回调也会超时清理', async () => {
    vi.useFakeTimers();
    const instance = { verify: vi.fn(), refresh: vi.fn(), destroy: vi.fn() };
    window.initNECaptcha = vi.fn((config, onLoad) => {
      onLoad?.(instance);
      config.onReady?.();
    });
    const failure = expect(verifyWithCaptcha()).rejects.toThrow('验证码验证超时');
    await vi.advanceTimersByTimeAsync(120_000);
    await failure;
    expect(instance.verify).toHaveBeenCalledOnce();
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(document.querySelector('[id^="ne-captcha-"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('SDK 同步抛错也清理容器和计时器', async () => {
    vi.useFakeTimers();
    window.initNECaptcha = vi.fn(() => { throw new Error('SDK 异常'); });
    await expect(verifyWithCaptcha()).rejects.toThrow('SDK 异常');
    expect(document.querySelector('[id^="ne-captcha-"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['sdk', 'escape'])('通过 %s 关闭验证码后释放页面且不添加额外按钮', async (method) => {
    vi.useFakeTimers();
    const instance = { verify: vi.fn(), refresh: vi.fn(), destroy: vi.fn() };
    window.initNECaptcha = vi.fn((config, onLoad) => {
      const close = document.createElement('button');
      close.className = 'sdk-close';
      close.onclick = () => config.onClose?.();
      (config.element as HTMLElement).replaceChildren(close);
      onLoad?.(instance);
    });
    const failure = expect(verifyWithCaptcha()).rejects.toThrow('用户取消了人机验证');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[aria-label="取消安全验证"]')).toBeNull();
    expect(document.querySelectorAll('[id^="ne-captcha-"] button')).toHaveLength(1);
    if (method === 'sdk') document.querySelector<HTMLButtonElement>('.sdk-close')!.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await failure;
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(document.querySelector('[id^="ne-captcha-"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(instance.destroy).toHaveBeenCalledOnce();
  });
});
