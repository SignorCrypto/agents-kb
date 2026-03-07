import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useElectronAPI } from '../hooks/useElectronAPI';

interface AcceptJobDialogProps {
  jobId: string;
  initialMessage?: string;
  onClose: () => void;
  onAccepted: () => void;
}

export function AcceptJobDialog({ jobId, initialMessage, onClose, onAccepted }: AcceptJobDialogProps) {
  const api = useElectronAPI();
  const [commitMessage, setCommitMessage] = useState(initialMessage || '');
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Generate on open if no pre-populated message
  useEffect(() => {
    if (initialMessage) return;
    let cancelled = false;
    setGenerating(true);
    api.jobsGenerateCommitMessage(jobId)
      .then((msg) => {
        if (!cancelled) {
          setCommitMessage(msg);
          setGenerating(false);
        }
      })
      .catch(() => {
        if (!cancelled) setGenerating(false);
      });
    return () => { cancelled = true; };
  }, [jobId, initialMessage, api]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  useEffect(() => {
    if (!generating) textareaRef.current?.focus();
  }, [generating]);

  const handleCommitAndAccept = async () => {
    const message = commitMessage.trim();
    if (!message) return;
    setCommitting(true);
    setError(null);
    try {
      await api.jobsAcceptJob(jobId, message);
      onAccepted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to commit and accept');
      setCommitting(false);
    }
  };

  const busy = generating || committing;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />

      <div
        className="relative w-[440px] rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl shadow-surface-overlay/20 overflow-hidden animate-[dialogIn_150ms_ease-out] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-content-primary">Accept Changes</h2>
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
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[11px] font-medium text-content-secondary mb-1.5 block">
              Commit message
            </label>
            {generating ? (
              <div className="w-full px-3 py-6 text-sm rounded-lg border border-chrome bg-surface-elevated flex items-center justify-center gap-2 text-content-tertiary">
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs">Generating commit message...</span>
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message"
                rows={4}
                disabled={committing}
                className="w-full px-3 py-2 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40 resize-none font-mono disabled:opacity-50"
              />
            )}
          </div>

          {error && (
            <div className="text-xs text-semantic-error bg-semantic-error-bg/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="pt-1">
            <button
              onClick={handleCommitAndAccept}
              disabled={busy || !commitMessage.trim()}
              className="w-full py-2 rounded-lg bg-btn-primary text-content-inverted text-sm font-medium hover:bg-btn-primary-hover disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              {committing && (
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {committing ? 'Committing...' : 'Commit & Accept'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
