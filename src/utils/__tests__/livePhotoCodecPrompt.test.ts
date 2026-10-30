import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { getPlatformInfo } from '../platform';
import { showToast, type ToastAction } from '../toast';
import { HEVC_EXTENSION_URL, showLivePhotoCodecPrompt } from '../livePhotoCodecPrompt';

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: { openUrl: vi.fn() } }));
vi.mock('../platform', () => ({ getPlatformInfo: vi.fn() }));
vi.mock('../toast', () => ({ showToast: vi.fn() }));

const hevc = { id: 'hvc1', name: 'HEVC/H.265', container: 'mp4' as const };

function actions(): ToastAction[] {
  return vi.mocked(showToast).mock.calls[0][3] as ToastAction[];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPlatformInfo).mockResolvedValue({ os: 'windows', arch: 'x86_64' });
  vi.mocked(CoolapkTauriAPI.openUrl).mockResolvedValue(true);
});

describe('实况解码扩展提示', () => {
  it.each(['hvc1', 'hev1'])('Windows %s 提供下载和不再提醒两个入口', async id => {
    const dismiss = vi.fn();
    await showLivePhotoCodecPrompt({ ...hevc, id }, dismiss);
    expect(actions().map(action => action.label)).toEqual(['下载 HEVC 扩展', '不再提醒']);
    actions()[0].onClick();
    await Promise.resolve();
    expect(CoolapkTauriAPI.openUrl).toHaveBeenCalledWith(HEVC_EXTENSION_URL, 'system');
    expect(dismiss).not.toHaveBeenCalled();
    actions()[1].onClick();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it.each(['macos', 'linux', 'android', 'ios', 'unknown'])('%s 不提供 Windows 扩展安装入口', async os => {
    vi.mocked(getPlatformInfo).mockResolvedValue({ os, arch: 'aarch64' });
    await showLivePhotoCodecPrompt(hevc, vi.fn());
    expect(showToast).not.toHaveBeenCalled();
  });

  it('其他编码不提供 HEVC 下载入口', async () => {
    await showLivePhotoCodecPrompt({ id: 'av01', name: 'AV1', container: 'mp4' }, vi.fn());
    expect(actions()).toHaveLength(1);
  });

  it.each([false, new Error('打开失败')])('打开下载页面失败时显示错误提示 (%s)', async result => {
    if (result === false) vi.mocked(CoolapkTauriAPI.openUrl).mockResolvedValue(false);
    else vi.mocked(CoolapkTauriAPI.openUrl).mockRejectedValue(result);
    await showLivePhotoCodecPrompt(hevc, vi.fn());
    actions()[0].onClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(showToast).toHaveBeenLastCalledWith('无法打开下载页面，请稍后重试。', 'error');
  });
});
