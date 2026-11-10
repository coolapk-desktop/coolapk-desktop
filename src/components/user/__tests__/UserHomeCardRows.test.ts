import { describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import UserHomeCardRows from '../UserHomeCardRows.vue';

// 主页聚合卡片只关心渲染了几个动态/用户，卡片本体由 FeedCard 负责。
const feedCardStub = {
  name: 'FeedCard',
  props: ['feed', 'profileUid', 'replyMode'],
  template: '<div class="feed-card-stub" />',
};

function mountRows(rows: Record<string, unknown>[], extraFeeds: Record<string, unknown>[] = []) {
  setActivePinia(createPinia());
  return mount(UserHomeCardRows, {
    props: { rows: rows as any, extraFeeds: extraFeeds as any, uid: '1603081' },
    global: { stubs: { FeedCard: feedCardStub, AppAvatar: true, AppImage: true } },
  });
}

function feed(id: number, uid: number) {
  // 动态实体同时带作者 uid：主页下拉加载的就是同一作者的后续动态。
  return { id, entityId: id, entityType: 'feed', uid, message: '动态' + id };
}

describe('用户主页聚合卡片的实体归并', () => {
  it('同一作者的后续动态不会被 uid 归并丢弃', () => {
    const rows = [{ title: 'TA的热门动态', tab: 'feed', entities: [feed(1001, 1603081)] }];
    const wrapper = mountRows(rows, [feed(1002, 1603081), feed(1003, 1603081)]);
    try {
      expect(wrapper.findAll('.feed-card-stub').length).toBe(3);
    } finally { wrapper.unmount(); }
  });

  it('重复的动态仍按动态 id 去重', () => {
    const rows = [{ title: 'TA的热门动态', tab: 'feed', entities: [feed(1001, 1603081)] }];
    const wrapper = mountRows(rows, [feed(1001, 1603081), feed(1002, 1603081)]);
    try {
      expect(wrapper.findAll('.feed-card-stub').length).toBe(2);
    } finally { wrapper.unmount(); }
  });

  it('用户实体没有自身 id 时仍按 uid 去重', () => {
    const rows = [
      { title: 'TA关注的人', entities: [{ entityType: 'user', uid: 17115577, username: '甲' }] },
      { title: 'TA关注的人', entities: [{ entityType: 'user', uid: 17115577, username: '甲' }] },
    ];
    const wrapper = mountRows(rows);
    try {
      expect(wrapper.findAll('.home-follow-user').length).toBe(1);
    } finally { wrapper.unmount(); }
  });
});
