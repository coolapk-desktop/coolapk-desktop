import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { CoolapkTauriAPI, isMutationCommand } from '../coolapk';

describe('invokeNative 请求策略：写操作不重试、上传不受 UI 超时限制', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({ code: 200, data: [] });
  });

  it('写命令按白名单判定为 mutation，读命令保持可重试', () => {
    for (const command of [
      'reply_feed', 'create_feed', 'create_forward', 'update_feed', 'delete_feed', 'delete_reply',
      'like_feed', 'unlike_feed', 'like_reply', 'unlike_reply', 'follow_user', 'unfollow_user',
      'special_follow_user', 'send_private_message', 'send_private_image', 'change_avatar',
      'upload_image', 'upload_publish_video', 'save_account', 'set_user_feed_top', 'update_user_profile',
      'comment_apk', 'vote_goods_list_item', 'login_by_account',
    ]) {
      expect(isMutationCommand(command), command).toBe(true);
    }
    for (const command of [
      'get_feed_detail', 'get_user_space', 'list_messages', 'search_feeds', 'check_login_info',
      'check_login_status', 'fetch_external_page', 'resolve_video_url', 'agent_bridge_status',
    ]) {
      expect(isMutationCommand(command), command).toBe(false);
    }
  });

  it('发评论失败后不重试，只提交一次', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('网络连接失败'));
    await expect(CoolapkTauriAPI.replyFeed('42', '内容')).rejects.toThrow('网络连接失败');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('点赞回复等遗漏的写接口同样不重试', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('请求超时'));
    await expect(CoolapkTauriAPI.likeReply('7')).rejects.toThrow('请求超时');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('应用关注用应用 ID 提交，失败时只调用一次', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('网络连接失败'));
    await expect(CoolapkTauriAPI.setApkFollow('42', true)).rejects.toThrow('网络连接失败');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('set_apk_follow', { apkId: '42', follow: true });
  });

  it('读接口未显式指定策略时仍按默认策略重试', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockRejectedValue(new Error('网络连接失败'));
      const request = CoolapkTauriAPI.getUserSpace('2014');
      const failure = expect(request).rejects.toThrow('网络连接失败');
      await vi.advanceTimersByTimeAsync(2_000);
      await failure;
      expect(invoke).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('上传失败不重试，避免重复上传产生孤儿文件', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('请求超时'));
    await expect(CoolapkTauriAPI.uploadImage(new Uint8Array([1, 2, 3]), 'a.png', 'image/png')).rejects.toThrow('请求超时');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('upload_image', expect.objectContaining({ dir: 'feed' }));
  });

  it('上传命令不再被 15s UI 超时误判为失败', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockImplementation((async () => {
        await new Promise(resolve => setTimeout(resolve, 20_000));
        return { code: 200, data: { url: 'https://image.coolapk.com/x.png' } };
      }) as any);
      const request = CoolapkTauriAPI.uploadPublishVideo(new Uint8Array([1]), 'v.mp4', new Uint8Array([2]), 12);
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(request).resolves.toEqual({ code: 200, data: { url: 'https://image.coolapk.com/x.png' } });
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('登录校验不重试且 6s 上限生效', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockRejectedValue(new Error('网络连接失败'));
      await expect(CoolapkTauriAPI.checkLoginInfo()).rejects.toThrow('网络连接失败');
      expect(invoke).toHaveBeenCalledTimes(1);

      vi.mocked(invoke).mockImplementation((() => new Promise(() => {})) as any);
      const hanging = CoolapkTauriAPI.checkLoginStatus();
      const failure = expect(hanging).rejects.toThrow('请求超时');
      await vi.advanceTimersByTimeAsync(6_000);
      await failure;
    } finally {
      vi.useRealTimers();
    }
  });
});
