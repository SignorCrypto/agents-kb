import { useKanbanStore } from '../../hooks/useKanbanStore';

interface CommitControlsProps {
  commitMessage: string;
  generatingMessage: boolean;
  commitLoading: boolean;
  commitError: string | null;
  stagedCount: number;
  totalCount: number;
  onSetCommitMessage: (msg: string) => void;
  onRegenerate: () => void;
  onCommit: () => void;
  onClose: () => void;
}

export function CommitControls({
  commitMessage,
  generatingMessage,
  commitLoading,
  commitError,
  stagedCount,
  totalCount,
  onSetCommitMessage,
  onRegenerate,
  onCommit,
  onClose,
}: CommitControlsProps) {
  const settings = useKanbanStore((s) => s.settings);

  return (
    <div className="border-t border-chrome-subtle/50 px-3 py-2.5 bg-surface-tertiary/10">
      {settings.deleteCompletedJobsOnCommit && (
        <div className="mb-2 rounded-lg border border-chrome-subtle/70 bg-surface-tertiary/25 px-2 py-1.5 text-[10px] leading-relaxed text-content-secondary">
          Completed jobs will be removed after commit.
        </div>
      )}

      {/* Commit message */}
      <div className="mb-2 h-[76px]">
        {generatingMessage ? (
          <div className="flex flex-col gap-2 h-full rounded border border-chrome bg-surface-tertiary/40 px-2.5 py-2 overflow-hidden">
            <div className="flex items-center gap-2 text-xs text-content-tertiary">
              <svg
                className="animate-spin h-3 w-3 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 019.5 7" strokeLinecap="round" />
              </svg>
              <span className="text-[11px]">Generating message...</span>
            </div>
            <div className="flex flex-col gap-1.5 mt-0.5">
              <div className="h-2 w-3/4 rounded bg-surface-tertiary/80 animate-pulse" />
              <div
                className="h-2 w-1/2 rounded bg-surface-tertiary/60 animate-pulse"
                style={{ animationDelay: '150ms' }}
              />
            </div>
          </div>
        ) : (
          <textarea
            value={commitMessage}
            onChange={(e) => onSetCommitMessage(e.target.value)}
            placeholder="Commit message..."
            className="w-full h-full text-xs rounded border border-chrome bg-surface-tertiary/40 px-2.5 py-2 text-content-primary placeholder:text-content-tertiary outline-none focus:border-active-indicator/50 focus:ring-1 focus:ring-focus-ring/30 resize-none font-mono leading-relaxed"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onCommit();
              }
            }}
          />
        )}
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={onRegenerate}
            disabled={generatingMessage || commitLoading}
            className="p-1.5 rounded hover:bg-surface-tertiary/70 text-content-tertiary hover:text-content-secondary transition-colors disabled:opacity-50"
            title="Regenerate commit message"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M2.5 8a5.5 5.5 0 019.3-4M13.5 8a5.5 5.5 0 01-9.3 4" />
              <path d="M12 1.5v3h-3M4 11.5v3h3" />
            </svg>
          </button>
          <span className="text-[10px] text-content-tertiary whitespace-nowrap tabular-nums">
            {stagedCount}/{totalCount}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onClose}
            disabled={commitLoading}
            className="px-2.5 py-1.5 text-[11px] rounded text-content-tertiary hover:bg-surface-tertiary/70 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onCommit}
            disabled={commitLoading || generatingMessage || !commitMessage.trim() || stagedCount === 0}
            className="px-3 py-1.5 text-[11px] font-medium rounded bg-semantic-warning/15 text-semantic-warning hover:bg-semantic-warning/25 transition-colors disabled:opacity-50"
          >
            {commitLoading ? 'Committing...' : 'Commit'}
          </button>
        </div>
      </div>

      {commitError && (
        <p className="text-[10px] text-status-error mt-2 bg-status-error/10 rounded px-2 py-1.5 break-words">
          {commitError}
        </p>
      )}
    </div>
  );
}
