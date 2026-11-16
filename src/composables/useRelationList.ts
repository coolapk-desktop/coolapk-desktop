import { computed, onActivated, onDeactivated, onScopeDispose, ref, watch, watchEffect, type Ref } from 'vue';
import { normalizeEntityPage, relationUserBio } from '../types/userSpace';

export function useRelationList(scope: Ref<string>, fetchPage: (page: number) => Promise<unknown>, getUid: (user: any) => string) {
  const users = ref<any[]>([]);
  const loading = ref(false);
  const hasMore = ref(true);
  const error = ref('');
  const known = new Set<string>();
  let nextPage = 1;
  let version = 0;

  function reset() {
    version++;
    known.clear();
    users.value = [];
    nextPage = 1;
    hasMore.value = true;
    loading.value = false;
    error.value = '';
  }

  watch(scope, reset, { flush: 'sync' });
  onScopeDispose(() => { version++; });

  async function loadNext(maxPages = 1) {
    if (!scope.value || loading.value || !hasMore.value) return;
    const requestVersion = version;
    loading.value = true;
    error.value = '';
    try {
      for (let count = 0; count < maxPages; count++) {
        const raw = await fetchPage(nextPage);
        if (requestVersion !== version) return;
        // 关系接口可能返回不足一页的数据，搜索继续请求直到末页。
        const response = normalizeEntityPage(raw, nextPage, 1);
        const incoming = response.items.filter(user => {
          const uid = getUid(user);
          if (!uid || known.has(uid)) return false;
          known.add(uid);
          return true;
        });
        users.value.push(...incoming);
        nextPage = response.page + 1;
        // 服务端重复返回同一页时结束，避免自动搜索一直请求。
        hasMore.value = response.hasMore && incoming.length > 0;
        if (!hasMore.value || response.items.length < 20) break;
      }
    } catch (cause) {
      if (requestVersion !== version) return;
      error.value = String(cause instanceof Error ? cause.message : cause || '用户列表加载失败');
    } finally {
      if (requestVersion === version) loading.value = false;
    }
  }

  return { scope, users, loading, hasMore, error, reset, loadNext };
}

export function useRelationSearch(
  list: Readonly<Ref<ReturnType<typeof useRelationList>>>,
  relation: Readonly<Ref<'follow' | 'fans'>>,
  getName: (user: any) => string,
  getUid: (user: any) => string,
) {
  const search = ref('');
  const keyword = computed(() => search.value.trim().toLowerCase());
  const readyKeyword = ref('');
  const active = ref(true);
  onActivated(() => { active.value = true; });
  onDeactivated(() => { active.value = false; });

  watch(keyword, (value, _, onCleanup) => {
    const timer = setTimeout(() => { readyKeyword.value = value; }, 300);
    onCleanup(() => clearTimeout(timer));
  }, { flush: 'sync' });

  const matches = computed(() => {
    const users = list.value.users.value;
    const query = keyword.value;
    if (!query) return users;
    return users.filter(user => [getName(user), getUid(user), relationUserBio(user, relation.value)].some(value => value.toLowerCase().includes(query)));
  });
  const searching = computed(() => !!keyword.value && !!list.value.scope.value && list.value.hasMore.value && !list.value.error.value);

  watchEffect(() => {
    const source = list.value;
    if (active.value && searching.value && readyKeyword.value === keyword.value && !source.loading.value) void source.loadNext();
  });

  return { search, keyword, matches, searching };
}
