import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  getUserAlbumList: vi.fn(),
  getAlbumDetail: vi.fn(),
  editAlbum: vi.fn(),
  createAlbum: vi.fn(),
  addAlbumApk: vi.fn(),
  deleteAlbumApk: vi.fn(),
  uploadImage: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }));
vi.mock('../../router', () => ({ router: mocks.router }));
vi.mock('../../utils/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getUserAlbumList: mocks.getUserAlbumList,
    getAlbumDetail: mocks.getAlbumDetail,
    editAlbum: mocks.editAlbum,
    createAlbum: mocks.createAlbum,
    addAlbumApk: mocks.addAlbumApk,
    deleteAlbumApk: mocks.deleteAlbumApk,
    uploadImage: mocks.uploadImage,
  },
}));

// AppDialog 渲染默认插槽，方便触发表单提交。
const AppDialogStub = {
  name: 'AppDialogStub',
  props: ['isOpen', 'title', 'width'],
  template: '<div v-if="isOpen" class="dialog-stub"><slot /></div>',
};

import MyAlbumsPage from '../MyAlbumsPage.vue';
import { useAuthStore } from '../../stores/auth';

const albums = [
  { id: 'a1', title: '专辑A', intro: '' },
  { id: 'a2', title: '专辑B', intro: '' },
];

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore(pinia);
  authStore.isLoggedIn = true;
  authStore.user = { uid: '10001', username: '测试用户' } as any;
  mocks.getUserAlbumList.mockResolvedValue({ data: albums });
  const wrapper = mount(MyAlbumsPage, {
    global: {
      plugins: [pinia],
      stubs: {
        AppDialog: AppDialogStub,
        AppButton: true,
        AppImage: true,
        LoadingState: true,
        EmptyState: true,
        ErrorState: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('MyAlbumsPage 写操作失败可见性', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('albums 非空时保存专辑失败：toast 报错、对话框保持打开、列表不清空、列表级 error 不被污染', async () => {
    const wrapper = await mountPage();
    expect(wrapper.findAll('.album-card').length).toBe(2);

    mocks.editAlbum.mockRejectedValue(new Error('保存失败：网络错误'));
    await wrapper.findAll('.album-card .edit-button')[0]!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.dialog-stub').exists()).toBe(true);

    await wrapper.find('.dialog-stub form').trigger('submit');
    await flushPromises();

    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('保存失败'), 'error');
    expect((wrapper.vm as any).$.setupState.editorOpen).toBe(true);
    expect(wrapper.findAll('.album-card').length).toBe(2);
    // 列表级 error 仍为空（未污染），ErrorState 不应出现。
    expect((wrapper.vm as any).$.setupState.error).toBe('');
  });

  it('添加应用到专辑失败：toast 报错，添加对话框保持打开', async () => {
    const wrapper = await mountPage();
    mocks.getAlbumDetail.mockResolvedValue({ data: { id: 'a1', apkList: [] } });
    await wrapper.find('.album-card').trigger('click');
    await flushPromises();

    mocks.addAlbumApk.mockRejectedValue(new Error('添加失败'));
    // AppButton 是 stub（非原生 button），点详情面板里最后一个子元素（「添加应用」按钮）。
    await wrapper.find('.detail-header > *:last-child').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.dialog-stub').length).toBe(1);

    const addDialog = wrapper.findAll('.dialog-stub')[0]!;
    await addDialog.find('form').trigger('submit');
    await flushPromises();

    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('添加失败'), 'error');
    expect((wrapper.vm as any).$.setupState.addApkOpen).toBe(true);
  });
});
