import { useEffect } from 'react';
import { useKanbanStore } from './useKanbanStore';

interface ParsedModifiers {
  mod: boolean;
  alt: boolean;
}

function parseModifiers(keys: string): ParsedModifiers {
  const parts = keys.toLowerCase().split('+');
  return {
    mod: parts.includes('mod'),
    alt: parts.includes('alt'),
  };
}

function modifiersMatch(parsed: ParsedModifiers, e: KeyboardEvent): boolean {
  const modPressed = e.metaKey || e.ctrlKey;
  const modMatch = parsed.mod ? modPressed : !modPressed;
  // Ignore shift state — some keyboard layouts require Shift to type digits.
  const altMatch = parsed.alt ? e.altKey : !e.altKey;
  return modMatch && altMatch;
}

function getDigit(e: KeyboardEvent): number | null {
  const codeMatch = /^Digit([1-9])$/.exec(e.code);
  if (codeMatch) return Number(codeMatch[1]);

  const keyMatch = /^[1-9]$/.exec(e.key);
  if (keyMatch) return Number(keyMatch[0]);

  return null;
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
      const digit = getDigit(e);
      if (digit !== null && modifiersMatch(parsed, e)) {
        e.preventDefault();
        callback(digit);
      }
    };

    // Capture so focused xterm instances can't swallow the event before the app sees it.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled, keys, callback]);
}
