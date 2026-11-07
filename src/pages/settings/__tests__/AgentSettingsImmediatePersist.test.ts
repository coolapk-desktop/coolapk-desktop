import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  savePreferences: vi.fn(),
  usageGuide: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    agentBridgeStatus: mocks.status,
    agentBridgeSavePreferences: mocks.savePreferences,
    agentBridgeUsageGuide: mocks.usageGuide,
  },
}));
vi.mock('../../../utils/toast', () => ({ showToast: mocks.toast }));

import AgentSettingsPage from '../AgentSettingsPage.vue';

const enabledStatus = {
  code: 200,
  data: {
    enabled: true,
    transport: 'uds',
    endpoint: '/tmp/agent-bridge.sock',
    socketPath: '/tmp/agent-bridge.sock',
    token: 'abc123',
    scopes: ['read'],
    writeMode: 'disabled',
  },
};

// lane N2 结论的可执行证据：AgentSettingsPage 不存在「改了但未点保存就离开 → 静默丢失」的
// 本地编辑态——授权范围/写闸门/传输方式每次改动都立即调用 agentBridgeSavePreferences 落库，
// 因此不接入 useUnsavedChangesGuard。若未来引入草稿态，这批断言应随之改写。
describe('AgentSettingsPage 即时落库（无未保存草稿）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.mockResolvedValue(enabledStatus);
    mocks.savePreferences.mockResolvedValue(enabledStatus);
    mocks.usageGuide.mockResolvedValue({ code: 200, data: '# 说明' });
  });

  it('切换「发布内容」授权立即保存，不留待点保存', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    const switches = wrapper.findAll('.app-switch input');
    // 顺序：服务、MCP、发布、互动；开启服务后 publish/interact 才可用。
    await switches[0].setValue(true);
    await flushPromises();
    await switches[2].setValue(true);
    await flushPromises();

    expect(mocks.savePreferences).toHaveBeenCalledTimes(1);
    expect(mocks.savePreferences).toHaveBeenCalledWith({
      scopes: ['read', 'write.publish'],
      transport: 'uds',
      writeMode: 'disabled',
      allowedAccounts: [],
    });
  });

  it('改写操作闸门立即保存，成功后 savedPreferences 与表单一致（再离开无需确认）', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    await wrapper.find('select[aria-label="Agent 写操作模式"]').setValue('confirm');
    await flushPromises();

    expect(mocks.savePreferences).toHaveBeenCalledWith({
      scopes: ['read'],
      transport: 'uds',
      writeMode: 'confirm',
      allowedAccounts: [],
    });
    // 保存成功：服务端返回即回写 preferences/savedPreferences（applyStatus → applyPreferences）。
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('保存失败时回滚表单并提示，不留下「看起来已生效」的假状态', async () => {
    mocks.savePreferences.mockRejectedValue('写配置文件失败');
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    await wrapper.find('select[aria-label="Agent 写操作模式"]').setValue('confirm');
    await flushPromises();

    const value = (wrapper.find('select[aria-label="Agent 写操作模式"]').element as HTMLSelectElement).value;
    expect(value).toBe('disabled');
    expect(mocks.toast.mock.calls.some((call) => String(call[0]).includes('保存 Agent 接口设置失败'))).toBe(true);
  });
});
