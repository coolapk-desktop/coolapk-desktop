import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { KeepAlive, defineComponent, h, ref, type Ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  route: { query: { uid: '20002' } as Record<string, string> },
  listMessages: vi.fn(),
  listChatHistory: vi.fn(),
  sendPrivateMessage: vi.fn(),
  sendPrivateImage: vi.fn(),
  followUser: vi.fn(),
  uploadImage: vi.fn(),
  readMessage: vi.fn(),
  getPublicUserProfile: vi.fn(),
  showToast: vi.fn(),
  requestConfirmation: vi.fn(),
  createObjectURL: vi.fn(() => 'blob:http://localhost/test-preview'),
  revokeObjectURL: vi.fn(),
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useRouter: () => mocks.router,
    useRoute: () => mocks.route,
  };
});

vi.mock('../../router', () => ({
  router: mocks.router,
}));

vi.mock('../../utils/toast', () => ({
  showToast: mocks.showToast,
}));

vi.mock('../../utils/confirm', () => ({
  requestConfirmation: mocks.requestConfirmation,
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    listMessages: mocks.listMessages,
    listChatHistory: mocks.listChatHistory,
    sendPrivateMessage: mocks.sendPrivateMessage,
    sendPrivateImage: mocks.sendPrivateImage,
    followUser: mocks.followUser,
    uploadImage: mocks.uploadImage,
    readMessage: mocks.readMessage,
    getPublicUserProfile: mocks.getPublicUserProfile,
  },
}));

// Mock URL methods in jsdom
window.URL.createObjectURL = mocks.createObjectURL;
window.URL.revokeObjectURL = mocks.revokeObjectURL;

import MessagesPage from '../MessagesPage.vue';
import { useAuthStore } from '../../stores/auth';
import { useSettingsStore } from '../../stores/settings';
import { clearMessageDraft, saveMessageDraft } from '../../utils/messageDrafts';

describe('MessagesPage 粘贴图片发送功能', () => {
  let wrapper: any;

  it('系统表情插入 Unicode，收藏图片进入待发送区且不立即发私信', async () => {
    await mountMessagesPage();
    const page = wrapper.findComponent(MessagesPage);
    await page.get('button[title="表情"]').trigger('click');
    await page.get('[role="tab"][aria-label="系统 Emoji"]').trigger('click');
    await page.get('.emoji-item-btn').trigger('click');
    expect(page.get('[contenteditable="true"]').text()).toBe('😀');
    await page.get('button[title="表情"]').trigger('click');
    const picture = { id: '1', url: 'https://image.coolapk.com/favorite1.gif' };
    page.findComponent({ name: 'EmojiPanel' }).vm.$emit('picture', picture);
    await flushPromises();
    expect(page.findAll('.pending-image-card')).toHaveLength(1);
    expect(mocks.sendPrivateImage).not.toHaveBeenCalled();
    expect(page.find('.emoji-picker-popover').exists()).toBe(true);
    page.findComponent({ name: 'EmojiPanel' }).vm.$emit('picture', picture); await flushPromises();
    expect(page.findAll('.pending-image-card')).toHaveLength(1);
    page.findComponent({ name: 'EmojiPanel' }).vm.$emit('picture', { id: '2', url: 'https://image.coolapk.com/favorite2.gif' });
    await flushPromises();
    expect(page.findAll('.pending-image-card')).toHaveLength(2);
    expect(page.find('.emoji-picker-popover').exists()).toBe(true);
    await page.get('.input-actions .app-btn').trigger('click'); await flushPromises();
    expect(mocks.sendPrivateImage).toHaveBeenCalledWith('20002', picture.url);
    expect(mocks.sendPrivateImage).toHaveBeenCalledWith('20002', 'https://image.coolapk.com/favorite2.gif');
    expect(mocks.uploadImage).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete mocks.route.query.feedback;
    const pinia = createPinia();
    setActivePinia(pinia);

    const authStore = useAuthStore(pinia);
    authStore.user = { uid: 10001, username: '测试用户' } as any;
    authStore.isLoggedIn = true;

    const testSession = {
      ukey: '10001_20002',
      id: '10001_20002',
      uid: 20002,
      fromuid: 10001,
      entityId: 20002,
      messageUid: 20002,
      messageUsername: '好友酷友',
      username: '好友酷友',
      message: '你好',
      dateline: 1700000000,
      isNewConversation: true,
    };

    sessionStorage.removeItem('coolapk_message_sessions_pagination_10001');
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([testSession]));
    mocks.listMessages.mockResolvedValue({ data: [testSession] });
    mocks.listChatHistory.mockResolvedValue({ data: [] });
    mocks.uploadImage.mockResolvedValue({ data: '/message/2026/09/test_image.jpg' });
    mocks.sendPrivateImage.mockResolvedValue({ data: [{ id: 999, message_pic: '/message/2026/09/test_image.jpg' }] });
    mocks.sendPrivateMessage.mockResolvedValue({ data: [{ id: 1000, message: '测试文本' }] });
    mocks.followUser.mockResolvedValue({ code: 200 });
    mocks.getPublicUserProfile.mockResolvedValue({ data: { isFollow: 0 } });
    mocks.requestConfirmation.mockResolvedValue(true);
    mocks.readMessage.mockResolvedValue({ code: 200 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete mocks.route.query.initialText;
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    await flushPromises();
    await clearMessageDraft('10001', '10001_20002');
    await clearMessageDraft('99999', '10001_20002');
  });

  async function mountMessagesPage(visible?: Ref<boolean>) {
    const component = visible ? defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => visible.value ? h(MessagesPage) : h('div') }),
    }) : MessagesPage;
    wrapper = mount(component, {
      attachTo: document.body,
      global: {
        stubs: {
          AppAvatar: true,
          AppImage: true,
          EmptyState: true,
          LoadingState: true,
          ErrorState: true,
          AppButton: {
            props: ['loading', 'disabled', 'variant', 'size'],
            template: '<button class="app-btn" :disabled="disabled"><slot /></button>',
          },
        },
      },
    });

    await flushPromises();
    const sessionItem = wrapper.find('.session-item');
    if (sessionItem.exists()) {
      await sessionItem.trigger('click');
      await flushPromises();
    }
    return wrapper;
  }

  it.each(['share', 'draft'])('手机进入会话恢复 %s 时保留内容且不聚焦输入框', async (source) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 16)');
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const text = 'https://www.coolapk.com/feed/123';
    if (source === 'share') mocks.route.query.initialText = text;
    else await saveMessageDraft('10001', '10001_20002', text);
    const w = await mountMessagesPage();
    expect(w.get('.message-rich-editor').text()).toBe(text);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(w.get('.message-rich-editor').element);
    expect(mocks.sendPrivateMessage).not.toHaveBeenCalled();
  });

  it('桌面恢复草稿时聚焦输入框且禁止浏览器滚动外层页面', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    await saveMessageDraft('10001', '10001_20002', '桌面草稿');
    const w = await mountMessagesPage();
    expect(w.get('.message-rich-editor').text()).toBe('桌面草稿');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(w.get('.message-rich-editor').element);
  });

  it.each([true, false])('切换页面后恢复聊天位置，离开时位于底部=%s', async (atBottom) => {
    const visible = ref(true);
    const w = await mountMessagesPage(visible);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const chatArea = w.find('.chat-area');
    const area = chatArea.element as HTMLElement;
    let height = 1000;
    Object.defineProperty(area, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(area, 'clientHeight', { configurable: true, value: 200 });
    area.scrollTop = atBottom ? 800 : 400;
    await chatArea.trigger('scroll');
    visible.value = false;
    await flushPromises();
    // Detached KeepAlive nodes may report zero; this must not replace the saved reading position.
    area.scrollTop = 0;
    await chatArea.trigger('scroll');
    height = 1300;
    visible.value = true;
    await flushPromises();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(w.find('.chat-area').element).toBe(area);
    expect(area.scrollTop).toBe(atBottom ? 1300 : 400);
  });

  it('旧版反馈查询参数不会在私信中上传诊断日志', async () => {
    mocks.route.query.feedback = '1';
    const w = await mountMessagesPage();
    expect(w.find('.feedback-log-option').exists()).toBe(false);
    const editor = w.find('.message-rich-editor');
    editor.element.innerHTML = '普通私信';
    await editor.trigger('input');
    await w.find('.input-actions button').trigger('click');
    await flushPromises();
    expect(mocks.sendPrivateMessage).toHaveBeenCalledWith('20002', '普通私信');
  });

  it('手机上可从聊天返回会话列表，同时保留当前会话', async () => {
    const w = await mountMessagesPage();

    expect(w.find('.messages-page').classes()).toContain('is-mobile-chat-active');
    expect(w.find('.mobile-session-back').exists()).toBe(true);

    await w.find('.mobile-session-back').trigger('click');

    expect(w.find('.messages-page').classes()).not.toContain('is-mobile-chat-active');
    expect(w.find('.messages-main').exists()).toBe(true);
  });

  it('只处理 APK 返回的 messageExtra/float 关注提示，并将数字 messageUid 转为字符串', async () => {
    const historySession = {
      ukey: '10001_20002',
      id: '10001_20002',
      uid: 20002,
      fromuid: 20002,
      entityId: 20002,
      messageUid: 20002,
      messageUsername: '好友酷友',
      username: '好友酷友',
      message: '你好',
      dateline: 1700000000,
      isNewConversation: false,
    };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([historySession]));
    mocks.listMessages.mockResolvedValue({ data: [historySession] });
    mocks.listChatHistory.mockResolvedValue({
      data: [{ id: 'follow-tip-1', entityId: 'follow-tip-1', entityType: 'messageExtra', entityTemplate: 'float', title: '由于你未关注对方，你回复之前，ta只能给你发送3条私信' }],
    });

    const w = await mountMessagesPage();
    const followButton = w.find('.follow-action-btn');
    expect(followButton.exists()).toBe(true);
    expect(mocks.getPublicUserProfile).not.toHaveBeenCalled();

    await followButton.trigger('click');
    await flushPromises();

    expect(mocks.requestConfirmation).toHaveBeenCalledWith({
      title: '关注用户',
      message: '是否关注用户『好友酷友』？关注对方即可让TA与你无限制聊天',
      confirmText: '确认关注',
    });
    expect(mocks.followUser).toHaveBeenCalledWith('20002');
    expect(mocks.showToast).toHaveBeenCalledWith('关注成功', 'success');
    expect(w.find('.follow-action-btn').exists()).toBe(false);
  });

  it('普通 messageExtra 即使文本包含关注也不显示关注按钮', async () => {
    const historySession = {
      ukey: '10001_20002',
      id: '10001_20002',
      uid: 20002,
      fromuid: 20002,
      entityId: 20002,
      messageUid: 20002,
      messageUsername: '好友酷友',
      username: '好友酷友',
      message: '你好',
      dateline: 1700000000,
      isNewConversation: false,
    };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([historySession]));
    mocks.listMessages.mockResolvedValue({ data: [historySession] });
    mocks.listChatHistory.mockResolvedValue({
      data: [{ id: 'notice-1', entityType: 'messageExtra', entityTemplate: 'time', message: '关注对方后可以继续互动' }],
    });

    const w = await mountMessagesPage();
    expect(w.find('.follow-action-btn').exists()).toBe(false);
    expect(mocks.followUser).not.toHaveBeenCalled();
  });

  it('APK 不查询 isFollow，服务端返回提示时直接调用关注接口', async () => {
    mocks.getPublicUserProfile.mockResolvedValue({ data: { isFollow: 1 } });
    mocks.listChatHistory.mockResolvedValue({
      data: [{ id: 'follow-tip-1', entityId: 'follow-tip-1', entityType: 'messageExtra', entityTemplate: 'float', title: '关注对方即可让TA与你无限制聊天' }],
    });
    const historySession = {
      ukey: '10001_20002',
      id: '10001_20002',
      uid: 20002,
      fromuid: 20002,
      entityId: 20002,
      messageUid: 20002,
      messageUsername: '好友酷友',
      username: '好友酷友',
      message: '你好',
      dateline: 1700000000,
      isNewConversation: false,
    };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([historySession]));
    mocks.listMessages.mockResolvedValue({ data: [historySession] });

    const w = await mountMessagesPage();
    const followButton = w.find('.follow-action-btn');
    await followButton.trigger('click');
    await flushPromises();

    expect(mocks.getPublicUserProfile).not.toHaveBeenCalled();
    expect(mocks.followUser).toHaveBeenCalledWith('20002');
    expect(mocks.showToast).not.toHaveBeenCalledWith('已经关注过该酷友了，无需重复关注', 'info');
  });

  it('关注成功后只移除当前会话提示，切换会话不会误删其他会话提示', async () => {
    const firstSession = {
      ukey: '10001_20002',
      id: '10001_20002',
      uid: 20002,
      fromuid: 20002,
      entityId: 20002,
      messageUid: 20002,
      messageUsername: '好友酷友',
      username: '好友酷友',
      message: '你好',
      dateline: 1700000000,
      isNewConversation: false,
    };
    const secondSession = { ...firstSession, ukey: '10001_30003', id: '10001_30003', uid: 30003, messageUid: 30003, messageUsername: '另一个酷友', username: '另一个酷友' };
    let firstSessionFollowed = false;
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([firstSession, secondSession]));
    mocks.listMessages.mockResolvedValue({ data: [firstSession, secondSession] });
    mocks.followUser.mockImplementation(async () => {
      firstSessionFollowed = true;
      return { code: 200 };
    });
    mocks.listChatHistory.mockImplementation(async (ukey: string) => ({
      data: ukey === firstSession.ukey && firstSessionFollowed
        ? []
        : [{ id: 'follow-tip-1', entityId: 'follow-tip-1', entityType: 'messageExtra', entityTemplate: 'float', title: '关注对方即可让TA与你无限制聊天' }],
    }));

    const w = await mountMessagesPage();
    await w.find('.follow-action-btn').trigger('click');
    await flushPromises();
    expect(w.find('.follow-action-btn').exists()).toBe(false);

    const sessionItems = w.findAll('.session-item');
    await sessionItems[1].trigger('click');
    await flushPromises();
    expect(w.find('.follow-action-btn').exists()).toBe(true);

    await sessionItems[0].trigger('click');
    await flushPromises();

    expect(w.find('.follow-action-btn').exists()).toBe(false);
  });

  it('关注请求失败时保留提示并允许重试', async () => {
    mocks.followUser.mockRejectedValueOnce(new Error('关注失败'));
    const historySession = {
      ukey: '10001_20002',
      id: '10001_20002',
      uid: 20002,
      fromuid: 20002,
      entityId: 20002,
      messageUid: 20002,
      messageUsername: '好友酷友',
      username: '好友酷友',
      message: '你好',
      dateline: 1700000000,
      isNewConversation: false,
    };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([historySession]));
    mocks.listMessages.mockResolvedValue({ data: [historySession] });
    mocks.listChatHistory.mockResolvedValue({
      data: [{ id: 'follow-tip-1', entityId: 'follow-tip-1', entityType: 'messageExtra', entityTemplate: 'float', title: '关注对方即可让TA与你无限制聊天' }],
    });

    const w = await mountMessagesPage();
    await w.find('.follow-action-btn').trigger('click');
    await flushPromises();

    expect(w.find('.follow-action-btn').exists()).toBe(true);
    expect(mocks.showToast).toHaveBeenCalledWith('关注失败', 'error');

    await w.find('.follow-action-btn').trigger('click');
    await flushPromises();
    expect(mocks.followUser).toHaveBeenCalledTimes(2);
    expect(w.find('.follow-action-btn').exists()).toBe(false);
  });

  it('取消确认时不调用关注接口并保留提示', async () => {
    mocks.requestConfirmation.mockResolvedValueOnce(false);
    const historySession = {
      ukey: '10001_20002',
      id: '10001_20002',
      uid: 20002,
      fromuid: 20002,
      entityId: 20002,
      messageUid: 20002,
      messageUsername: '好友酷友',
      username: '好友酷友',
      message: '你好',
      dateline: 1700000000,
      isNewConversation: false,
    };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([historySession]));
    mocks.listMessages.mockResolvedValue({ data: [historySession] });
    mocks.listChatHistory.mockResolvedValue({
      data: [{ id: 'follow-tip-1', entityId: 'follow-tip-1', entityType: 'messageExtra', entityTemplate: 'float', title: '关注对方即可让TA与你无限制聊天' }],
    });

    const w = await mountMessagesPage();
    await w.find('.follow-action-btn').trigger('click');
    await flushPromises();

    expect(mocks.followUser).not.toHaveBeenCalled();
    expect(w.find('.follow-action-btn').exists()).toBe(true);
  });

  it('关注请求进行中阻止重复提交', async () => {
    let resolveFollow!: (value: unknown) => void;
    mocks.followUser.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFollow = resolve;
    }));
    const historySession = {
      ukey: '10001_20002',
      id: '10001_20002',
      uid: 20002,
      fromuid: 20002,
      entityId: 20002,
      messageUid: 20002,
      messageUsername: '好友酷友',
      username: '好友酷友',
      message: '你好',
      dateline: 1700000000,
      isNewConversation: false,
    };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([historySession]));
    mocks.listMessages.mockResolvedValue({ data: [historySession] });
    mocks.listChatHistory.mockResolvedValue({
      data: [{ id: 'follow-tip-1', entityId: 'follow-tip-1', entityType: 'messageExtra', entityTemplate: 'float', title: '关注对方即可让TA与你无限制聊天' }],
    });

    const w = await mountMessagesPage();
    const followButton = w.find('.follow-action-btn');
    await followButton.trigger('click');
    await followButton.trigger('click');
    expect(mocks.followUser).toHaveBeenCalledTimes(1);

    resolveFollow({ code: 200 });
    await flushPromises();
    expect(w.find('.follow-action-btn').exists()).toBe(false);
  });

  it('支持在输入框粘贴图片，展示待发送图片缩略图并启用发送按钮', async () => {
    const w = await mountMessagesPage();
    const editor = w.find('.message-rich-editor');
    expect(editor.exists()).toBe(true);

    const sendBtn = w.find('.input-actions .app-btn');
    expect(sendBtn.attributes('disabled')).toBeDefined();

    const fakeImageFile = new File(['fake content'], 'screenshot.png', { type: 'image/png' });
    await editor.trigger('paste', {
      clipboardData: {
        items: [
          {
            type: 'image/png',
            getAsFile: () => fakeImageFile,
          },
        ],
        files: [],
        getData: () => '',
      },
    });

    // 预览区域展示待发送图片
    const previewBar = w.find('.pending-images-bar');
    expect(previewBar.exists()).toBe(true);
    expect(w.findAll('.pending-image-card')).toHaveLength(1);

    // 发送按钮被启用
    expect(sendBtn.attributes('disabled')).toBeUndefined();
  });

  it('点击移除按钮可删除待发送图片', async () => {
    const w = await mountMessagesPage();
    const editor = w.find('.message-rich-editor');

    const fakeImageFile = new File(['fake'], 'test.png', { type: 'image/png' });
    await editor.trigger('paste', {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => fakeImageFile }],
        files: [],
        getData: () => '',
      },
    });

    expect(w.findAll('.pending-image-card')).toHaveLength(1);

    const removeBtn = w.find('.pending-image-remove-btn');
    await removeBtn.trigger('click');

    expect(w.findAll('.pending-image-card')).toHaveLength(0);
    expect(mocks.revokeObjectURL).toHaveBeenCalled();

    // 发送按钮重新禁用
    const sendBtn = w.find('.input-actions .app-btn');
    expect(sendBtn.attributes('disabled')).toBeDefined();
  });

  it('空输入框按退格键可移除最后一张待发送图片', async () => {
    const w = await mountMessagesPage();
    const editor = w.find('.message-rich-editor');

    const fakeImageFile = new File(['fake'], 'test.png', { type: 'image/png' });
    await editor.trigger('paste', {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => fakeImageFile }],
        files: [],
        getData: () => '',
      },
    });

    expect(w.findAll('.pending-image-card')).toHaveLength(1);

    await editor.trigger('keydown', { key: 'Backspace' });
    expect(w.findAll('.pending-image-card')).toHaveLength(0);
  });

  it('点击发送或按回车时上传并发送已粘贴的图片', async () => {
    const w = await mountMessagesPage();
    const editor = w.find('.message-rich-editor');

    const fakeImageFile = new File(['fake image bytes'], 'pasted_photo.png', { type: 'image/png' });
    await editor.trigger('paste', {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => fakeImageFile }],
        files: [],
        getData: () => '',
      },
    });

    const sendBtn = w.find('.input-actions .app-btn');
    expect(sendBtn.attributes('disabled')).toBeUndefined();

    await sendBtn.trigger('click');
    await flushPromises();

    expect(mocks.uploadImage).toHaveBeenCalledTimes(1);
    expect(mocks.sendPrivateImage).toHaveBeenCalledWith('20002', '/message/2026/09/test_image.jpg');

    // 图片发送后，待发送列表清空
    expect(w.findAll('.pending-image-card')).toHaveLength(0);
  });

  it('支持同时存在待发送图片与文本内容时顺序发送图片与文本', async () => {
    const w = await mountMessagesPage();
    const editor = w.find('.message-rich-editor');

    const fakeImageFile = new File(['fake image bytes'], 'pasted_photo.png', { type: 'image/png' });
    await editor.trigger('paste', {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => fakeImageFile }],
        files: [],
        getData: () => '',
      },
    });

    // 粘贴一段文本
    await editor.trigger('paste', {
      clipboardData: {
        items: [],
        files: [],
        getData: (format: string) => (format === 'text/plain' ? '请查看此截图' : ''),
      },
    });

    const sendBtn = w.find('.input-actions .app-btn');
    expect(sendBtn.attributes('disabled')).toBeUndefined();

    await sendBtn.trigger('click');
    await flushPromises();

    expect(mocks.uploadImage).toHaveBeenCalledTimes(1);
    expect(mocks.sendPrivateImage).toHaveBeenCalledWith('20002', '/message/2026/09/test_image.jpg');
    expect(mocks.sendPrivateMessage).toHaveBeenCalledWith('20002', '请查看此截图');
    expect(w.findAll('.pending-image-card')).toHaveLength(0);
  });

  it('默认按 Enter 发送私信', async () => {
    const w = await mountMessagesPage();
    const editor = w.find('.message-rich-editor');
    editor.element.textContent = '测试消息';
    await editor.trigger('input');

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    editor.element.dispatchEvent(event);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.sendPrivateMessage).toHaveBeenCalledWith('20002', '测试消息');
  });

  it('发送成功后使用服务端消息 ID，刷新历史记录不重复显示', async () => {
    const session = { ...JSON.parse(sessionStorage.getItem('coolapk_message_sessions_10001')!)[0], isNewConversation: false };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([session]));
    mocks.listMessages.mockResolvedValue({ data: [session] });
    const w = await mountMessagesPage();
    const editor = w.find('.message-rich-editor');
    editor.element.textContent = '只发送一次';
    await editor.trigger('input');
    await w.find('.input-actions .app-btn').trigger('click');
    await flushPromises();

    mocks.listChatHistory.mockResolvedValue({ data: [
      { id: 1000, entityId: 1000, fromuid: 10001, uid: 20002, message: '只发送一次', dateline: Math.floor(Date.now() / 1000) },
    ] });
    await w.find('.session-item').trigger('click');
    await flushPromises();

    expect(w.findAll('.message-item')).toHaveLength(1);
    expect(w.find('.message-item .msg-text').text()).toBe('只发送一次');
  });

  it('发送接口没有返回消息 ID 时，用服务端记录替换临时气泡', async () => {
    const session = { ...JSON.parse(sessionStorage.getItem('coolapk_message_sessions_10001')!)[0], isNewConversation: false };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([session]));
    mocks.listMessages.mockResolvedValue({ data: [session] });
    mocks.sendPrivateMessage.mockResolvedValue({ data: [] });
    const w = await mountMessagesPage();
    const editor = w.find('.message-rich-editor');
    editor.element.textContent = '等待同步';
    await editor.trigger('input');
    await w.find('.input-actions .app-btn').trigger('click');
    await flushPromises();

    mocks.listChatHistory.mockResolvedValue({ data: [
      { id: 2001, entityId: 2001, fromuid: 10001, uid: 20002, message: '等待同步', dateline: Math.floor(Date.now() / 1000) },
    ] });
    await w.find('.session-item').trigger('click');
    await flushPromises();

    expect(w.findAll('.message-item')).toHaveLength(1);
    expect(w.find('.message-item .bubble-wrapper').attributes('data-context-message-id')).toBe('2001');
  });

  it('切换为换行模式后按 Enter 换行，按 Ctrl+Enter 发送私信', async () => {
    const w = await mountMessagesPage();
    const settingsStore = useSettingsStore();
    settingsStore.settings.messageEnterBehavior = 'newline';
    const editor = w.find('.message-rich-editor');
    editor.element.textContent = '测试消息';
    await editor.trigger('input');

    const newlineEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    editor.element.dispatchEvent(newlineEvent);
    expect(newlineEvent.defaultPrevented).toBe(false);
    expect(mocks.sendPrivateMessage).not.toHaveBeenCalled();

    const sendEvent = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
    editor.element.dispatchEvent(sendEvent);
    await flushPromises();

    expect(sendEvent.defaultPrevented).toBe(true);
    expect(mocks.sendPrivateMessage).toHaveBeenCalledWith('20002', '测试消息');
  });

  it.each([true, false])('收到通知后立即同步当前聊天并保持阅读位置，原来位于底部=%s', async (atBottom) => {
    const session = { ukey: '10001_20002', messageUid: 20002, fromuid: 20002, message: '旧消息' };
    const oldMessage = { id: 'm1', fromuid: 20002, message: '旧消息', dateline: 1 };
    const newMessage = { id: 'm2', fromuid: 20002, message: '新消息', dateline: 2 };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([session]));
    mocks.listMessages.mockResolvedValue({ data: [session] });
    mocks.listChatHistory.mockResolvedValue({ data: [oldMessage] });
    const w = await mountMessagesPage(ref(true));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const area = w.get('.chat-area').element as HTMLElement;
    Object.defineProperty(area, 'scrollHeight', { configurable: true, get: () => w.findAll('.message-item').length * 1000 });
    Object.defineProperty(area, 'clientHeight', { configurable: true, value: 200 });
    area.scrollTop = atBottom ? 800 : 400;
    const editor = w.get('.message-rich-editor');
    editor.element.textContent = '未发送的草稿';
    await editor.trigger('input');
    mocks.listChatHistory.mockClear();
    mocks.readMessage.mockClear();
    mocks.listMessages.mockResolvedValue({ data: [{ ...session, message: '新消息', isnew: 1, unreadNum: 1 }] });
    mocks.listChatHistory.mockResolvedValue({ data: [oldMessage, newMessage] });
    window.dispatchEvent(new Event('coolapk-message-count-increased'));
    await flushPromises();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    expect(mocks.listChatHistory).toHaveBeenCalledWith('10001_20002', 1, '', 'm1');
    expect(w.findAll('.message-item .msg-text').map((item: { text(): string }) => item.text())).toEqual(['旧消息', '新消息']);
    expect(area.scrollTop).toBe(atBottom ? 2000 : 400);
    expect(editor.text()).toBe('未发送的草稿');
    expect(mocks.readMessage).toHaveBeenCalledWith('10001_20002');
    expect(w.find('.session-unread-badge').exists()).toBe(false);
  });

  it('定时轮询同步当前聊天，离开页面后停止拉取', async () => {
    vi.useFakeTimers();
    try {
      const session = { ukey: '10001_20002', messageUid: 20002, message: '会话摘要' };
      sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([session]));
      mocks.listMessages.mockResolvedValue({ data: [session] });
      mocks.listChatHistory.mockResolvedValue({ data: [{ id: 'm1', message: '旧消息', dateline: 1 }] });
      const visible = ref(true);
      const w = await mountMessagesPage(visible);
      mocks.listChatHistory.mockClear();
      mocks.listChatHistory.mockResolvedValue({ data: [{ id: 'm2', message: '轮询收到的消息', dateline: 2 }] });
      await vi.advanceTimersByTimeAsync(10_000);
      await flushPromises();
      expect(mocks.listChatHistory).toHaveBeenCalledWith('10001_20002', 1, '', 'm1');
      expect(w.findAll('.message-item .msg-text').map((item: { text(): string }) => item.text())).toEqual(['旧消息', '轮询收到的消息']);
      visible.value = false;
      await flushPromises();
      mocks.listChatHistory.mockClear();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(mocks.listChatHistory).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('切换会话后丢弃旧会话的延迟响应', async () => {
    const session = { ukey: '10001_20002', messageUid: 20002, message: '旧消息' };
    const other = { ukey: '10001_30003', messageUid: 30003, message: '另一个会话' };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([session, other]));
    mocks.listMessages.mockResolvedValue({ data: [session, other] });
    mocks.listChatHistory.mockResolvedValue({ data: [{ id: 'm1', message: '旧消息', dateline: 1 }] });
    const w = await mountMessagesPage(ref(true));
    let resolveHistory!: (value: any) => void;
    mocks.listChatHistory.mockImplementationOnce(() => new Promise(resolve => { resolveHistory = resolve; }));
    window.dispatchEvent(new Event('coolapk-message-count-increased'));
    await flushPromises();
    expect(resolveHistory).toBeTypeOf('function');
    await w.findAll('.session-item')[1].trigger('click');
    await flushPromises();
    resolveHistory({ data: [{ id: 'late', message: '旧会话迟到的新消息', dateline: 2 }] });
    await flushPromises();
    expect(w.text()).not.toContain('旧会话迟到的新消息');
  });

  it('刷新会话标识变化时按对方 UID 合并，保留最新摘要和其他联系人', async () => {
    const cached = { id: 'old-message', messageUid: 20002, messageUsername: '好友酷友', message: '旧摘要' };
    const latest = { ...cached, id: 'new-message', messageUid: '20002', message: '最新摘要' };
    const other = { id: 'other-message', messageUid: 30003, messageUsername: '另一个酷友', message: '其他消息' };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([cached, other]));
    mocks.listMessages.mockResolvedValue({ data: [cached] });
    const w = await mountMessagesPage(ref(true));

    mocks.listMessages.mockResolvedValue({ data: [latest, { ...latest, id: 'duplicate-message' }] });
    window.dispatchEvent(new Event('coolapk-message-count-increased'));
    await flushPromises();

    expect(w.findAll('.session-item')).toHaveLength(2);
    expect(w.find('.session-item .last-message').text()).toBe('最新摘要');
    expect(w.findAll('.session-item.active')).toHaveLength(1);
    expect(JSON.parse(sessionStorage.getItem('coolapk_message_sessions_10001')!)).toHaveLength(2);
  });

  it('接口未返回时也清理缓存中同一聊天对象的重复会话', async () => {
    const cached = { ukey: '10001_20002', id: 'cached-message', messageUid: 20002, messageUsername: '好友酷友', message: '缓存摘要' };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([cached, { ...cached, ukey: '20002_10001', id: 'duplicate-message', messageUid: '20002' }]));
    // 保持列表请求未完成，验证去重在缓存恢复时就生效。
    mocks.listMessages.mockImplementation(() => new Promise(() => {}));
    const w = await mountMessagesPage();

    expect(w.findAll('.session-item')).toHaveLength(1);
  });

  it('分页返回不同标识的同一联系人时不重复添加，同时保留新联系人', async () => {
    const first = { ukey: '10001_20002', id: 'first-message', messageUid: 20002, messageUsername: '好友酷友', message: '第一页摘要' };
    const other = { ukey: '10001_30003', id: 'other-message', messageUid: 30003, messageUsername: '另一个酷友', message: '其他消息' };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([first]));
    mocks.listMessages.mockImplementation(async (page: number) => ({ data: page === 1 ? [first] : [{ ...first, ukey: '20002_10001', id: 'older-message', messageUid: '20002', message: '旧摘要' }, other] }));
    const w = await mountMessagesPage();
    await w.find('.session-pagination-action').trigger('click');
    await flushPromises();

    expect(w.findAll('.session-item')).toHaveLength(2);
    expect(w.find('.session-item .last-message').text()).toBe('第一页摘要');
    expect(mocks.listMessages).toHaveBeenCalledWith(2, '', '10001_20002');
  });

  it('滚动加载更早会话，并在刷新第一页后保留旧会话', async () => {
    const makeSession = (uid: number) => ({
      ukey: `10001_${uid}`,
      id: `10001_${uid}`,
      messageUid: uid,
      messageUsername: `酷友${uid}`,
      message: `消息${uid}`,
      dateline: uid,
    });
    const firstPage = [makeSession(20002), makeSession(20003)];
    const older = makeSession(20004);
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify(firstPage));
    mocks.listMessages.mockImplementation(async (page: number) => ({ data: page === 1 ? firstPage : page === 2 ? [older] : [] }));

    const w = await mountMessagesPage();
    await w.find('.session-pagination-action').trigger('click');
    await flushPromises();

    expect(mocks.listMessages).toHaveBeenCalledWith(2, '', '10001_20003');
    expect(w.findAll('.session-item')).toHaveLength(3);

    mocks.listMessages.mockImplementation(async (page: number) => ({ data: page === 1 ? [firstPage[0]] : [] }));
    window.dispatchEvent(new Event('coolapk-message-count-increased'));
    await flushPromises();
    expect(w.findAll('.session-item')).toHaveLength(3);
  });

  it('向上滚动时按 APK 游标加载更早消息并保持消息顺序', async () => {
    const historySession = {
      ukey: '10001_20002',
      id: '10001_20002',
      uid: 20002,
      fromuid: 20002,
      entityId: 20002,
      messageUid: 20002,
      messageUsername: '好友酷友',
      username: '好友酷友',
      message: '最新消息',
      dateline: 3,
      isNewConversation: false,
    };
    sessionStorage.setItem('coolapk_message_sessions_10001', JSON.stringify([historySession]));
    mocks.listMessages.mockResolvedValue({ data: [historySession] });
    mocks.listChatHistory.mockImplementation(async (_ukey: string, page: number) => {
      if (page === 1) {
        return {
          data: [
            { id: 'm2', entityId: 'm2', entityType: 'message', message: '中间消息', dateline: 2, fromuid: 20002 },
            { id: 'm3', entityId: 'm3', entityType: 'message', message: '最新消息', dateline: 3, fromuid: 20002 },
          ],
        };
      }
      return {
        data: [{ id: 'm1', entityId: 'm1', entityType: 'message', message: '最早消息', dateline: 1, fromuid: 20002 }],
      };
    });

    const w = await mountMessagesPage();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const chatArea = w.find('.chat-area');
    const chatAreaElement = chatArea.element as HTMLElement;
    let scrollHeight = 200;
    Object.defineProperty(chatAreaElement, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(chatAreaElement, 'clientHeight', { configurable: true, value: 100 });
    chatAreaElement.scrollTop = 0;
    await chatArea.trigger('scroll');
    scrollHeight = 300;
    await flushPromises();

    expect(mocks.listChatHistory).toHaveBeenNthCalledWith(2, '10001_20002', 2, 'm2', '');
    expect(w.findAll('.message-item')).toHaveLength(3);
    expect(w.findAll('.msg-text').map((item: any) => item.text())).toEqual(['最早消息', '中间消息', '最新消息']);
    expect(chatAreaElement.scrollTop).toBe(100);
  });
});
