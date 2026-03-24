import { createPortal } from 'react-dom';
import { useGitPanel } from './useGitPanel';
import { GitPanelHeader } from './GitPanelHeader';
import { GitPanelCompose } from './GitPanelCompose';
import { GitPanelPush } from './GitPanelPush';

interface GitPanelProps {
  projectId: string;
  branch: string;
  projectName: string;
  projectColor: string;
  isDirty: boolean;
  hasUpstream: boolean;
  onClose: () => void;
  onCommitted: (result: { deletedJobIds?: string[]; warning?: string }) => void;
  onPushed: () => void;
  onBranchDeleted: () => void;
}

export function GitPanel({
  projectId,
  branch,
  projectName,
  projectColor,
  isDirty,
  hasUpstream,
  onClose,
  onCommitted,
  onPushed,
  onBranchDeleted,
}: GitPanelProps) {
  const state = useGitPanel(
    projectId,
    branch,
    isDirty,
    hasUpstream,
    onClose,
    onCommitted,
    onPushed,
    onBranchDeleted,
  );

  const isBusy = state.commitLoading || state.pushing || state.deleting;
  const isCompact = state.phase !== 'compose';

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />
      <div
        className={`relative flex flex-col rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl animate-[dialogIn_150ms_ease-out] overflow-hidden ${
          isCompact
            ? 'w-[560px] max-w-[90vw]'
            : 'max-w-5xl w-[90vw] max-h-[85vh]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <GitPanelHeader
          projectName={projectName}
          projectColor={projectColor}
          branch={branch}
          phase={state.phase}
          didCommit={state.didCommit}
          isBusy={isBusy}
          onClose={onClose}
        />

        {state.phase === 'compose' ? (
          <GitPanelCompose state={state} onClose={onClose} />
        ) : (
          <GitPanelPush state={state} branch={branch} onClose={onClose} />
        )}
      </div>
    </div>,
    document.body,
  );
}
