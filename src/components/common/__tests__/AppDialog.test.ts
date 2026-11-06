import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import AppDialog from '../AppDialog.vue';

afterEach(() => vi.restoreAllMocks());

it('listens for Escape only while open and preserves closing behavior', async () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const wrapper = mount(AppDialog, { props: { isOpen: false } });
  expect(add.mock.calls.filter(call => call[0] === 'keydown')).toHaveLength(0);
  await wrapper.setProps({ isOpen: true });
  expect(add.mock.calls.filter(call => call[0] === 'keydown')).toHaveLength(1);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(wrapper.emitted('close')).toHaveLength(1);
  await wrapper.setProps({ isOpen: false });
  expect(remove.mock.calls.filter(call => call[0] === 'keydown').length).toBeGreaterThan(0);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(wrapper.emitted('close')).toHaveLength(1);
  wrapper.unmount();
});

it('keepContent 关闭时保留内容 DOM，默认行为仍然销毁内容', async () => {
  // 内容在 Teleport 目标（body）中，直接按文档查询才能比较 DOM 实例身份。
  const kept = mount(AppDialog, { props: { isOpen: true, keepContent: true }, slots: { default: '<div class="probe">正文</div>' }, attachTo: document.body });
  try {
    const probe = document.querySelector('.probe')!;
    const wrapper = document.querySelector('.dialog-wrapper')!;
    await kept.setProps({ isOpen: false });
    await nextTick();
    expect(document.querySelector('.dialog-wrapper')).toBe(wrapper);
    expect(document.querySelector('.probe')).toBe(probe);
    expect((wrapper as HTMLElement).style.display).toBe('none');
    await kept.setProps({ isOpen: true });
    await nextTick();
    expect((wrapper as HTMLElement).style.display).not.toBe('none');
    expect(document.querySelector('.probe')).toBe(probe);
  } finally { kept.unmount(); }

  const destroyed = mount(AppDialog, { props: { isOpen: true }, slots: { default: '<div class="probe">正文</div>' }, attachTo: document.body });
  try {
    await destroyed.setProps({ isOpen: false });
    await nextTick();
    expect(document.querySelector('.probe')).toBeNull();
  } finally { destroyed.unmount(); }
});

it('opens an earlier-mounted confirmation above its source dialog and Escape closes only the top dialog', async () => {
  // 全局确认窗口先挂载，用户操作窗口后挂载，模拟主页拉黑和屏蔽的打开顺序。
  const confirmation = mount(AppDialog, { props: { isOpen: false, title: '拉黑用户' }, global: { stubs: { Teleport: true } } });
  const actions = mount(AppDialog, { props: { isOpen: true, title: '用户操作' }, global: { stubs: { Teleport: true } } });
  const zIndex = (wrapper: typeof actions, selector: string) => Number((wrapper.get(selector).element as HTMLElement).style.zIndex);
  try {
    await confirmation.setProps({ isOpen: true });
    expect(zIndex(confirmation, '.dialog-backdrop')).toBeGreaterThan(zIndex(actions, '.dialog-wrapper'));
    expect(zIndex(confirmation, '.dialog-wrapper')).toBeGreaterThan(zIndex(confirmation, '.dialog-backdrop'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(confirmation.emitted('close')).toHaveLength(1);
    expect(actions.emitted('close')).toBeUndefined();
    await confirmation.setProps({ isOpen: false });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(actions.emitted('close')).toHaveLength(1);
    await confirmation.setProps({ isOpen: true, title: '屏蔽用户' });
    expect(zIndex(confirmation, '.dialog-backdrop')).toBeGreaterThan(zIndex(actions, '.dialog-wrapper'));
  } finally {
    confirmation.unmount();
    actions.unmount();
  }
});
