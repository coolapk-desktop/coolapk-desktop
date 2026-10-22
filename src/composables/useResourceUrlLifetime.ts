import { onScopeDispose, watch, type Ref } from 'vue';
import { retainResourceUrl } from '../utils/resourceCache';

/** 地址替换、离屏或组件销毁时释放引用；显示中的 Blob 不受缓存淘汰影响。 */
export function useResourceUrlLifetime(source: Readonly<Ref<string | undefined>>) {
  let release = () => {};
  const stop = watch(source, src => { release(); release = retainResourceUrl(src); }, { immediate: true, flush: 'sync' });
  onScopeDispose(() => { stop(); release(); });
}
