import { useState, useEffect, useRef, useCallback } from 'react';
import { useElectronAPI } from '../hooks/useElectronAPI';

type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved';

export function ClaudeMdEditor({ projectId }: { projectId: string }) {
  const api = useElectronAPI();
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFile = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.claudeMdRead(projectId);
      setExists(result.exists);
      setContent(result.content);
      setSavedContent(result.content);
      setStatus('idle');
    } catch {
      setExists(false);
      setContent('');
      setSavedContent('');
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  useEffect(() => {
    if (!loading && exists) {
      setStatus(content !== savedContent ? 'unsaved' : 'idle');
    }
  }, [content, savedContent, loading, exists]);

  const handleSave = async () => {
    setStatus('saving');
    try {
      await api.claudeMdWrite(projectId, content);
      setSavedContent(content);
      setExists(true);
      setStatus('saved');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('unsaved');
    }
  };

  const handleDiscard = () => {
    setContent(savedContent);
    setStatus('idle');
  };

  const handleInit = async () => {
    setInitializing(true);
    setInitError(null);
    try {
      const result = await api.claudeMdInit(projectId);
      if (result.exists) {
        setExists(true);
        setContent(result.content);
        setSavedContent(result.content);
        setStatus('idle');
      } else {
        setInitError('claude init completed but CLAUDE.md was not created.');
      }
    } catch (err) {
      setInitError(
        err instanceof Error ? err.message : 'Failed to run claude init',
      );
    } finally {
      setInitializing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (status === 'unsaved') handleSave();
    }
    // Tab inserts spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      setContent(val.substring(0, start) + '  ' + val.substring(end));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4 animate-pulse">
        <div className="h-3 w-24 rounded bg-surface-tertiary/60" />
        <div className="h-3 w-full rounded bg-surface-tertiary/40" />
        <div className="h-3 w-4/5 rounded bg-surface-tertiary/40" />
        <div className="h-3 w-3/5 rounded bg-surface-tertiary/40" />
      </div>
    );
  }

  // Empty state — file doesn't exist
  if (!exists) {
    // Initializing state — claude init is running
    if (initializing) {
      return (
        <div className="flex flex-col items-center justify-center py-10 px-6">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            className="animate-spin text-content-tertiary mb-4"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="50"
              strokeDashoffset="15"
              strokeLinecap="round"
            />
          </svg>
          <p className="text-sm font-medium text-content-secondary mb-1">
            Initializing CLAUDE.md
          </p>
          <p className="text-xs text-content-tertiary text-center max-w-[240px] leading-relaxed">
            Running <span className="font-mono bg-surface-tertiary/60 px-1 py-0.5 rounded text-[11px]">claude init</span> in the project directory...
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-10 px-6">
        {/* Document icon */}
        <div className="w-12 h-12 rounded-xl bg-surface-tertiary/50 flex items-center justify-center mb-4">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-content-tertiary"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <p className="text-sm font-medium text-content-secondary mb-1">
          No CLAUDE.md found
        </p>
        <p className="text-xs text-content-tertiary text-center mb-5 max-w-[240px] leading-relaxed">
          Initialize a CLAUDE.md file to set project-level instructions for Claude
          Code sessions.
        </p>
        {initError && (
          <p className="text-[11px] text-semantic-error text-center mb-3 max-w-[260px] leading-relaxed">
            {initError}
          </p>
        )}
        <button
          onClick={handleInit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-btn-primary text-content-inverted hover:bg-btn-primary-hover transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M4 1v12M10 3.5L4 7l6 3.5" />
          </svg>
          Run claude init
        </button>
      </div>
    );
  }

  // Editor
  return (
    <div className="flex flex-col h-full">
      {/* Editor area */}
      <div className="flex-1 min-h-0 relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="w-full h-full resize-none bg-surface-primary/50 text-content-primary text-[13px] leading-relaxed font-mono p-4 outline-none placeholder:text-content-tertiary/50 border-t border-chrome-subtle/50"
          placeholder="# Project Instructions..."
        />
      </div>

      {/* Footer — status + actions */}
      <div
        className={`flex items-center border-t border-chrome-subtle/70 px-4 transition-all duration-200 ${
          status === 'unsaved' || status === 'saving'
            ? 'py-2.5'
            : 'py-2'
        }`}
      >
        {/* Status indicator */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {status === 'saving' && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className="animate-spin text-content-tertiary shrink-0"
            >
              <circle
                cx="5"
                cy="5"
                r="4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="18"
                strokeDashoffset="6"
                strokeLinecap="round"
              />
            </svg>
          )}
          {status === 'saved' && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-semantic-success shrink-0"
            >
              <polyline points="2 5.5 4 7.5 8 3" />
            </svg>
          )}
          {status === 'unsaved' && (
            <span className="w-1.5 h-1.5 rounded-full bg-semantic-warning shrink-0" />
          )}
          <span className="text-[10px] text-content-tertiary truncate">
            {status === 'saving' && 'Saving...'}
            {status === 'saved' && 'Saved'}
            {status === 'unsaved' && 'Unsaved changes'}
            {status === 'idle' && 'CLAUDE.md'}
          </span>
        </div>

        {/* Action buttons */}
        {(status === 'unsaved' || status === 'saving') && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDiscard}
              disabled={status === 'saving'}
              className="px-2 py-0.5 text-[10px] font-medium rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/70 transition-colors disabled:opacity-40"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={status === 'saving'}
              className="px-2 py-0.5 text-[10px] font-medium rounded bg-btn-primary text-content-inverted hover:bg-btn-primary-hover transition-colors disabled:opacity-60"
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
