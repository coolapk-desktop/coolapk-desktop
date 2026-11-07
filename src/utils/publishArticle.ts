import type { PublishImage } from './publishMedia';

export type { PublishImage } from './publishMedia';

export type PublishArticleBlock =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; image: PublishImage; description?: string }
  | { id: string; type: 'preserved'; model: Record<string, unknown> };

export interface PublishArticleState {
  title: string;
  cover: PublishImage | null;
  blocks: PublishArticleBlock[];
}

export type PublishArticleModel =
  | { type: 'top'; url: string; description: string }
  | { type: 'text'; message: string }
  | { type: 'image'; url: string; description: string }
  | ({ type: 'card' | 'shareUrl' | 'else' } & Record<string, unknown>);

export interface PublishArticleUploadedUrls {
  cover?: string | null;
  images?: Readonly<Record<string, string>> | ReadonlyMap<string, string>;
}

export interface PublishArticleMetadata {
  title?: unknown;
  cover?: unknown;
}

function uploadedImageUrl(
  urls: PublishArticleUploadedUrls['images'],
  id: string,
): string | undefined {
  if (!urls) return undefined;
  if (typeof (urls as ReadonlyMap<string, string>).get === 'function') {
    return (urls as ReadonlyMap<string, string>).get(id);
  }
  const record = urls as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(record, id) ? record[id] : undefined;
}

function requiredImageUrl(url: string | undefined, label: string): string {
  if (!url?.trim()) throw new Error(`${label}尚未上传`);
  return url;
}

/**
 * 合并连续的空文本段落，并保证正文至少有一个文字段落。
 * 老草稿/老编辑器在段落末尾插图会留下多个空段落，加载时先收敛一次。
 */
export function normalizePublishArticleBlocks(blocks: PublishArticleBlock[]): PublishArticleBlock[] {
  const normalized: PublishArticleBlock[] = [];
  let previousEmpty = false;
  for (const block of blocks) {
    const isEmptyText = block.type === 'text' && !block.text.trim();
    if (isEmptyText && previousEmpty) continue;
    normalized.push(block);
    previousEmpty = isEmptyText;
  }
  if (!normalized.some((block) => block.type === 'text')) {
    normalized.push({ id: makeArticleBlockId('text'), type: 'text', text: '' });
  }
  return normalized;
}

function articleBlocksForSubmission(blocks: PublishArticleBlock[]): PublishArticleBlock[] {
  let end = blocks.length;
  while (end > 0) {
    const last = blocks[end - 1];
    if (last.type !== 'text' || last.text.trim()) break;
    end -= 1;
  }
  return blocks.slice(0, end);
}

/** Build the official article body array; title and cover are separate fields. */
export function buildPublishArticleModels(
  state: PublishArticleState,
  uploadedUrls: PublishArticleUploadedUrls = {},
): PublishArticleModel[] {
  // FeedUploader + C10318 exclude Top/Bottom/RelativeInfo from message. The
  // title and cover are sent separately as message_title/message_cover.
  const models: PublishArticleModel[] = [];

  for (const block of articleBlocksForSubmission(state.blocks)) {
    if (block.type === 'text') {
      models.push({ type: 'text', message: block.text });
      continue;
    }
    if (block.type === 'preserved') {
      models.push(block.model as PublishArticleModel);
      continue;
    }

    const imageUrl = uploadedImageUrl(uploadedUrls.images, block.id) ?? block.image.url;
    models.push({
      type: 'image',
      url: requiredImageUrl(imageUrl, '正文图片'),
      description: block.description || '',
    });
  }

  return models;
}

/** Serialize the official ArticleModel array for the feed `message` field. */
export function buildPublishArticleMessage(
  state: PublishArticleState,
  uploadedUrls: PublishArticleUploadedUrls = {},
): string {
  return JSON.stringify(buildPublishArticleModels(state, uploadedUrls));
}

/** Parse an official ArticleModel message into the editable text/image blocks. */
export function parsePublishArticleMessage(
  rawMessage: unknown,
  metadata: PublishArticleMetadata = {},
): PublishArticleState {
  let parsed: unknown = rawMessage;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error('图文正文格式无法识别，为避免保存时丢失内容，已停止编辑');
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error('图文正文格式无法识别，为避免保存时丢失内容，已停止编辑');
  }

  const models = parsed as Array<Record<string, unknown>>;
  const topModels = models.filter((model) => model && typeof model === 'object' && model.type === 'top');
  if (topModels.length > 1) throw new Error('图文包含多个题图模型，暂不能安全编辑');
  const top = topModels[0];
  const metadataTitle = typeof metadata.title === 'string' ? metadata.title : '';
  const metadataCover = typeof metadata.cover === 'string' ? metadata.cover : '';
  const title = metadataTitle || (typeof top?.description === 'string' ? top.description : '');
  const coverUrl = metadataCover || (typeof top?.url === 'string' ? top.url : '');
  const blocks: PublishArticleBlock[] = [];

  for (const model of models) {
    if (!model || typeof model !== 'object' || typeof model.type !== 'string') {
      throw new Error('图文包含无法识别的内容，为避免保存时丢失，已停止编辑');
    }
    if (model.type === 'top') continue;
    // The official FeedUploader strips Bottom and RelativeInfo from the body.
    if (model.type === 'bottom' || model.type === 'relativeInfo') continue;
    if (model.type === 'text') {
      if (typeof model.message !== 'string') throw new Error('图文文字段落格式无效，已停止编辑');
      blocks.push({ id: makeArticleBlockId('text'), type: 'text', text: model.message });
      continue;
    }
    if (model.type === 'image') {
      if (typeof model.url !== 'string' || !model.url.trim()) {
        throw new Error('图文正文图片地址缺失，为避免保存时丢图，已停止编辑');
      }
      blocks.push({
        id: makeArticleBlockId('image'),
        type: 'image',
        image: { url: model.url, preview: model.url },
        description: typeof model.description === 'string' ? model.description : '',
      });
      continue;
    }
    if (model.type === 'card' || model.type === 'shareUrl' || model.type === 'else') {
      blocks.push({ id: makeArticleBlockId('preserved'), type: 'preserved', model: { ...model } });
      continue;
    }
    throw new Error(`图文包含当前编辑器暂不支持的“${model.type}”内容，为避免保存时丢失，已停止编辑`);
  }

  if (blocks.length === 0) blocks.push({ id: makeArticleBlockId('text'), type: 'text', text: '' });
  return {
    title,
    cover: coverUrl ? { url: coverUrl, preview: coverUrl } : null,
    blocks: normalizePublishArticleBlocks(blocks),
  };
}

function makeArticleBlockId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

/** A publishable article must contain at least one non-empty text block. */
export function hasPublishableArticleText(state: PublishArticleState): boolean {
  return state.blocks.some((block) => block.type === 'text' && block.text.trim().length > 0);
}
