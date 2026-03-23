import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useElectronAPI } from '../../hooks/useElectronAPI';
import { useKanbanStore } from '../../hooks/useKanbanStore';
import type { ChangedFile, GitCommit, Job } from '../../types/index';

export interface CommitDialogState {
  // File list
  changedFiles: ChangedFile[];
  loadingFiles: boolean;
  stagedFiles: Set<string>;
  // All file diffs
  selectedFile: string | null;
  allDiffs: Map<string, string>;
  loadingDiffs: boolean;
  // Commit message
  commitMessage: string;
  generatingMessage: boolean;
  // Commit flow
  commitLoading: boolean;
  commitError: string | null;
  commitPhase: 'compose' | 'push';
  clearedCompletedCount: number;
  // Push
  pushing: boolean;
  unpushedCommits: GitCommit[];
  loadingUnpushed: boolean;
  // Job context
  jobAttributions: Map<string, Job[]>;
  runningJobs: Job[];
  runningJobFiles: Set<string>;
}

export interface CommitDialogActions {
  toggleFile: (filePath: string) => void;
  toggleAll: () => void;
  selectFile: (filePath: string | null) => void;
  setCommitMessage: (msg: string) => void;
  regenerateMessage: () => void;
  discardFile: (filePath: string, isUntracked: boolean) => Promise<void>;
  commit: () => Promise<void>;
  push: () => Promise<void>;
  refreshFiles: () => Promise<void>;
}

export function useCommitDialog(
  projectId: string,
  branch: string,
  onClose: () => void,
  onCommitted?: (result: { deletedJobIds?: string[]; warning?: string }) => void,
  onPushed?: () => void,
): CommitDialogState & CommitDialogActions {
  const api = useElectronAPI();
  const jobs = useKanbanStore((s) => s.jobs);
  const settings = useKanbanStore((s) => s.settings);

  // File list state
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [stagedFiles, setStagedFiles] = useState<Set<string>>(new Set());

  // Diff state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [allDiffs, setAllDiffs] = useState<Map<string, string>>(new Map());
  const [loadingDiffs, setLoadingDiffs] = useState(false);

  // Commit state
  const [commitMessage, setCommitMessage] = useState('');
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitPhase, setCommitPhase] = useState<'compose' | 'push'>('compose');
  const [clearedCompletedCount, setClearedCompletedCount] = useState(0);
  const [pushing, setPushing] = useState(false);
  const [unpushedCommits, setUnpushedCommits] = useState<GitCommit[]>([]);
  const [loadingUnpushed, setLoadingUnpushed] = useState(false);

  // Discard confirmation tracking
  const [discardingFile, setDiscardingFile] = useState<string | null>(null);

  // Ref to avoid stale closures
  const changedFilesRef = useRef(changedFiles);
  changedFilesRef.current = changedFiles;

  // Job attribution: which jobs edited which files
  const projectBranchJobs = useMemo(
    () => jobs.filter((j) => j.projectId === projectId && j.branch === branch),
    [jobs, projectId, branch],
  );

  const runningJobs = useMemo(
    () => projectBranchJobs.filter((j) => j.status === 'running'),
    [projectBranchJobs],
  );

  const runningJobFiles = useMemo(() => {
    const files = new Set<string>();
    for (const job of runningJobs) {
      if (job.editedFiles) {
        for (const f of job.editedFiles) files.add(f);
      }
    }
    return files;
  }, [runningJobs]);

  const jobAttributions = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of projectBranchJobs) {
      if (!job.editedFiles) continue;
      for (const filePath of job.editedFiles) {
        const existing = map.get(filePath) || [];
        existing.push(job);
        map.set(filePath, existing);
      }
    }
    return map;
  }, [projectBranchJobs]);

  // Track whether this is the initial load (to auto-select first file)
  const initialLoadRef = useRef(true);

  // Fetch changed files
  const refreshFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const files = await api.gitListChangedFiles(projectId);
      setChangedFiles(files);
      setStagedFiles(new Set(files.map((f) => f.path)));
      // Auto-select first file on initial load
      if (initialLoadRef.current && files.length > 0) {
        initialLoadRef.current = false;
        setSelectedFile(files[0].path);
      }
    } catch {
      setChangedFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, [api, projectId]);

  // Initial load: fetch files + generate message
  useEffect(() => {
    refreshFiles();

    setGeneratingMessage(true);
    api
      .gitGenerateCommitMessage(projectId, branch)
      .then((msg) => setCommitMessage(msg))
      .catch(() => {})
      .finally(() => setGeneratingMessage(false));
  }, [api, projectId, branch, refreshFiles]);

  // Auto-refresh when running jobs are active
  useEffect(() => {
    if (runningJobs.length === 0) return;
    const interval = setInterval(() => refreshFiles(), 5000);
    return () => clearInterval(interval);
  }, [runningJobs.length, refreshFiles]);

  // Fetch diffs for all changed files in parallel
  useEffect(() => {
    if (changedFiles.length === 0) {
      setAllDiffs(new Map());
      return;
    }

    let cancelled = false;
    setLoadingDiffs(true);
    setAllDiffs(new Map());

    // Fetch each file's diff and update state progressively
    const promises = changedFiles.map((file) =>
      api
        .gitDiffFile(projectId, file.path, file.status === 'untracked')
        .then((diff) => {
          if (!cancelled) {
            setAllDiffs((prev) => {
              const next = new Map(prev);
              next.set(file.path, diff);
              return next;
            });
          }
        })
        .catch(() => {
          // Skip files that fail to load diff
        }),
    );

    Promise.allSettled(promises).then(() => {
      if (!cancelled) setLoadingDiffs(false);
    });

    return () => {
      cancelled = true;
    };
  }, [api, projectId, changedFiles]);

  // Actions
  const toggleFile = useCallback((filePath: string) => {
    setStagedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setStagedFiles((prev) => {
      if (prev.size === changedFilesRef.current.length) return new Set();
      return new Set(changedFilesRef.current.map((f) => f.path));
    });
  }, []);

  const selectFile = useCallback((filePath: string | null) => {
    setSelectedFile(filePath);
  }, []);

  const regenerateMessage = useCallback(async () => {
    setGeneratingMessage(true);
    try {
      const msg = await api.gitGenerateCommitMessage(projectId, branch);
      setCommitMessage(msg);
    } catch {
      // User can write their own
    } finally {
      setGeneratingMessage(false);
    }
  }, [api, projectId, branch]);

  const discardFile = useCallback(
    async (filePath: string, isUntracked: boolean) => {
      setDiscardingFile(filePath);
      try {
        const result = await api.gitDiscardFile(projectId, filePath, isUntracked);
        if (!result.success) {
          setCommitError(`Failed to discard ${filePath}: ${result.error}`);
          return;
        }
        // If this file was selected, deselect it
        setSelectedFile((prev) => (prev === filePath ? null : prev));
        // Remove from diffs map
        setAllDiffs((prev) => {
          const next = new Map(prev);
          next.delete(filePath);
          return next;
        });
        // Refresh file list
        await refreshFiles();
      } catch (err) {
        setCommitError(`Failed to discard ${filePath}`);
      } finally {
        setDiscardingFile(null);
      }
    },
    [api, projectId, refreshFiles],
  );

  const commit = useCallback(async () => {
    if (!commitMessage.trim() || stagedFiles.size === 0) return;
    setCommitLoading(true);
    setCommitError(null);

    const files = Array.from(stagedFiles);
    const result = await api.gitCommit(projectId, commitMessage.trim(), branch, files);

    if (!result.success) {
      setCommitError(result.error || 'Commit failed');
      setCommitLoading(false);
      return;
    }

    setClearedCompletedCount(result.deletedJobIds?.length || 0);
    setCommitError(result.warning || null);
    setCommitLoading(false);

    onCommitted?.({ deletedJobIds: result.deletedJobIds, warning: result.warning });

    // Check if there are commits to push
    const updated = await api.gitBranchesStatus(projectId);
    const branchAfter = updated?.find((b) => b.name === branch);
    if (branchAfter && branchAfter.ahead > 0) {
      setCommitPhase('push');
      setLoadingUnpushed(true);
      api.gitUnpushedCommits(projectId, branch)
        .then((commits) => setUnpushedCommits(commits))
        .catch(() => setUnpushedCommits([]))
        .finally(() => setLoadingUnpushed(false));
    } else {
      if (result.warning) {
        // Stay open to show warning
      } else {
        onClose();
      }
    }
  }, [api, projectId, branch, commitMessage, stagedFiles, onClose, onCommitted]);

  const push = useCallback(async () => {
    setPushing(true);
    setCommitError(null);
    const result = await api.gitPush(projectId, branch);
    setPushing(false);
    if (!result.success) {
      setCommitError(result.error || 'Push failed');
      return;
    }
    onPushed?.();
    onClose();
  }, [api, projectId, branch, onClose, onPushed]);

  return {
    changedFiles,
    loadingFiles,
    stagedFiles,
    selectedFile,
    allDiffs,
    loadingDiffs,
    commitMessage,
    generatingMessage,
    commitLoading,
    commitError,
    commitPhase,
    clearedCompletedCount,
    pushing,
    unpushedCommits,
    loadingUnpushed,
    jobAttributions,
    runningJobs,
    runningJobFiles,
    toggleFile,
    toggleAll,
    selectFile,
    setCommitMessage,
    regenerateMessage,
    discardFile,
    commit,
    push,
    refreshFiles,
  };
}
