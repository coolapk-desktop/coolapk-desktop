import { afterEach, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useViewportContent } from '../useViewportContent';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function harness(protectedContent = ref(false), pageVisible = ref(true)) {
  let notify!: IntersectionObserverCallback;
  const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', vi.fn(function(callback: IntersectionObserverCallback) {
    notify = callback;
    return { observe, unobserve, disconnect };
  }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 280));
  const child = defineComponent({ setup: () => ({ state: ref('initial') }), template: '<input v-model="state" />' });
  const wrapper = mount(defineComponent({
    components: { child },
    setup() {
      const element = ref<HTMLElement | null>(null);
      return { element, ...useViewportContent(element, protectedContent, pageVisible) };
    },
    template: '<article ref="element" :style="viewportPlaceholderStyle" @click.capture="retainViewportContent"><child v-if="renderViewportContent" /></article>',
  }));
  const visibility = async (visible: boolean) => {
    notify([{ target: wrapper.element, isIntersecting: visible, boundingClientRect: new DOMRect(0, 0, 400, 280) }] as IntersectionObserverEntry[], {} as IntersectionObserver);
    await nextTick();
  };
  return { wrapper, visibility, observe, unobserve, disconnect };
}

it('reclaims unseen children, preserves exact height, and restores them before entering the viewport', async () => {
  const h = harness();
  await nextTick();
  await h.visibility(false);
  expect(h.wrapper.find('input').exists()).toBe(false);
  expect((h.wrapper.element as HTMLElement).style.height).toBe('280px');
  await h.visibility(true);
  expect(h.wrapper.find('input').exists()).toBe(true);
  expect((h.wrapper.element as HTMLElement).style.height).toBe('');
  h.wrapper.unmount();
  expect(h.disconnect).toHaveBeenCalledTimes(1);
});

it('keeps interacted component state when scrolling away and back', async () => {
  const h = harness();
  await nextTick();
  await h.wrapper.find('input').trigger('click');
  await h.wrapper.find('input').setValue('retained draft');
  await h.visibility(false);
  expect((h.wrapper.get('input').element as HTMLInputElement).value).toBe('retained draft');
  h.wrapper.unmount();
});

it('restores offscreen contents when keyboard navigation opens comments or another protected surface', async () => {
  const protectedContent = ref(false);
  const h = harness(protectedContent);
  await nextTick();
  await h.visibility(false);
  protectedContent.value = true;
  await nextTick();
  expect(h.wrapper.find('input').exists()).toBe(true);
  expect((h.wrapper.element as HTMLElement).style.height).toBe('');
  h.wrapper.unmount();
});

it('keeps ordinary rendering without IntersectionObserver', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const wrapper = mount(defineComponent({ setup() {
    const element = ref<HTMLElement | null>(null);
    return { element, ...useViewportContent(element, ref(false)) };
  }, template: '<article ref="element"><p v-if="renderViewportContent">body</p></article>' }));
  await nextTick();
  expect(wrapper.find('p').exists()).toBe(true);
  wrapper.unmount();
});

it('releases untouched hidden tab contents and restores them immediately when switching back', async () => {
  const visible = ref(true);
  const h = harness(ref(false), visible);
  await nextTick();
  visible.value = false;
  await nextTick();
  expect(h.wrapper.find('input').exists()).toBe(false);
  visible.value = true;
  await nextTick();
  expect(h.wrapper.find('input').exists()).toBe(true);
  h.wrapper.unmount();
});

it('does not rebuild offscreen children when a tab becomes visible again', async () => {
  const visible = ref(true);
  const h = harness(ref(false), visible);
  await nextTick();
  await h.visibility(false);
  const measure = vi.spyOn(h.wrapper.element, 'getBoundingClientRect');
  visible.value = false;
  await nextTick();
  visible.value = true;
  await nextTick();
  expect(h.wrapper.find('input').exists()).toBe(false);
  expect((h.wrapper.element as HTMLElement).style.height).toBe('280px');
  expect(measure).not.toHaveBeenCalled();
  await h.visibility(true);
  expect(h.wrapper.find('input').exists()).toBe(true);
  h.wrapper.unmount();
});

it('keeps offscreen placeholders when a KeepAlive page is restored', async () => {
  let notify!: IntersectionObserverCallback;
  vi.stubGlobal('IntersectionObserver', vi.fn(function(callback: IntersectionObserverCallback) {
    notify = callback;
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
  }));
  const shown = ref(true);
  const page = defineComponent({
    setup() {
      const element = ref<HTMLElement | null>(null);
      return { element, ...useViewportContent(element, ref(false)) };
    },
    template: '<article ref="element" :style="viewportPlaceholderStyle"><input v-if="renderViewportContent" /></article>',
  });
  const wrapper = mount(defineComponent({
    components: { TestPage: page },
    setup: () => ({ shown }),
    template: '<KeepAlive><TestPage v-if="shown" /></KeepAlive>',
  }));
  await nextTick();
  const element = wrapper.get('article').element as HTMLElement;
  notify([{
    target: element, isIntersecting: false, boundingClientRect: new DOMRect(0, 0, 400, 280),
    intersectionRect: new DOMRect(), intersectionRatio: 0, rootBounds: null, time: 0,
  }], {} as IntersectionObserver);
  await nextTick();
  shown.value = false;
  await nextTick();
  shown.value = true;
  await nextTick();
  expect(wrapper.find('input').exists()).toBe(false);
  expect((wrapper.get('article').element as HTMLElement).style.height).toBe('280px');
  wrapper.unmount();
});

it('remeasures cached placeholders if the viewport width changed while hidden', async () => {
  const visible = ref(true);
  const h = harness(ref(false), visible);
  await nextTick();
  await h.visibility(false);
  visible.value = false;
  await nextTick();
  vi.stubGlobal('innerWidth', window.innerWidth + 100);
  visible.value = true;
  await nextTick();
  expect(h.wrapper.find('input').exists()).toBe(true);
  expect((h.wrapper.element as HTMLElement).style.height).toBe('');
  h.wrapper.unmount();
});

it('remeasures recycled cards when the window width changes', async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const h = harness();
  await nextTick();
  await h.visibility(false);
  window.dispatchEvent(new Event('resize'));
  await nextTick();
  expect(h.wrapper.find('input').exists()).toBe(true);
  expect((h.wrapper.element as HTMLElement).style.height).toBe('');
  expect(h.observe).toHaveBeenCalledTimes(2);
  h.wrapper.unmount();
});

it('preserves a text selection spanning an offscreen card', async () => {
  const h = harness();
  await nextTick();
  vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, containsNode: () => true } as unknown as Selection);
  await h.visibility(false);
  expect(h.wrapper.find('input').exists()).toBe(true);
  h.wrapper.unmount();
});
