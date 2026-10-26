/** Android 10 自带的旧 WebView 可能只有 addListener；订阅和清理必须使用同一组接口。 */
export function listenMediaQuery(media: MediaQueryList, listener: () => void): () => void {
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }
  media.addListener(listener);
  return () => media.removeListener(listener);
}
