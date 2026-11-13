import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PublishDialog from '../PublishDialog.vue';
import { CoolapkTauriAPI } from '../../../api/coolapk';
import { confirmationState, settleConfirmation } from '../../../utils/confirm';
import { listFullPublishDrafts } from '../../../utils/publishDrafts';
import { hasActiveShuzilmDeviceId } from '../../../utils/shuzilmDeviceGuide';

vi.mock('../../../stores/app', () => ({ useAppStore: () => stores.app }));
vi.mock('../../../stores/settings', () => ({ useSettingsStore: () => stores.settings }));
vi.mock('../../../stores/auth', () => ({ useAuthStore: () => stores.auth }));
vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: { getEditableFeed: vi.fn(), createFeed: vi.fn(), updateFeed: vi.fn(), uploadImage: vi.fn() } }));
vi.mock('../../../utils/publishVideo', () => ({ preparePublishVideo: vi.fn() }));
vi.mock('../../../utils/publishMedia', async (original) => ({ ...await original<any>(), preparePublishImage: vi.fn() }));
vi.mock('../../../utils/publishDrafts', async (original) => ({ ...await original<any>(), listFullPublishDrafts: vi.fn(async () => []), saveFullPublishDraft: vi.fn(), deleteFullPublishDraft: vi.fn() }));
vi.mock('../../../utils/shuzilmDeviceGuide', async (original) => ({ ...await original<any>(), openShuzilmGuide: vi.fn(), hasActiveShuzilmDeviceId: vi.fn(async () => false) }));

import { preparePublishImage } from '../../../utils/publishMedia';

const stores = { app: null as any, settings: null as any, auth: null as any };

function mountDialog() {
  return mount(PublishDialog, { global: { stubs: {
    AppDialog: { props: ['isOpen', 'keepContent'], template: '<div v-if="isOpen || keepContent" v-show="isOpen"><slot name="header"/><slot/><slot name="footer"/></div>' },
    AppButton: { props: ['disabled'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot/></button>' },
    teleport: true, AppImage: true, PublishTargetPicker: true, PublishTopicPicker: true, PublishTopicRecommendations: true, PublishMentionPicker: true, PublishProductOptions: true, PublishExtras: true,
  } } });
}
async function openDialog() { const wrapper = mountDialog(); stores.app.isPublishOpen = true; await flushPromises(); return wrapper; }
function typeText(wrapper: ReturnType<typeof mountDialog>, text: string) {
  const editor = wrapper.get('[role=textbox]').element;
  editor.textContent = text;
  const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  return wrapper.get('[role=textbox]').trigger('input', { inputType: 'insertText' });
}
function draft(id: string, text: string, images: unknown[] = []) {
  return { id, title: text, updatedAt: 1, state: { text, images, target: null, productOptions: {}, visibleStatus: 1, largeCover: false, extraOptions: {}, attachmentTitle: '' } };
}

beforeEach(() => {
  vi.clearAllMocks();
  stores.app = reactive({ isPublishOpen: false, editFeedTarget: null, closePublish() { this.isPublishOpen = false; } });
  stores.settings = { settings: { publishDeviceSignature: false, deviceFingerprint: { deviceId: 'device' } } };
  stores.auth = reactive({ user: { uid: '123' } });
  vi.mocked(hasActiveShuzilmDeviceId).mockResolvedValue(false);
  vi.mocked(listFullPublishDrafts).mockResolvedValue([]);
  vi.mocked(CoolapkTauriAPI.createFeed).mockResolvedValue({ code: 400, message: '测试停止发送' });
});
afterEach(() => { document.querySelectorAll('.app-toast-container').forEach((node) => node.remove()); settleConfirmation(false); });

describe('发布草稿与弹窗修复（R3 域4）', () => {
  it('切换草稿后在途解析的图片不得进入新草稿，且明确提示丢弃', async () => {
    vi.mocked(listFullPublishDrafts).mockResolvedValue([draft('a', '草稿A'), draft('b', '草稿B')] as any);
    let release!: (value: any) => void;
    vi.mocked(preparePublishImage).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const wrapper = await openDialog();
    try {
      expect(wrapper.text()).toContain('草稿A');
      const input = wrapper.get('input[accept*="image"]');
      Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['x'], 'a.png', { type: 'image/png' })] });
      await input.trigger('change');
      await flushPromises();
      // 解析仍在途时切到草稿 B。
      await wrapper.get('button.header-drafts').trigger('click');
      await wrapper.findAll('.draft-open').find((button) => button.text().includes('草稿B'))!.trigger('click');
      await flushPromises();
      release({ preview: '慢图' });
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(wrapper.findAll('.media-item')).toHaveLength(0);
      expect(document.body.textContent).toContain('1 张解析完成的图片未添加');
      expect(wrapper.text()).toContain('草稿B');
    } finally { wrapper.unmount(); }
  });

  it('图片既无 url 也无 file 时发布前阻止并明确提示', async () => {
    vi.mocked(listFullPublishDrafts).mockResolvedValue([draft('bad', '正文', [{ preview: '坏图' }])] as any);
    const wrapper = await openDialog();
    try {
      await typeText(wrapper, '正文');
      await wrapper.findAll('button').find((button) => button.text() === '立即发布')!.trigger('click');
      await flushPromises();
      expect(CoolapkTauriAPI.createFeed).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('缺少图片数据');
    } finally { wrapper.unmount(); }
  });

  it('编辑模式无改动关闭不弹确认，有改动关闭需二次确认', async () => {
    stores.app.editFeedTarget = { id: '9', title: '原文' };
    vi.mocked(CoolapkTauriAPI.getEditableFeed).mockResolvedValue({ code: 200, data: { id: '9', uid: '123', feedType: 'feed', message: '原文' } } as any);
    const wrapper = await openDialog();
    try {
      await flushPromises();
      // 无改动：直接关闭。
      await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click');
      await flushPromises();
      expect(stores.app.isPublishOpen).toBe(false);
      expect(document.body.textContent).not.toContain('尚未保存');

      // 有改动：先确认再关闭，取消可中止。
      stores.app.editFeedTarget = { id: '9', title: '原文' };
      stores.app.isPublishOpen = true;
      await flushPromises();
      await typeText(wrapper, '改了很多内容');
      await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click');
      await flushPromises();
      expect(confirmationState.isOpen).toBe(true);
      expect(confirmationState.message).toContain('尚未保存');
      settleConfirmation(false);
      await flushPromises();
      expect(stores.app.isPublishOpen).toBe(true);
      await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click');
      await flushPromises();
      settleConfirmation(true);
      await flushPromises();
      expect(stores.app.isPublishOpen).toBe(false);
    } finally { wrapper.unmount(); stores.app.editFeedTarget = null; }
  });

  it('修改失败的原因悬浮在正文首行，不再埋到正文末端', async () => {
    stores.app.editFeedTarget = { id: '9', title: '原文' };
    vi.mocked(CoolapkTauriAPI.getEditableFeed).mockResolvedValue({ code: 200, data: { id: '9', uid: '123', feedType: 'feed', message: '原文' } } as any);
    vi.mocked(CoolapkTauriAPI.updateFeed).mockResolvedValue({ code: 400, message: '添加的话题数量超过限制' } as any);
    const wrapper = await openDialog();
    try {
      await flushPromises();
      await typeText(wrapper, '很长的正文'.repeat(50));
      await wrapper.findAll('button').find((button) => button.text() === '保存修改')!.trigger('click');
      await flushPromises();
      const banner = wrapper.get('.publish-error-banner');
      expect(banner.text()).toContain('添加的话题数量超过限制');
      // 提示条必须位于滚动区首个子节点，滚动位置不影响可见性（粘性定位）。
      expect(wrapper.get('.publish-compose-scroll').element.firstElementChild).toBe(banner.element);
      expect(wrapper.find('.error-tip').exists()).toBe(false);
      await banner.get('button.publish-error-dismiss').trigger('click');
      expect(wrapper.find('.publish-error-banner').exists()).toBe(false);
    } finally { wrapper.unmount(); stores.app.editFeedTarget = null; }
  });

  it('首次发布失败的原因同样悬浮在正文首行', async () => {
    const wrapper = await openDialog();
    try {
      await typeText(wrapper, '很长的正文'.repeat(50));
      await wrapper.findAll('button').find((button) => button.text() === '立即发布')!.trigger('click');
      await flushPromises();
      const banner = wrapper.get('.publish-error-banner');
      expect(banner.text()).toContain('测试停止发送');
      expect(wrapper.get('.publish-compose-scroll').element.firstElementChild).toBe(banner.element);
    } finally { wrapper.unmount(); }
  });
});
