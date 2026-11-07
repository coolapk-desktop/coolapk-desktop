import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  voteGoodsListItem: vi.fn(),
  openUrl: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: { voteGoodsListItem: mocks.voteGoodsListItem, openUrl: mocks.openUrl },
}));

vi.mock('../../../utils/toast', () => ({ showToast: mocks.showToast }));

vi.mock('../../../stores/auth', () => ({
  useAuthStore: () => ({ isLoggedIn: true, openLoginModal: vi.fn() }),
}));

import GoodsListItemCard from '../GoodsListItemCard.vue';

const item = (voteNum: number) => ({
  id: 'item-1',
  goods_title: '商品',
  goodsListInfo: { item_id: 'item-1', vote_num: voteNum },
});

function mountCard(voteNum: number) {
  return mount(GoodsListItemCard, {
    props: { item: item(voteNum), goodsListId: 'list-1' },
    global: {
      stubs: { AppImage: true },
    },
  });
}

describe('好物条目卡片：票数跟随数据源', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    mocks.voteGoodsListItem.mockResolvedValue({ code: 200 });
  });

  it('父组件重拉替换 item 后，票数显示服务端最新值而不是初始快照', async () => {
    const wrapper = mountCard(3);
    try {
      expect(wrapper.get('.vote-btn').text()).toContain('3');
      // 父组件整体重拉：同一个 key，组件被复用，但 item 换成新对象
      await wrapper.setProps({ item: item(9) });
      await flushPromises();
      expect(wrapper.get('.vote-btn').text()).toContain('9');
    } finally {
      wrapper.unmount();
    }
  });

  it('投票成功后票数与状态立即生效', async () => {
    const wrapper = mountCard(5);
    try {
      await wrapper.get('.vote-btn').trigger('click');
      await flushPromises();
      expect(mocks.voteGoodsListItem).toHaveBeenCalledWith('list-1', 'item-1', 1);
      expect(wrapper.get('.vote-btn').text()).toContain('6');
      expect(wrapper.get('.vote-btn').classes()).toContain('is-active');
    } finally {
      wrapper.unmount();
    }
  });
});
