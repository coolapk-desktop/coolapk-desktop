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
  deleteMessageChat: vi.fn(),
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
vi.mock('../../utils/messageDrafts', () => ({
  saveMessageDraft: vi.fn(),
  loadMessageDraft: vi.fn(async () => ''),
  clearMessageDraft: vi.fn(),
}));

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

import MessagesPage from '../MessagesPage.vue';
import { useAuthStore } from '../../stores/auth';

function makeSession(i: number) {
  return {
    ukey: `10001_${20000 + i}`,
    id: `10001_${20000 + i}`,
    uid: 20000 + i,
    fromuid: 10001,
    entityId: 20000 + i,
    messageUid: 20000 + i,
    messageUsername: `酷友${i}`,
    username: `酷友${i}`,
    message: `历史消息${i}`,
    dateline: 1699999000 - i,
    isNewConversation: false,
  };
}

const sessionA = makeSession(2);

function defer(): { promise: Promise<any>; resolve: (v: any) => void } {
  let resolve!: (v: any) => void;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('MessagesPage 切号（uid 变化）：缓存清空 / 在途丢弃 / 待发图片清空', () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const pinia = createPinia();
    setActivePinia(pinia);
    const authStore = useAuthStore(pinia);
    authStore.user = { uid: 10001, username: '账号A' } as any;
    authStore.isLoggedIn = true;

    sessionStorage.removeItem('coolapk_message_sessions_10001');
    sessionStorage.removeItem('coolapk_message_sessions_pagination_10001');
    sessionStorage.removeItem('coolapk_message_sessions_10002');
    sessionStorage.removeItem('coolapk_message_sessions_pagination_10002');
    mocks.listMessages.mockResolvedValue({ data: [sessionA] });
    mocks.listChatHistory.mockResolvedValue({ data: [] });
    mocks.readMessage.mockResolvedValue({ code: 200 });
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

  function switchToAccountB() {
    const authStore = useAuthStore();
    authStore.user = { uid: 10002, username: '账号B' } as any;
    return authStore;
  }

  it('uid 变化后：旧会话缓存不再命中（重开会话前不显示旧消息），在途响应被丢弃', async () => {
    const firstHistory = defer();
    mocks.listChatHistory.mockReturnValueOnce(firstHistory.promise);

    const w = await mountMessagesPage();
    // 打开会话 A，聊天记录请求挂起（在途）
    await w.findAll('.session-item')[0]!.trigger('click');
    await flushPromises();
    expect(mocks.listChatHistory).toHaveBeenCalledTimes(1);

    // 切换账号 B：当前会话被重置、在途请求作废
    switchToAccountB();
    await flushPromises();
    // 会话面板重新加载（新账号重新拉取列表）
    expect(mocks.listMessages).toHaveBeenCalledTimes(2);
    // 当前会话已清空，聊天主区回到空态（不再渲染会话正文区）
    expect(w.find('.messages-main.empty-main').exists()).toBe(true);
    expect(w.find('.messages-main:not(.empty-main)').exists()).toBe(false);

    // 账号 A 的在途响应此时才返回：必须被丢弃，不得进入任何视图
    firstHistory.resolve({ data: [{ id: 9001, message: 'A账号的秘密', dateline: 1700000000, fromuid: 10001, uid: 20002 }] });
    await flushPromises();
    expect(w.text()).not.toContain('A账号的秘密');

    // B 账号重开同名会话 ukey：缓存已被清空，只能重新请求并显示 loading
    const secondHistory = defer();
    mocks.listChatHistory.mockReturnValueOnce(secondHistory.promise);
    await w.findAll('.session-item')[0]!.trigger('click');
    await flushPromises();
    expect(mocks.listChatHistory).toHaveBeenCalledTimes(2);
    // 缓存已清空：A 的历史消息不会在 B 的视图里提前出现
    expect(w.text()).not.toContain('A账号的秘密');
    secondHistory.resolve({ data: [{ id: 9002, message: 'B账号的消息', dateline: 1700000001, fromuid: 10002, uid: 20002 }] });
    await flushPromises();
    expect(w.text()).toContain('B账号的消息');
    expect(w.text()).not.toContain('A账号的秘密');
  });

  it('uid 变化后：待发图片队列被清空', async () => {
    const w = await mountMessagesPage();
    await w.findAll('.session-item')[0]!.trigger('click');
    await flushPromises();

    // 打开表情面板，通过收藏图片入口加入一张待发图片
    await w.find('.emoji-picker-container button').trigger('click');
    const { default: EmojiPanel } = await import('../../components/common/EmojiPanel.vue');
    const panel = w.findComponent(EmojiPanel);
    expect(panel.exists()).toBe(true);
    panel.vm.$emit('picture', { id: 'p1', url: '/message/pic1.jpg' });
    await flushPromises();
    expect(w.find('.pending-images-bar').exists()).toBe(true);
    expect(w.findAll('.pending-image-card').length).toBe(1);

    // 切号：待发图片必须清空，不能挂到 B 账号的会话里
    switchToAccountB();
    await flushPromises();
    expect(w.find('.pending-images-bar').exists()).toBe(false);
  });
});
