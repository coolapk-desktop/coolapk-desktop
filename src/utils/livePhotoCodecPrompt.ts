import { CoolapkTauriAPI } from '../api/coolapk';
import { getPlatformInfo } from './platform';
import { showToast, type ToastAction } from './toast';
import type { LiveVideoCodec } from './liveVideoCodec';

export const HEVC_EXTENSION_URL = 'https://github.com/Ayx03/HEVCVideoExtension';

export async function showLivePhotoCodecPrompt(codec: LiveVideoCodec, dismiss: () => void): Promise<void> {
  const actions: ToastAction[] = [];
  const platform = await getPlatformInfo().catch(() => ({ os: 'unknown' }));
  if (platform.os !== 'windows') return;
  const canInstallHevc = codec.id === 'hvc1' || codec.id === 'hev1';
  if (canInstallHevc) {
    actions.push({
      label: '下载 HEVC 扩展',
      onClick: () => {
        void CoolapkTauriAPI.openUrl(HEVC_EXTENSION_URL, 'system').then(opened => {
          if (!opened) showToast('无法打开下载页面，请稍后重试。', 'error');
        }).catch(() => showToast('无法打开下载页面，请稍后重试。', 'error'));
      },
    });
  }
  actions.push({ label: '不再提醒', onClick: dismiss });
  showToast(
    canInstallHevc
      ? `当前系统不支持该实况照片的视频编码格式（${codec.name}），可前往下载并安装 HEVC 视频扩展，安装后重启应用再试。`
      : `当前系统不支持该实况照片的视频编码格式（${codec.name}），请安装对应的视频解码组件后重启应用。`,
    'warning',
    canInstallHevc ? 12000 : 6000,
    actions,
  );
}
