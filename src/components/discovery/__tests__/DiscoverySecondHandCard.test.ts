import { shallowMount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DiscoverySecondHandCard from '../DiscoverySecondHandCard.vue';

describe('二手商品卡片', () => {
  it('卖家元信息显示已编辑，未编辑商品不显示', async () => {
    const w = shallowMount(DiscoverySecondHandCard, { props: { entity: { id: 13, change_count: 1, dateline_text: '刚刚', location: '广西' } } });
    expect(w.get('.secondhand-seller small').text()).toBe('刚刚 · 广西 · 已编辑');
    await w.setProps({ entity: { id: 13, dateline_text: '刚刚', location: '广西' } });
    expect(w.text()).not.toContain('已编辑');
    w.unmount();
  });
  it('使用帖子图片和商品价格，展示卖家及所在地，点击打开原帖', async () => {
    const entity = { id: 12, message: '小米平板5', picArr: ['https://example.com/tablet.jpg'], username: '卖家', dateline_text: '2分钟前', ershou_info: { product_price: 660, product_logo: 'logo.jpg', link_source: '闲鱼', province: '广西', city: '防城港' } };
    const w = shallowMount(DiscoverySecondHandCard, { props: { entity } });
    expect(w.text()).toContain('¥660'); expect(w.text()).toContain('闲鱼'); expect(w.text()).toContain('广西 防城港');
    expect(w.findComponent({ name: 'AppImage' }).props('src')).toBe('https://example.com/tablet.jpg');
    await w.find('button').trigger('click'); expect(w.emitted('open')).toEqual([[entity]]);
  });
  it('兼容字符串二手信息及面议价格', () => {
    const w = shallowMount(DiscoverySecondHandCard, { props: { entity: { secondHandInfo: JSON.stringify({ product_title: '手机', is_face_deal: 1, product_price: 0 }) } } });
    expect(w.text()).toContain('手机'); expect(w.text()).toContain('价格面议'); expect(w.text()).not.toContain('¥0');
  });
  it('按封面 URL 中的尺寸标记预留宽高比，无尺寸时使用默认比例', () => {
    const w = shallowMount(DiscoverySecondHandCard, { props: { entity: { id: 14, picArr: ['https://example.com/a@1707x1280.jpg'] } } });
    expect(w.findComponent({ name: 'AppImage' }).attributes('style')).toContain('aspect-ratio: 1.3336 / 1');
    const fallback = shallowMount(DiscoverySecondHandCard, { props: { entity: { id: 15, picArr: ['https://example.com/plain.jpg'] } } });
    expect(fallback.findComponent({ name: 'AppImage' }).attributes('style')).toContain('aspect-ratio: 4 / 3');
  });
});
