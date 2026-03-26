import { useKanbanStore } from '../hooks/useKanbanStore';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const symbols: Record<string, [mac: string, other: string]> = {
  mod: ['\u2318', 'Ctrl'],
  enter: ['\u21B5', '\u21B5'],
  shift: ['\u21E7', 'Shift'],
  alt: ['\u2325', 'Alt'],
  tab: ['\u21E5', 'Tab'],
};

function resolve(key: string): string {
  const entry = symbols[key.toLowerCase()];
  return entry ? (isMac ? entry[0] : entry[1]) : key.toUpperCase();
}

/** Renders a key combo string like "mod+enter" as symbols. No settings awareness. */
export function KbdRaw({ keys }: { keys: string }) {
  const parts = keys.split('+').map(resolve);
  return (
    <span className="inline-flex items-center gap-px text-[10px] leading-none font-normal tracking-wide">
      {parts.map((p, i) => (
        <kbd key={i} className="font-sans not-italic">{p}</kbd>
      ))}
    </span>
  );
}

/**
 * Settings-aware shortcut hint. Renders nothing if hints are disabled.
 * Reads the key combo from the settings store by shortcut ID.
 */
export function Kbd({ shortcutId }: { shortcutId: string }) {
  const showHints = useKanbanStore((s) => s.settings.showShortcutHints);
  const shortcut = useKanbanStore(
    (s) => s.settings.shortcuts.find((sc) => sc.id === shortcutId),
  );

  if (!showHints || !shortcut?.enabled) return null;

  return (
    <span className="inline-flex items-center gap-px ml-1.5 opacity-50 text-[10px] leading-none font-normal tracking-wide">
      {shortcut.keys.split('+').map(resolve).map((p, i) => (
        <kbd key={i} className="font-sans not-italic">{p}</kbd>
      ))}
    </span>
  );
}

/**
 * Settings-aware modifier+digit hint. Renders the modifier prefix from a
 * modifier shortcut (e.g. "mod" or "mod+shift") followed by a specific digit.
 * Renders nothing if hints are disabled or the shortcut is disabled.
 */
export function KbdDigit({ shortcutId, digit }: { shortcutId: string; digit: number }) {
  const showHints = useKanbanStore((s) => s.settings.showShortcutHints);
  const shortcut = useKanbanStore(
    (s) => s.settings.shortcuts.find((sc) => sc.id === shortcutId),
  );

  if (!showHints || !shortcut?.enabled) return null;

  const parts = shortcut.keys.split('+').map(resolve);

  return (
    <span className="inline-flex items-center gap-px ml-1.5 opacity-50 text-[10px] leading-none font-normal tracking-wide">
      {parts.map((p, i) => (
        <kbd key={i} className="font-sans not-italic">{p}</kbd>
      ))}
      <kbd className="font-sans not-italic">{digit}</kbd>
    </span>
  );
}
