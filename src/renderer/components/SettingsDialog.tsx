import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { KbdRaw } from './Kbd';
import type { AppSettings, ShortcutBinding } from '../types/index';
import { DEFAULT_SETTINGS, DEFAULT_COMMIT_PROMPT } from '../types/index';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Convert a KeyboardEvent into a shortcut string like "mod+shift+k" */
function eventToKeys(e: KeyboardEvent): string | null {
  // Must have at least one modifier
  const hasMod = e.metaKey || e.ctrlKey;
  const hasShift = e.shiftKey;
  const hasAlt = e.altKey;
  if (!hasMod && !hasShift && !hasAlt) return null;

  // Ignore bare modifier presses
  const ignore = new Set(['Meta', 'Control', 'Shift', 'Alt', 'CapsLock', 'Tab']);
  if (ignore.has(e.key)) return null;

  const parts: string[] = [];
  if (hasMod) parts.push('mod');
  if (hasShift) parts.push('shift');
  if (hasAlt) parts.push('alt');
  parts.push(e.key.toLowerCase());
  return parts.join('+');
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useKanbanStore((s) => s.settings);
  const setSettings = useKanbanStore((s) => s.setSettings);
  const api = useElectronAPI();

  const [local, setLocal] = useState<AppSettings>(() => structuredClone(settings));
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Persist changes
  const save = useCallback(
    async (next: AppSettings) => {
      setLocal(next);
      setSettings(next);
      await api.settingsUpdate(next);
    },
    [api, setSettings],
  );

  // Escape to close (or cancel recording)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (recordingId) {
          setRecordingId(null);
        } else {
          onClose();
        }
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingId, onClose]);

  // Key recorder
  useEffect(() => {
    if (!recordingId) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const keys = eventToKeys(e);
      if (!keys) return;

      const next = {
        ...local,
        shortcuts: local.shortcuts.map((s) =>
          s.id === recordingId ? { ...s, keys } : s,
        ),
      };
      save(next);
      setRecordingId(null);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingId, local, save]);

  const toggleHints = () => {
    save({ ...local, showShortcutHints: !local.showShortcutHints });
  };

  const toggleShortcut = (id: string) => {
    save({
      ...local,
      shortcuts: local.shortcuts.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s,
      ),
    });
  };

  const resetDefaults = () => {
    const fresh = structuredClone(DEFAULT_SETTINGS);
    save(fresh);
    setRecordingId(null);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="relative w-[400px] rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl shadow-surface-overlay/20 overflow-hidden animate-[dialogIn_150ms_ease-out] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-content-primary">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/70 transition-colors"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        <div className="border-t border-chrome-subtle/70" />

        {/* Content */}
        <div className="px-5 py-4 space-y-5 overflow-y-auto max-h-[60vh]">

          {/* Section header */}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
              Keyboard Shortcuts
            </span>
          </div>

          {/* Show hints toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Show shortcut hints</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Display key combos on buttons
              </div>
            </div>
            <Toggle checked={local.showShortcutHints} onChange={toggleHints} />
          </div>

          <div className="border-t border-chrome-subtle/40" />

          {/* Shortcut list */}
          <div className="space-y-1">
            {local.shortcuts.map((shortcut) => (
              <ShortcutRow
                key={shortcut.id}
                shortcut={shortcut}
                isRecording={recordingId === shortcut.id}
                onToggle={() => toggleShortcut(shortcut.id)}
                onStartRecording={() => setRecordingId(shortcut.id)}
                onCancelRecording={() => setRecordingId(null)}
              />
            ))}
          </div>

          <div className="border-t border-chrome-subtle/40" />

          {/* Git section */}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
              Git
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <div className="text-[13px] text-content-primary">Commit prompt template</div>
                <div className="text-[10px] text-content-tertiary mt-0.5">
                  Prompt sent to Claude CLI to generate the commit message
                </div>
              </div>
            </div>
            <textarea
              value={local.commitPrompt}
              onChange={(e) => save({ ...local, commitPrompt: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 text-xs rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40 resize-none font-mono"
            />
          </div>

          <div className="border-t border-chrome-subtle/40" />

          {/* Reset */}
          <div className="pt-1">
            <button
              onClick={resetDefaults}
              className="text-[11px] text-content-tertiary hover:text-content-secondary transition-colors"
            >
              Reset all to defaults
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Toggle ─── */

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${
        checked ? 'bg-btn-primary' : 'bg-chrome/40'
      }`}
    >
      <div
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[14px] left-[2px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

/* ─── Shortcut Row ─── */

function ShortcutRow({
  shortcut,
  isRecording,
  onToggle,
  onStartRecording,
  onCancelRecording,
}: {
  shortcut: ShortcutBinding;
  isRecording: boolean;
  onToggle: () => void;
  onStartRecording: () => void;
  onCancelRecording: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
        isRecording
          ? 'bg-focus-ring/8 ring-1 ring-focus-ring/30'
          : 'hover:bg-surface-tertiary/40'
      }`}
    >
      {/* Toggle */}
      <Toggle checked={shortcut.enabled} onChange={onToggle} />

      {/* Label */}
      <span
        className={`flex-1 text-[13px] transition-colors ${
          shortcut.enabled ? 'text-content-primary' : 'text-content-tertiary'
        }`}
      >
        {shortcut.label}
      </span>

      {/* Key badge */}
      {isRecording ? (
        <button
          onClick={onCancelRecording}
          className="relative px-2.5 py-1 rounded-md border border-focus-ring/50 bg-focus-ring/8 min-w-[72px] flex items-center justify-center"
        >
          <span className="text-[10px] text-content-secondary animate-pulse">
            Press keys…
          </span>
        </button>
      ) : (
        <button
          onClick={onStartRecording}
          disabled={!shortcut.enabled}
          className={`group relative px-2.5 py-1 rounded-md border min-w-[72px] flex items-center justify-center transition-all ${
            shortcut.enabled
              ? 'border-chrome/60 bg-surface-tertiary/40 hover:border-chrome-focus/60 hover:bg-surface-tertiary/80 cursor-pointer'
              : 'border-chrome/30 bg-surface-tertiary/20 opacity-40 cursor-not-allowed'
          }`}
          title={shortcut.enabled ? 'Click to rebind' : ''}
        >
          <KbdRaw keys={shortcut.keys} />
        </button>
      )}
    </div>
  );
}
