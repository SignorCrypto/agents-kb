import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useElectronAPI } from '../../hooks/useElectronAPI';
import { useKanbanStore } from '../../hooks/useKanbanStore';
import type { ChangedFile, GitCommit, Job } from '../../types/index';

export type GitPanelPhase = 'compose' | 'push' | 'publish';

export interface GitPanelState {
  phase: GitPanelPhase;
  // Compose state
  changedFiles: ChangedFile[];
  loadingFiles: boolean;
  stagedFiles: Set<string>;
  selectedFile: string | null;
  allDiffs: Map<string, string>;
  loadingDiffs: boolean;
  commitMessage: string;
  generatingMessage: boolean;
  commitLoading: boolean;
  commitError: string | null;
  clearedCompletedCount: number;
  // Push/publish state
  pushing: boolean;
  unpushedCommits: GitCommit[];
  loadingUnpushed: boolean;
  // Delete branch
  deleting: boolean;
  // Job context
  jobAttributions: Map<string, Job[]>;
  runningJobs: Job[];
  runningJobFiles: Set<string>;
  // Whether we transitioned from compose → push (to show "Committed" header)
  didCommit: boolean;
  // Whether this is an unpublished branch
  isUnpublished: boolean;
}

export interface GitPanelActions {
  toggleFile: (filePath: string) => void;
  toggleAll: () => void;
  selectFile: (filePath: string | null) => void;
  setCommitMessage: (msg: string) => void;
  regenerateMessage: () => void;
  discardFile: (filePath: string, isUntracked: boolean) => Promise<void>;
  discardAll: () => Promise<void>;
  commit: () => Promise<void>;
  push: () => Promise<void>;
  deleteBranch: () => Promise<void>;
  refreshFiles: () => Promise<void>;
}

export function useGitPanel(
  projectId: string,
  branch: string,
  isDirty: boolean,
  hasUpstream: boolean,
  onClose: () => void,
  onCommitted?: (result: { deletedJobIds?: string[]; warning?: string }) => void,
  onPushed?: () => void,
  onBranchDeleted?: () => void,
): GitPanelState & GitPanelActions {
  const api = useElectronAPI();
  const jobs = useKanbanStore((s) => s.jobs);
  const settings = useKanbanStore((s) => s.settings);

  // Compute initial phase
  const initialPhase: GitPanelPhase = isDirty ? 'compose' : hasUpstream ? 'push' : 'publish';

  // Phase state
  const [phase, setPhase] = useState<GitPanelPhase>(initialPhase);
  const [didCommit, setDidCommit] = useState(false);

  // File list state
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(isDirty);
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
  const [clearedCompletedCount, setClearedCompletedCount] = useState(0);

  // Push state
  const [pushing, setPushing] = useState(false);
  const [unpushedCommits, setUnpushedCommits] = useState<GitCommit[]>([]);
  const [loadingUnpushed, setLoadingUnpushed] = useState(false);

  // Delete state
  const [deleting, setDeleting] = useState(false);

  // Ref to avoid stale closures
  const changedFilesRef = useRef(changedFiles);
  changedFilesRef.current = changedFiles;

  // Job attribution
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

  // Track initial load for auto-selecting first file
  const initialLoadRef = useRef(true);

  // Fetch changed files
  const refreshFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const files = await api.gitListChangedFiles(projectId);
      setChangedFiles(files);
      setStagedFiles(new Set(files.map((f) => f.path)));
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

  // Load unpushed commits
  const loadUnpushedCommits = useCallback(async () => {
    setLoadingUnpushed(true);
    try {
      const commits = await api.gitUnpushedCommits(projectId, branch);
      setUnpushedCommits(commits);
    } catch {
      setUnpushedCommits([]);
    } finally {
      setLoadingUnpushed(false);
    }
  }, [api, projectId, branch]);

  // Compose phase: fetch files + generate message
  useEffect(() => {
    if (phase !== 'compose') return;

    refreshFiles();

    setGeneratingMessage(true);
    api
      .gitGenerateCommitMessage(projectId, branch)
      .then((msg) => setCommitMessage(msg))
      .catch(() => {})
      .finally(() => setGeneratingMessage(false));
  }, [api, projectId, branch, refreshFiles, phase]);

  // Push/publish phase: load unpushed commits
  useEffect(() => {
    if (phase === 'compose') return;
    loadUnpushedCommits();
  }, [phase, loadUnpushedCommits]);

  // Auto-refresh when running jobs are active (compose phase only)
  useEffect(() => {
    if (phase !== 'compose' || runningJobs.length === 0) return;
    const interval = setInterval(() => refreshFiles(), 5000);
    return () => clearInterval(interval);
  }, [phase, runningJobs.length, refreshFiles]);

  // Fetch diffs: initial batch in parallel, then remaining sequentially
  useEffect(() => {
    if (changedFiles.length === 0) {
      setAllDiffs(new Map());
      return;
    }

    let cancelled = false;
    setLoadingDiffs(true);
    setAllDiffs(new Map());

    const INITIAL_BATCH = 3;

    const fetchDiff = (file: ChangedFile) =>
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
        .catch(() => {});

    (async () => {
      // Phase 1: load initial batch in parallel to fill the viewport fast
      const initialFiles = changedFiles.slice(0, INITIAL_BATCH);
      await Promise.allSettled(initialFiles.map(fetchDiff));

      // Phase 2: load remaining files sequentially (top-to-bottom, fewer re-renders)
      const remainingFiles = changedFiles.slice(INITIAL_BATCH);
      for (const file of remainingFiles) {
        if (cancelled) break;
        await fetchDiff(file);
      }

      if (!cancelled) setLoadingDiffs(false);
    })();

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
      try {
        const result = await api.gitDiscardFile(projectId, filePath, isUntracked);
        if (!result.success) {
          setCommitError(`Failed to discard ${filePath}: ${result.error}`);
          return;
        }
        setSelectedFile((prev) => (prev === filePath ? null : prev));
        setAllDiffs((prev) => {
          const next = new Map(prev);
          next.delete(filePath);
          return next;
        });
        await refreshFiles();
      } catch {
        setCommitError(`Failed to discard ${filePath}`);
      }
    },
    [api, projectId, refreshFiles],
  );

  const discardAll = useCallback(async () => {
    try {
      const result = await api.gitDiscardAll(projectId);
      if (!result.success) {
        setCommitError(`Failed to discard all changes: ${result.error}`);
        return;
      }
      setSelectedFile(null);
      setAllDiffs(new Map());
      await refreshFiles();
    } catch {
      setCommitError('Failed to discard all changes');
    }
  }, [api, projectId, refreshFiles]);

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
      setDidCommit(true);
      setPhase(branchAfter.hasUpstream ? 'push' : 'publish');
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

  const deleteBranch = useCallback(async () => {
    setDeleting(true);
    setCommitError(null);
    const result = await api.gitDeleteBranch(projectId, branch);
    setDeleting(false);
    if (!result.success) {
      setCommitError(result.error || 'Delete failed');
      return;
    }
    onBranchDeleted?.();
    onClose();
  }, [api, projectId, branch, onClose, onBranchDeleted]);

  return {
    phase,
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
    clearedCompletedCount,
    pushing,
    unpushedCommits,
    loadingUnpushed,
    deleting,
    jobAttributions,
    runningJobs,
    runningJobFiles,
    didCommit,
    isUnpublished: !hasUpstream,
    toggleFile,
    toggleAll,
    selectFile,
    setCommitMessage,
    regenerateMessage,
    discardFile,
    discardAll,
    commit,
    push,
    deleteBranch,
    refreshFiles,
  };
}
