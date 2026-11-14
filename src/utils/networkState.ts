import { ref } from 'vue';

export const networkOnline = ref(typeof navigator === 'undefined' || navigator.onLine);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { networkOnline.value = true; });
  window.addEventListener('offline', () => { networkOnline.value = false; });
}

export function markNetworkReachable(): void {
  networkOnline.value = true;
}
