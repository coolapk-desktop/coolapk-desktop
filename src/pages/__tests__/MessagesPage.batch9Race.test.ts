
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { KeepAlive, defineComponent, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  query: { uid: '20002' } as Record<string, string>,
  listMessages: vi.fn(),
  listChatHistory: vi.fn(),
  sendPrivateMessage: vi.fn(),
  sendPrivateImage: vi.fn(),
  uploadImage: vi.fn(),
  readMessage: vi.fn(),
  deleteMessageChat: vi.fn(),
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
    deleteMessageChat: mocks.deleteMessageChat,
    getPublicUserProfile: mocks.getPublicUserProfile,
  },
}));

window.URL.createObjectURL = mocks.createObjectURL;
window.URL.revokeObjectURL = mocks.revokeObjectURL;

import MessagesPage from '../MessagesPage.vue';
import { useAuthStore } from '../../stores/auth';
import { useNotificationStore } from '../../stores/notifications';

const deferreds = vi.hoisted(() => ({ current: null as null | { promise: Promise<any>; resolve: (v: any) => void; reject: (e: any) => void } }));
function defer(): { promise: Promise<any>; resolve: (v: any) => void; reject: (e: any) => void } {
  let resolve!: (v: any) => void;
  let reject!: (e: any) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const sessionA = {
  ukey: '10001_20002',
  id: '10001_20002',
  uid: 20002,
  fromuid: 10001,
  entityId: 20002,
  messageUid: 20002,
  messageUsername: '好友酷友',
  username: '好友酷友',
  message: '你好',
  unreadNum: 2,
  dateline: 1700000000,
  isNewConversation: false,
};
const sessionB = {
  ukey: '10001_30003',
  id: '10001_30003',
  uid: 30003,
  fromuid: 10001,
  entityId: 30003,
  messageUid: 30003,
  messageUsername: '另一个酷友',
  username: '另一个酷友',
  message: '在吗',
  dateline: 1699999000,
  isNewConversation: false,
};

describe('MessagesPage 批次9：会话竞态与未读口径', () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    deferreds.current = null;
    const pinia = createPinia();
    setActivePinia(pinia);
    const authStore = useAuthStore(pinia);
    authStore.user = { uid: 10001, username: '测试用户' } as any;
    authStore.isLoggedIn = true;

    sessionStorage.removeItem('coolapk_message_sessions_10001');
    sessionStorage.removeItem('coolapk_message_sessions_pagination_10001');
    mocks.listMessages.mockResolvedValue({ data: [sessionA, sessionB] });
    mocks.listChatHistory.mockResolvedValue({ data: [] });
    mocks.uploadImage.mockResolvedValue({ data: '/message/2026/09/test_image.jpg' });
    mocks.sendPrivateImage.mockResolvedValue({ data: [{ id: 999, message_pic: '/message/2026/09/test_image.jpg' }] });
    mocks.sendPrivateMessage.mockResolvedValue({ data: [{ id: 1000, message: '测试文本' }] });
    mocks.readMessage.mockResolvedValue({ code: 200 });
    mocks.deleteMessageChat.mockResolvedValue({ code: 200 });
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
    // onActivated（绑定全局监听、加载会话）只在 KeepAlive 内触发，与真实路由挂载一致。
    const visible = ref(true);
    wrapper = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (visible.value ? h(MessagesPage) : h('div')) }),
    }), {
      attachTo: document.body,
      global: {
        stubs: {
          AppAvatar: true,
          AppImage: true,
          EmptyState: true,
          LoadingState: true,
          ErrorState: true,
        },
      },
    });
    await flushPromises();
    return wrapper;
  }

  async function pickFile(wrapper: any) {
    const input = wrapper.find('input[type="file"]');
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await flushPromises();
    return file;
  }

  it('未读为 2 的会话置读后，全局私信角标按 2 扣减', async () => {
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 1, message: 3, dateline: 100 } });
    expect(store.messageCount).toBe(3);
    await mountMessagesPage();
    await flushPromises();
    // 会话 A（unreadNum=2）加载成功并置读：3 - 2 = 1
    expect(store.messageCount).toBe(1);
    expect(mocks.readMessage).toHaveBeenCalledWith('10001_20002');
  });

  it('点击切换会话时按该会话实际未读数扣减，不再固定只减 1', async () => {
    mocks.query = {};
    const store = useNotificationStore();
    store.applyServerResponse({ data: { notification_v18: 1, message: 5, dateline: 200 } });
    expect(store.messageCount).toBe(5);

    const w = await mountMessagesPage();
    await flushPromises();
    const items = w.findAll('.session-item');
    expect(items.length).toBe(2);

    // 会话 A 的 unreadNum=2：置读后角标应减 2（旧实现只减 1，残留 1）
    await items[0]!.trigger('click');
    await flushPromises();

    expect(mocks.readMessage).toHaveBeenCalledWith('10001_20002');
    expect(store.messageCount).toBe(3);

    // 还原路由目标，后续用例依赖默认 uid=20002 自动打开会话 A。
    mocks.query = { uid: '20002' };
  });

  it('上传期间切换会话：不发送图片、不污染新会话摘要，图片退回待发送区', async () => {
    const w = await mountMessagesPage();
    // 首个请求挂起：此刻仍处于会话 A
    const d = defer();
    deferreds.current = d;
    mocks.uploadImage.mockReturnValue(d.promise);

    await pickFile(w);
    expect(mocks.uploadImage).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'image/png', 'message', '20002');

    // 上传挂起期间切换到会话 B
    const items = w.findAll('.session-item');
    expect(items.length).toBe(2);
    await items[1].trigger('click');
    await flushPromises();

    d.resolve({ data: '/message/2026/09/test_image.jpg' });
    await flushPromises();

    // 关键断言：目标会话仍是 20002，但已切换会话后不再发送，也不写 B 的摘要/气泡
    expect(mocks.sendPrivateImage).not.toHaveBeenCalled();
    expect(w.findAll('.session-item')[1].text()).not.toContain('[图片]');
    expect(w.findAll('.session-item')[0].text()).toContain('你好');
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('会话已切换'), 'error');
    // 图片退回待发送区，已上传地址可复用
    expect(w.findAll('.pending-image-card')).toHaveLength(1);
  });

  it('删除会话时递增请求序号：在途聊天记录响应不再触发置读', async () => {
    const d = defer();
    mocks.listChatHistory.mockReturnValue(d.promise);
    const w = await mountMessagesPage();
    await flushPromises();
    // 挂起的是会话 A 的 listChatHistory；此时删除会话 A
    expect(mocks.requestConfirmation).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent('coolapk-context-delete-message', { detail: { ukey: '10001_20002' } }));
    await flushPromises();
    expect(mocks.requestConfirmation).toHaveBeenCalled();
    expect(mocks.deleteMessageChat).toHaveBeenCalledWith('10001_20002');

    d.resolve({ data: [{ id: 1, fromuid: 20002, message: '迟到的消息', dateline: 1700000001 }] });
    await flushPromises();
    await new Promise((r) => setTimeout(r, 20));
    await flushPromises();

    // 序号已 bump：迟到的响应不能对已删除会话调用置读
    expect(mocks.readMessage).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith('聊天已删除', 'success');
    expect(w.findAll('.session-item').length).toBe(1);
  });
});
