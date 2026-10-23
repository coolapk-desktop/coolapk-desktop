import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, onUpdated, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: { getTabConfig: api.config } }));
import MobileHomePager from '../MobileHomePager.vue';
import HomePage from '../../../pages/HomePage.vue';
import { useSettingsStore } from '../../../stores/settings';
import { desktopFeedCommentsOpenKey } from '../../../utils/desktopFeedComments';
import { mobileReadingNavigationKey } from '../../../composables/useMobileReadingNavigation';
const progress = vi.fn();
const Tabs = defineComponent({ name: 'FeedTabs', props: ['activeKey', 'tabs', 'swipeProgress'], setup(_, { expose }) { expose({ setSwipeProgress: progress }); }, template: '<nav />' });
const panelUpdated = vi.fn();
const Panel = defineComponent({ name: 'HomeTabPanel', props: ['tabKey', 'selected', 'preview'], setup() { onUpdated(panelUpdated); }, template: '<div class="panel-stub"><div class="nested" style="overflow-x:auto">内容</div></div>' });
let now = 0, sequence = 0;
let notifyResize: () => void;
const frames = new Map<number, FrameRequestCallback>();
function pointer(target: Element | Window, type: string, x: number, y = 120) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: 'touch' } });
  target.dispatchEvent(event);
}
function tick() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); }
function finish() { now += 300; tick(); }
async function render() {
  const wrapper = mount(MobileHomePager, { global: { stubs: { HomeTabPanel: Panel, FeedTabs: Tabs } } });
  await flushPromises(); return wrapper;
}
describe('移动首页一体滑动', () => {
  beforeEach(() => {
    localStorage.clear(); setActivePinia(createPinia());
    useSettingsStore().settings.defaultHomeTab = 'digest';
    api.config.mockResolvedValue({ data: [{ entityId: '6390', entities: [
      { title: '关注', page_name: 'follow', url: '/follow' },
      { title: '头条', page_name: 'digest', url: '/main/headline' },
      { title: '热榜', page_name: 'hot', url: '/hot' },
    ] }] });
    now = 0; frames.clear(); sequence = 0; progress.mockClear();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++sequence, cb); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notifyResize = callback; } observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('阅读时保留主栏目栏，切换频道会恢复外壳导航', async () => {
    const hidden = ref(false);
    const reset = vi.fn(() => { hidden.value = false; });
    const w = mount(MobileHomePager, { global: {
      provide: { [mobileReadingNavigationKey as symbol]: { hidden, reset } },
      stubs: { HomeTabPanel: Panel, FeedTabs: Tabs },
    } });
    try {
      await flushPromises(); reset.mockClear(); hidden.value = true;
      await flushPromises();
      expect(w.get('.pager-page[data-tab-key="digest"]').attributes('inert')).toBeUndefined();
      expect(w.get('.pager-page[data-tab-key="follow"]').attributes('inert')).toBeDefined();
      expect(w.get('.home-toolbar').attributes('inert')).toBeUndefined();
      expect(w.get('.home-toolbar').attributes('aria-hidden')).toBeUndefined();
      w.findComponent({ name: 'FeedTabs' }).vm.$emit('update:activeKey', 'hot');
      finish(); await flushPromises();
      expect(reset).toHaveBeenCalledOnce();
      expect(hidden.value).toBe(false);
    } finally { w.unmount(); }
  });
  it('右侧评论展开时隐藏推荐栏，关闭后恢复同一实例并保留栏目和滚动', async () => {
    const commentsOpen = ref(false);
    const sidebarMounted = vi.fn();
    const Sidebar = defineComponent({ setup() { sidebarMounted(); }, template: '<aside class="recommendations-stub" />' });
    const w = mount(MobileHomePager, { props: { mobile: false }, global: {
      provide: { [desktopFeedCommentsOpenKey as symbol]: commentsOpen },
      stubs: { HomeTabPanel: Panel, FeedTabs: Tabs, FeedLayoutToggle: true, RightSidebar: Sidebar },
    } });
    await flushPromises();
    const tabs = w.findComponent({ name: 'FeedTabs' });
    tabs.vm.$emit('update:activeKey', 'hot'); finish(); await flushPromises();
    const original = w.get('.pager-page[data-tab-key="hot"] .panel-stub').element;
    original.scrollTop = 460;
    const sidebar = w.get('.recommendations-stub').element;
    const configCalls = api.config.mock.calls.length;
    for (const open of [true, false, true, false]) {
      commentsOpen.value = open; await flushPromises();
      expect(w.get('.recommendations-stub').element).toBe(sidebar);
      expect((sidebar as HTMLElement).style.display).toBe(open ? 'none' : '');
      expect(w.get('.pager-page[data-tab-key="hot"] .panel-stub').element).toBe(original);
      expect(original.scrollTop).toBe(460);
      expect(tabs.props('activeKey')).toBe('hot');
      expect(api.config.mock.calls.length).toBe(configCalls);
    }
    expect(sidebarMounted).toHaveBeenCalledTimes(1);
    expect(useSettingsStore().settings.showHomeMonthlyRank).toBe(true);
    expect(useSettingsStore().settings.showHomeHotTopics).toBe(true);
    await w.setProps({ mobile: true });
    expect((sidebar as HTMLElement).style.display).toBe('none');
    w.unmount();
  });
  it('尺寸通知不立即改动布局，下一帧更新宽度并在卸载时取消待处理通知', async () => {
    const w = await render();
    const before = w.get('.pager-track').attributes('style');
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
    notifyResize(); notifyResize();
    await flushPromises();
    expect(w.get('.pager-track').attributes('style')).toBe(before);
    expect(frames.size).toBe(1);
    finish(); await flushPromises();
    expect(w.get('.pager-track').attributes('style')).toContain('-480px');
    notifyResize();
    w.unmount();
    expect(frames.size).toBe(0);
  });
  it('跨过移动断点和关闭自动移动布局时保留当前栏目、页面实例与滚动位置', async () => {
    const listeners = new Set<() => void>();
    let narrow = false;
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: query === '(max-width: 720px)' && narrow,
      media: query, addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    } as unknown as MediaQueryList));
    const w = mount(HomePage, { global: { stubs: { HomeTabPanel: Panel, FeedTabs: Tabs, RightSidebar: true, FeedLayoutToggle: true } } });
    await flushPromises();
    const tabs = w.findComponent({ name: 'FeedTabs' });
    tabs.vm.$emit('update:activeKey', 'hot'); await flushPromises();
    const original = w.find('.pager-page[data-tab-key="hot"] .panel-stub').element;
    const sidebar = w.findComponent({ name: 'RightSidebar' }).element;
    original.scrollTop = 460;
    const calls = api.config.mock.calls.length;
    for (const mobile of [true, false, true]) {
      narrow = mobile; listeners.forEach(listener => listener()); await flushPromises();
      expect(tabs.props('activeKey')).toBe('hot');
      expect(w.find('.pager-page[data-tab-key="hot"] .panel-stub').element).toBe(original);
      expect(original.scrollTop).toBe(460);
      expect(w.findComponent({ name: 'RightSidebar' }).element).toBe(sidebar);
      expect(api.config.mock.calls.length).toBe(calls);
    }
    useSettingsStore().settings.disableAutoMobileMode = true; await flushPromises();
    expect(w.find('.desktop-home-pager').exists()).toBe(true);
    expect(w.find('.pager-page[data-tab-key="hot"] .panel-stub').element).toBe(original);
    expect(original.scrollTop).toBe(460);
    expect(api.config.mock.calls.length).toBe(calls);
    w.unmount(); expect(listeners.size).toBe(0);
  });
  it('拖动中同时移动页面与指示条，松手完成相邻切页', async () => {
    const w = await render(), viewport = w.find('.pager-viewport').element;
    pointer(viewport, 'pointerdown', 300); now = 100; pointer(window, 'pointermove', 156); tick(); await flushPromises();
    expect(Number.parseFloat(w.find('.pager-track').attributes('style')!.split('translate3d(')[1]!)).toBeCloseTo(-504);
    expect(progress).toHaveBeenLastCalledWith(1.4);
    pointer(window, 'pointerup', 156); finish(); await flushPromises();
    expect(w.findComponent({ name: 'FeedTabs' }).props('activeKey')).toBe('hot'); w.unmount();
  });
  it('短距离慢拖和取消手势回弹，不误切换', async () => {
    const w = await render(), viewport = w.find('.pager-viewport').element;
    pointer(viewport, 'pointerdown', 200); now = 100; pointer(window, 'pointermove', 176);
    pointer(window, 'pointerup', 176); finish(); await flushPromises();
    expect(w.findComponent({ name: 'FeedTabs' }).props('activeKey')).toBe('digest');
    pointer(viewport, 'pointerdown', 300); now += 100; pointer(window, 'pointermove', 100);
    pointer(window, 'pointercancel', 100); finish(); await flushPromises();
    expect(w.findComponent({ name: 'FeedTabs' }).props('activeKey')).toBe('digest'); w.unmount();
  });
  it('连续触摸每帧只更新轨道和指示条，不重新渲染内容页', async () => {
    const w = await render(), viewport = w.get('.pager-viewport').element;
    try {
      pointer(viewport, 'pointerdown', 300);
      pointer(window, 'pointermove', 280); tick(); await flushPromises();
      panelUpdated.mockClear(); progress.mockClear();
      for (const x of [270, 260, 250]) pointer(window, 'pointermove', x);
      expect(frames.size).toBe(1);
      tick(); await flushPromises();
      expect(progress).toHaveBeenCalledTimes(1);
      expect(panelUpdated).not.toHaveBeenCalled();
      pointer(window, 'pointercancel', 250); finish(); await flushPromises();
    } finally { w.unmount(); }
  });
  it('拖动不唤醒已访问的远处栏目', async () => {
    api.config.mockResolvedValueOnce({ data: [{ entityId: '6390', entities: Array.from({ length: 6 }, (_, i) => ({ title: `栏目${i}`, page_name: `tab${i}`, url: `/tab${i}` })) }] });
    const w = await render();
    try {
      const tabs = w.findComponent({ name: 'FeedTabs' });
      tabs.vm.$emit('update:activeKey', 'tab5'); finish(); await flushPromises();
      tabs.vm.$emit('update:activeKey', 'tab0'); finish(); await flushPromises();
      pointer(w.get('.pager-viewport').element, 'pointerdown', 300);
      pointer(window, 'pointermove', 270); tick(); await flushPromises();
      const far = w.findAllComponents(Panel).find(panel => panel.props('tabKey') === 'tab5')!;
      expect(far.props('preview')).toBe(false);
      expect(far.props('selected')).toBe(false);
    } finally { w.unmount(); }
  });
  it('相邻栏目在手指按下前已准备内容，普通链接也允许横滑且不会误打开', async () => {
    const w = await render();
    try {
      const panels = w.findAllComponents(Panel);
      expect(panels.every(panel => panel.props('preview'))).toBe(true);
      const link = document.createElement('a'); link.href = '/feed/123';
      w.get('.pager-page[data-tab-key="digest"] .panel-stub').element.appendChild(link);
      pointer(link, 'pointerdown', 300); now += 100; pointer(window, 'pointermove', 100);
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(click); expect(click.defaultPrevented).toBe(true);
      pointer(window, 'pointerup', 100); finish(); await flushPromises();
      expect(w.findComponent({ name: 'FeedTabs' }).props('activeKey')).toBe('hot');
    } finally { w.unmount(); }
  });
  it('竖向浏览和卡片内部横向滚动不触发整页切换', async () => {
    const w = await render(), viewport = w.find('.pager-viewport').element;
    pointer(viewport, 'pointerdown', 200); pointer(window, 'pointermove', 190, 220); pointer(window, 'pointerup', 190, 220);
    const nested = w.find('.pager-page[data-tab-key="digest"] .nested').element;
    Object.defineProperty(nested, 'scrollWidth', { value: 600 });
    pointer(nested, 'pointerdown', 300); pointer(window, 'pointermove', 80); pointer(window, 'pointerup', 80);
    finish(); await flushPromises(); expect(w.findComponent({ name: 'FeedTabs' }).props('activeKey')).toBe('digest'); w.unmount();
  });
  it('点击栏目使用相同动画，返回栏目保留原内容页实例', async () => {
    const w = await render(), original = w.find('.pager-page[data-tab-key="digest"] .panel-stub').element;
    const tabs = w.findComponent({ name: 'FeedTabs' }); tabs.vm.$emit('update:activeKey', 'hot');
    now += 100; const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(now)); await flushPromises();
    expect(progress.mock.lastCall![0]).toBeGreaterThan(1); expect(progress.mock.lastCall![0]).toBeLessThan(2);
    finish(); await flushPromises(); tabs.vm.$emit('update:activeKey', 'digest'); finish(); await flushPromises();
    expect(w.find('.pager-page[data-tab-key="digest"] .panel-stub').element).toBe(original); w.unmount();
  });
  it('首尾与数码栏目一样限制越界，滑动后阻止点击内容', async () => {
    const w = await render(), tabs = w.findComponent({ name: 'FeedTabs' });
    tabs.vm.$emit('update:activeKey', 'follow'); finish(); await flushPromises();
    const viewport = w.find('.pager-viewport').element;
    pointer(viewport, 'pointerdown', 100); now += 100; pointer(window, 'pointermove', 200); tick(); await flushPromises();
    expect(progress).toHaveBeenLastCalledWith(0);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true }); viewport.dispatchEvent(click); expect(click.defaultPrevented).toBe(true);
    pointer(window, 'pointerup', 200); finish(); await flushPromises(); expect(tabs.props('activeKey')).toBe('follow'); w.unmount();
  });

  it('首页配置为空时展示基础频道，重试后恢复动态栏目', async () => {
    api.config.mockResolvedValueOnce({ data: [] });
    const w = await render();
    expect(w.get('.pager-warning').text()).toContain('基础栏目');
    expect(w.findAll('.pager-page')).toHaveLength(3);
    await w.get('.pager-warning button').trigger('click');
    await flushPromises();
    expect(w.find('.pager-warning').exists()).toBe(false);
    expect(w.findComponent({ name: 'FeedTabs' }).props('tabs').map((tab: any) => tab.title)).toEqual(['关注', '头条', '热榜']);
    w.unmount();
  });
  it('忽略先出现的空配置卡片，采用后续有效的同 ID 配置', async () => {
    api.config.mockResolvedValueOnce({ data: [
      { entityId: '6390', entities: [] },
      { entityId: '6390', entities: [{ title: '头条', page_name: 'digest', url: '/main/headline' }] },
    ] });
    const w = await render();
    expect(w.find('.pager-warning').exists()).toBe(false);
    expect(w.findAll('.pager-page')).toHaveLength(1);
    w.unmount();
  });
  it('配置请求异常时显示基础频道而非空白错误页', async () => {
    api.config.mockRejectedValueOnce(new Error('网络不可用'));
    const w = await render();
    expect(w.find('.pager-viewport').exists()).toBe(true);
    expect(w.findAll('.pager-page')).toHaveLength(3);
    w.unmount();
  });
});
