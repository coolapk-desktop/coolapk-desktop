import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../../stores/auth';
import { useSettingsStore } from '../../../stores/settings';
import { shuzilmGuideState } from '../../../utils/shuzilmDeviceGuide';
import { clearRecentEmojis } from '../../../utils/recentEmojis';

const mocks = vi.hoisted(() => ({
  getReplyDetail: vi.fn(),
  getSubReplies: vi.fn(),
  replyFeed: vi.fn(),
  getDeviceInfo: vi.fn(),
  uploadImage: vi.fn(),
  logDiagnostic: vi.fn(),
  routerPush: vi.fn(),
}));
vi.mock('vue-router', async original => ({
  ...await original<typeof import('vue-router')>(),
  useRouter: () => ({ push: mocks.routerPush }),
}));
vi.mock('../../../utils/diagnosticLogger', async (original) => ({
  ...await original<typeof import('../../../utils/diagnosticLogger')>(),
  logDiagnostic: mocks.logDiagnostic,
}));
vi.mock('../../../utils/devicePresets', async (original) => ({
  ...await original<typeof import('../../../utils/devicePresets')>(),
  loadDevicePresets: async () => [{ id: '1', brand: 'Redmi', label: 'Redmi Note 13 Pro+', model: '23090RA98C', device: 'zircon' }],
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getReplyDetail: mocks.getReplyDetail,
    getSubReplies: mocks.getSubReplies,
    replyFeed: mocks.replyFeed,
    getDeviceInfo: mocks.getDeviceInfo,
    uploadImage: mocks.uploadImage,
  },
}));

import FeedCommentSection from '../FeedCommentSection.vue';

describe('评论完整信息展示', () => {
  it.each(['.comment-avatar', '.comment-username', '.sub-reply-avatar', '.sub-user'])('点击 %s 进入用户主页，不打开回复输入框', async selector => {
    const wrapper = mountSection({ uid: '123', replyRows: [{ id: 'sub-1', fromUid: '456', fromUserName: '楼中楼用户', message: '楼中楼正文' }] });
    try {
      await wrapper.get(selector).trigger('click');
      expect(mocks.routerPush).toHaveBeenCalledWith(selector.startsWith('.sub-') ? '/user/456' : '/user/123');
      expect(wrapper.find('.comment-reply-target-bar').exists()).toBe(false);
      expect(document.body.querySelector('.desktop-reply-composer')).toBeNull();
    } finally { wrapper.unmount(); }
  });

  it('没有用户标识时点击昵称不误触回复', async () => {
    const wrapper = mountSection({ uid: undefined, userId: undefined, userInfo: undefined });
    try {
      await wrapper.get('.comment-username').trigger('click');
      expect(mocks.routerPush).not.toHaveBeenCalled();
      expect(wrapper.find('.comment-reply-target-bar').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('目标同时出现在楼中楼和完整楼层时只保留小框，并定位到楼中楼', async () => {
    const target = { id: '222', feedId: '333', rid: '0', rrid: '0', message: '目标回复', username: '回复者' };
    mocks.getReplyDetail.mockResolvedValue({ data: target });
    const wrapper = mountSection({}, {
      feedId: '333', targetReplyId: '222', loading: true,
      comments: [{ id: '111', message: '父评论', replyRows: [target] }, target],
    });
    try {
      await flushPromises();
      expect(wrapper.findAll('.comment-row')).toHaveLength(2);
      expect(wrapper.findAll('.notification-comment-target')).toHaveLength(1);
      const highlight = wrapper.get('.notification-comment-target');
      expect(highlight.classes()).toContain('sub-reply-row');
      expect(highlight.attributes('data-context-comment-id')).toBe('222');
      expect(wrapper.find('.comment-row.notification-comment-target').exists()).toBe(false);
      const scroll = vi.fn();
      (highlight.element as HTMLElement).scrollIntoView = scroll;
      await wrapper.setProps({ loading: false });
      await flushPromises();
      expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    } finally { wrapper.unmount(); }
  });

  it('只有完整楼层目标时保留高亮，仍能定位一级评论', async () => {
    const target = { id: '222', feedId: '333', message: '目标评论' };
    mocks.getReplyDetail.mockResolvedValue({ data: target });
    const wrapper = mountSection({}, { feedId: '333', comments: [target], targetReplyId: '222' });
    try {
      await flushPromises();
      expect(wrapper.findAll('.notification-comment-target')).toHaveLength(1);
      expect(wrapper.get('.notification-comment-target').classes()).toContain('comment-row');
    } finally { wrapper.unmount(); }
  });

  it('通知目标不在第一页时补齐根楼层和回复并高亮', async () => {
    mocks.getReplyDetail.mockImplementation(async (id: string) => ({ data: id === '222'
      ? { id: '222', feedId: '333', rrid: '111', rid: '111', message: '通知目标回复', username: '回复者' }
      : { id: '111', feedId: '333', rid: '0', rrid: '0', message: '根评论', username: '评论者' } }));
    const wrapper = mountSection({}, { feedId: '333', comments: [], targetReplyId: '222' });
    await flushPromises();
    expect(wrapper.findAll('.comment-row')).toHaveLength(1);
    expect(wrapper.get('.comment-row').attributes('data-context-comment-id')).toBe('111');
    expect(wrapper.get('.notification-comment-target').attributes('data-context-comment-id')).toBe('222');
    expect(wrapper.get('.notification-comment-target').text()).toContain('通知目标回复');
    wrapper.unmount();
  });

  it('目标评论已删除时显示提示，原动态入口不请求目标评论', async () => {
    const wrapper = mountSection({}, { feedId: '333', targetReplyId: '222' });
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('这条评论不存在或已被删除');
    await wrapper.setProps({ targetReplyId: '' });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('.notification-comment-target').exists()).toBe(false);
    wrapper.unmount();
  });

  it('切换目标后忽略上一条评论的迟到响应', async () => {
    let finish!: (value: unknown) => void;
    mocks.getReplyDetail.mockImplementation((id: string) => id === '222'
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ data: { id, feedId: '333', message: '新目标评论' } }));
    const wrapper = mountSection({}, { feedId: '333', comments: [], targetReplyId: '222' });
    await wrapper.setProps({ targetReplyId: '444' });
    await flushPromises();
    finish({ data: { id: '222', feedId: '333', message: '旧目标评论' } });
    await flushPromises();
    expect(wrapper.get('.notification-comment-target').attributes('data-context-comment-id')).toBe('444');
    expect(wrapper.text()).not.toContain('旧目标评论');
    wrapper.unmount();
  });

  it('首屏已有目标回复时不会重复展示，并等首屏加载完成后定位', async () => {
    const reply = { id: '222', feedId: '333', rrid: '111', message: '目标回复' };
    const floor = { id: '111', feedId: '333', message: '根评论', replyRows: [reply] };
    mocks.getReplyDetail.mockImplementation(async (id: string) => ({ data: id === '222' ? reply : floor }));
    const wrapper = mountSection({}, { feedId: '333', comments: [floor], targetReplyId: '222', loading: true });
    await flushPromises();
    expect(wrapper.findAll('.sub-reply-row')).toHaveLength(1);
    const scroll = vi.fn();
    (wrapper.get('.notification-comment-target').element as HTMLElement).scrollIntoView = scroll;
    await flushPromises();
    expect(scroll).not.toHaveBeenCalled();
    await wrapper.setProps({ loading: false });
    await flushPromises();
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    wrapper.unmount();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearRecentEmojis();
    mocks.getReplyDetail.mockResolvedValue({ data: {} });
    mocks.getSubReplies.mockResolvedValue({ code: 200, data: [] });
    mocks.replyFeed.mockResolvedValue({ code: 200, message: 'ok' });
    mocks.getDeviceInfo.mockResolvedValue({ code: 200, data: { deviceId: '' } });
    mocks.uploadImage.mockResolvedValue({ code: 200, data: { url: 'https://image.coolapk.com/feed/test.jpg' } });
    setActivePinia(createPinia());
    shuzilmGuideState.visible = false;
  });

  function mountSection(commentOverrides: Record<string, any> = {}, extraProps: Record<string, any> = {}) {
    const timestamp = new Date(2026, 7, 9, 10, 20, 30).getTime() / 1000;
    return mount(FeedCommentSection, {
      props: {
        feedId: 'feed-1',
        comments: [{
          id: 'reply-1',
          username: '测试酷友',
          message: '带图片的评论',
          dateline: timestamp,
          device_title: '小米 17 Pro',
          floor: 12,
          ip_location: '广东深圳',
          userInfo: { level: 6, verify_title: '酷安认证用户' },
          picArr: ['/feed/a.jpg', '/feed/b.jpg'],
          ...commentOverrides,
        }],
        normalizeImg: (url: string) => url,
        formatRichText: (text: string) => text,
        ...extraProps,
      },
      global: {
        stubs: {
          AppAvatar: true,
          Button: {
            props: ['loading', 'disabled'],
            template: '<button class="stub-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          },
          FeedImageGrid: {
            props: ['images', 'variant'],
            template: '<div class="stub-comment-images">{{ variant }}:{{ images.length }}</div>',
          },
        },
      },
    });
  }

  it('官方接口排序模式保留返回顺序，隐藏本地排序且不受全局设置影响', async () => {
    const wrapper = mountSection({}, {
      preserveApiOrder: true,
      comments: [
        { id: 'old', message: '官方第一条', dateline: 100, likenum: 1 },
        { id: 'new', message: '官方第二条', dateline: 300, likenum: 99 },
        { id: 'middle', message: '官方第三条', dateline: 200, likenum: 50 },
      ],
    });
    expect(wrapper.find('.comment-sort').exists()).toBe(false);
    expect(wrapper.findAll('.comment-text').map(item => item.text())).toEqual(['官方第一条', '官方第二条', '官方第三条']);
    useSettingsStore().settings.commentDefaultSortMode = 'likes';
    await flushPromises();
    expect(wrapper.findAll('.comment-text').map(item => item.text())).toEqual(['官方第一条', '官方第二条', '官方第三条']);
    wrapper.unmount();
  });

  it('分栏共用排序按钮发出服务端筛选事件，不重排或过滤接口评论', async () => {
    const wrapper = mountSection({}, {
      preserveApiOrder: true,
      showSortControls: true,
      asideLayout: true,
      defaultSortMode: 'default',
      comments: [{ id: 'first', uid: 'other', message: '第一条', likenum: 1 }, { id: 'second', uid: 'author', message: '第二条', likenum: 99 }],
      feedUid: 'author',
    });
    await wrapper.findAll('.comment-sort-button')[2].trigger('click');
    expect(wrapper.emitted('comment-sort-change')?.[0]).toEqual([{ mode: 'likes', authorOnly: false }]);
    await wrapper.findAll('.comment-sort-button')[3].trigger('click');
    expect(wrapper.emitted('comment-sort-change')?.[1]).toEqual([{ mode: 'likes', authorOnly: true }]);
    expect(wrapper.findAll('.comment-text').map(item => item.text())).toEqual(['第一条', '第二条']);
    wrapper.unmount();
  });

  it('评论与楼中楼转换型号，悬停仍显示原始型号、系统和 Build', async () => {
    const wrapper = mountSection({
      device_title: 'Redmi 23090RA98C', deviceRom: 'Android 16 · HyperOS 3.0.305.0', deviceBuild: 'BP2A.250605.031.A3',
      replyRows: [{ id: 'sub-model', username: '楼中楼用户', message: '回复', deviceTitle: 'Redmi 23090RA98C', deviceRom: 'Android 15', deviceBuild: 'sub-build' }],
    });
    await flushPromises();
    const devices = wrapper.findAll('.comment-device');
    expect(devices).toHaveLength(2);
    expect(devices.every(device => device.text() === 'Redmi Note 13 Pro+')).toBe(true);
    expect(devices[0].attributes('title')).toBe('Redmi 23090RA98C · Android 16 · HyperOS 3.0.305.0 · BP2A.250605.031.A3');
    expect(devices[1].attributes('title')).toBe('Redmi 23090RA98C · Android 15 · sub-build');
    wrapper.unmount();
  });

  it('展示设备、认证、楼层、属地和评论图片', () => {
    const wrapper = mountSection();
    expect(wrapper.text()).toContain('LV6');
    expect(wrapper.text()).toContain('酷安认证用户');
    expect(wrapper.text()).toContain('小米 17 Pro');
    expect(wrapper.text()).toContain('#12楼');
    expect(wrapper.text()).toContain('广东深圳');
    expect(wrapper.find('.stub-comment-images').text()).toBe('comment:2');
  });

  it('评论图片已单独展示时移除正文中的图片占位文本', () => {
    const wrapper = mountSection({ message: '[图片]', picArr: ['/feed/animated.gif'] });
    expect(wrapper.find('.comment-text').text()).not.toContain('[图片]');
  });

  it('「继续下滑加载更多评论」提示可点，作为观察器失效时的手动兜底', async () => {
    const wrapper = mountSection({}, { hasMoreComments: true });

    const hint = wrapper.get('.comment-load-more-hint');
    expect(hint.element.tagName).toBe('BUTTON');

    await hint.trigger('click');
    expect(wrapper.emitted('load-more-comments')).toHaveLength(1);
  });

  it('楼主筛选只展示楼主评论且保留原始评论总数', async () => {
    const wrapper = mountSection({}, {
      feedUid: 'owner-1',
      feedUsername: '楼主',
      totalCommentCount: 2,
      comments: [
        { id: 'owner-comment', uid: 'owner-1', username: '楼主', message: '楼主评论' },
        {
          id: 'other-comment',
          uid: 'other-1',
          username: '其他用户',
          message: '其他评论',
          replyRows: [{ id: 'owner-sub-comment', uid: 'owner-1', username: '楼主', message: '楼主楼中楼回复' }],
        },
      ],
    });

    const authorOnlyButton = wrapper.findAll('.comment-sort-button').find(button => button.text() === '楼主');
    expect(authorOnlyButton).toBeDefined();
    expect(wrapper.findAll('.comment-row')).toHaveLength(2);
    await authorOnlyButton!.trigger('click');

    expect(wrapper.findAll('.comment-row')).toHaveLength(2);
    expect(wrapper.find('.comment-row').text()).toContain('楼主评论');
    expect(wrapper.find('.sub-reply-row').text()).toContain('楼主楼中楼回复');
    expect(wrapper.find('.author-filter-context-label').text()).toBe('上下文');
    expect(wrapper.find('.comment-title').text()).toBe('评论 2');
  });

  it('优先显示动态接口返回的评论总数', () => {
    const wrapper = mountSection();
    expect(wrapper.find('.comment-title').text()).toBe('评论 1');

    wrapper.unmount();
    const withTotal = mount(FeedCommentSection, {
      props: {
        feedId: 'feed-1',
        totalCommentCount: 22,
        comments: [{ id: 'reply-1', username: '测试酷友', message: '评论内容' }],
      },
      global: { stubs: { AppAvatar: true, Button: true, FeedImageGrid: true } },
    });
    expect(withTotal.find('.comment-title').text()).toBe('评论 22');
  });

  it('没有评论总数时回退到已加载评论数量', () => {
    const wrapper = mountSection();
    expect(wrapper.find('.comment-title').text()).toBe('评论 1');
  });

  it('评论区初始排序固定为默认', () => {
    const wrapper = mountSection({}, {
      comments: [
        { id: 'old', username: '旧评论', message: '旧', dateline: 100 },
        { id: 'new', username: '新评论', message: '新', dateline: 200 },
      ],
    });
    const active = wrapper.find('.comment-sort-button.is-active');
    expect(active.text()).toBe('默认');
    expect(wrapper.findAll('.comment-row').map(row => row.text())).toEqual([
      expect.stringContaining('旧评论'),
      expect.stringContaining('新评论'),
    ]);
  });

  it('未指定设置时默认评论排序为默认并保留接口顺序', () => {
    const wrapper = mountSection({}, {
      comments: [
        { id: 'c1', username: '评论1', message: '少赞', likenum: 1 },
        { id: 'c2', username: '评论2', message: '多赞', likenum: 99 },
      ],
    });
    const active = wrapper.find('.comment-sort-button.is-active');
    expect(active.text()).toBe('默认');
    expect(wrapper.findAll('.comment-row').map(row => row.text())).toEqual([
      expect.stringContaining('评论1'),
      expect.stringContaining('评论2'),
    ]);
  });

  it('直接展示 APK 内嵌的全部楼中楼，不因前端截断成两条', () => {
    const wrapper = mountSection({
      id: 'floor-embedded',
      replyRows: [1, 2, 3, 4, 5].map(index => ({
        id: `embedded-${index}`,
        username: `内嵌回复${index}`,
        message: `内嵌内容${index}`,
      })),
      replyRowsCount: 5,
      replynum: 5,
    });

    expect(wrapper.findAll('.sub-reply-row')).toHaveLength(5);
    expect(mocks.getSubReplies).not.toHaveBeenCalled();
  });

  it('展开楼中楼会按 APK replyList 分页补齐全部回复', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      id: `remote-${index + 1}`,
      username: `远程回复${index + 1}`,
      message: `远程内容${index + 1}`,
    }));
    const secondPage = Array.from({ length: 3 }, (_, index) => ({
      id: `remote-${index + 21}`,
      username: `远程回复${index + 21}`,
      message: `远程内容${index + 21}`,
    }));
    mocks.getSubReplies
      .mockResolvedValueOnce({ code: 200, data: firstPage })
      .mockResolvedValueOnce({ code: 200, data: secondPage });

    const wrapper = mountSection({
      id: 'floor-1',
      username: '一级评论',
      message: '一级评论内容',
      replyRows: [
        { id: 'embedded-1', username: '内嵌回复1', message: '内嵌内容1' },
        { id: 'embedded-2', username: '内嵌回复2', message: '内嵌内容2' },
      ],
      replyRowsCount: 2,
      replyRowsMore: 1,
      replynum: 25,
    });

    expect(wrapper.text()).toContain('展开剩下的 23 条回复');
    expect(wrapper.findAll('.sub-reply-row')).toHaveLength(2);

    await wrapper.get('.sub-more-btn').trigger('click');
    await flushPromises();

    expect(mocks.getSubReplies).toHaveBeenNthCalledWith(
      1,
      'feed-1',
      'floor-1',
      1,
      { lastItem: '' },
    );
    expect(wrapper.findAll('.sub-reply-row')).toHaveLength(22);
    expect(wrapper.text()).toContain('加载更多楼中楼');

    const loadMoreButton = wrapper
      .findAll('.sub-more-btn')
      .find((button) => button.text().includes('加载更多楼中楼'));
    expect(loadMoreButton).toBeDefined();
    await loadMoreButton!.trigger('click');
    await flushPromises();

    expect(mocks.getSubReplies).toHaveBeenNthCalledWith(
      2,
      'feed-1',
      'floor-1',
      2,
      { lastItem: 'remote-20' },
    );
    expect(wrapper.findAll('.sub-reply-row')).toHaveLength(25);
    expect(wrapper.text()).not.toContain('加载更多楼中楼');
    expect(wrapper.text()).toContain('远程内容23');
  });

  it.each([false, true])('officialDetail=%s 时展开和翻页沿用完整接口顺序，不把预览置顶或按时间重排', async officialDetail => {
    const reply = (id: number) => ({ id: String(id), username: `酷友${id}`, message: `内容${id}`, dateline: id * 100 });
    mocks.getSubReplies
      .mockResolvedValueOnce({ data: [reply(2), reply(1)] })
      .mockResolvedValueOnce({ data: [reply(3), reply(4)] });
    const wrapper = mountSection({
      id: 'floor-order', replyRows: [reply(3), reply(1)], replynum: 4, replyRowsMore: 1,
    }, { officialDetail, defaultSortMode: 'latest' });
    const order = () => wrapper.findAll('.sub-reply-row .sub-user').map(row => row.text());
    try {
      expect(order()).toEqual(['酷友3', '酷友1']);
      await wrapper.get('.sub-more-btn').trigger('click');
      await flushPromises();
      expect(order()).toEqual(['酷友2', '酷友1', '酷友3']);
      const more = wrapper.findAll('.sub-more-btn').find(button => button.text().includes('加载更多楼中楼'));
      await more!.trigger('click');
      await flushPromises();
      expect(mocks.getSubReplies).toHaveBeenLastCalledWith('feed-1', 'floor-order', 2, { lastItem: '1' });
      expect(order()).toEqual(['酷友2', '酷友1', '酷友3', '酷友4']);
    } finally { wrapper.unmount(); }
  });

  it.each([false, true])('officialDetail=%s 时按 APK 显示楼主和我，不添加层主标记', async officialDetail => {
    const auth = useAuthStore();
    auth.isLoggedIn = true;
    auth.user = { uid: '123', username: '本人' } as any;
    const wrapper = mountSection({ uid: '123', replyRows: [
      { id: 'self', fromUid: '123', fromUserName: '本人', message: '自己的回复', isFeedAuthor: '0' },
      { id: 'author', uid: '999', username: '作者', message: '楼主回复', isFeedAuthor: 1 },
      { id: 'other', userInfo: { uid: '456' }, username: '作者', message: '其他酷友', isAuthor: '0' },
    ] }, { officialDetail, feedUid: '999', feedUsername: '作者' });
    try {
      expect(wrapper.get('.comment-meta .badge-identity').text()).toBe('我');
      const rows = wrapper.findAll('.sub-reply-row');
      expect(rows[0]!.get('.badge-identity').text()).toBe('我');
      expect(rows[1]!.get('.badge-author').text()).toBe('楼主');
      expect(rows[1]!.find('.badge-identity').exists()).toBe(false);
      expect(rows[2]!.find('.badge-author').exists()).toBe(false);
      expect(rows[2]!.find('.badge-identity').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('层主');
      auth.isLoggedIn = false;
      await flushPromises();
      expect(wrapper.find('.badge-identity').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('本人是楼主时沿用 APK 的身份优先级，只显示楼主', () => {
    const auth = useAuthStore();
    auth.isLoggedIn = true;
    auth.user = { uid: '999', username: '本人' } as any;
    const wrapper = mountSection({ uid: '999', replyRows: [
      { id: 'self-author', userInfo: { uid: '999' }, username: '本人', message: '回复' },
    ] }, { feedUid: '999' });
    try {
      expect(wrapper.findAll('.badge-author')).toHaveLength(2);
      expect(wrapper.find('.badge-identity').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('楼中楼分页返回重复数据时停止继续请求，不反复卡在加载状态', async () => {
    mocks.getSubReplies.mockResolvedValue({
      code: 200,
      data: [{ id: 'embedded-1', username: '内嵌回复1', message: '内嵌内容1' }],
    });
    const wrapper = mountSection({
      id: 'floor-duplicate',
      replyRows: [
        { id: 'embedded-1', username: '内嵌回复1', message: '内嵌内容1' },
        { id: 'embedded-2', username: '内嵌回复2', message: '内嵌内容2' },
      ],
      replyRowsCount: 2,
      replyRowsMore: 1,
      replynum: 10,
    });

    await wrapper.get('.sub-more-btn').trigger('click');
    await flushPromises();

    expect(mocks.getSubReplies).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('.sub-reply-row')).toHaveLength(2);
    expect(wrapper.text()).not.toContain('加载更多楼中楼');
    expect(wrapper.text()).not.toContain('加载楼中楼...');
  });

  it('点击评论时间可在相对时间和完整时间之间切换', async () => {
    const wrapper = mountSection();
    const timeButton = wrapper.get('.comment-time-button');
    expect(timeButton.text()).not.toContain('2026-08-09 10:20:30');
    await timeButton.trigger('click');
    expect(timeButton.text()).toContain('2026-08-09 10:20:30');
    await timeButton.trigger('click');
    expect(timeButton.text()).not.toContain('2026-08-09 10:20:30');
  });

  it('后台补取评论详情并显示接口返回的真实设备', async () => {
    mocks.getReplyDetail.mockResolvedValue({
      data: { deviceTitle: '小米 17 Ultra', deviceRom: 'HyperOS' },
    });
    const wrapper = mountSection();
    await flushPromises();
    expect(mocks.getReplyDetail).toHaveBeenCalledWith('reply-1');
    expect(wrapper.text()).toContain('小米 17 Ultra');
  });

  it('长评论的查看更多读取评论详情并在原位显示完整正文', async () => {
    mocks.getReplyDetail.mockResolvedValue({ data: { message: '完整的长评论正文' } });
    const wrapper = mountSection({ id: '610688345', message: '摘要…<a href="/feed/610688345">查看更多</a>' });
    await wrapper.get('.comment-text a').trigger('click');
    await flushPromises();
    expect(mocks.getReplyDetail).toHaveBeenCalledWith('610688345');
    expect(mocks.logDiagnostic).toHaveBeenCalledWith('info', 'comment', 'expand_requested', 'feed_id=feed-1 reply_id=610688345');
    expect(wrapper.get('.comment-text').text()).toBe('完整的长评论正文');
    expect(wrapper.get('.comment-text').text()).not.toContain('查看更多');
    wrapper.unmount();
  });

  it('楼中楼长回复的查看更多也在当前评论区展开', async () => {
    mocks.getReplyDetail.mockImplementation(async (id: string) => ({ data: { message: id === 'sub-1' ? '楼中楼完整正文' : '' } }));
    const wrapper = mountSection({ replyRows: [{ id: 'sub-1', username: '回复用户', message: '摘要…<a href="/feed/sub-1">查看更多</a>' }] });
    await wrapper.get('.sub-reply-text a').trigger('click');
    await flushPromises();
    expect(mocks.getReplyDetail).toHaveBeenCalledWith('sub-1');
    expect(wrapper.get('.sub-reply-text').text()).toBe('楼中楼完整正文');
    wrapper.unmount();
  });

  it('外层阻止冒泡时仍能点击输入框关闭表情，选择表情和按钮切换正常', async () => {
    const wrapper = mountSection();
    const host = document.createElement('div');
    const stopBubbling = vi.fn((event: Event) => event.stopPropagation());
    host.addEventListener('click', stopBubbling);
    document.body.appendChild(host);
    host.appendChild(wrapper.element);
    try {
      const toggle = wrapper.get('[aria-label="插入表情"]');
      await toggle.trigger('click');
      expect(wrapper.find('.emoji-picker-popover').exists()).toBe(true);
      await wrapper.get('.emoji-item-btn').trigger('click');
      expect(wrapper.find('.emoji-picker-popover').exists()).toBe(true);
      await toggle.trigger('click');
      expect(wrapper.find('.emoji-picker-popover').exists()).toBe(false);
      await toggle.trigger('click');
      await wrapper.get('.comment-rich-editor').trigger('click');
      expect(stopBubbling).toHaveBeenCalled();
      expect(wrapper.find('.emoji-picker-popover').exists()).toBe(false);
    } finally { wrapper.unmount(); host.remove(); }
  });

  it('点击图片按钮先关闭表情，即使文件选择被取消也保持关闭', async () => {
    const wrapper = mountSection();
    const file = wrapper.get('input[type="file"]').element as HTMLInputElement;
    const select = vi.spyOn(file, 'click').mockImplementation(() => {});
    try {
      await wrapper.get('[aria-label="插入表情"]').trigger('click');
      expect(wrapper.find('.emoji-picker-popover').exists()).toBe(true);
      await wrapper.get('[aria-label="添加图片"]').trigger('click');
      expect(select).toHaveBeenCalledOnce();
      expect(wrapper.find('.emoji-picker-popover').exists()).toBe(false);
    } finally { select.mockRestore(); wrapper.unmount(); }
  });

  it('系统 Emoji 插入真实字符，收藏表情加入配图而不是伪造表情代码', async () => {
    const wrapper = mountSection({}, { feedId: 'emoji-contract-feed' });
    try {
      await flushPromises();
      await wrapper.get('[aria-label="插入表情"]').trigger('click');
      await wrapper.get('[role="tab"][aria-label="系统 Emoji"]').trigger('click');
      await wrapper.get('.emoji-item-btn').trigger('click');
      expect((wrapper.get('.comment-textarea').element as any).value).toBe('😀');
      expect(wrapper.find('.comment-textarea img').exists()).toBe(false);
      const panel = wrapper.findComponent({ name: 'EmojiPanel' });
      const picture = { id: '1', url: 'https://image.coolapk.com/favorite1.gif' };
      panel.vm.$emit('picture', picture);
      await vi.waitFor(() => expect(wrapper.find('.comment-media-thumb').exists()).toBe(true));
      expect(wrapper.find('.emoji-picker-popover').exists()).toBe(true);
      panel.vm.$emit('picture', picture);
      await flushPromises();
      expect(wrapper.findAll('.comment-media-thumb')).toHaveLength(1);
      panel.vm.$emit('picture', { id: '2', url: 'https://image.coolapk.com/favorite2.gif' });
      await vi.waitFor(() => expect(wrapper.findAll('.comment-media-thumb')).toHaveLength(2));
      expect(wrapper.find('.emoji-picker-popover').exists()).toBe(true);
      expect((wrapper.get('.comment-textarea').element as any).value).toBe('😀');
    } finally { wrapper.unmount(); }
  });

  it('支持表情面板展开与表情插入，并支持最近使用与移除顶部栏', async () => {
    const wrapper = mountSection();
    expect(wrapper.find('.emoji-picker-popover').exists()).toBe(false);

    // 点击表情按钮
    const emojiBtn = wrapper.findAll('.composer-tool-btn').find(btn => btn.text().includes('表情'));
    expect(emojiBtn).toBeDefined();
    await emojiBtn!.trigger('click');

    expect(wrapper.find('.emoji-picker-popover').exists()).toBe(true);
    // 顶部条已去除（参考微信设计）
    expect(wrapper.find('.emoji-picker-header').exists()).toBe(false);
    expect(wrapper.find('.emoji-section-title').text()).toBe('酷安表情');

    // 点击某一个表情
    const firstEmoji = wrapper.find('.emoji-item-btn');
    expect(firstEmoji.exists()).toBe(true);
    await firstEmoji.trigger('click');

    const textarea = wrapper.find<HTMLTextAreaElement>('.comment-textarea');
    expect(textarea.element.value).toMatch(/^\[.+\]$/);

    // 最近使用独立分类，选择后可切换查看。
    await wrapper.get('[role="tab"][aria-label="最近使用"]').trigger('click');
    const titles = wrapper.findAll('.emoji-section-title').map(t => t.text());
    expect(titles).toContain('最近使用');
    expect(wrapper.find('.emoji-grid-recent').exists()).toBe(true);
    wrapper.unmount();
  });

  it('点击回复酷友时显示回复目标栏且支持一键取消', async () => {
    const wrapper = mountSection();
    expect(wrapper.find('.comment-reply-target-bar').exists()).toBe(false);

    const replyBtn = wrapper.find('.comment-reply-btn');
    await replyBtn.trigger('click');

    const composer = new DOMWrapper(document.body.querySelector('.desktop-reply-composer')!);
    expect(composer.find('.comment-reply-target-bar').exists()).toBe(true);
    expect(composer.find('.reply-target-name').text()).toBe('@测试酷友');

    // 点击取消回复
    await composer.find('.reply-target-clear-btn').trigger('click');
    expect(wrapper.find('.comment-reply-target-bar').exists()).toBe(false);
    expect(document.body.querySelector('.desktop-reply-composer')).toBeNull();
    wrapper.unmount();
  });

  it.each([true, false])('回复深层楼中楼时不滚动聚焦、不刷新主列表，并保留原楼层：接口返回正文 %s', async returnsReply => {
    const auth = useAuthStore(); auth.isLoggedIn = true; auth.user = { uid: 12345, username: '发布者' } as any;
    useSettingsStore().settings.deviceFingerprint.deviceId = 'DU-MOCK-SAMPLE-DEVICE-ID-12345';
    const reply = { id: 'new-sub', username: '发布者', message: '新回复', rid: 'reply-1' };
    mocks.replyFeed.mockResolvedValue({ code: 200, data: returnsReply ? reply : undefined });
    mocks.getSubReplies.mockResolvedValue({ data: [reply] });
    const wrapper = mountSection({ replyRows: [{ id: 'old-sub', username: '原回复者', message: '原楼中楼' }] });
    const editor = wrapper.get('.comment-rich-editor').element as HTMLElement;
    const focus = vi.spyOn(editor, 'focus');
    wrapper.element.scrollTop = 3000;
    await wrapper.get('.sub-reply-row').trigger('click');
    await flushPromises();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(wrapper.element.scrollTop).toBe(3000);
    const composer = new DOMWrapper(document.body.querySelector('.desktop-reply-composer')!);
    const floatingEditor = composer.get('.comment-rich-editor');
    floatingEditor.element.textContent = '新回复';
    await floatingEditor.trigger('input');
    await composer.get('.stub-button').trigger('click');
    await flushPromises();
    expect(mocks.replyFeed).toHaveBeenCalledWith('feed-1', '新回复', 'old-sub', undefined);
    expect(wrapper.emitted('retry-comments')).toBeUndefined();
    expect(wrapper.text()).toContain('原楼中楼');
    expect(wrapper.text()).toContain('新回复');
    expect(wrapper.element.scrollTop).toBe(3000);
    if (returnsReply) expect(mocks.getSubReplies).not.toHaveBeenCalled();
    else expect(mocks.getSubReplies).toHaveBeenCalledWith('feed-1', 'reply-1', 1, { lastItem: '' });
    expect(document.body.querySelector('.desktop-reply-composer')).toBeNull();
    focus.mockRestore();
    wrapper.unmount();
  });

  it('登录状态下成功提交评论并触发 replyFeed', async () => {
    const authStore = useAuthStore();
    authStore.user = { uid: 12345, username: '发布者' } as any;
    authStore.isLoggedIn = true;

    const settingsStore = useSettingsStore();
    settingsStore.settings.deviceFingerprint.deviceId = 'DU-MOCK-SAMPLE-DEVICE-ID-12345';
    settingsStore.settings.deviceFingerprint.ddid = 'DU-MOCK-DDI-SESSION-12345';

    const wrapper = mountSection();
    const editor = wrapper.find('.comment-textarea');
    editor.element.textContent = '这是一条测试评论内容';
    await editor.trigger('input');

    const submitBtn = wrapper.find('.stub-button');
    await submitBtn.trigger('click');
    await flushPromises();

    expect(mocks.replyFeed).toHaveBeenCalledWith('feed-1', '这是一条测试评论内容', undefined, undefined);
    expect(wrapper.emitted('send-comment')?.[0]).toEqual(['这是一条测试评论内容']);
  });

  it.each([false, true])('收藏图片评论复用已有 URL，仅上传混入的本地图片：%s', async (includeLocal) => {
    const auth = useAuthStore(); auth.isLoggedIn = true; auth.user = { uid: 12345, username: '发布者' } as any;
    const settings = useSettingsStore();
    settings.settings.deviceFingerprint.deviceId = 'DU-MOCK-SAMPLE-DEVICE-ID-12345';
    settings.settings.deviceFingerprint.ddid = 'DU-MOCK-DDI-SESSION-12345';
    settings.settings.publishDeviceSignature = false;
    const wrapper = mountSection({}, { feedId: 'picture-only-feed' }); await flushPromises();
    await wrapper.get('[aria-label="插入表情"]').trigger('click');
    wrapper.findComponent({ name: 'EmojiPanel' }).vm.$emit('picture', { id: '1', url: 'https://image.coolapk.com/favorite.gif' });
    await vi.waitFor(() => expect(wrapper.find('.comment-media-thumb').exists()).toBe(true));
    if (includeLocal) {
      const file = new File(['PNG'], 'local.png', { type: 'image/png' });
      Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([80, 78, 71]).buffer });
      const input = wrapper.get('input[type="file"]');
      Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
      await input.trigger('change');
      await vi.waitFor(() => expect(wrapper.findAll('.comment-media-thumb')).toHaveLength(2));
    }
    await wrapper.get('.stub-button').trigger('click'); await flushPromises();
    expect(mocks.replyFeed).toHaveBeenCalledWith('picture-only-feed', '[图片]', undefined, `https://image.coolapk.com/favorite.gif${includeLocal ? ',https://image.coolapk.com/feed/test.jpg' : ''}`);
    expect(mocks.uploadImage).toHaveBeenCalledTimes(includeLocal ? 1 : 0);
    wrapper.unmount();
  });

  it('未配置设备 ID 时提交评论会唤起设置弹窗', async () => {
    const authStore = useAuthStore();
    authStore.user = { uid: 12345, username: '发布者' } as any;
    authStore.isLoggedIn = true;

    const settingsStore = useSettingsStore();
    settingsStore.settings.deviceFingerprint.deviceId = '';
    settingsStore.settings.deviceFingerprint.ddid = '';

    const wrapper = mountSection();
    const editor = wrapper.find('.comment-textarea');
    editor.element.textContent = '这是一条测试评论内容';
    await editor.trigger('input');

    const submitBtn = wrapper.find('.stub-button');
    await submitBtn.trigger('click');
    await flushPromises();

    // 未配置时拦截 replyFeed 并唤起 shuzilmGuideState
    expect(mocks.replyFeed).not.toHaveBeenCalled();
    expect(shuzilmGuideState.visible).toBe(true);
    expect(shuzilmGuideState.reason).toBe('missing_id');
  });

  it('手动配置为空但当前账号已有生成设备 ID 时直接提交评论', async () => {
    const authStore = useAuthStore();
    authStore.user = { uid: 12345, username: '发布者' } as any;
    authStore.isLoggedIn = true;

    const settingsStore = useSettingsStore();
    settingsStore.settings.deviceFingerprint.deviceId = '';
    mocks.getDeviceInfo.mockResolvedValue({ code: 200, data: { deviceId: 'DU-MOCK-GENERATED-ACCOUNT-ID', deviceIdSource: 'generated_account' } });

    const wrapper = mountSection();
    const editor = wrapper.find('.comment-textarea');
    editor.element.textContent = '使用账号已保存的设备 ID 评论';
    await editor.trigger('input');
    await wrapper.find('.stub-button').trigger('click');
    await flushPromises();

    expect(mocks.getDeviceInfo).toHaveBeenCalled();
    expect(mocks.replyFeed).toHaveBeenCalledWith('feed-1', '使用账号已保存的设备 ID 评论', undefined, undefined);
    expect(shuzilmGuideState.visible).toBe(false);
    wrapper.unmount();
  });
  it('官方详情的表情面板放在编辑框内部，点击面板不会被外部点击处理关闭', async () => {
    const auth = useAuthStore(); auth.isLoggedIn = true; auth.user = { uid: 12345, username: '发布者' } as any;
    const wrapper = mountSection({}, { officialDetail: true, feedId: 'mobile-emoji-feed' });
    await (wrapper.vm as any).openComposer();
    const layer = document.body.querySelector('.official-composer-layer')!;
    await new DOMWrapper(layer.querySelector('[aria-label="插入表情"]')!).trigger('click');
    const panel = layer.querySelector('.official-composer-emoji')!;
    expect(panel.parentElement?.classList.contains('comment-composer-box')).toBe(true);
    expect(layer.querySelector('.emoji-picker-popover')).toBeNull();
    const systemTab = panel.querySelector('[aria-label="系统 Emoji"]')!;
    systemTab.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flushPromises();
    expect(layer.querySelector('.official-composer-emoji')).not.toBeNull();
    wrapper.unmount();
  });

  it('官方详情初始隐藏编辑框，底部唤起后关闭再打开保留草稿', async () => {
    const dim = vi.spyOn(useSettingsStore(), 'setAndroidSystemBarDimmed');
    const auth = useAuthStore(); auth.isLoggedIn = true; auth.user = { uid: 12345, username: '发布者' } as any;
    const wrapper = mountSection({}, { officialDetail: true });
    expect(wrapper.find('.comment-composer-box').exists()).toBe(false);
    expect(wrapper.find('.comment-toolbar-collapse-btn').exists()).toBe(false);
    expect(wrapper.find('.comment-title').text()).toContain('回复');
    await (wrapper.vm as any).openComposer();
    expect(dim).toHaveBeenLastCalledWith(expect.any(Symbol), true);
    const layer = document.body.querySelector('.official-composer-layer')!;
    expect(layer.parentElement).toBe(document.body);
    expect(wrapper.find('.comment-composer-box').exists()).toBe(false);
    expect(layer.querySelector('.official-composer-backdrop')).not.toBeNull();
    const editor = new DOMWrapper(layer.querySelector('.comment-rich-editor')!);
    (editor.element as HTMLElement).textContent = '未发送的评论'; await editor.trigger('input');
    await new DOMWrapper(layer.querySelector('.official-composer-close')!).trigger('click');
    expect(dim).toHaveBeenLastCalledWith(expect.any(Symbol), false);
    expect(document.body.querySelector('.official-composer-layer')).toBeNull();
    await (wrapper.vm as any).openComposer();
    expect(document.body.querySelector('.official-composer-layer .comment-rich-editor')?.textContent).toBe('未发送的评论');
    await new DOMWrapper(document.body.querySelector('.official-composer-backdrop')!).trigger('click');
    expect(document.body.querySelector('.official-composer-layer')).toBeNull();
    await (wrapper.vm as any).openComposer();
    expect(dim).toHaveBeenLastCalledWith(expect.any(Symbol), true);
    wrapper.unmount();
    expect(dim).toHaveBeenLastCalledWith(expect.any(Symbol), false);
  });

  it('hideCollapseButton 抑制收起评论按钮与 Esc 的 collapse，默认行为不变', async () => {
    const visible = mountSection();
    expect(visible.find('.comment-toolbar-collapse-btn').exists()).toBe(true);
    await visible.find('.comment-textarea').trigger('keydown', { key: 'Escape' });
    expect(visible.emitted('collapse')).toHaveLength(1);
    visible.unmount();

    const hidden = mountSection({}, { hideCollapseButton: true });
    expect(hidden.find('.comment-toolbar-collapse-btn').exists()).toBe(false);
    await hidden.find('.comment-textarea').trigger('keydown', { key: 'Escape' });
    expect(hidden.emitted('collapse')).toBeUndefined();
    hidden.unmount();
  });

});
