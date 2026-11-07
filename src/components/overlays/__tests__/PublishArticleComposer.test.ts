import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import PublishArticleComposer from '../PublishArticleComposer.vue';
import type { PublishArticleState } from '../../../utils/publishArticle';
import { preparePublishImage } from '../../../utils/publishMedia';

afterEach(() => vi.restoreAllMocks());

it('重新挂载长草稿时等待输入框进入布局后测量，不缓存未挂载时的 44px 高度', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.isConnected ? 600 : 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.isConnected ? 7000 : 0; });
  const state: PublishArticleState = { title: '', cover: null, blocks: [{ id: 'saved', type: 'text', text: '保存的长正文'.repeat(2000) }] };
  for (let reopened = 0; reopened < 2; reopened++) {
    const wrapper = mount(PublishArticleComposer, { props: { modelValue: state }, attachTo: document.body });
    try {
      await flushPromises();
      expect(wrapper.get('textarea').element.style.height).toBe('7000px');
      expect(wrapper.get('textarea').element.value).toBe(state.blocks[0].type === 'text' ? state.blocks[0].text : '');
    } finally { wrapper.unmount(); }
  }
});

it('长正文增删和草稿状态重渲染保留滚动位置、光标及输入框高度', async () => {
  const state: PublishArticleState = { title: '标题', cover: null, blocks: [{ id: 'body', type: 'text', text: '长正文'.repeat(500) }] };
  const wrapper = mount(PublishArticleComposer, { props: { modelValue: state }, attachTo: document.body });
  try {
    const input = wrapper.get('textarea');
    const textarea = input.element;
    const scroll = wrapper.element as HTMLElement;
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => 3000 });
    Object.defineProperty(textarea, 'clientWidth', { configurable: true, get: () => 600 });
    let measuredHeight = textarea.style.height;
    // jsdom has no layout. Model the browser clamping the scroll offset when
    // the long textarea temporarily collapses during measurement.
    const heights: string[] = [];
    Object.defineProperty(textarea.style, 'height', {
      configurable: true,
      get: () => measuredHeight,
      set: (value: string) => {
        heights.push(value);
        measuredHeight = value;
        if (value === 'auto') scroll.scrollTop = 0;
      },
    });
    for (const text of ['长正文'.repeat(500) + '新增', '长正文'.repeat(450)]) {
      scroll.scrollTop = 1600;
      textarea.value = text;
      textarea.focus();
      textarea.setSelectionRange(text.length, text.length);
      await input.trigger('input');
      const next = wrapper.emitted('update:modelValue')!.at(-1)![0] as PublishArticleState;
      await wrapper.setProps({ modelValue: next });
      expect(scroll.scrollTop).toBe(1600);
      expect(textarea.selectionStart).toBe(text.length);
      expect(textarea.style.height).toBe('3000px');
      const measurements = heights.length;
      // Autosave changes the surrounding dialog state without changing text.
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      expect(heights).toHaveLength(measurements);
      expect(scroll.scrollTop).toBe(1600);
    }
    // Switching/restoring a draft with the same block ID still resizes it.
    await wrapper.setProps({ modelValue: { ...state, blocks: [{ id: 'body', type: 'text', text: '新草稿正文' }] } });
    expect(textarea.value).toBe('新草稿正文');
    expect(heights.at(-1)).toBe('3000px');
  } finally { wrapper.unmount(); }
});

vi.mock('../../../utils/publishMedia', async (original) => ({
  ...await original<any>(),
  preparePublishImage: vi.fn(),
}));

function textBlock(id: string, text: string) {
  return { id, type: 'text' as const, text };
}

function imageBlock(id: string) {
  return { id, type: 'image' as const, image: { preview: `blob:${id}`, url: `https://img.example/${id}.png` } };
}

function lastState(wrapper: ReturnType<typeof mount>): PublishArticleState {
  return wrapper.emitted('update:modelValue')!.at(-1)![0] as PublishArticleState;
}

function placeCaret(textarea: HTMLTextAreaElement, position: number): void {
  textarea.focus();
  textarea.setSelectionRange(position, position);
  textarea.dispatchEvent(new Event('click', { bubbles: true }));
}

it('段落末尾插图不再生成多余的空文本段，光标回到原段落末尾', async () => {
  vi.mocked(preparePublishImage).mockResolvedValue({ preview: 'blob:new', url: 'https://img.example/new.png' } as any);
  const state: PublishArticleState = { title: '', cover: null, blocks: [textBlock('p1', '段落正文')] };
  const wrapper = mount(PublishArticleComposer, { props: { modelValue: state }, attachTo: document.body });
  try {
    const textarea = wrapper.get('textarea');
    placeCaret(textarea.element as HTMLTextAreaElement, 4);
    wrapper.vm.openImagePicker();
    const imageInput = wrapper.get('input[aria-label="选择正文图片文件"]').element as HTMLInputElement;
    Object.defineProperty(imageInput, 'files', { configurable: true, value: [new File(['x'], 'x.png', { type: 'image/png' })] });
    await imageInput.dispatchEvent(new Event('change'));
    await flushPromises();

    const next = lastState(wrapper);
    expect(next.blocks.map((block) => block.type)).toEqual(['text', 'image']);
    expect(next.blocks.filter((block) => block.type === 'text')).toHaveLength(1);
    expect(next.blocks[0].type === 'text' ? next.blocks[0].text : '').toBe('段落正文');
    // 段落末尾插图后光标回到原段落，不再跳到新空段落。
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).selectionStart).toBe(4);
  } finally { wrapper.unmount(); }
});

it('文字段落可删除、至少保留一个段落，且删除后活跃段落指向仍然存在的块', async () => {
  const state: PublishArticleState = { title: '', cover: null, blocks: [textBlock('p1', '第一段'), imageBlock('i1'), textBlock('p2', '第二段')] };
  const wrapper = mount(PublishArticleComposer, { props: { modelValue: state }, attachTo: document.body });
  try {
    const textarea = wrapper.get('textarea');
    placeCaret(textarea.element as HTMLTextAreaElement, 1);
    await wrapper.get('[aria-label="删除文字段落 2"]').trigger('mousedown');
    await wrapper.get('[aria-label="删除文字段落 2"]').trigger('click');
    let next = lastState(wrapper);
    expect(next.blocks.map((block) => block.type)).toEqual(['text', 'image']);
    expect(next.blocks[0].id).toBe('p1');
    await wrapper.setProps({ modelValue: next });

    // 只剩一个文字段落时删除只清空内容，段落本身保留。
    await wrapper.get('[aria-label="删除文字段落 1"]').trigger('click');
    next = lastState(wrapper);
    expect(next.blocks.map((block) => block.type)).toEqual(['text', 'image']);
    expect(next.blocks[0].type === 'text' ? next.blocks[0].text : '未清空').toBe('');

    // 工具按钮的 mousedown 已阻止默认行为，不会把焦点从段落抢走。
    const undoable = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    wrapper.get('[aria-label="文字段落 1 上移"]').element.dispatchEvent(undoable);
    expect(undoable.defaultPrevented).toBe(true);
  } finally { wrapper.unmount(); }
});

it('合并相邻文字段落时拼接内容并保留靠前段落的 id 与光标', async () => {
  const state: PublishArticleState = { title: '', cover: null, blocks: [textBlock('p1', '前半段'), textBlock('p2', '后半段')] };
  const wrapper = mount(PublishArticleComposer, { props: { modelValue: state }, attachTo: document.body });
  try {
    await wrapper.get('[aria-label="文字段落 2 与上段合并"]').trigger('click');
    const merged = lastState(wrapper);
    expect(merged.blocks).toHaveLength(1);
    expect(merged.blocks[0].id).toBe('p1');
    expect(merged.blocks[0].type === 'text' ? merged.blocks[0].text : '').toBe('前半段后半段');
    await flushPromises();
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).selectionStart).toBe(3);

    const downState: PublishArticleState = { title: '', cover: null, blocks: [textBlock('p1', '前半段'), textBlock('p2', '后半段')] };
    await wrapper.setProps({ modelValue: downState });
    await wrapper.get('[aria-label="文字段落 1 与下段合并"]').trigger('click');
    const mergedDown = lastState(wrapper);
    expect(mergedDown.blocks).toHaveLength(1);
    expect(mergedDown.blocks[0].id).toBe('p1');
    expect(mergedDown.blocks[0].type === 'text' ? mergedDown.blocks[0].text : '').toBe('前半段后半段');
  } finally { wrapper.unmount(); }
});

it('加载老草稿时把连续空文本段合并为一个', async () => {
  const state: PublishArticleState = {
    title: '老草稿',
    cover: null,
    blocks: [textBlock('p1', '正文'), textBlock('empty-1', ''), textBlock('empty-2', ''), textBlock('empty-3', '  '), imageBlock('i1')],
  };
  const wrapper = mount(PublishArticleComposer, { props: { modelValue: state }, attachTo: document.body });
  try {
    const first = wrapper.emitted('update:modelValue');
    expect(first).toBeTruthy();
    const normalized = lastState(wrapper);
    expect(normalized.blocks.map((block) => block.type)).toEqual(['text', 'text', 'image']);
    expect(normalized.blocks[1].type === 'text' ? normalized.blocks[1].text : null).toBe('');
    // 归一化只触发一次：父级回填后不再反复 emit（不会形成更新循环）。
    await wrapper.setProps({ modelValue: normalized });
    expect(wrapper.findAll('textarea')).toHaveLength(2);
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  } finally { wrapper.unmount(); }
});
