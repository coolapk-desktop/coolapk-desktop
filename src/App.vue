<template>
  <AppShell>
    <router-view v-slot="{ Component, route }">
      <!-- 原生标准页面堆栈：/topics 聚合页保持单实例常驻，其他页面按「页面实例身份」入栈（见 getPageComponentKey） -->
      <div class="route-transition-stage" :style="{ '--feed-detail-native-easing': feedDetailEasing }">
      <Transition :name="feedDetailTransition">
      <!-- 缓存槽位随已开页签增长：长浏览不会把仍在使用的列表挤出缓存，返回时位置与分页都还在 -->
      <keep-alive :max="keepAliveMax">
        <component
          :is="Component"
          :key="getRouteKey(route)"
          :class="{ 'sidebar-page-enter': isSidebarTransitionActive && !feedDetailTransition }"
        />
      </keep-alive>
      </Transition>
      </div>
    </router-view>

    <!-- 全局交互浮层 -->
    <PublishDialog />
    <ImageViewer />
    <SearchCommand />
    <LoginModal />
    <AppConfirmHost />
    <AppContextMenu />
    <ShuzilmDeviceGuideModal />
    <EquipmentProductPicker />

    <AppDialog :is-open="Boolean(updateInfo)" :title="updateInfo?.hasNew ? '发现新版本' : '检查更新'" dialog-class="update-content-dialog" :width="660" @close="updateInfo = null">
      <div v-if="updateInfo" class="startup-update">
        <div class="startup-update-header">
          <div class="update-header-info">
            <span class="update-app-title">{{ appUpdateName }}</span>
            <span class="update-version-tag">{{ updateInfo.hasNew ? updateInfo.latestVersion : `v${APP_VERSION}` }}</span>
          </div>
          <span v-if="updateInfo.publishedAt" class="startup-update-date">
            <i class="far fa-clock"></i> {{ updateInfo.publishedAt }}
          </span>
        </div>

        <div
          class="startup-update-notes update-release-notes custom-scrollbar"
          role="region"
          :aria-label="updateInfo.hasNew ? '更新内容' : '当前版本更新日志'"
          tabindex="0"
          v-html="renderReleaseMarkdown(updateInfo.releaseNotes || '')"
          @click="handleAnchorClick"
        ></div>

        <p v-if="updateInfo.hasNew && !canInstallInApp" class="startup-update-notes">
          {{ isMacOS
            ? '请先将应用移到 Applications 或其他可写目录；从磁盘映像运行时请手动下载安装。'
            : isLinux
            ? '当前运行方式无法自动更新，请使用 AppImage 或通过 deb/rpm 安装后再检查更新。'
            : '当前平台暂不支持应用内自动安装，请前往发布页面下载安装。' }}
        </p>

        <div class="startup-update-actions">
          <div v-if="updateInfo.hasNew" class="update-actions-left">
            <button class="btn-text" title="本次不再提示此版本" @click="ignoreThisVersion">忽略此版本</button>
            <button class="btn-text" title="永久关闭所有自动更新提示" @click="ignoreAllUpdates">忽略所有更新</button>
          </div>
          <div v-else class="update-actions-left">
            <button class="btn-text" @click="openReleasePage">查看 Release 页面</button>
          </div>

          <div class="update-actions-right">
            <button v-if="!updateInfo.hasNew" class="startup-update-later" @click="updateInfo = null">关闭</button>
            <button v-if="updateInfo.hasNew" class="startup-update-later" @click="openUpdate">
              {{ isWindows ? '前往下载' : '前往下载更新' }}
            </button>
            <button
              v-if="updateInfo.hasNew && updateInfo.installerUrl && canInstallInApp"
              class="startup-update-button"
              @click="startBackgroundDownload(updateInfo, true)"
            >
              <i class="fas fa-download"></i> 后台下载更新
            </button>
          </div>
        </div>
      </div>
    </AppDialog>

    <AppDialog :is-open="Boolean(downloadNotice)" title="正在下载更新" :width="460" @close="downloadNotice = null">
      <div v-if="downloadNotice" class="startup-update">
        <p class="startup-update-version">{{ appUpdateName }} {{ downloadNotice.version }}</p>
        <div v-if="downloadNotice.releaseNotes" class="startup-update-notes-block">
          <div class="startup-update-notes-header">
            <i class="fas fa-sparkles text-brand"></i>
            <span class="startup-update-notes-label">更新日志</span>
          </div>
          <div
            class="startup-update-notes custom-scrollbar"
            v-html="renderReleaseMarkdown(downloadNotice.releaseNotes)"
            @click="handleAnchorClick"
          ></div>
        </div>
        <p class="startup-update-notes">已发现新版本，更新包正在后台下载。下载完成后会再次提示是否立即更新。</p>
        <p v-if="downloading" class="startup-update-notes">
          当前进度：{{ downloading.percent }}%（{{ formatBytes(downloading.downloaded) }} / {{ formatBytes(downloading.total) }}）
        </p>
        <div class="startup-update-actions">
          <button class="startup-update-later" @click="downloadNotice = null">知道了</button>
        </div>
      </div>
    </AppDialog>

    <AppDialog :is-open="Boolean(readyInfo) && canInstallInApp && readyUpdateVisible" title="更新包已下载" dialog-class="update-content-dialog" :width="660" @close="readyUpdateVisible = false">
      <div v-if="readyInfo" class="startup-update">
        <p class="startup-update-notes">{{ appUpdateName }} {{ readyInfo.version }}</p>
        <div
          v-if="readyInfo.releaseNotes"
          class="startup-update-notes update-release-notes custom-scrollbar"
          role="region"
          aria-label="更新日志"
          tabindex="0"
          v-html="renderReleaseMarkdown(readyInfo.releaseNotes)"
          @click="handleAnchorClick"
        ></div>
        <p class="startup-update-notes">
          {{ isAndroid
            ? '是否打开系统安装界面？请在系统提示中确认安装。'
            : updatePackageType === 'deb' || updatePackageType === 'rpm'
            ? '是否立即更新？系统将请求管理员授权，安装成功后自动重新打开软件。'
            : isMacOS
            ? '是否立即更新？程序将关闭当前窗口，替换应用后自动重新打开。'
            : readyInfo.packageType === 'portable'
            ? '是否立即更新？程序将关闭当前窗口，替换此单文件后自动重新打开。'
            : '是否立即更新？程序将关闭当前窗口，全自动完成安装后重新打开软件。' }}
        </p>
        <p v-if="installPermissionNeeded" class="startup-update-notes">
          请在系统设置中允许酷安安装应用，返回后再次点击“打开安装界面”。
        </p>
        <div class="startup-update-actions">
          <button class="startup-update-later" @click="readyUpdateVisible = false">稍后再说</button>
          <button class="startup-update-button" :disabled="installingUpdate" @click="installNow">
            {{ installingUpdate ? '正在启动更新…' : isAndroid ? '打开安装界面' : '立即更新' }}
          </button>
        </div>
      </div>
    </AppDialog>

    <AppDialog :is-open="Boolean(downloadError)" title="更新失败" :width="460" @close="downloadError = null">
      <div class="startup-update">
        <p class="startup-update-notes">{{ downloadError }}</p>
        <div class="startup-update-actions">
          <button class="startup-update-button" @click="downloadError = null">关闭</button>
        </div>
      </div>
    </AppDialog>

    <div v-if="downloading" class="update-download-pill">
      <i class="fas fa-download"></i>
      <span>正在后台下载更新 {{ downloading.percent }}%（{{ formatBytes(downloading.downloaded) }} / {{ formatBytes(downloading.total) }}）</span>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import EquipmentProductPicker from './components/profile/EquipmentProductPicker.vue';
import { useRoute, useRouter, type RouteLocationNormalizedLoaded } from 'vue-router';
import { listen } from '@tauri-apps/api/event';
import { isWebBuild } from './api/runtime';
import AppShell from './components/layout/AppShell.vue';
import PublishDialog from './components/overlays/PublishDialog.vue';
import ImageViewer from './components/overlays/ImageViewer.vue';
import SearchCommand from './components/overlays/SearchCommand.vue';
import LoginModal from './components/overlays/LoginModal.vue';
import ShuzilmDeviceGuideModal from './components/overlays/ShuzilmDeviceGuideModal.vue';
import AppConfirmHost from './components/common/AppConfirmHost.vue';
import AppContextMenu from './components/common/AppContextMenu.vue';
import AppDialog from './components/common/AppDialog.vue';
import { useAuthStore } from './stores/auth';
import { useSettingsStore } from './stores/settings';
import { isUpdateTask, useDownloadStore } from './stores/downloads';
import {
  APP_VERSION,
  checkLatestRelease,
  isUpdateAssetCompatible,
  isUpdatePackageType,
  isNewerVersion,
  isVersionAllowedInChannel,
  normalizeVersion,
  shouldReplaceDownloadedUpdate,
  versionFromAssetName,
  type UpdateInfo,
  type UpdatePackageType,
} from './utils/updateChecker';
import { renderReleaseMarkdown } from './utils/markdown';
import { handleAnchorClick } from './utils/anchorClick';
import { desktopNotify } from './utils/desktopNotify';
import { showToast } from './utils/toast';
import { setupAndroidBackgroundNotifications } from './utils/androidBackgroundNotifications';
import { useNotificationStore } from './stores/notifications';
import { registerGlobalHotkeys } from './utils/hotkeys';
import { CoolapkTauriAPI } from './api/coolapk';
import { clearResourceCache } from './utils/resourceCache';
import { getFeedDetailTransition, officialFeedDetailEasing, useSidebarTransition } from './utils/routeTransition';
import { useOfficialMobileFeedDetail } from './composables/useOfficialMobileFeedDetail';
import { registerGlobalSelectionClear } from './utils/selection';
import { getPlatformInfo } from './utils/platform';
import { usePageTabsStore } from './stores/pageTabs';
import { getKeepAliveMax, getPageComponentKey } from './utils/pageTabs';
import { logDiagnostic } from './utils/diagnosticLogger';
import { setupKeyboardScrollAssist, setupViewportHeight } from './utils/viewport';
import { registerAgentBridgeConfirm } from './utils/agentBridgeConfirm';

const { isSidebarTransitionActive, resetSidebarTransition } = useSidebarTransition();

function getRouteKey(route: RouteLocationNormalizedLoaded): string {
  // 组件 key 与「页面身份」对齐：同一实体的临时 query（排序、筛选、定位、标题）不再各自占用
  // keep-alive 槽位，否则长浏览后缓存被挤出，返回时滚动位置与已加载分页一起丢失。
  // /topics 仍单实例常驻，/search 仍按「搜索词 + 搜索范围」复用实例，Ctrl+R 代数仍生效。
  return getPageComponentKey(route, pageTabsStore.getGeneration(route));
}

const PENDING_UPDATE_KEY = 'coolapk_pending_update';

type ReadyInfo = {
  version: string;
  path: string;
  fileName?: string;
  packageType: UpdatePackageType;
  releaseNotes?: string;
};
type DownloadNotice = { version: string; releaseNotes?: string };

type DownloadProgress = { downloaded: number; total: number; percent: number };

const router = useRouter();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const downloadStore = useDownloadStore();
const route = useRoute();
// 路由与吸顶状态共同决定安卓状态栏后方的页面背景。
watch(() => [route.path, settingsStore.profileToolbarCompact] as const, ([path, compact]) => { if (/android/i.test(navigator.userAgent)) settingsStore.setAndroidProfileBackground(path === '/me' && !compact); }, { immediate: true });
const officialMobileDetail = useOfficialMobileFeedDetail();
const feedDetailTransition = ref('');
const feedDetailEasing = window.CSS?.supports('transition-timing-function', officialFeedDetailEasing) ? officialFeedDetailEasing : 'cubic-bezier(0.05, 0, 0.25, 1)';
let routeHistoryPosition = Number(window.history.state?.position || 0);
watch(() => route.fullPath, (_next, _previous) => {
  const nextPosition = Number(window.history.state?.position || 0);
  const fromPath = String(_previous || '').split('?')[0]!;
  feedDetailTransition.value = getFeedDetailTransition(fromPath, route.path, nextPosition < routeHistoryPosition, officialMobileDetail.value);
  routeHistoryPosition = nextPosition;
}, { flush: 'sync' });
const pageTabsStore = usePageTabsStore();
// 至少保留 15 个缓存页，并随已开页签数增长（页签数 + 5），页面重建导致的列表分页丢失随之消除。
const keepAliveMax = computed(() => getKeepAliveMax(pageTabsStore.tabs.length));
const updateInfo = ref<UpdateInfo | null>(null);
const downloadNotice = ref<DownloadNotice | null>(null);
const readyInfo = ref<ReadyInfo | null>(null);
const readyUpdateVisible = ref(true);
const downloading = ref<DownloadProgress | null>(null);
const downloadError = ref<string | null>(null);
const installingUpdate = ref(false);
const installPermissionNeeded = ref(false);
const isWindows = ref(false);
const isAndroid = ref(false);
const isMacOS = ref(false);
const isLinux = ref(false);
const canInstallInApp = computed(() => (isWindows.value || isAndroid.value || isMacOS.value || isLinux.value)
  && updatePackageType.value !== 'unsupported');
const appUpdateName = computed(() => isAndroid.value ? '酷安' : '酷安桌面版');
const updatePackageType = ref<UpdatePackageType>('unsupported');
let unregisterHotkeys: (() => void) | null = null;
let unregisterSelectionClear: (() => void) | null = null;
let unregisterViewport: (() => void) | null = null;
let unregisterKeyboardAssist: (() => void) | null = null;
let updateDownloadInFlight = false;
let updateChannelEpoch = 0;
// 下载中心重试入口需要的最近一次更新信息；store 只存展示字段，重发下载必须回到这里。
const lastUpdateAttempt = ref<UpdateInfo | null>(null);
// 当前更新任务在下载中心 store 里的镜像 id；下载本体仍由本组件驱动。
let updateTaskId = '';
// 本次运行内是否已经用应用内提示替代过桌面通知，保证每会话只打扰一次。
let downloadToastHintShown = false;

// 下载中心里更新包镜像记录是「用户还想要这个更新包」的单一真值：
// 记录被用户删除（单条删除 / 批量删除记录）时，更新器必须同步放弃，
// 不能等下载完成后再弹安装窗或写入待安装键（下次启动又会弹）。
// 启动恢复时也关联已有镜像，旧版本留下的无镜像待安装包仍可安装。
const trackedUpdateMirrorVersion = ref('');
// 「被跟踪版本的镜像记录是否仍存在」写成一个 computed，由一个常驻 watcher 观察：
// 若在 watcher 回调里再新建 watcher，每次版本变化都会留下一个不会销毁的监听器。
const trackedUpdateMirrorStillExists = computed(() => {
  const version = trackedUpdateMirrorVersion.value;
  if (!version) return true;
  return downloadStore.tasks.some((task) => isUpdateTask(task) && task.versionName === version);
});
watch(trackedUpdateMirrorStillExists, (stillExists) => {
  if (stillExists || !trackedUpdateMirrorVersion.value) return;
  // 镜像记录已不存在：更新器放弃该包。下载仍在途时无法中止原生下载，
  // 完成回调会再次校验并清理包文件；此时若已就绪则立即撤下弹窗与待安装键。
  trackedUpdateMirrorVersion.value = '';
  localStorage.removeItem(PENDING_UPDATE_KEY);
  readyInfo.value = null;
  readyUpdateVisible.value = false;
  if (!updateDownloadInFlight) {
    void CoolapkTauriAPI.cleanupUpdatePackages().catch(() => undefined);
  }
});

watch(() => settingsStore.settings.updateChannel, () => {
  updateChannelEpoch += 1;
  updateInfo.value = null;
  if (readyInfo.value && !isVersionAllowedInChannel(readyInfo.value.version, settingsStore.settings.updateChannel)) {
    localStorage.removeItem(PENDING_UPDATE_KEY);
    readyInfo.value = null;
    readyUpdateVisible.value = false;
  }
  // 下载中心的更新任务只是镜像：渠道切换后，渠道不再提供的版本同步移除记录，
  // 避免列表仍显示「安装」，引导用户安装渠道已不提供的版本。
  removeDisallowedUpdateRecords((version) => isVersionAllowedInChannel(version, settingsStore.settings.updateChannel));
  void checkForUpdate();
});

// 按给定规则清理下载中心里不再可安装的更新任务镜像。
// 这里属于策略性清理（渠道切换/忽略版本/版本已不需要），不能写删除标记：
// 否则用户切回原渠道后，自动检查会认为「用户删除过」而永远不再提示该版本。
function removeDisallowedUpdateRecords(allowed: (version: string) => boolean) {
  for (const task of downloadStore.tasks) {
    if (isUpdateTask(task) && !allowed(task.versionName || '')) {
      void downloadStore.removeUpdateTask(task.id, false);
    }
  }
}

// 所有路由入口（侧边栏、内容卡片、深链和快捷键）统一在这里登记为可见标签页。
watch(() => route.fullPath, () => pageTabsStore.syncRoute(route), { immediate: true });

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

async function checkForUpdate(manual = false) {
  const channel = settingsStore.settings.updateChannel;
  const epoch = updateChannelEpoch;
  logDiagnostic('info', 'update', 'check_started', `manual=${manual}`);
  try {
    await refreshUpdatePlatform();
    if (manual && canInstallInApp.value && !readyInfo.value) {
      await restorePendingUpdate();
    }
    const result = await checkLatestRelease(
      channel,
      undefined,
      updatePackageType.value
    );
    if (epoch !== updateChannelEpoch) return;
    logDiagnostic('info', 'update', 'check_finished', `has_new=${result.hasNew} has_package=${Boolean(result.installerUrl)}`);
    const latestVersion = normalizeVersion(result.latestVersion || '') || '';
    const ignoredVersion = normalizeVersion(settingsStore.settings.ignoredUpdateVersion) || '';

    // 如果待安装包不是远端最新版本，且新版本有可用安装包，则切换到新版本。
    // 忽略更新、没有安装包或手动检查失败时保留原待安装包，避免用户已下载的更新无故丢失。
    const shouldReplacePending =
      Boolean(readyInfo.value) &&
      result.hasNew &&
      canInstallInApp.value &&
      Boolean(latestVersion) &&
      shouldReplaceDownloadedUpdate(
        readyInfo.value?.version || '',
        latestVersion,
        Boolean(result.installerUrl)
      ) &&
      (manual || (
        !settingsStore.settings.ignoreAllUpdates &&
        latestVersion !== ignoredVersion
      ));
    if (shouldReplacePending) {
      localStorage.removeItem(PENDING_UPDATE_KEY);
      readyInfo.value = null;
      readyUpdateVisible.value = false;
      // 切换到最新版本后，旧版本的更新任务镜像一并移除，避免残留「安装」旧包的入口。
      removeDisallowedUpdateRecords((version) => normalizeVersion(version) === latestVersion);
      try {
        await CoolapkTauriAPI.cleanupUpdatePackages();
      } catch (cleanupError) {
        console.warn('切换最新更新包时清理旧包失败:', cleanupError);
      }
    }
    // 已下载版本与 GitHub 最新版一致（或更新）时直接复用，不再重复下载。
    if (readyInfo.value) {
      if (manual) {
        updateInfo.value = null;
        readyUpdateVisible.value = true;
      }
      return;
    }

    if (result.hasNew && !manual) {
      if (settingsStore.settings.ignoreAllUpdates) return;
      if (latestVersion && latestVersion === ignoredVersion) return;
      // 自动检查：有可用安装包时静默后台下载，完成后弹窗询问是否立即更新
      if (result.installerUrl && canInstallInApp.value) {
        void startBackgroundDownload(result);
        return;
      }
    }
    if (manual || result.hasNew) updateInfo.value = result;
  } catch {
    if (epoch !== updateChannelEpoch) return;
    logDiagnostic('warn', 'update', 'check_failed');
    if (manual && readyInfo.value) {
      updateInfo.value = null;
      readyUpdateVisible.value = true;
      return;
    }
    if (!manual) return;
    updateInfo.value = {
      hasNew: false,
      releaseNotes: '检查更新失败，请检查网络连接后重试。',
      downloadUrl: 'https://github.com/coolapk-desktop/coolapk-desktop/releases',
    };
  }
}

async function refreshUpdatePlatform() {
  const { os } = await getPlatformInfo();
  isWindows.value = os === 'windows';
  isAndroid.value = os === 'android';
  isMacOS.value = os === 'macos';
  isLinux.value = os === 'linux';
  if (isWindows.value || isAndroid.value || isMacOS.value || isLinux.value) {
    const distribution = await CoolapkTauriAPI.getUpdateDistribution();
    updatePackageType.value = isUpdatePackageType(distribution) ? distribution : 'unsupported';
  } else {
    updatePackageType.value = 'unsupported';
  }
}

async function startBackgroundDownload(info: UpdateInfo, manual = false) {
  const url = info.installerUrl;
  const epoch = updateChannelEpoch;
  if (!isVersionAllowedInChannel(info.latestVersion || '', settingsStore.settings.updateChannel)) return;
  // 用户删除过该版本的更新记录时，自动检查不再静默重下/复活镜像；
  // 手动「后台下载更新」代表用户明确再次需要，解除删除标记后照常下载。
  if (manual) downloadStore.clearDeletedUpdateVersion(info.latestVersion || '');
  else if (downloadStore.isUpdateVersionDeleted(info.latestVersion || '')) return;
  // 自动检查、手动检查和按钮点击可能在同一时间触发；同一应用只允许一个下载任务，
  // 否则多个任务会同时写同一个安装包并让进度事件互相覆盖。
  if (readyInfo.value) {
    updateInfo.value = null;
    readyUpdateVisible.value = true;
    return;
  }
  if (!canInstallInApp.value || !url || updateDownloadInFlight || downloading.value) return;
  lastUpdateAttempt.value = info;
  updateDownloadInFlight = true;
  logDiagnostic('info', 'update', 'download_started');
  updateInfo.value = null;
  downloadError.value = null;
  downloadNotice.value = {
    version: info.latestVersion || '新版本',
    releaseNotes: info.releaseNotes || '',
  };
  downloading.value = { downloaded: 0, total: 0, percent: 0 };
  // 在下载中心登记镜像任务（仅展示与入口），不改变本组件驱动下载的既有流程。
  const updateTask = downloadStore.appendUpdate({
    version: info.latestVersion || '新版本',
    fileName: info.installerName,
    total: 0,
    packageType: info.packageType || updatePackageType.value,
    url,
  });
  updateTaskId = updateTask.id;
  let unlisten: (() => void) | null = null;
  let lastDownloaded = 0;
  try {
    unlisten = await listen<{ downloaded: number; total: number }>('update-download-progress', (event) => {
      const { downloaded, total } = event.payload;
      // 丢弃异常的倒退事件，避免进度条因旧任务或事件乱序反复跳动。
      if (downloaded < lastDownloaded) return;
      lastDownloaded = downloaded;
      downloading.value = {
        downloaded,
        total,
        percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0,
      };
      downloadStore.updateUpdateProgress(updateTaskId, downloaded, total);
    });
    const path = await CoolapkTauriAPI.downloadUpdate(url, {
      speedLimitKbps: settingsStore.settings.updateSpeedLimitKBps,
    });
    logDiagnostic('info', 'update', 'download_finished');
    const downloadedVersion = normalizeVersion(info.latestVersion || '') || info.latestVersion || '';
    if (!isVersionAllowedInChannel(downloadedVersion, settingsStore.settings.updateChannel)) {
      downloading.value = null;
      downloadNotice.value = null;
      downloadStore.removeUpdateTask(updateTaskId, false); // 渠道已不提供该版本，镜像记录一并移除（不算用户删除）。
      await CoolapkTauriAPI.cleanupUpdatePackages();
      return;
    }
    try {
      await CoolapkTauriAPI.cleanupUpdatePackages(path);
    } catch (cleanupError) {
      console.warn('清理旧更新包失败，不影响当前安装包使用:', cleanupError);
    }
    downloading.value = null;
    downloadNotice.value = null;
    if (!isVersionAllowedInChannel(downloadedVersion, settingsStore.settings.updateChannel)) {
      downloadStore.removeUpdateTask(updateTaskId, false);
      return;
    }
    // 用户可能在下载期间删除了更新包镜像记录（意图：不要这个更新包）。
    // 此时不得弹安装窗、不得写待安装键，直接清理刚下载的包文件。
    const mirrorStillExists = downloadStore.tasks.some((task) => isUpdateTask(task) && task.id === updateTaskId);
    if (!mirrorStillExists) {
      logDiagnostic('info', 'update', 'download_abandoned_mirror_removed');
      try {
        await CoolapkTauriAPI.cleanupUpdatePackages();
      } catch (cleanupError) {
        console.warn('清理已放弃的更新包失败:', cleanupError);
      }
      return;
    }
    // 与 appendUpdate 登记镜像时的 version 完全一致（未做 normalizeVersion），保证能按 versionName 对上。
    trackedUpdateMirrorVersion.value = info.latestVersion || '新版本';
    readyInfo.value = {
      version: downloadedVersion,
      path,
      fileName: info.installerName,
      packageType: info.packageType || updatePackageType.value,
      releaseNotes: info.releaseNotes || '',
    };
    readyUpdateVisible.value = true;
    downloadStore.markUpdateReady(updateTaskId, path);
    localStorage.setItem(PENDING_UPDATE_KEY, JSON.stringify(readyInfo.value));
    if (settingsStore.settings.notifyDownloadComplete) {
      if (settingsStore.settings.desktopNotifications) {
        void desktopNotify(
          {
            title: '更新包下载完成',
            body: `${appUpdateName.value} ${info.latestVersion || ''} 更新包已下载完成，点击安装即可升级。`,
          },
          settingsStore.settings.notificationSound
        );
      } else if (!downloadToastHintShown) {
        // 用户要下载提示但关掉了系统桌面通知时，系统气泡不会出现；
        // 改为每会话最多一次的轻量提示，并给出通知设置入口。
        downloadToastHintShown = true;
        showToast(
          `${appUpdateName.value} ${info.latestVersion || ''} 更新包已下载完成。系统桌面通知已关闭，可在通知设置中开启提醒。`,
          'info',
          6000,
          { label: '去设置', onClick: () => { void router.push('/settings/notifications'); } }
        );
      }
    }
  } catch (err) {
    logDiagnostic('error', 'update', 'download_failed');
    downloading.value = null;
    downloadNotice.value = null;
    downloadStore.markUpdateFailed(updateTaskId, `更新包下载失败：${String(err)}`);
    downloadError.value = `更新包下载失败，请检查网络连接后重试。(${String(err)})`;
  } finally {
    if (unlisten) await unlisten();
    updateDownloadInFlight = false;
    if (epoch !== updateChannelEpoch) void checkForUpdate();
  }
}

function installNow() {
  const info = readyInfo.value;
  if (!canInstallInApp.value || !info || installingUpdate.value) return;
  // 安装前再次校验：本地已不低于该版本时放弃安装旧包（防降级）
  if (info.version && (!isNewerVersion(info.version)
    || !isVersionAllowedInChannel(info.version, settingsStore.settings.updateChannel))) {
    localStorage.removeItem(PENDING_UPDATE_KEY);
    readyInfo.value = null;
    readyUpdateVisible.value = false;
    // 该版本已不可安装（本地已不低于它，或渠道不再允许），镜像记录一并移除。
    removeDisallowedUpdateRecords((version) => isVersionAllowedInChannel(version, settingsStore.settings.updateChannel));
    void CoolapkTauriAPI.cleanupUpdatePackages().catch(() => undefined);
    return;
  }
  installingUpdate.value = true;
  logDiagnostic('info', 'update', 'install_requested');
  installPermissionNeeded.value = false;
  void (async () => {
    try {
      await settingsStore.flushSettings();
      if (!isVersionAllowedInChannel(info.version, settingsStore.settings.updateChannel)) {
        installingUpdate.value = false;
        return;
      }
      const result = await CoolapkTauriAPI.installUpdate(info.path, info.packageType === 'portable');
      logDiagnostic('info', 'update', 'installer_result', String(result));
      if (isAndroid.value) {
        installPermissionNeeded.value = result === 'permission_required';
        installingUpdate.value = false;
        return;
      }
      // 保留待安装记录到下次启动：安装程序可能启动后失败或被取消，
      // 下次启动可校验版本和文件是否仍存在，再决定重试或重新下载。
      await CoolapkTauriAPI.quitApp();
    } catch (err) {
      logDiagnostic('error', 'update', 'install_failed');
      installingUpdate.value = false;
      downloadError.value = `启动安装程序失败：${String(err)}`;
    }
  })();
}

// 下载中心只发 window 事件、不依赖更新器内部状态：
// - coolapk:install-update（detail: { version?: string }）→ 打开待安装弹窗并走现有 installNow；
// - coolapk:retry-update（无载荷）→ 用最近一次更新信息重新发起下载，退化到手动手检查。
function handleDownloadCenterInstall(event: Event) {
  const version = (event as CustomEvent<{ version?: string }>).detail?.version || '';
  logDiagnostic('info', 'update', 'download_center_install', version);
  if (!readyInfo.value || installingUpdate.value) return;
  readyUpdateVisible.value = true;
  installNow();
}

function handleDownloadCenterRetry() {
  if (updateDownloadInFlight || downloading.value) return;
  if (readyInfo.value) {
    readyUpdateVisible.value = true;
    return;
  }
  if (lastUpdateAttempt.value) {
    // 下载中心的重试是用户明确发起，解除删除标记，允许重新下载并重建镜像。
    void startBackgroundDownload(lastUpdateAttempt.value, true);
    return;
  }
  void checkForUpdate(true);
}

function ignoreThisVersion() {
  const version = updateInfo.value?.latestVersion;
  if (version) {
    settingsStore.ignoreUpdateVersion(version);
    // 忽略该版本后其更新镜像也不再可装，同步清理下载中心记录。
    const normalized = normalizeVersion(version) || version;
    removeDisallowedUpdateRecords((taskVersion) => normalizeVersion(taskVersion) !== normalized);
  }
  updateInfo.value = null;
}

function ignoreAllUpdates() {
  settingsStore.setIgnoreAllUpdates(true);
  updateInfo.value = null;
}

function openUpdate() {
  const url = updateInfo.value?.downloadUrl;
  if (url) void CoolapkTauriAPI.openUrl(url, 'system');
  updateInfo.value = null;
}

function openReleasePage() {
  const url = updateInfo.value?.downloadUrl || 'https://github.com/coolapk-desktop/coolapk-desktop/releases';
  void CoolapkTauriAPI.openUrl(url, 'system');
}

async function restorePendingUpdate(): Promise<boolean> {
  const clearInvalidPending = async () => {
    localStorage.removeItem(PENDING_UPDATE_KEY);
    readyInfo.value = null;
    readyUpdateVisible.value = false;
    try {
      await CoolapkTauriAPI.cleanupUpdatePackages();
    } catch (cleanupError) {
      console.warn('清理失效更新包失败:', cleanupError);
    }
  };

  try {
    const pendingRaw = localStorage.getItem(PENDING_UPDATE_KEY);
    if (!pendingRaw) {
      await CoolapkTauriAPI.cleanupUpdatePackages();
      return false;
    }
    const pending = JSON.parse(pendingRaw) as Partial<ReadyInfo>;
    const version = normalizeVersion(String(pending?.version || ''));
    const path = typeof pending?.path === 'string' ? pending.path.trim() : '';
    const fileName = typeof pending.fileName === 'string'
      ? pending.fileName
      : path.split(/[\\/]/).pop() || '';
    const fileVersion = versionFromAssetName(fileName);
    if (!version || !path || fileVersion !== version || !isNewerVersion(version)
      || !isVersionAllowedInChannel(version, settingsStore.settings.updateChannel)) {
      await clearInvalidPending();
      return false;
    }

    const available = await CoolapkTauriAPI.isUpdatePackageAvailable(path);
    if (!available) {
      await clearInvalidPending();
      return false;
    }

    const packageType = isUpdatePackageType(pending.packageType) ? pending.packageType : 'installer';
    const currentPackageType = await CoolapkTauriAPI.getUpdateDistribution();
    const currentPlatform = await getPlatformInfo();
    if (
      packageType !== currentPackageType ||
      !isUpdateAssetCompatible(fileName, currentPlatform, packageType)
    ) {
      await clearInvalidPending();
      return false;
    }
    const releaseNotes = typeof pending.releaseNotes === 'string' ? pending.releaseNotes.trim() : '';
    if (!isVersionAllowedInChannel(version, settingsStore.settings.updateChannel)) return false;
    if (downloadStore.isUpdateVersionDeleted(version) || downloadStore.isUpdateVersionDeleted(`v${version}`)) {
      await clearInvalidPending();
      return false;
    }
    const mirror = downloadStore.tasks.find((task) => isUpdateTask(task) && normalizeVersion(task.versionName || '') === version);
    trackedUpdateMirrorVersion.value = mirror?.versionName || '';
    readyInfo.value = { version, path, fileName, packageType, releaseNotes };
    readyUpdateVisible.value = true;
    try {
      await CoolapkTauriAPI.cleanupUpdatePackages(path);
    } catch (cleanupError) {
      console.warn('清理旧更新包失败，不影响待安装包使用:', cleanupError);
    }
    return true;
  } catch (error) {
    console.warn('恢复待安装更新失败:', error);
    await clearInvalidPending();
    return false;
  }
}

const handleCheckForUpdate = () => void checkForUpdate(true);
let unregisterAndroidBackground: (() => void) | null = null;
let unregisterAndroidCounts: (() => void) | null = null;
// 后台计数事件由 Rust 侧轮询发出，payload 不携带账号信息：
// 注册时快照当前 uid，回调里校验；切号后旧监听丢弃事件，由 uid watcher 重新注册。
let androidCountsUidSnapshot = '';
async function registerAndroidCountsListener() {
  if (unregisterAndroidCounts) {
    unregisterAndroidCounts();
    unregisterAndroidCounts = null;
  }
  if (!/android/i.test(navigator.userAgent)) return;
  androidCountsUidSnapshot = String(authStore.user?.uid || '');
  if (!androidCountsUidSnapshot) return;
  unregisterAndroidCounts = await listen('android-background-notification-count', event => {
    if (String(authStore.user?.uid || '') !== androidCountsUidSnapshot) return;
    useNotificationStore().applyServerResponse(event.payload);
  });
}
watch(() => String(authStore.user?.uid || ''), () => { void registerAndroidCountsListener(); });
let unregisterAndroidError: (() => void) | null = null;
let unregisterAgentBridgeConfirm: (() => void) | null = null;

onMounted(() => {
  if (!isWebBuild) void downloadStore.initialize();
  authStore.initAuth();
  unregisterAndroidBackground = setupAndroidBackgroundNotifications(() => settingsStore.settings, () => String(authStore.user?.uid || ''));
  if (!isWebBuild && /android/i.test(navigator.userAgent)) {
    void registerAndroidCountsListener();
    void listen<string>('android-background-notification-error', event => {
      showToast(event.payload, 'info', 6000);
    }).then(unlisten => { unregisterAndroidError = unlisten; });
  }
  // Agent 写操作确认：只在本机 MCP 客户端请求时触发，未开启接口时不会收到事件。
  if (!isWebBuild) void registerAgentBridgeConfirm().then(unlisten => { unregisterAgentBridgeConfirm = unlisten; });
  unregisterViewport = setupViewportHeight();
  unregisterKeyboardAssist = setupKeyboardScrollAssist();
  window.addEventListener('resize', settingsStore.refreshAutoZoom);
  unregisterHotkeys = registerGlobalHotkeys();
  unregisterSelectionClear = registerGlobalSelectionClear();

  // 本地调试（vite dev）跳过自动更新检查，避免误弹更新提示或静默下载安装包；
  // 设置页的"立即检查更新"手动触发不受影响
  if (!isWebBuild) void (async () => {
    await refreshUpdatePlatform();
    if (isMacOS.value || isLinux.value) {
      const installError = await CoolapkTauriAPI.takeUpdateInstallError();
      if (installError) downloadError.value = installError;
    }
    if (canInstallInApp.value) {
      await restorePendingUpdate();
      // 启动时以当前渠道为准清理不可安装的更新镜像（覆盖跨会话的渠道/版本残留）。
      removeDisallowedUpdateRecords((version) => isVersionAllowedInChannel(version, settingsStore.settings.updateChannel));
    }
    if (!import.meta.env.DEV && settingsStore.settings.checkUpdateOnStartup) {
      void checkForUpdate();
    }
  })();
  window.addEventListener('check-for-update', handleCheckForUpdate);
  window.addEventListener('coolapk:install-update', handleDownloadCenterInstall);
  window.addEventListener('coolapk:retry-update', handleDownloadCenterRetry);

  // 启动时先清理过期图片，再按总占用阈值决定是否清理全部缓存。
  if (!isWebBuild && settingsStore.settings.autoCleanCache) {
    void (async () => {
      try {
        await CoolapkTauriAPI.cleanExpiredCache(
          settingsStore.settings.cachePath,
          settingsStore.settings.cacheTtlDays
        );
        const info = await CoolapkTauriAPI.getCacheInfo(settingsStore.settings.cachePath);
        const threshold = (settingsStore.settings.cacheThresholdMB || 500) * 1024 * 1024;
        // 更新安装包有独立的待安装生命周期，不应因为安装包体积触发普通缓存清理。
        const ordinaryCacheBytes = Math.max(0, Number(info?.bytes || 0) - Number(info?.updateBytes || 0));
        if (ordinaryCacheBytes > threshold) {
          await clearResourceCache();
          await CoolapkTauriAPI.clearAppCache(settingsStore.settings.cachePath);
        }
      } catch {
        // 自动清理失败不影响启动
      }
    })();
  }
});

onUnmounted(() => {
  unregisterAndroidBackground?.();
  unregisterAndroidCounts?.();
  unregisterAndroidError?.();
  unregisterAgentBridgeConfirm?.();
  window.removeEventListener('check-for-update', handleCheckForUpdate);
  window.removeEventListener('coolapk:install-update', handleDownloadCenterInstall);
  window.removeEventListener('coolapk:retry-update', handleDownloadCenterRetry);
  window.removeEventListener('resize', settingsStore.refreshAutoZoom);
  unregisterHotkeys?.();
  unregisterSelectionClear?.();
  unregisterViewport?.();
  unregisterKeyboardAssist?.();
});
</script>

<style>
/* 全局辅助无边框无滚动 */
html, body {
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

#app {
  margin: 0;
  padding: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.startup-update-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.update-header-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.update-app-title {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
}

.update-version-tag {
  font-size: 12px;
  font-weight: 700;
  color: var(--brand-primary, #10b981);
  background: var(--brand-soft, rgba(16, 185, 129, 0.12));
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.02em;
}

.startup-update-date {
  font-size: 12px;
  color: var(--text-tertiary, #888);
  display: flex;
  align-items: center;
  gap: 5px;
}

.startup-update-date i {
  font-size: 11px;
}

.startup-update-notes-block {
  display: flex;
  flex-direction: column;
  background: var(--background-secondary, rgba(0, 0, 0, 0.02));
  border: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
  border-radius: 8px;
  padding: 12px 14px;
}

.startup-update-notes-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.startup-update-notes-label {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 13px;
}

.startup-update-notes {
  margin: 0;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
  /* 更新日志是主要阅读内容，使用正文色和标准字号提高辨识度。 */
  color: var(--text-primary);
  line-height: 1.7;
  font-size: 14px;
  word-break: break-word;
}

.dialog-container.update-content-dialog {
  max-width: calc(100vw - 24px);
  max-height: min(85vh, calc(var(--app-viewport-height, 100vh) - 24px));
}

.update-content-dialog .dialog-header {
  flex: 0 0 48px;
  padding-inline: 12px;
}

.update-content-dialog .dialog-body,
.update-content-dialog .startup-update {
  display: flex;
  flex-direction: column;
}

.update-content-dialog .dialog-body {
  padding: 12px;
}

.update-content-dialog .startup-update {
  min-height: 0;
  gap: 8px;
}

.update-content-dialog .startup-update > :not(.update-release-notes) {
  flex-shrink: 0;
}

.update-content-dialog .update-release-notes {
  /* 日志优先收缩，极矮窗口再由弹窗正文滚动。 */
  min-height: 80px;
  max-height: none;
  padding: 8px;
  border-radius: 8px;
  background: var(--background-secondary);
}

.update-content-dialog .startup-update-actions {
  margin-top: 0;
  padding-top: 0;
}

.update-content-dialog .startup-update-header {
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-bottom: 0;
}

.update-content-dialog .update-header-info {
  flex-wrap: wrap;
}

.update-content-dialog .startup-update-date,
.update-content-dialog .startup-update-actions .btn-text {
  color: var(--text-secondary);
}

.update-content-dialog .startup-update-actions button {
  white-space: nowrap;
}

/* 窄窗口分两行展示操作，避免四个按钮互相挤压、逐字换行。 */
@media (max-width: 600px) {
  .update-content-dialog .startup-update-actions {
    flex-wrap: wrap;
    gap: 4px;
    padding-top: 8px;
    border-top: 1px solid var(--border-light);
  }

  .update-content-dialog .update-actions-left,
  .update-content-dialog .update-actions-right {
    flex: 1 0 100%;
    flex-wrap: wrap;
  }

  .update-content-dialog .update-actions-left {
    justify-content: center;
    gap: 16px;
  }

  .update-content-dialog .update-actions-right > button {
    /* 两个下载入口等宽，长文案在极窄窗口中整行下移。 */
    flex: 1 0 8rem;
    justify-content: center;
    min-height: 44px;
    font-size: 14px;
  }

  .update-content-dialog .btn-text {
    min-height: 36px;
    font-size: 13px;
  }
}

.startup-update-notes h4,
.startup-update-notes h5,
.startup-update-notes h6 {
  color: var(--text-primary);
  margin: 8px 0 4px;
  font-weight: 600;
  line-height: 1.4;
}

.startup-update-notes h4 {
  font-size: 15px;
}

.startup-update-notes h5 {
  font-size: 14px;
}

.startup-update-notes h6 {
  font-size: 14px;
}

.startup-update-notes p {
  margin: 3px 0;
}

.startup-update-notes ul,
.startup-update-notes ol {
  margin: 3px 0;
  padding-left: 18px;
}

.startup-update-notes li {
  margin: 4px 0;
}

.startup-update-notes blockquote {
  margin: 6px 0;
  padding: 4px 10px;
  background: var(--bg-hover, rgba(0, 0, 0, 0.04));
  border-left: 3px solid var(--brand-green, #10b981);
  border-radius: 4px;
  color: inherit;
}

.startup-update-notes hr {
  border: none;
  border-top: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  margin: 8px 0;
}

.startup-update-notes code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-hover, rgba(0, 0, 0, 0.06));
  font-family: monospace;
  font-size: 12px;
}

.startup-update-notes pre {
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--bg-hover, rgba(0, 0, 0, 0.06));
  overflow-x: auto;
  margin: 6px 0;
}

.startup-update-notes a {
  color: var(--brand-green, #10b981);
  text-decoration: none;
  word-break: break-all;
}

.startup-update-notes a:hover {
  text-decoration: underline;
}

.startup-update-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding-top: 4px;
}

.update-actions-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.update-actions-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.startup-update-actions .btn-text {
  background: transparent;
  border: none;
  padding: 4px 6px;
  color: var(--text-tertiary, #888);
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.18s ease;
}

.startup-update-actions .btn-text:hover {
  color: var(--text-primary);
  background: var(--bg-hover, rgba(0, 0, 0, 0.05));
}

.startup-update-later,
.startup-update-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.startup-update-later {
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
}

.startup-update-later:hover {
  background: var(--bg-hover, rgba(0, 0, 0, 0.04));
  color: var(--text-primary);
}

.startup-update-button {
  color: white;
  background: var(--brand-green, #10b981);
  border: 1px solid var(--brand-green, #10b981);
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.28);
}

.startup-update-button:hover {
  background: #059669;
  border-color: #059669;
  transform: translateY(-1px);
}

.update-download-pill {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(20, 22, 26, 0.92);
  color: #fff;
  font-size: 13px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.update-download-pill i {
  color: var(--brand-green, #10b981);
}
</style>
