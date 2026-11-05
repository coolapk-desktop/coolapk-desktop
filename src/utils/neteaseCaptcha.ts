/**
 * 网易易盾滑块人机验证集成模块
 * 对应酷安官方 APK 中的 NetEaseProtectSDKManager / wn.java 逻辑
 */

declare global {
  interface Window {
    initNECaptcha?: (
      config: NECaptchaConfig,
      onload?: (instance: NECaptchaInstance) => void,
      onerror?: (err: any) => void
    ) => void;
  }
}

export interface NECaptchaConfig {
  captchaId: string;
  element?: string | HTMLElement;
  mode?: 'float' | 'embed' | 'popup';
  apiVersion?: 2;
  width?: string | number;
  lang?: string;
  onReady?: (instance?: NECaptchaInstance) => void;
  onVerify?: (err: any, data: { validate?: string; [key: string]: any }) => void;
  onClose?: () => void;
  [key: string]: any;
}

export interface NECaptchaInstance {
  popUp?: () => void;
  verify: () => void;
  refresh: () => void;
  destroy: () => void;
}

/** 酷安官方网易易盾 Captcha ID */
export const DEFAULT_COOLAPK_CAPTCHA_ID = '414e5c9b866a03db03f860a1a9101672';

/**
 * 从酷安服务端响应中解析动态下发的 Captcha 配置（对应 APK C2143.java / wn.java）
 */
export function extractCaptchaParamsFromResponse(data: any): { captchaId?: string; captchaField?: string } | null {
  if (!data) return null;
  let extraStr = data.messageExtra || data.extra;
  if (!extraStr && typeof data === 'object') {
    if (data.captchaId) {
      return {
        captchaId: data.captchaId,
        captchaField: typeof data.captchaField === 'string' ? data.captchaField : '',
      };
    }
  }
  if (typeof extraStr === 'object' || (typeof extraStr === 'string' && extraStr.trim().startsWith('{'))) {
    try {
      const obj = typeof extraStr === 'string' ? JSON.parse(extraStr) : extraStr;
      if (obj.captchaId) {
        return {
          captchaId: obj.captchaId,
          captchaField: typeof obj.captchaField === 'string' ? obj.captchaField : '',
        };
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

/** 从原生接口抛出的验证码响应中提取配置，兼容服务端只返回 code=403 的情况。 */
export function extractCaptchaParamsFromError(error: unknown): { captchaId: string; captchaField: string } | null {
  // 业务错误信封可能已被上层还原成对象挂在错误上，优先使用结构化字段。
  const attached = error && typeof error === 'object'
    ? (error as { coolapkEnvelope?: unknown }).coolapkEnvelope
    : null;
  let response: any = attached && typeof attached === 'object'
    ? attached
    : error instanceof Error ? error.message : error;
  if (typeof response === 'string') {
    try { response = JSON.parse(response); } catch { return null; }
  }
  if (!response || typeof response !== 'object') return null;
  const params = extractCaptchaParamsFromResponse(response);
  if (params?.captchaId) return { captchaId: params.captchaId, captchaField: params.captchaField ?? '' };
  const reason = [response.messageStatus, response.message, response.error].filter((value) => typeof value === 'string').join(' ');
  if (Number(response.code) === 403 && /(captcha|验证码)/i.test(reason)) {
    return { captchaId: DEFAULT_COOLAPK_CAPTCHA_ID, captchaField: '' };
  }
  return null;
}

let scriptLoadingPromise: Promise<void> | null = null;
const SCRIPT_LOAD_TIMEOUT_MS = 15_000;
const CAPTCHA_INIT_TIMEOUT_MS = 15_000;
const CAPTCHA_VERIFY_TIMEOUT_MS = 120_000;

/**
 * 动态加载网易易盾 Web JS SDK
 */
export function loadNECaptchaScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('易盾验证码只能在浏览器环境运行'));
  }
  if (window.initNECaptcha) {
    return Promise.resolve();
  }
  if (scriptLoadingPromise) {
    return scriptLoadingPromise;
  }

  scriptLoadingPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src*="cstaticdun.126.net/load.min.js"]');
    const script = existing || document.createElement('script');
    let settled = false;
    // 旧标签可能已经触发过事件，统一设置超时，避免永远占用全文请求槽。
    const timeout = window.setTimeout(() => fail(new Error('网易易盾验证码脚本加载超时')), SCRIPT_LOAD_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      // 失败标签必须移除，下次调用才会发起新的脚本请求。
      script.remove();
      reject(error);
    };
    const onLoad = () => {
      if (settled) return;
      if (!window.initNECaptcha) {
        fail(new Error('网易易盾初始化函数不可用'));
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => fail(new Error('网易易盾验证码脚本加载失败'));
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (!existing) {
      script.src = 'https://cstaticdun.126.net/load.min.js';
      script.async = true;
      script.charset = 'utf-8';
      document.head.appendChild(script);
    }
  }).then(() => {
    scriptLoadingPromise = null;
  }, (error) => {
    scriptLoadingPromise = null;
    throw error;
  });

  return scriptLoadingPromise;
}

/**
 * 唤起网易易盾滑块弹窗并完成验证
 * @param captchaId 易盾业务 ID，默认使用酷安官方 ID
 * @returns 返回拼装后的官方标准 Token，格式为 `NEC:{captchaId前8位}:{validate}`
 */
export async function verifyWithCaptcha(captchaId = DEFAULT_COOLAPK_CAPTCHA_ID): Promise<string> {
  await loadNECaptchaScript();

  if (!window.initNECaptcha) {
    throw new Error('网易易盾初始化函数不可用');
  }

  return new Promise<string>((resolve, reject) => {
    // API v2 把 element 作为弹窗的 appendTo 容器；必须覆盖视口，不能用零尺寸节点。
    const container = document.createElement('div');
    container.id = `ne-captcha-${Date.now()}`;
    container.style.position = 'fixed';
    container.style.inset = '0';
    container.style.zIndex = '99999';
    document.body.appendChild(container);

    let captchaInstance: NECaptchaInstance | null = null;
    let resolved = false;
    let initTimeout: ReturnType<typeof setTimeout> | undefined;
    let verifyTimeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(initTimeout);
      clearTimeout(verifyTimeout);
      document.removeEventListener('keydown', onKeyDown, true);
      try {
        if (captchaInstance) {
          captchaInstance.destroy();
        }
      } catch (e) {
        // ignore
      }
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };

    const fail = (error: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(error);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      fail(new Error('用户取消了人机验证'));
    };
    document.addEventListener('keydown', onKeyDown, true);
    initTimeout = setTimeout(() => fail(new Error('验证码初始化超时，请重试或检查网络')), CAPTCHA_INIT_TIMEOUT_MS);

    try {
      window.initNECaptcha!(
        {
          captchaId,
          element: container,
          mode: 'popup',
          apiVersion: 2,
          protocol: 'https',
          width: '320px',
          lang: 'zh-CN',
          onReady: (instance) => {
            if (!resolved && instance) captchaInstance = instance;
          },
          onVerify: (err, data) => {
            if (resolved) return;
            if (err) {
              fail(new Error(typeof err === 'string' ? err : err?.message || '验证码验证失败'));
              return;
            }
            if (data && data.validate) {
              resolved = true;
              const prefix = captchaId.slice(0, 8);
              const token = `NEC:${prefix}:${data.validate}`;
              cleanup();
              resolve(token);
            } else {
              fail(new Error('验证码凭证无效'));
            }
          },
          onClose: () => {
            fail(new Error('用户取消了人机验证'));
          },
        },
        (instance) => {
          // 初始化超时之后迟到的实例也必须销毁，避免遗留弹窗。
          if (resolved) {
            try { instance.destroy(); } catch { /* SDK 可能已自行销毁 */ }
            return;
          }
          captchaInstance = instance;
          clearTimeout(initTimeout);
          if (typeof instance.verify !== 'function') {
            fail(new Error('易盾验证码实例不支持弹出验证'));
            return;
          }
          try {
            verifyTimeout = setTimeout(() => fail(new Error('验证码验证超时，请重试')), CAPTCHA_VERIFY_TIMEOUT_MS);
            // API v2 的 popup 使用 verify；popUp 只适用于旧版 API。
            instance.verify();
          } catch (error) {
            fail(error instanceof Error ? error : new Error('唤起易盾验证码失败'));
          }
        },
        (err) => {
          fail(new Error(typeof err === 'string' ? err : err?.message || '初始化易盾滑块失败'));
        }
      );
    } catch (error) {
      fail(error instanceof Error ? error : new Error('初始化易盾滑块失败'));
    }
  });
}
