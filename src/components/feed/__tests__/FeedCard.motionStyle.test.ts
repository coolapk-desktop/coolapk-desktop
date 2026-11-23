import { compileStyle, parse } from 'vue/compiler-sfc';
import { expect, it } from 'vitest';
import source from '../FeedCard.vue?raw';

it('将按压缩放限制在当前动态卡片，保留根节点上的减少动效开关', () => {
  const { descriptor } = parse(source);
  const style = descriptor.styles.find(block => block.scoped)!;
  const { code, errors } = compileStyle({
    source: style.content,
    filename: 'FeedCard.vue',
    id: 'data-v-feed-card',
    scoped: true,
  });

  expect(errors).toEqual([]);
  expect(code).toMatch(
    /:root:not\(\[data-reduce-motion='true'\]\) \.feed-card\[data-v-feed-card\]:not\(\.is-detail-mode\):active\s*\{\s*transform:\s*scale\(0\.985\)/,
  );
  expect(code).not.toMatch(
    /:root:not\(\[data-reduce-motion='true'\]\)\s*\{\s*transform:\s*scale\(0\.985\)/,
  );
});
