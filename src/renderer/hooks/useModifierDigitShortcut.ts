import { useEffect } from 'react';
import { useKanbanStore } from './useKanbanStore';

interface ParsedModifiers {
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

function parseModifiers(keys: string): ParsedModifiers {
  const parts = keys.toLowerCase().split('+');
  return {
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  };
}

function modifiersMatch(parsed: ParsedModifiers, e: KeyboardEvent): boolean {
  const modPressed = e.metaKey || e.ctrlKey;
  const modMatch = parsed.mod ? modPressed : !modPressed;
  const shiftMatch = parsed.shift ? e.shiftKey : !e.shiftKey;
  const altMatch = parsed.alt ? e.altKey : !e.altKey;
  return modMatch && shiftMatch && altMatch;
}

/**
 * Binds a modifier+digit(1-9) shortcut by its settings ID.
 * The shortcut's `keys` field stores only the modifier prefix (e.g. "mod", "mod+shift").
 * Calls `callback(index)` where index is 1-9 when the modifier combo + a digit is pressed.
 */
export function useModifierDigitShortcut(
  shortcutId: string,
  callback: (index: number) => void,
  options?: { enabled?: boolean },
) {
  const shortcut = useKanbanStore(
    (s) => s.settings.shortcuts.find((sc) => sc.id === shortcutId),
  );

  const enabled = (options?.enabled ?? true) && !!shortcut?.enabled;
  const keys = shortcut?.keys;

  useEffect(() => {
    if (!enabled || !keys) return;

    const parsed = parseModifiers(keys);
    const handler = (e: KeyboardEvent) => {
      const digit = parseInt(e.key);
      if (digit >= 1 && digit <= 9 && modifiersMatch(parsed, e)) {
        e.preventDefault();
        callback(digit);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, keys, callback]);
}
