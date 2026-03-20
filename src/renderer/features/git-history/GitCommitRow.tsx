import { memo, useState, useCallback, useMemo } from 'react';
import type { GitCommit, GitRef } from '../../types/index';

const ROW_HEIGHT = 32;

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 5) return `${diffWeek}w ago`;
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ── Icons ─────────────────────────────────────────────── */

function BranchIcon({ className }: { className?: string }) {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M5 3v6.5a3 3 0 0 0 3 3h1a3 3 0 0 0 3-3V3" strokeLinecap="round" />
      <circle cx="5" cy="3" r="1.5" fill="currentColor" />
      <circle cx="12" cy="3" r="1.5" fill="currentColor" />
    </svg>
  );
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M2 3a1 1 0 0 1 1-1h4.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 0 1.414l-4.586 4.586a1 1 0 0 1-1.414 0L2.293 8.293A1 1 0 0 1 2 7.586V3zm3 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    </svg>
  );
}

function RemoteIcon({ className }: { className?: string }) {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3.5 6.5C4.5 4 6 2.5 8 2.5s3.5 1.5 4.5 4" />
      <path d="M3.5 9.5C4.5 12 6 13.5 8 13.5s3.5-1.5 4.5-4" />
      <ellipse cx="8" cy="8" rx="5.5" ry="5.5" />
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
    </svg>
  );
}

/* ── Ref processing ────────────────────────────────────── */

interface ProcessedRef {
  type: 'current-branch' | 'branch' | 'tag' | 'remote';
  name: string;
  fullName: string;
}

/** Merge HEAD into its branch, de-duplicate remotes that mirror a local branch. */
function processRefs(refs: GitRef[]): ProcessedRef[] {
  const hasHead = refs.some((r) => r.type === 'head');
  const localBranches = new Set(refs.filter((r) => r.type === 'branch').map((r) => r.name));

  const processed: ProcessedRef[] = [];

  for (const ref of refs) {
    // Skip standalone HEAD — it will be folded into the branch badge
    if (ref.type === 'head') continue;

    if (ref.type === 'branch') {
      processed.push({
        type: hasHead ? 'current-branch' : 'branch',
        name: ref.name,
        fullName: ref.name,
      });
    } else if (ref.type === 'tag') {
      processed.push({ type: 'tag', name: ref.name, fullName: ref.name });
    } else if (ref.type === 'remote') {
      // Strip remote prefix (e.g. "origin/main" → "main") to check for local duplicate
      const shortName = ref.name.replace(/^[^/]+\//, '');
      if (localBranches.has(shortName)) continue; // hide redundant remote
      processed.push({ type: 'remote', name: ref.name, fullName: ref.name });
    }
  }

  // Detached HEAD with no branch — show a HEAD-only badge
  if (hasHead && !refs.some((r) => r.type === 'branch')) {
    processed.unshift({ type: 'current-branch', name: 'HEAD', fullName: 'HEAD (detached)' });
  }

  return processed;
}

/* ── Badge component ───────────────────────────────────── */

function RefBadge({ pRef }: { pRef: ProcessedRef }) {
  const base = 'inline-flex items-center gap-[3px] px-1.5 py-0 rounded text-[9px] font-medium leading-[18px] max-w-[160px]';

  switch (pRef.type) {
    case 'current-branch':
      return (
        <span
          className={`${base} bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30 font-semibold`}
          title={pRef.fullName}
        >
          {/* HEAD indicator dot */}
          <span className="shrink-0 w-[6px] h-[6px] rounded-full bg-blue-500 dark:bg-blue-400 ring-1 ring-blue-400/30" />
          <BranchIcon className="shrink-0" />
          <span className="truncate">{pRef.name}</span>
        </span>
      );
    case 'branch':
      return (
        <span
          className={`${base} bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/20`}
          title={pRef.fullName}
        >
          <BranchIcon className="shrink-0" />
          <span className="truncate">{pRef.name}</span>
        </span>
      );
    case 'tag':
      return (
        <span
          className={`${base} bg-amber-500/12 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/20`}
          title={pRef.fullName}
        >
          <TagIcon className="shrink-0" />
          <span className="truncate">{pRef.name}</span>
        </span>
      );
    case 'remote':
      return (
        <span
          className={`${base} bg-content-tertiary/8 text-content-tertiary ring-1 ring-content-tertiary/15`}
          title={pRef.fullName}
        >
          <RemoteIcon className="shrink-0 opacity-60" />
          <span className="truncate">{pRef.name}</span>
        </span>
      );
    default:
      return null;
  }
}

/* ── Row component ─────────────────────────────────────── */

function GitCommitRow({ commit }: { commit: GitCommit }) {
  const [copied, setCopied] = useState(false);

  const handleCopyHash = useCallback(() => {
    navigator.clipboard.writeText(commit.fullHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [commit.fullHash]);

  const processedRefs = useMemo(() => processRefs(commit.refs), [commit.refs]);

  return (
    <div
      className="flex items-center gap-2.5 px-2 group/row hover:bg-surface-secondary/50 transition-colors"
      style={{ height: ROW_HEIGHT }}
    >
      {/* Hash */}
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

      {/* Refs */}
      {processedRefs.length > 0 && (
        <div className="flex items-center gap-1 shrink-0">
          {processedRefs.map((r, i) => (
            <RefBadge key={`${r.type}-${r.name}-${i}`} pRef={r} />
          ))}
        </div>
      )}

      {/* Message */}
      <span className="text-[12px] text-content-primary truncate min-w-0 flex-1">
        {commit.message}
      </span>

      {/* Author */}
      <span className="shrink-0 text-[11px] text-content-tertiary truncate max-w-[120px] hidden sm:block">
        {commit.authorName}
      </span>

      {/* Date */}
      <span className="shrink-0 text-[10px] text-content-tertiary tabular-nums w-[60px] text-right">
        {formatRelativeDate(commit.date)}
      </span>
    </div>
  );
}

export default memo(GitCommitRow);
