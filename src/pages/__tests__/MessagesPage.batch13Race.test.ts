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
  createObjectURL: vi.fn(() => 'blob:http://localhost/test-preview'),
  revokeObjectURL: vi.fn(),
  draftStore: new Map<string, string>(),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
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
  saveMessageDraft: async (uid: any, key: any, text: string) => {
    mocks.saveDraft(String(uid), String(key), text);
    if (text.trim()) mocks.draftStore.set(`${uid}:${key}`, text);
    else mocks.draftStore.delete(`${uid}:${key}`);
  },
  loadMessageDraft: async (uid: any, key: any) => mocks.draftStore.get(`${uid}:${key}`) || '',
  clearMessageDraft: async (uid: any, key: any) => {
    mocks.clearDraft(String(uid), String(key));
    mocks.draftStore.delete(`${uid}:${key}`);
  },
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

window.URL.createObjectURL = mocks.createObjectURL;
window.URL.revokeObjectURL = mocks.revokeObjectURL;

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

const sessionA = { ...makeSession(2) };
const sessionB = { ...makeSession(3) };

function defer(): { promise: Promise<any>; resolve: (v: any) => void } {
  let resolve!: (v: any) => void;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('MessagesPage 批次13：owner 快照 / 缓存上限 / 草稿提示', () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.draftStore.clear();
    const pinia = createPinia();
    setActivePinia(pinia);
    const authStore = useAuthStore(pinia);
    authStore.user = { uid: 10001, username: '测试用户' } as any;
    authStore.isLoggedIn = true;

    sessionStorage.removeItem('coolapk_message_sessions_10001');
    sessionStorage.removeItem('coolapk_message_sessions_pagination_10001');
    mocks.listMessages.mockResolvedValue({ data: [sessionA, sessionB] });
    mocks.listChatHistory.mockResolvedValue({ data: [] });
    mocks.sendPrivateMessage.mockResolvedValue({ data: [{ id: 1000, message: '竞态消息' }] });
    mocks.readMessage.mockResolvedValue({ code: 200 });
  });

  afterEach(async () => {
    vi.useRealTimers();
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

  async function typeText(w: any, text: string) {
    const editor = w.find('.message-rich-editor');
    editor.element.textContent = text;
    await editor.trigger('input');
  }

  it('发送期间切换会话（deferred）：B 无气泡、B 摘要未改写、A 摘要更新且 A 草稿被清除', async () => {
    mocks.query = { uid: '20002' };
    const d = defer();
    mocks.sendPrivateMessage.mockReturnValue(d.promise);
    const w = await mountMessagesPage();
    await typeText(w, '竞态消息');

    const sendBtn = w.find('.input-actions button');
    await sendBtn.trigger('click');
    expect(mocks.sendPrivateMessage).toHaveBeenCalledWith('20002', '竞态消息');

    // 挂起期间切到会话 B（同时触发 A 草稿 flush 落盘）
    const items = w.findAll('.session-item');
    await items[1]!.trigger('click');
    await flushPromises();
    expect(mocks.draftStore.get('10001:10001_20002')).toBe('竞态消息');

    d.resolve({ data: [{ id: 1000, message: '竞态消息' }] });
    await flushPromises();

    // B 的聊天区没有该气泡
    const bubbles = w.findAll('.message-item').map((n: any) => n.text());
    expect(bubbles.join('\n')).not.toContain('竞态消息');
    // B 的会话摘要未被改写
    const itemB = w.findAll('.session-item').find((n: any) => n.text().includes('酷友3'));
    expect(itemB!.text()).not.toContain('竞态消息');
    // A 的会话摘要被更新（写回 owner 快照）
    const itemA = w.findAll('.session-item').find((n: any) => n.text().includes('酷友2'));
    expect(itemA!.text()).toContain('竞态消息');
    // A 的持久化草稿被清除
    expect(mocks.clearDraft).toHaveBeenCalledWith('10001', '10001_20002');
    expect(mocks.draftStore.has('10001:10001_20002')).toBe(false);
    // 不出现误导性的“已发送”成功提示
    const toastCalls = mocks.showToast.mock.calls.map((c: any[]) => String(c[1] ?? ''));
    expect(toastCalls).not.toContain('success');
  });

  // 打开 22 个会话即可验证上限 20 的淘汰；用例在整包并发跑时 25 个会话会撞 5s 默认超时。
  it('会话历史缓存 LRU 上限 20：淘汰分页记录，当前会话受保护', async () => {
    const sessions = Array.from({ length: 22 }, (_, i) => makeSession(i));
    mocks.listMessages.mockResolvedValue({ data: sessions });
    mocks.listChatHistory.mockImplementation((ukey: string) =>
      Promise.resolve({
        data: [{ id: Number(ukey.split('_')[1]), message: 'msg', dateline: 1700000000, fromuid: 10001, uid: 1 }],
      }),
    );
    const w = await mountMessagesPage();
    const items = w.findAll('.session-item');
    expect(items.length).toBe(22);

    // 依次打开 22 个会话（超过缓存上限 20）
    for (let i = 0; i < 22; i += 1) {
      await items[i]!.trigger('click');
      await flushPromises();
    }
    mocks.listChatHistory.mockClear();

    // 重新打开第 1 个会话（最旧，应已被淘汰）：分页记录消失 → 请求不带最新游标
    const refreshed = w.findAll('.session-item');
    await refreshed[0]!.trigger('click');
    await flushPromises();
    const callK1 = mocks.listChatHistory.mock.calls.find((c: any[]) => c[0] === '10001_20000');
    expect(callK1).toBeTruthy();
    expect(callK1![3]).toBe('');

    // 最近打开的会话仍在缓存：请求带最新游标
    await refreshed[21]!.trigger('click');
    await flushPromises();
    const callKLast = mocks.listChatHistory.mock.calls.find((c: any[]) => c[0] === '10001_20021');
    expect(callKLast).toBeTruthy();
    expect(String(callKLast![3])).not.toBe('');
  }, 15000);

  it('草稿提示：输入首字符立即显示“保存中”，防抖落盘后才显示“已自动保存”', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = await mountMessagesPage();
    await typeText(w, 'x');
    expect(w.text()).not.toContain('草稿已自动保存');
    expect(w.text()).toContain('草稿保存中');

    await vi.advanceTimersByTimeAsync(400);
    await flushPromises();
    expect(w.text()).toContain('草稿已自动保存');
    expect(w.text()).not.toContain('草稿保存中');
  });
});
