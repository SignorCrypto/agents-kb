import type { GitCommit } from '../../types/index';
import GitCommitRow from '../git-history/GitCommitRow';

interface UnpushedCommitsListProps {
  commits: GitCommit[];
  loading: boolean;
}

export function UnpushedCommitsList({ commits, loading }: UnpushedCommitsListProps) {
  if (loading) {
    return (
      <div className="mt-3 rounded-lg border border-chrome-subtle/50 bg-surface-tertiary/20 p-3">
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
          <span className="text-[11px]">Loading commits...</span>
        </div>
        <div className="flex flex-col gap-1.5 mt-2">
          <div className="h-2.5 w-3/4 rounded bg-surface-tertiary/80 animate-pulse" />
          <div
            className="h-2.5 w-1/2 rounded bg-surface-tertiary/60 animate-pulse"
            style={{ animationDelay: '150ms' }}
          />
        </div>
      </div>
    );
  }

  if (commits.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-content-tertiary">
          Commits
        </span>
        <span className="text-[10px] tabular-nums text-content-tertiary">
          ({commits.length})
        </span>
      </div>
      <div className="rounded-lg border border-chrome-subtle/50 bg-surface-tertiary/10 overflow-hidden max-h-[200px] overflow-y-auto">
        {commits.map((commit) => (
          <GitCommitRow key={commit.fullHash} commit={commit} />
        ))}
      </div>
    </div>
  );
}
