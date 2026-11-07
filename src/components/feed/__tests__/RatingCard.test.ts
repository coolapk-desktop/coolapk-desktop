import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  getFeedReplies: vi.fn(),
  getFeedCollectionOptions: vi.fn(),
  getFeedLikeList: vi.fn(),
  getFeedForwardList: vi.fn(),
  setFeedCloudFavorite: vi.fn(),
  updateFeedCloudCollections: vi.fn(),
}));
vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getFeedReplies: mocks.getFeedReplies,
    getFeedCollectionOptions: mocks.getFeedCollectionOptions,
    getFeedLikeList: mocks.getFeedLikeList,
    getFeedForwardList: mocks.getFeedForwardList,
    setFeedCloudFavorite: mocks.setFeedCloudFavorite,
    updateFeedCloudCollections: mocks.updateFeedCloudCollections,
  },
}));
// 导入链会经 FeedCommentSection → anchorClick 拉到真实的 src/router/index.ts。
vi.mock('../../../router', () => ({
  router: { push: vi.fn(), resolve: vi.fn(() => ({ matched: [] })) },
}));

import RatingCard from '../RatingCard.vue';
import { useAuthStore } from '../../../stores/auth';

describe('点评卡片评论区', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFeedReplies.mockResolvedValue({ data: [] });
    setActivePinia(createPinia());
  });

  const mountCard = (feed: Record<string, any>) =>
    mount(RatingCard, {
      props: { feed },
      global: {
        stubs: {
          FeedHeader: true,
          FeedContent: true,
          FeedImageGrid: true,
          FeedActionBar: true,
          AppImage: true,
          FeedCollectionPickerDialog: true,
          FeedInteractionListDialog: true,
          FeedCommentSection: {
            name: 'FeedCommentSection',
            props: ['comments', 'totalCommentCount'],
            template: '<div class="comment-section-stub" />',
          },
        },
      },
    });

  const feed = () => ({ id: '42', uid: '456', username: '作者', message: '点评正文', replynum: 3 });

  it('发表评论后列表就地 +1，且不整页重拉评论', async () => {
    mocks.getFeedReplies.mockResolvedValue({ data: [{ id: 'old-1', message: '旧评论' }] });
    const data = feed();
    const wrapper = mountCard(data);
    try {
      // 展开评论区触发第一页评论。
      await wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-comment');
      await flushPromises();

      const section = () => wrapper.findComponent({ name: 'FeedCommentSection' });
      expect(section().props('comments').map((c: any) => c.id)).toEqual(['old-1']);
      const requestCount = mocks.getFeedReplies.mock.calls.length;

      section().vm.$emit('send-comment', '新评论');
      section().vm.$emit('comment-created', { comment: { id: 'new-1', message: '新评论' } });
      await flushPromises();

      // 列表就地插入、计数本地累加，且没有再次请求评论列表（retry-comments 走的是重拉）。
      expect(section().props('comments').map((c: any) => c.id)).toEqual(['new-1', 'old-1']);
      expect(section().props('totalCommentCount')).toBe(4);
      expect(data.replynum).toBe(4);
      expect(mocks.getFeedReplies).toHaveBeenCalledTimes(requestCount);

      // 楼中楼只由评论组件自己补楼层，不插入主列表也不重复计数。
      section().vm.$emit('comment-created', { comment: { id: 'sub-1', message: '楼中楼' }, replyId: 'old-1' });
      await flushPromises();
      expect(section().props('comments').map((c: any) => c.id)).toEqual(['new-1', 'old-1']);
      expect(mocks.getFeedReplies).toHaveBeenCalledTimes(requestCount);
    } finally { wrapper.unmount(); }
  });

  it('取消收藏后把收藏态与计数回写到同一份 feed 实体', async () => {
    mocks.setFeedCloudFavorite.mockResolvedValue({ code: 200 });
    useAuthStore().isLoggedIn = true;
    // 父级列表传下来的就是这份对象，回写后列表上的收藏态随之更新。
    const data: Record<string, any> = { id: '42', uid: '456', username: '作者', message: '点评正文', favnum: 5, userAction: { collect: 1 } };
    const wrapper = mountCard(data);
    try {
      wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('toggle-fav');
      await flushPromises();

      expect(mocks.setFeedCloudFavorite).toHaveBeenCalledWith('42', false, 'feed', '');
      expect(data.userAction.collect).toBe(0);
      expect(data.favnum).toBe(4);
      expect(wrapper.emitted('favorite-changed')?.[0]).toEqual([{ id: '42', favorited: false }]);
    } finally { wrapper.unmount(); }
  });

  it('通过收藏夹面板收藏后同样回写实体', async () => {
    mocks.getFeedCollectionOptions.mockResolvedValue([
      { id: 'c1', title: '默认收藏夹', isBeCollected: 0 },
    ]);
    mocks.updateFeedCloudCollections.mockResolvedValue({ code: 200 });
    useAuthStore().isLoggedIn = true;
    const data: Record<string, any> = { id: '42', uid: '456', username: '作者', message: '点评正文', favnum: 0, userAction: { collect: 0 } };
    const wrapper = mountCard(data);
    try {
      wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('toggle-fav');
      await flushPromises();
      // 收藏走收藏夹面板，确认选择后才真正提交。
      expect(mocks.getFeedCollectionOptions).toHaveBeenCalledWith('42');
      wrapper.findComponent({ name: 'FeedCollectionPickerDialog' }).vm.$emit('confirm', ['c1']);
      await flushPromises();

      expect(mocks.updateFeedCloudCollections).toHaveBeenCalled();
      expect(data.userAction.collect).toBe(1);
      expect(data.favnum).toBe(1);
    } finally { wrapper.unmount(); }
  });

  it('显式重试（retry-comments）仍会重取第一页', async () => {
    mocks.getFeedReplies.mockResolvedValue({ data: [{ id: 'old-1', message: '旧评论' }] });
    const wrapper = mountCard(feed());
    try {
      await wrapper.findComponent({ name: 'FeedActionBar' }).vm.$emit('open-comment');
      await flushPromises();
      const pageOneCalls = () => mocks.getFeedReplies.mock.calls.filter(([, page]) => page === 1).length;
      const before = pageOneCalls();

      wrapper.findComponent({ name: 'FeedCommentSection' }).vm.$emit('retry-comments');
      await flushPromises();
      // 显式重试必须重新取第一页（而不是被「已有数据」的短路挡掉）。
      expect(pageOneCalls()).toBe(before + 1);
      expect(mocks.getFeedReplies).toHaveBeenCalledWith('42', 1, expect.any(Object));
    } finally { wrapper.unmount(); }
  });
});
