<template>
  <button
    v-if="featured"
    type="button"
    class="ranking-featured"
    :data-feed-id="rankingFeedId || undefined"
    :data-transition-anchor="rankingFeedId ? `feed:${rankingFeedId}` : undefined"
    @click="emit('open', entity)"
  >
    <AppImage v-if="cover" :src="cover" fit="cover" image-class="ranking-banner-image" />
    <span class="ranking-featured-shade"></span>
    <span class="ranking-recommend"><i class="fas fa-fire"></i> 推荐</span>
    <strong>{{ title }}</strong>
    <span class="ranking-featured-stats">{{ stats }}</span>
  </button>
  <article
    v-else
    class="discovery-ranking-card"
    :data-feed-id="rankingFeedId || undefined"
    :data-transition-anchor="rankingFeedId ? `feed:${rankingFeedId}` : undefined"
  >
    <header><h3>{{ title }}</h3><button type="button" @click="emit('open', entity)">查看更多</button></header>
    <button type="button" class="ranking-products" :aria-label="`查看${title}`" @click="emit('open', entity)">
      <div v-for="(product, index) in products" :key="index" class="ranking-product">
        <div class="ranking-product-image"><AppImage v-if="product.cover" :src="product.cover" fit="cover" /><span :class="['ranking-top', `top-${index + 1}`]">TOP{{ index + 1 }}</span></div>
        <div class="ranking-product-copy"><span>{{ product.title }}</span><small v-if="product.price !== ''">¥{{ product.price }}</small></div>
      </div>
    </button>
    <footer><span>{{ stats }}</span><time>{{ getRankingDate(entity) }}</time></footer>
  </article>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import AppImage from '../common/AppImage.vue';
import type { DiscoveryEntity } from '../../types/discovery';
import { getRankingDate, getRankingProduct } from '../../utils/goodsRanking';
const props = defineProps<{ entity: DiscoveryEntity; featured?: boolean }>();
const emit = defineEmits<{ (event: 'open', entity: DiscoveryEntity): void }>();
const info = computed(() => (props.entity.goodsListInfo || props.entity) as Record<string, any>);
const rankingFeedId = computed(() => String(props.entity.id ?? props.entity.entityId ?? info.value.feed_id ?? info.value.id ?? '').trim());
const title = computed(() => String(info.value.title || props.entity.title || '好物榜'));
const cover = computed(() => String(props.entity.pic || props.entity.picUrl || props.entity.cover || info.value.cover || info.value.coverPic || info.value.logo || props.entity.logo || ''));
const products = computed(() => (Array.isArray(props.entity.goodsListItem) ? props.entity.goodsListItem : []).slice(0, 3).map(getRankingProduct));
const stats = computed(() => {
  const count = props.entity.extraInfo || props.entity.extra_info || (info.value.item_num != null ? `${info.value.item_num}个好物` : '');
  const votes = Number(info.value.is_open_vote ?? info.value.isOpenVote) === 1 && (info.value.vote_num ?? info.value.voteNum) != null ? `${info.value.vote_num ?? info.value.voteNum}人投票` : '';
  return [count, votes].filter(Boolean).join(' · ');
});
</script>
<style scoped>
.discovery-ranking-card { min-width:0; padding:16px; border-radius:16px; background:var(--surface); }
header { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
h3 { flex:1; min-width:0; margin:0; font-size:19px; line-height:1.4; font-weight:600; }
button { position:relative; overflow:hidden; font:inherit; cursor:pointer; border:0; }
header button { flex-shrink:0; padding:8px 14px; border-radius:24px; background:var(--brand-primary); color:white; }
.ranking-products { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; width:100%; padding:0; text-align:left; color:var(--text-primary); background:transparent; }
.ranking-product { min-width:0; overflow:hidden; border-radius:10px; background:var(--background-secondary,var(--background)); }
.ranking-product-image { aspect-ratio:1; position:relative; background:var(--surface); }
.ranking-product-image :deep(.app-image-container) { width:100%; height:100%; }
.ranking-top { position:absolute; top:0; left:0; padding:4px 6px; border-radius:10px 0 10px 0; border:1px solid #ffc05a; background:#fff4ad; color:#242424; font-size:13px; }
.top-2 { background:#deedf8; border-color:#a4c5ff; }.top-3 { background:#ffe8c5; border-color:#ffc483; }
.ranking-product-copy { padding:9px; }.ranking-product-copy > span { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.5; min-height:3em; }
small { display:block; margin-top:6px; color:var(--text-secondary); font-size:14px; }
footer { display:flex; justify-content:space-between; gap:12px; margin-top:16px; color:var(--text-secondary); font-size:14px; }
.ranking-featured { position:relative; display:block; box-sizing:border-box; width:100%; aspect-ratio:2.3; min-height:150px; padding:20px; overflow:hidden; border-radius:14px; background:#172d64; color:white; text-align:center; }
.ranking-featured :deep(.app-image-container) { position:absolute; inset:0; width:100%; height:100%; }.ranking-featured-shade { position:absolute; inset:0; background:linear-gradient(transparent,rgba(0,0,0,.6)); }
.ranking-featured strong { position:absolute; left:16px; right:16px; bottom:44px; font-size:clamp(18px,3vw,28px); font-weight:600; }
.ranking-recommend { position:absolute; top:12px; left:12px; border-radius:5px; padding:5px 9px; background:#ffba3c; }
.ranking-featured-stats { position:absolute; bottom:16px; right:16px; font-size:14px; }
button:active { opacity:.85; }button:focus-visible { outline:2px solid var(--brand-primary); outline-offset:3px; }
@media(max-width:720px) { .discovery-ranking-card { padding:14px; }h3 { font-size:18px; }header button { font-size:14px; } }
</style>
