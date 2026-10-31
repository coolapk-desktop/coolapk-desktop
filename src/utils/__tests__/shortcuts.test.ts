import { describe, expect, it } from 'vitest';
import { formatShortcut } from '../shortcuts';

describe('formatShortcut', () => {
  it('uses Command and Option symbols on macOS', () => {
    expect(formatShortcut('Ctrl+K', 'macos')).toBe('⌘K');
    expect(formatShortcut('Alt+←', 'macos')).toBe('⌥←');
    expect(formatShortcut('Ctrl+Shift+B', 'macos')).toBe('⌘⇧B');
    expect(formatShortcut('Ctrl+Tab', 'macos', 'Control+Tab')).toBe('⌃Tab');
    expect(formatShortcut('Ctrl+Shift+Tab', 'macos', 'Control+Shift+Tab')).toBe('⌃⇧Tab');
    expect(formatShortcut('Ctrl+PageUp / Ctrl+PageDown', 'macos', '⌘+Shift+[ / ⌘+Shift+]')).toBe('⌘⇧[/⌘⇧]');
  });

  it('keeps Ctrl and Alt labels on Windows and Linux', () => {
    expect(formatShortcut('Ctrl+K', 'windows')).toBe('Ctrl+K');
    expect(formatShortcut('Alt+←', 'linux')).toBe('Alt+←');
    expect(formatShortcut('Ctrl+Tab', 'windows', 'Control+Tab')).toBe('Ctrl+Tab');
  });
});
