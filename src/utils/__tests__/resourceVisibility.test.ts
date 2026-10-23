import { afterEach, expect, it, vi } from 'vitest';
import { getResourceScrollRoot } from '../resourceVisibility';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('finds the nearest declared boundary without resolving ancestor styles', () => {
  document.body.innerHTML = '<main data-resource-scroll-root><section data-resource-scroll-root><article><span><img></span></article></section></main>';
  const style = vi.spyOn(window, 'getComputedStyle');
  const image = document.querySelector('img')!;
  expect(getResourceScrollRoot(image)).toBe(document.querySelector('section'));
  document.querySelector('main')!.append(image);
  expect(getResourceScrollRoot(image)).toBe(document.querySelector('main'));
  expect(style).not.toHaveBeenCalled();
});

it('keeps style-based detection for pages without a declared scroll boundary', () => {
  document.body.innerHTML = '<main style="overflow-y: auto"><article><img></article></main>';
  expect(getResourceScrollRoot(document.querySelector('img')!)).toBe(document.querySelector('main'));
});

it('preserves an inner scrollable emoji panel inside a declared page boundary', () => {
  document.body.innerHTML = '<main data-resource-scroll-root><section class="custom-scrollbar" style="overflow-y: auto"><article><img></article></section></main>';
  expect(getResourceScrollRoot(document.querySelector('img')!)).toBe(document.querySelector('section'));
});
