<template>
  <button type="button" class="discovery-secondhand-feed" @click="$emit('open', entity)">
    <AppImage v-if="cover" :src="cover" fit="cover" image-class="secondhand-cover" :style="coverAspectStyle" />
    <div v-else class="secondhand-cover secondhand-placeholder" :style="coverAspectStyle"><i class="fas fa-image"></i></div>
    <div class="secondhand-copy">
      <strong>{{ title }}</strong>
      <div class="secondhand-price-row"><span class="secondhand-price">{{ price }}</span><span v-if="info.link_source" class="secondhand-platform"><img v-if="info.link_source === '闲鱼'" :src="xianyuIcon" alt="" />{{ info.link_source }}</span></div>
      <div class="secondhand-seller"><AppAvatar :src="entity.userAvatar" :size="30" /><div><span>{{ entity.username }}</span><small>{{ metadata }}</small></div></div>
    </div>
  </button>
</template>

<script setup lang="ts">
import { htmlToPlainText } from '../../utils/htmlText';
import { isFeedEdited } from '../../utils/feedEditStatus';
import { computed } from 'vue';
import AppImage from '../common/AppImage.vue';
import AppAvatar from '../common/AppAvatar.vue';
import type { DiscoveryEntity } from '../../types/discovery';
import { extractFeedImageInputs, normalizeFeedImageItems } from '../../utils/livePhoto';
import { formatCommentTime } from '../../utils/commentList';
import xianyuIcon from '../../assets/xianyu-icon.png';
const props = defineProps<{ entity: DiscoveryEntity }>();
defineEmits<{ open: [entity: DiscoveryEntity] }>();
const info = computed<Record<string, any>>(() => {
  const raw = props.entity.ershou_info || props.entity.ershouInfo || props.entity.second_hand_info || props.entity.secondHandInfo;
  if (raw && typeof raw === 'object') return raw;
  try { const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
});
const cover = computed(() => normalizeFeedImageItems(extractFeedImageInputs(props.entity))[0]?.sourceUrl || info.value.product_logo || '');
const coverAspectStyle = computed(() => {
  const match = cover.value.match(/@(\d+)x(\d+)(?:[.?#/_-]|$)/i);
  if (match) {
    const w = Number(match[1]);
    const h = Number(match[2]);
    if (w > 0 && h > 0) {
      const ratio = Math.min(1.8, Math.max(0.72, w / h));
      return { aspectRatio: `${ratio.toFixed(4)} / 1` };
    }
  }
  return { aspectRatio: '4 / 3' };
});
const title = computed(() => htmlToPlainText(String(props.entity.message || props.entity.title || info.value.product_title || '闲置商品')).trim());
const price = computed(() => Number(info.value.is_face_deal) === 1 ? '价格面议' : info.value.product_price != null ? `¥${info.value.product_price}` : '');
const metadata = computed(() => [props.entity.dateline_text || formatCommentTime(props.entity), [info.value.province, info.value.city].filter(Boolean).join(' ') || props.entity.location, isFeedEdited(props.entity) ? '已编辑' : ''].filter(Boolean).join(' · '));
</script>

<style scoped>
.discovery-secondhand-feed { position:relative; display:block; width:100%; min-width:0; padding:0; overflow:hidden; border:0; border-radius:8px; background:var(--surface); color:var(--text-primary); text-align:left; font:inherit; cursor:pointer; }
.discovery-secondhand-feed :deep(.secondhand-cover) { width:100%; max-height:360px; min-height:100px; overflow:hidden; }
.discovery-secondhand-feed :deep(.secondhand-cover img) { width:100%; height:100%; object-fit:cover; }
.secondhand-placeholder { display:grid; place-items:center; aspect-ratio:1; background:var(--background-secondary); color:var(--text-tertiary); }
.secondhand-copy { padding:12px; }.secondhand-copy > strong { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.5; font-size:16px; font-weight:400; }
.secondhand-price-row { display:flex; align-items:center; justify-content:space-between; gap:6px; margin:12px 0; }.secondhand-price { font-size:23px; color:var(--danger,#ff4848); font-weight:600; }.secondhand-platform { color:var(--text-secondary); font-size:13px; }
.secondhand-platform { display:flex; align-items:center; gap:4px; }.secondhand-platform img { width:18px; height:18px; border-radius:3px; }
.secondhand-seller { display:flex; align-items:center; gap:8px; padding-top:10px; border-top:1px solid var(--border-light); color:var(--text-secondary); }.secondhand-seller > div:last-child { min-width:0; flex:1; }.secondhand-seller span,.secondhand-seller small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.secondhand-seller small { margin-top:3px; color:var(--text-tertiary); font-size:11px; }
.secondhand-seller small { white-space:normal; overflow-wrap:anywhere; }
.discovery-secondhand-feed:focus-visible { outline:2px solid var(--brand-primary); outline-offset:2px; }
@media(hover:hover) { .discovery-secondhand-feed:hover { box-shadow:var(--shadow-sm); } }
</style>
