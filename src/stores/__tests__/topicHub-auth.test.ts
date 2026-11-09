import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import { useTopicHubStore } from '../../stores/topicHub';
import { CoolapkTauriAPI } from '../../api/coolapk';

describe('topicHub 账号维度清空（切号/登出防串号）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setActivePinia(createPinia());
    useAuthStore();
  });

  /** 种一个旧账号视角的话题页状态：流缓存带 userAction，split 视图选中一条 feed。 */
  function seedTopicState() {
    const topic = useTopicHubStore();
    topic.setCategories([{ key: 't', title: '话题', url: '/topic/t' }]);
    topic.setTopicItems([
      { fid: 'f1', title: '动态1', userAction: { collect: 1 }, favnum: 42 },
      { fid: 'f2', title: '动态2' },
    ]);
    topic.openTopicSplit({ tag: '#测试', title: '测试话题' });
    topic.selectFeed({ fid: 'f1', title: '动态1', userAction: { collect: 1 } });
    expect(topic.rawTopicItems.length).toBe(2);
    expect(topic.activeFeed).not.toBeNull();
    expect(topic.viewMode).toBe('split');
    return topic;
  }

  it('logout 清空话题流缓存与选中的 feed，保留账号无关状态', async () => {
    const topic = seedTopicState();
    const store = useAuthStore();
    vi.spyOn(CoolapkTauriAPI, 'clearCookie').mockResolvedValue(undefined as any);
    vi.spyOn(CoolapkTauriAPI, 'listAccounts').mockResolvedValue({ code: 200, data: [] } as any);
    await store.logout();
    // 账号相关：上一账号视角的流缓存与选中 feed 必须清空。
    expect(topic.rawTopicItems).toEqual([]);
    expect(topic.activeFeed).toBeNull();
    // 账号无关：话题本身、分类、视图偏好、过渡态保留，重进页面后正常恢复。
    expect(topic.activeTopicTag).toBe('测试');
    expect(topic.activeTopic).not.toBeNull();
    expect(topic.categories.length).toBe(1);
    expect(topic.viewMode).toBe('split');
  });

  it('loginAs 切号后同样清空，用户可见口径：不再显示上一账号的收藏态', async () => {
    const topic = seedTopicState();
    const store = useAuthStore();
    vi.spyOn(CoolapkTauriAPI, 'loginAs').mockResolvedValue({
      code: 200,
      data: { uid: 'u2', username: '账号B' },
    } as any);
    vi.spyOn(CoolapkTauriAPI, 'listAccounts').mockResolvedValue({ code: 200, data: [] } as any);
    await store.loginAs('u2');
    expect(topic.rawTopicItems).toEqual([]);
    expect(topic.activeFeed).toBeNull();
    // 缓存清空后话题页只能按新账号重新拉取实体，不可能再读到旧的 userAction.collect=1。
  });

  it('loginAs 失败（凭据无效）时不误清话题状态', async () => {
    const topic = seedTopicState();
    const store = useAuthStore();
    vi.spyOn(CoolapkTauriAPI, 'loginAs').mockResolvedValue({ code: 200, data: {} } as any);
    await expect(store.loginAs('u2')).rejects.toThrow('切换账户失败');
    expect(topic.rawTopicItems.length).toBe(2);
    expect(topic.activeFeed).not.toBeNull();
  });
});
