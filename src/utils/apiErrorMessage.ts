import { classifyDiagnosticRequestError } from './diagnosticLogger';

export interface ApiErrorDescription {
  /** 面向用户的一句话结论，可直接作为错误状态标题。 */
  title: string;
  /** 用户可读正文：结论 + 可执行建议，第二行保留原始错误摘要便于反馈。 */
  message: string;
  /** 与诊断日志一致的分类名，便于复现时对照 category= 字段。 */
  category: string;
}

const MAX_DETAIL_LENGTH = 300;

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return '';
}

/** 原生层可能把酷安的业务错误信封原样作为错误文本抛出，这里还原成字段。 */
function readEnvelope(error: unknown): Record<string, any> | null {
  // 原生/封装层已还原为对象时直接使用，避免再解析错误文本。
  const attached = error && typeof error === 'object'
    ? (error as { coolapkEnvelope?: unknown }).coolapkEnvelope
    : null;
  if (attached && typeof attached === 'object' && !Array.isArray(attached)) {
    return attached as Record<string, any>;
  }
  const text = errorText(error).trim();
  if (!text.startsWith('{')) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
  } catch {
    return null;
  }
}

function envelopeText(envelope: Record<string, any> | null): string {
  if (!envelope) return '';
  return [envelope.messageStatus, envelope.messageExtra, envelope.message, envelope.error]
    .filter((value) => typeof value === 'string')
    .join(' ');
}

function truncate(text: string, limit = MAX_DETAIL_LENGTH): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

/**
 * 把接口错误翻译成用户能理解、能行动的中文提示。
 *
 * 酷安的失败形态差异很大：HTTP 403/429、登录态失效、风控要求人工验证，
 * 以及把业务错误信封（code/messageStatus）当普通响应返回。直接把原始报错
 * 显示在页面上（例如“Rust API returned an invalid response”）只会让用户
 * 以为客户端损坏，因此统一在这里分类。
 */
export function describeApiError(error: unknown, fallbackTitle = '加载失败'): ApiErrorDescription {
  const raw = errorText(error);
  const envelope = readEnvelope(error);
  const haystack = `${raw} ${envelopeText(envelope)}`.toLowerCase();
  const code = envelope ? Number(envelope.code ?? envelope.status) : Number.NaN;
  const detail = truncate(raw || envelopeText(envelope));
  const withDetail = (message: string) => detail ? `${message}\n原始错误：${detail}` : message;
  const category = classifyDiagnosticRequestError(error);

  // 人工验证必须先于 403 判断：酷安用 403 + err_request_captcha_v2 要求拼图。
  if (/captcha|验证码|err_request_captcha/.test(haystack) || category === 'captcha') {
    return {
      title: '需要完成人工验证',
      message: withDetail('酷安要求完成一次人工验证。请在应用内完成验证后重试，验证凭证会自动复用到后续请求。'),
      category: 'captcha',
    };
  }

  if (code === 403 || /\b403\b|forbidden/.test(haystack)) {
    return {
      title: '酷安接口拒绝访问（403）',
      message: withDetail('当前网络出口可能被酷安风控拦截，或登录凭据已失效。请先更换网络（例如切换到手机热点）后重试；仍失败时可在「设置 → 账号」重新导入 Cookie。'),
      category: 'forbidden',
    };
  }

  if (code === 401 || category === 'authentication') {
    return {
      title: '登录状态可能已失效',
      message: withDetail('请重新登录（或重新导入 Cookie）后重试。'),
      category: 'authentication',
    };
  }

  if (code === 429 || code === -415 || category === 'rate_limit'
    || /访问过于频繁|too many|rate.?limit/.test(haystack)) {
    return {
      title: '请求过于频繁',
      message: withDetail('酷安暂时限制了请求频率，请等待几分钟后再试。'),
      category: 'rate_limit',
    };
  }

  if (category === 'request_validation' || /请求验证错误/.test(haystack)) {
    return {
      title: '请求未通过官方校验',
      message: withDetail('请刷新页面后重试；若持续出现，请导出诊断日志反馈。'),
      category: 'request_validation',
    };
  }

  if (category === 'timeout' || /timeout|timed out|超时/.test(haystack)) {
    return {
      title: '请求超时',
      message: withDetail('当前网络较慢或出口不稳定，请检查网络或代理后重试。'),
      category: 'timeout',
    };
  }

  if (['dns', 'network', 'connection_closed'].includes(category)
    || /network|fetch|transport|连接|网络|dns|lookup address|connection/i.test(haystack)) {
    return {
      title: '网络连接失败',
      message: withDetail('无法连接到酷安接口，请检查网络连接或代理规则后重试。'),
      category: category === 'other' ? 'network' : category,
    };
  }

  return {
    title: fallbackTitle,
    message: detail ? `接口返回了无法识别的响应。\n原始错误：${detail}` : '接口返回了无法识别的响应，请重试。',
    category,
  };
}


/**
 * 酷安在 HTTP 200 响应体里用 code/status 表达业务错误（例如
 * `{"code":403,"messageStatus":"err_request_captcha_v2"}`）。原生层
 * 会把整个信封当普通响应返回，这里统一转成错误对象：
 * message 保持人类可读，结构化信封挂在 coolapkEnvelope 上供分类与验证码提取使用。
 *
 * 返回 null 表示不是业务错误响应（正常数据）。
 */
export function apiEnvelopeError(response: unknown): Error | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const envelope = response as Record<string, unknown>;
  const code = Number(envelope.code);
  const status = Number(envelope.status);
  // 0 与 200 是成功态；其它非空数值视为业务错误。
  const failing = (Number.isFinite(code) && ![0, 200].includes(code))
    || (Number.isFinite(status) && ![0, 1, 200].includes(status));
  if (!failing) return null;
  const detail = [envelope.message, envelope.messageStatus, envelope.messageExtra, envelope.error]
    .find((value) => typeof value === 'string' && value.trim());
  const error = new Error(String(detail || '接口返回错误'));
  (error as Error & { coolapkEnvelope?: Record<string, unknown> }).coolapkEnvelope = envelope;
  return error;
}

