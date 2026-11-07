import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContentSettingsPage from '../ContentSettingsPage.vue';

const coolapkMocks = vi.hoisted(() => ({
  getTabConfig: vi.fn(async () => ({ data: { 'search.tab': 'all,product,feed,apk' } })),
}));
vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: coolapkMocks }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  isTauri: vi.fn(() => false),
}));

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(ContentSettingsPage, { global: { plugins: [pinia] } });
  return wrapper;
}

describe('内容设置页搜索分类降级提示', () => {
  beforeEach(() => {
    coolapkMocks.getTabConfig.mockClear();
    coolapkMocks.getTabConfig.mockResolvedValue({ data: { 'search.tab': 'all,product,feed,apk' } });
  });

  it('getTabConfig 失败时显示默认分类降级提示与重试入口', async () => {
    coolapkMocks.getTabConfig.mockRejectedValue(new Error('offline'));
    const wrapper = mountPage();
    await flushPromises();

    const alert = wrapper.find('.tab-config-fallback');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('当前展示为默认分类');
    expect(alert.text()).toContain('重试');
    wrapper.unmount();
  });

  it('重试成功后降级提示消失', async () => {
    coolapkMocks.getTabConfig.mockRejectedValueOnce(new Error('offline'));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('.tab-config-fallback').exists()).toBe(true);

    await wrapper.find('.tab-config-fallback button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.tab-config-fallback').exists()).toBe(false);
    wrapper.unmount();
  });

  it('拉取成功时不显示降级提示', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('.tab-config-fallback').exists()).toBe(false);
    wrapper.unmount();
  });
});
