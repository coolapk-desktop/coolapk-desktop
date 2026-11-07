<template>
  <section class="topic-rating-panel" aria-label="话题评分详情">
    <header class="rating-topic-header" :style="{ backgroundColor: heroColor }">
      <button class="rating-back" type="button" aria-label="返回话题" @click="navigateBack(router, '/topics')"><i class="fas fa-arrow-left"></i></button>
      <AppImage v-if="detail.logo" :src="detail.logo" image-class="rating-header-background" fit="cover" />
      <div class="rating-topic-identity"><AppImage v-if="detail.logo" :src="detail.logo" image-class="rating-topic-logo" fit="cover" /><span v-else class="rating-topic-logo logo-fallback">#</span>
        <div><h2>{{ detail.title || '话题评分' }}</h2><p v-if="topicReleaseLabel(detail.release_time)">{{ topicReleaseLabel(detail.release_time) }}</p></div>
        <span v-if="overallScore !== null && overallScore > 0" class="rating-face"><img :src="ratingFaces[Math.max(0, Math.round(topicScoreStars(overallScore)) - 1)]" alt=""><strong>{{ ['很差', '较差', '一般', '不错', '非常好'][Math.max(0, Math.round(topicScoreStars(overallScore)) - 1)] }}</strong></span>
      </div>
    </header>
    <div class="rating-overview">
      <div class="rating-overview-column">
      <section class="rating-summary-card official-rating-card"><h3>全部用户评分</h3><div class="summary-content">
      <div class="rating-summary">
        <strong class="overall-score" :class="{ 'no-score': !overallScore }">{{ overallScore !== null && overallScore > 0 ? overallScore.toFixed(1) : '暂无评分' }}</strong>
        <span v-if="overallScore !== null && overallScore > 0" class="summary-stars" aria-hidden="true"><i v-for="value in 5" :key="value" class="fas fa-star" :class="scoreStarClass(value, overallScore)"></i></span>
        <p>{{ totalCount !== null ? `${totalCount.toLocaleString()} 名用户评分` : '暂无评分人数' }}</p>
      </div>
      <div class="rating-distribution" aria-label="评分分布">
        <button v-for="row in distribution" :key="row.star" type="button" :aria-pressed="star === row.star"
          :aria-label="`${row.star} 星：${row.count === null ? '暂无数据' : row.count + ' 人'}，点击筛选`"
          @click="star = star === row.star ? 0 : row.star">
          <span>{{ row.star }} 星</span><span class="rating-bar"><span :style="{ width: `${row.percent}%` }"></span></span>
          <span>{{ row.count === null ? '—' : row.count.toLocaleString() }}</span>
        </button>
      </div>
      </div></section>
      <section v-if="dimensions.length" class="rating-dimensions official-rating-card">
        <h3>全部用户详细评分</h3>
        <div class="dimension-content">
          <svg v-if="dimensions.length >= 3" class="rating-radar" viewBox="0 0 260 220" role="img" aria-label="各维度评分雷达图">
            <circle v-for="level in [2, 4, 6, 8, 10]" :key="level" cx="130" cy="110" :r="level * 5.5" class="radar-grid" />
            <line v-for="(_item, index) in dimensions" :key="index" x1="130" y1="110" :x2="radarPoint(index, 10).x" :y2="radarPoint(index, 10).y" class="radar-grid" />
            <polygon :points="dimensions.map((item, index) => `${radarPoint(index, item.score).x},${radarPoint(index, item.score).y}`).join(' ')" class="radar-scores" />
            <text v-for="(item, index) in dimensions" :key="item.id" :x="radarPoint(index, 13).x" :y="radarPoint(index, 13).y" text-anchor="middle">{{ item.name }} <tspan fill="#ffb900">{{ item.score.toFixed(1) }}</tspan><tspan :x="radarPoint(index, 13).x" dy="12" class="radar-description">{{ item.description }}</tspan></text>
          </svg>
          <div v-if="dimensions.length < 3" class="dimension-values"><div v-for="item in dimensions" :key="item.id" class="dimension-row"><span>{{ item.name }}<small>{{ item.description }}</small></span><strong>{{ item.score.toFixed(1) }}</strong></div></div>
        </div>
        <p v-if="detailCount !== null" class="detail-count">{{ detailCount.toLocaleString() }} 名用户详细点评</p>
      </section>
      </div>
      <div class="rating-overview-column">
      <section v-if="recentScore !== null || recentCount !== null || recentGoodPercent !== null" class="recent-rating official-rating-card">
        <h3>最近30天全部用户评分</h3><div class="recent-content"><div><strong class="overall-score">{{ recentScore === null ? '—' : recentScore.toFixed(1) }}</strong><span v-if="recentScore" class="summary-stars" aria-hidden="true"><i v-for="value in 5" :key="value" class="fas fa-star" :class="scoreStarClass(value, recentScore)"></i></span><p>{{ recentCount === null ? '暂无评分人数' : `${recentCount.toLocaleString()} 名用户评分` }}</p></div>
          <div v-if="recentGoodPercent !== null" class="recent-good-rate"><svg viewBox="0 0 80 50" aria-hidden="true"><path d="M8 38 A32 32 0 0 1 72 38" pathLength="100" class="rate-track" /><path d="M8 38 A32 32 0 0 1 72 38" pathLength="100" class="rate-value" :stroke-dasharray="`${Math.min(100, recentGoodPercent)} 100`" /></svg><strong>{{ recentGoodPercent.toFixed(0) }}%</strong><small>30天好评率</small></div>
        </div>
      </section>
      <TopicRatingTrend :topic-id="String(detail.id)" :initial-chart="detail.ratingChart" />
      </div>
    </div>

    <div class="rating-list-header official-rating-card">
      <h3>全部用户打分</h3>
      <div class="rating-star-selector" aria-label="筛选星级"><button v-for="value in [0, 5, 4, 3, 2, 1]" :key="value" type="button" :aria-pressed="star === value" @click="star = value">{{ value ? `${value}星` : '全部' }}</button></div>
      <div class="rating-filters">
        <button v-if="dimensions.length" type="button" :aria-pressed="detailOnly" @click="detailOnly = !detailOnly">只看详细打分</button>
        <button type="button" :aria-pressed="ratingType === '1'" @click="ratingType = ratingType === '1' ? '' : '1'">只看有评语</button>
        <button type="button" :aria-pressed="ratingType === '0'" @click="ratingType = ratingType === '0' ? '' : '0'">只看无评语</button>
      </div>
    </div>
    <LoadingState v-if="loading && !ratings.length" text="正在加载用户点评..." />
    <ErrorState v-else-if="error && !ratings.length" title="点评加载失败" :message="error" @retry="load(false)" />
    <EmptyState v-else-if="!ratings.length" title="暂无符合条件的评分" />
    <div v-else class="rating-reviews">
      <article v-for="(review, index) in ratings" :key="topicRatingCursor(review) || index" class="rating-review" @click="openReview(review)">
        <div class="review-header">
          <button class="review-user" type="button" :disabled="!review.userInfo?.uid" @click.stop="openUser(review)">
            <AppAvatar :src="review.userInfo?.userAvatar" :size="40" />
            <span><strong>{{ review.userInfo?.displayUserName || review.userInfo?.username || '酷友' }}</strong></span>
          </button>
          <span v-if="ratingNumber(review.star) !== null" class="review-score" :aria-label="`${review.star} 星`">
            <span aria-hidden="true"><i v-for="value in 5" :key="value" class="fas fa-star" :class="{ filled: value <= Number(review.star) }"></i></span>
            <span class="review-badges"><button v-if="personalDimensions(review).length || Number(review.v4_has_rating_score) === 1" type="button" @click.stop="openReview(review)"><i class="fas fa-draw-polygon"></i> 详细</button><small v-if="!review.feed_id || String(review.feed_id) === '0'">无评语</small><button v-else type="button" @click.stop="openReview(review)">查看评语</button></span>
          </span>
        </div>
        <div class="review-footer">
          <span v-if="Number(review.filter_rating) === 1">此评分不计入总分</span>
        </div>
      </article>
      <p v-if="error" role="alert" class="load-error">{{ error }}</p>
      <button v-if="!noMore" class="load-more" type="button" :disabled="loading" @click="load(true)">{{ loading ? '正在加载...' : error ? '重试加载' : '加载更多点评' }}</button>
      <p v-else class="no-more">没有更多点评了</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../../api/coolapk';
import AppAvatar from '../common/AppAvatar.vue';
import AppImage from '../common/AppImage.vue';
import TopicRatingTrend from './TopicRatingTrend.vue';
import LoadingState from '../common/LoadingState.vue';
import ErrorState from '../common/ErrorState.vue';
import EmptyState from '../common/EmptyState.vue';
import { showToast } from '../../utils/toast';
// 评分面板嵌在话题页内，深链进入时退回话题中心。
import { navigateBack } from '../../utils/navigation';
import { openFeedDetail } from '../../utils/feedNavigation';
import { extractTopicRatings, ratingNumber, topicRatingCursor, topicRatingDimensions, topicScoreStars, topicReleaseLabel } from '../../utils/topicRating';
import face1 from '../../assets/official-rating/ic_face_star_1.png';
import face2 from '../../assets/official-rating/ic_face_star_2.png';
import face3 from '../../assets/official-rating/ic_face_star_3.png';
import face4 from '../../assets/official-rating/ic_face_star_4.png';
import face5 from '../../assets/official-rating/ic_face_star_5.png';

const props = defineProps<{ detail: any }>();
const router = useRouter();
const overallScore = computed(() => ratingNumber(props.detail.star_average_score ?? props.detail.rating_average_score));
const totalCount = computed(() => ratingNumber(props.detail.star_total_count));
const detailCount = computed(() => ratingNumber(props.detail.v4_rating_total_count));
const dimensions = computed(() => topicRatingDimensions(props.detail.rating_item_info));
const ratingFaces = [face1, face2, face3, face4, face5];
const heroColor = computed(() => /^#[\da-f]{6}$/i.test(props.detail.bgColor || '') ? props.detail.bgColor : '#4a6263');
const recentScore = computed(() => ratingNumber(props.detail.recent_30_days_star_average_score));
const recentCount = computed(() => ratingNumber(props.detail.recent_30_days_star_total_count));
const recentGoodPercent = computed(() => ratingNumber(props.detail.recent_30_days_goods_percent));
function radarPoint(index: number, score: number) {
  const angle = index * 2 * Math.PI / dimensions.value.length - Math.PI / 2;
  const radius = score * 5.5;
  return { x: 130 + Math.cos(angle) * radius, y: 110 + Math.sin(angle) * radius };
}
function scoreStarClass(value: number, score: number) {
  const stars = topicScoreStars(score);
  return { filled: value <= stars, half: value > stars && value - stars === .5 };
}
const distribution = computed(() => {
  const rows = [5, 4, 3, 2, 1].map(star => ({ star, count: ratingNumber(props.detail[`star_${star}_count`]) }));
  const max = Math.max(1, ...rows.map(row => row.count || 0));
  return rows.map(row => ({ ...row, percent: (row.count || 0) / max * 100 }));
});
const star = ref(0);
const ratingType = ref<'' | '0' | '1'>('');
const detailOnly = ref(false);
const ratings = ref<any[]>([]);
const loading = ref(false);
const error = ref('');
const noMore = ref(false);
let page = 1;
let requestId = 0;
let firstItem = '';
let lastItem = '';

function personalDimensions(review: any) { return topicRatingDimensions(review.rating_item_info, true); }
function openUser(review: any) { if (review.userInfo?.uid) void router.push(`/user/${review.userInfo.uid}`); }
function openReview(review: any) { if (review.feed_id && String(review.feed_id) !== '0') openFeedDetail(router, review.feed_id); else showToast('TA很懒，并没有留下评语', 'info'); }

async function load(more: boolean) {
  if (more && (loading.value || noMore.value)) return;
  const id = ++requestId;
  if (!more) { page = 1; ratings.value = []; noMore.value = false; firstItem = ''; lastItem = ''; }
  loading.value = true;
  error.value = '';
  try {
    const response = await CoolapkTauriAPI.getTopicRatingList({
      topicId: String(props.detail.id), page, star: star.value, ratingType: ratingType.value,
      detailOnly: detailOnly.value, firstItem, lastItem,
    });
    if (id !== requestId) return;
    if (Number(response?.code) !== 200 || !Array.isArray(response.data)) throw new Error(response?.message || '评分数据加载失败，请重试');
    const rows = extractTopicRatings(response.data);
    if (!rows.length) { noMore.value = true; return; }
    const existing = new Set(ratings.value.map(topicRatingCursor).filter(Boolean));
    const added = rows.filter(row => {
      const key = topicRatingCursor(row);
      if (key && existing.has(key)) return false;
      if (key) existing.add(key);
      return true;
    });
    ratings.value.push(...added);

    firstItem ||= topicRatingCursor(rows[0]);
    lastItem = topicRatingCursor(rows[rows.length - 1]);
    page++;
    if (!added.length) noMore.value = true;
  } catch (cause) {
    if (id === requestId) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally { if (id === requestId) loading.value = false; }
}

watch(() => [props.detail.id, star.value, ratingType.value, detailOnly.value], () => { void load(false); }, { immediate: true });
onUnmounted(() => { requestId++; });

// 由外层页面下拉统一等待内容刷新完成。
defineExpose({ refresh: () => load(false) });
</script>

<style scoped>
.topic-rating-panel { min-width: 0; padding-bottom: 24px; }
.rating-topic-header { position: relative; overflow: hidden; border-radius: 8px; margin-bottom: 12px; color: white; }
.rating-back { position: relative; z-index: 1; margin: 12px 16px 0; width: 32px; height: 32px; border: 0; background: transparent; color: white; font-size: 20px; cursor: pointer; }
.rating-topic-header :deep(.rating-header-background) { position: absolute; inset: -30px; width: calc(100% + 60px); height: calc(100% + 60px); filter: blur(24px); opacity: .3; pointer-events: none; }
.rating-topic-identity { position: relative; display: flex; align-items: center; gap: 10px; padding: 24px 16px; background: linear-gradient(transparent, #0003); }
.rating-topic-identity :deep(.rating-topic-logo),.rating-topic-logo { width: 64px; height: 64px; flex-shrink: 0; border-radius: 10px; overflow: hidden; }
.logo-fallback { display: grid; place-items: center; background: #ffffff20; font-size: 32px; }
.rating-topic-identity h2 { font-size: 18px; font-weight: 500; margin: 0 0 6px; overflow-wrap: anywhere; }
.rating-topic-identity p { font-size: 12px; opacity: .75; }
.rating-face { margin-left: auto; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 56px; }
.rating-face img { width: 24px; height: 24px; }
.rating-face strong { font-size: 14px; font-weight: 400; }
@media(min-width:721px){
  .rating-topic-header .rating-back { position: absolute; left: 12px; top: 28px; margin: 0; }
  .rating-topic-identity { padding: 16px 20px 16px 60px; }
}
h3, p { margin: 0; }
h3 { font-size: 14px; font-weight: 500; }
.official-rating-card { background: var(--surface); border-radius: 8px; padding: 12px; min-width: 0; }
.rating-overview { display: flex; align-items: flex-start; gap: 12px; }
.rating-overview-column { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 12px; }
.summary-content { display: grid; grid-template-columns: minmax(90px, .4fr) minmax(140px, .6fr); align-items: center; gap: 12px; margin-top: 12px; }
.rating-summary { text-align: center; }
.overall-score { display: block; font-size: 36px; font-weight: 700; color: var(--text-primary); margin: 0 0 4px; }
.overall-score.no-score { font-size: 20px; }
.rating-summary p, small { font-size: 10px; color: var(--text-secondary); }
.summary-stars { display: flex; justify-content: center; gap: 3px; margin-bottom: 6px; font-size: 12px; color: var(--border); }
.summary-stars .filled { color: #ffab00; }
.summary-stars .half { background: linear-gradient(90deg, #ffab00 50%, var(--border) 50%); background-clip: text; -webkit-background-clip: text; color: transparent; }
.recent-content { display: flex; align-items: center; justify-content: space-between; padding: 16px 12px 8px; }
.recent-content p { font-size: 10px; color: var(--text-secondary); }
.recent-content > div:first-child { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px 8px; }
.recent-content > div:first-child .overall-score { grid-row: span 2; }
.recent-content > div:first-child .summary-stars { margin: 0; }
.recent-content > div:first-child p { grid-column: 2; }
.recent-content > div:first-child > p:first-of-type:last-child { align-self: start; }
.recent-good-rate { position: relative; width: 100px; height: 70px; text-align: center; }
.recent-good-rate svg { width: 100%; height: 64px; }
.rate-track, .rate-value { fill: none; stroke-width: 6; stroke-linecap: round; }
.rate-track { stroke: var(--border-light); }
.rate-value { stroke: #ffab00; }
.recent-good-rate strong { position: absolute; top: 20px; left: 0; right: 0; font-size: 20px; }
.recent-good-rate small { position: absolute; bottom: 0; left: 0; right: 0; }
.rating-distribution { display: grid; gap: 4px; }
.rating-distribution button, .dimension-row { display: grid; grid-template-columns: 40px 1fr 60px; align-items: center; gap: 10px; min-height: 30px; }
.rating-distribution button { background: transparent; color: var(--text-secondary); border: 0; border-radius: 6px; font: inherit; font-size: 10px; cursor: pointer; text-align: right; padding: 3px 6px; }
.rating-distribution button[aria-pressed="true"], .rating-distribution button:hover { background: var(--surface-hover); color: var(--brand-primary); }
.rating-bar { display: block; height: 6px; border-radius: 4px; background: var(--surface-variant, var(--border-light)); overflow: hidden; }
.rating-bar > span { display: block; height: 100%; border-radius: inherit; background: #ef8b13; }
.dimension-content { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.rating-radar { width: 100%; min-width: 0; height: auto; }
.radar-grid { stroke: var(--border-light); fill: none; }
.radar-scores { fill: #ffab004d; stroke: #ffab00; stroke-width: 1.5; }
.rating-radar text { fill: var(--text-primary); font-size: 10px; }
.dimension-values { flex: 1; min-width: 0; }
.dimension-row { grid-template-columns: 1fr 36px; font-size: 12px; margin-bottom: 10px; }
.dimension-row span { overflow-wrap: anywhere; }
.dimension-row small { display: block; margin-top: 4px; }
.dimension-row strong { color: #ffab00; text-align: right; font-size: 14px; font-weight: 500; }
.detail-count { color: var(--text-secondary); font-size: 12px; margin-top: 12px; text-align: center; }
.radar-description { fill: var(--text-secondary); font-size: 9px; }
.rating-list-header { margin-top: 12px; border-radius: 8px 8px 0 0; }
.rating-star-selector { display: flex; border-radius: 13px; background: var(--surface-variant, var(--background)); padding: 1px; margin: 12px 0; min-height: 26px; }
.rating-star-selector button { flex: 1; min-width: 0; padding: 4px 0; border: 0; border-radius: 12px; font: inherit; font-size: 12px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.rating-star-selector button[aria-pressed="true"] { background: var(--surface); color: var(--text-primary); box-shadow: 0 1px 4px #0001; }
.rating-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
.rating-filters button { border: 0; border-radius: 6px; padding: 6px 7px; font: inherit; background: var(--surface-variant, var(--background)); color: var(--text-secondary); cursor: pointer; }
.rating-filters button[aria-pressed="true"] { background: #00b96815; color: var(--brand-primary); }
.rating-reviews { display: flex; flex-direction: column; gap: 0; background: var(--surface); border-radius: 0 0 8px 8px; }
.rating-review { padding: 12px 16px; border-radius: 0; background: var(--surface); min-width: 0; cursor: pointer; }
.review-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.review-user { display: flex; align-items: center; gap: 10px; background: transparent; border: 0; padding: 0; color: var(--text-primary); cursor: pointer; text-align: left; font: inherit; min-width: 0; }
.review-user:disabled { cursor: default; }
.review-user > span { display: flex; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
.review-score { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; color: #ef8b13; font-size: 13px; }
.review-badges { display: flex; gap: 6px; }.review-badges button,.review-badges small { background: #009bff0d; border: 1px solid #2196f3; border-radius: 2px; color: #2196f3; padding: 2px 3px; font: inherit; font-size: 11px; cursor: pointer; }.review-badges small { color: #00bcd4; border-color: #00bcd4; }
.review-score i { color: var(--border); font-size: 11px; margin-right: 2px; }
.review-score i { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 3px; background: var(--border-light); color: white; font-size: 9px; }
.review-score i.filled { background: #ffb900; color: white; }
.review-dimensions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.review-dimensions > span { background: var(--surface-variant, var(--surface-hover)); border-radius: 6px; padding: 5px 8px; font-size: 12px; color: var(--text-secondary); }
.review-dimensions strong { color: #ef8b13; }
.review-text { margin-top: 14px; line-height: 1.7; overflow-wrap: anywhere; }
.review-text :deep(img) { max-width: 100%; }
.review-no-text { margin-top: 12px; color: var(--text-tertiary); font-size: 13px; }
.review-no-text button { border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; }
.review-footer { display: flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end; margin-top: 12px; font-size: 12px; color: var(--text-tertiary); }
.review-footer button { border: 0; padding: 0; background: transparent; font: inherit; color: var(--brand-primary); cursor: pointer; }
.load-more { align-self: center; padding: 10px 24px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-primary); cursor: pointer; }
.load-error { color: var(--color-danger, #ef4444); text-align: center; }
.no-more { text-align: center; color: var(--text-tertiary); font-size: 12px; padding: 12px; }
@media (max-width: 720px) {
  .rating-overview { display: flex; flex-direction: column; }
  .rating-overview-column { display: contents; }
  .rating-summary-card { order: 1; }
  .recent-rating { order: 2; }
  .rating-dimensions { order: 3; }
  .rating-overview :deep(.rating-trend) { order: 4; }
  .rating-overview-column > * { width: 100%; box-sizing: border-box; }
  .rating-overview > * { width: 100%; box-sizing: border-box; }
  .rating-topic-header { border-radius: 0; margin: -12px -12px 12px; }
  .overall-score { font-size: 36px; }
  .rating-distribution button { grid-template-columns: 28px 1fr 42px; gap: 6px; padding: 3px 0; }
  .rating-reviews { gap: 0; background: var(--surface); border-radius: 0 0 8px 8px; overflow: hidden; }
  .rating-review { padding: 12px 16px; border-radius: 0; }
}
</style>
