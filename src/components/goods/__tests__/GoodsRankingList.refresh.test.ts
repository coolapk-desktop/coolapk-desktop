import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { KeepAlive, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGoodsList: vi.fn(),
  getGoodsListTypes: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getGoodsList: mocks.getGoodsList,
    getGoodsListTypes: mocks.getGoodsListTypes,
  },
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return { ...actual, useRouter: () => ({ push: mocks.routerPush }) };
});

const toastMocks = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../../../utils/toast', () => ({ showToast: toastMocks.showToast }));

import GoodsRankingList from '../GoodsRankingList.vue';

const row = (id: string, title: string) => ({
  id,
  goodsListInfo: { id, title, list_type: '1', item_num: 3 },
});

async function mountInKeepAlive() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });
  await router.push('/');
  const visible = ref(true);
  const wrapper = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, {
      default: () => (visible.value
        ? h(GoodsRankingList, { kind: 'lists', title: '好物清单', subtitle: '全部' })
        : h('div')),
    }),
  }), {
    attachTo: document.body,
    global: {
      plugins: [createPinia(), router],
      stubs: {
        AppButton: { props: ['size', 'variant', 'icon'], template: '<button class="app-button"><slot /></button>' },
        AppImage: true,
        LoadingState: true,
        ErrorState: true,
        EmptyState: { props: ['title', 'description'], template: '<div class="empty-state"><div class="empty-title">{{ title }}</div><div class="empty-desc">{{ description }}</div></div>' },
        CreateGoodsListDialog: true,
      },
    },
  });
  await flushPromises();
  return { wrapper, visible };
}

async function deactivateThenActivate(ctx: Awaited<ReturnType<typeof mountInKeepAlive>>) {
  ctx.visible.value = false;
  await nextTick();
  await flushPromises();
  ctx.visible.value = true;
  await nextTick();
  await flushPromises();
  await flushPromises();
}

describe('好物清单列表：返回时静默刷新与滚动源判定', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    mocks.getGoodsListTypes.mockResolvedValue({ data: [] });
  });

  it('返回列表时把服务端新增的清单插到头部，而不是只覆盖旧行', async () => {
    mocks.getGoodsList.mockResolvedValue({ data: [row('a', '清单A'), row('b', '清单B')] });
    const ctx = await mountInKeepAlive();
    try {
      expect(ctx.wrapper.text()).toContain('清单A');
      expect(ctx.wrapper.text()).not.toContain('清单C');

      // keep-alive 重新激活时第 1 页出现了新清单 C
      mocks.getGoodsList.mockResolvedValue({ data: [row('c', '清单C'), row('a', '清单A'), row('b', '清单B')] });
      await deactivateThenActivate(ctx);

      expect(ctx.wrapper.text()).toContain('清单C');
      const titles = ctx.wrapper.findAll('.goods-list-title, .list-title, .item-title').map((n) => n.text());
      if (titles.length) expect(titles[0]).toContain('清单C');
      // 不得因为合并把已有行丢掉
      expect(ctx.wrapper.text()).toContain('清单A');
      expect(ctx.wrapper.text()).toContain('清单B');
    } finally {
      ctx.wrapper.unmount();
    }
  });

  it('分类筛选后未加载页里可能有命中时，提示继续加载而不是宣判「暂无」', async () => {
    mocks.getGoodsListTypes.mockResolvedValue({ data: [{ id: '2', title: '分类二' }] });
    mocks.getGoodsList.mockResolvedValue({ data: [row('a', '清单A')] });
    const ctx = await mountInKeepAlive();
    try {
      // 已加载的行都属于分类 1，切到分类 2 时本地结果为空但后面还有分页
      const chips = ctx.wrapper.findAll('.category-chip');
      const typeChip = chips.find((chip) => chip.text().includes('分类二'));
      expect(typeChip).toBeDefined();
      await typeChip!.trigger('click');
      await flushPromises();

      expect(ctx.wrapper.get('.empty-title').text()).toContain('已加载内容中暂无');
      expect(ctx.wrapper.get('.empty-desc').text()).toContain('继续加载下一页');
      expect(ctx.wrapper.findAll('button').some((b) => b.text().includes('加载更多'))).toBe(true);
    } finally {
      ctx.wrapper.unmount();
    }
  });

  it('没有标识的条目点击时给出提示，而不是静默无反应', async () => {
    mocks.getGoodsListTypes.mockResolvedValue({ data: [] });
    mocks.getGoodsList.mockResolvedValue({ data: [{ uid: '9', dateline: '1700000000', goodsListInfo: { title: '无 id 清单' } }] });
    const ctx = await mountInKeepAlive();
    try {
      await ctx.wrapper.get('.goods-list-card').trigger('click');
      await flushPromises();
      expect(mocks.routerPush).not.toHaveBeenCalled();
      expect(String(toastMocks.showToast.mock.calls.at(-1)![0])).toContain('缺少标识');
    } finally {
      ctx.wrapper.unmount();
    }
  });

  it('只在自身纵向滚动容器触底时翻页，横向滚动条事件不消耗分页', async () => {
    mocks.getGoodsList.mockResolvedValue({ data: [row('a', '清单A')] });
    const ctx = await mountInKeepAlive();
    try {
      const root = ctx.wrapper.get('.page-container').element as HTMLElement;
      Object.defineProperty(root, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(root, 'clientHeight', { value: 800, configurable: true });
      Object.defineProperty(root, 'scrollTop', { value: 900, configurable: true });

      const callsAfterMount = mocks.getGoodsList.mock.calls.length;

      // 横向滚动元素（如分类 chips 条）触发的 scroll：不能翻页
      const scroller = document.createElement('div');
      document.body.appendChild(scroller);
      Object.defineProperty(scroller, 'scrollHeight', { value: 40, configurable: true });
      Object.defineProperty(scroller, 'clientHeight', { value: 40, configurable: true });
      Object.defineProperty(scroller, 'scrollTop', { value: 0, configurable: true });
      scroller.dispatchEvent(new Event('scroll'));
      await flushPromises();
      expect(mocks.getGoodsList.mock.calls.length).toBe(callsAfterMount);

      // 自身容器触底：正常翻页
      root.dispatchEvent(new Event('scroll'));
      await flushPromises();
      expect(mocks.getGoodsList.mock.calls.length).toBe(callsAfterMount + 1);
      document.body.removeChild(scroller);
    } finally {
      ctx.wrapper.unmount();
    }
  });
});
