import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteLocationNormalizedLoaded } from 'vue-router';

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  currentRoute: { value: { path: '/', fullPath: '/' } },
}));

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return {
    ...actual,
    useRouter: () => routerMock,
  };
});

import PageTabBar from '../PageTabBar.vue';
import { usePageTabsStore } from '../../../stores/pageTabs';
import { resetHomeTabClickState } from '../../../utils/homeTab';
import { consumePageTabTransition, resetPageTabTransition } from '../../../utils/routeTransition';

function fakeRoute(path: string, title?: string): RouteLocationNormalizedLoaded {
  const parts = path.split('/').filter(Boolean);
  const id = parts[1];
  return {
    path,
    fullPath: path,
    name: path.startsWith('/product/') ? 'Product' : path.startsWith('/user/') ? 'User' : 'Home',
    params: id ? { id } : {},
    query: {},
    hash: '',
    matched: [],
    redirectedFrom: undefined,
    meta: title ? { title } : {},
  } as unknown as RouteLocationNormalizedLoaded;
}

describe('PageTabBar 切换与关闭标签页过渡标记', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetHomeTabClickState();
    resetPageTabTransition();
    routerMock.currentRoute.value = { path: '/user/123', fullPath: '/user/123' };
  });

  afterEach(() => {
    resetHomeTabTransitionState();
  });

  function resetHomeTabTransitionState() {
    resetPageTabTransition();
    resetHomeTabClickState();
  }

  it('点击已打开详情页签切页时激活页签切换标记，点击当前已激活页签不误触', async () => {
    const store = usePageTabsStore();
    store.syncRoute(fakeRoute('/user/123', '手機攝影分享'));
    store.syncRoute(fakeRoute('/product/5735', '产品 5735'));
    store.activate('User:123');

    const wrapper = mount(PageTabBar, {
      props: { showTabs: true, showNavigation: false },
      global: { stubs: { OfficialNavIcon: true, PageNavigation: true } },
    });
    try {
      // 点击产品详情标签：应触发页签切换标记并用 push 切过去
      const productTab = wrapper.find('[data-tab-id="Product:5735"]');
      expect(productTab.exists()).toBe(true);
      await productTab.trigger('click');
      expect(routerMock.push).toHaveBeenCalledWith('/product/5735');
      expect(consumePageTabTransition()).toBe(true);

      // 当前已在 /product/5735 时再次点击自身标签，不应导航也不留下过渡标记
      vi.clearAllMocks();
      routerMock.currentRoute.value = { path: '/product/5735', fullPath: '/product/5735' };
      await productTab.trigger('click');
      expect(routerMock.push).not.toHaveBeenCalled();
      expect(consumePageTabTransition()).toBe(false);

      // 非首页点击「首页」标签应触发页签切换标记并回到 '/'
      const homeTab = wrapper.find('[data-tab-id="home"]');
      await homeTab.trigger('click');
      expect(routerMock.push).toHaveBeenCalledWith('/');
      expect(consumePageTabTransition()).toBe(true);

      // 已在首页点击「首页」只回顶不跳转，也不得残留过渡标记
      vi.clearAllMocks();
      routerMock.currentRoute.value = { path: '/', fullPath: '/' };
      await homeTab.trigger('click');
      expect(routerMock.push).not.toHaveBeenCalled();
      expect(consumePageTabTransition()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('关闭当前详情页签落回相邻页签时触发页签切换标记，关闭后台页签不触发', async () => {
    const store = usePageTabsStore();
    store.syncRoute(fakeRoute('/product/5000', 'OPPO Find X9 Ultra'));
    store.syncRoute(fakeRoute('/product/5735', '产品 5735'));
    routerMock.currentRoute.value = { path: '/product/5735', fullPath: '/product/5735' };

    const wrapper = mount(PageTabBar, {
      props: { showTabs: true, showNavigation: false },
      global: { stubs: { OfficialNavIcon: true, PageNavigation: true } },
    });
    try {
      // 关闭未激活的后台页签：不跳转也不触发过渡标记
      await wrapper.find('[data-tab-id="Product:5000"] .page-tab-close').trigger('click');
      await flushPromises();
      expect(routerMock.replace).not.toHaveBeenCalled();
      expect(consumePageTabTransition()).toBe(false);

      // 重新打开两个详情页签并关闭当前激活的产品标签 -> 落回相邻详情标签时应触发标记
      store.syncRoute(fakeRoute('/product/5000', 'OPPO Find X9 Ultra'));
      store.syncRoute(fakeRoute('/product/5735', '产品 5735'));
      await wrapper.find('[data-tab-id="Product:5735"] .page-tab-close').trigger('click');
      await flushPromises();
      expect(routerMock.replace).toHaveBeenCalledWith('/product/5000');
      expect(consumePageTabTransition()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});
