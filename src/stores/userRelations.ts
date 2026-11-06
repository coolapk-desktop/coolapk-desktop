import { defineStore } from 'pinia';
import { ref } from 'vue';
import { CoolapkTauriAPI } from '../api/coolapk';
import { getErrorMessage } from '../utils/errors';
import { showToast } from '../utils/toast';

/** 单个关注目标的关系快照；updatedAt 记录本地最后写入时间。 */
export interface UserRelationState {
  isFollow: boolean;
  isSpecialFollow?: boolean;
  updatedAt: number;
}

/** 兼容 boolean / 0|1 / '0'|'1' 等接口写法。 */
export function isRelationFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/** 数码产品关注的目标不是 uid，用固定前缀区分，避免与用户关系互相覆盖。 */
export function productRelationKey(id: string | number): string {
  return `product:${String(id ?? '').trim()}`;
}

function normalizeRelationKey(uid: string | number | null | undefined): string {
  const raw = String(uid ?? '').trim();
  // 产品 key 已自带前缀，用户 uid 只有数字/字母，这里不做额外转换。
  return raw;
}

type RelationAction = 'follow' | 'special';

/**
 * 关注关系单一真源。
 * 组件展示必须优先读取 getRelation(uid)，仅在缓存缺失时回落到接口/props 值，
 * 保证同一个用户在任意页面切换关注后各处展示一致。
 */
export const useUserRelationsStore = defineStore('userRelations', () => {
  const relations = ref<Map<string, UserRelationState>>(new Map());
  // 进行中的请求按「动作 + 目标」去重，同一目标并发点击只发一次请求。
  const pendingKeys = ref<Set<string>>(new Set());

  function actionKey(action: RelationAction, key: string): string {
    return `${action}:${key}`;
  }

  function getRelation(uid: string | number | null | undefined): UserRelationState | undefined {
    const key = normalizeRelationKey(uid);
    return key ? relations.value.get(key) : undefined;
  }

  function setRelation(uid: string | number | null | undefined, patch: Partial<UserRelationState>): void {
    const key = normalizeRelationKey(uid);
    if (!key) return;
    const previous = relations.value.get(key);
    relations.value.set(key, {
      isFollow: previous?.isFollow ?? false,
      ...previous,
      ...patch,
      updatedAt: Date.now(),
    });
  }

  function isPending(uid: string | number | null | undefined): boolean {
    const key = normalizeRelationKey(uid);
    return key ? pendingKeys.value.has(actionKey('follow', key)) : false;
  }

  function isSpecialPending(uid: string | number | null | undefined): boolean {
    const key = normalizeRelationKey(uid);
    return key ? pendingKeys.value.has(actionKey('special', key)) : false;
  }

  /**
   * 乐观更新 → 调用接口 → 成功保留 / 失败回滚并提示。
   * 返回是否成功，便于调用方处理列表过滤等副作用。
   */
  async function runRelation(
    action: RelationAction,
    uid: string | number | null | undefined,
    patch: Partial<UserRelationState>,
    request: () => Promise<unknown>,
    fallbackMessage: string,
  ): Promise<boolean> {
    const key = normalizeRelationKey(uid);
    if (!key) return false;
    const pendingKey = actionKey(action, key);
    if (pendingKeys.value.has(pendingKey)) return false;

    const snapshot = relations.value.get(key);
    pendingKeys.value.add(pendingKey);
    setRelation(key, patch);
    try {
      await request();
      // 成功后刷新一次 updatedAt，保持与真实服务端状态一致。
      setRelation(key, patch);
      return true;
    } catch (error) {
      if (snapshot) relations.value.set(key, snapshot);
      else relations.value.delete(key);
      showToast(getErrorMessage(error, fallbackMessage), 'error');
      return false;
    } finally {
      pendingKeys.value.delete(pendingKey);
    }
  }

  function follow(uid: string | number): Promise<boolean> {
    return runRelation('follow', uid, { isFollow: true }, () => CoolapkTauriAPI.followUser(String(uid)), '关注失败');
  }

  function unfollow(uid: string | number): Promise<boolean> {
    // 取消关注同时清掉特别关注，与官方行为一致。
    return runRelation('follow', uid, { isFollow: false, isSpecialFollow: false }, () => CoolapkTauriAPI.unfollowUser(String(uid)), '取消关注失败');
  }

  function toggle(uid: string | number, current: boolean): Promise<boolean> {
    return current ? unfollow(uid) : follow(uid);
  }

  function specialFollow(uid: string | number, special: boolean): Promise<boolean> {
    return runRelation('special', uid, { isSpecialFollow: special }, () => CoolapkTauriAPI.specialFollowUser(String(uid), special), special ? '特别关注失败' : '取消特别关注失败');
  }

  /** 数码产品关注走独立接口 changeProductFollowStatus，共用同一份关系缓存与去重表。 */
  function followProduct(id: string | number): Promise<boolean> {
    const key = productRelationKey(id);
    return runRelation('follow', key, { isFollow: true }, () => CoolapkTauriAPI.changeProductFollowStatus(String(id), 1), '关注数码失败');
  }

  function unfollowProduct(id: string | number): Promise<boolean> {
    const key = productRelationKey(id);
    return runRelation('follow', key, { isFollow: false }, () => CoolapkTauriAPI.changeProductFollowStatus(String(id), 0), '取消关注失败');
  }

  function toggleProduct(id: string | number, current: boolean): Promise<boolean> {
    return current ? unfollowProduct(id) : followProduct(id);
  }

  /** 切换账号、登出或清空会话时调用，避免把上一个账号的关注状态带到新账号。 */
  function reset(): void {
    relations.value = new Map();
    pendingKeys.value = new Set();
  }

  return {
    relations,
    getRelation,
    setRelation,
    isPending,
    isSpecialPending,
    follow,
    unfollow,
    toggle,
    specialFollow,
    followProduct,
    unfollowProduct,
    toggleProduct,
    reset,
  };
});
