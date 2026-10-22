import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppContextMenu from '../AppContextMenu.vue';

const mocks = vi.hoisted(() => ({
  writeText: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  saveFile: vi.fn().mockResolvedValue('/downloads/file.custom'),
  saveImage: vi.fn().mockResolvedValue('/downloads/image.png'),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ fullPath: '/' }),
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    go: vi.fn(),
  }),
}));

vi.mock('../../../api/coolapk', () => ({
  CoolapkTauriAPI: {
    openUrl: mocks.openUrl,
    saveImage: mocks.saveImage,
    saveFile: mocks.saveFile,
  },
}));

/** jsdom 没有 TouchEvent，手工挂 touches 后派发同名事件。 */
function dispatchTouch(
  target: Element,
  type: string,
  touches: Array<{ clientX: number; clientY: number }>,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
}

function appendChatMessage(text: string, id: string): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-context-kind', 'chat-message');
  container.setAttribute('data-context-message-text', text);
  container.setAttribute('data-context-message-id', id);
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  container.appendChild(bubble);
  document.body.appendChild(container);
  return bubble;
}

describe('AppContextMenu', () => {
  it('右键已显示的 Blob 原图直接传给保存入口，保留远端原图地址', async () => {
    const wrapper = mount(AppContextMenu, { attachTo: document.body });
    const image = document.createElement('img');
    const url = 'https://image.coolapk.com/feed/original.png';
    image.src = 'blob:displayed-original';
    image.dataset.originalUrl = image.dataset.resourceUrl = url;
    document.body.appendChild(image);
    try {
      image.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
      await wrapper.vm.$nextTick();
      const action = Array.from(document.querySelectorAll<HTMLElement>('.context-menu-item')).find(item => item.textContent?.trim() === '保存图片');
      expect(action).toBeDefined();
      action!.click();
      await flushPromises();
      expect(mocks.saveImage).toHaveBeenCalledWith(url, expect.any(String), 'blob:displayed-original');
    } finally { image.remove(); wrapper.unmount(); }
  });
  it('复制图片失败不退回复制链接，复制图片地址仍单独写入文本', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const wrapper = mount(AppContextMenu, { attachTo: document.body });
    const image = document.createElement('img');
    const url = 'https://api.coolapk.com/v6/message/showImage?id=233036637&type=n';
    image.src = url;
    document.body.appendChild(image);
    const openMenu = async () => {
      image.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
      await wrapper.vm.$nextTick();
    };
    try {
      await openMenu();
      const copy = Array.from(document.querySelectorAll<HTMLElement>('.context-menu-item')).find(item => item.textContent?.trim() === '复制图片');
      expect(copy).toBeDefined();
      copy!.click();
      await flushPromises();
      expect(mocks.writeText).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain('当前系统不支持复制图片');
      await openMenu();
      const copyUrl = Array.from(document.querySelectorAll<HTMLElement>('.context-menu-item')).find(item => item.textContent?.trim() === '复制图片地址');
      expect(copyUrl).toBeDefined();
      copyUrl!.click();
      await flushPromises();
      expect(mocks.writeText).toHaveBeenCalledWith(url);
    } finally { image.remove(); wrapper.unmount(); vi.unstubAllGlobals(); }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: mocks.writeText,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['a', 'video', 'audio'])('右键 %s 可以原样下载带参数的任意文件资源', async (tag) => {
    const wrapper = mount(AppContextMenu, { attachTo: document.body });
    const resource = document.createElement(tag);
    const url = 'https://example.com/file.custom?token=123';
    resource.setAttribute(tag === 'a' ? 'href' : 'src', url);
    document.body.appendChild(resource);
    resource.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    await wrapper.vm.$nextTick();
    const action = Array.from(document.querySelectorAll<HTMLElement>('.context-menu-item')).find(element => element.textContent?.includes('下载链接文件'));
    expect(action).toBeDefined();
    action!.click();
    expect(mocks.saveFile).toHaveBeenCalledWith(url, expect.any(String));
    document.body.removeChild(resource);
    wrapper.unmount();
  });

  it('右键私信消息时展示复制选项并正确复制消息全文', async () => {
    const wrapper = mount(AppContextMenu, {
      attachTo: document.body,
    });

    const msgContainer = document.createElement('div');
    msgContainer.setAttribute('data-context-kind', 'chat-message');
    msgContainer.setAttribute('data-context-message-text', '这是测试私信消息文本');
    msgContainer.setAttribute('data-context-message-id', '1001');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = '这是测试私信消息文本';
    msgContainer.appendChild(bubble);
    document.body.appendChild(msgContainer);

    // 触发右键菜单
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 300,
    });
    bubble.dispatchEvent(contextMenuEvent);

    await wrapper.vm.$nextTick();

    const menu = document.querySelector('.app-context-menu');
    expect(menu).not.toBeNull();

    const copyItem = Array.from(document.querySelectorAll('.context-menu-item')).find(
      (el) => el.textContent?.includes('复制')
    );
    expect(copyItem).toBeDefined();

    (copyItem as HTMLElement).click();
    expect(mocks.writeText).toHaveBeenCalledWith('这是测试私信消息文本');

    document.body.removeChild(msgContainer);
    wrapper.unmount();
  });

  it('私信消息中有选中文本时右键优先复制选中文字', async () => {
    const wrapper = mount(AppContextMenu, {
      attachTo: document.body,
    });

    const msgContainer = document.createElement('div');
    msgContainer.setAttribute('data-context-kind', 'chat-message');
    msgContainer.setAttribute('data-context-message-text', '是这个理解对吗');
    msgContainer.setAttribute('data-context-message-id', '1002');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = '是这个理解对吗';
    msgContainer.appendChild(bubble);
    document.body.appendChild(msgContainer);

    // 模拟选中文本 "理解"
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '理解',
    } as unknown as Selection);

    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 300,
    });
    bubble.dispatchEvent(contextMenuEvent);

    await wrapper.vm.$nextTick();

    const items = Array.from(document.querySelectorAll('.context-menu-item')).map((el) => el.textContent?.trim());
    expect(items.some((text) => text?.includes('复制'))).toBe(true);
    expect(items.some((text) => text?.includes('复制全文'))).toBe(true);

    const copySelectionItem = Array.from(document.querySelectorAll('.context-menu-item')).find(
      (el) => el.querySelector('span')?.textContent?.trim() === '复制'
    );
    expect(copySelectionItem).toBeDefined();

    (copySelectionItem as HTMLElement).click();
    expect(mocks.writeText).toHaveBeenCalledWith('理解');

    document.body.removeChild(msgContainer);
    wrapper.unmount();
  });

  it('长按私信消息打开菜单，并阻止抬手补发的点击立刻关闭菜单', async () => {
    vi.useFakeTimers();
    const wrapper = mount(AppContextMenu, { attachTo: document.body });
    const bubble = appendChatMessage('长按也要能复制', '2001');
    const container = bubble.parentElement as HTMLElement;

    dispatchTouch(bubble, 'touchstart', [{ clientX: 150, clientY: 420 }]);
    vi.advanceTimersByTime(500);
    await wrapper.vm.$nextTick();

    expect(document.querySelector('.app-context-menu')).not.toBeNull();

    // 抬手：浏览器补发的 click 不能被当成"点空白处关闭菜单"。
    dispatchTouch(bubble, 'touchend', []);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(document.querySelector('.app-context-menu')).not.toBeNull();

    // 过了保护窗口后，点空白处仍然可以关闭。
    vi.advanceTimersByTime(500);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(document.querySelector('.app-context-menu')).toBeNull();

    document.body.removeChild(container);
    wrapper.unmount();
  });

  it('长按菜单里的复制使用消息全文', async () => {
    vi.useFakeTimers();
    // 显式固定选区为空：同一文件里其它用例 stub 过 getSelection。
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '' } as unknown as Selection);
    const wrapper = mount(AppContextMenu, { attachTo: document.body });
    const bubble = appendChatMessage('长按复制的消息全文', '2002');
    const container = bubble.parentElement as HTMLElement;

    dispatchTouch(bubble, 'touchstart', [{ clientX: 150, clientY: 420 }]);
    vi.advanceTimersByTime(500);
    await wrapper.vm.$nextTick();

    const copyItem = Array.from(document.querySelectorAll('.context-menu-item')).find(
      (el) => el.querySelector('span')?.textContent?.trim() === '复制',
    );
    expect(copyItem).toBeDefined();
    (copyItem as HTMLElement).click();
    expect(mocks.writeText).toHaveBeenCalledWith('长按复制的消息全文');

    document.body.removeChild(container);
    wrapper.unmount();
  });

  it('长按过程中手指移动超过阈值则取消菜单', async () => {
    vi.useFakeTimers();
    const wrapper = mount(AppContextMenu, { attachTo: document.body });
    const bubble = appendChatMessage('滑动不应弹菜单', '2003');
    const container = bubble.parentElement as HTMLElement;

    dispatchTouch(bubble, 'touchstart', [{ clientX: 150, clientY: 420 }]);
    vi.advanceTimersByTime(200);
    dispatchTouch(bubble, 'touchmove', [{ clientX: 200, clientY: 430 }]);
    vi.advanceTimersByTime(400);
    await wrapper.vm.$nextTick();

    expect(document.querySelector('.app-context-menu')).toBeNull();

    document.body.removeChild(container);
    wrapper.unmount();
  });

  it('长按图片交给 iOS 系统菜单，不弹应用菜单', async () => {
    vi.useFakeTimers();
    const wrapper = mount(AppContextMenu, { attachTo: document.body });
    const image = document.createElement('img');
    image.src = 'https://img.example/1.jpg';
    document.body.appendChild(image);

    dispatchTouch(image, 'touchstart', [{ clientX: 150, clientY: 420 }]);
    vi.advanceTimersByTime(500);
    await wrapper.vm.$nextTick();

    expect(document.querySelector('.app-context-menu')).toBeNull();

    document.body.removeChild(image);
    wrapper.unmount();
  });

  it('两指触摸不触发长按菜单', async () => {
    vi.useFakeTimers();
    const wrapper = mount(AppContextMenu, { attachTo: document.body });
    const bubble = appendChatMessage('双指不弹菜单', '2004');
    const container = bubble.parentElement as HTMLElement;

    dispatchTouch(bubble, 'touchstart', [
      { clientX: 150, clientY: 420 },
      { clientX: 200, clientY: 430 },
    ]);
    vi.advanceTimersByTime(600);
    await wrapper.vm.$nextTick();

    expect(document.querySelector('.app-context-menu')).toBeNull();

    document.body.removeChild(container);
    wrapper.unmount();
  });
});
