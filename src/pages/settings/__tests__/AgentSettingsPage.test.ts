import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  rotate: vi.fn(),
  setMcp: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    agentBridgeStatus: mocks.status,
    agentBridgeStart: mocks.start,
    agentBridgeStop: mocks.stop,
    agentBridgeRotateToken: mocks.rotate,
    agentBridgeSetMcp: mocks.setMcp,
  },
}));
vi.mock('../../../utils/toast', () => ({ showToast: mocks.toast }));
vi.mock('../../../utils/platform', () => ({ getPlatformInfo: () => Promise.resolve({ os: 'linux', arch: 'x86_64' }) }));

import AgentSettingsPage from '../AgentSettingsPage.vue';

describe('AgentSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.mockResolvedValue({ code: 200, data: { enabled: false } });
    mocks.start.mockResolvedValue({
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
    });
    mocks.stop.mockResolvedValue({ code: 200, data: { enabled: false } });
    mocks.setMcp.mockResolvedValue({
      code: 200,
      data: {
        enabled: true,
        transport: 'uds',
        endpoint: '/tmp/agent-bridge.sock',
        socketPath: '/tmp/agent-bridge.sock',
        token: 'abc123',
        scopes: ['read'],
        writeMode: 'disabled',
        mcpEnabled: true,
        mcpEndpoint: 'http://127.0.0.1:45678/mcp',
      },
    });
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
