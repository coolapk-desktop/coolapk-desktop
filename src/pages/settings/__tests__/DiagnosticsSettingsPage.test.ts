import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
  writeTextFile: vi.fn(),
  confirmation: vi.fn(),
  readDiagnosticImageUrl: vi.fn(),
  exportJsonFile: vi.fn(),
  copyText: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => false }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: mocks.writeTextFile }));
vi.mock('../../../utils/diagnosticLogger', () => ({
  getVerboseDiagnosticLogging: () => Promise.resolve(false),
  setVerboseDiagnosticLogging: vi.fn(),
}));
vi.mock('../../../utils/confirm', () => ({ requestConfirmation: mocks.confirmation }));
vi.mock('../../../utils/feedbackDiagnostics', () => ({ readDiagnosticImageUrl: mocks.readDiagnosticImageUrl }));
vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: { exportJsonFile: mocks.exportJsonFile } }));
vi.mock('../../../utils/toast', () => ({ showToast: mocks.showToast }));

import DiagnosticsSettingsPage from '../DiagnosticsSettingsPage.vue';

describe('DiagnosticsSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation((command: string) => command === 'get_diagnostic_logs'
      ? Promise.resolve({ files: [{ name: 'coolapk-diagnostics.log', size: 8, modifiedAt: 1 }], content: '[INFO] app.ready', directory: '/logs' })
      : Promise.resolve(undefined));
    mocks.save.mockResolvedValue('content://documents/diagnostics');
    mocks.writeTextFile.mockResolvedValue(undefined);
    mocks.exportJsonFile.mockResolvedValue('/Downloads/coolapk-diagnostics.txt');
    vi.stubGlobal('navigator', { userAgent: 'desktop', clipboard: { writeText: mocks.copyText } });
  });

  it('exports the selected system file URI through the filesystem plugin', async () => {
    const wrapper = mount(DiagnosticsSettingsPage);
    await flushPromises();
    const exportButton = wrapper.findAll('button').find((button) => button.text().includes('导出日志'))!;
    await exportButton.trigger('click');
    await flushPromises();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.writeTextFile).toHaveBeenCalledWith('content://documents/diagnostics', '[INFO] app.ready');
  });

  it('only clears local logs after confirmation', async () => {
    mocks.confirmation.mockResolvedValue(false);
    const wrapper = mount(DiagnosticsSettingsPage);
    await flushPromises();
    const clearButton = wrapper.findAll('button').find((button) => button.text().includes('清空日志'))!;
    await clearButton.trigger('click');
    await flushPromises();
    expect(mocks.invoke).not.toHaveBeenCalledWith('clear_diagnostic_logs');
    mocks.confirmation.mockResolvedValue(true);
    await clearButton.trigger('click');
    await flushPromises();
    expect(mocks.invoke).toHaveBeenCalledWith('clear_diagnostic_logs');
  });

  it.each(['复制日志', '导出日志'])('%s 在点击时读取新日志，不使用进入页面时的快照', async action => {
    const wrapper = mount(DiagnosticsSettingsPage);
    await flushPromises();
    const fresh = '[INFO] android.foreground resume\n[INFO] android.foreground draw_requested\n[INFO] android.foreground visual_ready\n[INFO] android.foreground js_state';
    mocks.invoke.mockResolvedValueOnce({ files: [], content: fresh, directory: '/logs' });
    await wrapper.findAll('button').find(button => button.text() === action)!.trigger('click');
    await flushPromises();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(wrapper.find('.log-content').text()).toContain('js_state');
    if (action === '复制日志') expect(mocks.copyText).toHaveBeenCalledWith(fresh);
    else expect(mocks.writeTextFile).toHaveBeenCalledWith('content://documents/diagnostics', fresh);
    wrapper.unmount();
  });

  it('Android 导出同样重新读取日志并交给原生文件导出', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    const wrapper = mount(DiagnosticsSettingsPage);
    await flushPromises();
    mocks.invoke.mockResolvedValueOnce({ files: [], content: '刚复现的黑屏恢复日志', directory: '/logs' });
    await wrapper.findAll('button').find(button => button.text() === '导出日志')!.trigger('click');
    await flushPromises();
    expect(mocks.exportJsonFile).toHaveBeenCalledWith('coolapk-diagnostics.txt', '刚复现的黑屏恢复日志');
    expect(mocks.save).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['复制日志', '导出日志'])('%s 读取失败时不退回旧快照', async action => {
    const wrapper = mount(DiagnosticsSettingsPage);
    await flushPromises();
    mocks.invoke.mockRejectedValueOnce(new Error('读取失败'));
    const button = wrapper.findAll('button').find(button => button.text() === action)!;
    await button.trigger('click');
    await flushPromises();
    expect(mocks.copyText).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.exportJsonFile).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('读取失败'), 'error');
    expect(button.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('页面初始没有日志时仍可复制后来新增的日志', async () => {
    mocks.invoke.mockResolvedValueOnce({ files: [], content: '', directory: '/logs' });
    const wrapper = mount(DiagnosticsSettingsPage);
    await flushPromises();
    mocks.invoke.mockResolvedValueOnce({ files: [], content: 'resume', directory: '/logs' });
    await wrapper.findAll('button').find(button => button.text() === '复制日志')!.trigger('click');
    await flushPromises();
    expect(mocks.copyText).toHaveBeenCalledWith('resume');
    wrapper.unmount();
  });

  it('reads a received report and exports it without mixing in local logs', async () => {
    mocks.readDiagnosticImageUrl.mockResolvedValue({ format: 'coolapk-diagnostics-v1', version: '1.28.0', platform: 'iOS', createdAt: '2026-10-01', log: 'remote diagnostic report' });
    const wrapper = mount(DiagnosticsSettingsPage, { props: { reportUrl: 'https://image.coolapk.com/feed/test.png' } });
    await flushPromises();
    expect(wrapper.find('.report-reader').text()).toContain('附件校验通过');
    expect(wrapper.find('.report-reader pre').text()).toBe('remote diagnostic report');
    const exportButton = wrapper.find('.report-reader').findAll('button').find(button => button.text().includes('导出报告日志'))!;
    await exportButton.trigger('click');
    await flushPromises();
    expect(mocks.writeTextFile).toHaveBeenCalledWith('content://documents/diagnostics', 'remote diagnostic report');
    expect(wrapper.findAll('.log-content')[0]!.text()).toContain('[INFO] app.ready');
  });

  it('shows a failed original download without claiming successful extraction', async () => {
    mocks.readDiagnosticImageUrl.mockRejectedValue(new Error('HTTP 567'));
    const wrapper = mount(DiagnosticsSettingsPage, { props: { reportUrl: 'https://image.coolapk.com/feed/test.png' } });
    await flushPromises();
    expect(wrapper.find('.report-reader [role="alert"]').text()).toContain('HTTP 567');
    expect(wrapper.find('.report-reader pre').exists()).toBe(false);
  });
});
