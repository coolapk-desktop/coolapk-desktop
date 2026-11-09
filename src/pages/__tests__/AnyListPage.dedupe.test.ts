import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUserProductAlbums: vi.fn(), push: vi.fn() }));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: { getUserProductAlbums: mocks.getUserProductAlbums },
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return { ...actual, useRouter: () => ({ push: mocks.push }) };
});

vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ isLoggedIn: true, user: { uid: '10001' } }),
}));

import AnyListPage from '../AnyListPage.vue';

function album(id: string, title: string) {
  return { id, title, message: '描述', item_num: 2 };
}

function setScrollable(wrapper: any) {
  const page = wrapper.get('.page-container').element as HTMLElement;
  Object.defineProperty(page, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(page, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(page, 'scrollTop', { value: 900, configurable: true });
}

async function mountPage() {
  const wrapper = mount(AnyListPage, {
    global: {
      plugins: [createPinia()],
      stubs: { AppImage: true, LoadingState: true, EmptyState: true, AppButton: true },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('万物清单列表：翻页去重', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('服务端翻页返回重叠条目时不产生重复卡片', async () => {
    mocks.getUserProductAlbums
      .mockResolvedValueOnce({ data: [album('a', '清单A'), album('b', '清单B')] })
      .mockResolvedValueOnce({ data: [album('b', '清单B'), album('c', '清单C')] });
    const wrapper = await mountPage();
    try {
      expect(wrapper.findAll('.album-card, .anylist-card, .goods-list-card').length).toBeGreaterThan(0);
      setScrollable(wrapper);
      await wrapper.get('.page-container').trigger('scroll');
      await flushPromises();

      const titles = wrapper.text();
      // b 只应出现一次：断言卡片数量与去重后的 3 条一致
      const cards = wrapper.findAll('.album-card, .anylist-card, .goods-list-card');
      expect(cards).toHaveLength(3);
      expect(titles).toContain('清单C');
    } finally {
      wrapper.unmount();
    }
  });
});
