import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchGoods: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: mocks }));

import GoodsSearchPickerDialog from '../GoodsSearchPickerDialog.vue';

const goods = (id: string, title: string) => ({ id, goods_title: title, goods_price: '19' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function mountDialog() {
  return mount(GoodsSearchPickerDialog, {
    props: { isOpen: true },
    global: {
      stubs: {
        Teleport: true,
        AppButton: { template: '<button class="app-button"><slot /></button>' },
        AppImage: true,
        LoadingState: { template: '<div class="loading-state" />' },
        EmptyState: true,
      },
    },
  });
}

describe('好物选择弹窗：搜索竞态', () => {
  it('旧响应不覆盖新关键词的结果', async () => {
    mocks.searchGoods.mockReset();
    const old = deferred<unknown>();
    mocks.searchGoods.mockImplementationOnce(() => old.promise);
    mocks.searchGoods.mockImplementationOnce(() => Promise.resolve({ data: [goods('new', '新关键词商品')] }));

    const wrapper = mountDialog();
    try {
      const input = wrapper.get('.search-input');
      await input.setValue('旧词');
      await input.trigger('keyup.enter');
      await flushPromises();
      expect(mocks.searchGoods).toHaveBeenCalledTimes(1);

      // 加载中重复回车：视为作废旧请求后按新关键词重发，而不是被 searching 静默丢弃。
      await input.setValue('新词');
      await input.trigger('keyup.enter');
      await flushPromises();
      expect(mocks.searchGoods).toHaveBeenCalledTimes(2);
      expect(mocks.searchGoods.mock.calls[1][0]).toMatchObject({ keyword: '新词', page: 1 });
      expect(wrapper.text()).toContain('新关键词商品');

      old.resolve({ data: [goods('old', '旧关键词商品')] });
      await flushPromises();
      expect(wrapper.text()).toContain('新关键词商品');
      expect(wrapper.text()).not.toContain('旧关键词商品');
    } finally {
      wrapper.unmount();
    }
  });

  it('新搜索会让在途的加载更多结果作废', async () => {
    mocks.searchGoods.mockReset();
    mocks.searchGoods.mockImplementationOnce(() => Promise.resolve({ data: [goods('p1', '第一页商品')] }));
    const more = deferred<unknown>();
    mocks.searchGoods.mockImplementationOnce(() => more.promise);
    mocks.searchGoods.mockImplementationOnce(() => Promise.resolve({ data: [goods('n1', '换词后商品')] }));

    const wrapper = mountDialog();
    try {
      const input = wrapper.get('.search-input');
      await input.setValue('键盘');
      await input.trigger('keyup.enter');
      await flushPromises();
      expect(wrapper.text()).toContain('第一页商品');

      // 加载更多挂起中切换关键词，分页响应必须被丢弃，不能拼进新结果。
      await wrapper.get('.picker-footer-hint .app-button').trigger('click');
      await flushPromises();
      expect(mocks.searchGoods).toHaveBeenCalledTimes(2);

      await input.setValue('鼠标');
      await input.trigger('keyup.enter');
      await flushPromises();
      expect(mocks.searchGoods).toHaveBeenCalledTimes(3);
      expect(wrapper.text()).toContain('换词后商品');

      more.resolve({ data: [goods('p2', '第二页商品')] });
      await flushPromises();
      expect(wrapper.text()).not.toContain('第二页商品');
      expect(wrapper.text()).not.toContain('第一页商品');
    } finally {
      wrapper.unmount();
    }
  });
});
