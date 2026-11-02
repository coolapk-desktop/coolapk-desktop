<template>
  <div class="settings-section">
    <h3 class="section-title">Agent 接口</h3>

    <p class="tray-tip warn">
      <i class="fas fa-triangle-exclamation"></i>
      开启后本机任意程序都能凭下方 token 调用酷安接口，请只在本机可信环境中使用，不要把 token 粘贴给不受信任的程序或网站。
    </p>

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
          <span class="row-sub mono">{{ status.endpoint }}</span>
        </div>
        <button type="button" class="btn-text" @click="copyText(status.endpoint)">复制</button>
      </div>

      <div v-if="status.enabled" class="setting-row">
        <div class="row-info">
          <span class="row-label">访问 token</span>
          <span class="row-sub mono">{{ tokenVisible ? status.token : '•••••••••••••••••••••' }}</span>
        </div>
        <div class="row-actions">
          <button type="button" class="btn-text" @click="tokenVisible = !tokenVisible">{{ tokenVisible ? '隐藏' : '显示' }}</button>
          <button type="button" class="btn-text" @click="copyText(status.token)">复制</button>
          <button type="button" class="btn-text" :disabled="busy" @click="rotateToken">重新生成</button>
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
          :model-value="status.mcpEnabled"
          :disabled="busy || !status.enabled"
          @update:model-value="toggleMcp"
        />
      </div>

      <div v-if="status.enabled && status.mcpEnabled" class="setting-row">
        <div class="row-info">
          <span class="row-label">MCP 接入地址</span>
          <span class="row-sub mono">{{ status.mcpEndpoint }}</span>
        </div>
        <button type="button" class="btn-text" @click="copyText(status.mcpEndpoint || '')">复制</button>
      </div>
      <p v-if="status.enabled && status.mcpEnabled" class="tray-tip">
        <i class="fas fa-info-circle"></i>
        MCP 固定使用独立的本机回环端口，与上方传输方式无关；服务端只提供工具调用，不提供服务端推送流。
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">授权范围</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">读取内容</span>
          <span class="row-sub">动态、评论、用户、话题、搜索的只读访问</span>
        </div>
        <AppSwitch v-model="readEnabled" :disabled="busy" />
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">发布内容</span>
          <span class="row-sub">发动态、发图文、评论回复；受下方写操作闸门约束</span>
        </div>
        <AppSwitch v-model="publishEnabled" :disabled="busy" />
      </div>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">互动操作</span>
          <span class="row-sub">点赞、关注等轻量互动</span>
        </div>
        <AppSwitch v-model="interactEnabled" :disabled="busy" />
      </div>
      <p class="tray-tip">
        <i class="fas fa-info-circle"></i>
        当前版本只开放只读能力，写授权（发布内容、互动操作）为预留项，写接口落地后才会生效；修改授权范围后需要关闭再重新开启服务。
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">传输方式</h4>
      <div class="setting-row">
        <div class="row-info">
          <span class="row-label">监听方式</span>
          <span class="row-sub">{{ transportHint }}</span>
        </div>
        <select v-model="transport" class="select-control" :disabled="busy" aria-label="Agent 接口传输方式">
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
        <select v-model="writeMode" class="select-control" :disabled="busy" aria-label="Agent 写操作模式">
          <option value="disabled">禁用写操作</option>
          <option value="dry-run">只预演不提交</option>
          <option value="confirm">每次在应用内确认</option>
          <option value="auto">直接执行</option>
        </select>
      </div>
      <p class="tray-tip">
        <i class="fas fa-lock"></i>
        写操作接口与 MCP 写工具尚未提供，此处的闸门设置会在写接口开放后生效。
      </p>
    </div>

    <div class="setting-group">
      <h4 class="group-title">调用方式</h4>
      <pre class="code-block">{{ exampleCommand }}</pre>
      <p class="tray-tip">
        <i class="fas fa-gauge-high"></i>
        限流：读 60 次/分钟；写 1 次/分钟、10 次/小时。调用记录写入应用数据目录的审计文件，只保存接口、授权范围与账号，不保存正文。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AppSwitch from '../../components/common/AppSwitch.vue';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { showToast } from '../../utils/toast';
import { logDiagnostic, summarizeDiagnosticError } from '../../utils/diagnosticLogger';
import { getPlatformInfo } from '../../utils/platform';

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
const busy = ref(false);
const tokenVisible = ref(false);
const readEnabled = ref(true);
const publishEnabled = ref(false);
const interactEnabled = ref(false);
const transport = ref(emptyStatus.transport);
const writeMode = ref('disabled');

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
  if (!status.enabled) return;
  readEnabled.value = status.scopes.includes('read');
  publishEnabled.value = status.scopes.includes('write.publish');
  interactEnabled.value = status.scopes.includes('write.interact');
  transport.value = status.transport || transport.value;
  writeMode.value = status.writeMode || writeMode.value;
}

function selectedScopes(): string[] {
  const scopes: string[] = [];
  if (readEnabled.value) scopes.push('read');
  if (publishEnabled.value) scopes.push('write.publish');
  if (interactEnabled.value) scopes.push('write.interact');
  return scopes.length ? scopes : ['read'];
}

async function refresh() {
  try {
    const response = await CoolapkTauriAPI.agentBridgeStatus();
    applyStatus(response?.data);
  } catch (error) {
    showToast('读取 Agent 接口状态失败', 'error');
    logDiagnostic('warn', 'settings', 'agent_bridge_status_failed', summarizeDiagnosticError(error));
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
    showToast(enabled ? 'Agent 接口已开启' : 'Agent 接口已关闭');
  } catch (error) {
    showToast(enabled ? '开启失败，请查看诊断日志' : '关闭失败，请查看诊断日志', 'error');
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
    showToast(enabled ? 'MCP 服务已开启' : 'MCP 服务已关闭');
  } catch (error) {
    showToast('切换 MCP 服务失败，请查看诊断日志', 'error');
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
    showToast('token 已重新生成，旧 token 立即失效');
  } catch (error) {
    showToast('重新生成失败', 'error');
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

onMounted(async () => {
  await refresh();
  if (!status.enabled) {
    // 未启用时按当前系统给出默认传输方式：Windows 没有 Unix domain socket。
    const info = await getPlatformInfo().catch(() => ({ os: 'unknown' } as { os: string }));
    transport.value = info.os === 'windows' ? 'tcp' : 'uds';
  }
});
</script>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 720px;
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
  margin: 0;
  font-size: var(--font-size-title-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-light);
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row-label {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.row-sub {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  word-break: break-all;
}

.row-sub.mono,
.code-block {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
}

.code-block {
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background-color: var(--background);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
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
}

.tray-tip.warn {
  color: var(--warning, #d97706);
}
</style>
