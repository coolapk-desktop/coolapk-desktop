<template>
  <section class="official-product-card">
    <button class="product-summary" @click="$emit('open', target)"><AppImage :src="getFeedRelationImage(target)" fit="contain" class="product-logo" /><span class="product-copy"><span><small>{{ target.productTypeName || '数码' }}</small>{{ getFeedRelationTitle(target) }}</span><em>{{ getFeedRelationSubtitle(target) }}</em></span><span v-if="score" class="product-score"><strong>{{ score }}</strong><span aria-hidden="true"><i v-for="n in 5" :key="n" class="fas fa-star" :class="{ filled: n <= Math.round(Number(score) / 2) }"></i></span></span></button>
    <div class="product-actions"><button :disabled="pending" @click="toggleFollow">{{ following ? '已关注' : '关注' }}</button><button @click="publish">我也发一条</button></div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import AppImage from '../common/AppImage.vue';
import { getFeedRelationImage, getFeedRelationTitle, getFeedRelationSubtitle } from '../../utils/feedRelations';
import { getDigitalProductRating } from '../../utils/digitalProduct';
import { useAuthStore } from '../../stores/auth';
import { useAppStore } from '../../stores/app';
import { productRelationKey, useUserRelationsStore } from '../../stores/userRelations';
const props = defineProps<{ target: Record<string, any> }>();
defineEmits<{ open: [target: Record<string, any>] }>();
const auth = useAuthStore(); const app = useAppStore(); const userRelations = useUserRelationsStore();
const score = computed(() => getDigitalProductRating(props.target));
const targetId = computed(() => String(props.target.id || props.target.entityId || '').trim());
// 数码产品关注与用户关注共用同一份关系缓存，商店缓存优先、接口字段兜底。
const relationKey = computed(() => productRelationKey(targetId.value));
const following = computed(() => {
  const relation = userRelations.getRelation(relationKey.value);
  if (relation) return relation.isFollow;
  return Number(props.target.isFollow || props.target.userAction?.follow) === 1;
});
const pending = computed(() => userRelations.isPending(relationKey.value));
async function toggleFollow() {
  if (!auth.isLoggedIn) { auth.openLoginModal(); return; }
  if (pending.value || !targetId.value) return;
  await userRelations.toggleProduct(targetId.value, following.value);
}
function publish() { if (!auth.isLoggedIn) { auth.openLoginModal(); return; } app.openPublish(`#${getFeedRelationTitle(props.target)}# `); }
</script>
<style scoped>
.official-product-card { margin: 32px 0 12px; padding: 12px; border-radius: 9px; background: var(--surface-hover); }
.product-summary { display: flex; align-items: center; gap: 10px; width: 100%; padding: 0; border: 0; background: transparent; color: var(--text-primary); text-align: left; }
.product-logo { width: 42px; height: 48px; flex: 0 0 42px; }
.product-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.product-copy > span { font-size: 16px; overflow-wrap: anywhere; }
.product-copy small { display: inline-block; color: var(--brand-primary); border: 1px solid var(--brand-primary); border-radius: 3px; margin-right: 6px; padding: 0 3px; font-size: 11px; }
.product-copy em { color: var(--text-secondary); font-style: normal; font-size: 12px; }
.product-score { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.product-score strong { font-size: 24px; }
.product-score i { font-size: 9px; padding: 2px; margin: 1px; border-radius: 2px; background: var(--text-tertiary); color: white; }
.product-score i.filled { background: #ffb500; }
.product-actions { display: flex; gap: 12px; margin-top: 16px; }
.product-actions button { flex: 1; min-height: 32px; border: 1px solid var(--brand-primary); border-radius: 6px; background: transparent; color: var(--brand-primary); font: inherit; font-size: 14px; }
.product-actions button:last-child { background: var(--brand-soft); border-color: transparent; }
</style>
