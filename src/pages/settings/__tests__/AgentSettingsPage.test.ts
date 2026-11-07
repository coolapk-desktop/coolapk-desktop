import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  rotate: vi.fn(),
  setMcp: vi.fn(),
  savePreferences: vi.fn(),
  usageGuide: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    agentBridgeStatus: mocks.status,
    agentBridgeStart: mocks.start,
    agentBridgeStop: mocks.stop,
    agentBridgeRotateToken: mocks.rotate,
    agentBridgeSetMcp: mocks.setMcp,
    agentBridgeSavePreferences: mocks.savePreferences,
    agentBridgeUsageGuide: mocks.usageGuide,
  },
}));
vi.mock('../../../utils/toast', () => ({ showToast: mocks.toast }));
vi.mock('../../../utils/confirm', () => ({ requestConfirmation: mocks.confirm }));
vi.mock('../../../utils/platform', () => ({ getPlatformInfo: () => Promise.resolve({ os: 'linux', arch: 'x86_64' }) }));

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

describe('AgentSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.mockResolvedValue({ code: 200, data: { enabled: false } });
    mocks.start.mockResolvedValue(enabledStatus);
    mocks.stop.mockResolvedValue({ code: 200, data: { enabled: false } });
    mocks.setMcp.mockResolvedValue({
      code: 200,
      data: {
        ...enabledStatus.data,
        mcpEnabled: true,
        mcpEndpoint: 'http://127.0.0.1:45678/mcp',
      },
    });
    mocks.savePreferences.mockResolvedValue(enabledStatus);
    mocks.usageGuide.mockResolvedValue({ code: 200, data: '# 酷安接入说明\n- token：abc123\n- MCP：http://127.0.0.1:45678/mcp' });
    mocks.confirm.mockResolvedValue(true);
  });

  const disabledStatus = { code: 200, data: { enabled: false } };

  function toastMessages(): string[] {
    return mocks.toast.mock.calls.map((call) => String(call[0]));
  }

  function presetValue(wrapper: ReturnType<typeof mount>): string {
    return (wrapper.find('select[aria-label="Agent 授权预设"]').element as HTMLSelectElement).value;
  }

  function writeModeValue(wrapper: ReturnType<typeof mount>): string {
    return (wrapper.find('select[aria-label="Agent 写操作模式"]').element as HTMLSelectElement).value;
  }

  it('关闭状态不展示 token 与接入地址', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain('当前已关闭');
    expect(wrapper.text()).not.toContain('abc123');
  });

  it('开启时提交默认只读授权与当前传输方式', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    await wrapper.find('.app-switch input').setValue(true);
    await flushPromises();
    expect(mocks.start).toHaveBeenCalledWith({ scopes: ['read'], transport: 'uds', writeMode: 'disabled' });
    expect(wrapper.text()).toContain('/tmp/agent-bridge.sock');
  });

  it('读取权限固定开放，没有关闭开关', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    await wrapper.find('.app-switch input').setValue(true);
    await flushPromises();
    expect(wrapper.text()).toContain('始终开放');
    const labels = wrapper.findAll('.row-label').map((node) => node.text());
    expect(labels).toContain('读取内容');
    // 服务、MCP、发布、互动：读取不再有开关。
    expect(wrapper.findAll('.app-switch input')).toHaveLength(4);
  });

  it('选择「完全放开」预设后提交全部授权与 auto 闸门', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    const preset = wrapper.find('select[aria-label="Agent 授权预设"]');
    expect(preset.exists()).toBe(true);
    await preset.setValue('auto-writes');
    await flushPromises();
    expect(mocks.savePreferences).toHaveBeenCalledWith({
      scopes: ['read', 'write.publish', 'write.interact'],
      transport: 'uds',
      writeMode: 'auto',
      allowedAccounts: [],
    });
  });

  it('选择「敏感写操作需确认」预设后提交三个授权与 confirm 闸门', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    await wrapper.find('select[aria-label="Agent 授权预设"]').setValue('confirm-writes');
    await flushPromises();
    expect(mocks.savePreferences).toHaveBeenCalledWith({
      scopes: ['read', 'write.publish', 'write.interact'],
      transport: 'uds',
      writeMode: 'confirm',
      allowedAccounts: [],
    });
  });

  it('重新生成 token 失败后按服务端状态刷新为已停止', async () => {
    mocks.status.mockResolvedValue(enabledStatus);
    mocks.rotate.mockRejectedValue('token 生成失败');
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain('运行中');
    expect(wrapper.text()).toContain('/tmp/agent-bridge.sock');

    // 换 token 走 start_with_config：第一步就停旧实例，失败后服务不再监听。
    mocks.status.mockResolvedValue(disabledStatus);
    const rotate = wrapper.findAll('button').find((button) => button.text() === '重新生成');
    expect(rotate).toBeTruthy();
    await rotate!.trigger('click');
    await flushPromises();

    expect(mocks.rotate).toHaveBeenCalledTimes(1);
    expect(mocks.status).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('当前已关闭');
    expect(wrapper.text()).not.toContain('/tmp/agent-bridge.sock');
    expect(wrapper.text()).not.toContain('运行中');
    const messages = toastMessages();
    expect(messages.some((message) => message.includes('token 生成失败') && message.includes('服务已停止'))).toBe(true);
  });

  it('保存偏好失败后回滚本地设置并按服务端状态刷新', async () => {
    mocks.status.mockResolvedValue(enabledStatus);
    mocks.savePreferences.mockRejectedValue('写配置文件失败');
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();

    mocks.status.mockResolvedValue(disabledStatus);
    await wrapper.find('select[aria-label="Agent 授权预设"]').setValue('confirm-writes');
    await flushPromises();

    expect(mocks.savePreferences).toHaveBeenCalledTimes(1);
    expect(mocks.status).toHaveBeenCalledTimes(2);
    // 本地草稿回到上一次有效设置：不会停在没生效的 confirm-writes。
    expect(presetValue(wrapper)).toBe('read-only');
    expect(writeModeValue(wrapper)).toBe('disabled');
    expect(wrapper.text()).toContain('当前已关闭');
    const messages = toastMessages();
    expect(messages.some((message) => message.includes('写配置文件失败') && message.includes('服务已停止'))).toBe(true);
  });

  it('选择「完全放开」需要二次确认，取消后不落库', async () => {
    mocks.confirm.mockResolvedValue(false);
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();

    await wrapper.find('select[aria-label="Agent 授权预设"]').setValue('auto-writes');
    await flushPromises();

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    const options = mocks.confirm.mock.calls[0][0] as { message: string; danger?: boolean };
    expect(options.danger).toBe(true);
    // 弹窗必须写清「当前 → 目标」的差异，而不是一句笼统的提示。
    expect(options.message).toContain('当前：');
    expect(options.message).toContain('目标：');
    expect(options.message).toContain('直接执行');
    expect(mocks.savePreferences).not.toHaveBeenCalled();
    expect(presetValue(wrapper)).toBe('read-only');
    expect(writeModeValue(wrapper)).toBe('disabled');
  });

  it('选择「自定义」不留假状态，回退到服务端生效的预设', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();

    await wrapper.find('select[aria-label="Agent 授权预设"]').setValue('custom');
    await flushPromises();

    expect(mocks.savePreferences).not.toHaveBeenCalled();
    expect(presetValue(wrapper)).toBe('read-only');
    expect(toastMessages().some((message) => message.includes('自定义'))).toBe(true);
  });

  it('token 默认打码，可手动展开', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    await wrapper.find('.app-switch input').setValue(true);
    await flushPromises();
    expect(wrapper.text()).not.toContain('abc123');
    const toggle = wrapper.findAll('button').find((button) => button.text() === '显示');
    expect(toggle).toBeTruthy();
    await toggle!.trigger('click');
    expect(wrapper.text()).toContain('abc123');
  });

  it('给 AI 的说明预览打码 token，复制时给出完整文本', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    await wrapper.find('.app-switch input').setValue(true);
    await flushPromises();

    expect(mocks.usageGuide).toHaveBeenCalled();
    const preview = wrapper.find('.guide-block').text();
    expect(preview).toContain('# 酷安接入说明');
    expect(preview).not.toContain('abc123');
    expect(preview).toContain('••••••••');

    const copy = wrapper.findAll('button').find((button) => button.text() === '复制说明');
    expect(copy).toBeTruthy();
    await copy!.trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('# 酷安接入说明\n- token：abc123\n- MCP：http://127.0.0.1:45678/mcp');
  });

  it('MCP 开关默认关闭，开启后展示接入地址与客户端示例', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    await wrapper.find('.app-switch input').setValue(true);
    await flushPromises();

    const switches = wrapper.findAll('.app-switch input');
    expect(switches.length).toBeGreaterThanOrEqual(2);
    await switches[1].setValue(true);
    await flushPromises();

    expect(mocks.setMcp).toHaveBeenCalledWith(true);
    expect(wrapper.text()).toContain('http://127.0.0.1:45678/mcp');
    expect(wrapper.text()).toContain('claude mcp add --transport http coolapk');
  });

  it('服务未开启时 MCP 开关不可用', async () => {
    const wrapper = mount(AgentSettingsPage);
    await flushPromises();
    const switches = wrapper.findAll('.app-switch input');
    expect(switches.length).toBeGreaterThanOrEqual(2);
    expect((switches[1].element as HTMLInputElement).disabled).toBe(true);
  });
});
