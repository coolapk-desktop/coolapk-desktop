<template>
  <img v-if="icon" class="official-nav-icon" :class="{ 'is-highlighted': active }" :src="icon" alt="" />
  <i v-else :class="fallback" aria-hidden="true"></i>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import home from '../../assets/icons/bottom-nav/ic_home_white_24dp.png';
import digital from '../../assets/icons/bottom-nav/ic_phonebar_white_24dp.png';
import discover from '../../assets/icons/bottom-nav/ic_discovery_white_24dp.png';
import profile from '../../assets/icons/bottom-nav/ic_me_white_24dp.png';
import pictures from '../../assets/icons/bottom-nav/ic_image_white_24dp.png';
import more from '../../assets/icons/bottom-nav/ic_more_horiz_white_24dp.png';
import notifications from '../../assets/icons/bottom-nav/ic_notifications_white_24dp.png';
import history from '../../assets/icons/bottom-nav/ic_clock_white_24dp.png';
import favorites from '../../assets/icons/bottom-nav/ic_wodeshoucang_white_24dp.png';
import topic from '../../assets/icons/publish/topic.svg';
import messages from '../../assets/official-profile/ic_mail_outline.svg';
import settings from '../../assets/official-profile/ic_setting.svg';

const props = defineProps<{ route: string; active?: boolean; fallback?: string }>();
const icons = new Map([
  ['/', home], ['/digital', digital], ['/discover', discover],
  ['/me', profile], ['/my', profile], ['/topics', topic], ['/topic', topic],
  ['/pictures', pictures], ['/more', more], ['/notifications', notifications],
  ['/messages', messages], ['/history', history], ['/favorites', favorites], ['/settings', settings],
]);

const icon = computed(() => {
  const path = props.route.split(/[?#]/, 1)[0] || '/';
  return icons.get(path) || icons.get('/' + path.split('/')[1]);
});
</script>

<style scoped>
.official-nav-icon {
  display: block;
  flex-shrink: 0;
  width: var(--official-nav-icon-size, 20px);
  height: var(--official-nav-icon-size, 20px);
  object-fit: contain;
  filter: brightness(0) invert(.4);
}

:global([data-theme="dark"]) .official-nav-icon {
  filter: brightness(0) invert(.72);
}

.official-nav-icon.is-highlighted {
  filter: brightness(0) saturate(100%) invert(52%) sepia(86%) saturate(1704%) hue-rotate(115deg) brightness(92%) contrast(92%);
}
</style>
