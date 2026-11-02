import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { CoolapkTauriAPI } from '../api/coolapk';
import { logDiagnostic, summarizeDiagnosticError } from './diagnosticLogger';
import { requestConfirmation } from './confirm';

/** 与 Rust 侧 `write::execute` 的 confirm 事件载荷保持一致。 */
export interface WriteConfirmPayload {
  id: string;
  tool: string;
  scope: string;
  summary: string;
  preview?: Record<string, unknown> | null;
  expiresInSec?: number;
}

export const WRITE_CONFIRM_EVENT = 'agent-bridge:write-confirm';
const DEFAULT_TIMEOUT_SEC = 60;

/**
 * 把一次 agent 写操作请求交给应用内确认框，并把结果回传给 Rust。
 * 弹窗异常、用户关闭窗口都按拒绝处理，确保 Rust 侧不会一直等待。
 */
export async function handleWriteConfirm(payload: WriteConfirmPayload): Promise<boolean> {
  if (!payload?.id) return false;
  const seconds = payload.expiresInSec && payload.expiresInSec > 0 ? payload.expiresInSec : DEFAULT_TIMEOUT_SEC;
  let approved = false;
  try {
    approved = await requestConfirmation({
      title: 'Agent 请求执行写操作',
      message: `${payload.summary || payload.tool}\n\n${seconds} 秒内未操作将自动拒绝。`,
      confirmText: '允许执行',
      danger: true,
    });
  } catch (error) {
    logDiagnostic('warn', 'agent-bridge', 'write_confirm_dialog_failed', summarizeDiagnosticError(error));
  }
  try {
    await CoolapkTauriAPI.agentBridgeConfirmResult(payload.id, approved);
  } catch (error) {
    logDiagnostic('warn', 'agent-bridge', 'write_confirm_result_failed', summarizeDiagnosticError(error));
  }
  return approved;
}

/** 应用启动时注册一次；返回取消监听的函数。 */
export function registerAgentBridgeConfirm(): Promise<UnlistenFn> {
  return listen<WriteConfirmPayload>(WRITE_CONFIRM_EVENT, event => {
    void handleWriteConfirm(event.payload);
  });
}
