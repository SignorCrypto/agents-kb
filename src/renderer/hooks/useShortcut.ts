import { useEffect, type RefObject } from 'react';
import { useKanbanStore } from './useKanbanStore';

interface ParsedShortcut {
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parse(keys: string): ParsedShortcut {
  const parts = keys.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  return {
    mod: parts.includes('mod'),
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key,
  };
}

function matches(parsed: ParsedShortcut, e: KeyboardEvent): boolean {
  if (parsed.ctrl) {
    // "ctrl" = specifically ctrlKey, NOT metaKey
    if (!e.ctrlKey || e.metaKey) return false;
  } else if (parsed.mod) {
    // "mod" = metaKey (Mac) or ctrlKey (Windows/Linux)
    if (!(e.metaKey || e.ctrlKey)) return false;
  } else {
    // Neither mod nor ctrl — require both to be released
    if (e.metaKey || e.ctrlKey) return false;
  }
  const shiftMatch = parsed.shift ? e.shiftKey : !e.shiftKey;
  const altMatch = parsed.alt ? e.altKey : !e.altKey;
  return shiftMatch && altMatch && e.key.toLowerCase() === parsed.key;
}

/**
 * Binds a keyboard shortcut by its settings ID.
 * Reads the key combo and enabled state from the app settings store.
 * Optionally scoped to a ref element (otherwise listens on window).
 */
export function useShortcut(
  shortcutId: string,
  callback: () => void,
  options?: { ref?: RefObject<HTMLElement | null>; enabled?: boolean },
) {
  const shortcut = useKanbanStore(
    (s) => s.settings.shortcuts.find((sc) => sc.id === shortcutId),
  );

  const enabled = (options?.enabled ?? true) && !!shortcut?.enabled;
  const keys = shortcut?.keys;
  const ref = options?.ref;

  useEffect(() => {
    if (!enabled || !keys) return;

    const parsed = parse(keys);
    const handler = (e: KeyboardEvent) => {
      if (matches(parsed, e)) {
        e.preventDefault();
        callback();
      }
    };

    const target = ref?.current ?? window;
    target.addEventListener('keydown', handler as EventListener);
    return () => target.removeEventListener('keydown', handler as EventListener);
  }, [enabled, keys, callback, ref]);
}
