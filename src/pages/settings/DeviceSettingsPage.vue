<template>
  <div class="settings-section" @change="refreshDeviceProfile">
    <h3 v-if="!editorOnly" class="section-title">设备信息</h3>

    <div v-if="!editorOnly" class="setting-group">
      <h4 class="group-title">当前状态</h4>
      <div class="status-box">
        <div class="status-row">
          <span class="status-key">登录状态</span>
          <span :class="['status-value', deviceInfo?.loggedIn ? 'status-on' : 'status-off']">
            {{ deviceInfo?.loggedIn ? '已登录' : '未登录' }}
          </span>
        </div>
        <div class="status-row">
          <span class="status-key">数盟设备 ID（用于生成 X-App-Device）</span>
          <span :class="['status-value', activeDeviceId ? 'status-on' : 'status-warn']" :title="activeDeviceId || undefined">
            {{ activeDeviceId ? identitySourceLabel + '（' + activeDeviceId + '）' : '未配置（敏感写操作可能受限）' }}
          </span>
        </div>
        <div class="status-row">
          <span class="status-key">设备码（X-App-Device）</span>
          <code class="status-code" :title="deviceInfo?.deviceCode">{{ deviceInfo?.deviceCode || '加载中...' }}</code>
        </div>
        <div v-if="deviceInfo?.defaultProfile" class="status-row">
          <span class="status-key">默认请求机型</span>
          <span class="status-value">{{ deviceInfo.defaultProfile.brand }} {{ deviceInfo.defaultProfile.model }}（{{ deviceInfo.defaultProfile.source === 'native' ? '本机真实设备' : '兼容模板' }}）</span>
        </div>
        <details v-if="deviceInfo?.defaultProfile && !settingsStore.settings.deviceFingerprint.customFingerprint">
          <summary class="row-sub">查看默认 User-Agent</summary>
          <code class="native-ua">{{ deviceInfo.defaultProfile.userAgent }}</code>
        </details>
        <p class="tray-tip">
          <i class="fas fa-info-circle"></i>
          未登录时自动获取并复用游客设备 ID；登录后优先复用当前账号已生成并保存的 ID，没有生成记录时使用手动配置。
        </p>
      </div>
    </div>

    <!-- 数盟设备认证 -->
    <div class="setting-group">
      <h4 class="group-title">数盟设备 ID（用于生成 X-App-Device）</h4>
      <div class="setting-card">
        <p class="card-desc">
          粘贴官方 Android 酷安复制的完整日志或设备 ID，保存后用于应用请求的设备标识。iOS 官方酷安没有下述获取入口，可在电脑上的安卓虚拟机中安装官方 Android 酷安，获取设备 ID 后传到 iPhone / iPad，手动粘贴到此处并保存。
        </p>
        <p class="card-desc">
          自动生成会联网向数盟获取 DUID，不会发送酷安账号或 Cookie。生成值保存在本机，登录后按账号分别保存，重启及同账号重新登录后继续复用；切换账号时使用各自保存的值，不覆盖手动配置。
        </p>

        <div class="device-id-input-row">
          <div class="input-wrapper">
            <input
              v-model="deviceIdInput"
              type="text"
              class="text-input full-width-input"
              placeholder="粘贴官方 Android 酷安日志或数盟设备 ID（形如 DU...）"
              @input="onDeviceIdInputChange"
            />
            <button
              v-if="deviceIdInput"
              type="button"
              class="clear-input-btn"
              title="清空输入"
              @click="clearDeviceIdInput"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
          <button type="button" class="action-btn" @click="handlePasteClipboard">
            <i class="fas fa-paste"></i>
            读取剪贴板
          </button>
          <button type="button" class="action-btn" :disabled="generatingDeviceId" :aria-busy="generatingDeviceId" @click="generateDeviceId">
            <i :class="generatingDeviceId ? 'fas fa-spinner fa-spin' : 'fas fa-wand-magic-sparkles'"></i>
            {{ generatingDeviceId ? '正在生成...' : '自动生成并使用' }}
          </button>
          <button v-if="deviceInfo?.deviceIdSource === 'generated_account'" type="button" class="action-btn" :disabled="generatingDeviceId" title="清除当前账号的生成记录，恢复手动配置" @click="useSavedDeviceId">
            使用手动配置
          </button>
          <button
            type="button"
            class="action-btn primary-btn"
            :disabled="!parsedDeviceId"
            @click="saveCustomDeviceId"
          >
            <i class="fas fa-check"></i>
            保存
          </button>
          <button
            v-if="currentDeviceId"
            type="button"
            class="action-btn danger-btn"
            title="清除已保存的设备ID"
            @click="clearSavedDeviceId"
          >
            <i class="fas fa-trash-can"></i>
            清除
          </button>
        </div>

        <div v-if="deviceInfo?.deviceIdGenerationError" class="extract-tip error-tip" role="status">
          {{ deviceInfo.deviceIdGenerationError }}；可点击“自动生成并使用”重试。
        </div>

        <div v-if="parsedDeviceId" class="extract-tip success-tip">
          <i class="fas fa-check-circle"></i>
          <span>
            已识别有效设备 ID：<code>{{ parsedDeviceId }}</code>
            {{ parsedDeviceId === activeDeviceId ? '（当前生效中）' : parsedDeviceId === currentDeviceId ? '（已保存，当前未使用）' : '（点击“保存”保存手动配置）' }}
          </span>
        </div>
        <div v-else-if="deviceIdInput.trim()" class="extract-tip error-tip">
          <i class="fas fa-circle-xmark"></i>
          <span>未能识别出有效的设备 ID，请确认复制内容是否完整</span>
        </div>

        <!-- 提取教程指引 -->
        <div class="tutorial-box">
          <div class="tutorial-header" @click="tutorialExpanded = !tutorialExpanded">
            <div class="tutorial-title">
              <i class="fas fa-mobile-screen-button"></i>
              <span>官方 Android 酷安提取指引（安卓手机 / 安卓虚拟机）</span>
            </div>
            <i :class="['fas', tutorialExpanded ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
          </div>

          <div v-show="tutorialExpanded" class="tutorial-steps">
            <div class="tut-step">
              <div class="tut-num">1</div>
              <div class="tut-content">
                在安卓手机或安卓虚拟机中打开官方 Android 酷安 App，依次点击：<strong>【我】</strong>→右上角<strong>【设置】</strong>（齿轮图标）→滑动到最底部点<strong>【关于】</strong>。
              </div>
            </div>
            <div class="tut-step">
              <div class="tut-num">2</div>
              <div class="tut-content">
                进入<strong>【关于】</strong>页面，点击右上角<strong>【三个点】</strong>（菜单图标），在弹出选项中点击<strong>【检查日志】</strong>进入<strong>【测试与日志】</strong>页面，在选项列表中下滑，找到<strong>【复制 OAID】</strong>（部分版本直接显示为<strong>【OAID】</strong>）。
              </div>
            </div>
            <div class="tut-step">
              <div class="tut-num">3</div>
              <div class="tut-content">
                在该条目上连续快速点击 <strong>5 次</strong>：
                <div class="tut-subclicks">
                  <div>· 前 1~4 次点击：屏幕只会提示 “OAID 已复制”；</div>
                  <div class="tut-sub-highlight">· <strong>第 5 次点击</strong>：屏幕下方会弹出 Toast 提示：<strong>“设备ID 已复制”</strong>！</div>
                </div>
              </div>
            </div>
            <div class="tut-step">
              <div class="tut-num">4</div>
              <div class="tut-content">
                复制后回到此处，点击上方的【读取剪贴板】或直接粘贴，确认识别出的设备 ID 后点击【保存】。如果是在安卓虚拟机中获取，请先将复制的完整内容传到使用本客户端的设备；iOS 用户在 iPhone / iPad 上手动粘贴并保存。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!editorOnly" class="setting-group">
      <h4 class="group-title">自定义设备指纹</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">启用自定义设备信息</span>
          <span class="row-sub">自定义请求头中的机型、版本与系统信息；关闭后 Android、iOS 和 macOS 使用本机信息，Windows/Linux 使用兼容模板</span>
        </div>
        <AppSwitch v-model="settingsStore.settings.deviceFingerprint.customFingerprint" />
      </div>
    </div>

    <template v-if="!editorOnly && settingsStore.settings.deviceFingerprint.customFingerprint">
      <div class="setting-group">
        <h4 class="group-title">机型模板</h4>
        <div class="catalog-section">
            <p class="row-sub">从 Google 官方 Android 机型表和 AppleDB 苹果设备表选择设备</p>
          <div class="catalog-picker">
            <input v-model="presetSearch" class="text-input" placeholder="搜索名称、型号或设备代号" aria-label="搜索官方机型表" />
            <div class="catalog-grid">
              <label class="catalog-field">
                <span class="row-label">品牌</span>
                <select v-model="catalogBrand" class="text-input select-input" :disabled="!devicePresets.length" aria-label="机型品牌" @change="clearCatalogChildren('brand')">
                  <option value="">{{ devicePresets.length ? '选择品牌' : '正在加载机型表' }}</option>
                  <option v-for="brand in catalogGroups" :key="brand.key" :value="brand.key">{{ brand.label }}</option>
                </select>
              </label>
              <label class="catalog-field">
                <span class="row-label">系列</span>
                <select v-model="catalogSeries" class="text-input select-input" :disabled="!catalogBrand" aria-label="机型系列" @change="clearCatalogChildren('series')">
                  <option value="">{{ catalogBrand ? '选择系列' : '请先选择品牌' }}</option>
                  <option v-for="series in catalogSeriesOptions" :key="series" :value="series">{{ series }}</option>
                </select>
              </label>
              <label class="catalog-field">
                <span class="row-label">机型</span>
                <select v-model="catalogName" class="text-input select-input" :disabled="!catalogSeries" aria-label="机型名称" @change="clearCatalogChildren('name')">
                  <option value="">{{ catalogSeries ? '选择机型' : '请先选择系列' }}</option>
                  <option v-for="name in catalogNameOptions" :key="name" :value="name">{{ name }}</option>
                </select>
              </label>
              <label class="catalog-field">
                <span class="row-label">型号</span>
                <select v-model="presetModel" class="text-input select-input" :disabled="!catalogName" aria-label="官方机型表">
                  <option value="">{{ catalogName ? '选择型号 / 自定义' : '请先选择机型' }}</option>
                  <option v-for="p in catalogVariants" :key="p.id" :value="p.id">{{ p.model }}（{{ p.device }}）</option>
                </select>
              </label>
            </div>
            <p v-if="catalogSelectionPath" class="catalog-selection" aria-live="polite">已选择：{{ catalogSelectionPath }}</p>
            <p v-else-if="presetSearch && !catalogGroups.length && !catalogError" class="row-sub">没有匹配的设备，可更换搜索词或在下方手动填写型号。</p>
            <p class="row-sub">{{ catalogError || `共 ${devicePresets.length.toLocaleString()} 条记录，完整保留匹配结果；系列按名称归类。` }}</p>
            <p class="row-sub">Android、SDK 和 Build 请按实际系统填写。</p>
          </div>
        </div>

        <div class="setting-row">
          <div class="row-info">
            <span class="row-label">机型型号</span>
            <span class="row-sub">用于 User-Agent 和设备请求头，如 23127PN0CC（小米 14）</span>
          </div>
          <input
            v-model="settingsStore.settings.deviceFingerprint.model"
            type="text"
            class="text-input"
            placeholder="如：23127PN0CC"
            maxlength="40"
          />
        </div>

        <div class="field-row">
          <div class="row-info"><span class="row-label">制造商</span><span class="row-sub">如 Xiaomi、samsung、OPPO</span></div>
          <input v-model="settingsStore.settings.deviceFingerprint.manufacturer" class="text-input" :placeholder="deviceIdentity.manufacturer" maxlength="40" />
          <div class="row-info"><span class="row-label">品牌</span><span class="row-sub">如 Redmi、OnePlus、google</span></div>
          <input v-model="settingsStore.settings.deviceFingerprint.brand" class="text-input" :placeholder="deviceIdentity.brand" maxlength="40" />
        </div>

        <div class="field-row">
          <div class="row-info">
            <span class="row-label">Android 版本</span>
            <span class="row-sub">UA 中的 Android 版本号</span>
          </div>
          <input
            v-model="settingsStore.settings.deviceFingerprint.androidVersion"
            type="text"
            class="text-input small-input"
            placeholder="16"
            maxlength="8"
          />
          <div class="row-info">
            <span class="row-label">Build 号</span>
            <span class="row-sub">按“关于手机”填写；默认模板不代表该机型的真实固件</span>
          </div>
          <input
            v-model="settingsStore.settings.deviceFingerprint.build"
            type="text"
            class="text-input"
            placeholder="AQ3A.250226.002"
            maxlength="40"
          />
        </div>
        <div class="setting-row">
          <div class="row-info">
            <span class="row-label">ROM 信息（可选）</span>
            <span class="row-sub">留空使用 Android 版本号；定制系统可填写名称和版本，如 HyperOS_3.0; 3.0.310.0</span>
          </div>
          <input v-model="settingsStore.settings.deviceFingerprint.rom" type="text" class="text-input" placeholder="留空使用 Android 版本" maxlength="120" aria-label="ROM 信息" />
        </div>
      </div>

      <div class="setting-group">
        <h4 class="group-title">应用与系统信息</h4>
        <div class="field-row">
          <div class="row-info">
            <span class="row-label">App 版本（X-App-Version）</span>
            <span class="row-sub">不得低于酷安官方最低支持版本</span>
          </div>
          <input
            v-model="settingsStore.settings.deviceFingerprint.appVersion"
            type="text"
            class="text-input small-input"
            placeholder="16.6.5"
            maxlength="20"
          />
          <div class="row-info">
            <span class="row-label">版本号（X-App-Code）</span>
            <span class="row-sub">同步作用于 X-App-Supported</span>
          </div>
          <input
            v-model="settingsStore.settings.deviceFingerprint.appCode"
            type="text"
            class="text-input small-input"
            placeholder="2610162"
            maxlength="12"
          />
        </div>

        <div class="field-row">
          <div class="row-info">
            <span class="row-label">SDK Int（X-Sdk-Int）</span>
            <span class="row-sub">Android SDK 版本号</span>
          </div>
          <input
            v-model="settingsStore.settings.deviceFingerprint.sdkInt"
            type="text"
            class="text-input small-input"
            placeholder="36"
            maxlength="4"
          />
          <div class="row-info">
            <span class="row-label">语言（X-Sdk-Locale）</span>
            <span class="row-sub">如 zh-CN / en-US</span>
          </div>
          <input
            v-model="settingsStore.settings.deviceFingerprint.locale"
            type="text"
            class="text-input small-input"
            placeholder="zh-CN"
            maxlength="16"
          />
        </div>

        <div class="setting-row">
          <div class="row-info">
            <span class="row-label">暗色模式（X-Dark-Mode）</span>
            <span class="row-sub">模拟客户端深浅色状态，与界面主题相互独立</span>
          </div>
          <AppSwitch
            :model-value="settingsStore.settings.deviceFingerprint.darkMode === '1'"
            @update:model-value="(v: boolean) => (settingsStore.settings.deviceFingerprint.darkMode = v ? '1' : '0')"
          />
        </div>
      </div>

      <div class="setting-group">
        <h4 class="group-title">预览</h4>
        <div class="preview-box">
          <div class="preview-row">
            <span class="preview-key">User-Agent</span>
            <code class="preview-value">{{ previewUserAgent }}</code>
          </div>
          <div class="preview-row">
            <span class="preview-key">X-App-Version</span>
            <code class="preview-value">{{ fingerprint.appVersion || '16.6.5' }}</code>
            <span class="preview-key">X-App-Code</span>
            <code class="preview-value">{{ fingerprint.appCode || '2610162' }}</code>
          </div>
          <div class="preview-row">
            <span class="preview-key">X-Sdk-Int</span>
            <code class="preview-value">{{ fingerprint.sdkInt || '36' }}</code>
            <span class="preview-key">X-Sdk-Locale</span>
            <code class="preview-value">{{ fingerprint.locale || 'zh-CN' }}</code>
            <span class="preview-key">X-Dark-Mode</span>
            <code class="preview-value">{{ fingerprint.darkMode }}</code>
          </div>
          <p v-if="versionWarning" class="version-warning">
            <i class="fas fa-exclamation-triangle"></i>
            {{ versionWarning }}
          </p>
          <p v-if="sdkWarning" class="version-warning"><i class="fas fa-exclamation-triangle"></i> {{ sdkWarning }}</p>
        </div>
      </div>

      <div class="setting-group">
        <button class="reset-button" @click="resetToDefault">
          <i class="fas fa-undo"></i>
          恢复默认设置
        </button>
      </div>
    </template>

    <div v-if="!editorOnly" class="setting-group">
      <h4 class="group-title">注意事项</h4>
      <p class="tray-tip">
        <i class="fas fa-info-circle"></i>
        机型信息会同步到设备请求头；修改机型不会更换已保存的数盟设备 ID。若酷安返回“网络环境异常”或“请升级客户端”，请恢复默认设置后重试。
      </p>
      <p class="tray-tip">
        <i class="fas fa-info-circle"></i>
        修改会同步到后续 API 请求，无需重启客户端；服务端显示的机型名称仍由酷安识别结果决定。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useSettingsStore, buildDeviceUserAgent } from '../../stores/settings';
import AppSwitch from '../../components/common/AppSwitch.vue';
import { loadDevicePresets, searchDevicePresets, groupDevicePresets, getDeviceSeries, getAndroidSdkWarning, resolveDeviceIdentity, type DevicePreset } from '../../utils/devicePresets';
import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from '../../stores/auth';
import type { DeviceFingerprintSettings } from '../../types/settings';
import { parseOrExtractDeviceId, isValidShuzlmDeviceId } from '../../utils/shuzilmDeviceGuide';
import { showToast } from '../../utils/toast';

defineProps<{ editorOnly?: boolean }>();
const emit = defineEmits<{ deviceIdSaved: [] }>();

/** 当前生效设备信息（Rust 端查询）：登录态 + 设备码 + 设备ID */
const deviceInfo = ref<{
  loggedIn: boolean; deviceCode: string; deviceId?: string;
  deviceIdSource?: 'generated_guest' | 'generated_account' | 'manual' | 'default';
  deviceIdGenerationError?: string;
  defaultProfile?: { source: string; brand: string; model: string; userAgent: string };
} | null>(null);

const authStore = useAuthStore();

async function loadDeviceInfo() {
  try {
    const res = await invoke<any>('get_device_info');
    if (res && res.code === 200) {
      deviceInfo.value = res.data;
    }
  } catch (err) {
    console.warn('获取设备信息失败:', err);
  }
}
onMounted(loadDeviceInfo);
// 登录/登出/切换账号后刷新设备码状态
watch(
  () => authStore.user?.uid,
  () => loadDeviceInfo()
);

const settingsStore = useSettingsStore();
const generatingDeviceId = ref(false);
const activeDeviceId = computed(() => deviceInfo.value?.deviceId || currentDeviceId.value);
const identitySourceLabel = computed(() => {
  if (deviceInfo.value?.deviceIdSource === 'generated_guest') return '游客自动生成';
  if (deviceInfo.value?.deviceIdSource === 'generated_account') return '当前账号已保存';
  return '手动配置';
});

async function generateDeviceId() {
  if (generatingDeviceId.value) return;
  generatingDeviceId.value = true;
  try {
    const res = await invoke<any>('generate_device_identity');
    if (res?.code !== 200 || !res.data?.deviceId) throw new Error('未获取到有效设备 ID');
    deviceInfo.value = res.data;
    showToast('设备 ID 已生成并保存，后续请求及重启后将继续复用', 'success');
    emit('deviceIdSaved');
  } catch (error) {
    // 原生层只返回受控错误，不展示服务端原始响应或生成请求中的标识。
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    generatingDeviceId.value = false;
  }
}

async function useSavedDeviceId() {
  try {
    const res = await invoke<any>('use_saved_device_identity');
    if (res?.code !== 200) throw new Error('无法恢复设备配置');
    deviceInfo.value = res.data;
    showToast('已清除当前账号的生成记录，恢复使用手动配置', 'success');
  } catch {
    showToast('恢复设备配置失败，请重试', 'error');
  }
}

async function refreshDeviceProfile() {
  await nextTick();
  if (await settingsStore.syncDeviceProfile(settingsStore.settings)) await loadDeviceInfo();
}

const currentDeviceId = computed(() => settingsStore.settings.deviceFingerprint?.deviceId || '');
const deviceIdInput = ref(currentDeviceId.value);
const parsedDeviceId = ref(isValidShuzlmDeviceId(currentDeviceId.value) ? currentDeviceId.value : '');
const tutorialExpanded = ref(!currentDeviceId.value);

watch(
  currentDeviceId,
  (val) => {
    deviceIdInput.value = val;
    parsedDeviceId.value = isValidShuzlmDeviceId(val) ? val : '';
  },
  { immediate: true }
);

function onDeviceIdInputChange() {
  const parsed = parseOrExtractDeviceId(deviceIdInput.value);
  if (parsed && isValidShuzlmDeviceId(parsed)) {
    parsedDeviceId.value = parsed;
  } else {
    parsedDeviceId.value = '';
  }
}

function clearDeviceIdInput() {
  deviceIdInput.value = '';
  parsedDeviceId.value = '';
}

async function handlePasteClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      deviceIdInput.value = text;
      onDeviceIdInputChange();
      if (parsedDeviceId.value) {
        showToast('已从剪贴板读取并成功提取设备 ID', 'success');
      } else {
        showToast('已读取剪贴板，但未能识别出合法设备 ID', 'warning');
      }
    }
  } catch (err) {
    showToast('读取剪贴板失败，请手动在此粘贴', 'error');
  }
}

async function saveCustomDeviceId() {
  if (!parsedDeviceId.value) return;
  settingsStore.settings.deviceFingerprint.deviceId = parsedDeviceId.value;
  // 旧版手动会话值不再作为隐藏配置随写请求发送。
  settingsStore.settings.deviceFingerprint.ddid = '';
  // 保存后等待原生客户端更新设备码，再提示用户继续发帖或评论。
  await nextTick();
  const synced = await settingsStore.syncDeviceProfile(settingsStore.settings);
  await settingsStore.flushSettings();
  if (!synced) {
    showToast('设备 ID 已保存，但同步请求设备码失败，请重试', 'error');
    return;
  }
  try { await invoke('use_saved_device_identity'); }
  catch { showToast('设备 ID 已保存，但切换生效配置失败，请重试', 'error'); return; }
  await loadDeviceInfo();
  showToast(deviceInfo.value?.deviceIdSource === 'generated_guest' ? '手动设备 ID 已保存，登录后使用；游客继续使用自动生成值' : '设备 ID 已保存，可以重试发帖或评论', 'success');
  emit('deviceIdSaved');
}

async function clearSavedDeviceId() {
  settingsStore.settings.deviceFingerprint.deviceId = '';
  deviceIdInput.value = '';
  parsedDeviceId.value = '';
  await nextTick();
  const synced = await settingsStore.syncDeviceProfile(settingsStore.settings);
  await settingsStore.flushSettings();
  if (!synced) {
    showToast('设备 ID 已清除，但同步请求设备码失败，请重试', 'error');
    return;
  }
  try { await invoke('use_saved_device_identity'); }
  catch { showToast('设备 ID 已清除，但同步生效配置失败，请重试', 'error'); return; }
  await loadDeviceInfo();
  showToast('数盟设备 ID 已清除', 'info');
}

const fingerprint = computed(() => settingsStore.settings.deviceFingerprint);
const devicePresets = ref<DevicePreset[]>([]);
const presetSearch = ref('');
const catalogBrand = ref('');
const catalogSeries = ref('');
const catalogName = ref('');
const forceCustomPreset = ref(false);
const catalogError = ref('');
onMounted(async () => {
  try { devicePresets.value = await loadDevicePresets(); }
  catch { catalogError.value = '机型表加载失败，可继续手动填写型号。'; }
});
const selectedPreset = computed(() => devicePresets.value.find(item => item.model === fingerprint.value.model.trim()
  && (!fingerprint.value.brand?.trim() || item.brand === fingerprint.value.brand.trim())));
const catalogGroups = computed(() => groupDevicePresets(searchDevicePresets(devicePresets.value, presetSearch.value)));
const activeBrand = computed(() => catalogGroups.value.find(brand => brand.key === catalogBrand.value));
const sortNames = (items: Iterable<string>) => [...items].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
const catalogSeriesOptions = computed(() => sortNames(activeBrand.value?.series.keys() ?? []));
const activeSeries = computed(() => activeBrand.value?.series.get(catalogSeries.value));
const catalogNameOptions = computed(() => sortNames(activeSeries.value?.keys() ?? []));
const catalogVariants = computed(() => activeSeries.value?.get(catalogName.value) ?? []);
const catalogSelectionPath = computed(() => {
  const preset = selectedPreset.value;
  if (forceCustomPreset.value || !preset) return '';
  return [preset.brand || '未注明品牌', getDeviceSeries(preset), preset.label, preset.model].join(' > ');
});
function clearCatalogChildren(level: 'brand' | 'series' | 'name') {
  if (level === 'brand') catalogSeries.value = '';
  if (level !== 'name') catalogName.value = '';
  forceCustomPreset.value = true;
}
watch(presetSearch, () => { catalogBrand.value = ''; clearCatalogChildren('brand'); });
watch(selectedPreset, (preset) => {
  if (!preset) { catalogBrand.value = ''; catalogSeries.value = ''; catalogName.value = ''; return; }
  catalogBrand.value = preset.brand.trim().toLowerCase() || 'unknown';
  catalogSeries.value = getDeviceSeries(preset);
  catalogName.value = preset.label.trim() || preset.model;
}, { immediate: true });
const deviceIdentity = computed(() => resolveDeviceIdentity(fingerprint.value));
const sdkWarning = computed(() => getAndroidSdkWarning(fingerprint.value.androidVersion, fingerprint.value.sdkInt));
const previewUserAgent = computed(() => buildDeviceUserAgent(fingerprint.value));

const presetModel = computed({
  get: () => forceCustomPreset.value ? '' : selectedPreset.value?.id || '',
  set: (id: string) => {
    forceCustomPreset.value = id === '';
    const preset = devicePresets.value.find((item) => item.id === id);
    if (!preset) return;
    Object.assign(fingerprint.value, {
      model: preset.model,
      manufacturer: '',
      brand: preset.brand,
    });
  },
});

const versionWarning = computed(() => {
  const f = fingerprint.value;
  const code = Number(f.appCode);
  if (!Number.isNaN(code) && code > 0 && code < 2610162) {
    return `版本号 ${f.appCode} 低于客户端默认请求版本 2610162，服务端可能要求升级。`;
  }
  const version = f.appVersion.trim();
  if (version) {
    const major = Number(version.split('.')[0]);
    if (!Number.isNaN(major) && major > 0 && major < 16) {
      return `App 版本 ${version} 低于客户端默认请求主版本 16，服务端可能要求升级。`;
    }
  }
  return '';
});

function resetToDefault() {
  const defaults: DeviceFingerprintSettings = {
    customFingerprint: true,
    deviceId: fingerprint.value.deviceId,
    ddid: fingerprint.value.ddid,
    model: '23113RKC6C',
    manufacturer: '',
    brand: '',
    androidVersion: '16',
    build: 'AQ3A.250226.002',
    rom: '',
    appVersion: '16.6.5',
    appCode: '2610162',
    sdkInt: '36',
    locale: 'zh-CN',
    darkMode: '0',
  };
  Object.assign(settingsStore.settings.deviceFingerprint, defaults);
  forceCustomPreset.value = false;
}
</script>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 760px;
}
.catalog-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-light);
}
.catalog-section p { margin: 0; }
.catalog-picker { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.catalog-picker .text-input { width: 100%; min-width: 0; box-sizing: border-box; }
.catalog-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.catalog-field { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.catalog-field select:disabled { cursor: default; color: var(--text-tertiary); }
.catalog-selection { font-size: var(--font-size-caption); color: var(--text-secondary); overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .catalog-grid { grid-template-columns: minmax(0, 1fr); }
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
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-light);
}

.field-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-light);
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 120px;
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

.text-input {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  outline: none;
  width: 220px;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.small-input {
  width: 130px;
}

.select-input {
  width: 230px;
  cursor: pointer;
}

.text-input:hover,
.text-input:focus {
  border-color: var(--brand-primary);
}

.preview-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
}

.preview-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.preview-key {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.preview-value {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  background-color: var(--surface);
  border-radius: var(--radius-control);
  padding: 2px 8px;
  word-break: break-all;
}

.version-warning {
  font-size: var(--font-size-caption);
  color: #e0533d;
  margin: var(--space-2) 0 0;
}

.status-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
}

.status-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.status-key {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  white-space: nowrap;
  flex: 0 0 190px;
}

.native-ua { display: block; margin-top: var(--space-2); font-size: var(--font-size-caption); overflow-wrap: anywhere; }

.status-value {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-on {
  color: var(--brand-primary);
}

.status-off {
  color: #e0533d;
}

.status-code {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  background-color: var(--surface);
  border-radius: var(--radius-control);
  padding: 2px 8px;
  word-break: break-all;
  max-width: 420px;
  min-width: 0;
  flex: 0 1 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reset-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 8px 16px;
  font-size: var(--font-size-sub);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.reset-button:hover {
  border-color: var(--brand-primary);
  color: var(--brand-primary);
}

.tray-tip {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  margin: 0;
}

.tray-tip i {
  margin-top: 2px;
}

.status-warn {
  color: #f59e0b;
}

.setting-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
}

.card-desc {
  font-size: var(--font-size-sub);
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}

.device-id-input-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.input-wrapper {
  position: relative;
  flex: 1;
  min-width: 260px;
  display: flex;
  align-items: center;
}

.full-width-input {
  width: 100%;
  padding-right: 32px;
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 13px;
}

.clear-input-btn {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.clear-input-btn:hover {
  color: var(--text-primary);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 7px 14px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  white-space: nowrap;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--brand-primary);
  color: var(--brand-primary);
}

.primary-btn {
  background-color: var(--brand-primary);
  border-color: var(--brand-primary);
  color: #ffffff;
  font-weight: var(--font-weight-medium);
}

.primary-btn:hover:not(:disabled) {
  opacity: 0.9;
  color: #ffffff;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.danger-btn:hover {
  border-color: #ef4444;
  color: #ef4444;
}

.extract-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-control);
}

.success-tip {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--brand-primary);
}

.success-tip code {
  font-weight: 700;
  font-family: var(--font-mono, Consolas, monospace);
  word-break: break-all;
}

.error-tip {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #ef4444;
}

.tutorial-box {
  margin-top: var(--space-2);
  border: 1px dashed var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  overflow: hidden;
}

.tutorial-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background-color var(--duration-fast);
}

.tutorial-header:hover {
  background: var(--surface-hover, rgba(0, 0, 0, 0.03));
}

.tutorial-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.tutorial-title i {
  color: var(--brand-primary);
}

.tutorial-steps {
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px dashed var(--border);
}

.tut-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 8px;
}

.tut-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--brand-primary);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.tut-content {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.tut-subclicks {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 4px;
  padding: 6px 10px;
  background: var(--background);
  border-radius: 4px;
  border: 1px solid var(--border);
}

.tut-sub-highlight {
  color: var(--brand-primary);
  font-weight: 500;
}
</style>
