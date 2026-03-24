import { useState } from 'react';
import { useKanbanStore } from '../../hooks/useKanbanStore';
import { UnpushedCommitsList } from './UnpushedCommitsList';
import type { GitPanelState, GitPanelActions } from './useGitPanel';

interface GitPanelPushProps {
  state: GitPanelState & GitPanelActions;
  branch: string;
  onClose: () => void;
}

export function GitPanelPush({ state, branch, onClose }: GitPanelPushProps) {
  const settings = useKanbanStore((s) => s.settings);
  const isPublish = state.phase === 'publish';
  const isBusy = state.pushing || state.deleting;
  const [viewingDetail, setViewingDetail] = useState(false);

  return (
    <div className="px-4 py-4">
      {!viewingDetail && (
        isPublish ? (
          <p className="text-xs text-content-secondary">
            Publish <span className="font-mono font-medium text-content-primary">{branch}</span> to
            origin? This will create a new remote branch.
          </p>
        ) : (
          <p className="text-xs text-content-secondary">
            Push <span className="font-mono font-medium text-content-primary">{branch}</span> to
            origin?
          </p>
        )
      )}

      <UnpushedCommitsList
        commits={state.unpushedCommits}
        loading={state.loadingUnpushed}
        onDetailToggle={setViewingDetail}
      />

      {!viewingDetail && (
        <>
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

          <div className="flex items-center justify-between mt-4">
            <div>
              {isPublish && (
                <button
                  onClick={state.deleteBranch}
                  disabled={isBusy}
                  className="px-3 py-1 text-xs font-medium rounded bg-status-error/10 text-status-error hover:bg-status-error/20 transition-colors disabled:opacity-50"
                >
                  {state.deleting ? 'Deleting...' : 'Delete branch'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={isBusy}
                className="px-3 py-1.5 text-xs rounded border border-chrome text-content-tertiary hover:bg-surface-tertiary/70 transition-colors disabled:opacity-50"
              >
                {state.didCommit ? 'Later' : 'Cancel'}
              </button>
              <button
                onClick={state.push}
                disabled={isBusy}
                className="px-3 py-1.5 text-xs font-medium rounded bg-btn-primary text-content-inverted hover:bg-btn-primary-hover transition-colors disabled:opacity-50"
              >
                {state.pushing
                  ? isPublish
                    ? 'Publishing...'
                    : 'Pushing...'
                  : isPublish
                    ? 'Publish'
                    : 'Push'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
