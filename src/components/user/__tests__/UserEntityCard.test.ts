import { describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import UserEntityCard from '../UserEntityCard.vue';

// 卡片本体由 FeedCard 负责，这里只校验传给它的模式与实体，避免把评论 id 当成动态 id。
const feedCardStub = {
  name: 'FeedCard',
  props: ['feed', 'profileUid', 'replyMode'],
  template: '<div class="feed-card-stub" />',
};

function mountCard(entity: Record<string, unknown>, tab?: string) {
  setActivePinia(createPinia());
  return mount(UserEntityCard, {
    props: { entity: entity as any, tab },
    global: { stubs: { FeedCard: feedCardStub, AppAvatar: true, AppImage: true } },
  });
}

describe('回复记录的动态操作隔离', () => {
  it('回复 tab 下按 reply 模式渲染，并禁用不适用于评论的动态编辑', () => {
    const wrapper = mountCard({ id: '222', entityType: 'feed', feed_id: '333', message: '评论正文', username: '我' }, 'reply');
    try {
      const card = wrapper.getComponent('.feed-card-stub') as any;
      const feed = card.props('feed') as any;
      expect(card.props('replyMode')).toBe(true);
      expect(feed.id).toBe('222');
      expect(String(feed.feedId)).toBe('333');
      expect(feed.enableModify).toBe(0);
    } finally { wrapper.unmount(); }
  });

  it('实体类型标记为回复时同样进入 reply 模式', () => {
    const wrapper = mountCard({ id: '222', entityType: 'feed_reply', feed_id: '333', message: '评论正文' });
    try {
      const card = wrapper.getComponent('.feed-card-stub') as any;
      expect(card.props('replyMode')).toBe(true);
      expect((card.props('feed') as any).enableModify).toBe(0);
    } finally { wrapper.unmount(); }
  });

  it('普通动态保持原实体，不做 reply 改写', () => {
    const entity = { id: '333', entityType: 'feed', message: '动态正文', username: '我' };
    const wrapper = mountCard(entity, 'feed');
    try {
      const card = wrapper.getComponent('.feed-card-stub') as any;
      expect(card.props('replyMode')).toBe(false);
      expect(card.props('feed').enableModify).toBeUndefined();
      expect(card.props('feed').message).toBe('动态正文');
    } finally { wrapper.unmount(); }
  });
});
