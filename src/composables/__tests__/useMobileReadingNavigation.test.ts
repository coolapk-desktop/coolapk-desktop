import { afterEach, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { useMobileReadingNavigation } from '../useMobileReadingNavigation';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));

function setup() {
  const enabled = ref(true);
  const scope = effectScope();
  const navigation = scope.run(() => useMobileReadingNavigation(enabled))!;
  const root = document.createElement('div');
  root.innerHTML = '<div class="mobile-home-pager"><section class="pager-page" aria-hidden="false"><div class="feed-scroll-container"><div class="feed-comment-section"><button>评论</button></div></div></section></div>';
  document.body.append(root);
  const scroll = root.querySelector<HTMLElement>('.feed-scroll-container')!;
  root.addEventListener('wheel', navigation.onWheel);
  root.addEventListener('scroll', navigation.onScroll, true);
  root.addEventListener('touchstart', navigation.onTouchStart);
  root.addEventListener('touchmove', navigation.onTouchMove);
  cleanups.push(() => { root.remove(); scope.stop(); });
  const move = (top: number) => { scroll.scrollTop = top; scroll.dispatchEvent(new Event('scroll')); };
  const wheel = (y: number, x = 0, target: Element = scroll) => target.dispatchEvent(new WheelEvent('wheel', { deltaY: y, deltaX: x, bubbles: true }));
  const touch = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
    scroll.dispatchEvent(event);
  };
  return { enabled, navigation, root, scroll, move, wheel, touch };
}

it('累计向下阅读后收起，忽略抖动，反向滚动后恢复，顶部始终显示', () => {
  const { navigation, move, wheel } = setup();
  wheel(100); move(30); expect(navigation.hidden.value).toBe(false);
  move(80); expect(navigation.hidden.value).toBe(true);
  wheel(-20); move(76); expect(navigation.hidden.value).toBe(true);
  move(65); expect(navigation.hidden.value).toBe(false);
  wheel(100); move(150); expect(navigation.hidden.value).toBe(true);
  move(0); expect(navigation.hidden.value).toBe(false);
});

it('程序滚动不触发收起，折叠后底部自动修正滚动位置也不误展开', () => {
  const { navigation, move, wheel } = setup();
  move(100); expect(navigation.hidden.value).toBe(false);
  wheel(100); move(200); expect(navigation.hidden.value).toBe(true);
  move(120); expect(navigation.hidden.value).toBe(true);
});

it('横向手势、后台栏目、频道切换动画和评论内滚动不收起导航', () => {
  const { navigation, root, move, wheel } = setup();
  wheel(10, 100); move(100); expect(navigation.hidden.value).toBe(false);
  root.querySelector('.pager-page')!.setAttribute('aria-hidden', 'true');
  wheel(200); move(300); expect(navigation.hidden.value).toBe(false);
  root.querySelector('.pager-page')!.setAttribute('aria-hidden', 'false');
  root.querySelector('.mobile-home-pager')!.classList.add('is-pager-moving');
  wheel(200); move(500); expect(navigation.hidden.value).toBe(false);
  root.querySelector('.mobile-home-pager')!.classList.remove('is-pager-moving');
  wheel(200, 0, root.querySelector('button')!); move(700); expect(navigation.hidden.value).toBe(false);
});

it('触摸上划收起，下划恢复，横向切换不触发', () => {
  const { navigation, touch, move } = setup();
  touch('touchstart', 100, 300); touch('touchmove', 102, 200); move(100);
  expect(navigation.hidden.value).toBe(true);
  touch('touchstart', 100, 200); touch('touchmove', 101, 240); move(60);
  expect(navigation.hidden.value).toBe(false);
  touch('touchstart', 100, 300); touch('touchmove', 200, 280); move(200);
  expect(navigation.hidden.value).toBe(false);
});

it('关闭设置或进入禁用场景立即恢复，重新开启后不沿用旧手势', () => {
  const { navigation, enabled, wheel, move } = setup();
  wheel(100); move(100); expect(navigation.hidden.value).toBe(true);
  enabled.value = false; expect(navigation.hidden.value).toBe(false);
  enabled.value = true; move(200); expect(navigation.hidden.value).toBe(false);
});

it('触摸零位移帧与方向锁定后忽略横向抖动，非列表滚动快速跳过', () => {
  const { navigation, root, scroll, touch, move } = setup();
  // 先有一次零位移 touchmove，后续纵向移动仍能锁定并触发收起。
  touch('touchstart', 100, 300);
  touch('touchmove', 100, 300);
  touch('touchmove', 100, 210);
  move(120);
  expect(navigation.hidden.value).toBe(true);

  // 先锁定横向滑动后，后续轻微纵向偏移不会误触展开。
  touch('touchstart', 100, 200);
  touch('touchmove', 140, 202);
  touch('touchmove', 160, 240);
  move(80);
  expect(navigation.hidden.value).toBe(true);

  // 非目标滚动容器的 scroll 事件在快速路径中直接忽略。
  const other = document.createElement('div');
  other.className = 'other-scroll';
  root.append(other);
  touch('touchstart', 100, 200);
  touch('touchmove', 100, 280);
  other.scrollTop = 10;
  other.dispatchEvent(new Event('scroll'));
  expect(navigation.hidden.value).toBe(true);
  void scroll;
});
