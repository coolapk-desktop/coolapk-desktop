import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ route: { params: { uid: '1', relation: 'follow' }, query: {} as Record<string, string> }, replace: vi.fn(), push: vi.fn(), followList: vi.fn(), fansList: vi.fn(), specialFollow: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ replace: mocks.replace, push: mocks.push, back: vi.fn() }) }));
vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: { getFollowUserList: mocks.followList, getFansList: mocks.fansList, specialFollowUser: mocks.specialFollow } }));
import UserRelationsPage from '../UserRelationsPage.vue';
import { useAuthStore } from '../../stores/auth';

describe('酷友关系列表', () => {
  beforeEach(() => {
    setActivePinia(createPinia()); vi.clearAllMocks();
    mocks.route = { params: { uid: '1', relation: 'follow' }, query: {} };
    mocks.followList.mockResolvedValue({ data: [] });
    mocks.fansList.mockResolvedValue({ data: [] });
    mocks.specialFollow.mockResolvedValue({ code: 200 });
    useAuthStore().user = { uid: '1', username: '当前账号', userAvatar: '' };
  });

  it('自己的酷友列表显示官方四个分类，并向服务端请求特别关注分类', async () => {
    mocks.route.query = { tab: 'special' };
    const wrapper = mount(UserRelationsPage, { global: { stubs: { AppAvatar: true, LoadingState: true, EmptyState: true, ErrorState: true } } });
    await flushPromises();
    expect(wrapper.findAll('.tab-btn').map(tab => tab.text())).toEqual(['关注', '特别关注', '互相关注', '粉丝']);
    expect(mocks.followList).toHaveBeenCalledWith('1', 1, 'special');
    await wrapper.findAll('.tab-btn')[2]!.trigger('click');
    expect(mocks.replace).toHaveBeenCalledWith({ path: '/user/1/relations/follow', query: { tab: 'friend' } });
    wrapper.unmount();
  });

  it('没有简介的粉丝只显示本人统计，不显示当前账号简介', async () => {
    mocks.route.params.relation = 'fans';
    mocks.fansList.mockResolvedValue({ data: [{ uid: '2', username: '粉丝', bio: '', signature: '', userInfo: { uid: '2', bio: '', follow: '3' }, fUserInfo: { uid: '1', bio: '当前账号简介' } }] });
    const wrapper = mount(UserRelationsPage, { global: { stubs: { AppAvatar: true, LoadingState: true, EmptyState: true, ErrorState: true } } });
    await flushPromises();
    expect(wrapper.find('.user-card').text()).toContain('关注 3');
    expect(wrapper.find('.user-card').text()).not.toContain('当前账号简介');
    expect(wrapper.find('.user-bio').exists()).toBe(false);
    wrapper.unmount();
  });

  it('可从关注列表设为特别关注', async () => {
    mocks.followList.mockResolvedValue({ data: [{ uid: '2', username: '酷友', isFollow: 1, isSpecialFollow: 0 }] });
    const wrapper = mount(UserRelationsPage, { global: { stubs: { AppAvatar: true, LoadingState: true, EmptyState: true, ErrorState: true } } });
    await flushPromises();
    await wrapper.find('.special-action-btn').trigger('click');
    expect(mocks.specialFollow).toHaveBeenCalledWith('2', true);
    wrapper.unmount();
  });

  it.each(['follow', 'fans'])('在 %s 列表中搜索未加载的用户，并在清空后恢复列表', async relation => {
    mocks.route.params.relation = relation;
    const fetchList = relation === 'fans' ? mocks.fansList : mocks.followList;
    fetchList.mockImplementation(async (_uid, page) => ({
      data: page === 1 ? [{ uid: '2', username: '第一页酷友' }] : page === 2 ? [{ uid: '30', username: 'Alice' }] : [],
    }));
    const wrapper = mount(UserRelationsPage, { global: { stubs: { AppAvatar: true, LoadingState: true, ErrorState: true } } });
    await flushPromises();
    expect(fetchList).toHaveBeenCalledTimes(1);

    const search = wrapper.get('input[type="search"]');
    await search.setValue(' aLi ');
    await vi.waitFor(() => expect(wrapper.findAll('.user-card').map(row => row.text())).toEqual([expect.stringContaining('Alice')]));
    expect(fetchList.mock.calls.map(call => call[1])).toEqual([1, 2, 3]);

    await wrapper.get('button[aria-label="清空搜索"]').trigger('click');
    expect(wrapper.findAll('.user-card')).toHaveLength(2);
    wrapper.unmount();
  });
});
