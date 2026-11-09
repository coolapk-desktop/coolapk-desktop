import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { nextTick, ref } from 'vue';
import { useSettingsStore } from '../../../stores/settings';
import { useAuthStore } from '../../../stores/auth';
import { feedPageVisibleKey } from '../../../utils/feedPageVisibility';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return { ...actual, useRouter: () => ({ push: navigation.push }) };
});

const favorites = vi.hoisted(() => ({ setFeedCloudFavorite: vi.fn(), updateFeedCloudCollections: vi.fn(), getFeedCollectionOptions: vi.fn() }));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getFeedReplies: vi.fn().mockResolvedValue({ data: [] }),
    setFeedCloudFavorite: favorites.setFeedCloudFavorite,
    updateFeedCloudCollections: favorites.updateFeedCloudCollections,
    getFeedCollectionOptions: favorites.getFeedCollectionOptions,
  },
}));

import QuestionAnswerCard from '../QuestionAnswerCard.vue';
import FeedCommentSection from '../../feed/FeedCommentSection.vue';

describe('问答回答卡', () => {
  it('移动回答详情使用官方评论布局，输入框由底栏打开', async () => {
    const pinia = createPinia();
    const auth = useAuthStore(pinia); auth.isLoggedIn = true;
    const pageVisible = ref(true);
    const wrapper = mount(QuestionAnswerCard, {
      props: { answer: { id: 'answer-42', message: '回答正文', feedType: 'answer', replynum: 0 }, detailMode: true, officialMobileDetail: true, autoOpenComments: true },
      global: { plugins: [pinia], provide: { [feedPageVisibleKey as symbol]: pageVisible }, stubs: { FeedHeader: true, FeedContent: true, FeedActionBar: true, ForwardDialog: true } },
    });
    try {
      await nextTick();
      expect(wrapper.findComponent(FeedCommentSection).props('officialDetail')).toBe(true);
      expect(wrapper.get('.comment-title').text()).toBe('共 0 回复');
      expect(wrapper.find('.comment-toolbar-collapse-btn').exists()).toBe(false);
      expect(wrapper.find('.inline-composer-layer').exists()).toBe(false);
      expect(document.querySelector('.official-composer-layer')).toBeNull();
      const actions = wrapper.findComponent({ name: 'FeedActionBar' });
      expect(actions.props('officialDetail')).toBe(true);
      expect(wrapper.element.contains(actions.element)).toBe(false);
      pageVisible.value = false; await nextTick();
      expect((actions.element as HTMLElement).style.display).toBe('none');
      pageVisible.value = true; await nextTick();
      expect((actions.element as HTMLElement).style.display).not.toBe('none');
      actions.vm.$emit('write-comment');
      await nextTick(); await nextTick();
      expect(document.querySelector('.official-composer-layer .comment-textarea')).not.toBeNull();
    } finally { wrapper.unmount(); }
  });
  it.each([390, 1280])('宽度 %s 的回答正文和评论入口保持对应导航方式', async width => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
    const pinia = createPinia();
    useSettingsStore(pinia).settings.officialMobileFeedDetail = true;
    const wrapper = mount(QuestionAnswerCard, {
      props: { answer: { id: 'answer-42', message: '回答正文', feedType: 'answer' }, questionId: 'question-2' },
      global: { plugins: [pinia], stubs: { FeedHeader: true, FeedContent: true, FeedActionBar: true, FeedCommentSection: true, ForwardDialog: true } },
    });
    try {
      await nextTick(); navigation.push.mockClear();
      await wrapper.get('article').trigger('click');
      expect(navigation.push).toHaveBeenLastCalledWith('/question/question-2');
      navigation.push.mockClear();
      wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-comment');
      await nextTick();
      if (width === 390) {
        expect(navigation.push).toHaveBeenLastCalledWith({ path: '/feed/answer-42', query: { scrollTo: 'comments' } });
        expect(wrapper.find('.answer-comments-wrapper').exists()).toBe(false);
      } else {
        expect(navigation.push).not.toHaveBeenCalled();
        expect(wrapper.find('.answer-comments-wrapper').exists()).toBe(true);
      }
      await wrapper.setProps({ detailMode: true }); navigation.push.mockClear();
      wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-comment');
      await nextTick();
      expect(navigation.push).not.toHaveBeenCalled();
      await wrapper.setProps({ detailMode: false, navigateToQuestion: false }); navigation.push.mockClear();
      await wrapper.get('article').trigger('click');
      expect(navigation.push).toHaveBeenLastCalledWith('/feed/answer-42');
    } finally { wrapper.unmount(); window.innerWidth = previousWidth; window.dispatchEvent(new Event('resize')); }
  });
  it('回答详情在正文下方显示已编辑，列表在头部显示', async () => {
    const wrapper = mount(QuestionAnswerCard, {
      props: { answer: { id: 'edited-answer', message: '回答正文', is_modified: 1 }, detailMode: true },
      global: { plugins: [createPinia()], stubs: { FeedHeader: true, FeedContent: true, FeedImageGrid: true, FeedActionBar: true, FeedCommentSection: true, ForwardDialog: true } },
    });
    expect(wrapper.get('.answer-publish-meta').text()).toBe('已编辑');
    expect(wrapper.findComponent({ name: 'FeedHeader' }).props('isEdited')).toBe(false);
    await wrapper.setProps({ detailMode: false });
    expect(wrapper.find('.answer-publish-meta').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'FeedHeader' }).props('isEdited')).toBe(true);
    wrapper.unmount();
  });
  it('问题详情中的回答不重复显示问题上下文和回答标题', () => {
    const wrapper = mount(QuestionAnswerCard, {
      props: {
        answer: {
          id: 'answer-43',
          username: '回答用户',
          title: '小米17Pro还是findx9pro?',
          message: '看你对背屏有没有需要',
          feedType: 'answer',
        },
        questionId: 'question-2',
        questionTitle: '小米17Pro还是findx9pro?',
        navigateToQuestion: false,
        showAnswerHeading: false,
      },
      global: {
        plugins: [createPinia()],
        stubs: {
          FeedHeader: { template: '<div class="stub-header"><slot name="actions" /></div>' },
          FeedContent: true,
          FeedVideoCard: true,
          FeedImageGrid: true,
          VoteCard: true,
          AppImage: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          FeedInteractionListDialog: true,
          FeedCollectionPickerDialog: true,
        },
      },
    });

    expect(wrapper.find('.answer-question-context').exists()).toBe(false);
    expect(wrapper.find('.answer-title-row').exists()).toBe(false);
  });

  it('显示 APK 风格的回答标识，并把关联内容留给问题主体', () => {
    const wrapper = mount(QuestionAnswerCard, {
      props: {
        answer: {
          id: 'answer-42',
          username: '回答用户',
          title: '回答标题',
          message: '这是回答正文',
          feedType: 'answer',
          replynum: 3,
          targetRow: { entityType: 'product', id: '9988', title: 'realme Book 增强版' },
        },
        questionId: 'question-1',
        questionTitle: '这个电脑能外接显卡吗？',
      },
      global: {
        plugins: [createPinia()],
        stubs: {
          FeedHeader: { template: '<div class="stub-header"><slot name="actions" /></div>' },
          FeedContent: true,
          FeedVideoCard: true,
          FeedImageGrid: true,
          VoteCard: true,
          AppImage: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          FeedInteractionListDialog: true,
          FeedCollectionPickerDialog: true,
        },
      },
    });

    expect(wrapper.find('.question-answer-card').exists()).toBe(true);
    expect(wrapper.find('.feed-card').exists()).toBe(false);
    expect(wrapper.find('.answer-question-badge').exists()).toBe(false);
    expect(wrapper.find('.answer-kind-badge').text()).toContain('回答');
    expect(wrapper.find('.answer-question-context').text()).toContain('这个电脑能外接显卡吗？');
    expect(wrapper.find('.question-related-card').exists()).toBe(true);
    expect(wrapper.find('.answer-reply-summary').exists()).toBe(false);
  });

  it('显式传入 showReplySummary 时展示回复统计与排序栏', () => {
    const wrapper = mount(QuestionAnswerCard, {
      props: {
        answer: { id: 'answer-45', username: '回答用户', message: '回答正文', replynum: 3, feedType: 'answer' },
        showReplySummary: true,
      },
      global: {
        plugins: [createPinia()],
        stubs: {
          FeedHeader: { template: '<div class="stub-header"><slot name="actions" /></div>' },
          FeedContent: true,
          FeedVideoCard: true,
          FeedImageGrid: true,
          VoteCard: true,
          AppImage: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          FeedInteractionListDialog: true,
          FeedCollectionPickerDialog: true,
        },
      },
    });

    expect(wrapper.find('.answer-reply-summary').exists()).toBe(true);
    expect(wrapper.findAll('.answer-reply-sort-tab').map((item) => item.text())).toEqual(['默认', '最新', '热门', '楼主']);
  });

  it('取消收藏与收藏夹收藏后都回写同一份回答实体', async () => {
    favorites.setFeedCloudFavorite.mockResolvedValue({ code: 200 });
    favorites.updateFeedCloudCollections.mockResolvedValue({ code: 200 });
    favorites.getFeedCollectionOptions.mockResolvedValue([{ id: 'c1', title: '默认收藏夹', isBeCollected: 0 }]);
    const pinia = createPinia();
    useAuthStore(pinia).isLoggedIn = true;
    // 问题页/首页列表传下来的就是这份 answer 对象。
    const answer: any = { id: 'answer-45', message: '回答正文', feedType: 'answer', favnum: 2, userAction: { collect: 1 } };
    const wrapper = mount(QuestionAnswerCard, {
      props: { answer },
      global: {
        plugins: [pinia],
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedVideoCard: true,
          FeedImageGrid: true,
          VoteCard: true,
          AppImage: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          FeedInteractionListDialog: true,
          FeedCollectionPickerDialog: true,
        },
      },
    });
    try {
      const actions = wrapper.findComponent({ name: 'FeedActionBar' });

      actions.vm.$emit('toggle-fav');
      await flushPromises();
      expect(favorites.setFeedCloudFavorite).toHaveBeenCalledWith('answer-45', false, 'answer', '');
      expect(answer.userAction.collect).toBe(0);
      expect(answer.favnum).toBe(1);

      // 再次点击走收藏夹面板，确认选择后收藏态与计数一起回写。
      actions.vm.$emit('toggle-fav');
      await flushPromises();
      expect(favorites.getFeedCollectionOptions).toHaveBeenCalledWith('answer-45');
      wrapper.findComponent({ name: 'FeedCollectionPickerDialog' }).vm.$emit('confirm', ['c1']);
      await flushPromises();
      expect(favorites.updateFeedCloudCollections).toHaveBeenCalled();
      expect(answer.userAction.collect).toBe(1);
      expect(answer.favnum).toBe(2);
    } finally { wrapper.unmount(); }
  });

  it('问题详情的回答列表可以隐藏回复统计和排序栏', () => {
    const wrapper = mount(QuestionAnswerCard, {
      props: {
        answer: { id: 'answer-44', username: '回答用户', message: '回答正文', replynum: 0, feedType: 'answer' },
        showReplySummary: false,
        showRelatedContent: false,
      },
      global: {
        plugins: [createPinia()],
        stubs: {
          FeedHeader: { template: '<div class="stub-header"><slot name="actions" /></div>' },
          FeedContent: true,
          FeedVideoCard: true,
          FeedImageGrid: true,
          VoteCard: true,
          AppImage: true,
          FeedActionBar: true,
          FeedCommentSection: true,
          ForwardDialog: true,
          FeedInteractionListDialog: true,
          FeedCollectionPickerDialog: true,
        },
      },
    });

    expect(wrapper.find('.answer-reply-summary').exists()).toBe(false);
    expect(wrapper.find('.question-related-card').exists()).toBe(false);
  });
});
