import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { KeepAlive, defineComponent, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  query: {} as Record<string, string>,
  listMessages: vi.fn(),
  listChatHistory: vi.fn(),
  sendPrivateMessage: vi.fn(),
  sendPrivateImage: vi.fn(),
  uploadImage: vi.fn(),
  readMessage: vi.fn(),
  getPublicUserProfile: vi.fn(),
  showToast: vi.fn(),
  requestConfirmation: vi.fn(),
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useRouter: () => mocks.router,
    useRoute: () => ({ get query() { return mocks.query; } }),
  };
});

vi.mock('../../router', () => ({ router: mocks.router }));
vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../../utils/confirm', () => ({ requestConfirmation: mocks.requestConfirmation }));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    listMessages: mocks.listMessages,
    listChatHistory: mocks.listChatHistory,
    sendPrivateMessage: mocks.sendPrivateMessage,
    sendPrivateImage: mocks.sendPrivateImage,
    uploadImage: mocks.uploadImage,
    readMessage: mocks.readMessage,
    getPublicUserProfile: mocks.getPublicUserProfile,
  },
}));

import MessagesPage from '../MessagesPage.vue';
import { useAuthStore } from '../../stores/auth';
import { useNotificationStore } from '../../stores/notifications';

// 组件会原地修改会话对象（置读清未读），每个用例必须拿到全新副本。
const makeSession = (overrides: Record<string, unknown> = {}) => ({
  ukey: '10001_20002',
  id: '10001_20002',
  uid: 20002,
  fromuid: 20002,
  entityId: 20002,
  messageUid: 20002,
  messageUsername: '好友酷友',
  username: '好友酷友',
  message: '你好',
  unreadNum: 2,
  dateline: 1700000000,
  isNewConversation: false,
  ...overrides,
});

describe('MessagesPage 批次18：私信未读水位与发送路径', () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const pinia = createPinia();
    setActivePinia(pinia);
    const authStore = useAuthStore(pinia);
    authStore.user = { uid: 10001, username: '测试用户' } as any;
    authStore.isLoggedIn = true;

    sessionStorage.removeItem('coolapk_message_sessions_10001');
    sessionStorage.removeItem('coolapk_message_sessions_pagination_10001');
    mocks.listMessages.mockResolvedValue({ data: [makeSession()] });
    mocks.listChatHistory.mockResolvedValue({ data: [] });
    mocks.uploadImage.mockResolvedValue({ data: '/message/2026/09/test_image.jpg' });
    mocks.sendPrivateImage.mockResolvedValue({ data: [{ id: 999, message_pic: '/message/2026/09/test_image.jpg' }] });
    mocks.sendPrivateMessage.mockResolvedValue({ data: [{ id: 1000, message: '测试文本' }] });
    mocks.readMessage.mockResolvedValue({ code: 200 });
    mocks.getPublicUserProfile.mockResolvedValue({ data: {} });
    mocks.requestConfirmation.mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    await flushPromises();
  });

  async function mountMessagesPage() {
    wrapper = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (ref(true).value ? h(MessagesPage) : h('div')) }),
    }), {
      attachTo: document.body,
      global: {
        stubs: { AppAvatar: true, AppImage: true, EmptyState: true, LoadingState: true, ErrorState: true },
      },
    });
    await flushPromises();
    return wrapper;
  }

  async function typeText(w: any, text: string) {
    const editor = w.find('.message-rich-editor');
    editor.element.textContent = text;
    await editor.trigger('input');
  }

  function serverMessage(count: number, dateline: number) {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 0, message: count, dateline } });
    return store;
  }

  it('提示消息 2 条未读时点击会话，角标从 2 减到 0 而不是 1', async () => {
    const store = serverMessage(2, 100);
    expect(store.messageCount).toBe(2);
    await mountMessagesPage();
    await flushPromises();

    const items = wrapper.findAll('.session-item');
    expect(items[0]!.text()).toContain('好友酷友');
    await items[0]!.trigger('click');
    await flushPromises();

    expect(mocks.readMessage).toHaveBeenCalledWith('10001_20002');
    expect(store.messageCount).toBe(0);
  });

  it('列表副本仍有 2 条未读而当前会话对象已清零时，置读按 2 扣减而不是 1', async () => {
    const store = serverMessage(2, 100);
    await mountMessagesPage();
    await flushPromises();

    // 点击会话触发首次置读：2 → 0
    const items = wrapper.findAll('.session-item');
    await items[0]!.trigger('click');
    await flushPromises();
    expect(mocks.readMessage).toHaveBeenCalledWith('10001_20002');
    expect(store.messageCount).toBe(0);

    // 服务端又给出 2 条未读，且轮询回来的列表副本仍带 2 条未读（置读结果尚未同步）。
    // markNotificationsCleared 仅作为测试水位重置：清掉第一次置读的本地抵消水位，
    // 让新快照的 message=2 能如实进入角标。
    store.markNotificationsCleared(false);
    store.applyServerResponse({ data: { notification_v18: 0, message: 2, dateline: 101 } });
    expect(store.messageCount).toBe(2);
    mocks.listMessages.mockResolvedValue({ data: [makeSession()] });

    // 刷新会话列表并同步当前聊天：当前会话对象未读已清零，置读必须按列表副本的 2 扣减
    window.dispatchEvent(new CustomEvent('coolapk-message-count-increased'));
    await flushPromises();
    await flushPromises();

    expect(store.messageCount).toBe(0);
  });

  it('发送文本消息不改变未读数：会话未读 2 条保留，全局角标不动', async () => {
    const store = serverMessage(2, 100);
    // 聊天记录加载失败：置读不发生，会话未读保留
    mocks.listChatHistory.mockRejectedValue(new Error('网络失败'));
    await mountMessagesPage();
    await flushPromises();

    const items = wrapper.findAll('.session-item');
    await items[0]!.trigger('click');
    await flushPromises();
    expect(mocks.readMessage).not.toHaveBeenCalled();
    expect(store.messageCount).toBe(2);
    expect(items[0]!.get('.session-unread-badge').text()).toBe('2');

    await typeText(wrapper, '你好');
    await wrapper.get('.input-actions button').trigger('click');
    await flushPromises();

    expect(mocks.sendPrivateMessage).toHaveBeenCalledWith('20002', '你好');
    // 发送不是阅读：角标与会话未读数都不变
    expect(mocks.readMessage).not.toHaveBeenCalled();
    expect(store.messageCount).toBe(2);
    expect(wrapper.findAll('.session-item')[0]!.get('.session-unread-badge').text()).toBe('2');
  });

  it('发送图片消息同样不改变未读数与全局角标', async () => {
    const store = serverMessage(2, 100);
    mocks.listChatHistory.mockRejectedValue(new Error('网络失败'));
    await mountMessagesPage();
    await flushPromises();

    const items = wrapper.findAll('.session-item');
    await items[0]!.trigger('click');
    await flushPromises();
    expect(store.messageCount).toBe(2);

    const input = wrapper.find('input[type="file"]');
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await flushPromises();

    expect(mocks.sendPrivateImage).toHaveBeenCalledWith('20002', '/message/2026/09/test_image.jpg');
    expect(mocks.readMessage).not.toHaveBeenCalled();
    expect(store.messageCount).toBe(2);
    expect(wrapper.findAll('.session-item')[0]!.get('.session-unread-badge').text()).toBe('2');
  });
});
