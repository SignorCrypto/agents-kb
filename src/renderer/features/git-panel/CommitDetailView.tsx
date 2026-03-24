import { useState, useCallback, useMemo } from 'react';
import type { GitCommit } from '../../types/index';
import { formatRelativeDate, processRefs, RefBadge } from '../git-history/GitCommitRow';

interface CommitDetailViewProps {
  commit: GitCommit;
  onBack: () => void;
}

export function CommitDetailView({ commit, onBack }: CommitDetailViewProps) {
  const [copied, setCopied] = useState(false);
  const processedRefs = useMemo(() => processRefs(commit.refs), [commit.refs]);

  const handleCopyHash = useCallback(() => {
    navigator.clipboard.writeText(commit.fullHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [commit.fullHash]);

  return (
    <div className="mt-3">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[11px] text-content-tertiary hover:text-content-primary transition-colors mb-3 -ml-0.5 cursor-pointer"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M7.5 2.5L4 6L7.5 9.5" />
        </svg>
        Back to commits
      </button>

      {/* Commit details card */}
      <div className="rounded-lg border border-chrome-subtle/50 bg-surface-tertiary/10 overflow-hidden">
        {/* Header: hash + refs */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-chrome-subtle/30 bg-surface-tertiary/30">
          <button
            onClick={handleCopyHash}
            className="shrink-0 font-mono text-[11px] text-content-tertiary hover:text-interactive-link transition-colors cursor-pointer"
            title={copied ? 'Copied!' : `Copy ${commit.fullHash}`}
          >
            {copied ? (
              <span className="text-success">copied</span>
            ) : (
              commit.hash
            )}
          </button>

          {processedRefs.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              {processedRefs.map((r, i) => (
                <RefBadge key={`${r.type}-${r.name}-${i}`} pRef={r} />
              ))}
            </div>
          )}
        </div>

        {/* Full commit message */}
        <div className="px-3 py-2.5 max-h-[200px] overflow-y-auto">
          <p className="text-[12px] text-content-primary whitespace-pre-wrap break-words leading-relaxed">
            {commit.message}
          </p>
        </div>

        {/* Author + date footer */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-chrome-subtle/30 bg-surface-tertiary/20">
          <span className="text-[11px] text-content-tertiary">
            {commit.authorName}
          </span>
          <span className="text-[10px] text-content-tertiary/60">·</span>
          <span className="text-[10px] text-content-tertiary tabular-nums">
            {formatRelativeDate(commit.date)}
          </span>
        </div>
      </div>
    </div>
  );
}
