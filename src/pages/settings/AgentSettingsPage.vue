<template>
  <div class="settings-section">
    <h3 class="section-title">Agent 接口</h3>

    <div class="warning-banner">
      <i class="fas fa-triangle-exclamation"></i>
      <span>开启后本机任意程序都能凭下方 token 调用酷安接口，请只在本机可信环境中使用，不要把 token 粘贴给不受信任的程序或网站。</span>
    </div>

    <div class="setting-group">
      <h4 class="group-title">服务状态</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">启用本地 Agent 接口</span>
          <span class="row-sub">{{ status.enabled ? `运行中 · ${transportLabel}` : '当前已关闭，不监听任何地址' }}</span>
        </div>
        <AppSwitch :model-value="status.enabled" :disabled="busy" @update:model-value="toggleService" />
      </div>

      <div v-if="status.enabled" class="setting-row">
        <div class="row-info">
          <span class="row-label">接入地址</span>
          <code class="mono-pill">{{ status.endpoint }}</code>
        </div>
        <AppButton variant="secondary" size="sm" icon="fas fa-copy" @click="copyText(status.endpoint)">复制</AppButton>
      </div>

      <div v-if="status.enabled" class="setting-row">
        <div class="row-info">
          <span class="row-label">访问 token</span>
          <code class="mono-pill">{{ tokenVisible ? status.token : '•••••••••••••••••••••' }}</code>
        </div>
        <div class="row-actions">
          <AppButton variant="secondary" size="sm" :icon="tokenVisible ? 'fas fa-eye-slash' : 'fas fa-eye'" @click="tokenVisible = !tokenVisible">{{ tokenVisible ? '隐藏' : '显示' }}</AppButton>
          <AppButton variant="secondary" size="sm" icon="fas fa-copy" @click="copyText(status.token)">复制</AppButton>
          <AppButton variant="secondary" size="sm" icon="fas fa-rotate-right" :disabled="busy" @click="rotateToken">重新生成</AppButton>
        </div>
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">MCP 服务</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">启用 MCP 服务</span>
          <span class="row-sub">
            {{ status.enabled ? '供 Claude Code、Codex 等 MCP 客户端直接调用；开关会重建监听，token 与授权范围保持不变' : '需要先开启上方本地 Agent 接口' }}
          </span>
        </div>
        <AppSwitch
          :model-value="preferences.mcpEnabled"
          :disabled="busy || !status.enabled"
          @update:model-value="toggleMcp"
        />
      </div>

      <div v-if="status.enabled && status.mcpEnabled" class="setting-row">
        <div class="row-info">
          <span class="row-label">MCP 接入地址</span>
          <code class="mono-pill">{{ status.mcpEndpoint }}</code>
        </div>
        <AppButton variant="secondary" size="sm" icon="fas fa-copy" @click="copyText(status.mcpEndpoint || '')">复制</AppButton>
      </div>
      <p v-if="status.enabled && status.mcpEnabled" class="tray-tip">
        <i class="fas fa-info-circle"></i>
        MCP 固定使用独立的本机回环端口，与上方传输方式无关；服务端只提供工具调用，不提供服务端推送流。
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">权限预设</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">授权预设</span>
          <span class="row-sub">{{ presetHint }}</span>
        </div>
        <select v-model="preset" class="select-control" :disabled="busy || presetApplying" aria-label="Agent 授权预设" @change="applyPreset">
          <option value="read-only">只读（默认）</option>
          <option value="confirm-writes">敏感写操作需确认</option>
          <option value="auto-writes">完全放开（自动执行）</option>
          <option value="custom">自定义</option>
        </select>
      </div>
      <p class="tray-tip">
        <i class="fas fa-shield-halved"></i>
        读取权限始终开放，不需要授权；只有写操作需要你决定：默认只读，选「敏感写操作需确认」后每次写入都在应用内弹窗，选「完全放开」则直接执行（只建议在本机可信环境使用）。下方「授权范围」与「写操作闸门」用于自定义组合。
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">授权范围</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">读取内容</span>
          <span class="row-sub">动态、评论、用户、话题、搜索的只读访问；固定开放，不能关闭</span>
        </div>
        <span class="badge-on">始终开放</span>
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">发布内容</span>
          <span class="row-sub">发动态、发图文、评论回复；受下方写操作闸门约束</span>
        </div>
        <AppSwitch :model-value="publishEnabled" :disabled="busy" @update:model-value="value => updateScope('write.publish', value)" />
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">互动操作</span>
          <span class="row-sub">点赞、关注等轻量互动</span>
        </div>
        <AppSwitch :model-value="interactEnabled" :disabled="busy" @update:model-value="value => updateScope('write.interact', value)" />
      </div>
      <p class="tray-tip">
        <i class="fas fa-info-circle"></i>
        写授权覆盖发帖/编辑/删除/置顶动态、评论与评论点赞、转发/收藏与收藏单、话题与用户关注、私信。商品类只有只读查询，不涉及下单等交易操作。修改授权范围或写操作闸门后立即生效（只重建监听，token 与客户端配置不变）。
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">传输方式</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">监听方式</span>
          <span class="row-sub">{{ transportHint }}</span>
        </div>
        <select v-model="transport" class="select-control" :disabled="busy" aria-label="Agent 接口传输方式" @change="persistPreferences">
          <option value="uds">Unix Socket（推荐）</option>
          <option value="tcp">TCP 127.0.0.1</option>
        </select>
      </div>
    </div>

    <div class="setting-group">
      <h4 class="group-title">写操作闸门</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">写操作模式</span>
          <span class="row-sub">{{ writeModeHint }}</span>
        </div>
        <select v-model="writeMode" class="select-control" :disabled="busy" aria-label="Agent 写操作模式" @change="persistPreferences">
          <option value="disabled">禁用写操作</option>
          <option value="dry-run">只预演不提交</option>
          <option value="confirm">每次在应用内确认</option>
          <option value="auto">直接执行</option>
        </select>
      </div>
      <p class="tray-tip">
        <i class="fas fa-lock"></i>
        发帖、编辑、删除、评论、转发、收藏、话题与用户关注、私信等写工具都按此处的闸门执行；confirm 每次在应用内确认（60 秒超时自动拒绝），auto 只建议在本机可信环境中开启。
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">调用方式</h4>
      <div class="setting-card">
        <span class="card-key">命令示例</span>
        <pre class="code-block">{{ exampleCommand }}</pre>
      </div>
      <p class="tray-tip">
        <i class="fas fa-gauge-high"></i>
        限流：读 60 次/分钟；写 1 次/分钟、10 次/小时。调用记录写入应用数据目录的审计文件，只保存接口、授权范围与账号，不保存正文。
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">给 AI 的说明</h4>
      <div class="setting-card">
        <p class="card-desc">
          把下面整段文字复制给本机 AI（Claude Code、Codex、Cursor 等）：里面包含接入地址、token、当前授权范围与可用工具清单，AI 可以据此自己完成 MCP 注册，并按约定调用。
        </p>
        <pre v-if="status.enabled" class="code-block guide-block">{{ guidePreview || '正在生成说明…' }}</pre>
        <p v-else class="row-sub">开启服务后在这里生成说明。</p>
        <div class="row-actions guide-actions">
          <AppButton variant="primary" size="sm" icon="fas fa-copy" :disabled="!guide" @click="copyText(guide)">复制说明</AppButton>
          <AppButton variant="secondary" size="sm" icon="fas fa-rotate-right" :disabled="!status.enabled" @click="loadGuide">重新生成</AppButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AppButton from '../../components/common/AppButton.vue';
import AppSwitch from '../../components/common/AppSwitch.vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { showToast } from '../../utils/toast';
import { logDiagnostic, summarizeDiagnosticError } from '../../utils/diagnosticLogger';
import { requestConfirmation } from '../../utils/confirm';
import { getErrorMessage } from '../../utils/errors';

type BridgePreferences = {
  enabled: boolean;
  transport: string;
  scopes: string[];
  writeMode: string;
  allowedAccounts: string[];
  mcpEnabled: boolean;
};

type BridgeStatus = {
  enabled: boolean;
  transport: string;
  endpoint: string;
  socketPath?: string | null;
  port?: number | null;
  token: string;
  scopes: string[];
  writeMode: string;
  mcpEnabled: boolean;
  mcpEndpoint?: string | null;
  preferences?: BridgePreferences;
};

const emptyStatus: BridgeStatus = {
  enabled: false,
  transport: 'uds',
  endpoint: '',
  socketPath: null,
  port: null,
  token: '',
  scopes: ['read'],
  writeMode: 'disabled',
  mcpEnabled: false,
  mcpEndpoint: null,
};

const status = reactive<BridgeStatus>({ ...emptyStatus });
const preferences = reactive<BridgePreferences>({ enabled: false, transport: 'uds', scopes: ['read'], writeMode: 'disabled', allowedAccounts: [], mcpEnabled: false });
const savedPreferences = ref<BridgePreferences>({ ...preferences, scopes: [...preferences.scopes], allowedAccounts: [...preferences.allowedAccounts] });
const busy = ref(false);
// 确认弹窗期间锁住预设下拉框，避免连续切换产生两次落库。
const presetApplying = ref(false);
const tokenVisible = ref(false);
const readEnabled = ref(true);
const publishEnabled = ref(false);
const interactEnabled = ref(false);
const transport = ref(emptyStatus.transport);
const writeMode = ref('disabled');
const preset = ref('read-only');
const guide = ref('');

const transportLabel = computed(() => (status.transport === 'uds' ? 'Unix Socket' : 'TCP 回环'));
const transportHint = computed(() => (transport.value === 'uds'
  ? '通过应用数据目录下的 socket 文件通信，不占用任何端口'
  : '只监听 127.0.0.1，并强制校验 Host 头与来源，拒绝浏览器跨域请求'));

const writeModeHint = computed(() => {
  switch (writeMode.value) {
    case 'dry-run': return '返回将要提交的内容但不真正发布，便于调试';
    case 'confirm': return '每次写入都会在应用内弹窗，需要你手动批准';
    case 'auto': return '写入直接执行，只记录审计日志，风控风险由你承担';
    default: return '拒绝所有写操作，只允许读取';
  }
});

// 预览里把 token 打码，与上方 token 行的默认行为一致；「复制说明」复制完整文本。
const guidePreview = computed(() => (status.token ? guide.value.split(status.token).join('••••••••') : guide.value));

/** 写操作闸门的中文名，用于确认弹窗里说明「当前 → 目标」的差异。 */
function writeModeLabel(mode: string): string {
  switch (mode) {
    case 'dry-run': return '只预演不提交';
    case 'confirm': return '每次在应用内确认';
    case 'auto': return '直接执行（不确认）';
    default: return '禁用写操作';
  }
}

/** 汇总当前已生效的写授权，确认弹窗需要让用户看清将被放开哪些操作。 */
function currentWriteSummary(): string {
  const scopes = savedPreferences.value.scopes;
  const authorized = [
    scopes.includes('write.publish') ? '发布内容' : '',
    scopes.includes('write.interact') ? '互动操作' : '',
  ].filter(Boolean);
  return `写操作闸门「${writeModeLabel(savedPreferences.value.writeMode)}」${authorized.length ? `，已授权${authorized.join('、')}` : '，未授权任何写操作'}`;
}

const presetHint = computed(() => {
  switch (preset.value) {
    case 'read-only': return '只能读取，所有写操作都会被拒绝';
    case 'confirm-writes': return '允许发布与互动写入，每次写入在应用内弹窗确认';
    case 'auto-writes': return '允许发布与互动写入并直接执行，只记录审计';
    default: return '按下方「授权范围」与「写操作闸门」手动组合';
  }
});

const exampleCommand = computed(() => {
  if (!status.enabled) return '开启服务后在这里显示可直接复制的调用示例';
  if (status.mcpEnabled && status.mcpEndpoint) {
    return `claude mcp add --transport http coolapk ${status.mcpEndpoint} \\\n  --header 'Authorization: Bearer <token>'`;
  }
  const target = status.transport === 'uds'
    ? `--unix-socket '${status.socketPath || '<socket 路径>'}' http://localhost`
    : status.endpoint;
  return `curl ${target}/v1/health \\\n  -H 'Authorization: Bearer <token>'`;
});

function applyStatus(data: Partial<BridgeStatus> | null | undefined) {
  const next = { ...emptyStatus, ...(data || {}) } as BridgeStatus;
  Object.assign(status, next);
  if (next.preferences) {
    applyPreferences(next.preferences);
  } else if (status.enabled) {
    applyPreferences({ enabled: true, transport: status.transport, scopes: status.scopes, writeMode: status.writeMode, allowedAccounts: [], mcpEnabled: status.mcpEnabled });
  }
}

function applyPreferences(next: BridgePreferences) {
  Object.assign(preferences, { ...next, scopes: [...next.scopes], allowedAccounts: [...next.allowedAccounts] });
  savedPreferences.value = { ...preferences, scopes: [...preferences.scopes], allowedAccounts: [...preferences.allowedAccounts] };
  // 读取权限始终开放，不再由前端控制。
  readEnabled.value = true;
  publishEnabled.value = preferences.scopes.includes('write.publish');
  interactEnabled.value = preferences.scopes.includes('write.interact');
  transport.value = preferences.transport || transport.value;
  writeMode.value = preferences.writeMode || writeMode.value;
  preset.value = detectPreset(preferences.scopes, writeMode.value);
}

function detectPreset(scopes: string[], mode: string): string {
  const hasPublish = scopes.includes('write.publish');
  const hasInteract = scopes.includes('write.interact');
  if (!hasPublish && !hasInteract && mode === 'disabled') return 'read-only';
  if (hasPublish && hasInteract && mode === 'confirm') return 'confirm-writes';
  if (hasPublish && hasInteract && mode === 'auto') return 'auto-writes';
  return 'custom';
}

function selectedScopes(): string[] {
  // 读取权限始终提交，写权限按授权范围勾选。
  const scopes: string[] = ['read'];
  if (publishEnabled.value) scopes.push('write.publish');
  if (interactEnabled.value) scopes.push('write.interact');
  return scopes;
}

async function refresh() {
  try {
    const response = await CoolapkTauriAPI.agentBridgeStatus();
    applyStatus(response?.data);
    await loadGuide();
  } catch (error) {
    showToast('读取 Agent 接口状态失败', 'error');
    logDiagnostic('warn', 'settings', 'agent_bridge_status_failed', summarizeDiagnosticError(error));
  }
}

/** 后端错误转成可读的一句话，过长时截断，避免 toast 撑满屏幕。 */
function failureReason(error: unknown, fallback: string): string {
  const message = getErrorMessage(error, fallback).replace(/\s+/g, ' ').trim();
  if (!message) return fallback;
  return message.length > 120 ? `${message.slice(0, 120)}…` : message;
}

/**
 * 启停/换 token/切传输/改端口/保存偏好失败后，后端（start_with_config 第一步就 stop_running）
 * 可能已经不再监听，页面必须回到服务端真实状态，不能继续显示「运行中」和旧地址。
 * 返回服务是否仍在监听；无法读取状态时返回 null。
 */
async function syncStatusAfterFailure(): Promise<boolean | null> {
  try {
    const response = await CoolapkTauriAPI.agentBridgeStatus();
    applyStatus(response?.data);
    await loadGuide();
    return status.enabled;
  } catch (error) {
    logDiagnostic('warn', 'settings', 'agent_bridge_status_failed', summarizeDiagnosticError(error));
    return null;
  }
}

/** 失败提示统一带上服务端真实结论，避免用户误以为接口还在跑。 */
function failureSuffix(stillRunning: boolean | null): string {
  if (stillRunning === null) return '；暂时无法读取服务状态，请稍后重新打开本页';
  return stillRunning ? '；服务当前仍在运行' : '；服务已停止，不再监听任何地址';
}

async function persistPreferences() {
  if (busy.value) return;
  const previous = { ...savedPreferences.value, scopes: [...savedPreferences.value.scopes], allowedAccounts: [...savedPreferences.value.allowedAccounts] };
  busy.value = true;
  try {
    const response = await CoolapkTauriAPI.agentBridgeSavePreferences({ scopes: selectedScopes(), transport: transport.value, writeMode: writeMode.value, allowedAccounts: preferences.allowedAccounts });
    applyStatus(response?.data);
    await loadGuide();
  } catch (error) {
    applyPreferences(previous);
    const stillRunning = await syncStatusAfterFailure();
    showToast(`保存 Agent 接口设置失败：${failureReason(error, '未知原因')}${failureSuffix(stillRunning)}`, 'error');
    logDiagnostic('warn', 'settings', 'agent_bridge_preferences_failed', summarizeDiagnosticError(error));
  } finally {
    busy.value = false;
  }
}

async function updateScope(scope: string, enabled: boolean) {
  if (busy.value || scope === 'read') return;
  if (scope === 'write.publish') publishEnabled.value = enabled;
  else interactEnabled.value = enabled;
  preset.value = 'custom';
  await persistPreferences();
}

async function applyPreset() {
  if (busy.value || presetApplying.value) return;
  const value = preset.value;
  // 服务端真实生效的预设，用于取消/回退时把下拉框恢复成没说谎的选项。
  const previousPreset = detectPreset(savedPreferences.value.scopes, savedPreferences.value.writeMode);
  if (value === 'custom') {
    // 自定义组合只由下方「授权范围」与「写操作闸门」逐项设置，这里不能只改界面标签。
    preset.value = previousPreset;
    showToast('自定义组合请通过下方「授权范围」与「写操作闸门」逐项调整', 'info');
    return;
  }
  if (value === 'auto-writes') {
    // 「完全放开」会让写工具不再弹窗确认，必须先让用户确认这次权限跃升。
    presetApplying.value = true;
    let confirmed = false;
    try {
      confirmed = await requestConfirmation({
        title: '允许 Agent 直接执行写操作？',
        message: `当前：${currentWriteSummary()}\n目标：写操作闸门「直接执行（不确认）」，并授权发布内容与互动操作\n\n确认后，发动态、发图文、评论回复、编辑/删除/置顶动态、评论点赞、转发、收藏与收藏单、话题与用户关注、私信等写工具将不再弹窗确认，直接提交到当前酷安账号，只记录审计日志。只建议在本机可信环境中开启。`,
        confirmText: '允许直接执行',
        danger: true,
      });
    } finally {
      presetApplying.value = false;
    }
    if (!confirmed) {
      preset.value = previousPreset;
      return;
    }
  }
  if (value === 'read-only') {
    publishEnabled.value = false;
    interactEnabled.value = false;
    writeMode.value = 'disabled';
  } else if (value === 'confirm-writes' || value === 'auto-writes') {
    publishEnabled.value = true;
    interactEnabled.value = true;
    writeMode.value = value === 'confirm-writes' ? 'confirm' : 'auto';
  } else {
    return;
  }
  await persistPreferences();
}

async function loadGuide() {
  if (!status.enabled) {
    guide.value = '';
    return;
  }
  try {
    const response = await CoolapkTauriAPI.agentBridgeUsageGuide();
    guide.value = typeof response?.data === 'string' ? response.data : '';
  } catch (error) {
    guide.value = '';
    logDiagnostic('warn', 'settings', 'agent_bridge_guide_failed', summarizeDiagnosticError(error));
  }
}

async function toggleService(enabled: boolean) {
  if (busy.value) return;
  busy.value = true;
  try {
    const response = enabled
      ? await CoolapkTauriAPI.agentBridgeStart({
          scopes: selectedScopes(),
          transport: transport.value,
          writeMode: writeMode.value,
        })
      : await CoolapkTauriAPI.agentBridgeStop();
    applyStatus(response?.data);
    await loadGuide();
    showToast(enabled ? 'Agent 接口已开启' : 'Agent 接口已关闭');
  } catch (error) {
    const stillRunning = await syncStatusAfterFailure();
    showToast(`${enabled ? '开启' : '关闭'} Agent 接口失败：${failureReason(error, '未知原因')}${failureSuffix(stillRunning)}`, 'error');
    logDiagnostic('warn', 'settings', 'agent_bridge_toggle_failed', summarizeDiagnosticError(error));
  } finally {
    busy.value = false;
  }
}

async function toggleMcp(enabled: boolean) {
  if (busy.value) return;
  busy.value = true;
  try {
    const response = await CoolapkTauriAPI.agentBridgeSetMcp(enabled);
    applyStatus(response?.data);
    await loadGuide();
    showToast(enabled ? 'MCP 服务已开启' : 'MCP 服务已关闭');
  } catch (error) {
    const stillRunning = await syncStatusAfterFailure();
    showToast(`切换 MCP 服务失败：${failureReason(error, '未知原因')}${failureSuffix(stillRunning)}`, 'error');
    logDiagnostic('warn', 'settings', 'agent_bridge_mcp_failed', summarizeDiagnosticError(error));
  } finally {
    busy.value = false;
  }
}

async function rotateToken() {
  if (busy.value) return;
  busy.value = true;
  try {
    const response = await CoolapkTauriAPI.agentBridgeRotateToken();
    applyStatus(response?.data);
    await loadGuide();
    showToast('token 已重新生成，旧 token 立即失效');
  } catch (error) {
    // 后端换发 token 走 start_with_config，第一步就停掉旧实例，失败后服务确实已停。
    const stillRunning = await syncStatusAfterFailure();
    showToast(`重新生成 token 失败：${failureReason(error, '未知原因')}${failureSuffix(stillRunning)}`, 'error');
    logDiagnostic('warn', 'settings', 'agent_bridge_rotate_failed', summarizeDiagnosticError(error));
  } finally {
    busy.value = false;
  }
}

async function copyText(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制');
  } catch {
    showToast('复制失败，请手动选择文本', 'error');
  }
}

onMounted(refresh);
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
  container-name: agent-settings;
}

.section-title {
  font-size: var(--font-size-title-md);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
  padding-bottom: var(--space-3);
}

.warning-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: var(--warning, #d97706);
  font-size: var(--font-size-caption);
  line-height: 1.6;
  min-width: 0;
  overflow-wrap: anywhere;
}

.warning-banner i {
  margin-top: 3px;
  flex-shrink: 0;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.group-title {
  margin: 0;
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
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

.mono-pill,
.code-block {
  font-family: var(--font-mono, Consolas, monospace);
}

.mono-pill {
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

.select-control {
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 6px 12px;
  font-size: var(--font-size-sub);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  width: 220px;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.select-control:hover:not(:disabled),
.select-control:focus {
  border-color: var(--brand-primary);
}

.select-control:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
  max-width: 100%;
}

.guide-actions {
  justify-content: flex-end;
}

.badge-on {
  flex: 0 0 auto;
  padding: 4px 10px;
  border-radius: var(--radius-control);
  background-color: var(--brand-soft);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: var(--brand-primary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
}

.setting-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  min-width: 0;
  max-width: 100%;
}

.card-key {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.card-desc {
  font-size: var(--font-size-sub);
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.guide-block {
  max-height: 260px;
  overflow-y: auto;
  text-align: left;
}

.code-block {
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-control);
  background-color: var(--surface);
  color: var(--text-primary);
  font-size: var(--font-size-caption);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}

.tray-tip {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
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
  .select-control {
    width: 100%;
  }

  .row-actions {
    flex-basis: 100%;
    justify-content: flex-start;
  }

  .guide-actions {
    justify-content: flex-start;
  }
}

@container agent-settings (max-width: 560px) {
  .select-control {
    width: 100%;
  }

  .row-actions {
    flex-basis: 100%;
    justify-content: flex-start;
  }

  .guide-actions {
    justify-content: flex-start;
  }
}
</style>
