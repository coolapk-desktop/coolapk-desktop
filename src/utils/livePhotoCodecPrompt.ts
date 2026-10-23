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
      ? `当前播放环境无法解码该实况照片（${codec.name}），可能是 HEVC 视频扩展缺失或兼容性问题。未安装时可下载安装；已安装时请检查扩展、WebView2 和显卡驱动的更新，并重启应用后再试。`
      : `当前播放环境无法解码该实况照片（${codec.name}），请检查对应的解码组件及兼容性后重启应用。`,
    'warning',
    canInstallHevc ? 12000 : 6000,
    actions,
  );
}
