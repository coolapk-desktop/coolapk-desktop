<template>
  <div class="settings-section">
    <h3 class="section-title">启动与行为设置</h3>

    <div class="setting-group">
      <h4 class="group-title">启动</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">启动后默认页签</span>
          <span class="row-sub">应用启动后首页自动进入的栏目</span>
        </div>
        <select v-model="settingsStore.settings.defaultHomeTab" class="select-control">
          <option value="index_v8">推荐</option>
          <option value="digest">头条</option>
          <option value="hot">热榜</option>
          <option value="latest">快讯</option>
          <option value="cool_picture">酷图</option>
          <option value="secondhand">二手</option>
        </select>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">开机自启动</span>
          <span class="row-sub">登录系统后自动在后台启动应用</span>
        </div>
        <AppSwitch
          :model-value="settingsStore.settings.autostart"
          @update:model-value="toggleAutostart"
        />
      </div>
      <p v-if="autostartError" class="tray-tip">
        <i class="fas fa-exclamation-triangle"></i>
        设置开机自启动失败，请重试或检查系统权限。
      </p>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">启动时最小化到托盘</span>
          <span class="row-sub">启动后自动隐藏主窗口，在后台静默运行（适合配合开机自启动）</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.startMinimized" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">启动时检查更新</span>
          <span class="row-sub">应用启动后自动向 GitHub Release 检测最新版本</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.checkUpdateOnStartup" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">更新渠道</span>
          <span class="row-sub">测试版渠道可提前体验新功能，稳定性略低于稳定版</span>
        </div>
        <select v-model="settingsStore.settings.updateChannel" class="select-control">
          <option value="stable">稳定版</option>
          <option value="beta" :disabled="!settingsStore.settings.experimentalFeatures">
            测试版{{ settingsStore.settings.experimentalFeatures ? '' : ' (需开启实验性功能)' }}
          </option>
        </select>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">实验性功能</span>
          <span class="row-sub">启用实验性功能，例如测试版更新渠道</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.experimentalFeatures" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">立即检查更新</span>
          <span class="row-sub">手动检测最新版本并重新弹出更新提示</span>
        </div>
        <button class="check-update-button" type="button" @click="checkNow">检查更新</button>
      </div>

      <p v-if="updateTipHidden" class="tray-tip">
        <i class="fas fa-info-circle"></i>
        已忽略更新提醒（忽略此版本或忽略所有更新），更新提示将不再自动弹出。
      </p>
      <button v-if="updateTipHidden" class="reset-update-button" type="button" @click="reopenTip">
        重新启用更新提醒
      </button>
    </div>

    <div v-if="showLiveTileSetting" class="setting-group">
      <h4 class="group-title">Windows 10 动态磁贴（开发预览）</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">启用动态磁贴</span>
          <span class="row-sub">在开始菜单磁贴上显示真实酷安内容（最多 5 条自动轮播），关闭时停用刷新并清空磁贴队列</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.liveTileEnabled" />
      </div>

      <div v-if="settingsStore.settings.liveTileEnabled" class="setting-row">
        <div class="row-info">
          <span class="row-label">磁贴数据源</span>
          <span class="row-sub">开始菜单动态磁贴显示的内容来源</span>
        </div>
        <select v-model="settingsStore.settings.liveTileSource" class="select-control">
          <option value="index_v8">推荐</option>
          <option value="hot">热榜</option>
          <option value="news">快讯</option>
          <option value="digest">精选</option>
        </select>
      </div>

      <p class="tray-tip">
        <i class="fas fa-info-circle"></i>
        {{
          hasLiveTileIdentity
            ? '已检测到稀疏身份包，开启后磁贴将在启动时、每 30 分钟及切换数据源时自动刷新。'
            : '当前进程尚未检测到稀疏身份包，需先按下方开发预览说明完成注册后磁贴才会生效。'
        }}
      </p>

      <details class="live-tile-guide">
        <summary class="live-tile-guide-summary">查看开发预览说明与启用步骤</summary>
        <div class="live-tile-guide-body">
          <p>
            <strong>这是开发预览，不是面向最终用户的启用方式。</strong>
            不启用时应用行为与之前完全一致：不发任何额外网络请求，也不产生额外日志。
          </p>

          <h5>为什么需要额外一步</h5>
          <p>
            磁贴由系统外壳渲染，驱动它的 <code>TileUpdateManager</code> 要求调用方具有<strong>包标识（package identity）</strong>。未打包的 Win32 程序调用只会得到 <code>0x80070490</code>。
          </p>
          <p>
            本项目的做法是给 exe 叠加一个<strong>稀疏身份包</strong>（sparse package）—— 一个只有几 KB、仅含清单的包，指向应用的安装目录。<strong>应用本体不搬动、不重新打包</strong>，NSIS 安装版与便携版仍然是主线发行形态。
          </p>

          <h5>为什么当前只作为开发预览</h5>
          <p>
            下面的脚本需要机器上装有 Windows SDK（提供 <code>mt.exe</code>）来给 exe 嵌入身份元素。<strong>这不该是普通用户的依赖。</strong>
          </p>
          <p>
            正式发行方案应当把两件事都移出用户机器：嵌入 <code>&lt;msix&gt;</code> 放到<strong>构建阶段</strong>（顺序为 embed → 签名 → 打包），注册身份包交给 <strong>NSIS 安装器</strong>。此外身份包需要受信任的签名证书，否则未签名的包在用户机器上仍会撞上「开发者模式」这一门槛。在这些落地之前，本功能以开发工具的形式提供。
          </p>

          <h5>启用方式（开发用）</h5>
          <p>
            需要 <strong>Windows 10 2004（内部版本 19041）或更高</strong>。<strong>Windows 11 不支持</strong> —— 微软已在该系统中移除动态磁贴，脚本会直接拒绝运行。
          </p>
          <pre class="guide-code"><code># 在仓库根目录执行
powershell -ExecutionPolicy Bypass -File .\scripts\dev-live-tile.ps1</code></pre>
          <p>
            脚本流程对 <strong>exe 清单与身份包注册</strong>是事务式的：全部前置检查（含磁贴资源校验）通过后才开始改动；修改 exe 前先备份其清单；注册失败会自动回滚 exe 清单，且<strong>不会破坏已有的注册</strong>。磁贴资源会在前置阶段复制到安装目录，不参与回滚 —— 它们是普通 PNG，留着不影响使用；停用时也不会删除。
          </p>
          <p>
            默认作用于 <code>src-tauri\target\release</code>，用 <code>-InstallDir</code> 可指定其他安装目录。完成后打开开始菜单搜索「酷安」，右键 → 固定到“开始”屏幕。
          </p>
          <p>停用身份包注册：</p>
          <pre class="guide-code"><code>powershell -ExecutionPolicy Bypass -File .\scripts\dev-live-tile.ps1 -Unregister</code></pre>

          <h5>关于开发者模式</h5>
          <p>
            未签名的包需要<strong>开发者模式</strong>才能注册。<strong>脚本不会替你打开它</strong> —— 那是一个影响整台机器安装策略的系统设置，应当由你自己决定：
          </p>
          <p class="guide-quote">
            设置 → 更新和安全 → 开发者选项 → 开发人员模式（或按 <code>Win+R</code> 输入 <code>ms-settings:developers</code>）
          </p>
          <p>
            如果注册因策略被拒，脚本会明确提示这一点，不做静默处理。开发者模式是可逆开关，关掉即恢复原状。
          </p>

          <h5>已知限制</h5>
          <ul class="guide-list">
            <li>磁贴需要应用处于运行状态才会刷新（启动时、每 30 分钟、以及切换数据源时）。关闭应用后磁贴会停留在最后一次的内容上。</li>
            <li><strong>点击磁贴只会打开应用，不会跳转到磁贴上显示的那条动态。</strong> 主磁贴的轮播条目各自无法携带激活目标 —— 逐条点击参数是 Toast 的模型，套不到磁贴队列上。若要精确跳到某条动态，入口应是通知而非磁贴。</li>
            <li>稀疏身份包与便携版的自更新机制存在冲突：<code>get_update_distribution()</code> 依据同目录下有无 <code>uninstall.exe</code> 判断安装形态，稀疏布局没有该文件，会被判定为便携版并走自替换路径。启用磁贴后请留意更新行为。</li>
          </ul>
        </div>
      </details>
    </div>

    <div class="setting-group">
      <h4 class="group-title">窗口行为</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">关闭主窗口时</span>
          <span class="row-sub">点击关闭按钮后是退出程序，还是最小化到托盘常驻</span>
        </div>
        <select v-model="closeBehavior" class="select-control">
          <option value="exit">退出程序</option>
          <option value="tray">最小化到托盘</option>
        </select>
      </div>
      <p v-if="settingsStore.settings.closeToTray" class="tray-tip">
        <i class="fas fa-info-circle"></i>
        最小化到托盘后，可通过托盘图标或托盘菜单恢复窗口，并从菜单选择“退出”来彻底关闭应用。
      </p>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">窗口置顶</span>
          <span class="row-sub">主窗口始终显示在其他窗口之上</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.alwaysOnTop" />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">记忆窗口大小与位置</span>
          <span class="row-sub">重启应用后恢复上次的窗口位置与大小（默认开启）</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.rememberWindowState" />
      </div>

      <!-- 同一开关只在外观设置中提供入口，这里仅保留说明与跳转，避免两处配置口径分叉。 -->
      <!-- 生效状态告警：开关值已保存但桌面端没同步成功，与「未保存修改」是两个语义。 -->
      <p v-if="nativeSyncFailureText" class="native-sync-alert" role="alert">
        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
        {{ nativeSyncFailureText }}
      </p>

      <div v-if="showDesktopLayoutSwitch" class="setting-row">
        <div class="row-info">
          <span class="row-label">窗口响应式布局</span>
          <span class="row-sub">「禁止窄窗口自动切换手机模式」已统一到外观设置，可在“外观设置 → 窗口响应式布局”中调整</span>
        </div>
        <router-link class="settings-link" to="/settings/appearance">前往外观设置</router-link>
      </div>

      <p class="tray-tip">
        <i class="fas fa-info-circle"></i>
        应用支持单实例运行：重复启动时会自动聚焦已有窗口，不会打开多个实例。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import AppSwitch from '../../components/common/AppSwitch.vue';
import { getPlatformInfo, isTouchMobilePlatform } from '../../utils/platform';

const settingsStore = useSettingsStore();
// 桌面端语义的开关：手机上窗口永远窄，开了只会把移动外壳关掉，因此不展示。
const showDesktopLayoutSwitch = !isTouchMobilePlatform();

// 仅在 Windows 10 下展示动态磁贴设置与开发预览说明（Windows 11 已移除动态磁贴）。
const showLiveTileSetting = ref(false);
const hasLiveTileIdentity = ref(false);
void getPlatformInfo().then((info) => {
  showLiveTileSetting.value = info.isWindows10 === true || info.supportsLiveTile === true;
  hasLiveTileIdentity.value = info.supportsLiveTile === true;
});
const autostartError = ref(false);

const closeBehavior = computed({
  get: () => (settingsStore.settings.closeToTray ? 'tray' : 'exit'),
  set: (value: string) => {
    settingsStore.settings.closeToTray = value === 'tray';
  },
});

// 三项桌面行为的「是否生效」独立于开关值：失败时不回滚开关，只在此处提示真实状态。
const nativeSyncFailureText = computed(() => {
  const failed: string[] = [];
  if (settingsStore.traySyncFailed) failed.push('关闭到托盘');
  if (settingsStore.alwaysOnTopSyncFailed) failed.push('窗口置顶');
  if (settingsStore.startupFlagsSyncFailed) failed.push('启动参数');
  if (failed.length === 0) return '';
  return `${failed.join('、')}未能同步到桌面端，当前可能未生效；请重新切换对应开关，或重启应用后再试。`;
});

const updateTipHidden = computed(
  () => settingsStore.settings.ignoreAllUpdates || Boolean(settingsStore.settings.ignoredUpdateVersion)
);

onMounted(async () => {
  // 以系统实际状态为准校正开关（如用户在任务管理器中关闭了自启动）
  try {
    const { isEnabled } = await import('@tauri-apps/plugin-autostart');
    const enabled = await isEnabled();
    if (settingsStore.settings.autostart !== enabled) {
      settingsStore.settings.autostart = enabled;
    }
  } catch {
    // 非 Tauri 环境（浏览器预览）下忽略
  }
});

async function toggleAutostart(enabled: boolean) {
  autostartError.value = false;
  autostartError.value = !(await settingsStore.setAutostart(enabled));
}

function checkNow() {
  window.dispatchEvent(new Event('check-for-update'));
}

function reopenTip() {
  settingsStore.resetUpdateNotifications();
  window.dispatchEvent(new Event('check-for-update'));
}
</script>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 720px;
}

.native-sync-alert {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--danger, var(--border));
  border-radius: var(--radius-md, 8px);
  color: var(--text-primary);
  font-size: var(--font-size-caption);
}

.section-title {
  font-size: var(--font-size-title-md);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
  padding-bottom: var(--space-3);
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.group-title {
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-light);
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-label {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.row-sub {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.select-control {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.select-control:hover {
  border-color: var(--brand-primary);
}

.settings-link {
  flex-shrink: 0;
  color: var(--brand-primary);
  font-size: var(--font-size-sub);
  text-decoration: none;
  white-space: nowrap;
}

.settings-link:hover {
  text-decoration: underline;
}

.tray-tip {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.check-update-button,
.reset-update-button {
  background-color: var(--brand-soft);
  color: var(--brand-primary);
  border: 1px solid var(--brand-green-border);
  border-radius: var(--radius-control);
  padding: 6px 16px;
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-default);
}

.check-update-button:hover,
.reset-update-button:hover {
  background-color: var(--brand-soft-hover);
}

.reset-update-button {
  align-self: flex-start;
}

.live-tile-guide {
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background-color: var(--background);
  padding: var(--space-3);
}

.live-tile-guide-summary {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}

.live-tile-guide-body {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  line-height: 1.6;
}

.live-tile-guide-body h5 {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.live-tile-guide-body p {
  margin: 0;
}

.guide-code {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  border: 1px solid var(--border-light);
  background-color: var(--surface, var(--background));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: var(--text-primary);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.guide-quote {
  padding-left: var(--space-3);
  border-left: 3px solid var(--brand-primary);
  color: var(--text-primary);
}

.guide-list {
  margin: 0;
  padding-left: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
