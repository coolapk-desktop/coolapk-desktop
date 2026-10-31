import { onMounted, ref } from 'vue';
import { getPlatformInfo } from './platform';

const platformOs = ref<string>('windows');

export function formatShortcut(shortcut: string, os: string, macShortcut?: string): string {
  if (os !== 'macos') return shortcut;
  return (macShortcut ?? shortcut)
    .replace(/Control/gi, '⌃')
    .replace(/Ctrl/gi, '⌘')
    .replace(/Alt/gi, '⌥')
    .replace(/Shift/gi, '⇧')
    .replace(/\s*\+\s*/g, '')
    .replace(/\s*\/\s*/g, '/');
}

export function usePlatformShortcuts() {
  onMounted(() => {
    if (!(window as any).__TAURI_INTERNALS__) return;
    void getPlatformInfo().then((platform) => {
      platformOs.value = platform.os;
    });
  });
  return {
    formatShortcut: (shortcut: string, macShortcut?: string) => formatShortcut(shortcut, platformOs.value, macShortcut),
  };
}
