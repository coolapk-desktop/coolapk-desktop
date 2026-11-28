import { flushPromises, mount, shallowMount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import AppContextMenu from '../../components/common/AppContextMenu.vue';
import UserPage from '../UserPage.vue';

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getUserSpace: async () => ({
      data: { uid: '42', username: '酷友甲', level: 3, homeTabCardRows: [{}] },
    }),
    getUserProfile: async () => ({ data: null }),
    getUserTabData: async () => ({ data: [] }),
  },
}));

it('从个人主页昵称的右键菜单复制完整昵称', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/user/:uid', component: UserPage }],
  });
  await router.push('/user/42');

  const options = { attachTo: document.body, global: { plugins: [pinia, router] } };
  const page = shallowMount(UserPage, options);
  const contextMenu = mount(AppContextMenu, options);

  try {
    await flushPromises();
    const username = page.get('h1.app-username');
    await username.trigger('contextmenu');

    const copy = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu-item'))
      .find(item => item.textContent?.trim() === '复制用户名');
    expect(copy).toBeDefined();
    copy?.click();
    expect(writeText).toHaveBeenCalledWith('酷友甲');
  } finally {
    contextMenu.unmount();
    page.unmount();
    vi.unstubAllGlobals();
  }
});
