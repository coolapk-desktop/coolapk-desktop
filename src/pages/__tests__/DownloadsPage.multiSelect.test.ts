import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  confirm: vi.fn(),
  toast: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  removeUpdateTask: vi.fn(),
  pauseAll: vi.fn(),
  resumeAll: vi.fn(),
  clearFailed: vi.fn(),
  clearHistory: vi.fn(),
  initialize: vi.fn(),
  pump: vi.fn(),
  open: vi.fn(),
  install: vi.fn(),
  restart: vi.fn(),
  retry: vi.fn(),
  openDirectory: vi.fn(),
}));

// 下载中心在测试里用可控替身 store：本文件验证的是「多选 UI + 批量调用口径」，
// 真实的 enqueue/pump 调度由 stores/__tests__ 覆盖。
const dl = vi.hoisted(() => ({ state: null as any }));

vi.mock('../../stores/downloads', async () => {
  const { reactive, computed } = await import('vue');
  const tasks = reactive<any[]>([]);
  const historyStatuses = ['completed', 'failed', 'canceled'];
  // pinia store 的 state/getter 在消费侧已解包，替身也必须直接给数组。
  const activeList = computed(() => tasks.filter((task: any) => !historyStatuses.includes(task.status)));
  const historyList = computed(() => tasks.filter((task: any) => historyStatuses.includes(task.status)));
  const store: any = {
    tasks,
    get activeTasks() { return activeList.value; },
    get historyTasks() { return historyList.value; },
    get activeCount() { return activeList.value.length; },
    get totalSpeed() { return 0; },
    get completedTotalBytes() { return 0; },
    pause: mocks.pause,
    resume: mocks.resume,
    cancel: mocks.cancel,
    remove: mocks.remove,
    removeUpdateTask: mocks.removeUpdateTask,
    pauseAll: mocks.pauseAll,
    resumeAll: mocks.resumeAll,
    clearFailed: mocks.clearFailed,
    clearHistory: mocks.clearHistory,
    initialize: mocks.initialize,
    pump: mocks.pump,
    open: mocks.open,
    install: mocks.install,
    restart: mocks.restart,
    retry: mocks.retry,
    openDirectory: mocks.openDirectory,
  };
  dl.state = store;
  return {
    useDownloadStore: () => store,
    isUpdateTask: (task: any) => task?.kind === 'update',
  };
});

vi.mock('../../stores/settings', () => ({
  useSettingsStore: () => ({ settings: { downloadPath: '/tmp/downloads' } }),
}));

vi.mock('../../utils/confirm', () => ({ requestConfirmation: mocks.confirm }));

vi.mock('../../utils/toast', () => ({ showToast: mocks.toast }));

// 只替换 useRoute/useRouter：保留真实的 createRouter，避免影响 src/router 的模块初始化。
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  const { reactive } = await import('vue');
  const route = reactive({ path: '/downloads', query: {} as any });
  return {
    ...actual,
    useRoute: () => route,
    useRouter: () => mocks.router,
    __route: route,
  };
});

import DownloadsPage from '../DownloadsPage.vue';

function task(id: string, status: string, extra: Record<string, any> = {}) {
  return {
    id,
    title: `应用${id}`,
    packageName: `com.demo.${id}`,
    versionName: '1.0.0',
    fileName: `${id}.apk`,
    kind: 'apk',
    status,
    downloaded: 0,
    total: 100,
    progress: 0,
    speed: 0,
    ...extra,
  };
}

async function setup(tasks: any[], tab: 'active' | 'history' = 'active') {
  dl.state.tasks.splice(0, dl.state.tasks.length, ...tasks);
  const routerMod: any = await import('vue-router');
  routerMod.__route.query = tab === 'history' ? { tab: 'history' } : {};
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/downloads', component: DownloadsPage }],
  });
  await router.push('/downloads');
  const wrapper = mount(DownloadsPage, {
    global: {
      plugins: [pinia, router],
      stubs: {
        AppButton: {
          props: ['loading', 'disabled', 'icon', 'variant', 'size'],
          template: '<button :disabled="disabled || loading"><slot /></button>',
        },
        AppImage: true,
        EmptyState: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

function buttonByText(wrapper: any, text: string) {
  return wrapper.findAll('button').find((item: any) => item.text().trim() === text);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  mocks.pause.mockResolvedValue(undefined);
  mocks.resume.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.pauseAll.mockResolvedValue(undefined);
  mocks.resumeAll.mockResolvedValue(undefined);
  mocks.clearFailed.mockResolvedValue(undefined);
  mocks.clearHistory.mockResolvedValue(undefined);
});

describe('下载中心多选批量操作', () => {
  it('进入多选后显示已选数量，全选按钮显示当前列表条数', async () => {
    const wrapper = await setup([task('a', 'downloading'), task('b', 'paused'), task('c', 'queued')]);
    try {
      await buttonByText(wrapper, '多选')!.trigger('click');
      expect(wrapper.find('.download-selection-bar').exists()).toBe(true);
      expect(wrapper.find('.selection-count').text()).toBe('已选 0 项');
      expect(buttonByText(wrapper, '全选 3 条')).toBeDefined();

      await buttonByText(wrapper, '全选 3 条')!.trigger('click');
      expect(wrapper.find('.selection-count').text()).toBe('已选 3 项');
      // 全选后按钮变成取消全选，语义与数量一致
      expect(buttonByText(wrapper, '取消全选')).toBeDefined();
      expect(wrapper.findAll('.download-select-box.checked')).toHaveLength(3);
    } finally {
      wrapper.unmount();
    }
  });

  it('暂停所选只作用于可暂停任务，跳过不可暂停的并如实汇报', async () => {
    const wrapper = await setup([task('a', 'downloading'), task('b', 'paused'), task('c', 'queued')]);
    try {
      await buttonByText(wrapper, '多选')!.trigger('click');
      await buttonByText(wrapper, '全选 3 条')!.trigger('click');
      await buttonByText(wrapper, '暂停所选')!.trigger('click');
      await flushPromises();

      // 暂停中的任务不可再暂停，必须跳过而不是谎报成功
      expect(mocks.pause.mock.calls.map((call) => call[0])).toEqual(['a', 'c']);
      expect(mocks.toast.mock.calls.at(-1)![0]).toBe('已暂停 2 条任务，跳过 1 条');
      // 批量完成即退出多选，避免选择集合残留
      expect(wrapper.find('.download-selection-bar').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('下载历史多选删除只删除选中的记录，且不动安装包文件', async () => {
    const wrapper = await setup(
      [task('h1', 'completed', { downloaded: 100 }), task('h2', 'failed'), task('h3', 'completed', { downloaded: 100 })],
      'history',
    );
    try {
      await buttonByText(wrapper, '多选')!.trigger('click');
      const cards = wrapper.findAll('.download-card');
      await cards[0]!.trigger('click');
      await cards[2]!.trigger('click');
      expect(wrapper.find('.selection-count').text()).toBe('已选 2 项');

      await buttonByText(wrapper, '删除记录')!.trigger('click');
      await flushPromises();

      expect(mocks.remove.mock.calls).toEqual([['h1'], ['h3']]);
      expect(mocks.toast.mock.calls.at(-1)![0]).toBe('已删除 2 条任务');
      expect(wrapper.find('.download-selection-bar').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('切换任务分类时退出多选并清空已选', async () => {
    const wrapper = await setup([task('a', 'downloading'), task('b', 'paused'), task('h1', 'completed', { downloaded: 100 })]);
    try {
      await buttonByText(wrapper, '多选')!.trigger('click');
      await wrapper.findAll('.download-card')[0]!.trigger('click');
      expect(wrapper.find('.selection-count').text()).toBe('已选 1 项');

      const historyTab = wrapper.findAll('.segmented-tab').find((tab) => tab.text().includes('下载历史'));
      await historyTab!.trigger('click');
      await flushPromises();

      expect(wrapper.find('.download-selection-bar').exists()).toBe(false);
      // 切到历史分类后重新进入多选：上一类的选中项不能带过来
      await buttonByText(wrapper, '多选')!.trigger('click');
      await flushPromises();
      expect(wrapper.find('.selection-count').text()).toBe('已选 0 项');
    } finally {
      wrapper.unmount();
    }
  });

  it('移动端长按卡片进入多选并选中该条', async () => {
    vi.useFakeTimers();
    const wrapper = await setup([task('a', 'downloading'), task('b', 'completed')]);
    try {
      const card = wrapper.findAll('.download-card')[0]!;
      await card.trigger('pointerdown');
      vi.advanceTimersByTime(520);
      await flushPromises();

      expect(wrapper.find('.download-selection-bar').exists()).toBe(true);
      expect(wrapper.find('.selection-count').text()).toBe('已选 1 项');
      expect(card.classes()).toContain('selected');
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });
});
