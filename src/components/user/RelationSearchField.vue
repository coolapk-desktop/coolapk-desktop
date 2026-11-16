<template>
  <div class="relation-search">
    <i class="fas fa-search search-icon" aria-hidden="true"></i>
    <input ref="input" v-model="search" type="search" :placeholder="placeholder" :aria-label="placeholder" @keydown.esc.stop="clear" />
    <button v-if="search" type="button" class="clear-search" aria-label="清空搜索" @click="clear">
      <i class="fas fa-times" aria-hidden="true"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ placeholder: string }>();
const search = defineModel<string>({ required: true });
const input = ref<HTMLInputElement>();

function clear() {
  search.value = '';
  input.value?.focus();
}
</script>

<style scoped>
.relation-search { position: relative; display: flex; align-items: center; min-width: 0; }
.search-icon { position: absolute; left: 14px; font-size: 13px; color: var(--text-secondary); pointer-events: none; }
input {
  width: 100%;
  min-width: 0;
  height: 40px;
  padding: 0 40px 0 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--background);
  color: var(--text-primary);
  font: inherit;
  font-size: 16px;
}
input::placeholder { color: var(--text-secondary); }
input:focus-visible { outline: 2px solid var(--brand-primary); outline-offset: 1px; }
input::-webkit-search-cancel-button { display: none; }
.clear-search {
  position: absolute;
  right: 2px;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.clear-search:hover { color: var(--text-primary); background: var(--surface-hover); }
</style>
