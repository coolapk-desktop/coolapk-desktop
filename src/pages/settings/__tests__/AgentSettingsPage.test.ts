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
  });

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
