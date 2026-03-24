import { useMemo, useCallback, useState } from 'react';
import { useGitHistory } from './useGitHistory';
import { computeGraphLayout } from './graph-layout';
import GitCommitRow from './GitCommitRow';
import { CommitDetailView } from '../git-panel/CommitDetailView';
import type { GitCommit } from '../../types/index';

interface GitHistoryPanelProps {
  projectId: string;
}

export function GitHistoryPanel({ projectId }: GitHistoryPanelProps) {
  const { commits, loading, hasMore, totalCount, loadMore, refresh, error } = useGitHistory(projectId);

  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const layout = useMemo(() => computeGraphLayout(commits), [commits]);

  const handleLoadMore = useCallback(() => {
    loadMore();
  }, [loadMore]);

  const handleCommitClick = useCallback((commit: GitCommit) => {
    setSelectedCommit(commit);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedCommit(null);
  }, []);

  if (error && commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-content-tertiary">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <p className="text-[12px]">{error}</p>
        <button onClick={refresh} className="text-[11px] text-interactive-link hover:text-interactive-link-hover transition-colors">
          Retry
        </button>
      </div>
    );
  }

  if (!loading && commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-content-tertiary">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v6M12 15v6" />
        </svg>
        <p className="text-[12px]">No commits found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-chrome/40 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-content-tertiary">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v6M12 15v6" />
          </svg>
          <span className="text-[11px] font-medium text-content-secondary">
            {totalCount > 0 ? `${totalCount.toLocaleString()} commits` : 'Git History'}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1 rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/50 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
            <path d="M2 8a6 6 0 0 1 10.3-4.2L14 2v4h-4l1.7-1.7A4.5 4.5 0 0 0 3.5 8" />
            <path d="M14 8a6 6 0 0 1-10.3 4.2L2 14v-4h4l-1.7 1.7A4.5 4.5 0 0 0 12.5 8" />
          </svg>
        </button>
      </div>

      {/* Scrollable commit list or detail view */}
      <div className="flex-1 overflow-auto min-h-0">
        {selectedCommit ? (
          <div className="px-4 py-2">
            <CommitDetailView commit={selectedCommit} onBack={handleBack} />
          </div>
        ) : (
        <>
        {/* Commit rows with inline graph */}
        <div className="min-w-0">
          {layout.nodes.map((node, i) => (
            <GitCommitRow key={node.commit.hash} commit={node.commit} graphData={layout.rowGraphData[i]} onClick={handleCommitClick} />
          ))}
        </div>

        {/* Load more / loading indicator */}
        <div className="flex items-center justify-center py-3">
          {loading ? (
            <div className="flex items-center gap-2 text-content-tertiary">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="animate-spin">
                <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" />
              </svg>
              <span className="text-[11px]">Loading commits...</span>
            </div>
          ) : hasMore ? (
            <button
              onClick={handleLoadMore}
              className="text-[11px] text-content-tertiary hover:text-content-primary px-3 py-1.5 rounded-md hover:bg-surface-tertiary/60 transition-colors"
            >
              Load more commits
            </button>
          ) : commits.length > 0 ? (
            <span className="text-[10px] text-content-tertiary/50">End of history</span>
          ) : null}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
