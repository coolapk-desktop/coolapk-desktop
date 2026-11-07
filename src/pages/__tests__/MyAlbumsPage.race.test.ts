import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  getUserAlbumList: vi.fn(),
  getAlbumDetail: vi.fn(),
  deleteAlbumApk: vi.fn(),
  editAlbum: vi.fn(),
  addAlbumApk: vi.fn(),
  requestConfirmation: vi.fn(),
}));

vi.mock('../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    getUserAlbumList: mocks.getUserAlbumList,
    getAlbumDetail: mocks.getAlbumDetail,
    deleteAlbumApk: mocks.deleteAlbumApk,
    editAlbum: mocks.editAlbum,
    addAlbumApk: mocks.addAlbumApk,
    uploadImage: vi.fn(),
    createAlbum: vi.fn(),
  },
}));
vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ isLoggedIn: true, user: { uid: '42' }, openLoginModal: vi.fn() }),
}));
vi.mock('../../utils/confirm', () => ({ requestConfirmation: mocks.requestConfirmation }));

import MyAlbumsPage from '../MyAlbumsPage.vue';

const albums = [
  { id: 'a', title: '专辑A', intro: '简介A' },
  { id: 'b', title: '专辑B', intro: '简介B' },
];

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(MyAlbumsPage, {
    global: {
      plugins: [pinia],
      stubs: { AppButton: true, AppDialog: { template: '<div><slot /></div>' }, AppImage: true, LoadingState: true, EmptyState: true, ErrorState: true },
    },
  });
}

describe('MyAlbumsPage 详情竞态 / 移除确认 / 编辑同步', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserAlbumList.mockResolvedValue({ data: albums });
    mocks.requestConfirmation.mockResolvedValue(true);
  });

  it('快速点击两个专辑：慢的旧详情响应不得覆盖新选中的专辑', async () => {
    const detailA = deferred<{ data: unknown }>();
    mocks.getAlbumDetail
      .mockReturnValueOnce(detailA.promise)
      .mockResolvedValueOnce({ data: { title: 'B详情', apkList: [{ packageName: 'com.b', title: '应用B' }] } });

    const wrapper = mountPage();
    await flushPromises();
    const cards = wrapper.findAll('.album-card');
    await cards[0]!.trigger('click');
    await cards[1]!.trigger('click');
    await flushPromises();

    // 用户当前选中的是 B：面板显示 B 的详情与应用
    expect(wrapper.find('.detail-header h3').text()).toBe('B详情');
    expect(wrapper.text()).toContain('应用B');

    // 慢的 A 详情后到：不得覆盖回 A
    detailA.resolve({ data: { title: 'A详情', apkList: [{ packageName: 'com.a', title: '应用A' }] } });
    await flushPromises();
    expect(wrapper.find('.detail-header h3').text()).toBe('B详情');
    expect(wrapper.text()).not.toContain('应用A');
  });

  it('移除专辑内应用需先确认：拒绝时不调用删除，确认后才删除并刷新详情', async () => {
    mocks.getAlbumDetail.mockResolvedValue({ data: { title: 'A详情', apkList: [{ packageName: 'com.a', title: '应用A' }] } });
    mocks.deleteAlbumApk.mockResolvedValue(undefined);

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.findAll('.album-card')[0]!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('应用A');

    // 拒绝确认：不删除
    mocks.requestConfirmation.mockResolvedValueOnce(false);
    await wrapper.find('.remove-button').trigger('click');
    await flushPromises();
    expect(mocks.deleteAlbumApk).not.toHaveBeenCalled();

    // 确认：删除并重新拉取详情
    await wrapper.find('.remove-button').trigger('click');
    await flushPromises();
    expect(mocks.requestConfirmation).toHaveBeenCalledTimes(2);
    expect(mocks.deleteAlbumApk).toHaveBeenCalledWith('a', 'com.a');
    // 初次选中 1 次 + 确认删除后刷新详情 1 次
    expect(mocks.getAlbumDetail).toHaveBeenCalledTimes(2);
  });

  it('编辑保存成功后：详情面板标题/简介同步为新值', async () => {
    mocks.getAlbumDetail.mockResolvedValue({ data: { title: '旧标题', apkList: [] } });
    mocks.editAlbum.mockResolvedValue(undefined);

    const wrapper = mountPage();
    await flushPromises();
    await wrapper.findAll('.album-card')[0]!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.detail-header h3').text()).toBe('旧标题');

    await wrapper.find('.edit-button').trigger('click');
    const titleInput = wrapper.find('.album-form input');
    await titleInput.setValue('新标题');
    await wrapper.find('.album-form').trigger('submit.prevent');
    await flushPromises();

    expect(mocks.editAlbum).toHaveBeenCalledWith('a', '新标题', '简介A', '');
    expect(wrapper.find('.detail-header h3').text()).toBe('新标题');
  });
});
