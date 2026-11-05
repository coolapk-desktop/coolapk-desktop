import { describe, expect, it } from 'vitest';
import { apiEnvelopeError, describeApiError } from '../apiErrorMessage';

describe('apiEnvelopeError', () => {
  it('把业务错误信封转成可读错误并保留结构化字段', () => {
    const error = apiEnvelopeError({ code: 403, messageStatus: 'err_request_captcha_v2' });
    expect(error?.message).toBe('err_request_captcha_v2');
    expect((error as any).coolapkEnvelope).toEqual({ code: 403, messageStatus: 'err_request_captcha_v2' });
    expect(describeApiError(error).title).toBe('需要完成人工验证');
  });

  it('兼容用 status 表达业务错误与中文 message', () => {
    const error = apiEnvelopeError({ code: 200, status: 1004, message: '请求验证错误' });
    expect(error?.message).toBe('请求验证错误');
    expect(describeApiError(error).title).toBe('请求未通过官方校验');
  });

  it('正常响应不产生错误', () => {
    expect(apiEnvelopeError({ code: 200, data: [] })).toBeNull();
    expect(apiEnvelopeError({ code: 0, data: [] })).toBeNull();
    expect(apiEnvelopeError({ status: 1, data: {} })).toBeNull();
    expect(apiEnvelopeError([1, 2, 3])).toBeNull();
    expect(apiEnvelopeError(null)).toBeNull();
    // 只有错误码、没有正文也是业务失败，必须报错而不是当空数据处理。
    expect(apiEnvelopeError({ code: 403 })?.message).toBe('接口返回错误');
  });
});

describe('describeApiError', () => {
  it('把首页 HTTP 403 说明成风控或凭据问题并保留原始错误', () => {
    const described = describeApiError(new Error('Coolapk API returned HTTP 403 Forbidden: empty response body'));
    expect(described.title).toBe('酷安接口拒绝访问（403）');
    expect(described.category).toBe('forbidden');
    expect(described.message).toContain('更换网络');
    expect(described.message).toContain('原始错误：Coolapk API returned HTTP 403');
  });

  it('优先识别酷安的业务错误信封中的验证码要求', () => {
    const envelope = JSON.stringify({ code: 403, messageStatus: 'err_request_captcha_v2' });
    const described = describeApiError(new Error(envelope));
    expect(described.title).toBe('需要完成人工验证');
    expect(described.category).toBe('captcha');
    expect(described.message).toContain('验证');
  });

  it('读取上层挂在错误对象上的业务信封', () => {
    const error = Object.assign(new Error('接口返回错误'), {
      coolapkEnvelope: { code: 403, messageStatus: 'err_request_captcha_v2' },
    });
    const described = describeApiError(error);
    expect(described.title).toBe('需要完成人工验证');
    expect(described.category).toBe('captcha');
  });

  it('把频繁访问错误说明成限流提示', () => {
    const described = describeApiError(new Error('酷安接口返回错误：访问过于频繁'));
    expect(described.title).toBe('请求过于频繁');
    expect(described.category).toBe('rate_limit');
  });

  it('识别业务信封里的 -415 限流码', () => {
    const described = describeApiError(new Error(JSON.stringify({ code: -415, message: '访问过于频繁' })));
    expect(described.title).toBe('请求过于频繁');
    expect(described.category).toBe('rate_limit');
  });

  it('区分登录失效与网络失败', () => {
    expect(describeApiError(new Error('Coolapk API returned HTTP 401 Unauthorized')).title)
      .toBe('登录状态可能已失效');
    expect(describeApiError(new Error('error sending request for url: dns error')).title)
      .toBe('网络连接失败');
    expect(describeApiError(new Error('请求超时')).title).toBe('请求超时');
  });

  it('未知错误回退到调用方标题并保留原始信息', () => {
    const described = describeApiError(new Error('Rust API returned an invalid response for get_index_v8_feeds'), '加载动态失败');
    expect(described.title).toBe('加载动态失败');
    expect(described.message).toContain('无法识别的响应');
    expect(described.message).toContain('get_index_v8_feeds');
  });

  it('没有错误文本时也给出可用提示', () => {
    const described = describeApiError(undefined);
    expect(described.message).toContain('无法识别的响应');
  });

  it('截断过长的原始错误', () => {
    const described = describeApiError(new Error('x'.repeat(500)), '加载失败');
    expect(described.message.length).toBeLessThan(400);
    expect(described.message).toContain('…');
  });
});
