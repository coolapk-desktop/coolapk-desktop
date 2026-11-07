import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileSettingsPage from '../ProfileSettingsPage.vue';
import { useAuthStore } from '../../../stores/auth';
import { confirmationState, settleConfirmation } from '../../../utils/confirm';

const coolapkMocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(async () => ({
    data: { userInfo: { uid: '42', signature: '旧签名', province: '浙江省', city: '杭州市' } },
  })),
  updateUserProfile: vi.fn(async () => ({})),
  openUrl: vi.fn(async () => undefined),
  getDeviceInfo: vi.fn(async () => ({ data: {} })),
}));

vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: coolapkMocks }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined), isTauri: vi.fn(() => false) }));

// AppDialog 用 Teleport 挂到 body，挂载后用 document 查询弹层内容。
function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.user = { uid: '42', username: 'tester', userAvatar: '' };
  auth.isLoggedIn = true;
  const wrapper = mount(ProfileSettingsPage, { global: { plugins: [pinia] }, attachTo: document.body });
  return { wrapper, auth };
}

function bodyButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
}

async function clickBodyButton(text: string) {
  const button = bodyButton(text);
  if (!button) throw new Error(`找不到按钮：${text}`);
  button.click();
  await flushPromises();
}

async function openDialog(rowLabel: string) {
  // 按行标签找到对应行的「编辑」按钮，避免依赖两个编辑按钮的顺序。
  const rows = Array.from(document.body.querySelectorAll('.profile-row'));
  const row = rows.find((r) => r.querySelector('.row-label')?.textContent?.trim() === rowLabel);
  if (!row) throw new Error(`找不到资料行：${rowLabel}`);
  const editButton = Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === '编辑');
  if (!editButton) throw new Error(`「${rowLabel}」行没有编辑按钮`);
  editButton.click();
  await flushPromises();
}

describe('个人信息页弹窗草稿取消确认', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmationState.isOpen = false;
  });

  it('签名弹窗草稿未改动时点取消直接关闭，不弹确认', async () => {
    const { wrapper } = mountPage();
    await flushPromises();
    await openDialog('签名');
    expect(document.body.querySelector('.signature-input')).not.toBeNull();

    await clickBodyButton('取消');
    expect(document.body.querySelector('.signature-input')).toBeNull();
    expect(confirmationState.isOpen).toBe(false);
    wrapper.unmount();
  });

  it('签名草稿修改后点取消先弹确认，确认放弃才关闭', async () => {
    const { wrapper } = mountPage();
    await flushPromises();
    await openDialog('签名');
    const input = document.body.querySelector('.signature-input') as HTMLTextAreaElement;
    input.value = '新的个性签名';
    input.dispatchEvent(new Event('input'));
    await flushPromises();

    await clickBodyButton('取消');
    expect(confirmationState.isOpen).toBe(true);
    // 取消确认：弹窗保持打开，草稿不丢。
    settleConfirmation(false);
    await flushPromises();
    expect(document.body.querySelector('.signature-input')).not.toBeNull();

    await clickBodyButton('取消');
    settleConfirmation(true);
    await flushPromises();
    expect(document.body.querySelector('.signature-input')).toBeNull();
    // 未走保存接口。
    expect(coolapkMocks.updateUserProfile).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('城市弹窗改了省份后点取消弹确认，确认后关闭且不保存', async () => {
    const { wrapper } = mountPage();
    await flushPromises();
    await openDialog('城市');
    const provinceSelect = document.body.querySelector('select.location-select') as HTMLSelectElement;
    provinceSelect.value = '广东省';
    provinceSelect.dispatchEvent(new Event('change'));
    await flushPromises();

    await clickBodyButton('取消');
    expect(confirmationState.isOpen).toBe(true);
    settleConfirmation(true);
    await flushPromises();
    expect(document.body.querySelector('.dialog-form')).toBeNull();
    expect(coolapkMocks.updateUserProfile).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
