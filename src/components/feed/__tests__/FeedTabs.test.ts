import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FeedTabs from '../FeedTabs.vue';

afterEach(() => vi.restoreAllMocks());
describe('频道指示条滑动性能', () => {
  it('滑动复用已测量的位置，不重复读取布局或滚动栏目栏', async () => {
    const left = vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
    const w = mount(FeedTabs, { props: { activeKey: 'life', tabs: [{ page_name: 'life', title: '生活', url: 'life' }, { page_name: 'picture', title: '酷图', url: 'picture' }], showManage: false }, global: { stubs: { TabManagerModal: true } } });
    await flushPromises();
    const reads = left.mock.calls.length;
    for (let progress = 0; progress <= 1; progress += .1) w.vm.setSwipeProgress(progress);
    expect(left).toHaveBeenCalledTimes(reads);
    expect(w.get('.sliding-indicator').attributes('style')).toContain('translate3d');
    w.unmount();
  });

  it('点击切换频道时为指示条播放果冻弹性拉伸 WAAPI 动效并在减弱动效下跳过', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.textContent?.includes('酷图') ? 140 : 12;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);

    const animSpy = vi.fn(() => ({ onfinish: null, oncancel: null, cancel: vi.fn() } as any));
    const origAnimate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animSpy;
    try {
      const w = mount(FeedTabs, {
        props: {
          activeKey: 'life',
          tabs: [{ page_name: 'life', title: '生活', url: 'life' }, { page_name: 'picture', title: '酷图', url: 'picture' }],
          showManage: false,
        },
        global: { stubs: { TabManagerModal: true } },
      });
      await flushPromises();
      expect(animSpy).not.toHaveBeenCalled();

      await w.setProps({ activeKey: 'picture' });
      await flushPromises();
      expect(animSpy).toHaveBeenCalledTimes(1);
      const frames = (animSpy.mock.calls[0] as any)[0] as Keyframe[];
      expect(String(frames[1]?.transform)).toContain('scaleX(');

      document.documentElement.setAttribute('data-reduce-motion', 'true');
      await w.setProps({ activeKey: 'life' });
      await flushPromises();
      expect(animSpy).toHaveBeenCalledTimes(1);
      w.unmount();
    } finally {
      document.documentElement.removeAttribute('data-reduce-motion');
      HTMLElement.prototype.animate = origAnimate;
    }
  });
});
