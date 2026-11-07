import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  setFeedCloudFavorite: vi.fn(),
  getFeedReplies: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.routerPush }) }));
vi.mock('../../../router', () => ({ router: { push: vi.fn(), resolve: vi.fn(() => ({ matched: [] })) } }));
vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: { setFeedCloudFavorite: mocks.setFeedCloudFavorite, getFeedReplies: mocks.getFeedReplies },
}));

import FeedCard from '../FeedCard.vue';
import { useAuthStore } from '../../../stores/auth';
import { getFeedFavoriteState, setFeedFavoriteState } from '../../../stores/feedFavorites';

const stubs = {
  AppImage: true,
  FeedHeader: { template: '<button class="test-more" @click="$emit(\'more\')">更多</button>' },
  FeedContent: true,
  FeedImageGrid: true,
  FeedVideoCard: true,
  FeedActionBar: true,
  FeedDyhShareDialog: true,
  FeedShareImageDialog: true,
  FeedInteractionListDialog: true,
  FeedCollectionPickerDialog: true,
  AppDialog: true,
  ForwardDialog: true,
  LoadingState: true,
};

describe('批次11：收藏注册表与评论计数', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    mocks.getFeedReplies.mockResolvedValue({ data: [] });
  });
  afterEach(() => { wrapper?.unmount(); });

  let wrapper: any = null;

  it('直接取消收藏成功后，注册表覆盖值同步为未收藏且计数回减', async () => {
    useAuthStore().isLoggedIn = true;
    // 预置注册表覆盖值模拟「其它副本收藏过」；取消后必须同步为最新状态。
    setFeedFavoriteState('42', { favorited: true, favnum: 3 });
    mocks.setFeedCloudFavorite.mockResolvedValue({});
    wrapper = mount(FeedCard, {
      props: { feed: { id: '42', uid: '456', username: '作者', message: '正文', favnum: 3, userAction: { collect: 1 } } as any, detailMode: true, officialMobileDetail: true },
      global: { stubs: { teleport: true, ...stubs } },
    });
    await wrapper.get('.test-more').trigger('click');
    const cancel = wrapper.findAll('.official-share-tools button').find((btn: { text(): string }) => btn.text().includes('取消收藏'))!;
    await cancel.trigger('click');
    await flushPromises();
    expect(mocks.setFeedCloudFavorite).toHaveBeenCalledWith('42', false, expect.any(String), '');
    const state = getFeedFavoriteState('42');
    expect(state?.favorited).toBe(false);
    expect(state?.favnum).toBe(2);
    expect(wrapper.props('feed').favnum).toBe(2);
  });

  it('删除评论后回减总评论数，与发表评论时的 +1 对称', async () => {
    mocks.getFeedReplies.mockResolvedValueOnce({ data: [{ id: 'c1', uid: '1', username: '路人', message: '评论' }] });
    const feed: any = { id: '42', uid: '456', username: '作者', message: '正文', replynum: 5 };
    wrapper = mount(FeedCard, {
      props: { feed, autoOpenComments: true },
      global: { stubs: { ...stubs, FeedCommentSection: { template: '<button class="test-delete" @click="$emit(\'delete-comment\', \'c1\')">删</button>' } } },
    });
    await flushPromises();
    expect(feed.replynum).toBe(5);
    await wrapper.get('.test-delete').trigger('click');
    await nextTick();
    expect(feed.replynum).toBe(4);
  });

  it('第 1 页加载期间收起评论后，不再自动续拉第 2 页', async () => {
    let resolvePage1: (value: any) => void = () => {};
    mocks.getFeedReplies.mockImplementationOnce(() => new Promise(resolve => { resolvePage1 = resolve; }));
    const feed: any = { id: '42', uid: '456', username: '作者', message: '正文', replynum: 10 };
    wrapper = mount(FeedCard, {
      props: { feed, autoOpenComments: true },
      global: { stubs: { ...stubs, FeedCommentSection: true } },
    });
    await nextTick();
    (wrapper.vm as any).handleCollapseComments();
    resolvePage1({ data: [{ id: 'c1', uid: '1', username: '路人', message: '评论' }] });
    await flushPromises();
    // 旧逻辑会在这里继续请求第 2 页并写入已隐藏的列表。
    expect(mocks.getFeedReplies).toHaveBeenCalledTimes(1);
  });
});
