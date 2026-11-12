import { beforeEach, describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MorePage from '../MorePage.vue';

const mockPush = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe('MorePage.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with title and featured items', () => {
    const wrapper = mount(MorePage);
    expect(wrapper.text()).toContain('更多服务');
    expect(wrapper.text()).toContain('常用与核心专区');
    expect(wrapper.text()).toContain('我的数码');
    expect(wrapper.text()).toContain('好物推荐');
    expect(wrapper.text()).toContain('酷安中心');
    expect(wrapper.text()).toContain('二手市场');
    expect(wrapper.text()).toContain('应用');
    expect(wrapper.text()).toContain('下载');

    const downloadEntry = wrapper.find('.featured-section').findAll('.featured-btn-item')
      .find((item) => item.text().trim() === '下载');
    expect(downloadEntry).toBeDefined();
    expect(wrapper.text()).not.toContain('酷安 CDN 文件上传');
  });

  it('filters items correctly when searching', async () => {
    const wrapper = mount(MorePage);
    const searchInput = wrapper.find('.hub-search-input');
    await searchInput.setValue('二手');

    expect(wrapper.text()).toContain('搜索结果');
    expect(wrapper.text()).toContain('二手市场');
    expect(wrapper.text()).not.toContain('常用与核心专区');
    expect(wrapper.findAll('.search-results-section .hub-card-item')).toHaveLength(1);
  });

  it('搜索覆盖仅位于常用网格的下载服务，清空后恢复完整入口', async () => {
    const wrapper = mount(MorePage);
    await wrapper.get('.hub-search-input').setValue('下载管理');
    const results = wrapper.findAll('.search-results-section .hub-card-item');
    const download = results.find(item => item.get('.hub-card-title').text() === '下载');
    expect(download).toBeDefined();
    await download!.trigger('click');
    expect(mockPush).toHaveBeenLastCalledWith('/downloads');
    await wrapper.get('.clear-search-btn').trigger('click');
    expect(wrapper.findAll('.featured-btn-item')).toHaveLength(10);
    expect(wrapper.findAll('.category-section .hub-card-item')).toHaveLength(8);
    wrapper.unmount();
  });

  it.each([
    ['我的数码装备', '我的数码'],
    ['特惠', '好物推荐'],
    ['创作者收益', '酷安中心'],
    ['我的专辑合集', '我的专辑'],
    ['调色', '酷图精选'],
    ['自提', '二手市场'],
    ['数码深度评测', '评测专区'],
  ])('搜索旧分类词「%s」时仅显示保留的入口', async (keyword, title) => {
    const wrapper = mount(MorePage);
    await wrapper.get('.hub-search-input').setValue(keyword);
    expect(wrapper.findAll('.search-results-section .hub-card-title').map(item => item.text())).toEqual([title]);
    wrapper.unmount();
  });

  it('分类仅展示常用网格以外的服务并保持双列对称排布', () => {
    const wrapper = mount(MorePage);
    expect(wrapper.find('.section-count').exists()).toBe(false);
    expect(wrapper.find('.hub-count-tag').exists()).toBe(false);
    expect(wrapper.findAll('.category-section').map(section => section.findAll('.hub-card-item').length)).toEqual([4, 2, 2]);
    const categories = wrapper.get('.categories-container').text();
    expect(categories).not.toContain('我的数码');
    expect(categories).not.toContain('二手市场');
    expect(categories).toContain('机型多维对比');
    expect(categories).toContain('酷友圈活动');
    expect(categories).not.toContain('酷安 CDN 文件上传');
    wrapper.unmount();
  });

  it('navigates to the selected path when a card is clicked', async () => {
    const wrapper = mount(MorePage);
    const firstFeaturedBtn = wrapper.findAll('.featured-btn-item').find((item) => item.text().includes('我的数码'));
    expect(firstFeaturedBtn).toBeDefined();
    await firstFeaturedBtn!.trigger('click');

    expect(mockPush).toHaveBeenCalledWith('/my-products');
  });
});
