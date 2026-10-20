import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preparePublishVideo } from '../../../utils/publishVideo';
import PublishDialog from '../PublishDialog.vue';
import { CoolapkTauriAPI } from '../../../api/coolapk';
import { listFullPublishDrafts, saveFullPublishDraft } from '../../../utils/publishDrafts';

vi.mock('../../../utils/publishVideo', () => ({ preparePublishVideo: vi.fn() }));
const stores = vi.hoisted(() => ({ app: null as any, settings: null as any, auth: null as any }));
vi.mock('../../../stores/app', () => ({ useAppStore: () => stores.app }));
vi.mock('../../../stores/settings', () => ({ useSettingsStore: () => stores.settings }));
vi.mock('../../../stores/auth', () => ({ useAuthStore: () => stores.auth }));
vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: { getDeviceInfo: vi.fn(), createFeed: vi.fn(), getEditableFeed: vi.fn(), updateFeed: vi.fn(), uploadPublishVideo: vi.fn(), uploadImage: vi.fn() } }));
vi.mock('../../../utils/publishDrafts', async (original) => ({ ...await original<any>(), listFullPublishDrafts: vi.fn(async () => []), saveFullPublishDraft: vi.fn(), deleteFullPublishDraft: vi.fn() }));
vi.mock('../../../utils/shuzilmDeviceGuide', () => ({ shuzilmGuideState: { visible: false }, openShuzilmGuide: vi.fn(), isRiskControlError: () => false, hasActiveShuzilmDeviceId: async () => false }));

function mountDialog() {
  return mount(PublishDialog, { global: { stubs: {
    AppDialog: { props: ['isOpen'], template: '<div v-if="isOpen"><slot/><slot name="footer"/></div>' },
    AppButton: { props: ['disabled'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot/></button>' },
    teleport: true, AppImage: true, PublishTargetPicker: true, PublishTopicPicker: true, PublishTopicRecommendations: { name: 'PublishTopicRecommendations', props: ['nodeType', 'nodeName', 'uid', 'text', 'cursor', 'refresh'], template: '<div/>' }, PublishMentionPicker: true, PublishProductOptions: true, PublishExtras: true,
  } } });
}
async function openDialog() { const wrapper = mountDialog(); stores.app.isPublishOpen = true; await flushPromises(); return wrapper; }
function typeText(wrapper: ReturnType<typeof mountDialog>, text: string) {
  const editor = wrapper.get('[role=textbox]').element;
  editor.textContent = text;
  const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  return wrapper.get('[role=textbox]').trigger('input', { inputType: 'insertText' });
}
beforeEach(() => {
  vi.clearAllMocks();
  stores.app = reactive({ isPublishOpen: false, editFeedTarget: null, closePublish() { this.isPublishOpen = false; } });
  stores.settings = { settings: { publishDeviceSignature: false, deviceFingerprint: { deviceId: 'device' } } };
  stores.auth = reactive({ user: { uid: '123' } });
  vi.mocked(listFullPublishDrafts).mockResolvedValue([]);
  vi.mocked(CoolapkTauriAPI.getDeviceInfo).mockResolvedValue({ code: 200, data: { defaultProfile: { includeDeviceModel: false } } });
});
describe('完整发帖流程', () => {
  it('iOS WebView 无 randomUUID 时仍可挂载全局发帖组件', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xaa) });
    try {
      const wrapper = mountDialog();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('收藏表情复用原地址并阻止重复添加，发布时不上传', async () => {
    vi.mocked(CoolapkTauriAPI.createFeed).mockResolvedValue({ code: 400, message: '测试停止发送' });
    const wrapper = await openDialog();
    try {
      await wrapper.get('button[title="插入表情"]').trigger('click');
      const panel = wrapper.findComponent({ name: 'EmojiPanel' });
      const picture = { id: '1', url: 'https://image.coolapk.com/favorite.gif' };
      panel.vm.$emit('picture', picture); await flushPromises();
      panel.vm.$emit('picture', picture); await flushPromises();
      expect(wrapper.findAll('.media-item')).toHaveLength(1);
      expect(panel.props('selectedUrls')).toEqual([picture.url]);
      await typeText(wrapper, '收藏表情');
      await wrapper.findAll('button').find(button => button.text() === '立即发布')!.trigger('click'); await flushPromises();
      expect(CoolapkTauriAPI.uploadImage).not.toHaveBeenCalled();
      expect(CoolapkTauriAPI.createFeed).toHaveBeenCalledWith('收藏表情', picture.url, undefined, expect.any(Object));
    } finally { wrapper.unmount(); }
  });
  it('分类面板的系统 Emoji 作为普通文本加入发布正文', async () => {
    const wrapper = await openDialog();
    try {
      await wrapper.get('button[title="插入表情"]').trigger('click');
      await wrapper.get('[role="tab"][aria-label="系统 Emoji"]').trigger('click');
      await wrapper.get('.emoji-item-btn').trigger('click');
      expect(wrapper.get('[role=textbox]').text()).toBe('😀');
    } finally { wrapper.unmount(); }
  });
  it.each([false, true])('按原生设备默认值 %s 附带型号，并允许手动覆盖和保存草稿', async (defaultValue) => {
    vi.mocked(CoolapkTauriAPI.getDeviceInfo).mockResolvedValue({ code: 200, data: { defaultProfile: { includeDeviceModel: defaultValue } } });
    vi.mocked(CoolapkTauriAPI.createFeed).mockResolvedValue({ code: 400, message: '测试停止发送' });
    const wrapper = await openDialog();
    const toggle = wrapper.get('.publish-device-option');
    expect(toggle.attributes('aria-checked')).toBe(String(defaultValue));
    await typeText(wrapper, '型号开关');
    await wrapper.findAll('button').find(button => button.text() === '立即发布')!.trigger('click');
    await flushPromises();
    expect(CoolapkTauriAPI.createFeed).toHaveBeenLastCalledWith('型号开关', undefined, undefined, expect.objectContaining({ includeDeviceModel: defaultValue }));
    await toggle.trigger('click');
    await wrapper.findAll('button').find(button => button.text() === '立即发布')!.trigger('click');
    await flushPromises();
    expect(CoolapkTauriAPI.createFeed).toHaveBeenLastCalledWith('型号开关', undefined, undefined, expect.objectContaining({ includeDeviceModel: !defaultValue }));
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click');
    await flushPromises();
    expect(saveFullPublishDraft).toHaveBeenLastCalledWith('123', expect.any(String), expect.objectContaining({ extraOptions: expect.objectContaining({ includeDeviceModel: !defaultValue }) }));
    wrapper.unmount();
  });
  it('输入井号触发话题选择并替换正在输入的片段', async () => {
    const wrapper = await openDialog();
    await typeText(wrapper, '内容 #摄');
    const picker = wrapper.findComponent({ name: 'PublishTopicPicker' });
    expect(picker.exists()).toBe(true);
    expect(picker.props('initialQuery')).toBe('摄');
    picker.vm.$emit('select', { id: '1', title: '摄影' });
    await flushPromises();
    expect(wrapper.get('[role=textbox]').text()).toBe('内容 #摄影#');
    expect(wrapper.findComponent({ name: 'PublishTopicPicker' }).exists()).toBe(false);
    wrapper.unmount();
  });
  it('发布请求包含板块、子板块、可见范围和附加内容', async () => {
    vi.mocked(CoolapkTauriAPI.createFeed).mockResolvedValue({ code: 400, message: '测试停止发送' });
    const wrapper = await openDialog();
    await typeText(wrapper, '正文');
    wrapper.findComponent({ name: 'PublishTargetPicker' }).vm.$emit('update:modelValue', { id: '7', title: '产品', type: 'product_phone', subTabs: [{ pageName: '1', title: '续航' }] });
    await flushPromises();
    wrapper.findComponent({ name: 'PublishProductOptions' }).vm.$emit('update:modelValue', { subTypeId: '1', subData: '8.5' });
    wrapper.findComponent({ name: 'PublishExtras' }).vm.$emit('update:modelValue', { originalType: 2, dyhId: '9', extraUrl: '/goods/detail?id=8' });
    await wrapper.get('button.publish-visibility').trigger('click');
    await wrapper.findAll('.publish-choice').find(button => button.text().includes('仅自己'))!.trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === '立即发布')!.trigger('click');
    await flushPromises();
    expect(CoolapkTauriAPI.createFeed).toHaveBeenCalledWith('正文', undefined, undefined, expect.objectContaining({ targetType: 'product_phone', targetId: '7', subTypeId: '1', subData: '8.5', visibleStatus: -1, originalType: 2, dyhId: '9', extraUrl: '/goods/detail?id=8' }));
    expect(wrapper.text()).toContain('测试停止发送');
    wrapper.unmount();
  });
  it('关闭前保存完整状态而非仅保存文字', async () => {
    const wrapper = await openDialog();
    await typeText(wrapper, '草稿正文');
    await wrapper.get('button.publish-visibility').trigger('click');
    await wrapper.findAll('.publish-choice').find(button => button.text().includes('仅自己'))!.trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === '取消')!.trigger('click');
    await flushPromises();
    expect(saveFullPublishDraft).toHaveBeenCalledWith('123', expect.any(String), expect.objectContaining({ text: '草稿正文', visibleStatus: -1, productOptions: {}, images: [] }));
    expect(stores.app.isPublishOpen).toBe(false);
    wrapper.unmount();
  });
  it('切换账号先保存原账号草稿并退出发帖', async () => {
    const wrapper = await openDialog();
    await typeText(wrapper, '原账号草稿');
    stores.auth.user.uid = '456';
    await flushPromises();
    expect(saveFullPublishDraft).toHaveBeenCalledWith('123', expect.any(String), expect.objectContaining({ text: '原账号草稿' }));
    expect(stores.app.isPublishOpen).toBe(false);
    wrapper.unmount();
  });
  it('只设置可见范围的草稿也保留完整选项', async () => {
    const wrapper = await openDialog();
    await wrapper.get('button.publish-visibility').trigger('click');
    await wrapper.findAll('.publish-choice').find(button => button.text().includes('仅自己'))!.trigger('click');
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click');
    await flushPromises();
    expect(saveFullPublishDraft).toHaveBeenCalledWith('123', expect.any(String), expect.objectContaining({ text: '', visibleStatus: -1 }));
    wrapper.unmount();
  });

  it('正文多个完整话题高亮，草稿仍保存原始井号文本', async () => {
    const wrapper = await openDialog();
    const text = '#手机摄影# 123123#酷安夜话#';
    await typeText(wrapper, text);
    expect(wrapper.findAll('.publish-topic').map(span => span.text())).toEqual(['#手机摄影#', '#酷安夜话#']);
    expect(wrapper.get('[role=textbox]').text()).toBe(text);
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click');
    await flushPromises();
    expect(saveFullPublishDraft).toHaveBeenCalledWith('123', expect.any(String), expect.objectContaining({ text }));
    wrapper.unmount();
  });
  it('推荐话题插入后立即高亮，发送仍为纯文本', async () => {
    vi.mocked(CoolapkTauriAPI.createFeed).mockResolvedValue({ code: 400, message: '测试停止发送' });
    const wrapper = await openDialog();
    wrapper.findComponent({ name: 'PublishTopicRecommendations' }).vm.$emit('select', '手机摄影');
    await flushPromises();
    expect(wrapper.get('.publish-topic').text()).toBe('#手机摄影#');
    await wrapper.findAll('button').find(button => button.text() === '立即发布')!.trigger('click');
    await flushPromises();
    expect(CoolapkTauriAPI.createFeed).toHaveBeenCalledWith('#手机摄影#', undefined, undefined, expect.any(Object));
    wrapper.unmount();
  });
  it('输入话题后的普通文字不继承高亮，删除闭合井号取消高亮', async () => {
    const wrapper = await openDialog();
    await typeText(wrapper, '#摄影#');
    wrapper.get('.publish-topic').element.textContent = '#摄影#继续输入';
    await wrapper.get('[role=textbox]').trigger('input', { inputType: 'insertText' });
    expect(wrapper.get('.publish-topic').text()).toBe('#摄影#');
    expect(wrapper.get('[role=textbox]').text()).toBe('#摄影#继续输入');
    wrapper.get('.publish-topic').element.textContent = '#摄影';
    await wrapper.get('[role=textbox]').trigger('input', { inputType: 'deleteContentBackward' });
    expect(wrapper.find('.publish-topic').exists()).toBe(false);
    expect(wrapper.get('[role=textbox]').text()).toBe('#摄影继续输入');
    wrapper.unmount();
  });
  it('话题中的 HTML 按文字显示，不创建可执行节点', async () => {
    const wrapper = await openDialog();
    await typeText(wrapper, '#<img src=x onerror=alert(1)>#');
    expect(wrapper.get('.publish-topic').text()).toBe('#<img src=x onerror=alert(1)>#');
    expect(wrapper.find('[onerror]').exists()).toBe(false);
    expect(wrapper.get('[role=textbox]').find('img').exists()).toBe(false);
    wrapper.unmount();
  });

  it('删除话题井号后的重绘保持光标位置', async () => {
    const wrapper = await openDialog();
    if (!document.body) document.documentElement.appendChild(document.createElement('body'));
    document.body.appendChild(wrapper.element);
    await typeText(wrapper, '正文 #摄影# 后续');
    const editor = wrapper.get('[role=textbox]').element;
    const topic = wrapper.get('.publish-topic').element;
    topic.textContent = '#摄影';
    const selection = window.getSelection()!;
    const caret = document.createRange(); caret.setStart(topic.firstChild!, 3); caret.collapse(true);
    selection.removeAllRanges(); selection.addRange(caret);
    await wrapper.get('[role=textbox]').trigger('input', { inputType: 'deleteContentBackward' });
    expect(wrapper.find('.publish-topic').exists()).toBe(false);
    const before = document.createRange(); before.selectNodeContents(editor); before.setEnd(selection.anchorNode!, selection.anchorOffset);
    expect(before.toString()).toBe('正文 #摄影');
    expect(editor.textContent).toBe('正文 #摄影 后续');
    wrapper.unmount();
  });

  it('更多网格提供普通视频入口，视频上传后携带官方媒体信息发布', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' }), cover = new File(['cover'], 'cover.jpg', { type: 'image/jpeg' });
    vi.mocked(preparePublishVideo).mockResolvedValue({ file, cover, duration: 1000, preview: 'blob:preview', coverPreview: '封面' });
    vi.mocked(CoolapkTauriAPI.uploadPublishVideo).mockResolvedValue({ code: 200, data: { mediaUrl: 'https://video.example/clip.mp4', mediaInfo: '{"mediaType":"video"}' } });
    vi.mocked(CoolapkTauriAPI.createFeed).mockResolvedValue({ code: 400, message: '测试停止发送' });
    const wrapper = await openDialog();
    await wrapper.get('button[title="更多"]').trigger('click');
    expect(wrapper.get('#publish-more-panel').text()).toContain('视频');
    const input = wrapper.get('input[accept*="video/quicktime"]');
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change'); await flushPromises();
    expect(wrapper.find('.publish-video-preview').exists()).toBe(true);
    expect(wrapper.get('button[title="添加图片"]').attributes('disabled')).toBeDefined();
    await wrapper.findAll('button').find(button => button.text() === '立即发布')!.trigger('click'); await flushPromises();
    expect(CoolapkTauriAPI.uploadPublishVideo).toHaveBeenCalledWith(expect.any(Uint8Array), 'clip.mp4', expect.any(Uint8Array), 1000);
    expect(CoolapkTauriAPI.createFeed).toHaveBeenCalledWith('', undefined, undefined, expect.objectContaining({ mediaUrl: 'https://video.example/clip.mp4', mediaInfo: '{"mediaType":"video"}' }));
    wrapper.unmount();
  });

  it('图片只有拖动排序，普通照片不显示实况入口，缺少原始动态文件不能按实况发布', async () => {
    vi.mocked(listFullPublishDrafts).mockResolvedValue([{ id: 'media', title: '图片', updatedAt: 1, state: { text: '正文', images: [{ preview: '第一张', url: 'first', liveIdentifier: 'original-id', liveEnabled: true }, { preview: '第二张', url: 'second' }], target: null, productOptions: {}, visibleStatus: 1, largeCover: false, extraOptions: {}, attachmentTitle: '' } }]);
    const wrapper = await openDialog();
    expect(wrapper.find('button[aria-label="图片前移"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="图片后移"]').exists()).toBe(false);
    expect(wrapper.findAll('select[aria-label="实况上传方式"]')).toHaveLength(1);
    const slots = [{ left: 0, right: 100, top: 0, bottom: 100 }, { left: 120, right: 220, top: 0, bottom: 100 }];
    wrapper.findAll('.media-item').forEach((item, index) => Object.defineProperty(item.element, 'getBoundingClientRect', { configurable: true, value: () => slots[index] }));
    const dispatchPointer = (target: HTMLElement | Document, type: string, values: Record<string, number>) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.entries(values).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
      target.dispatchEvent(event);
    };
    dispatchPointer(wrapper.findAll('.media-thumb')[0].element as HTMLElement, 'pointerdown', { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    dispatchPointer(document, 'pointermove', { pointerId: 1, clientX: 170, clientY: 50 });
    await flushPromises();
    expect(wrapper.findAllComponents({ name: 'AppImage' })[0].attributes('src')).toBe('第二张');
    dispatchPointer(document, 'pointerup', { pointerId: 1 });
    await wrapper.findAll('button').find(button => button.text() === '立即发布')!.trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('实况照片缺少原始动态文件'); expect(CoolapkTauriAPI.createFeed).not.toHaveBeenCalled();
    await wrapper.get('select[aria-label="实况上传方式"]').setValue('still');
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click'); await flushPromises();
    expect(saveFullPublishDraft).toHaveBeenCalledWith('123', 'media', expect.objectContaining({ images: [expect.objectContaining({ preview: '第二张' }), expect.objectContaining({ liveEnabled: false })] }));
    wrapper.unmount();
  });

});
