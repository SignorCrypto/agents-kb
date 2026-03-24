import type { GitPanelPhase } from './useGitPanel';

interface GitPanelHeaderProps {
  projectName: string;
  projectColor: string;
  branch: string;
  phase: GitPanelPhase;
  didCommit: boolean;
  isBusy: boolean;
  onClose: () => void;
}

export function GitPanelHeader({
  projectName,
  projectColor,
  branch,
  phase,
  didCommit,
  isBusy,
  onClose,
}: GitPanelHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-chrome-subtle/50">
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Project identity */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: projectColor }}
          />
          <span className="text-xs font-medium text-content-primary truncate max-w-[120px]">
            {projectName}
          </span>
        </div>

        <span className="text-content-tertiary text-xs">/</span>

        {phase === 'compose' ? (
          <div className="flex items-center gap-1 shrink-0">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="text-content-tertiary shrink-0"
            >
              <path d="M5 3v6.5a3 3 0 003 3h1a3 3 0 003-3V8" />
              <circle cx="5" cy="3" r="1.5" />
              <circle cx="12" cy="6" r="1.5" />
            </svg>
            <span className="text-xs font-mono font-medium text-content-primary">{branch}</span>
          </div>
        ) : didCommit ? (
          <div className="flex items-center gap-1.5">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-semantic-success shrink-0"
            >
              <circle cx="8" cy="8" r="6" />
              <path d="M5.5 8l2 2 3.5-3.5" />
            </svg>
            <span className="text-xs font-medium text-content-primary">Committed</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="text-content-tertiary shrink-0"
            >
              <path d="M5 3v6.5a3 3 0 003 3h1a3 3 0 003-3V8" />
              <circle cx="5" cy="3" r="1.5" />
              <circle cx="12" cy="6" r="1.5" />
            </svg>
            <span className="text-xs font-mono font-medium text-content-primary">{branch}</span>
          </div>
        )}
      </div>
      <button
        onClick={onClose}
        disabled={isBusy}
        className="p-1 rounded hover:bg-surface-tertiary/70 text-content-tertiary hover:text-content-secondary transition-colors disabled:opacity-50"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
