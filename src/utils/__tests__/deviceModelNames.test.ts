import { computed } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import catalog from '../../../data/android-devices/catalog.json';
import type { DevicePreset } from '../devicePresets';
import { buildDeviceModelIndex, resolveDeviceModelName, useDeviceModelNames } from '../deviceModelNames';

const rows = catalog.rows.map(([brand, label, device, model], index) => ({ id: String(index), brand, label, device, model }));
const index = buildDeviceModelIndex(rows);

describe('机型名称显示', () => {
  it('从已下载的完整表还原截图中的机型及其他品牌', () => {
    expect(resolveDeviceModelName('Redmi 23090RA98C', index)).toBe('Redmi Note 13 Pro+');
    expect(resolveDeviceModelName('Redmi 25102RKBEC', index)).toBe('REDMI K90 Pro Max');
    expect(resolveDeviceModelName('Xiaomi 23090RA98C', index)).toBe('Redmi Note 13 Pro+');
    expect(resolveDeviceModelName('samsung SM-S9280', index)).toBe('Galaxy S24 Ultra');
  });
  it('小米 11 的地区型号与已转换名称使用同一个显示名称', () => {
    for (const raw of ['Xiaomi M2011K2C', 'M2011K2G', 'Mi 11', '小米11']) expect(resolveDeviceModelName(raw, index)).toBe('小米 11');
  });
  it('完整匹配，未知、截断编号及已有销售名称保留原文', () => {
    for (const raw of ['Redmi 25102RKBE', '未知设备', 'Redmi Note 13 Pro+', '小米 13 Pro', 'Samsung Galaxy S24 Ultra', 'Xiaomi 13 Pro', 'Apple iPhone99,1', 'Apple iPhone18,', 'Apple iPhone 17 Pro Max']) expect(resolveDeviceModelName(raw, index)).toBe(raw);
  });
  it('无需 Android 目录即可识别苹果硬件编号，完整匹配且兼容品牌和大小写', () => {
    const appleIndex = buildDeviceModelIndex([]);
    expect(resolveDeviceModelName('Apple iPhone18,2', appleIndex)).toBe('iPhone 17 Pro Max');
    expect(resolveDeviceModelName('iPhone18,2', appleIndex)).toBe('iPhone 17 Pro Max');
    expect(resolveDeviceModelName(' apple IPHONE17,3 ', appleIndex)).toBe('iPhone 16');
    expect(resolveDeviceModelName('iPhone14,6', appleIndex)).toBe('iPhone SE (3rd generation)');
    expect(resolveDeviceModelName('Other iPhone18,2', appleIndex)).toBe('Other iPhone18,2');
  });
  it('识别苹果各类设备，源表中有歧义的编号保留原文', () => {
    for (const [model, name] of [['iPhone1,1', 'iPhone'], ['iPad16,3', 'iPad Pro 11-inch (M4) Wi-Fi'], ['Mac14,2', 'MacBook Air (M2, 2022)'], ['Watch7,5', 'Apple Watch Ultra 2'], ['RealityDevice14,1', 'Vision Pro'], ['iPod9,1', 'iPod touch (7th generation)']]) expect(resolveDeviceModelName(`Apple ${model}`, index)).toBe(name);
    for (const model of ['AppleTV14,1', 'AudioAccessory5,1']) expect(resolveDeviceModelName(`Apple ${model}`, index)).toBe(`Apple ${model}`);
  });
  it('已有机型名称与另一条型号字段冲突时，优先原样显示名称', () => {
    const collision = buildDeviceModelIndex([
      { id: '1', brand: 'Brand', label: 'Phone 12', model: 'MODEL-123', device: '' },
      { id: '2', brand: 'Other', label: 'Other Phone', model: 'Phone 12', device: '' },
    ]);
    expect(resolveDeviceModelName('Phone 12', collision)).toBe('Phone 12');
    expect(resolveDeviceModelName('Brand Phone 12', collision)).toBe('Brand Phone 12');
    expect(resolveDeviceModelName('Brand MODEL-123', collision)).toBe('Phone 12');
  });
  it('跨品牌冲突可用品牌消歧，同品牌多个销售名称不猜测', () => {
    const make = (brand: string, label: string): DevicePreset => ({ id: label, brand, label, device: '', model: 'ABC-123' });
    const conflicting = buildDeviceModelIndex([make('A', 'A Phone'), make('B', 'B Phone'), make('B', 'Other Phone')]);
    expect(resolveDeviceModelName('ABC-123', conflicting)).toBe('ABC-123');
    expect(resolveDeviceModelName('A ABC-123', conflicting)).toBe('A Phone');
    expect(resolveDeviceModelName('B ABC-123', conflicting)).toBe('B ABC-123');
  });
  it('多个使用者只加载一次，加载完成后已显示的名称自动更新', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => catalog });
    vi.stubGlobal('fetch', fetch);
    try {
      const display = useDeviceModelNames();
      const name = computed(() => display('Redmi 23090RA98C'));
      expect(name.value).toBe('Redmi 23090RA98C');
      useDeviceModelNames();
      await vi.waitFor(() => expect(name.value).toBe('Redmi Note 13 Pro+'));
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
