import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import FeedActionBar from '../FeedActionBar.vue';
import { ref } from 'vue';
import { mobileDetailActionsHiddenKey } from '../../../composables/useMobileReadingNavigation';
import { useAuthStore } from '../../../stores/auth';

const mocks = vi.hoisted(() => ({
  likeFeed: vi.fn(),
  unlikeFeed: vi.fn(),
  likeReply: vi.fn(),
  unlikeReply: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    likeFeed: mocks.likeFeed,
    unlikeFeed: mocks.unlikeFeed,
    likeReply: mocks.likeReply,
    unlikeReply: mocks.unlikeReply,
  },
}));

function loginAsUser() {
  const auth = useAuthStore();
  auth.isLoggedIn = true;
  auth.user = { uid: '1', username: '测试用户' } as any;
}

describe('动态互动入口', () => {
  it('详情操作栏随阅读状态收起并禁用交互，普通列表操作栏保持显示', async () => {
    setActivePinia(createPinia());
    const hidden = ref(false);
    const wrapper = mount(FeedActionBar, { props: { feedId: '42', officialDetail: true }, global: { provide: { [mobileDetailActionsHiddenKey as symbol]: hidden } } });
    try {
      hidden.value = true; await wrapper.vm.$nextTick();
      expect(wrapper.classes()).toContain('reading-hidden');
      expect(wrapper.attributes('inert')).toBeDefined();
      expect(wrapper.attributes('aria-hidden')).toBe('true');
      hidden.value = false; await wrapper.vm.$nextTick();
      expect(wrapper.classes()).not.toContain('reading-hidden');
      await wrapper.setProps({ officialDetail: false });
      hidden.value = true; await wrapper.vm.$nextTick();
      expect(wrapper.classes()).not.toContain('reading-hidden');
      expect(wrapper.attributes('inert')).toBeUndefined();
    } finally { wrapper.unmount(); }
  });
  it('在点赞和转发按钮中展示对应数量', () => {
    setActivePinia(createPinia());
    const wrapper = mount(FeedActionBar, {
      props: { feedId: '42', likenum: 12, sharenum: 3 },
    });

    expect(wrapper.find('.like-btn span').text()).toBe('12');
    expect(wrapper.find('.share-btn span').text()).toBe('3');
    expect(wrapper.find('[title="查看点赞用户"]').exists()).toBe(false);
    expect(wrapper.find('[title="查看转发列表"]').exists()).toBe(false);
  });

  it('没有互动数量时不显示列表入口', () => {
    setActivePinia(createPinia());
    const wrapper = mount(FeedActionBar, { props: { feedId: '42' } });

    expect(wrapper.find('.like-btn span').text()).toBe('');
    expect(wrapper.find('.share-btn span').text()).toBe('');
    expect(wrapper.find('.comment-btn').text()).toBe('');
    expect(wrapper.find('.fav-btn').text()).toBe('');
  });
  it('官方底栏提供写评论、评论数和独立操作，切换回原样式恢复计数', async () => {
    setActivePinia(createPinia());
    const wrapper = mount(FeedActionBar, { props: { feedId: '42', officialDetail: true, replynum: 3, likenum: 12, favnum: 5, sharenum: 21 } });
    expect(wrapper.find('.comment-btn').text()).toBe('3');
    expect(wrapper.find('.like-btn').text()).toBe('12');
    expect(wrapper.find('.fav-btn').text()).toBe('5');
    expect(wrapper.find('.share-btn').text()).toBe('21');
    await wrapper.find('.official-write-comment').trigger('click');
    expect(wrapper.emitted('write-comment')).toHaveLength(1);
    await wrapper.setProps({ officialDetail: false });
    expect(wrapper.find('.official-write-comment').exists()).toBe(false);
    expect(wrapper.find('.like-btn').text()).toBe('12');
  });

  it('官方底栏同步异步返回的数量，零数量保留操作文案', async () => {
    setActivePinia(createPinia());
    const wrapper = mount(FeedActionBar, { props: { feedId: '42', officialDetail: true } });
    expect(wrapper.find('.like-btn').text()).toBe('点赞');
    expect(wrapper.find('.fav-btn').text()).toBe('收藏');
    expect(wrapper.find('.share-btn').text()).toBe('转发');
    await wrapper.setProps({ replynum: 656, likenum: 325, favnum: 75, sharenum: 21, favorited: true, userAction: { like: 1, collect: 1 } });
    expect(wrapper.find('.comment-btn').text()).toBe('656');
    expect(wrapper.find('.like-btn').text()).toBe('325');
    expect(wrapper.find('.fav-btn').text()).toBe('75');
    expect(wrapper.find('.share-btn').text()).toBe('21');
    expect(wrapper.find('.like-btn').classes()).toContain('is-liked');
    expect(wrapper.find('.fav-btn').classes()).toContain('is-fav');
    wrapper.unmount();
  });

});

describe('转发计数回写', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    loginAsUser();
  });

  it('转发成功后本地计数 +1 并回抛 share-changed，宿主已回写 props 时不重复累加', async () => {
    const wrapper = mount(FeedActionBar, { props: { feedId: '42', sharenum: 3 } });
    try {
      // 打开转发弹窗时计数不变，只有宿主确认成功后才会更新。
      await wrapper.get('.share-btn').trigger('click');
      expect(wrapper.emitted('forward')).toHaveLength(1);
      expect(wrapper.get('.share-btn span').text()).toBe('3');
      expect(wrapper.emitted('share-changed')).toBeUndefined();

      (wrapper.vm as any).notifyShareSuccess();
      await wrapper.vm.$nextTick();
      expect(wrapper.get('.share-btn span').text()).toBe('4');
      expect(wrapper.emitted('share-changed')).toEqual([[{ feedId: '42', count: 4 }]]);

      // 宿主先回写 feed.sharenum 并透传为 prop 时，直接采用 prop 值，避免重复 +1。
      await wrapper.get('.share-btn').trigger('click');
      await wrapper.setProps({ sharenum: 5 });
      (wrapper.vm as any).notifyShareSuccess();
      await wrapper.vm.$nextTick();
      expect(wrapper.get('.share-btn span').text()).toBe('5');
      expect(wrapper.emitted('share-changed')?.[1]).toEqual([{ feedId: '42', count: 5 }]);
    } finally { wrapper.unmount(); }
  });
});

describe('点赞状态与接口调用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    loginAsUser();
  });

  it('点赞成功后向上抛出结果，供卡片回写实体字段', async () => {
    mocks.likeFeed.mockResolvedValue({ code: 200 });
    const wrapper = mount(FeedActionBar, { props: { feedId: '42', likenum: 12 } });
    try {
      await wrapper.get('.like-btn').trigger('click');
      await Promise.resolve();
      expect(mocks.likeFeed).toHaveBeenCalledWith('42');
      expect(wrapper.emitted('like-changed')).toEqual([[{ feedId: '42', liked: true, count: 13 }]]);
      expect(wrapper.get('.like-btn').classes()).toContain('is-liked');
    } finally { wrapper.unmount(); }
  });

  it('连点三次只发出一次请求', async () => {
    // 挂起的请求模拟慢网络：请求未返回前的重复点击必须被忽略，避免乱序响应。
    mocks.likeFeed.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(FeedActionBar, { props: { feedId: '42', likenum: 12 } });
    try {
      const button = wrapper.get('.like-btn');
      await button.trigger('click');
      await button.trigger('click');
      await button.trigger('click');
      expect(mocks.likeFeed).toHaveBeenCalledTimes(1);
      expect(wrapper.get('.like-btn span').text()).toBe('13');
      expect(wrapper.emitted('like-changed')).toBeUndefined();
    } finally { wrapper.unmount(); }
  });

  it('接口失败回滚状态且不抛出成功事件', async () => {
    mocks.likeFeed.mockRejectedValue(new Error('点赞失败'));
    const wrapper = mount(FeedActionBar, { props: { feedId: '42', likenum: 12 } });
    try {
      await wrapper.get('.like-btn').trigger('click');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(wrapper.get('.like-btn span').text()).toBe('12');
      expect(wrapper.get('.like-btn').classes()).not.toContain('is-liked');
      expect(wrapper.emitted('like-changed')).toBeUndefined();
      // 失败后不再被 pending 卡住，可以重试。
      await wrapper.get('.like-btn').trigger('click');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mocks.likeFeed).toHaveBeenCalledTimes(2);
    } finally { wrapper.unmount(); }
  });

  it('我的评论列表点赞走评论接口，不使用评论 id 点赞动态', async () => {
    mocks.likeReply.mockResolvedValue({ code: 200 });
    const wrapper = mount(FeedActionBar, { props: { feedId: '333', replyId: '222', replyMode: true, allowFav: false, likenum: 4 } });
    try {
      await wrapper.get('.like-btn').trigger('click');
      await Promise.resolve();
      expect(mocks.likeFeed).not.toHaveBeenCalled();
      expect(mocks.likeReply).toHaveBeenCalledWith('222');
      expect(wrapper.emitted('like-changed')).toEqual([[{ feedId: '222', liked: true, count: 5 }]]);
      expect(wrapper.get('.fav-btn').attributes('disabled')).toBeDefined();
      await wrapper.get('.like-btn').trigger('click');
      await Promise.resolve();
      expect(mocks.unlikeReply).toHaveBeenCalledWith('222');
    } finally { wrapper.unmount(); }
  });
});
