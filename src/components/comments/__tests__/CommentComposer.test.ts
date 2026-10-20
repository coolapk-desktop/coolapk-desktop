import { expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import CommentComposer from '../CommentComposer.vue';
import { CoolapkTauriAPI } from '../../../api/coolapk';
import { useAuthStore } from '../../../stores/auth';
import { useSettingsStore } from '../../../stores/settings';

vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: { getDeviceInfo: vi.fn(), replyFeed: vi.fn() } }));
vi.mock('../../../utils/commentDrafts', () => ({ loadCommentDraft: async () => '', saveCommentDraft: vi.fn(), clearCommentDraft: vi.fn() }));

it('设备身份查询期间重复点击不重复发表评论', async () => {
  setActivePinia(createPinia());
  const auth = useAuthStore(); auth.isLoggedIn = true; auth.user = { uid: '12345', username: '发布者', userAvatar: '' };
  useSettingsStore().settings.deviceFingerprint.deviceId = '';
  let resolveDevice!: (value: any) => void;
  vi.mocked(CoolapkTauriAPI.getDeviceInfo).mockReturnValue(new Promise(resolve => { resolveDevice = resolve; }));
  vi.mocked(CoolapkTauriAPI.replyFeed).mockResolvedValue({ code: 200 } as any);
  const wrapper = mount(CommentComposer, { props: { feedId: 'feed-1' }, global: { stubs: { AppIconButton: true } } });
  try {
    await flushPromises();
    await wrapper.get('textarea').setValue('仅发表一次');
    const button = wrapper.findComponent({ name: 'AppButton' });
    // 同时触发两个入口事件，不能依靠下一帧的按钮禁用来避免重复请求。
    button.vm.$emit('click');
    button.vm.$emit('click');
    expect(CoolapkTauriAPI.getDeviceInfo).toHaveBeenCalledTimes(1);
    expect(CoolapkTauriAPI.replyFeed).not.toHaveBeenCalled();
    resolveDevice({ data: { deviceId: 'DU-MOCK-ACCOUNT-ID' } });
    await flushPromises();
    expect(CoolapkTauriAPI.replyFeed).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('success')).toHaveLength(1);
  } finally { resolveDevice({ data: {} }); await flushPromises(); wrapper.unmount(); }
});
