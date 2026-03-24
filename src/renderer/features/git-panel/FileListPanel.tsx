import { useState, useCallback, useEffect, useRef } from 'react';
import type { ChangedFile, Job } from '../../types/index';

interface FileListPanelProps {
  files: ChangedFile[];
  loading: boolean;
  stagedFiles: Set<string>;
  selectedFile: string | null;
  jobAttributions: Map<string, Job[]>;
  runningJobs: Job[];
  runningJobFiles: Set<string>;
  onToggleFile: (filePath: string) => void;
  onToggleAll: () => void;
  onSelectFile: (filePath: string | null) => void;
  onDiscardFile: (filePath: string, isUntracked: boolean) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const STATUS_CONFIG: Record<
  ChangedFile['status'],
  { label: string; color: string; bg: string }
> = {
  modified: { label: 'M', color: 'text-column-development', bg: 'bg-column-development/15' },
  added: { label: 'A', color: 'text-semantic-success', bg: 'bg-semantic-success/15' },
  deleted: { label: 'D', color: 'text-semantic-error', bg: 'bg-semantic-error/15' },
  renamed: { label: 'R', color: 'text-semantic-attention', bg: 'bg-semantic-attention/15' },
  untracked: { label: 'U', color: 'text-content-tertiary', bg: 'bg-surface-tertiary/60' },
};

function StatusBadge({ status }: { status: ChangedFile['status'] }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded text-[10px] font-bold leading-none shrink-0 ${config.color} ${config.bg}`}
    >
      {config.label}
    </span>
  );
}

export function FileListPanel({
  files,
  loading,
  stagedFiles,
  selectedFile,
  jobAttributions,
  runningJobs,
  runningJobFiles,
  onToggleFile,
  onToggleAll,
  onSelectFile,
  onDiscardFile,
  onRefresh,
}: FileListPanelProps) {
  const [discardConfirm, setDiscardConfirm] = useState<string | null>(null);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Auto-scroll the selected file into view in the left panel
  useEffect(() => {
    if (!selectedFile) return;
    const el = fileRefs.current.get(selectedFile);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedFile]);

  const handleDiscard = useCallback(
    async (filePath: string, isUntracked: boolean) => {
      await onDiscardFile(filePath, isUntracked);
      setDiscardConfirm(null);
    },
    [onDiscardFile],
  );

  const allStaged = files.length > 0 && stagedFiles.size === files.length;
  const someStaged = stagedFiles.size > 0 && stagedFiles.size < files.length;

  const statusCounts = files.reduce(
    (acc, f) => {
      acc[f.status] = (acc[f.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-chrome-subtle/50 bg-surface-tertiary/20">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-content-primary">
            Files
          </span>
          <span className="text-[10px] text-content-tertiary tabular-nums">
            {files.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="p-1 rounded hover:bg-surface-tertiary/70 text-content-tertiary hover:text-content-secondary transition-colors"
            title="Refresh file list"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2.5 8a5.5 5.5 0 019.3-4M13.5 8a5.5 5.5 0 01-9.3 4" />
              <path d="M12 1.5v3h-3M4 11.5v3h3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Running job warning */}
      {runningJobs.length > 0 && (
        <div className="px-3 py-2 bg-semantic-warning/8 border-b border-semantic-warning/20">
          <div className="flex items-center gap-1.5 text-semantic-warning">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
              <path d="M8 1L1 14h14L8 1zm0 4.5v4m0 1.5v1" />
            </svg>
            <span className="text-[10px] font-medium">
              {runningJobs.length} running job{runningJobs.length > 1 ? 's' : ''} on this branch
            </span>
          </div>
          {runningJobFiles.size > 0 && (
            <div className="mt-1 text-[9px] text-semantic-warning/70 pl-[18px]">
              Editing: {Array.from(runningJobFiles).slice(0, 3).map(f => f.split('/').pop()).join(', ')}
              {runningJobFiles.size > 3 && ` +${runningJobFiles.size - 3} more`}
            </div>
          )}
        </div>
      )}

      {/* Select all */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-chrome-subtle/30">
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={allStaged}
            ref={(el) => {
              if (el) el.indeterminate = someStaged;
            }}
            onChange={onToggleAll}
            className="w-3.5 h-3.5 rounded border-chrome accent-column-development cursor-pointer"
          />
          <span className="text-[10px] text-content-tertiary group-hover:text-content-secondary transition-colors select-none">
            {allStaged ? 'Deselect all' : 'Select all'}
          </span>
        </label>
        {/* Status summary */}
        <div className="flex items-center gap-1.5 ml-auto">
          {statusCounts.modified && (
            <span className="text-[9px] text-column-development tabular-nums">{statusCounts.modified}M</span>
          )}
          {statusCounts.added && (
            <span className="text-[9px] text-semantic-success tabular-nums">{statusCounts.added}A</span>
          )}
          {statusCounts.deleted && (
            <span className="text-[9px] text-semantic-error tabular-nums">{statusCounts.deleted}D</span>
          )}
          {statusCounts.untracked && (
            <span className="text-[9px] text-content-tertiary tabular-nums">{statusCounts.untracked}U</span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="px-3 py-2 space-y-1">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 pl-[10px]" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="w-3.5 h-3.5 rounded bg-surface-tertiary/60 animate-pulse shrink-0" />
                <div className="w-[18px] h-[18px] rounded bg-surface-tertiary/50 animate-pulse shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div
                    className="h-2.5 rounded bg-surface-tertiary/50 animate-pulse"
                    style={{ width: `${55 + (i * 17) % 35}%`, animationDelay: `${i * 50}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="text-xs text-content-tertiary text-center py-8">
            No changed files
          </div>
        ) : (
          files.map((file) => {
            const isSelected = selectedFile === file.path;
            const isStaged = stagedFiles.has(file.path);
            const isBeingEdited = runningJobFiles.has(file.path);
            const fileName = file.path.split('/').pop() || file.path;
            const dirPath = file.path.includes('/')
              ? file.path.slice(0, file.path.lastIndexOf('/') + 1)
              : '';

            return (
              <div key={file.path} className="relative group" ref={(el) => { if (el) fileRefs.current.set(file.path, el); else fileRefs.current.delete(file.path); }}>
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-active-indicator/10 border-l-2 border-active-indicator pl-[10px]'
                      : 'border-l-2 border-transparent hover:bg-surface-tertiary/40 pl-[10px]'
                  } ${isBeingEdited ? 'bg-semantic-warning/5' : ''}`}
                  onClick={() => onSelectFile(file.path)}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isStaged}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggleFile(file.path);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 rounded border-chrome accent-column-development cursor-pointer shrink-0"
                  />

                  {/* Status badge */}
                  <StatusBadge status={file.status} />

                  {/* File name + diff stats / path */}
                  <div className="flex-1 min-w-0" title={file.path}>
                    {/* Row 1: name + diff stats */}
                    <div className="flex items-center gap-1.5 text-[11px] font-mono min-w-0">
                      <span className="text-content-primary font-medium truncate">{fileName}</span>
                      {(file.additions != null || file.deletions != null) && (
                        <span className="flex items-center gap-1 shrink-0">
                          {file.additions != null && file.additions > 0 && (
                            <span className="text-[10px] tabular-nums text-semantic-success">+{file.additions}</span>
                          )}
                          {file.deletions != null && file.deletions > 0 && (
                            <span className="text-[10px] tabular-nums text-semantic-error">-{file.deletions}</span>
                          )}
                        </span>
                      )}
                    </div>
                    {/* Row 2: path */}
                    {dirPath && (
                      <div className="text-[10px] font-mono text-content-tertiary truncate mt-px">{dirPath}</div>
                    )}
                  </div>

                  {/* Active editing indicator */}
                  {isBeingEdited && (
                    <span className="w-1.5 h-1.5 rounded-full bg-semantic-warning animate-pulse shrink-0" title="Being edited by a running job" />
                  )}

                  {/* Discard button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDiscardConfirm(file.path);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-semantic-error/15 text-content-tertiary hover:text-semantic-error transition-all shrink-0"
                    title="Discard changes"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M3 5h10M6 5V3.5a1 1 0 011-1h2a1 1 0 011 1V5m1.5 0v8a1.5 1.5 0 01-1.5 1.5H6A1.5 1.5 0 014.5 13V5" />
                    </svg>
                  </button>
                </div>

                {/* Discard confirmation inline */}
                {discardConfirm === file.path && (
                  <div className="absolute right-2 top-1 z-10 flex items-center gap-1 bg-surface-elevated border border-chrome/50 rounded-md px-2 py-1 shadow-lg animate-[dialogIn_100ms_ease-out]">
                    <span className="text-[10px] text-semantic-error font-medium whitespace-nowrap">
                      Discard{file.status === 'untracked' ? ' (delete)' : ''}?
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDiscard(file.path, file.status === 'untracked');
                      }}
                      className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-semantic-error/15 text-semantic-error hover:bg-semantic-error/25 transition-colors"
                    >
                      Yes
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDiscardConfirm(null);
                      }}
                      className="px-1.5 py-0.5 text-[10px] rounded text-content-tertiary hover:bg-surface-tertiary/70 transition-colors"
                    >
                      No
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
