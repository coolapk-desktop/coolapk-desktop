import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { computed, defineComponent, h, KeepAlive } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { getKeepAliveMax, getPageComponentKey } from '../utils/pageTabs';
import { usePageTabsStore } from '../stores/pageTabs';

/**
 * App.vue 的 keep-alive 接线：槽位跟随页签增长，组件 key 按页面实例身份生成。
 * 这里用与 App.vue 相同的写法搭骨架，覆盖「临时 query 不额外占槽」与「>15 个页面后仍返回原实例」。
 */
let created = 0;
const Probe = defineComponent({
  props: { tag: { type: String, default: '' } },
  setup(props) {
    created += 1;
    const id = created;
    return () => h('div', { class: 'probe', 'data-id': String(id) }, `${props.tag}:${id}`);
  },
});

async function mountHost() {
  created = 0;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Probe },
      { path: '/topic/:tag', component: Probe, props: true },
    ],
  });
  const pinia = createPinia();
  const store = usePageTabsStore(pinia);
  const host = defineComponent({
    setup() {
      const max = computed(() => getKeepAliveMax(store.tabs.length));
      return () => h(RouterView, null, {
        default: ({ Component, route }: any) => h(KeepAlive, { max: max.value }, {
          default: () => Component ? h(Component, { key: getPageComponentKey(route, store.getGeneration(route)) }) : null,
        }),
      });
    },
  });
  // 与 App.vue 一致：每次路由变化都把地址登记为页签。
  router.afterEach((to) => store.syncRoute(to));
  const wrapper = mount(host, { global: { plugins: [pinia, router] } });
  await router.push('/');
  await router.isReady();
  return { wrapper, router, store };
}

describe('App keep-alive 槽位', () => {
  beforeEach(() => { localStorage.clear(); });

  it('同一实体的临时 query 复用同一个实例', async () => {
    const { wrapper, router, store } = await mountHost();
    try {
      await router.push('/topic/摄影?type=hot');
      const first = wrapper.get('.probe').attributes('data-id');
      await router.push('/topic/摄影?type=latest&title=摄影圈&from=home');
      expect(wrapper.get('.probe').attributes('data-id')).toBe(first);
      expect(store.tabs).toHaveLength(2);
    } finally {
      wrapper.unmount();
    }
  });

  it('打开超过 15 个页面后返回，列表实例仍在缓存中', async () => {
    const { wrapper, router, store } = await mountHost();
    try {
      await router.push('/topic/话题0');
      const first = wrapper.get('.probe').attributes('data-id');
      for (let index = 1; index <= 20; index += 1) {
        await router.push(`/topic/话题${index}`);
      }
      // 已开 22 个页签：缓存上限随页签升到 27，早先的列表不会被淘汰。
      expect(store.tabs).toHaveLength(22);
      expect(getKeepAliveMax(store.tabs.length)).toBe(27);
      await router.push('/topic/话题0');
      expect(wrapper.get('.probe').attributes('data-id')).toBe(first);
    } finally {
      wrapper.unmount();
    }
  });

  it('App.vue 使用随页签增长的缓存上限和页面实例 key', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/App.vue'), 'utf8');
    expect(source).toContain(':max="keepAliveMax"');
    expect(source).not.toContain(':max="15"');
    expect(source).toContain('getKeepAliveMax(pageTabsStore.tabs.length)');
    expect(source).toContain('getPageComponentKey(route, pageTabsStore.getGeneration(route))');
  });
});
