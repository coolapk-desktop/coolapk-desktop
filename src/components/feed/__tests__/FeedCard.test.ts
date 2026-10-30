import { openDesktopFeedCommentsKey } from '../../../utils/desktopFeedComments';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import { feedPageVisibleKey } from '../../../utils/feedPageVisibility';

const mocks = vi.hoisted(() => ({
  setUserFeedTop: vi.fn(),
  requestConfirmation: vi.fn(),
  getFeedChangeHistory: vi.fn(),
  getHotReplies: vi.fn(),
  getFeedReplies: vi.fn(),
  getReplyDetail: vi.fn(),
  openUrl: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock('../../../router', () => ({
  router: { push: vi.fn(), resolve: vi.fn(() => ({ matched: [] })) },
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    setUserFeedTop: mocks.setUserFeedTop,
    getFeedChangeHistory: mocks.getFeedChangeHistory,
    getHotReplies: mocks.getHotReplies,
    getFeedReplies: mocks.getFeedReplies,
    getReplyDetail: mocks.getReplyDetail,
    openUrl: mocks.openUrl,
  },
}));

vi.mock('../../../utils/confirm', () => ({ requestConfirmation: mocks.requestConfirmation }));

import FeedCard from '../FeedCard.vue';
import { useAuthStore } from '../../../stores/auth';
import { useSettingsStore } from '../../../stores/settings';

describe('动态卡片编辑记录', () => {
  it.each(['cover', 'plugin'])('关闭背景开关后移除 %s 装饰，保留正文图片和作者头像入口', async type => {
    const feed = { id: '42', uid: '456', username: '作者', message: '正文', userCover: 'https://img.example/cover.jpg', ...(type === 'plugin' ? { feed_plugin_url: 'https://img.example/plugin.jpg' } : {}), picArr: ['https://img.example/content.jpg'] };
    const wrapper = mount(FeedCard, { props: { feed: feed as any }, global: { stubs: { AppImage: true, FeedImageGrid: true, FeedHeader: true, FeedContent: true, FeedActionBar: true, FeedCommentSection: true, FeedDyhShareDialog: true, FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, ForwardDialog: true } } });
    try {
      const selector = type === 'plugin' ? '.feed-plugin-decoration' : '.card-cover-backdrop';
      expect(wrapper.find(selector).exists()).toBe(true);
      useSettingsStore().settings.showFeedBackground = false;
      await nextTick();
      expect(wrapper.find(selector).exists()).toBe(false);
      expect(wrapper.classes()).not.toContain('has-user-cover');
      expect(wrapper.findComponent({ name: 'FeedHeader' }).props('feedPluginUrl')).toBe('');
      expect(wrapper.findComponent({ name: 'FeedHeader' }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: 'FeedImageGrid' }).exists()).toBe(true);
      useSettingsStore().settings.showFeedBackground = true;
      await nextTick();
      expect(wrapper.find(selector).exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });
  it.each([false, true])('点评详情走专用评分正文并保留公共交互（移动=%s）', officialMobileDetail => {
    const wrapper = mount(FeedCard, {
      props: { feed: { id: '42', uid: '456', username: 'Zeldq', message: '【点评】摘要', feedType: 'rating', rating_score: 10 } as any, detailMode: true, officialMobileDetail },
      global: { stubs: { OfficialRatingDetailBody: true, FeedHeader: true, FeedContent: true, FeedActionBar: true, FeedCommentSection: true, FeedDyhShareDialog: true, FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, ForwardDialog: true } },
    });
    expect(wrapper.find('official-rating-detail-body-stub').exists()).toBe(true);
    expect(wrapper.find('feed-content-stub').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'FeedHeader' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'FeedActionBar' }).exists()).toBe(true);
    wrapper.unmount();
  });
  it.each([
    [{ publishStatus: 1 }, true],
    [{ publish_status: '1' }, true],
    [{ publishStatus: 0, status: -1 }, false],
    [{ status: -1 }, false],
  ] as const)('将明确的可见范围 %j 传给动态头部', (visibility, expected) => {
    const wrapper = mount(FeedCard, {
      props: { feed: { id: '42', uid: '456', username: '作者', message: '正文', ...visibility } },
      global: { stubs: { FeedHeader: true, FeedContent: true, FeedActionBar: true, FeedCommentSection: true, FeedDyhShareDialog: true, FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, ForwardDialog: true } },
    });
    expect(wrapper.findComponent({ name: 'FeedHeader' }).props('selfOnly')).toBe(expected);
    wrapper.unmount();
  });
  it.each([false, true])('自己的动态菜单不受卡片高度或图片影响（图片=%s）', async (withImages) => {
    const auth = useAuthStore();
    auth.isLoggedIn = true;
    auth.user = { uid: '456', username: '作者' } as any;
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this as HTMLElement).classList.contains('more-menu')
        ? { top: 0, left: 0, right: 280, bottom: 500, width: 280, height: 500 } as DOMRect
        : { top: 600, left: 20, right: 500, bottom: 720, width: 480, height: 120 } as DOMRect;
    });
    const wrapper = mount(FeedCard, {
      attachTo: document.body,
      props: { feed: { id: '42', uid: '456', username: '作者', message: '正文', ...(withImages ? { pic: 'https://example.com/pic.jpg' } : {}) } },
      global: { stubs: { FeedHeader: { template: '<button class="test-more" @click="$emit(\'more\')">更多</button>' }, FeedContent: true, FeedImageGrid: true, FeedActionBar: true, FeedCommentSection: true, FeedDyhShareDialog: true, FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, ForwardDialog: true } },
    });
    try {
      await wrapper.get('.test-more').trigger('click');
      await nextTick();
      const menu = document.body.querySelector<HTMLElement>('.more-menu.is-floating')!;
      expect(menu).not.toBeNull();
      expect(menu.parentElement).toBe(document.body);
      expect(wrapper.get('.feed-card').element.contains(menu)).toBe(false);
      for (const label of ['删除动态', '重新编辑', '生成长图', '查看点赞用户', '查看转发列表']) expect(menu.textContent).toContain(label);
      expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8);
      expect(parseFloat(menu.style.top) + 500).toBeLessThanOrEqual(window.innerHeight - 8);
      menu.dispatchEvent(new Event('scroll'));
      await nextTick();
      expect(document.body.querySelector('.more-menu.is-floating')).not.toBeNull();
      window.dispatchEvent(new Event('scroll'));
      await nextTick();
      expect(document.body.querySelector('.more-menu.is-floating')).toBeNull();
    } finally { wrapper.unmount(); bounds.mockRestore(); }
  });
  it.each([false, true])('桌面与官方移动菜单均提供完整分享入口（移动=%s）', async (officialMobileDetail) => {
    setActivePinia(createPinia());
    const wrapper = mount(FeedCard, {
      props: { feed: { id: '42', uid: '456', username: '作者', message: '正文' }, detailMode: true, officialMobileDetail },
      global: { stubs: { teleport: true, FeedHeader: { template: '<button class="test-more" @click="$emit(\'more\')">更多</button>' }, FeedContent: true, FeedActionBar: true, FeedCommentSection: true, FeedDyhShareDialog: true, FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, ForwardDialog: true } },
    });
    await wrapper.find('.test-more').trigger('click');
    const menu = wrapper.find('.more-menu');
    for (const label of ['复制', '收藏', '举报', '动态', '私信', '看看号', '复制链接']) expect(menu.text()).toContain(label);
    expect(menu.text()).toContain(officialMobileDetail ? '生成分享图' : '生成长图');
    expect(menu.classes('is-floating')).toBe(!officialMobileDetail);
    if (officialMobileDetail) {
      expect(wrapper.findAll('.official-share-tools button')).toHaveLength(3);
      expect(wrapper.findAll('.official-share-destinations button')).toHaveLength(5);
      await wrapper.find('.official-share-cancel').trigger('click');
      expect(wrapper.find('.more-menu').exists()).toBe(false);
    }
    wrapper.unmount();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHotReplies.mockResolvedValue({ data: [] });
    mocks.getFeedReplies.mockResolvedValue({ data: [] });
    setActivePinia(createPinia());
  });

  it('把动态浏览量传给卡片头部', () => {
    const wrapper = mount(FeedCard, {
      props: { feed: { id: 'feed-with-views', uid: '456', username: '测试用户', message: '正文', readNum: 604000 } },
      global: { stubs: { FeedHeader: { props: ['readNum'], template: '<div class="stub-read-count" :data-read-num="String(readNum)"></div>' }, FeedContent: true, FeedImageGrid: true, FeedVideoCard: true, FeedActionBar: true, FeedCommentSection: true, ForwardDialog: true, FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, LoadingState: true } },
    });
    expect(wrapper.find('.stub-read-count').attributes('data-read-num')).toBe('604000');
    wrapper.unmount();
  });

  it('转发动态展示服务端返回的原动态内容', () => {
    const wrapper = mount(FeedCard, {
      props: { feed: { id: 'forward-1', uid: '456', username: '转发用户', message: '转发内容', forwardId: 'source-1', forwardSourceFeed: { id: 'source-1', entityType: 'feed', username: '原作者', message: '原动态内容' } } },
      global: { stubs: { FeedHeader: true, FeedContent: true, FeedImageGrid: true, FeedVideoCard: true, FeedActionBar: true, FeedCommentSection: true, ForwardDialog: true, FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, LoadingState: true } },
    });
    expect(wrapper.find('.quoted-feed-box').text()).toContain('原作者');
    expect(wrapper.find('.quoted-feed-box').text()).toContain('原动态内容');
    wrapper.unmount();
  });

  it('闲置动态显示并打开 APK 返回的闲鱼链接', async () => {
    const link = 'https://m.tb.cn/h.example?tk=test';
    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: 'secondhand-feed', uid: '456', username: '测试用户', message: '闲置商品', ershou_info: { link_source: '闲鱼', link_url: link } },
      },
      global: {
        plugins: [createPinia()],
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedVideoCard: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          FeedShareImageDialog: true,
          FeedInteractionListDialog: true,
          FeedCollectionPickerDialog: true,
          AppDialog: true,
          LoadingState: true,
        },
      },
    });

    expect(wrapper.find('.secondhand-link-card').text()).toContain('闲鱼链接');
    await wrapper.find('.secondhand-link-button').trigger('click');
    expect(mocks.openUrl).toHaveBeenCalledWith(link, 'internal');
    wrapper.unmount();
  });

  it('将生成长图放入头部的更多菜单', async () => {
    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: 'menu-feed', uid: '456', username: '测试用户', message: '动态正文' },
      },
      global: {
        stubs: {
          teleport: true,
          FeedHeader: {
            template: '<button class="stub-more" @click="$emit(\'more\')">更多</button>',
          },
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          FeedShareImageDialog: {
            props: ['show'],
            template: '<div class="stub-share-image-dialog" :data-open="String(show)"></div>',
          },
          FeedInteractionListDialog: true,
          FeedCollectionPickerDialog: true,
          AppDialog: true,
          LoadingState: true,
        },
      },
    });

    await wrapper.find('.stub-more').trigger('click');
    expect(wrapper.find('.more-menu').text()).toContain('生成长图');
    expect(wrapper.find('.more-menu').text()).toContain('查看点赞用户');
    expect(wrapper.find('.more-menu').text()).toContain('查看转发列表');

    await wrapper.find('.more-menu-item').trigger('click');
    expect(wrapper.find('.more-menu').exists()).toBe(false);
    expect(wrapper.find('.stub-share-image-dialog').attributes('data-open')).toBe('true');
  });

  it.each([true, false])('提问点评论直接进入回答列表，详情开关为 %s', async enabled => {
    const pinia = createPinia();
    useSettingsStore(pinia).settings.desktopCommentsOnRight = true;
    useSettingsStore(pinia).settings.desktopFeedDetailOnClick = enabled;
    const openRight = vi.fn(() => true);
    const wrapper = mount(FeedCard, {
      props: { feed: { id: '42', uid: '123', username: '提问者', feedType: 'question', questionId: '0', message: '问题正文' } },
      global: { plugins: [pinia], provide: { [openDesktopFeedCommentsKey as symbol]: openRight }, stubs: { FeedHeader: true, FeedContent: true, FeedImageGrid: true, FeedActionBar: true, FeedCommentSection: true, ForwardDialog: true, AppDialog: true } },
    });
    await wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-comment');
    await flushPromises();
    expect(mocks.routerPush).toHaveBeenLastCalledWith({ path: '/question/42', query: { scrollTo: 'answers' } });
    expect(openRight).not.toHaveBeenCalled();
    expect(wrapper.find('.inline-comment-wrapper').exists()).toBe(false);
    wrapper.unmount();
  });

  it('提问卡显示 APK 的回答/关注统计并沿用问答头部标识', async () => {
    const wrapper = mount(FeedCard, {
      props: {
        feed: {
          id: 'question-card',
          feedType: 'question',
          title: '问题标题',
          message: '问题正文',
          question_answer_num: 3,
          question_follow_num: 4,
        },
      },
      global: {
        plugins: [createPinia()],
        stubs: {
          FeedHeader: {
            props: ['questionMode'],
            template: '<div class="stub-feed-header" :data-question-mode="String(questionMode)"></div>',
          },
          FeedContent: true,
          FeedImageGrid: true,
          FeedVideoCard: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          FeedShareImageDialog: true,
          FeedInteractionListDialog: true,
          FeedCollectionPickerDialog: true,
          AppDialog: true,
          LoadingState: true,
        },
      },
    });

    expect(wrapper.find('.stub-feed-header').attributes('data-question-mode')).toBe('true');
    expect(wrapper.find('.question-stats').text()).toContain('3人回答');
    expect(wrapper.find('.question-stats').text()).toContain('4人关注');

    await wrapper.setProps({ feed: { id: 'answer-card', feedType: 'answer', title: '回答标题', message: '回答正文' } });
    expect(wrapper.find('.stub-feed-header').attributes('data-question-mode')).toBe('true');
    expect(wrapper.find('.question-stats').exists()).toBe(false);
    wrapper.unmount();
  });

  it('普通动态带父级 questionId 时仍打开评论，不跳转到问题详情', async () => {
    const wrapper = mount(FeedCard, {
      props: {
        feed: {
          id: 'normal-feed',
          entityType: 'feed',
          feedType: 'feed',
          questionId: 'parent-feed',
          uid: '456',
          username: '普通用户',
          message: '普通动态正文',
        },
        disableInlineComments: true,
      },
      global: {
        plugins: [createPinia()],
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedVideoCard: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          FeedShareImageDialog: true,
          FeedInteractionListDialog: true,
          FeedCollectionPickerDialog: true,
          AppDialog: true,
          LoadingState: true,
        },
      },
    });

    expect(wrapper.find('.feed-card').classes()).not.toContain('is-question-card');
    await wrapper.find('.feed-card').trigger('click');

    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(wrapper.emitted('open-comment')).toHaveLength(1);
    wrapper.unmount();
  });

  it('已编辑动态显示标识，点击后打开编辑记录', async () => {
    mocks.getFeedChangeHistory.mockResolvedValue({
      data: [
        { id: 'history-2', isHistory: 0, change_count: 1, dateline: 1_786_000_100, message: '修改后的正文' },
        { id: 'history-1', isHistory: 1, change_count: 0, dateline: 1_786_000_000, message: '原始正文' },
      ],
    });

    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: '123', uid: '456', username: '测试用户', message: '原正文', isModified: 1 },
      },
      global: {
        stubs: {
          FeedHeader: {
            props: ['isEdited'],
            template: '<button v-if="isEdited" class="stub-edited" @click="$emit(\'edit-history\')">已编辑</button>',
          },
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: {
            props: ['isOpen'],
            template: '<div v-if="isOpen" class="stub-dialog"><slot /></div>',
          },
        },
      },
    });

    expect(wrapper.find('.stub-edited').text()).toBe('已编辑');
    await wrapper.find('.stub-edited').trigger('click');
    await flushPromises();

    expect(mocks.getFeedChangeHistory).toHaveBeenCalledWith('123');
    expect(wrapper.find('.stub-dialog').text()).toContain('当前版本');
    expect(wrapper.find('.stub-dialog').text()).toContain('原始版本');
    expect(wrapper.find('.stub-dialog').text()).toContain('修改后的正文');
  });

  it('没有编辑字段的动态不显示已编辑入口', () => {
    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: '456', uid: '789', username: '测试用户', message: '未编辑正文' },
      },
      global: {
        stubs: {
          FeedHeader: {
            props: ['isEdited'],
            template: '<button v-if="isEdited" class="stub-edited">已编辑</button>',
          },
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          AppDialog: true,
        },
      },
    });

    expect(wrapper.find('.stub-edited').exists()).toBe(false);
    expect(mocks.getFeedChangeHistory).not.toHaveBeenCalled();
  });

  it.each(['广西', ''])('移动详情正文下方展示编辑状态（发布地=%s）', async (location) => {
    mocks.getFeedChangeHistory.mockResolvedValue({ data: [] });
    const wrapper = mount(FeedCard, {
      props: { officialMobileDetail: true, feed: { id: 'edited-mobile', uid: '123', message: '正文', ip_location: location, change_count: 1 } },
      global: { stubs: { FeedHeader: true, FeedContent: true, FeedImageGrid: true, FeedActionBar: true, FeedCommentSection: true, ForwardDialog: true, AppDialog: true } },
    });
    expect(wrapper.findComponent({ name: 'FeedHeader' }).props('showEditStatus')).toBe(false);
    expect(wrapper.get('.official-published-location').text()).toBe(location ? '发布于广西 · 已编辑' : '已编辑');
    await wrapper.get('.official-edited-status').trigger('click');
    await flushPromises();
    expect(mocks.getFeedChangeHistory).toHaveBeenCalledWith('edited-mobile');
    await wrapper.setProps({ feed: { id: 'edited-mobile', uid: '123', message: '正文', ip_location: location } });
    expect(wrapper.find('.official-edited-status').exists()).toBe(false);
    if (location) expect(wrapper.get('.official-published-location').text()).toBe('发布于广西');
    else expect(wrapper.find('.official-published-location').exists()).toBe(false);
    wrapper.unmount();
  });

  it('不把动态正文配图当作作者头像', () => {
    const wrapper = mount(FeedCard, {
      props: {
        feed: {
          id: 'avatar-feed',
          uid: '789',
          username: '测试用户',
          message: '带正文配图的动态',
          pic: 'https://image.coolapk.com/feed/content.jpg',
        },
      },
      global: {
        stubs: {
          FeedHeader: {
            props: ['avatar'],
            template: '<div class="stub-feed-header" :data-avatar="avatar"></div>',
          },
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          AppDialog: true,
        },
      },
    });

    expect(wrapper.find('.stub-feed-header').attributes('data-avatar')).toBeUndefined();
  });

  it('单动态详情页进入后自动展开并加载评论', async () => {
    mocks.getFeedReplies.mockResolvedValue({
      data: [{ id: 'reply-1', username: '评论用户', message: '评论内容' }],
    });

    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: '789', uid: '456', username: '测试用户', message: '动态正文', replynum: 1 },
        detailMode: true,
        autoOpenComments: true,
      },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: {
            props: ['comments', 'totalCommentCount'],
            template: '<div class="stub-comments">{{ comments.length }} / {{ totalCommentCount }}</div>',
          },
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: true,
        },
      },
    });
    await flushPromises();

    expect(mocks.getHotReplies).not.toHaveBeenCalled();
    expect(mocks.getFeedReplies).toHaveBeenCalledWith(
      '789',
      1,
      { listType: 'lastupdate_desc', fromFeedAuthor: 0 },
    );
    expect(wrapper.find('.stub-comments').text()).toBe('1 / 1');

    await wrapper.setProps({
      feed: { id: '789', uid: '456', username: '测试用户', message: '动态正文', replynum: 22 },
    });
    expect(wrapper.find('.stub-comments').text()).toBe('1 / 22');
  });

  it.each([false, true])('详情首屏操作栏不等待评论，移动底栏脱离动画容器（移动=%s）', async officialMobileDetail => {
    let resolveReplies!: (value: any) => void;
    mocks.getFeedReplies.mockReturnValue(new Promise(resolve => { resolveReplies = resolve; }));
    const pageVisible = ref(true);
    const host = document.createElement('div');
    host.style.transform = 'translateX(96px)';
    host.style.overflow = 'hidden';
    document.body.appendChild(host);
    const wrapper = mount(FeedCard, {
      attachTo: host,
      props: {
        feed: { id: 'first-frame', uid: '456', username: '作者', message: '正文', replynum: 1 },
        detailMode: true, officialMobileDetail, autoOpenComments: true,
      },
      global: {
        provide: { [feedPageVisibleKey as symbol]: pageVisible },
        stubs: {
          FeedHeader: true, FeedContent: true, FeedImageGrid: true,
          FeedActionBar: { template: '<div class="test-first-frame-actions">操作栏</div>' },
          FeedCommentSection: { props: ['comments'], template: '<div class="test-first-frame-comments">{{ comments.length }}</div>' },
          ForwardDialog: true, AppDialog: true, FeedDyhShareDialog: true,
          FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true,
        },
      },
    });
    try {
      await flushPromises();
      const actions = document.querySelector<HTMLElement>('.test-first-frame-actions')!;
      expect(actions).not.toBeNull();
      expect(actions.style.display).not.toBe('none');
      expect(host.contains(actions)).toBe(!officialMobileDetail);
      expect(wrapper.get('.test-first-frame-comments').text()).toBe('0');
      resolveReplies({ data: [{ id: 'reply-1', message: '评论内容' }] });
      await flushPromises();
      expect(wrapper.get('.test-first-frame-comments').text()).toBe('1');
      expect(document.querySelector('.test-first-frame-actions')).toBe(actions);
      if (officialMobileDetail) {
        pageVisible.value = false;
        await nextTick();
        expect(actions.style.display).toBe('none');
        pageVisible.value = true;
        await nextTick();
        expect(actions.style.display).not.toBe('none');
      }
    } finally {
      wrapper.unmount();
      host.remove();
    }
    expect(document.querySelector('.test-first-frame-actions')).toBeNull();
  });

  it('展开动态评论时自动读取后续分页', async () => {
    mocks.getFeedReplies.mockImplementation(async (_feedId: string, page: number) => ({
      data: Array.from({ length: page === 3 ? 5 : 10 }, (_, index) => ({
        id: `reply-${(page - 1) * 10 + index + 1}`,
        message: `第${page}页`,
      })),
    }));

    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: 'paged-feed', uid: '456', username: '测试用户', message: '动态正文', replynum: 25 },
        detailMode: true,
        autoOpenComments: true,
      },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: {
            props: ['comments', 'hasMoreComments', 'loadingMoreComments'],
            emits: ['load-more-comments'],
            template: '<div class="stub-comments"><span>{{ comments.length }}</span><button v-if="hasMoreComments && !loadingMoreComments" class="load-more" @click="$emit(\'load-more-comments\')">更多</button></div>',
          },
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: true,
        },
      },
    });
    await flushPromises();

    expect(mocks.getFeedReplies.mock.calls.map(([, page]) => page)).toEqual([1, 2]);
    expect(mocks.getFeedReplies).toHaveBeenCalledWith(
      'paged-feed',
      2,
      {
        listType: 'lastupdate_desc',
        fromFeedAuthor: 0,
        firstItem: 'reply-1',
        lastItem: 'reply-10',
      },
    );
    expect(mocks.getFeedReplies).not.toHaveBeenCalledWith('paged-feed', 3);
    expect(wrapper.find('.stub-comments span').text()).toBe('20');

    await wrapper.find('.load-more').trigger('click');
    await flushPromises();

    expect(mocks.getFeedReplies.mock.calls.map(([, page]) => page)).toEqual([1, 2, 3]);
    expect(mocks.getFeedReplies).toHaveBeenCalledWith(
      'paged-feed',
      3,
      {
        listType: 'lastupdate_desc',
        fromFeedAuthor: 0,
        firstItem: 'reply-1',
        lastItem: 'reply-20',
      },
    );
    expect(wrapper.find('.stub-comments span').text()).toBe('25');
  });

  it('少量评论只请求第一页，不为确认末页额外等待', async () => {
    mocks.getFeedReplies.mockResolvedValue({
      data: [
        { id: 'short-1', message: '评论一' },
        { id: 'short-2', message: '评论二' },
        { id: 'short-3', message: '评论三' },
      ],
    });

    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: 'short-feed', uid: '456', username: '测试用户', message: '动态正文', replynum: 3 },
        detailMode: true,
        autoOpenComments: true,
      },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: {
            props: ['comments'],
            template: '<div class="stub-comments">{{ comments.length }}</div>',
          },
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: true,
        },
      },
    });
    await flushPromises();

    expect(mocks.getFeedReplies.mock.calls.map(([, page]) => page)).toEqual([1]);
    expect(wrapper.find('.stub-comments').text()).toBe('3');
  });

  it('通知摘要阶段不请求评论，完整动态准备好后再加载', async () => {
    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: 'summary-id', username: '测试用户', message: '通知摘要' },
        detailMode: true,
        autoOpenComments: false,
      },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: true,
        },
      },
    });
    await flushPromises();
    expect(mocks.getHotReplies).not.toHaveBeenCalled();

    await wrapper.setProps({
      feed: { id: 'real-feed-id', username: '测试用户', message: '完整动态' },
      autoOpenComments: true,
    });
    await flushPromises();

    expect(mocks.getFeedReplies).toHaveBeenCalledWith(
      'real-feed-id',
      1,
      { listType: 'lastupdate_desc', fromFeedAuthor: 0 },
    );
    expect(mocks.getHotReplies).not.toHaveBeenCalledWith('summary-id', 1);
  });

  it('热门排序使用 replyList 的 popular 参数并去除重复项', async () => {
    mocks.getFeedReplies.mockResolvedValue({
      data: [
        { id: 'hot-1', username: '热门用户', message: '热门评论' },
        { id: 'normal-1', username: '普通用户', message: '普通评论' },
      ],
    });

    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: 'all-comments-feed', uid: '456', username: '动态作者', message: '动态正文', replynum: 2 },
        detailMode: true,
        autoOpenComments: true,
      },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: {
            props: ['comments'],
            emits: ['comment-sort-change'],
            template: '<div class="stub-comments"><button class="sort-hot" @click="$emit(\'comment-sort-change\', { mode: \'likes\', authorOnly: false })"></button>{{ comments.map(item => item.id).join(",") }}</div>',
          },
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: true,
        },
      },
    });
    await flushPromises();

    expect(mocks.getHotReplies).not.toHaveBeenCalled();
    expect(mocks.getFeedReplies).toHaveBeenCalledWith(
      'all-comments-feed',
      1,
      { listType: 'lastupdate_desc', fromFeedAuthor: 0 },
    );
    await wrapper.find('.sort-hot').trigger('click');
    await flushPromises();
    expect(mocks.getFeedReplies).toHaveBeenLastCalledWith(
      'all-comments-feed',
      1,
      { listType: 'popular', fromFeedAuthor: 0 },
    );
    expect(wrapper.find('.stub-comments').text()).toBe('hot-1,normal-1');
  });

  it('切换排序时重置分页并使用 APK 的默认、最新和楼主参数', async () => {
    mocks.getFeedReplies.mockImplementation(async (_feedId: string, page: number, options: { listType?: string; fromFeedAuthor?: number }) => ({
      data: Array.from({ length: 10 }, (_, index) => ({
        id: `${options.listType || 'author'}-${(page - 1) * 10 + index + 1}`,
        message: `第${page}页`,
      })),
    }));

    const wrapper = mount(FeedCard, {
      props: {
        feed: { id: 'sort-feed', uid: '456', username: '动态作者', message: '动态正文', replynum: 20 },
        detailMode: true,
        autoOpenComments: true,
      },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          FeedCommentSection: {
            props: ['comments', 'hasMoreComments', 'loadingMoreComments'],
            emits: ['comment-sort-change'],
            template: `
              <div class="stub-comments">
                <button class="sort-default" @click="$emit('comment-sort-change', { mode: 'default', authorOnly: false })">默认</button>
                <button class="sort-latest" @click="$emit('comment-sort-change', { mode: 'latest', authorOnly: false })">最新</button>
                <button class="sort-author" @click="$emit('comment-sort-change', { mode: 'default', authorOnly: true })">楼主</button>
                <span>{{ comments.length }}</span>
              </div>
            `,
          },
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: true,
        },
      },
    });
    await flushPromises();

    expect(mocks.getFeedReplies.mock.calls.slice(0, 2)).toEqual([
      ['sort-feed', 1, { listType: 'lastupdate_desc', fromFeedAuthor: 0 }],
      ['sort-feed', 2, {
        listType: 'lastupdate_desc',
        fromFeedAuthor: 0,
        firstItem: 'lastupdate_desc-1',
        lastItem: 'lastupdate_desc-10',
      }],
    ]);

    await wrapper.find('.sort-latest').trigger('click');
    await flushPromises();
    expect(mocks.getFeedReplies.mock.calls.slice(-2)).toEqual([
      ['sort-feed', 1, { listType: 'dateline_desc', fromFeedAuthor: 0 }],
      ['sort-feed', 2, {
        listType: 'dateline_desc',
        fromFeedAuthor: 0,
        firstItem: 'dateline_desc-1',
        lastItem: 'dateline_desc-10',
      }],
    ]);

    await wrapper.find('.sort-default').trigger('click');
    await flushPromises();
    expect(mocks.getFeedReplies.mock.calls.slice(-2)).toEqual([
      ['sort-feed', 1, { listType: 'lastupdate_desc', fromFeedAuthor: 0 }],
      ['sort-feed', 2, {
        listType: 'lastupdate_desc',
        fromFeedAuthor: 0,
        firstItem: 'lastupdate_desc-1',
        lastItem: 'lastupdate_desc-10',
      }],
    ]);

    await wrapper.find('.sort-author').trigger('click');
    await flushPromises();
    expect(mocks.getFeedReplies.mock.calls.slice(-2)).toEqual([
      ['sort-feed', 1, { listType: '', fromFeedAuthor: 1 }],
      ['sort-feed', 2, {
        listType: '',
        fromFeedAuthor: 1,
        firstItem: 'author-1',
        lastItem: 'author-10',
      }],
    ]);
  });
});

describe('动态关联和视频内容', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it('渲染多种关联标的并保留视频卡片入口', () => {
    const wrapper = mount(FeedCard, {
      props: {
        feed: {
          id: 'relation-feed',
          uid: '456',
          username: '测试用户',
          message: '视频动态正文',
          videoUrl: 'https://cdn.example.com/video.mp4',
          relationRows: [{ id: 1, title: '黑神话：悟空', entityType: 'game' }],
          extraRows: [{ id: 2, title: '小米 13 Pro', entityType: 'product' }],
          productRows: [{ id: 3, title: '蓝牙耳机', entityType: 'goods' }],
        },
      },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedVideoCard: {
            props: ['feed'],
            template: '<div v-if="feed.videoUrl" class="stub-video-card">视频</div>',
          },
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: true,
          FeedCollectionPickerDialog: true,
          AppImage: true,
        },
      },
    });

    expect(wrapper.findAll('.feed-target-chip')).toHaveLength(3);
    expect(wrapper.find('.stub-video-card').exists()).toBe(true);
  });
});

describe('评论区收起定位', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHotReplies.mockResolvedValue({ data: [] });
    mocks.getFeedReplies.mockResolvedValue({
      data: [{ id: 'comment-1', username: '评论用户', message: '评论内容' }],
    });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('当前动态被评论区挤出视口时，收起后回到当前动态而不是下一条', async () => {
    const host = document.createElement('div');
    host.className = 'feed-scroll-container';
    Object.defineProperties(host, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 5000 },
      scrollTop: { configurable: true, writable: true, value: 4500 },
    });
    document.body.appendChild(host);

    let collapsed = false;
    const makeRect = (top: number, bottom: number): DOMRect => ({
      x: 0,
      y: top,
      width: 800,
      height: bottom - top,
      top,
      right: 800,
      bottom,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      if (this.classList.contains('feed-scroll-container')) return makeRect(0, 600);
      if (this.classList.contains('feed-card')) return collapsed ? makeRect(-1200, -600) : makeRect(100, 500);
      return makeRect(0, 0);
    });

    const wrapper = mount(FeedCard, {
      attachTo: host,
      props: {
        feed: { id: 'collapse-feed', uid: '456', username: '动态作者', message: '动态正文' },
      },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          VoteCard: true,
          FeedImageGrid: true,
          FeedVideoCard: true,
          FeedActionBar: {
            template: '<button class="stub-open-comments" @click="$emit(\'open-comment\')">评论</button>',
          },
          FeedCommentSection: {
            props: ['comments'],
            template: '<div class="stub-comments">{{ comments.length }}</div>',
          },
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: true,
          AppImage: true,
          FeedCollectionPickerDialog: true,
        },
      },
    });

    await wrapper.find('.stub-open-comments').trigger('click');
    await flushPromises();
    window.dispatchEvent(new Event('scroll'));
    await nextTick();
    const collapseButton = document.body.querySelector<HTMLButtonElement>('.btn-floating-collapse');
    expect(collapseButton).not.toBeNull();

    collapsed = true;
    collapseButton?.click();
    await nextTick();
    await nextTick();

    expect(host.scrollTop).toBe(3300);
    expect(wrapper.find('.stub-comments').exists()).toBe(false);
    wrapper.unmount();
    host.remove();
  });

  it('切到其他栏目隐藏浮动按钮，返回时保留评论并恢复按钮', async () => {
    const pageVisible = ref(true), host = document.createElement('div');
    document.body.appendChild(host);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 100, left: 10, right: 300, top: 100, bottom: 500, width: 290, height: 400, toJSON: () => ({}) } as DOMRect);
    mocks.getFeedReplies.mockResolvedValue({ data: [{ id: 'reply-1', message: '评论' }] });
    const wrapper = mount(FeedCard, {
      attachTo: host,
      props: { feed: { id: 'visibility-feed', username: '作者', message: '正文' } },
      global: { provide: { [feedPageVisibleKey as symbol]: pageVisible }, stubs: {
        FeedHeader: true, FeedContent: true, FeedImageGrid: true, FeedVideoCard: true,
        FeedActionBar: { template: '<button class="open" @click="$emit(\'open-comment\')">评论</button>' },
        FeedCommentSection: { template: '<div class="comments-preserved"></div>' },
        ForwardDialog: true, AppDialog: true, LoadingState: true, FeedShareImageDialog: true,
        FeedInteractionListDialog: true, FeedCollectionPickerDialog: true,
      } },
    });
    await wrapper.find('.open').trigger('click'); await flushPromises(); window.dispatchEvent(new Event('scroll')); await flushPromises();
    expect(document.querySelector('.global-floating-comment-collapse')).not.toBeNull();
    pageVisible.value = false; await flushPromises(); window.dispatchEvent(new Event('scroll')); await flushPromises();
    expect(document.querySelector('.global-floating-comment-collapse')).toBeNull();
    expect(wrapper.find('.comments-preserved').exists()).toBe(true);
    pageVisible.value = true; await flushPromises();
    expect(document.querySelector('.global-floating-comment-collapse')).not.toBeNull();
    wrapper.unmount(); host.remove();
  });

  it('当卡片靠近屏幕右侧时悬浮收起评论按钮自动上移避让回到顶部按钮', async () => {
    const host = document.createElement('div');
    host.className = 'feed-scroll-container';
    document.body.appendChild(host);

    let cardRight = 980;
    const makeRect = (right: number): DOMRect => ({
      x: 0,
      y: 100,
      width: 780,
      height: 400,
      top: 100,
      right,
      bottom: 500,
      left: right - 780,
      toJSON: () => ({}),
    } as DOMRect);

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      if (this.classList.contains('feed-scroll-container')) return makeRect(1000);
      if (this.classList.contains('feed-card')) return makeRect(cardRight);
      return makeRect(0);
    });

    // 模拟窗口宽度 1000px，卡片右边缘在 980px（距离右边缘 20px，加上 24px 后 rightOffset = 44px < 96px）
    Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true });

    const wrapper = mount(FeedCard, {
      attachTo: host,
      props: {
        feed: { id: 'collapse-feed-avoid-overlap', uid: '456', username: '动态作者', message: '动态正文' },
      },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          VoteCard: true,
          FeedImageGrid: true,
          FeedVideoCard: true,
          FeedActionBar: {
            template: '<button class="stub-open-comments" @click="$emit(\'open-comment\')">评论</button>',
          },
          FeedCommentSection: {
            props: ['comments'],
            template: '<div class="stub-comments">{{ comments.length }}</div>',
          },
          ForwardDialog: true,
          LoadingState: true,
          AppDialog: true,
          AppImage: true,
          FeedCollectionPickerDialog: true,
        },
      },
    });

    await wrapper.find('.stub-open-comments').trigger('click');
    await flushPromises();
    window.dispatchEvent(new Event('scroll'));
    await nextTick();

    const floatingContainer = document.body.querySelector<HTMLElement>('.global-floating-comment-collapse');
    expect(floatingContainer).not.toBeNull();
    // 应该避让到 84px
    expect(floatingContainer?.style.bottom).toBe('84px');

    // 模拟窗口宽度变宽为 1400px，卡片右边缘在 1000px（距离右边缘 400px，rightOffset = 424px >= 96px）
    cardRight = 1000;
    Object.defineProperty(window, 'innerWidth', { value: 1400, writable: true, configurable: true });
    window.dispatchEvent(new Event('resize'));
    await nextTick();

    expect(floatingContainer?.style.bottom).toBe('32px');

    wrapper.unmount();
    host.remove();
  });
});

describe('桌面端点击动态的行为', () => {
  // 本 describe 在文件末尾，**不在**既有 describe 的 beforeEach 作用域内，
  // 必须自己把 API mock 备好 —— 否则 openComments() 会因 getFeedReplies
  // 返回 undefined 而走进 catch 分支。
  //
  // 文件更早的用例用 Object.defineProperty 改过 window.innerWidth 且未还原，
  // 布局判断依赖它，所以这里在 beforeEach 显式固定为宽窗口，并在 afterEach
  // 还原为文件加载时的原值，避免宽度污染本 describe 及其它用例。
  const originalInnerWidth = window.innerWidth;
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true, writable: true });
    vi.clearAllMocks();
    mocks.getHotReplies.mockResolvedValue({ data: [] });
    mocks.getFeedReplies.mockResolvedValue({ data: [] });
    setActivePinia(createPinia());
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true, writable: true });
  });

  const mountCard = async (desktopFeedDetailOnClick: boolean, openRightComments?: (feed: any) => boolean) => {
    useSettingsStore().settings.desktopFeedDetailOnClick = desktopFeedDetailOnClick;
    const wrapper = mount(FeedCard, {
      props: { feed: { id: '42', uid: '456', username: '作者', message: '正文' } },
      global: { provide: openRightComments ? { [openDesktopFeedCommentsKey as symbol]: openRightComments } : {}, stubs: { FeedHeader: true, FeedContent: true, FeedActionBar: true, FeedCommentSection: true, FeedDyhShareDialog: true, FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, ForwardDialog: true } },
    });
    await flushPromises();
    return wrapper;
  };

  it('默认（开关关）点击卡片就地展开评论，不跳详情页', async () => {
    const wrapper = await mountCard(false);
    await wrapper.find('article').trigger('click');
    await flushPromises();
    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(mocks.getFeedReplies).toHaveBeenCalled();
    expect(wrapper.find('.inline-comment-wrapper').exists()).toBe(true);
    wrapper.unmount();
  });

  it('开关开启时点击卡片跳转详情页', async () => {
    const wrapper = await mountCard(true);
    await wrapper.find('article').trigger('click');
    await flushPromises();
    expect(mocks.routerPush).toHaveBeenCalledWith({ path: '/feed/42', query: { scrollTo: 'top' } });
    wrapper.unmount();
  });

  it('开启详情入口时回复图标携带评论区落点', async () => {
    const wrapper = await mountCard(true);
    await wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-comment');
    await flushPromises();
    expect(mocks.routerPush).toHaveBeenCalledWith({ path: '/feed/42', query: { scrollTo: 'comments' } });
    wrapper.unmount();
  });

  it.each(['body', 'comment'])('我的回复点击 %s 使用所属动态 ID 并定位评论', async entry => {
    const wrapper = await mountCard(false);
    await wrapper.setProps({ replyMode: true, feed: { id: '222', feedId: '333', message: '我的回复', username: '作者' } as any });
    if (entry === 'body') await wrapper.get('article').trigger('click');
    else wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-comment');
    await flushPromises();
    expect(mocks.routerPush).toHaveBeenCalledWith({ path: '/feed/333', query: { replyId: '222' } });
    expect(mocks.getReplyDetail).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('我的回复缺少所属动态时读取评论详情，不把回复 ID 当成动态 ID', async () => {
    mocks.getReplyDetail.mockResolvedValue({ data: { id: '222', fid: '333', rid: '111', rrid: '111' } });
    const wrapper = await mountCard(true);
    await wrapper.setProps({ replyMode: true, feed: { id: '222', message: '我的回复' } as any });
    await wrapper.get('article').trigger('click');
    await flushPromises();
    expect(mocks.getReplyDetail).toHaveBeenCalledWith('222');
    expect(mocks.routerPush).toHaveBeenCalledWith({ path: '/feed/333', query: { replyId: '222' } });
    wrapper.unmount();
  });

  it('评论详情没有所属动态时不跳到错误帖子', async () => {
    mocks.getReplyDetail.mockResolvedValue({ data: { id: '222' } });
    const wrapper = await mountCard(true);
    await wrapper.setProps({ replyMode: true, feed: { id: '222', message: '我的回复' } as any });
    await wrapper.get('article').trigger('click');
    await flushPromises();
    expect(mocks.routerPush).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('关闭详情入口、开启右侧评论时，点击正文和评论按钮均交给侧栏', async () => {
    const openRight = vi.fn(() => true);
    useSettingsStore().settings.desktopCommentsOnRight = true;
    const wrapper = await mountCard(false, openRight);
    await wrapper.find('article').trigger('click');
    await wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-comment');
    await flushPromises();
    expect(openRight).toHaveBeenCalledTimes(2);
    expect(openRight).toHaveBeenCalledWith(expect.objectContaining({ id: '42' }));
    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(mocks.getFeedReplies).not.toHaveBeenCalled();
    expect(wrapper.find('.inline-comment-wrapper').exists()).toBe(false);
    wrapper.unmount();
  });

  it('右侧评论关闭时继续在当前卡片展开评论', async () => {
    const openRight = vi.fn(() => true);
    useSettingsStore().settings.desktopCommentsOnRight = false;
    const wrapper = await mountCard(false, openRight);
    await wrapper.find('article').trigger('click');
    await flushPromises();
    expect(openRight).not.toHaveBeenCalled();
    expect(wrapper.find('.inline-comment-wrapper').exists()).toBe(true);
    wrapper.unmount();
  });

  it('窄窗口 + 开关开启时不跳详情页，仍就地展开评论（开关只在桌面布局生效）', async () => {
    // 这条用例是「新开关只在桌面布局生效」的唯一防线：
    // 若 opensDetailOnClick 丢掉 !mobileLayout 守卫，这里必须红。
    // 官方样式动态详情默认开启，窄窗口下会走 mobileOfficialEnabled 分支，
    // 因此这里显式关掉它，把判断聚焦到新开关的布局守卫上。
    // 必须在 mount 之前设好宽度：useViewportWidth 在首个订阅者 mount 时
    // 才读取一次当前 innerWidth。
    useSettingsStore().settings.officialMobileFeedDetail = false;
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true, writable: true });
    const wrapper = await mountCard(true);
    // `viewportWidth` 是**模块级**状态，整个测试文件共享：若更早的用例留下了
    // 未卸载的订阅者，本次 mount 就不会重新读取 innerWidth，光靠「mount 前设宽度」
    // 会随用例顺序失效。补派发一次 resize 覆盖「已有订阅者」这条路径；
    // 订阅者已清空时这次派发是空操作（监听器未挂上），而那种情况下 mount 已经读过宽度。
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    await wrapper.find('article').trigger('click');
    await flushPromises();
    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(wrapper.find('.inline-comment-wrapper').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('互动列表外置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFeedReplies.mockResolvedValue({ data: [] });
    setActivePinia(createPinia());
  });

  it('默认（prop 未传）时点赞入口打开弹窗，不向上抛事件', async () => {
    const wrapper = mount(FeedCard, {
      props: { feed: { id: '42', uid: '456', username: '作者', message: '正文' } },
      global: { stubs: { FeedHeader: true, FeedContent: true, FeedCommentSection: true, FeedDyhShareDialog: true, FeedShareImageDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, ForwardDialog: true, FeedInteractionListDialog: true } },
    });
    await wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-like-list');
    await flushPromises();
    expect(wrapper.emitted('open-like-list')).toBeUndefined();
    wrapper.unmount();
  });

  it('externalInteractionLists 为 true 时向上抛事件，不开弹窗', async () => {
    const wrapper = mount(FeedCard, {
      props: { feed: { id: '42', uid: '456', username: '作者', message: '正文' }, externalInteractionLists: true },
      global: { stubs: { FeedHeader: true, FeedContent: true, FeedCommentSection: true, FeedDyhShareDialog: true, FeedShareImageDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, ForwardDialog: true } },
    });
    await wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-like-list');
    await wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-forward-list');
    await flushPromises();
    expect(wrapper.emitted('open-like-list')).toHaveLength(1);
    expect(wrapper.emitted('open-forward-list')).toHaveLength(1);
    wrapper.unmount();
  });
});


describe('个人主页动态置顶', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.isLoggedIn = true;
    auth.user = { uid: '456', username: '作者' } as any;
    mocks.requestConfirmation.mockResolvedValue(true);
    mocks.setUserFeedTop.mockResolvedValue({ code: 200 });
  });
  const stubs = { FeedHeader: { template: '<button class="pin-test-more" @click="$emit(\'more\')">更多</button>' }, FeedContent: true, FeedImageGrid: true, FeedActionBar: true, FeedCommentSection: true, FeedDyhShareDialog: true, FeedShareImageDialog: true, FeedInteractionListDialog: true, FeedCollectionPickerDialog: true, AppDialog: true, ForwardDialog: true };
  it.each([false, true])('置顶切换成功后更新标签并通知列表刷新，原置顶=%s', async pinned => {
    const feed = { id: '42', uid: '456', username: '作者', message: '正文', isStickTop: pinned ? 1 : 0 };
    const wrapper = mount(FeedCard, { props: { feed, profileUid: '456', officialMobileDetail: true }, global: { stubs } });
    try {
      await wrapper.get('.pin-test-more').trigger('click');
      const button = wrapper.findAll('.more-menu-item').find(item => item.text().trim() === (pinned ? '取消置顶' : '置顶'))!;
      await button.trigger('click'); await flushPromises();
      expect(mocks.setUserFeedTop).toHaveBeenCalledWith('456', '42', !pinned);
      expect(wrapper.find('.feed-pinned-label').exists()).toBe(!pinned);
      expect(wrapper.emitted('pin-changed')).toHaveLength(1);
    } finally { wrapper.unmount(); }
  });
  it.each(['cancel', 'failure'])('取消确认或接口失败不改变置顶状态：%s', async scenario => {
    if (scenario === 'cancel') mocks.requestConfirmation.mockResolvedValue(false);
    else mocks.setUserFeedTop.mockRejectedValue(new Error('请求失败'));
    const wrapper = mount(FeedCard, { props: { feed: { id: '42', uid: '456', message: '正文' }, profileUid: '456', officialMobileDetail: true }, global: { stubs } });
    try {
      await wrapper.get('.pin-test-more').trigger('click');
      await wrapper.findAll('.more-menu-item').find(item => item.text().trim() === '置顶')!.trigger('click'); await flushPromises();
      expect(wrapper.find('.feed-pinned-label').exists()).toBe(false);
      expect(wrapper.emitted('pin-changed')).toBeUndefined();
      if (scenario === 'cancel') expect(mocks.setUserFeedTop).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it('他人主页不提供个人置顶操作，仍显示官方置顶标签', async () => {
    const wrapper = mount(FeedCard, { props: { feed: { id: '42', uid: '123', message: '正文', isStickTop: '1' }, profileUid: '123', officialMobileDetail: true }, global: { stubs } });
    try {
      expect(wrapper.get('.feed-pinned-label').text()).toBe('置顶');
      await wrapper.get('.pin-test-more').trigger('click');
      expect(wrapper.findAll('.more-menu-item').some(item => /置顶/.test(item.text()))).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
