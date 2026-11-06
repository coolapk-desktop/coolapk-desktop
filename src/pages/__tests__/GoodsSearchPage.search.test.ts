import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchGoods: vi.fn(),
  getGoodsSearchHotWords: vi.fn().mockResolvedValue({ data: [] }),
  openUrl: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));

import GoodsSearchPage from '../GoodsSearchPage.vue';

const goods = (id: string, title: string) => ({ id, goods_title: title, goods_promo_price: '9.9', mall_title: '京东' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

async function mountPage(path = '/goods?tab=search') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/goods', component: GoodsSearchPage }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(GoodsSearchPage, {
    global: {
      plugins: [createPinia(), router],
      stubs: {
        AppButton: { template: '<button class="app-button"><slot /></button>' },
        AppImage: true,
        LoadingState: { template: '<div class="loading-state" />' },
        ErrorState: true,
        EmptyState: true,
      },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

describe('好物搜索：请求竞态与地址栏状态', () => {
  it('加载中切换排序会重发请求，且只有最后一次结果落地', async () => {
    mocks.searchGoods.mockReset();
    mocks.getGoodsSearchHotWords.mockResolvedValue({ data: [] });
    const first = deferred<unknown>();
    mocks.searchGoods.mockImplementationOnce(() => first.promise);
    const second = deferred<unknown>();
    mocks.searchGoods.mockImplementationOnce(() => second.promise);

    const { wrapper, router } = await mountPage();
    try {
      const input = wrapper.get('.search-input');
      await input.setValue('耳机');
      await input.trigger('keyup.enter');
      await flushPromises();
      expect(mocks.searchGoods).toHaveBeenCalledTimes(1);
      expect(mocks.searchGoods.mock.calls[0][0]).toMatchObject({ keyword: '耳机', sortName: 'default', page: 1 });

      // 第一笔请求仍挂起时切换排序：不再被 searching 静默丢弃，而是重发并作废旧请求。
      const sortButtons = wrapper.findAll('.filter-option');
      await sortButtons[2].trigger('click');
      await flushPromises();
      expect(mocks.searchGoods).toHaveBeenCalledTimes(2);
      expect(mocks.searchGoods.mock.calls[1][0]).toMatchObject({ keyword: '耳机', sortName: 'price', sort: 'asc', page: 1 });
      expect(sortButtons[2].classes()).toContain('is-active');
      expect(router.currentRoute.value.query).toMatchObject({ tab: 'search', q: '耳机', sort: 'price_asc' });

      // 新请求先返回。
      second.resolve({ data: [goods('new', '新排序结果')] });
      await flushPromises();
      expect(wrapper.text()).toContain('新排序结果');

      // 旧的综合排序结果迟到，必须被丢弃，不能覆盖高亮的排序与列表。
      first.resolve({ data: [goods('old', '旧排序结果')] });
      await flushPromises();
      expect(wrapper.text()).toContain('新排序结果');
      expect(wrapper.text()).not.toContain('旧排序结果');
      expect(wrapper.findAll('.goods-card')).toHaveLength(1);
      expect(wrapper.get('.filter-option.is-active').text()).toBe('价格↑');
    } finally {
      wrapper.unmount();
    }
  });

  it('加载中切换只看优惠券同样重发，并以最终条件请求', async () => {
    mocks.searchGoods.mockReset();
    mocks.getGoodsSearchHotWords.mockResolvedValue({ data: [] });
    const first = deferred<unknown>();
    mocks.searchGoods.mockImplementationOnce(() => first.promise);
    mocks.searchGoods.mockImplementationOnce(() => Promise.resolve({ data: [goods('c1', '优惠券结果')] }));

    const { wrapper, router } = await mountPage();
    try {
      const input = wrapper.get('.search-input');
      await input.setValue('键盘');
      await input.trigger('keyup.enter');
      await flushPromises();

      await wrapper.get('.coupon-toggle').trigger('click');
      await flushPromises();
      expect(mocks.searchGoods).toHaveBeenCalledTimes(2);
      expect(mocks.searchGoods.mock.calls[1][0]).toMatchObject({ keyword: '键盘', isCoupon: true, page: 1 });
      expect(wrapper.get('.coupon-toggle').classes()).toContain('is-on');
      expect(router.currentRoute.value.query).toMatchObject({ q: '键盘', coupon: '1' });

      first.resolve({ data: [] });
      await flushPromises();
      expect(wrapper.text()).toContain('优惠券结果');
      expect(wrapper.text()).not.toContain('没有找到相关好物');
    } finally {
      wrapper.unmount();
    }
  });

  it('带 q/sort/coupon 进入时按地址条件自动搜索', async () => {
    mocks.searchGoods.mockReset();
    mocks.getGoodsSearchHotWords.mockResolvedValue({ data: [] });
    mocks.searchGoods.mockResolvedValue({ data: [goods('r1', '路由恢复结果')] });

    const { wrapper } = await mountPage('/goods?tab=search&q=机械键盘&sort=sell&coupon=1');
    try {
      expect(mocks.searchGoods).toHaveBeenCalledTimes(1);
      expect(mocks.searchGoods.mock.calls[0][0]).toMatchObject({
        keyword: '机械键盘',
        sortName: 'sell',
        sort: 'sell',
        isCoupon: true,
        page: 1,
      });
      expect((wrapper.get('.search-input').element as HTMLInputElement).value).toBe('机械键盘');
      expect(wrapper.get('.filter-option.is-active').text()).toBe('销量');
      expect(wrapper.get('.coupon-toggle').classes()).toContain('is-on');
      expect(wrapper.text()).toContain('路由恢复结果');
    } finally {
      wrapper.unmount();
    }
  });
});
