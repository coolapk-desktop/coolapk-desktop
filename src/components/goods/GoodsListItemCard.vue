<template>
  <article class="goods-item-card" :class="{ 'is-voted': isVoted, 'is-clickable': !!buyUrl }" @click="openGoods">
    <div class="goods-item-cover">
      <span v-if="rank" :class="['goods-rank-medal', { 'is-first': rank === 1 }]">{{ rank }}</span>
      <AppImage
        v-if="cover"
        :src="cover"
        image-class="goods-cover-img"
        fit="cover"
        :alt="title"
      />
      <div v-else class="goods-cover-fallback">
        <i class="fas fa-gift"></i>
      </div>
    </div>

    <div class="goods-item-info">
      <h4 class="goods-item-title">{{ title || '未知商品' }}</h4>
      <div class="goods-item-tags">
        <span v-if="price" class="goods-price">¥{{ price }}</span>
        <span v-if="mallName" class="goods-mall">{{ mallName }}</span>
      </div>
      <p v-if="note" class="goods-note">{{ note }}</p>
      <p v-else-if="subTitle" class="goods-note">{{ subTitle }}</p>
    </div>

    <div class="goods-item-actions">
      <button
        v-if="canVote"
        class="vote-btn"
        :class="{ 'is-active': isVoted }"
        type="button"
        :disabled="voting"
        :title="isVoted ? '取消投票' : '投票支持'"
        @click.stop="handleVote"
      >
        <i class="fas fa-thumbs-up"></i>
        <span>{{ voteNum || 0 }}</span>
      </button>
      <button
        v-if="canManage"
        class="manage-btn"
        type="button"
        title="编辑备注"
        @click.stop="emit('edit', item)"
      >
        <i class="fas fa-pen"></i>
      </button>
      <button
        v-if="canManage"
        class="manage-btn danger"
        type="button"
        title="移除该商品"
        @click.stop="emit('delete', item)"
      >
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import AppImage from '../common/AppImage.vue';
import { useAuthStore } from '../../stores/auth';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { showToast } from '../../utils/toast';
import { getErrorMessage } from '../../utils/errors';
import { getRankingProduct } from '../../utils/goodsRanking';

const props = withDefaults(
  defineProps<{
    item: any;
    goodsListId?: string;
    ownerUid?: string | number;
    canManage?: boolean;
    canVote?: boolean;
    rank?: number;
  }>(),
  {
    goodsListId: '',
    ownerUid: '',
    canManage: false,
    canVote: true,
  },
);

const emit = defineEmits<{
  (e: 'vote', item: any, value: number): void;
  (e: 'edit', item: any): void;
  (e: 'delete', item: any): void;
}>();

const authStore = useAuthStore();

const product = computed(() => getRankingProduct(props.item));
const sourceGoods = computed(() => props.item.extra_entities?.[0] || props.item.extraEntities?.[0] || props.item);
const cover = computed(() => product.value.cover || props.item.pic || '');
const title = computed(() => product.value.title || props.item.goods_title || '');
const price = computed(() => product.value.price);
const mallName = computed(() => sourceGoods.value.mall_name || sourceGoods.value.mall_title || '');
const note = computed(() => props.item.note || props.item.message || '');
const subTitle = computed(() => props.item.sub_title || '');
const buyUrl = computed(() => sourceGoods.value.product_goods_url || sourceGoods.value.goods_url || sourceGoods.value.sell_url || sourceGoods.value.url || sourceGoods.value.goods_buy_url || '');

function openGoods() {
  const url = buyUrl.value;
  if (!url) {
    showToast('该好物暂无可打开的购买链接', 'info');
    return;
  }
  void CoolapkTauriAPI.openUrl(url, 'system');
}

/**
 * 票数直接读 props：父组件投票后会整体重拉 items，行组件因 key 不变被复用，
 * 旧实现用 ref 快照初始化一次，重拉后仍显示本地 ±1 的估算值。
 */
const voteNum = computed(() => Number(props.item.goodsListInfo?.vote_num ?? props.item.vote_num ?? props.item.voteNum ?? 0));
const isVoted = computed(() => {
  const value = props.item.goodsListInfo?.is_vote ?? props.item.isVote ?? props.item.is_vote;
  return value === true || value === 1 || value === '1';
});
const voting = ref(false);

async function handleVote() {
  if (!authStore.isLoggedIn) {
    authStore.openLoginModal();
    return;
  }
  if (voting.value) return;
  const id = String(props.goodsListId);
  const itemId = String(props.item.goodsListInfo?.item_id ?? props.item.id ?? props.item.feed_id ?? props.item.entityId ?? '');
  if (!id || !itemId) {
    showToast('缺少投票参数', 'error');
    return;
  }
  const target = !isVoted.value;
  voting.value = true;
  try {
    await CoolapkTauriAPI.voteGoodsListItem(id, itemId, target ? 1 : -1);
    emit('vote', props.item, target ? 1 : -1);
    // 回写行对象本身（computed 才有可读来源）；父组件的重拉会以服务端数值为准覆盖。
    const stats: any = props.item.goodsListInfo || props.item;
    if (stats && typeof stats === 'object') {
      stats.vote_num = Math.max(0, voteNum.value + (target ? 1 : -1));
      // 投票态同样回写：否则按钮高亮要等父组件整页重拉才变化。
      stats.is_vote = target ? 1 : 0;
    }
  } catch (err) {
    showToast(getErrorMessage(err, '投票失败'), 'error');
  } finally {
    voting.value = false;
  }
}
</script>

<style scoped>
.goods-item-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-3);
  transition: all var(--duration-fast) var(--ease-default);
}

.goods-item-card:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow-sm);
}

.goods-item-card.is-clickable {
  cursor: pointer;
}

.goods-item-card.is-voted {
  border-color: var(--brand-primary);
  background-color: var(--brand-soft);
}

.goods-item-cover {
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
  border-radius: var(--radius-control);
  overflow: hidden;
  background-color: var(--background-secondary);
  border: 1px solid var(--border-light);
}

.goods-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.goods-cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 22px;
}

.goods-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.goods-item-title {
  font-size: var(--font-size-sub);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.goods-item-tags {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.goods-price {
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-bold);
  color: var(--danger);
}

.goods-mall {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  background-color: var(--background-secondary);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}

.goods-note {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.goods-item-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
}

.vote-btn,
.manage-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-caption);
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  transition: all var(--duration-fast) var(--ease-default);
}

.vote-btn {
  background-color: var(--background-secondary);
  color: var(--text-secondary);
}

.vote-btn:hover:not(:disabled) {
  color: var(--brand-primary);
}

.vote-btn.is-active {
  background-color: var(--brand-soft);
  color: var(--brand-primary);
  font-weight: var(--font-weight-semibold);
}

.vote-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.manage-btn {
  background-color: transparent;
  color: var(--text-tertiary);
  padding: 4px 8px;
}

.manage-btn:hover {
  color: var(--brand-primary);
  background-color: var(--brand-soft);
}

.manage-btn.danger:hover {
  color: var(--danger);
  background-color: rgba(240, 68, 68, 0.1);
}

.goods-item-cover { position:relative; overflow:visible; }
.goods-cover-img { border-radius:inherit; overflow:hidden; }
.goods-rank-medal { position:absolute; z-index:1; top:-8px; left:-8px; width:25px; height:25px; display:grid; place-items:center; border-radius:50%; background:#e7edf4; border:2px solid #b4c5d8; color:#596b80; }
.goods-rank-medal.is-first { background:#fff0a6; border-color:#ffbc42; color:#745d1c; }
@media(max-width:720px) { .goods-item-card:has(.goods-rank-medal) .goods-item-cover { width:96px; height:96px; flex:0 0 96px; } }
</style>
