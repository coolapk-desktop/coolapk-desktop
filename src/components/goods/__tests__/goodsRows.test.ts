import { describe, it, expect, beforeEach } from 'vitest';
import { applyGoodsRows, clearGoodsRows, getGoodsRowState, goodsRowId, setGoodsRowState, GOODS_ROWS_MAX, goodsRowsSizeForTests } from '../../../stores/goodsRows';

const sizeGoodsRows = goodsRowsSizeForTests;

describe('goodsRows 行状态注册表', () => {
  beforeEach(() => clearGoodsRows());

  it('setGoodsRowState 合并写入并对计数做下限保护', () => {
    setGoodsRowState('42', { replynum: 3, favorited: true });
    setGoodsRowState('42', { replynum: 5 });
    const state = getGoodsRowState('42');
    expect(state?.replynum).toBe(5);
    expect(state?.favorited).toBe(true);

    // 收藏成功后 favnum 正常写入；异常负数被钳到 0 而不是污染展示。
    setGoodsRowState('42', { favnum: 9 });
    expect(getGoodsRowState('42')?.favnum).toBe(9);
    setGoodsRowState('42', { favnum: -3 });
    expect(getGoodsRowState('42')?.favnum).toBe(0);
  });

  it('applyGoodsRows 从行对象提取统计，缺省字段不清掉已有状态', () => {
    setGoodsRowState('a1', { favnum: 7, favorited: true });
    applyGoodsRows([
      { id: 'a1', goodsListInfo: { reply_num: 2, vote_num: 10 } },
      { entityId: 'b2', replynum: 1, favnum: 4, userAction: { collect: 1 } },
      { id: '' }, // 无 id 的行安全跳过
    ]);
    const a = getGoodsRowState('a1');
    expect(a?.replynum).toBe(2);
    expect(a?.voteNum).toBe(10);
    // 行对象没带 favnum/userAction，之前写入的收藏态必须保留。
    expect(a?.favnum).toBe(7);
    expect(a?.favorited).toBe(true);

    const b = getGoodsRowState('b2');
    expect(b?.replynum).toBe(1);
    expect(b?.favnum).toBe(4);
    expect(b?.favorited).toBe(true);
  });

  it('容量上限：超过 GOODS_ROWS_MAX 后淘汰最旧行，最新写入的一定保留', () => {
    for (let i = 0; i <= GOODS_ROWS_MAX; i += 1) setGoodsRowState(`row-${i}`, { replynum: i });
    expect(sizeGoodsRows()).toBe(GOODS_ROWS_MAX);
    // 最早写入的 row-0 被淘汰；最后写入的行仍在且数值正确。
    expect(getGoodsRowState('row-0')).toBeUndefined();
    expect(getGoodsRowState(`row-${GOODS_ROWS_MAX}`)?.replynum).toBe(GOODS_ROWS_MAX);
  });

  it('容量上限：更新已有行不算新增，且刚更新过的行不会被当成最旧淘汰', () => {
    for (let i = 0; i < GOODS_ROWS_MAX; i += 1) setGoodsRowState(`row-${i}`, { replynum: i });
    expect(sizeGoodsRows()).toBe(GOODS_ROWS_MAX);

    setGoodsRowState('row-0', { replynum: 99 });
    expect(sizeGoodsRows()).toBe(GOODS_ROWS_MAX);
    expect(getGoodsRowState('row-0')?.replynum).toBe(99);

    // 新增一行触发淘汰：应为真正最旧的 row-1，而不是刚刷新过的 row-0。
    setGoodsRowState('row-new', { replynum: 1 });
    expect(sizeGoodsRows()).toBe(GOODS_ROWS_MAX);
    expect(getGoodsRowState('row-0')?.replynum).toBe(99);
    expect(getGoodsRowState('row-1')).toBeUndefined();
    expect(getGoodsRowState('row-new')?.replynum).toBe(1);
  });

  it('goodsRowId 与空参安全', () => {
    expect(goodsRowId({ id: 'x' })).toBe('x');
    expect(goodsRowId({ entityId: 'y' })).toBe('y');
    expect(goodsRowId(null)).toBe('');
    expect(() => setGoodsRowState('', { replynum: 1 })).not.toThrow();
    expect(getGoodsRowState('')).toBeUndefined();
    expect(() => applyGoodsRows(null as any)).not.toThrow();
  });
});
