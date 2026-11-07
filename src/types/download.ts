export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'canceled';

export interface DownloadTask {
  id: string;
  /** 'update' 是应用更新包：由 App.vue 的更新器下载，只借用下载中心做展示与入口。 */
  kind: 'apk' | 'xapk' | 'apks' | 'update';
  title: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  apkId: string;
  logoUrl: string;
  fileName: string;
  extraAnalysisData: string;
  downloadDir: string;
  targetPath: string;
  publicPath?: string;
  partialPath: string;
  status: DownloadStatus;
  downloaded: number;
  total: number;
  speed: number;
  retryCount: number;
  error: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number;
  /** 更新包专属：安装包形态（更新器用于 portable/deb/rpm 分支判断）。 */
  packageType?: string;
  /** 更新包专属：下载地址，重发下载时使用。 */
  updateUrl?: string;
}
