import { describe, expect, it, vi } from 'vitest';
import { restoreFullPublishDraft, type FullPublishDraft } from '../publishDrafts';

const baseState = { text: '文字草稿', images: [{ preview: 'p', url: 'https://image.example/a.jpg' }], target: null, productOptions: {}, visibleStatus: 1 as const, largeCover: false, extraOptions: {}, attachmentTitle: '' };

function draftWith(overrides: Partial<FullPublishDraft['state']>): FullPublishDraft {
  return { id: 'd1', title: '草稿', updatedAt: 1, state: { ...baseState, ...overrides } as FullPublishDraft['state'] };
}

describe('restoreFullPublishDraft 容错恢复', () => {
  it('视频数据损坏时降级为丢视频保文字，不再让整份草稿无法恢复', () => {
    const draft = draftWith({ video: { file: { data: '不是base64', name: 'clip.mp4', type: 'video/mp4', lastModified: 0 }, cover: { data: 'image/jpeg;base64,aGk=', name: 'c.jpg', type: 'image/jpeg', lastModified: 0 }, coverPreview: '封面', duration: 5 } });
    const restored = restoreFullPublishDraft(draft);
    expect(restored.video).toBeUndefined();
    expect(restored.text).toBe('文字草稿');
    expect(restored.images[0].url).toBe('https://image.example/a.jpg');
  });

  it('视频数据完好时仍正常恢复视频', () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ok');
    const draft = draftWith({ video: { file: { data: 'video/mp4;base64,aGk=', name: 'clip.mp4', type: 'video/mp4', lastModified: 0 }, cover: { data: 'image/jpeg;base64,aGk=', name: 'c.jpg', type: 'image/jpeg', lastModified: 0 }, coverPreview: '封面', duration: 5 } });
    const restored = restoreFullPublishDraft(draft);
    expect(restored.video?.file.name).toBe('clip.mp4');
    expect(restored.video?.preview).toBe('blob:ok');
    createUrl.mockRestore();
  });

  it('图片数据损坏时保持整体失败，防止用户不知情地发布缺图草稿', () => {
    const draft = draftWith({ images: [{ preview: 'p', file: { data: '坏了', name: 'a.jpg', type: 'image/jpeg', lastModified: 0 } }] });
    expect(() => restoreFullPublishDraft(draft)).toThrow('草稿媒体数据格式无效');
  });
});
