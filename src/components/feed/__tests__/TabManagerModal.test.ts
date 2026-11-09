import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigPageTab } from '../../../types/settings';

const mocks = vi.hoisted(() => ({
  requestConfirmation: vi.fn(),
  showToast: vi.fn(),
  useAndroidBackButton: vi.fn(),
  updateHomeTabConfig: vi.fn(),
}));

vi.mock('../../../utils/confirm', () => ({ requestConfirmation: mocks.requestConfirmation }));
vi.mock('../../../utils/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../../../utils/androidBackButton', () => ({ useAndroidBackButton: mocks.useAndroidBackButton }));
vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: { updateHomeTabConfig: mocks.updateHomeTabConfig },
}));

import TabManagerModal from '../TabManagerModal.vue';
import { useSettingsStore } from '../../../stores/settings';

const TABS: ConfigPageTab[] = [
  { page_name: 'digest', title: '头条', url: 'digest' },
  { page_name: 'picture', title: '酷图', url: 'picture' },
  { page_name: 'life', title: '生活', url: 'life' },
] as ConfigPageTab[];

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

function mountModal() {
  return mount(TabManagerModal, {
    props: { visible: true, tabs: TABS, activeKey: 'digest' },
  });
}

describe('TabManagerModal 关闭与脏数据', () => {
  let store: ReturnType<typeof useSettingsStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSettingsStore();
    store.settings.homeTabOrder = ['digest', 'picture', '__hidden__life'];
    mocks.requestConfirmation.mockReset();
    mocks.showToast.mockReset();
    mocks.useAndroidBackButton.mockReset();
    mocks.updateHomeTabConfig.mockReset();
  });

  it('Esc 在有未保存改动时按关闭即保存落盘并提示', async () => {
    const wrapper = mountModal();
    // 把隐藏的“生活”加回我的频道，形成未保存改动
    await wrapper.find('.hidden-section .channel-tile').trigger('click');
    expect(wrapper.findAll('.channel-grid')[0].findAll('.channel-tile')).toHaveLength(3);

    pressEscape();
    await flushPromises();

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(store.settings.homeTabOrder).toEqual(['digest', 'picture', 'life']);
    expect(mocks.showToast).toHaveBeenCalledWith('已保存频道顺序');
    expect(wrapper.emitted('updated')).toBeTruthy();
    wrapper.unmount();
  });

  it('无改动时 Esc 关闭不写设置、不提示', async () => {
    const wrapper = mountModal();
    pressEscape();
    await flushPromises();

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(store.settings.homeTabOrder).toEqual(['digest', 'picture', '__hidden__life']);
    expect(mocks.showToast).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('Android 返回键在弹窗可见时触发关闭', async () => {
    const wrapper = mountModal();
    const [isActive, handler] = mocks.useAndroidBackButton.mock.calls.at(-1)!;
    expect(isActive()).toBe(true);

    handler();
    await flushPromises();

    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('恢复默认需要二次确认，取消时不改动且保持弹窗打开', async () => {
    mocks.requestConfirmation.mockResolvedValue(false);
    const wrapper = mountModal();

    await wrapper.find('.secondary-btn').trigger('click');
    await flushPromises();

    expect(mocks.requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: '恢复默认频道' }));
    expect(store.settings.homeTabOrder).toEqual(['digest', 'picture', '__hidden__life']);
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('确认恢复默认后重置草稿并保持弹窗打开', async () => {
    mocks.requestConfirmation.mockResolvedValue(true);
    const wrapper = mountModal();

    await wrapper.find('.secondary-btn').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('close')).toBeUndefined();
    // 草稿已恢复为全部频道可见、默认顺序
    expect(wrapper.find('.hidden-section').exists()).toBe(false);

    // 关闭时统一落盘，写入默认顺序
    pressEscape();
    await flushPromises();
    expect(store.settings.homeTabOrder).toEqual(['digest', 'picture', 'life']);
    wrapper.unmount();
  });
});
