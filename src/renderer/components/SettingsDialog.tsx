import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { KbdRaw } from './Kbd';
import { SegmentedPicker } from './SegmentedPicker';
import { CompactSelect } from './CompactSelect';
import { CheckForUpdatesButton } from './UpdateButton';
import type { AppSettings, ShortcutBinding, ThemeMode, PreferredEditor, AccountInfo } from '../types/index';
import { DEFAULT_SETTINGS, getEffortOptionsForThinking, getThinkingModeOptionsForModel, normalizeEffortForThinking, PERMISSION_MODE_CATALOG } from '../types/index';
import { XIcon } from './Icons';
import { Textarea } from './Input';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Convert a KeyboardEvent into a shortcut string like "mod+shift+k" */
function eventToKeys(e: KeyboardEvent): string | null {
  // Must have at least one modifier
  const hasMod = e.metaKey || e.ctrlKey;
  const hasShift = e.shiftKey;
  const hasAlt = e.altKey;
  if (!hasMod && !hasShift && !hasAlt) return null;

  // Ignore bare modifier presses (Tab is allowed when combined with a modifier)
  const ignore = new Set(['Meta', 'Control', 'Shift', 'Alt', 'CapsLock']);
  if (ignore.has(e.key)) return null;

  const parts: string[] = [];
  if (hasMod) parts.push('mod');
  if (hasShift) parts.push('shift');
  if (hasAlt) parts.push('alt');
  parts.push(e.key.toLowerCase());
  return parts.join('+');
}

const MODIFIER_SHORTCUT_IDS = new Set(['switchTerminalTab']);
const MODIFIER_KEYS = new Set(['mod', 'shift', 'alt']);

/** Strip trailing non-modifier key from a shortcut string, keeping only modifier prefix. */
function stripToModifiers(keys: string): string {
  const parts = keys.toLowerCase().split('+');
  const modifiers = parts.filter((p) => MODIFIER_KEYS.has(p));
  return modifiers.length > 0 ? modifiers.join('+') : keys;
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useKanbanStore((s) => s.settings);
  const setSettings = useKanbanStore((s) => s.setSettings);
  const availableModels = useKanbanStore((s) => s.availableModels);
  const api = useElectronAPI();

  const [local, setLocal] = useState<AppSettings>(() => structuredClone(settings));
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const installedEditors = useKanbanStore((s) => s.installedEditors);
  const dialogRef = useRef<HTMLDivElement>(null);
  const localRef = useRef(local);
  const saveQueueRef = useRef(Promise.resolve());
  const defaultModelOption = availableModels.find((m) => m.value === local.defaultModel);
  const thinkingModeOptions = getThinkingModeOptionsForModel(defaultModelOption);
  const effortOptions = getEffortOptionsForThinking(defaultModelOption, local.defaultThinkingMode);
  const normalizedDefaultEffort = normalizeEffortForThinking(
    defaultModelOption,
    local.defaultThinkingMode,
    local.defaultEffort,
  );

  useEffect(() => {
    localRef.current = local;
  }, [local]);

  useEffect(() => {
    window.electronAPI.appGetVersion().then(setAppVersion).catch(() => { });
    window.electronAPI.accountInfo().then((info) => { if (info) setAccountInfo(info); }).catch(() => { });
    const unsub = window.electronAPI.onAccountUpdated(setAccountInfo);
    return unsub;
  }, []);

  // Persist changes
  const persistSettings = useCallback(
    (next: AppSettings) => {
      localRef.current = next;
      setLocal(next);
      setSettings(next);
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => api.settingsUpdate(next))
        .then(() => undefined);
    },
    [api, setSettings],
  );

  const patchSettings = useCallback(
    (updater: Partial<AppSettings> | ((current: AppSettings) => AppSettings)) => {
      const current = localRef.current;
      const next = typeof updater === 'function'
        ? updater(current)
        : { ...current, ...updater };
      persistSettings(next);
    },
    [persistSettings],
  );

  useEffect(() => {
    if (normalizedDefaultEffort !== local.defaultEffort) {
      patchSettings({ defaultEffort: normalizedDefaultEffort });
    }
  }, [local.defaultEffort, normalizedDefaultEffort, patchSettings]);

  // Fall back to the first installed editor if the current preference is unavailable
  useEffect(() => {
    if (!installedEditors) return;
    const preferred = local.preferredEditor;
    const isAvailable = preferred && preferred !== 'auto' && installedEditors[preferred];
    if (!isAvailable) {
      const firstInstalled = EDITOR_OPTIONS.find((o) => installedEditors[o.value]);
      if (firstInstalled) {
        patchSettings({ preferredEditor: firstInstalled.value });
      }
    }
  }, [installedEditors]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const isModifierShortcut = MODIFIER_SHORTCUT_IDS.has(recordingId);

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const keys = eventToKeys(e);
      if (!keys) return;

      // For modifier shortcuts, strip the trailing non-modifier key to save only the prefix
      const finalKeys = isModifierShortcut ? stripToModifiers(keys) : keys;

      patchSettings((current) => ({
        ...current,
        shortcuts: current.shortcuts.map((s) =>
          s.id === recordingId ? { ...s, keys: finalKeys } : s,
        ),
      }));
      setRecordingId(null);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [patchSettings, recordingId]);

  const toggleHints = () => {
    patchSettings((current) => ({ ...current, showShortcutHints: !current.showShortcutHints }));
  };

  const toggleShortcut = (id: string) => {
    patchSettings((current) => ({
      ...current,
      shortcuts: current.shortcuts.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s,
      ),
    }));
  };

  const resetDefaults = () => {
    const fresh = structuredClone(DEFAULT_SETTINGS);
    persistSettings(fresh);
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
        className="relative w-[520px] rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl shadow-surface-overlay/20 overflow-hidden animate-[dialogIn_150ms_ease-out] flex flex-col"
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
            <XIcon size={12} />
          </button>
        </div>

        <div className="border-t border-chrome-subtle/70" />

        {/* Content */}
        <div className="px-5 py-4 space-y-5 overflow-y-auto max-h-[60vh]">

          {/* Account */}
          {accountInfo && (
            <>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
                  Account
                </span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[13px] text-content-primary truncate">
                    {accountInfo.email || 'Unknown'}
                  </div>
                  <div className="text-[11px] text-content-tertiary mt-0.5">
                    {[
                      accountInfo.organization,
                      accountInfo.subscriptionType,
                    ].filter(Boolean).join(' \u00B7 ') || 'Personal account'}
                  </div>
                </div>
                {accountInfo.tokenSource && (
                  <span className="text-[10px] font-medium text-content-tertiary bg-surface-tertiary/50 rounded-full px-2 py-0.5 leading-none shrink-0">
                    {accountInfo.tokenSource}
                  </span>
                )}
              </div>

              <div className="border-t border-chrome-subtle/40" />
            </>
          )}

          {/* Appearance */}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
              Appearance
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Theme</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Select light, dark, or match your system
              </div>
            </div>
            <SegmentedPicker
              options={THEME_OPTIONS}
              value={local.theme}
              onChange={(theme) => patchSettings({ theme })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Preferred Editor</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                {installedEditors
                  ? (() => {
                      const found = EDITOR_OPTIONS.filter((o) => installedEditors[o.value]);
                      return found.length > 0
                        ? `Detected: ${found.map((o) => o.label).join(', ')}`
                        : 'No supported editors detected';
                    })()
                  : 'Detecting installed editors\u2026'}
              </div>
            </div>
            {installedEditors && (() => {
              const available = EDITOR_OPTIONS.filter((o) => installedEditors[o.value]);
              return available.length > 0 ? (
                <SegmentedPicker
                  options={available}
                  value={available.some((o) => o.value === local.preferredEditor) ? local.preferredEditor : available[0].value}
                  onChange={(preferredEditor) => patchSettings({ preferredEditor })}
                />
              ) : null;
            })()}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Notifications</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Show system notifications for job events
              </div>
            </div>
            <Toggle checked={local.notificationsEnabled} onChange={() => patchSettings((current) => ({ ...current, notificationsEnabled: !current.notificationsEnabled }))} />
          </div>

          <div className="border-t border-chrome-subtle/40" />

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
              Git
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Delete completed jobs on commit</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Remove completed jobs for the same project and branch after commit
              </div>
            </div>
            <Toggle
              checked={local.deleteCompletedJobsOnCommit}
              onChange={() => patchSettings((current) => ({ ...current, deleteCompletedJobsOnCommit: !current.deleteCompletedJobsOnCommit }))}
            />
          </div>

          <CommitPromptEditor
            value={local.promptConfigs.commit.prompt}
            onChange={(prompt) => {
              patchSettings((current) => ({
                ...current,
                promptConfigs: {
                  ...current.promptConfigs,
                  commit: {
                    ...current.promptConfigs.commit,
                    prompt,
                  },
                },
              }));
            }}
          />

          <div className="border-t border-chrome-subtle/40" />

          {/* Claude section */}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
              Claude
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Default Model</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Model for new jobs unless overridden
              </div>
            </div>
            <CompactSelect
              options={availableModels}
              value={local.defaultModel}
              onChange={(defaultModel) => patchSettings({ defaultModel })}
            />
          </div>

          <div className="rounded-lg border border-chrome-subtle/50 bg-surface-secondary/70 px-3 py-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] text-content-primary">Default Thinking</div>
                <div className="text-[11px] text-content-tertiary mt-0.5">
                  Populated from the selected model&apos;s SDK capabilities
                </div>
              </div>
              <CompactSelect
                options={thinkingModeOptions}
                value={local.defaultThinkingMode}
                onChange={(defaultThinkingMode) => patchSettings({ defaultThinkingMode })}
              />
            </div>

            {effortOptions.length > 0 ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] text-content-secondary">Effort</div>
                  <div className="text-[11px] text-content-tertiary mt-0.5">
                    Guides depth when thinking is enabled
                  </div>
                </div>
                <CompactSelect
                  options={effortOptions}
                  value={normalizedDefaultEffort ?? effortOptions[0]?.value ?? ''}
                  onChange={(defaultEffort) => patchSettings({ defaultEffort })}
                />
              </div>
            ) : (
              <div className="rounded-md bg-surface-tertiary/40 px-3 py-2 text-[11px] leading-relaxed text-content-tertiary">
                {local.defaultThinkingMode === 'disabled'
                  ? 'Effort is unavailable while thinking is disabled.'
                  : 'This model does not expose effort levels in the SDK.'}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Always show model/thinking</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Display badges on cards even when using defaults
              </div>
            </div>
            <Toggle checked={local.alwaysShowModelEffort} onChange={() => patchSettings((current) => ({ ...current, alwaysShowModelEffort: !current.alwaysShowModelEffort }))} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Show token usage</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Display token counts per phase in job details
              </div>
            </div>
            <Toggle checked={local.showTokenUsage} onChange={() => patchSettings((current) => ({ ...current, showTokenUsage: !current.showTokenUsage }))} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Show context usage</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Display context window fill bar in job details
              </div>
            </div>
            <Toggle checked={local.showContextUsage} onChange={() => patchSettings((current) => ({ ...current, showContextUsage: !current.showContextUsage }))} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Show model/thinking in New Job</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Display model and thinking pickers when creating a job
              </div>
            </div>
            <Toggle checked={local.showModelEffortInNewJob} onChange={() => patchSettings((current) => ({ ...current, showModelEffortInNewJob: !current.showModelEffortInNewJob }))} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] text-content-primary">Permission Mode</div>
                <div className="text-[11px] text-content-tertiary mt-0.5">
                  How Claude handles permissions during sessions
                </div>
              </div>
              <SegmentedPicker
                options={PERMISSION_MODE_CATALOG}
                value={local.permissionMode}
                onChange={(permissionMode) => patchSettings({ permissionMode })}
              />
            </div>
            {(() => {
              const selected = PERMISSION_MODE_CATALOG.find((m) => m.value === local.permissionMode);
              return selected ? (
                <div className="rounded-md bg-chrome-subtle/30 px-3 py-2 text-[11px] text-content-tertiary leading-relaxed">
                  <span className="text-content-secondary font-medium">{selected.label}</span> — {selected.description}
                </div>
              ) : null;
            })()}

          </div>

          <div className="border-t border-chrome-subtle/40" />

          {/* Keyboard Shortcuts */}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
              Keyboard Shortcuts
            </span>
          </div>

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

          <div className="space-y-1">
            {local.shortcuts
              .filter((s) => !MODIFIER_SHORTCUT_IDS.has(s.id))
              .map((shortcut) => (
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

          <div className="space-y-1">
            {local.shortcuts
              .filter((s) => MODIFIER_SHORTCUT_IDS.has(s.id))
              .map((shortcut) => (
                <ModifierShortcutRow
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

          {/* About */}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
              About
            </span>
          </div>

          {appVersion && (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] text-content-primary">Version</div>
                <div className="text-[11px] text-content-tertiary mt-0.5">
                  Currently installed version
                </div>
              </div>
              <span className="text-[11px] text-content-secondary font-mono">v{appVersion}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-content-primary">Updates</div>
              <div className="text-[11px] text-content-tertiary mt-0.5">
                Check for new versions on GitHub
              </div>
            </div>
            <CheckForUpdatesButton />
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
      className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${checked ? 'bg-btn-primary' : 'bg-chrome/40'
        }`}
    >
      <div
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[14px] left-[2px]' : 'left-[2px]'
          }`}
      />
    </button>
  );
}

/* ─── Prompt Config Editor ─── */

function CommitPromptEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (prompt: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-[13px] text-content-primary">Commit message prompt</div>
        <div className="text-[11px] text-content-tertiary mt-0.5">
          Used to generate the suggested commit message for git branches
        </div>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="text-xs font-mono"
      />
    </div>
  );
}

/* ─── Picker Options ─── */

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const EDITOR_OPTIONS: { value: PreferredEditor; label: string }[] = [
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
];


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
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${isRecording
          ? 'bg-focus-ring/8 ring-1 ring-focus-ring/30'
          : 'hover:bg-surface-tertiary/40'
        }`}
    >
      {/* Toggle */}
      <Toggle checked={shortcut.enabled} onChange={onToggle} />

      {/* Label */}
      <span
        className={`flex-1 text-[13px] transition-colors ${shortcut.enabled ? 'text-content-primary' : 'text-content-tertiary'
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
          className={`group relative px-2.5 py-1 rounded-md border min-w-[72px] flex items-center justify-center transition-all ${shortcut.enabled
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


/* ─── Modifier Shortcut Row ─── */

function ModifierShortcutRow({
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
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${isRecording
          ? 'bg-focus-ring/8 ring-1 ring-focus-ring/30'
          : 'hover:bg-surface-tertiary/40'
        }`}
    >
      {/* Toggle */}
      <Toggle checked={shortcut.enabled} onChange={onToggle} />

      {/* Label */}
      <span
        className={`flex-1 text-[13px] transition-colors ${shortcut.enabled ? 'text-content-primary' : 'text-content-tertiary'
          }`}
      >
        {shortcut.label}
      </span>

      {/* Key badge — shows modifier + "1–9" */}
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
          className={`group relative px-2.5 py-1 rounded-md border min-w-[72px] flex items-center justify-center transition-all ${shortcut.enabled
              ? 'border-chrome/60 bg-surface-tertiary/40 hover:border-chrome-focus/60 hover:bg-surface-tertiary/80 cursor-pointer'
              : 'border-chrome/30 bg-surface-tertiary/20 opacity-40 cursor-not-allowed'
            }`}
          title={shortcut.enabled ? 'Click to rebind' : ''}
        >
          <span className="inline-flex items-center gap-px text-[10px] leading-none font-normal tracking-wide">
            <KbdRaw keys={shortcut.keys} />
            <kbd className="font-sans not-italic ml-px">1–9</kbd>
          </span>
        </button>
      )}
    </div>
  );
}
