import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirmResult: vi.fn(),
  requestConfirmation: vi.fn(),
  listen: vi.fn(),
  logDiagnostic: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: { agentBridgeConfirmResult: mocks.confirmResult },
}));
vi.mock('../confirm', () => ({ requestConfirmation: mocks.requestConfirmation }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('../diagnosticLogger', () => ({
  logDiagnostic: mocks.logDiagnostic,
  summarizeDiagnosticError: (error: unknown) => String(error),
}));

import { handleWriteConfirm, registerAgentBridgeConfirm, WRITE_CONFIRM_EVENT } from '../agentBridgeConfirm';

const basePayload = {
  id: 'id-1',
  tool: 'coolapk_publish_feed',
  scope: 'write.publish',
  summary: '发布动态：4 字',
  expiresInSec: 20,
};

describe('agentBridgeConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirmResult.mockResolvedValue({ code: 200, data: { accepted: true } });
  });

  it('用户允许时回传 approved=true', async () => {
    mocks.requestConfirmation.mockResolvedValue(true);
    await expect(handleWriteConfirm(basePayload)).resolves.toBe(true);
    expect(mocks.requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Agent 请求执行写操作',
      confirmText: '允许执行',
      danger: true,
    }));
    const dialog = mocks.requestConfirmation.mock.calls[0][0] as { message: string };
    expect(dialog.message).toContain('发布动态：4 字');
    expect(dialog.message).toContain('20 秒');
    expect(mocks.confirmResult).toHaveBeenCalledWith('id-1', true);
  });

  it('用户拒绝时回传 approved=false', async () => {
    mocks.requestConfirmation.mockResolvedValue(false);
    await expect(handleWriteConfirm({ ...basePayload, expiresInSec: undefined })).resolves.toBe(false);
    const dialog = mocks.requestConfirmation.mock.calls[0][0] as { message: string };
    expect(dialog.message).toContain('60 秒');
    expect(mocks.confirmResult).toHaveBeenCalledWith('id-1', false);
  });

  it('弹窗异常按拒绝回传，避免 Rust 一直等待', async () => {
    mocks.requestConfirmation.mockRejectedValue(new Error('dialog broken'));
    await expect(handleWriteConfirm(basePayload)).resolves.toBe(false);
    expect(mocks.confirmResult).toHaveBeenCalledWith('id-1', false);
    expect(mocks.logDiagnostic).toHaveBeenCalled();
  });

  it('注册后监听确认事件并处理载荷', async () => {
    mocks.requestConfirmation.mockResolvedValue(true);
    const unlisten = vi.fn();
    mocks.listen.mockResolvedValue(unlisten);
    const registered = await registerAgentBridgeConfirm();
    expect(mocks.listen).toHaveBeenCalledWith(WRITE_CONFIRM_EVENT, expect.any(Function));
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: typeof basePayload }) => void;
    handler({ payload: basePayload });
    await flushPromises();
    expect(mocks.confirmResult).toHaveBeenCalledWith('id-1', true);
    registered();
    expect(unlisten).toHaveBeenCalled();
  });
});
