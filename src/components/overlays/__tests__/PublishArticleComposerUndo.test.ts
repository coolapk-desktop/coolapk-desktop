import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it } from 'vitest';
import PublishArticleComposer from '../PublishArticleComposer.vue';
import type { PublishArticleState } from '../../../utils/publishArticle';

afterEach(() => { document.querySelectorAll('.app-toast-container').forEach((node) => node.remove()); });

const state: PublishArticleState = {
  title: '',
  cover: null,
  blocks: [
    { id: 'p1', type: 'text', text: '第一段' },
    { id: 'i1', type: 'image', image: { preview: '图', url: 'https://image.example/a.jpg' } },
    { id: 'p2', type: 'text', text: '第二段' },
  ],
};

const lastState = (wrapper: ReturnType<typeof mountComposer>): PublishArticleState => {
  const emitted = wrapper.emitted('update:modelValue')!;
  return emitted[emitted.length - 1][0] as PublishArticleState;
};

function mountComposer() {
  return mount(PublishArticleComposer, { props: { modelValue: state }, attachTo: document.body });
}

it('删除整段文字块后可从撤销入口恢复内容与位置', async () => {
  const wrapper = mountComposer();
  try {
    await wrapper.get('[aria-label="删除文字段落 2"]').trigger('click');
    const removed = lastState(wrapper);
    expect(removed.blocks.map((block) => block.id)).toEqual(['p1', 'i1']);
    await wrapper.setProps({ modelValue: removed });
    expect(document.body.textContent).toContain('已删除段落');
    const undo = document.body.querySelector('.app-toast-action');
    expect(undo?.textContent).toBe('撤销');
    undo?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    const restored = lastState(wrapper);
    expect(restored.blocks.map((block) => block.id)).toEqual(['p1', 'i1', 'p2']);
    expect(restored.blocks[2].type === 'text' ? restored.blocks[2].text : '').toBe('第二段');
  } finally { wrapper.unmount(); }
});

it('移除正文图片同样提供撤销，撤销后图片块回到原下标', async () => {
  const wrapper = mountComposer();
  try {
    await wrapper.get('[aria-label="移除正文图片 1"]').trigger('click');
    const afterRemove = lastState(wrapper);
    expect(afterRemove.blocks.map((block) => block.id)).toEqual(['p1', 'p2']);
    await wrapper.setProps({ modelValue: afterRemove });
    document.body.querySelector('.app-toast-action')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    const restored = lastState(wrapper);
    expect(restored.blocks.map((block) => block.id)).toEqual(['p1', 'i1', 'p2']);
    expect(restored.blocks[1].type === 'image' ? restored.blocks[1].image.url : '').toBe('https://image.example/a.jpg');
  } finally { wrapper.unmount(); }
});
