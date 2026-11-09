import { describe, expect, it } from 'vitest';
import { getReplyEntityId } from '../commentList';

/**
 * 评论行唯一标识的边界约定：entityId 优先（与 APK 一致），缺失时退回 id。
 * 宿主组件统一从这里取标识，避免「id 优先」的旧实现把同一条评论判成两条。
 */
describe('getReplyEntityId（评论行标识优先级）', () => {
  it('id 和 entityId 同时存在时以 entityId 为准', () => {
    expect(getReplyEntityId({ id: '70', entityId: '7' })).toBe('7');
  });

  it('只有 entityId（帖子类回包常见）时使用 entityId', () => {
    expect(getReplyEntityId({ entityId: '42' })).toBe('42');
  });

  it('只有 id 时退回 id', () => {
    expect(getReplyEntityId({ id: 999 })).toBe('999');
  });

  it('都为空/缺失时返回空串，调用方据此跳过去重', () => {
    expect(getReplyEntityId({})).toBe('');
    expect(getReplyEntityId({ id: '', entityId: '' })).toBe('');
    expect(getReplyEntityId(null)).toBe('');
    expect(getReplyEntityId(undefined)).toBe('');
  });

  it('数字 0 和字符串 "0" 是有效标识，不当作空值吞掉', () => {
    expect(getReplyEntityId({ id: 0 })).toBe('0');
    expect(getReplyEntityId({ entityId: 0 })).toBe('0');
    expect(getReplyEntityId({ id: '0' })).toBe('0');
  });

  it('去掉首尾空白后再返回，避免游标里混入不可见字符', () => {
    expect(getReplyEntityId({ entityId: ' 102 ' })).toBe('102');
  });

  it('entityId 为空串或空白时退回 id（不能把该行当成无标识）', () => {
    expect(getReplyEntityId({ entityId: '', id: '88' })).toBe('88');
    expect(getReplyEntityId({ entityId: '   ', id: 89 })).toBe('89');
    expect(getReplyEntityId({ entityId: null, id: '90' })).toBe('90');
    expect(getReplyEntityId({ entityId: '', id: '' })).toBe('');
  });
});
