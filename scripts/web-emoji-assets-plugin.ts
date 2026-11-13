import type { Plugin } from 'vite';

/** Web 版按需请求表情图片，避免把图片编码进每次首屏都要解析的 JS。 */
export function webEmojiAssetsPlugin(): Plugin {
  let webBuild = false;
  return {
    name: 'web-emoji-assets',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) { webBuild = config.mode === 'web'; },
    transform(code, id) {
      if (!webBuild) return;
      const pack = /\/(niuniu|coolapkExtra)EmojiData\.ts$/.exec(id.replaceAll('\\', '/'))?.[1];
      if (!pack) return;
      let number = 0;
      const assets = new Map<string, string>();
      const output = code.replace(/['"]data:image\/png;base64,([a-zA-Z0-9+/=]+)['"]/g, (_literal, data: string) => {
        let reference = assets.get(data);
        if (!reference) {
          reference = this.emitFile({ type: 'asset', name: `emoji-${pack}-${++number}.png`, source: Buffer.from(data, 'base64') });
          assets.set(data, reference);
        }
        return `import.meta.ROLLUP_FILE_URL_${reference}`;
      });
      return { code: output, map: null };
    },
  };
}
