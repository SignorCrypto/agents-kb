import { useEffect, type RefObject } from 'react';
import { useKanbanStore } from './useKanbanStore';

interface ParsedShortcut {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parse(keys: string): ParsedShortcut {
  const parts = keys.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  return {
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key,
  };
}

function matches(parsed: ParsedShortcut, e: KeyboardEvent): boolean {
  const modPressed = e.metaKey || e.ctrlKey;
  const modMatch = parsed.mod ? modPressed : !modPressed;
  const shiftMatch = parsed.shift ? e.shiftKey : !e.shiftKey;
  const altMatch = parsed.alt ? e.altKey : !e.altKey;
  return modMatch && shiftMatch && altMatch && e.key.toLowerCase() === parsed.key;
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
