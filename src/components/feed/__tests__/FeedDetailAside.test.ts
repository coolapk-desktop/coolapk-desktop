import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({ getFeedReplies: vi.fn(), getFeedLikeList: vi.fn(), getFeedForwardList: vi.fn() }));
vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getFeedReplies: mocks.getFeedReplies,
    getFeedLikeList: mocks.getFeedLikeList,
    getFeedForwardList: mocks.getFeedForwardList,
  },
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// 导入链会经 FeedCommentSection → anchorClick 拉到真实的 src/router/index.ts，
// 它需要 vue-router 的 createRouter —— 只 mock 'vue-router' 不够，这里一并拦掉。
vi.mock('../../../router', () => ({
  router: { push: vi.fn(), resolve: vi.fn(() => ({ matched: [] })) },
}));

import FeedDetailAside from '../FeedDetailAside.vue';

describe('分栏详情页右栏', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFeedReplies.mockResolvedValue({ data: [] });
    mocks.getFeedLikeList.mockResolvedValue({ data: [] });
    mocks.getFeedForwardList.mockResolvedValue({ data: [] });
    setActivePinia(createPinia());
  });

  const mountAside = (
    activeTab: 'replies' | 'likes' | 'forwards' = 'replies',
    feed: Record<string, any> = { id: '42', uid: '456', username: '作者', message: '正文' },
  ) =>
    mount(FeedDetailAside, {
      props: { feed, activeTab },
      global: {
        stubs: {
          FeedCommentSection: { name: 'FeedCommentSection', props: { comments: Array, hideCollapseButton: Boolean, showSortControls: Boolean, defaultAuthorOnly: Boolean }, template: '<div class="comment-section-stub" />' },
          FeedInteractionListDialog: { name: 'FeedInteractionListDialog', props: ['feedType'], template: '<div class="interaction-stub" />' },
        },
      },
    });

  it('渲染三个 tab，当前 tab 高亮', async () => {
    const wrapper = mountAside('replies');
    await flushPromises();
    const tabs = wrapper.findAll('.aside-tab');
    expect(tabs.map((t) => t.text())).toEqual(['回复', '点赞', '转发']);
    expect(tabs[0].classes()).toContain('is-active');
    wrapper.unmount();
  });

  it('将通知指定的目标回复交给真实评论组件定位', async () => {
    const wrapper = mountAside();
    try {
      await wrapper.setProps({ targetReplyId: '222' });
      expect(wrapper.get('.comment-section-stub').attributes('target-reply-id')).toBe('222');
    } finally { wrapper.unmount(); }
  });

  it('点击 tab 抛出 update:activeTab', async () => {
    const wrapper = mountAside('replies');
    await flushPromises();
    await wrapper.findAll('.aside-tab')[2].trigger('click');
    expect(wrapper.emitted('update:activeTab')?.[0]).toEqual(['forwards']);
    wrapper.unmount();
  });

  it('activeTab 为 replies 时渲染评论组件，为 likes 时渲染互动列表', async () => {
    const replies = mountAside('replies');
    await flushPromises();
    expect(replies.find('.comment-section-stub').exists()).toBe(true);
    replies.unmount();

    const likes = mountAside('likes');
    await flushPromises();
    expect(likes.find('.interaction-stub').exists()).toBe(true);
    likes.unmount();
  });

  it('只看楼主走服务端过滤：打开后以 fromFeedAuthor=1 重取第一页', async () => {
    const wrapper = mountAside();
    await flushPromises();
    const section = wrapper.findComponent({ name: 'FeedCommentSection' });

    // 初始是「全部」：fromFeedAuthor 为 0
    expect(mocks.getFeedReplies).toHaveBeenLastCalledWith(
      '42', 1, expect.objectContaining({ fromFeedAuthor: 0 }),
    );

    section.vm.$emit('comment-sort-change', { mode: 'default', authorOnly: true });
    await flushPromises();

    // 打开后交给服务端过滤：fromFeedAuthor 为 1、listType 清空，且重新从第一页取。
    // 若有人把它改成客户端 filter，这条必须失败。
    expect(mocks.getFeedReplies).toHaveBeenLastCalledWith(
      '42', 1, expect.objectContaining({ fromFeedAuthor: 1, listType: '' }),
    );
    wrapper.unmount();
  });

  it('切换排序走服务端：以对应 listType 重取第一页', async () => {
    const wrapper = mountAside();
    await flushPromises();

    wrapper.findComponent({ name: 'FeedCommentSection' }).vm.$emit('comment-sort-change', { mode: 'likes', authorOnly: false });
    await flushPromises();
    expect(mocks.getFeedReplies).toHaveBeenLastCalledWith(
      '42', 1, expect.objectContaining({ listType: 'popular', fromFeedAuthor: 0 }),
    );
    wrapper.unmount();
  });

  it('互动列表 feedType 与单栏路径一致：优先 feedType，其次 feed_type，回退 entityType', async () => {
    const article = mountAside('forwards', { id: '42', uid: '456', username: '作者', message: '正文', feedType: 'feedArticle', entityType: 'feed' });
    await flushPromises();
    expect(article.findComponent({ name: 'FeedInteractionListDialog' }).props('feedType')).toBe('feedArticle');
    article.unmount();

    const rating = mountAside('forwards', { id: '42', uid: '456', username: '作者', message: '正文', feed_type: 'rating', entityType: 'feed' });
    await flushPromises();
    expect(rating.findComponent({ name: 'FeedInteractionListDialog' }).props('feedType')).toBe('rating');
    rating.unmount();

    const fallback = mountAside('forwards', { id: '42', uid: '456', username: '作者', message: '正文', entityType: 'feedArticle' });
    await flushPromises();
    expect(fallback.findComponent({ name: 'FeedInteractionListDialog' }).props('feedType')).toBe('feedArticle');
    fallback.unmount();
  });

  it('删除评论后本地移除该条（delete-comment 与单栏路径一致）', async () => {
    mocks.getFeedReplies.mockResolvedValue({ data: [{ id: 'a', message: '评论A' }, { id: 'b', message: '评论B' }] });
    const wrapper = mountAside();
    await flushPromises();

    const section = wrapper.findComponent({ name: 'FeedCommentSection' });
    expect(section.props('comments').map((c: any) => c.id)).toEqual(['a', 'b']);

    await section.vm.$emit('delete-comment', 'a');
    await flushPromises();
    expect(section.props('comments').map((c: any) => c.id)).toEqual(['b']);
    wrapper.unmount();
  });

  it('切到点赞/转发 tab 时隐藏评论组件及其筛选按钮', async () => {
    const likes = mountAside('likes');
    await flushPromises();
    expect(likes.findComponent({ name: 'FeedCommentSection' }).exists()).toBe(false);
    likes.unmount();

    const replies = mountAside('replies');
    await flushPromises();
    expect(replies.findComponent({ name: 'FeedCommentSection' }).props('showSortControls')).toBe(true);
    replies.unmount();
  });

  it('右栏评论组件抑制收起评论按钮（右栏没有「收起」语义）', async () => {
    const wrapper = mountAside();
    await flushPromises();
    expect(wrapper.findComponent({ name: 'FeedCommentSection' }).props('hideCollapseButton')).toBe(true);
    wrapper.unmount();
  });
});
