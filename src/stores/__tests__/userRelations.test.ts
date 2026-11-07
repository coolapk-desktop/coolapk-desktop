import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  followUser: vi.fn(),
  unfollowUser: vi.fn(),
  specialFollowUser: vi.fn(),
  changeProductFollowStatus: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: {
  followUser: mocks.followUser,
  unfollowUser: mocks.unfollowUser,
  specialFollowUser: mocks.specialFollowUser,
  changeProductFollowStatus: mocks.changeProductFollowStatus,
} }));
vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));

import { productRelationKey, useUserRelationsStore } from '../userRelations';

describe('关注关系单一真源', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.followUser.mockResolvedValue({ code: 200 });
    mocks.unfollowUser.mockResolvedValue({ code: 200 });
    mocks.specialFollowUser.mockResolvedValue({ code: 200 });
    mocks.changeProductFollowStatus.mockResolvedValue({ code: 200 });
  });

  it('关注成功后写入 store 并清空 pending', async () => {
    const store = useUserRelationsStore();
    await expect(store.follow('1001')).resolves.toBe(true);

    expect(mocks.followUser).toHaveBeenCalledWith('1001');
    expect(store.getRelation('1001')?.isFollow).toBe(true);
    expect(store.isPending('1001')).toBe(false);
  });

  it('取消关注成功同时清掉特别关注', async () => {
    const store = useUserRelationsStore();
    store.setRelation('1001', { isFollow: true, isSpecialFollow: true });

    await expect(store.toggle('1001', true)).resolves.toBe(true);

    expect(mocks.unfollowUser).toHaveBeenCalledWith('1001');
    expect(store.getRelation('1001')).toMatchObject({ isFollow: false, isSpecialFollow: false });
  });

  it('请求失败回滚到请求前状态并提示错误', async () => {
    const store = useUserRelationsStore();
    store.setRelation('1002', { isFollow: true });
    mocks.unfollowUser.mockRejectedValueOnce(new Error('网络异常'));

    await expect(store.toggle('1002', true)).resolves.toBe(false);

    expect(store.getRelation('1002')?.isFollow).toBe(true);
    expect(mocks.showToast).toHaveBeenCalledWith('网络异常', 'error');
    expect(store.isPending('1002')).toBe(false);
  });

  it('失败且此前没有缓存时不残留乐观状态', async () => {
    const store = useUserRelationsStore();
    mocks.followUser.mockRejectedValueOnce('服务不可用');

    await expect(store.follow('1003')).resolves.toBe(false);

    expect(store.getRelation('1003')).toBeUndefined();
    expect(mocks.showToast).toHaveBeenCalledWith('服务不可用', 'error');
  });

  it('同一 uid 并发点击只发一次请求', async () => {
    const store = useUserRelationsStore();
    let resolveFollow!: (value: unknown) => void;
    mocks.followUser.mockImplementationOnce(() => new Promise((resolve) => { resolveFollow = resolve; }));

    const first = store.follow('1004');
    const second = store.follow('1004');

    // 第二次点击命中进行中请求，直接忽略而不是重复提交
    await expect(second).resolves.toBe(false);
    expect(mocks.followUser).toHaveBeenCalledTimes(1);

    resolveFollow({ code: 200 });
    await expect(first).resolves.toBe(true);
    expect(mocks.followUser).toHaveBeenCalledTimes(1);
    expect(store.getRelation('1004')?.isFollow).toBe(true);
  });

  it('特别关注与普通关注使用独立的进行中标记', async () => {
    const store = useUserRelationsStore();
    store.setRelation('1005', { isFollow: true });
    mocks.specialFollowUser.mockImplementationOnce(() => new Promise(() => {}));

    void store.specialFollow('1005', true);

    expect(store.isSpecialPending('1005')).toBe(true);
    expect(store.isPending('1005')).toBe(false);
  });

  it('数码产品关注共用同一份关系缓存', async () => {
    const store = useUserRelationsStore();
    await expect(store.toggleProduct('9988', false)).resolves.toBe(true);

    expect(mocks.changeProductFollowStatus).toHaveBeenCalledWith('9988', 1);
    expect(store.getRelation(productRelationKey('9988'))?.isFollow).toBe(true);
  });

  it('reset 清空所有缓存与进行中标记', async () => {
    const store = useUserRelationsStore();
    store.setRelation('1006', { isFollow: true });

    store.reset();

    expect(store.getRelation('1006')).toBeUndefined();
    expect(store.isPending('1006')).toBe(false);
  });
});
