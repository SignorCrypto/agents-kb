import { createPortal } from 'react-dom';
import { useState, useCallback, useRef } from 'react';
import { useKanbanStore } from '../../hooks/useKanbanStore';
import { useCommitDialog } from './useCommitDialog';
import { FileListPanel } from './FileListPanel';
import { FileDiffPanel } from './FileDiffPanel';

interface CommitDialogProps {
  projectId: string;
  branch: string;
  projectName: string;
  projectColor: string;
  onClose: () => void;
  onCommitted: (result: { deletedJobIds?: string[]; warning?: string }) => void;
  onPushed: () => void;
}

export function CommitDialog({
  projectId,
  branch,
  projectName,
  projectColor,
  onClose,
  onCommitted,
  onPushed,
}: CommitDialogProps) {
  const settings = useKanbanStore((s) => s.settings);

  const state = useCommitDialog(projectId, branch, onClose, onCommitted, onPushed);

  // Scroll-to-file coordination: use counter to re-trigger even for same file
  const scrollCounterRef = useRef(0);
  const [scrollToFile, setScrollToFile] = useState<{ path: string; key: number } | null>(null);

  // Called when user clicks a file in the left panel → scroll right panel to it
  const handleFileClickScroll = useCallback((filePath: string) => {
    state.selectFile(filePath);
    scrollCounterRef.current += 1;
    setScrollToFile({ path: filePath, key: scrollCounterRef.current });
  }, [state.selectFile]);

  // Called by IntersectionObserver when scrolling reveals a different file
  const handleVisibleFileChange = useCallback((filePath: string) => {
    state.selectFile(filePath);
  }, [state.selectFile]);

  const isBusy = state.commitLoading || state.pushing;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />
      <div
        className="relative flex flex-col rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl max-w-5xl w-[90vw] max-h-[85vh] animate-[dialogIn_150ms_ease-out] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
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

            {state.commitPhase === 'compose' ? (
              <div className="flex items-center gap-2 min-w-0">
                {/* Branch indicator */}
                <div className="flex items-center gap-1 shrink-0">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-content-tertiary shrink-0">
                    <path d="M5 3v6.5a3 3 0 003 3h1a3 3 0 003-3V8" />
                    <circle cx="5" cy="3" r="1.5" />
                    <circle cx="12" cy="6" r="1.5" />
                  </svg>
                  <span className="text-xs font-mono font-medium text-content-primary">{branch}</span>
                </div>
              </div>
            ) : (
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
            )}
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className="p-1 rounded hover:bg-surface-tertiary/70 text-content-tertiary hover:text-content-secondary transition-colors disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {state.commitPhase === 'compose' ? (
          <>
            {/* Main content: split panel */}
            <div className="flex flex-1 min-h-0" style={{ height: '65vh' }}>
              {/* Left: file list + commit controls */}
              <div className="w-80 shrink-0 flex flex-col border-r border-chrome/50">
                <div className="flex-1 min-h-0">
                  <FileListPanel
                    files={state.changedFiles}
                    loading={state.loadingFiles}
                    stagedFiles={state.stagedFiles}
                    selectedFile={state.selectedFile}
                    jobAttributions={state.jobAttributions}
                    runningJobs={state.runningJobs}
                    runningJobFiles={state.runningJobFiles}
                    onToggleFile={state.toggleFile}
                    onToggleAll={state.toggleAll}
                    onSelectFile={handleFileClickScroll}
                    onDiscardFile={state.discardFile}
                    onRefresh={state.refreshFiles}
                  />
                </div>

                {/* Commit message + actions — pinned below file list */}
                <div className="border-t border-chrome-subtle/50 px-3 py-2.5 bg-surface-tertiary/10">
                  {settings.deleteCompletedJobsOnCommit && (
                    <div className="mb-2 rounded-lg border border-chrome-subtle/70 bg-surface-tertiary/25 px-2 py-1.5 text-[10px] leading-relaxed text-content-secondary">
                      Completed jobs will be removed after commit.
                    </div>
                  )}

                  {/* Commit message */}
                  <div className="mb-2 h-[76px]">
                    {state.generatingMessage ? (
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
                        {/* Skeleton lines to hint at incoming content */}
                        <div className="flex flex-col gap-1.5 mt-0.5">
                          <div className="h-2 w-3/4 rounded bg-surface-tertiary/80 animate-pulse" />
                          <div className="h-2 w-1/2 rounded bg-surface-tertiary/60 animate-pulse" style={{ animationDelay: '150ms' }} />
                        </div>
                      </div>
                    ) : (
                      <textarea
                        value={state.commitMessage}
                        onChange={(e) => state.setCommitMessage(e.target.value)}
                        placeholder="Commit message..."
                        className="w-full h-full text-xs rounded border border-chrome bg-surface-tertiary/40 px-2.5 py-2 text-content-primary placeholder:text-content-tertiary outline-none focus:border-active-indicator/50 focus:ring-1 focus:ring-focus-ring/30 resize-none font-mono leading-relaxed"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            state.commit();
                          }
                        }}
                      />
                    )}
                  </div>

                  {/* Actions row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {/* Regenerate button */}
                      <button
                        onClick={state.regenerateMessage}
                        disabled={state.generatingMessage || state.commitLoading}
                        className="p-1.5 rounded hover:bg-surface-tertiary/70 text-content-tertiary hover:text-content-secondary transition-colors disabled:opacity-50"
                        title="Regenerate commit message"
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M2.5 8a5.5 5.5 0 019.3-4M13.5 8a5.5 5.5 0 01-9.3 4" />
                          <path d="M12 1.5v3h-3M4 11.5v3h3" />
                        </svg>
                      </button>

                      {/* File count */}
                      <span className="text-[10px] text-content-tertiary whitespace-nowrap tabular-nums">
                        {state.stagedFiles.size}/{state.changedFiles.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={onClose}
                        disabled={state.commitLoading}
                        className="px-2.5 py-1.5 text-[11px] rounded text-content-tertiary hover:bg-surface-tertiary/70 transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={state.commit}
                        disabled={
                          state.commitLoading ||
                          state.generatingMessage ||
                          !state.commitMessage.trim() ||
                          state.stagedFiles.size === 0
                        }
                        className="px-3 py-1.5 text-[11px] font-medium rounded bg-semantic-warning/15 text-semantic-warning hover:bg-semantic-warning/25 transition-colors disabled:opacity-50"
                      >
                        {state.commitLoading ? 'Committing...' : 'Commit'}
                      </button>
                    </div>
                  </div>

                  {state.commitError && (
                    <p className="text-[10px] text-status-error mt-2 bg-status-error/10 rounded px-2 py-1.5 break-words">
                      {state.commitError}
                    </p>
                  )}
                </div>
              </div>

              {/* Right: diff viewer — now gets full height */}
              <div className="flex-1 flex flex-col min-w-0">
                <FileDiffPanel
                  changedFiles={state.changedFiles}
                  allDiffs={state.allDiffs}
                  loadingDiffs={state.loadingDiffs}
                  selectedFile={state.selectedFile}
                  scrollToFile={scrollToFile}
                  onVisibleFileChange={handleVisibleFileChange}
                />
              </div>
            </div>
          </>
        ) : (
          /* Push phase */
          <div className="px-4 py-6">
            <p className="text-xs text-content-secondary">
              Push <span className="font-mono font-medium text-content-primary">{branch}</span> to
              origin?
            </p>
            {settings.deleteCompletedJobsOnCommit && state.clearedCompletedCount > 0 && (
              <p className="text-xs text-content-secondary mt-3 rounded-lg bg-surface-tertiary/30 px-2.5 py-2">
                Cleared {state.clearedCompletedCount} completed job
                {state.clearedCompletedCount === 1 ? '' : 's'} from this branch.
              </p>
            )}
            {state.commitError && (
              <p className="text-xs text-status-error mt-2 bg-status-error/10 rounded px-2 py-1.5 break-words">
                {state.commitError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={onClose}
                disabled={state.pushing}
                className="px-3 py-1.5 text-xs rounded text-content-tertiary hover:bg-surface-tertiary/70 transition-colors disabled:opacity-50"
              >
                Later
              </button>
              <button
                onClick={state.push}
                disabled={state.pushing}
                className="px-3 py-1.5 text-xs font-medium rounded bg-column-development/15 text-column-development hover:bg-column-development/25 transition-colors disabled:opacity-50"
              >
                {state.pushing ? 'Pushing...' : 'Push'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
