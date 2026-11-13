<template>
  <div class="settings-section">
    <h3 class="section-title">网络代理</h3>

    <div class="setting-group">
      <h4 class="group-title">客户端代理</h4>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">全局代理</span>
          <span class="row-sub">用于客户端接口及原生图片、下载请求。支持 Windows、macOS、Linux、Android 和 iOS。</span>
          <code v-if="settingsStore.settings.networkProxyUrl" class="mono-pill">{{ settingsStore.settings.networkProxyUrl }}</code>
        </div>
        <span :class="settingsStore.settings.networkProxyUrl ? 'badge-on' : 'badge-muted'">
          {{ settingsStore.settings.networkProxyUrl ? '已配置' : '默认直连' }}
        </span>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <label class="row-label" for="proxy-type">代理类型</label>
          <span class="row-sub">支持 HTTP / HTTPS 与 SOCKS 协议（SOCKS4a / SOCKS5h 由代理解析域名）</span>
        </div>
        <select id="proxy-type" v-model="draftProxyType" class="select-control" :disabled="saving || testing">
          <option v-for="type in proxyTypes" :key="type" :value="type">{{ type.toUpperCase() }}</option>
        </select>
      </div>

      <div class="setting-row">
        <div class="row-info">
          <label class="row-label" for="proxy-address">代理地址</label>
          <span class="row-sub">填写主机与端口（如 127.0.0.1:7890）；清空地址并应用可恢复默认连接</span>
        </div>
        <input
          id="proxy-address"
          v-model="draftProxyAddress"
          type="text"
          class="text-input"
          placeholder="127.0.0.1:7890"
          autocomplete="off"
          spellcheck="false"
          :disabled="saving || testing"
          @keydown.enter="applyProxy"
        />
      </div>

      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">测试与应用</span>
          <span class="row-sub">可先测试当前草稿代理连通性；修改后需点击「应用」才会保存生效</span>
        </div>
        <div class="row-actions">
          <AppButton
            class="action-button"
            variant="secondary"
            size="sm"
            icon="fas fa-plug"
            :loading="testing"
            :disabled="saving || testing || !draftProxyAddress.trim()"
            @click="testProxy"
          >{{ testing ? '测试中…' : '测试连接' }}</AppButton>
          <AppButton
            class="action-button"
            variant="primary"
            size="sm"
            icon="fas fa-check"
            :loading="saving"
            :disabled="saving || testing || composedProxyUrl === settingsStore.settings.networkProxyUrl"
            @click="applyProxy"
          >{{ saving ? '应用中…' : '应用' }}</AppButton>
        </div>
      </div>

      <!-- 代理是本页唯一的“改完必须点应用”设置，草稿未应用时高亮提醒，离开前再确认一次。 -->
      <p v-if="hasUnsavedChanges" class="setting-unsaved warning-banner" aria-live="polite">
        <i class="fas fa-exclamation-circle" aria-hidden="true"></i>
        <span>有未保存的修改，点击「应用」后才会生效；离开本页将放弃这些修改。</span>
      </p>

      <p v-if="testResult" class="extract-tip success-tip" role="status">
        <i class="fas fa-check-circle" aria-hidden="true"></i>
        <span>{{ testResult }}</span>
      </p>
      <p v-if="error" class="extract-tip error-tip" role="alert">
        <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
        <span>{{ error }}</span>
      </p>

      <!-- 启动或应用时代理同步到后端失败：这是“生效状态”告警，与上方“未保存修改”是两个语义，
           不参与未保存守卫。提供重新应用入口让用户无需重启即可恢复。 -->
      <div v-if="settingsStore.proxySyncFailed" class="proxy-sync-alert error-tip" role="alert">
        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
        <span class="proxy-sync-text">代理设置未能同步到后端，当前请求可能未经过代理；已保存的地址不会丢失。</span>
        <AppButton variant="secondary" size="sm" icon="fas fa-rotate-right" :loading="reapplying" :disabled="reapplying" @click="reapplyProxy">
          {{ reapplying ? '重试中…' : '重新应用' }}
        </AppButton>
      </div>

      <p class="tray-tip">
        <i class="fas fa-info-circle" aria-hidden="true"></i>
        <span>清空地址并应用可恢复默认连接。SOCKS4a / SOCKS5h 由代理解析域名。移动设备请填写设备可访问的代理地址；网页登录窗口使用设备的系统网络设置。</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settings';
import { useUnsavedChangesGuard } from '../../utils/useUnsavedChangesGuard';
import AppButton from '../../components/common/AppButton.vue';

type ProxyType = 'http' | 'https' | 'socks4' | 'socks4a' | 'socks5' | 'socks5h';
const proxyTypes: ProxyType[] = ['http', 'https', 'socks4', 'socks4a', 'socks5', 'socks5h'];
const settingsStore = useSettingsStore();
function parseProxyUrl(value: string): { type: ProxyType; address: string } {
  const match = value.match(/^([a-z0-9]+):\/\/(.*)$/i);
  const type = match?.[1]?.toLowerCase() as ProxyType;
  return { type: proxyTypes.includes(type) ? type : 'http', address: match?.[2] ?? value };
}
const initialProxy = parseProxyUrl(settingsStore.settings.networkProxyUrl);
const draftProxyType = ref<ProxyType>(initialProxy.type);
const draftProxyAddress = ref(initialProxy.address);
const composedProxyUrl = computed(() => draftProxyAddress.value.trim() ? `${draftProxyType.value}://${draftProxyAddress.value.trim()}` : '');
// 草稿与已保存值不一致即存在未应用修改。
const hasUnsavedChanges = computed(() => composedProxyUrl.value !== settingsStore.settings.networkProxyUrl);
const saving = ref(false);
const testing = ref(false);
const reapplying = ref(false);
const error = ref('');
const testResult = ref('');
watch(() => settingsStore.settings.networkProxyUrl, (value) => { if (!saving.value) { const parsed = parseProxyUrl(value); draftProxyType.value = parsed.type; draftProxyAddress.value = parsed.address; } });
watch([draftProxyType, draftProxyAddress], () => { error.value = ''; testResult.value = ''; });

function validatedProxyUrl(): string | null {
  const value = composedProxyUrl.value;
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.hostname && (!parsed.pathname || parsed.pathname === '/') && !parsed.search && !parsed.hash) return value;
  } catch { /* 输入错误由页面统一提示。 */ }
  error.value = '请输入有效的代理地址，例如 127.0.0.1:7890。';
  return null;
}

async function applyProxy() {
  if (saving.value || testing.value) return;
  const value = validatedProxyUrl();
  if (value === null) return;
  saving.value = true;
  error.value = '';
  try { if (!await settingsStore.setNetworkProxyUrl(value)) error.value = '代理设置未能生效，请检查地址后重试。'; }
  finally { saving.value = false; }
}

/** 重新应用已保存的代理地址：只重试后端同步，不改动草稿与已保存值。 */
async function reapplyProxy() {
  if (reapplying.value) return;
  reapplying.value = true;
  try { await settingsStore.reapplyNetworkProxy(); }
  finally { reapplying.value = false; }
}

/** 放弃草稿并回到已保存的代理设置，避免确认后又被下一次离开重复拦截。 */
function discardDraft() {
  const saved = parseProxyUrl(settingsStore.settings.networkProxyUrl);
  draftProxyType.value = saved.type;
  draftProxyAddress.value = saved.address;
  error.value = '';
  testResult.value = '';
}

// 路由离开与关闭页签共用统一守卫：未修改放行、确认后丢弃草稿、取消则留下，行为与此前一致。
useUnsavedChangesGuard({
  hasUnsavedChanges: () => hasUnsavedChanges.value,
  title: '放弃未保存的代理设置？',
  message: '代理设置尚未应用，离开后本次修改将不会生效。',
  onDiscard: discardDraft
});

async function testProxy() {
  if (saving.value || testing.value) return;
  const value = validatedProxyUrl();
  if (!value) return;
  testing.value = true;
  error.value = '';
  testResult.value = '';
  try {
    const result = await invoke<{ statusCode: number; elapsedMs: number }>('test_network_proxy', { proxyUrl: value });
    if (composedProxyUrl.value === value) testResult.value = `已通过代理连接到测试站点（HTTP ${result.statusCode}，${result.elapsedMs} ms）。`;
  } catch (cause) { if (composedProxyUrl.value === value) error.value = String(cause); }
  finally { testing.value = false; }
}
</script>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: 760px;
  min-width: 0;
  box-sizing: border-box;
  container-type: inline-size;
  container-name: network-settings;
}

.section-title {
  margin: 0;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  font-size: var(--font-size-title-md);
  font-weight: var(--font-weight-bold);
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.group-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-semibold);
}

.setting-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-light);
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 200px;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.row-label {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.row-sub {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.mono-pill {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  background-color: var(--background);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-control);
  padding: 3px 8px;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  word-break: break-all;
}

.badge-on,
.badge-muted {
  flex: 0 0 auto;
  padding: 4px 10px;
  border-radius: var(--radius-control);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
}

.badge-on {
  background-color: var(--brand-soft);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--brand-primary);
}

.badge-muted {
  background-color: var(--background);
  border: 1px solid var(--border-light);
  color: var(--text-tertiary);
}

.select-control,
.text-input {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  outline: none;
  width: 220px;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.select-control {
  cursor: pointer;
}

.select-control:hover:not(:disabled),
.select-control:focus,
.text-input:hover:not(:disabled),
.text-input:focus {
  border-color: var(--brand-primary);
}

.select-control:disabled,
.text-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  flex: 0 0 auto;
  max-width: 100%;
}

.warning-banner,
.extract-tip,
.proxy-sync-alert {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  font-size: var(--font-size-caption);
  line-height: 1.5;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.warning-banner i,
.extract-tip i,
.proxy-sync-alert i {
  margin-top: 2px;
  flex-shrink: 0;
}

.warning-banner {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: var(--warning, #d97706);
}

.success-tip {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--brand-primary);
}

.error-tip {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: var(--danger);
}

.proxy-sync-alert {
  align-items: center;
  flex-wrap: wrap;
}

.proxy-sync-text {
  flex: 1 1 200px;
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: left;
}

.tray-tip {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.5;
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.tray-tip i {
  margin-top: 2px;
  flex-shrink: 0;
}

@media (max-width: 600px) {
  .select-control,
  .text-input {
    width: 100%;
  }

  .row-actions {
    flex-basis: 100%;
    justify-content: flex-start;
  }
}

@container network-settings (max-width: 560px) {
  .select-control,
  .text-input {
    width: 100%;
  }

  .row-actions {
    flex-basis: 100%;
    justify-content: flex-start;
  }
}
</style>
