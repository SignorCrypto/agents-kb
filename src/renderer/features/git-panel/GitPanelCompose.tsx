import { useState, useCallback, useRef } from 'react';
import { FileListPanel } from './FileListPanel';
import { FileDiffPanel } from './FileDiffPanel';
import { CommitControls } from './CommitControls';
import type { GitPanelState, GitPanelActions } from './useGitPanel';

interface GitPanelComposeProps {
  state: GitPanelState & GitPanelActions;
  onClose: () => void;
}

export function GitPanelCompose({ state, onClose }: GitPanelComposeProps) {
  const scrollCounterRef = useRef(0);
  const [scrollToFile, setScrollToFile] = useState<{ path: string; key: number } | null>(null);

  const handleFileClickScroll = useCallback(
    (filePath: string) => {
      state.selectFile(filePath);
      scrollCounterRef.current += 1;
      setScrollToFile({ path: filePath, key: scrollCounterRef.current });
    },
    [state.selectFile],
  );

  const handleVisibleFileChange = useCallback(
    (filePath: string) => {
      state.selectFile(filePath);
    },
    [state.selectFile],
  );

  return (
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
            onDiscardAll={state.discardAll}
            onRefresh={state.refreshFiles}
          />
        </div>

        <CommitControls
          commitMessage={state.commitMessage}
          generatingMessage={state.generatingMessage}
          commitLoading={state.commitLoading}
          commitError={state.commitError}
          stagedCount={state.stagedFiles.size}
          totalCount={state.changedFiles.length}
          onSetCommitMessage={state.setCommitMessage}
          onRegenerate={state.regenerateMessage}
          onCommit={state.commit}
          onClose={onClose}
        />
      </div>

      {/* Right: diff viewer */}
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
  );
}
