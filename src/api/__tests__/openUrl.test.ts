import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { CoolapkTauriAPI } from '../coolapk';
import { showToast } from '../../utils/toast';
vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../utils/diagnosticLogger', async (original) => ({
  ...await original<typeof import('../../utils/diagnosticLogger')>(),
  logDiagnostic: vi.fn(), logDiagnosticLimited: vi.fn(), summarizeDiagnosticError: String,
}));

const routerMocks = vi.hoisted(() => ({
  push: vi.fn().mockResolvedValue(undefined),
  resolve: vi.fn().mockReturnValue({ matched: [{}] }),
}));
vi.mock('../../router', () => ({ router: routerMocks }));

describe('系统浏览器打开链接', () => {
  it.each(['JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/secret.txt'])('危险协议不进入原生或浏览器打开入口：%s', async url => {
    await expect(CoolapkTauriAPI.openUrl(url, 'system')).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });
  const originalBridge = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__');

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    routerMocks.push.mockClear();
    routerMocks.resolve.mockClear();
    vi.mocked(showToast).mockClear();
    vi.spyOn(window, 'open').mockReturnValue(null);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  });

  afterEach(() => {
    if (originalBridge) Object.defineProperty(window, '__TAURI_INTERNALS__', originalBridge);
    else Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.restoreAllMocks();
  });

  it('原生应用通过系统打开命令调起浏览器', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await CoolapkTauriAPI.openUrl('https://example.com/article', 'system');
    expect(invoke).toHaveBeenCalledWith('open_url', { url: 'https://example.com/article', mode: 'system' });
    expect(window.open).not.toHaveBeenCalled();
  });

  it.each([
    'https://example.com/article',
    'https://github.com/coolapk-desktop/coolapk-desktop',
    'https://coolapk.com.evil.com/feed/123',
    'https://evilcoolapk.com/feed/123',
    'https://coolapk.com@evil.com/feed/123',
    'HTTPS://EXAMPLE.COM/article',
  ])('非酷安地址点击时直接调起系统浏览器，不进入页面：%s', async (url) => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await CoolapkTauriAPI.openUrl(url);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_url', { url, mode: 'system' });
    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(routerMocks.resolve).not.toHaveBeenCalled();
  });

  it('协议相对的站外地址直接交给浏览器，不拼接酷安域名', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await CoolapkTauriAPI.openUrl('//example.com/article', 'internal');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_url', {
      url: 'https://example.com/article', mode: 'system'
    });
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it('酷安动态保留站内跳转', async () => {
    await CoolapkTauriAPI.openUrl('https://www.coolapk.com/feed/123');
    expect(routerMocks.push).toHaveBeenCalledWith('/feed/123');
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['花粉Alive', 'd2n9_S6h3e'])('@用户名链接精确查出 UID 后打开主页：%s', async username => {
    vi.mocked(invoke).mockResolvedValue({ code: 200, data: [
      { uid: '11', username: `${username}相似名字` },
      { uid: '22', username },
    ] });
    await expect(CoolapkTauriAPI.openUrl(`https://www.coolapk.com/u/${encodeURIComponent(username)}`))
      .resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('search_users', { query: username, page: 1 });
    expect(routerMocks.push).toHaveBeenCalledExactlyOnceWith('/user/22');
  });

  it('没有精确匹配或有效 UID 时提示，不打开相似用户或官网分享页', async () => {
    vi.mocked(invoke).mockResolvedValue({ code: 200, data: [
      { uid: '11', username: '花粉Alive2' },
      { uid: '0', username: '花粉Alive' },
    ] });
    await expect(CoolapkTauriAPI.openUrl('https://www.coolapk.com/u/花粉Alive')).resolves.toBe(false);
    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('未找到用户'), 'warning');
  });

  it('查找用户失败时提示并允许再次点击重试', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('网络错误'));
    await expect(CoolapkTauriAPI.openUrl('https://www.coolapk.com/u/花粉Alive')).resolves.toBe(false);
    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('用户主页打开失败，请稍后重试。', 'error');
    vi.mocked(invoke).mockResolvedValue({ code: 200, data: [{ uid: '22', username: '花粉Alive' }] });
    await expect(CoolapkTauriAPI.openUrl('https://www.coolapk.com/u/花粉Alive')).resolves.toBe(true);
    expect(routerMocks.push).toHaveBeenCalledWith('/user/22');
  });

  it('未适配的酷安网页可继续应用内查看', async () => {
    await CoolapkTauriAPI.openUrl('https://account.coolapk.com/');
    expect(routerMocks.push).toHaveBeenCalledWith({ path: '/external', query: { url: 'https://account.coolapk.com/' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['editProductOwner', 'productOwnerShare'])('装备操作 %s 使用完整内置 WebView', async method => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const url = `https://m.coolapk.com/mp/do?c=product&m=${method}`;
    await CoolapkTauriAPI.openEquipmentWebview(url);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_url', { url, mode: 'internal' });
    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it.each([
    'https://m.coolapk.com.evil.com/mp/do?c=product&m=editProductOwner',
    'https://evil.com/mp/do?c=product&m=editProductOwner',
    'https://m.coolapk.com/mp/do?c=user&m=editProductOwner',
    'https://m.coolapk.com/mp/do?c=product&m=delete',
  ])('装备操作拒绝非指定页面：%s', async url => {
    await expect(CoolapkTauriAPI.openEquipmentWebview(url)).rejects.toThrow('无效的装备页面链接');
    expect(invoke).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('装备内置窗口创建失败时保留错误，不回退到系统浏览器', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('窗口创建失败'));
    await expect(CoolapkTauriAPI.openEquipmentWebview('https://m.coolapk.com/mp/do?c=product&m=editProductOwner'))
      .rejects.toThrow('窗口创建失败');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('原生打开失败时提示默认浏览器设置并提供复制入口，不产生拒绝或退回 WebView', async () => {
    vi.mocked(invoke).mockRejectedValue('未安装可打开链接的应用');
    await expect(CoolapkTauriAPI.openUrl('https://example.com/article', 'system'))
      .resolves.toBe(false);
    expect(window.open).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('默认浏览器'), 'error', 8000,
      expect.objectContaining({ label: '复制链接' }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      const action = vi.mocked(showToast).mock.calls[0]![3]!;
      expect(Array.isArray(action)).toBe(false);
      if (!Array.isArray(action)) action.onClick();
      await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('链接已复制'));
      expect(writeText).toHaveBeenCalledWith('https://example.com/article');
    } finally { vi.unstubAllGlobals(); }
  });

  it('复制失败也提供提示，不产生未处理的拒绝', async () => {
    vi.mocked(invoke).mockRejectedValue('操作已被用户取消。 (os error 1223)');
    await CoolapkTauriAPI.openUrl('https://example.com');
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    try {
      const action = vi.mocked(showToast).mock.calls[0]![3]!;
      expect(Array.isArray(action)).toBe(false);
      if (!Array.isArray(action)) action.onClick();
      await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('复制失败'), 'error'));
    } finally { vi.unstubAllGlobals(); }
  });

  it('普通网页预览仍可使用浏览器窗口备用入口', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.mocked(invoke).mockRejectedValue('没有原生桥接');
    await CoolapkTauriAPI.openUrl('https://example.com/article', 'system');
    expect(window.open).toHaveBeenCalledWith('https://example.com/article', '_blank', 'noopener,noreferrer');
  });
});
