import { CoolapkTauriAPI } from '../api/coolapk';
import { retainResourceUrl } from './resourceCache';

/** 通过带登录态的原生图片通道读取，再统一转成剪贴板支持的 PNG，避免跨域和 JPEG/WebP 格式限制。 */
export async function createClipboardImage(url: string, loadedDataUrl?: string): Promise<Blob> {
  // 页面生成的图片可直接解码；远端地址必须走原生通道，私信图片才能携带登录态。
  const dataUrl = loadedDataUrl || (/^(data:image\/|blob:)/.test(url) ? url : await CoolapkTauriAPI.getImageDataUrl(url));
  if (!/^(data:image\/|blob:)/.test(dataUrl)) throw new Error('未能读取图片内容');
  // 转换期间继续持有图片，关闭看图器或清缓存也不能打断复制。
  const release = retainResourceUrl(dataUrl);
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片内容无效');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法转换图片格式');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法转换图片格式')), 'image/png'));
  } finally { release(); }
}

/** 在点击事件中立即请求写入，用延迟图片数据保留浏览器要求的用户操作上下文。 */
export async function copyImageToClipboard(url: string, loadedDataUrl?: string): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('当前系统不支持复制图片，请使用保存图片');
  const png = createClipboardImage(url, loadedDataUrl);
  // 写入权限失败时图片转换仍可能继续；消化其拒绝，避免额外产生全局异步错误。
  void png.catch(() => {});
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
