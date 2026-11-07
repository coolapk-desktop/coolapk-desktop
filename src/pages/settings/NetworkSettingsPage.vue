<template>
  <div class="settings-section">
    <h3 class="section-title">网络代理</h3>
    <div class="setting-group">
      <h4 class="group-title">客户端代理</h4>
      <div class="row-info">
        <span class="row-label">全局代理</span>
        <span class="row-sub">用于客户端接口及原生图片、下载请求。支持 Windows、macOS、Linux、Android 和 iOS。</span>
      </div>
      <div class="proxy-fields">
        <label class="field-label" for="proxy-type">代理类型</label>
        <select id="proxy-type" v-model="draftProxyType" class="select-control" :disabled="saving || testing">
          <option v-for="type in proxyTypes" :key="type" :value="type">{{ type.toUpperCase() }}</option>
        </select>
        <label class="field-label" for="proxy-address">代理地址</label>
        <input id="proxy-address" v-model="draftProxyAddress" type="text" class="text-input" placeholder="127.0.0.1:7890" autocomplete="off" spellcheck="false" :disabled="saving || testing" @keydown.enter="applyProxy" />
        <div class="row-actions">
          <button class="action-button secondary" :disabled="saving || testing || !draftProxyAddress.trim()" @click="testProxy">{{ testing ? '测试中…' : '测试连接' }}</button>
          <button class="action-button" :disabled="saving || testing || composedProxyUrl === settingsStore.settings.networkProxyUrl" @click="applyProxy">{{ saving ? '应用中…' : '应用' }}</button>
        </div>
      </div>
      <!-- 代理是本页唯一的“改完必须点应用”设置，草稿未应用时高亮提醒，离开前再确认一次。 -->
      <p v-if="hasUnsavedChanges" class="setting-unsaved" aria-live="polite">
        <i class="fas fa-exclamation-circle" aria-hidden="true"></i>
        有未保存的修改，点击「应用」后才会生效；离开本页将放弃这些修改。
      </p>
      <p class="setting-note">清空地址并应用可恢复默认连接。SOCKS4a / SOCKS5h 由代理解析域名。移动设备请填写设备可访问的代理地址；网页登录窗口使用设备的系统网络设置。</p>
      <p v-if="testResult" class="setting-success" role="status">{{ testResult }}</p>
      <p v-if="error" class="setting-error" role="alert">{{ error }}</p>
      <!-- 启动或应用时代理同步到后端失败：这是“生效状态”告警，与上方“未保存修改”是两个语义，
           不参与未保存守卫。提供重新应用入口让用户无需重启即可恢复。 -->
      <div v-if="settingsStore.proxySyncFailed" class="setting-unsaved proxy-sync-alert" role="alert">
        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
        <span class="proxy-sync-text">代理设置未能同步到后端，当前请求可能未经过代理；已保存的地址不会丢失。</span>
        <button class="action-button secondary" :disabled="reapplying" @click="reapplyProxy">{{ reapplying ? '重试中…' : '重新应用' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settings';
import { useUnsavedChangesGuard } from '../../utils/useUnsavedChangesGuard';

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
.settings-section { display: flex; flex-direction: column; gap: var(--space-6); max-width: 720px; }
.section-title { margin: 0; padding-bottom: var(--space-3); border-bottom: 1px solid var(--border); color: var(--text-primary); font-size: var(--font-size-title-md); }
.setting-group { display: flex; flex-direction: column; gap: var(--space-3); }
.group-title { margin: 0; color: var(--text-primary); font-size: var(--font-size-title-sm); }
.row-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.proxy-fields { display: flex; flex-direction: column; gap: var(--space-2); width: 100%; padding: var(--space-3) 0; border-bottom: 1px solid var(--border-light); }
.field-label { color: var(--text-primary); font-weight: var(--font-weight-medium); }
.select-control, .text-input { width: 100%; padding: var(--space-2) var(--space-3); border: 1px solid var(--border-light); border-radius: var(--radius-md); color: var(--text-primary); background: var(--surface); }
.row-actions { display: flex; gap: var(--space-2); justify-content: flex-end; margin-top: var(--space-2); }
.action-button { padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-md); background: var(--brand-primary); color: var(--text-inverse); cursor: pointer; }
.action-button.secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text-primary); }
.action-button:disabled { opacity: .5; cursor: default; }
.row-label { color: var(--text-primary); font-weight: var(--font-weight-medium); }
.row-sub, .setting-note { color: var(--text-tertiary); font-size: var(--font-size-caption); line-height: 1.5; }
.setting-note { margin: var(--space-3) 0 0; }
.setting-unsaved { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--warning, var(--border)); border-radius: var(--radius-md); background: var(--warning-soft, var(--surface)); color: var(--text-primary); font-size: var(--font-size-caption); }
.setting-error { margin: var(--space-3) 0 0; color: var(--danger); font-size: var(--font-size-caption); }
.proxy-sync-alert { justify-content: flex-start; border-color: var(--danger, var(--border)); }
.proxy-sync-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; text-align: left; }
.proxy-sync-alert .action-button { flex-shrink: 0; }
.setting-success { margin: var(--space-3) 0 0; color: var(--success); font-size: var(--font-size-caption); }
</style>
