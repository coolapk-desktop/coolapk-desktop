import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DiscoverySecondHandGrid from '../DiscoverySecondHandGrid.vue';

afterEach(()=>vi.unstubAllGlobals());
describe('二手瀑布流',()=> {
  it('图片高度改变后在下一帧重新排列，移除卡片时释放观察任务',async()=> {
    const observers:Array<{notify:(entries?:Array<{target:Element}>)=>void;unobserve:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>}> = [];
    const frames = new Map<number,FrameRequestCallback>(); let id=0;
    vi.stubGlobal('ResizeObserver',class {
      unobserve=vi.fn();
      disconnect=vi.fn();
      constructor(notify:(entries?:Array<{target:Element}>)=>void) { observers.push({notify,unobserve:this.unobserve,disconnect:this.disconnect}); }
      observe() {}
    });
    vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=> { frames.set(++id,callback); return id; });
    vi.stubGlobal('cancelAnimationFrame',(handle:number)=>frames.delete(handle));
    const w=mount(DiscoverySecondHandGrid,{props:{items:[{id:1},{id:2}]},global:{stubs:{DiscoverySecondHandCard:{template:'<button>商品</button>'}}}});
    const [card, secondCard] = w.findAll('button').map((node) => node.element);
    let height=200;
    vi.spyOn(card,'getBoundingClientRect').mockImplementation(()=>({height}) as DOMRect);
    const paint=async()=> { const callbacks=[...frames.values()]; frames.clear(); callbacks.forEach(callback=>callback(0)); await w.vm.$nextTick(); };
    expect(observers).toHaveLength(1);
    observers[0].notify([{ target: card }]); await paint();
    const oldSpan=w.find('.secondhand-grid-item').attributes('style');
    height=350; observers[0].notify([{ target: card }]); await paint();
    expect(w.find('.secondhand-grid-item').attributes('style')).not.toBe(oldSpan);
    observers[0].notify([{ target: secondCard }]); await w.setProps({items:[{id:1}]});
    expect(observers[0].unobserve).toHaveBeenCalledWith(secondCard);
    expect(frames.size).toBe(0);
    w.unmount(); expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });
  it('首次挂载即同步测算网格行跨度，避免首帧全部卡片堆叠后再重排', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 240 } as DOMRect);
    const w = mount(DiscoverySecondHandGrid, {
      props: { items: [{ id: 10 }, { id: 11 }] },
      global: { stubs: { DiscoverySecondHandCard: { template: '<button>商品</button>' } } },
    });
    await w.vm.$nextTick();
    expect(w.findAll('.secondhand-grid-item')[0].attributes('style')).toContain('span 21');
    w.unmount();
  });
});
