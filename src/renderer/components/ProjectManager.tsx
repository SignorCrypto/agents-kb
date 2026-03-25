import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { ClaudeMdEditor } from './ClaudeMdEditor';
import { Kbd } from './Kbd';
import { LightbulbIcon, SettingsIcon, XIcon } from './Icons';
import type { KanbanColumn, Project } from '../types/index';
import { PROJECT_COLORS, getProjectColor } from '../types/index';
import { GitHistoryPanel } from '../features/git-history';
import { GitPanel } from '../features/git-panel';
import { NotificationBadge } from './NotificationBadge';

interface BranchStatus {
  name: string;
  isCurrent: boolean;
  ahead: number;
  dirtyFiles: number;
  hasUpstream: boolean;
}

const BRANCH_STATUS_POLL_MS = 15000;
const TERMINAL_JOB_STATUSES = new Set<string>(['completed', 'rejected', 'error']);

function areBranchStatusListsEqual(left: BranchStatus[] | undefined, right: BranchStatus[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (
      a.name !== b.name ||
      a.isCurrent !== b.isCurrent ||
      a.ahead !== b.ahead ||
      a.dirtyFiles !== b.dirtyFiles ||
      a.hasUpstream !== b.hasUpstream
    ) {
      return false;
    }
  }
  return true;
}

function areBranchStatusMapsEqual(left: Map<string, BranchStatus[]>, right: Map<string, BranchStatus[]>): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [projectId, leftStatuses] of left) {
    if (!areBranchStatusListsEqual(leftStatuses, right.get(projectId))) {
      return false;
    }
  }
  return true;
}

const COLUMN_ORDER: KanbanColumn[] = ['planning', 'development', 'done'];
const COLUMN_DOT_CLASSES: Record<KanbanColumn, string> = {
  planning: 'bg-column-planning',
  development: 'bg-column-development',
  done: 'bg-column-done',
};
const COLUMN_LABELS: Record<KanbanColumn, string> = {
  planning: 'Planning',
  development: 'Development',
  done: 'Done',
};

type DetailTab = 'details' | 'claude-md';

function ProjectDetailDialog({
  project,
  stats,
  onClose,
  onRename,
  onRemove,
  onSetDefaultBranch,
  onSetColor,
}: {
  project: Project;
  stats: { counts: Record<KanbanColumn, number>; hasNotification: boolean } | undefined;
  onClose: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onSetDefaultBranch: (branch: string | null) => void;
  onSetColor: (color: string | null) => void;
}) {
  const [name, setName] = useState(project.name);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('details');
  const preferredEditor = useKanbanStore((s) => s.settings.preferredEditor ?? 'auto');
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const api = useElectronAPI();

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  useEffect(() => {
    setLoadingBranches(true);
    api.gitListBranches(project.id).then((result) => {
      setLoadingBranches(false);
      if (result) setBranches(result.branches);
    });
  }, [project.id, api]);

  const stableOnClose = useCallback(() => onClose(), [onClose]);

  const handleOpenInEditor = useCallback(async () => {
    const result = await api.projectsOpenInEditor(project.id);
    if (!result.success) {
      window.alert(result.error || 'Failed to open project in editor.');
    }
  }, [api, project.id]);

  const handleOpenFolder = useCallback(async () => {
    const result = await api.projectsOpenFolder(project.id);
    if (!result.success) {
      window.alert(result.error || 'Failed to open folder.');
    }
  }, [api, project.id]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stableOnClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [stableOnClose]);

  const handleSaveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) {
      onRename(trimmed);
    } else {
      setName(project.name);
    }
    setIsEditing(false);
  };

  const totalJobs = stats ? stats.counts.planning + stats.counts.development + stats.counts.done : 0;
  const addedDate = new Date(project.addedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const isClaudeMdTab = activeTab === 'claude-md';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={stableOnClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className={`relative rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl shadow-surface-overlay/20 overflow-hidden animate-[dialogIn_150ms_ease-out] transition-[width] duration-200 ease-out flex flex-col ${isClaudeMdTab ? 'w-[560px] h-[480px]' : 'w-80'
          }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={stableOnClose}
          className="absolute top-2.5 right-2.5 p-1 rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/70 transition-colors z-10"
          aria-label="Close"
        >
          <XIcon size={12} />
        </button>

        {/* Header — name */}
        <div className="px-4 pt-4 pb-3 pr-8 shrink-0">
          {isEditing ? (
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') { setName(project.name); setIsEditing(false); }
              }}
              className="w-full text-sm font-semibold text-content-primary bg-surface-tertiary/60 border border-chrome-focus/50 rounded px-2 py-1 outline-none focus:border-active-indicator transition-colors"
              autoFocus
            />
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="group/name flex items-center gap-1.5 text-sm font-semibold text-content-primary hover:text-interactive-link-hover transition-colors"
              title="Click to rename"
            >
              <span className="truncate">{project.name}</span>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-0 group-hover/name:opacity-60 transition-opacity">
                <path d="M8.5 1.5l2 2M1 11l.7-2.8L9.2 .7l2 2L3.8 10.2z" />
              </svg>
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0 px-4 shrink-0">
          <button
            onClick={() => setActiveTab('details')}
            className={`relative px-3 py-2 text-[11px] font-medium transition-colors ${activeTab === 'details'
                ? 'text-content-primary'
                : 'text-content-tertiary hover:text-content-secondary'
              }`}
          >
            Details
            {activeTab === 'details' && (
              <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-active-indicator" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('claude-md')}
            className={`relative px-3 py-2 text-[11px] font-medium font-mono transition-colors ${activeTab === 'claude-md'
                ? 'text-content-primary'
                : 'text-content-tertiary hover:text-content-secondary'
              }`}
          >
            CLAUDE.md
            {activeTab === 'claude-md' && (
              <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-active-indicator" />
            )}
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'details' ? (
          <>
            {/* Details tab content */}
            <div className="px-4 py-4 space-y-3">
              {/* Path */}
              <div className="group/path">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-content-tertiary font-medium">Path</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover/path:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(project.path);
                        setCopiedPath(true);
                        setTimeout(() => setCopiedPath(false), 1500);
                      }}
                      className="p-0.5 rounded text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary/50 transition-colors"
                      title="Copy path"
                      aria-label="Copy path"
                    >
                      {copiedPath ? (
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3.5 8.5l3 3 6-7" />
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="5" width="9" height="9" rx="1" />
                          <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => { void handleOpenFolder(); }}
                      className="p-0.5 rounded text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary/50 transition-colors"
                      title="Reveal in Finder"
                      aria-label="Reveal in Finder"
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 9v4a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1h4" />
                        <path d="M9 2h5v5" />
                        <path d="M6 10L14 2" />
                      </svg>
                    </button>
                  </div>
                </div>
                <p className="text-xs text-content-secondary mt-0.5 break-all leading-relaxed text-left">{project.path}</p>
              </div>

              {/* Open in IDE — git repos only */}
              {project.isGitRepo !== false && (
                <button
                  onClick={() => { void handleOpenInEditor(); }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-chrome-subtle/70 bg-surface-tertiary/25 text-[11px] font-medium text-content-secondary hover:bg-surface-tertiary/60 hover:border-chrome/60 hover:text-content-primary transition-all duration-150"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6l-4-4z" />
                    <path d="M9 2v4h4" />
                    <path d="M7 9l-1.5 1.5L7 12" />
                    <path d="M10 9l1.5 1.5L10 12" />
                  </svg>
                  {preferredEditor === 'cursor'
                    ? 'Open in Cursor'
                    : preferredEditor === 'vscode'
                      ? 'Open in VS Code'
                      : 'Open in Editor'}
                </button>
              )}

              {/* Added */}
              <div>
                <span className="text-[10px] uppercase tracking-wider text-content-tertiary font-medium">Added</span>
                <p className="text-xs text-content-secondary mt-0.5">{addedDate}</p>
              </div>

              {/* Color */}
              <div>
                <span className="text-[10px] uppercase tracking-wider text-content-tertiary font-medium">Color</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {PROJECT_COLORS.map((c) => {
                    const isActive = (project.color || PROJECT_COLORS[0].id) === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => onSetColor(c.id === PROJECT_COLORS[0].id ? null : c.id)}
                        className={`w-5 h-5 rounded-full transition-all duration-150 ${isActive
                            ? 'ring-2 ring-offset-1 ring-offset-surface-elevated scale-110'
                            : 'hover:scale-110'
                          }`}
                        style={{
                          backgroundColor: c.hex,
                          ...(isActive ? { ringColor: c.hex } as React.CSSProperties : {}),
                          boxShadow: isActive ? `0 0 0 2px ${c.hex}40` : undefined,
                        }}
                        title={c.id}
                        aria-label={`Set project color to ${c.id}`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Default Branch */}
              {branches.length > 0 && (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-content-tertiary font-medium">Default Branch</span>
                  <div className="relative mt-0.5">
                    <select
                      value={project.defaultBranch || ''}
                      onChange={(e) => onSetDefaultBranch(e.target.value || null)}
                      disabled={loadingBranches}
                      className="w-full appearance-none px-2 pr-8 py-1 text-xs rounded border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
                    >
                      <option value="">None (use current)</option>
                      {branches.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                    <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-content-secondary" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Job breakdown */}
              {totalJobs > 0 && (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-content-tertiary font-medium">
                    Jobs ({totalJobs})
                  </span>
                  <div className="flex items-center gap-3 mt-1">
                    {COLUMN_ORDER.map((col) => {
                      const count = stats!.counts[col];
                      if (count === 0) return null;
                      return (
                        <span key={col} className="flex items-center gap-1">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${COLUMN_DOT_CLASSES[col]}`} />
                          <span className="text-[11px] text-content-secondary">
                            {count} {COLUMN_LABELS[col]}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="border-t border-chrome-subtle/70 px-4 py-2.5 mt-auto shrink-0">
              {confirmRemove ? (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-semantic-error">Remove project?</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => { onRemove(); onClose(); }}
                      className="px-2 py-0.5 text-[10px] font-medium rounded bg-semantic-error/15 text-semantic-error hover:bg-semantic-error/25 transition-colors"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => setConfirmRemove(false)}
                      className="px-2 py-0.5 text-[10px] font-medium rounded text-content-tertiary hover:bg-surface-tertiary/70 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmRemove(true)}
                  className="text-[11px] text-content-tertiary hover:text-semantic-error transition-colors"
                >
                  Remove project
                </button>
              )}
            </div>
          </>
        ) : (
          /* CLAUDE.md tab content */
          <div className="flex-1 min-h-0 flex flex-col">
            <ClaudeMdEditor projectId={project.id} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ProjectManager() {
  const projects = useKanbanStore((s) => s.projects);
  const jobs = useKanbanStore((s) => s.jobs);
  const addProject = useKanbanStore((s) => s.addProject);
  const removeProject = useKanbanStore((s) => s.removeProject);
  const removeJob = useKanbanStore((s) => s.removeJob);
  const renameProject = useKanbanStore((s) => s.renameProject);
  const reorderProjects = useKanbanStore((s) => s.reorderProjects);
  const selectedProjectId = useKanbanStore((s) => s.selectedProjectId);
  const selectProject = useKanbanStore((s) => s.selectProject);
  const setProjectDefaultBranch = useKanbanStore((s) => s.setProjectDefaultBranch);
  const setProjectColor = useKanbanStore((s) => s.setProjectColor);
  const api = useElectronAPI();

  const setShowSettings = useKanbanStore((s) => s.setShowSettings);
  const setShowSkillsPanel = useKanbanStore((s) => s.setShowSkillsPanel);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [gitHistoryProjectId, setGitHistoryProjectId] = useState<string | null>(null);
  const [gitHistoryBranches, setGitHistoryBranches] = useState<{ branches: string[]; current: string } | null>(null);
  const [branchStatuses, setBranchStatuses] = useState<Map<string, BranchStatus[]>>(new Map());
  const [gitPanel, setGitPanel] = useState<{
    projectId: string;
    branch: string;
    isDirty: boolean;
    hasUpstream: boolean;
  } | null>(null);
  const previousStatusesRef = useRef<Map<string, string>>(new Map());

  const gitProjects = useMemo(
    () => projects.filter((project) => project.isGitRepo !== false),
    [projects],
  );

  const refreshProjectBranchStatus = useCallback(async (projectId: string) => {
    if (!gitProjects.some((project) => project.id === projectId)) return null;

    const updated = await api.gitBranchesStatus(projectId);
    setBranchStatuses((prev) => {
      const next = new Map(prev);
      if (updated && updated.length > 0) next.set(projectId, updated);
      else next.delete(projectId);
      return areBranchStatusMapsEqual(prev, next) ? prev : next;
    });
    return updated;
  }, [api, gitProjects]);

  const refreshAllBranchStatuses = useCallback(async () => {
    const next = new Map<string, BranchStatus[]>();
    await Promise.all(
      gitProjects.map(async (project) => {
        const result = await api.gitBranchesStatus(project.id);
        if (result && result.length > 0) next.set(project.id, result);
      }),
    );
    setBranchStatuses((prev) => areBranchStatusMapsEqual(prev, next) ? prev : next);
  }, [api, gitProjects]);

  // Fetch branch statuses for all projects
  useEffect(() => {
    void refreshAllBranchStatuses();
    const interval = setInterval(() => {
      void refreshAllBranchStatuses();
    }, BRANCH_STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [refreshAllBranchStatuses]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshAllBranchStatuses();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshAllBranchStatuses]);

  // Fetch branches when git history modal opens
  useEffect(() => {
    if (!gitHistoryProjectId) {
      setGitHistoryBranches(null);
      return;
    }
    void api.gitListBranches(gitHistoryProjectId).then((result) => {
      if (result) setGitHistoryBranches(result);
    });
  }, [gitHistoryProjectId, api]);

  const handleBranchCheckout = useCallback(async (branch: string) => {
    if (!gitHistoryProjectId) return;
    const result = await api.gitCheckout(gitHistoryProjectId, branch);
    if (result.success) {
      const updated = await api.gitListBranches(gitHistoryProjectId);
      if (updated) setGitHistoryBranches(updated);
      void refreshProjectBranchStatus(gitHistoryProjectId);
    } else {
      alert(result.error || 'Failed to switch branch');
    }
  }, [gitHistoryProjectId, api, refreshProjectBranchStatus]);

  useEffect(() => {
    const previous = previousStatusesRef.current;
    const refreshProjectIds = new Set<string>();

    for (const job of jobs) {
      const previousStatus = previous.get(job.id);
      if (previousStatus && previousStatus !== job.status && TERMINAL_JOB_STATUSES.has(job.status)) {
        refreshProjectIds.add(job.projectId);
      }
      previous.set(job.id, job.status);
    }

    for (const jobId of Array.from(previous.keys())) {
      if (!jobs.some((job) => job.id === jobId)) {
        previous.delete(jobId);
      }
    }

    for (const projectId of refreshProjectIds) {
      void refreshProjectBranchStatus(projectId);
    }
  }, [jobs, refreshProjectBranchStatus]);

  const handleGitPanelCommitted = useCallback(
    (result: { deletedJobIds?: string[]; warning?: string }) => {
      for (const jobId of result.deletedJobIds || []) {
        removeJob(jobId);
      }
      if (gitPanel) {
        refreshProjectBranchStatus(gitPanel.projectId);
      }
    },
    [gitPanel, removeJob, refreshProjectBranchStatus],
  );

  const handleGitPanelPushed = useCallback(() => {
    if (gitPanel) {
      refreshProjectBranchStatus(gitPanel.projectId);
    }
  }, [gitPanel, refreshProjectBranchStatus]);

  const handleGitPanelBranchDeleted = useCallback(() => {
    if (gitPanel) {
      refreshProjectBranchStatus(gitPanel.projectId);
    }
  }, [gitPanel, refreshProjectBranchStatus]);

  // Compute per-project job counts by column + notification flag
  const projectStats = useMemo(() => {
    const stats = new Map<string, { counts: Record<KanbanColumn, number>; hasNotification: boolean }>();
    for (const job of jobs) {
      let entry = stats.get(job.projectId);
      if (!entry) {
        entry = { counts: { planning: 0, development: 0, done: 0 }, hasNotification: false };
        stats.set(job.projectId, entry);
      }
      entry.counts[job.column]++;
      if (job.pendingQuestion || job.status === 'waiting-input' || job.status === 'plan-ready') {
        entry.hasNotification = true;
      }
    }
    return stats;
  }, [jobs]);

  // Drag state
  const draggedId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below' | null>(null);

  const handleAddProject = async () => {
    const project = await api.projectsAdd();
    if (project) {
      addProject(project);
    }
  };

  const handleRemoveProject = async (id: string) => {
    await api.projectsRemove(id);
    removeProject(id);
  };

  const handleRenameProject = async (id: string, name: string) => {
    await api.projectsRename(id, name);
    renameProject(id, name);
  };

  const handleSetDefaultBranch = async (id: string, branch: string | null) => {
    await api.projectsSetDefaultBranch(id, branch);
    setProjectDefaultBranch(id, branch);
  };

  const handleSetColor = async (id: string, color: string | null) => {
    await api.projectsSetColor(id, color);
    setProjectColor(id, color);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    draggedId.current = id;
    e.dataTransfer.effectAllowed = 'move';
    const el = e.currentTarget as HTMLElement;
    el.style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '';
    draggedId.current = null;
    setDragOverId(null);
    setDragOverPosition(null);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedId.current === id) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDragOverId(id);
    setDragOverPosition(e.clientY < midY ? 'above' : 'below');
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggedId.current;
    if (!sourceId || sourceId === targetId) return;

    const ids = projects.map(p => p.id);
    const sourceIdx = ids.indexOf(sourceId);
    const targetIdx = ids.indexOf(targetId);
    if (sourceIdx < 0 || targetIdx < 0) return;

    ids.splice(sourceIdx, 1);
    const newTargetIdx = ids.indexOf(targetId);
    const insertIdx = dragOverPosition === 'below' ? newTargetIdx + 1 : newTargetIdx;
    ids.splice(insertIdx, 0, sourceId);

    reorderProjects(ids);
    api.projectsReorder(ids);

    setDragOverId(null);
    setDragOverPosition(null);
  };

  return (
    <div className="w-60 shrink-0 border-r border-chrome-subtle/70 bg-surface-secondary/80 flex flex-col">
      {/* Drag area for title bar */}
      <div
        className="h-10 shrink-0 flex items-center px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
          Projects
        </span>
        <button
          onClick={handleAddProject}
          className="h-5 w-5 flex items-center justify-center rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/70 transition-colors"
          title="Add project"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 flex flex-col gap-0.5">
        {projects.length === 0 && (
          <p className="text-xs text-content-tertiary px-2 py-4 text-center">
            No projects yet. Add a folder to get started.
          </p>
        )}
        {projects.map((project) => {
          const isSelected = selectedProjectId === project.id;
          const isDragOver = dragOverId === project.id && draggedId.current !== project.id;
          const stats = projectStats.get(project.id);
          const totalJobs = stats ? stats.counts.planning + stats.counts.development + stats.counts.done : 0;
          const isDetailOpen = detailProjectId === project.id;
          const branches = (branchStatuses.get(project.id) || []).filter((b) => b.isCurrent);
          const projectColor = getProjectColor(project.color);
          return (
            <div
              key={project.id}
              draggable
              onDragStart={(e) => handleDragStart(e, project.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, project.id)}
              onDragLeave={() => { if (dragOverId === project.id) { setDragOverId(null); setDragOverPosition(null); } }}
              onDrop={(e) => handleDrop(e, project.id)}
              onClick={() => selectProject(project.id)}
              style={isSelected ? { backgroundColor: projectColor + '0F' } : undefined}
              className={`group rounded-md cursor-grab active:cursor-grabbing transition-all duration-150 px-2 py-1.5 ${isSelected
                  ? ''
                  : 'hover:bg-surface-tertiary/60'
                } ${isDragOver && dragOverPosition === 'above' ? 'ring-t-2 ring-active-indicator' : ''}
                ${isDragOver && dragOverPosition === 'below' ? 'ring-b-2 ring-active-indicator' : ''}`}
            >
              {/* Primary row: name + actions + notification */}
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: projectColor }}
                />
                <span className={`text-[13px] font-medium truncate min-w-0 flex-1 transition-colors ${isSelected ? 'text-content-primary' : ''
                  }`}>
                  {project.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setGitHistoryProjectId(gitHistoryProjectId === project.id ? null : project.id);
                  }}
                  className={`p-0.5 rounded flex items-center justify-center transition-all shrink-0 ${gitHistoryProjectId === project.id
                      ? 'opacity-100 text-content-secondary bg-surface-tertiary/70'
                      : 'opacity-0 group-hover:opacity-100 text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary/50'
                    }`}
                  title={project.isGitRepo === false ? 'Initialize git' : 'Git history'}
                  aria-label={project.isGitRepo === false ? 'Initialize git' : 'Git history'}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="5" cy="4" r="2" />
                    <circle cx="5" cy="12" r="2" />
                    <circle cx="13" cy="8" r="2" />
                    <path d="M5 6v4M7 12h4c1.1 0 2-.9 2-2" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailProjectId(isDetailOpen ? null : project.id);
                  }}
                  className={`p-0.5 rounded flex items-center justify-center transition-all shrink-0 ${isDetailOpen
                      ? 'opacity-100 text-content-secondary bg-surface-tertiary/70'
                      : 'opacity-0 group-hover:opacity-100 text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary/50'
                    }`}
                  title="Project details"
                  aria-label="Project details"
                >
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="7" cy="7" r="5.5" />
                    <path d="M7 6.2V10" />
                    <circle cx="7" cy="4.3" r="0.01" strokeWidth="2" />
                  </svg>
                </button>
                {stats?.hasNotification && <NotificationBadge size="sm" />}
              </div>

              {/* Metadata row: branch badge + job counters */}
              {(branches.length > 0 || totalJobs > 0) && (
                <div className="flex items-center gap-1.5 mt-0.5 pl-[18px] min-w-0">
                  {branches.map((b) => {
                    const isUnpublished = !b.hasUpstream;
                    const canPush = b.ahead > 0 || isUnpublished;
                    const isActionable = canPush || b.dirtyFiles > 0;
                    const chipTitle = [
                      b.name,
                      isUnpublished ? 'unpublished branch — click to publish' : '',
                      b.dirtyFiles > 0 ? `${b.dirtyFiles} uncommitted file${b.dirtyFiles > 1 ? 's' : ''}` : '',
                      !isUnpublished && b.ahead > 0 ? `${b.ahead} commit${b.ahead > 1 ? 's' : ''} to push — click to push` : '',
                    ].filter(Boolean).join(' · ');

                    return (
                      <button
                        key={b.name}
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          if (isActionable) {
                            setGitPanel({
                              projectId: project.id,
                              branch: b.name,
                              isDirty: b.dirtyFiles > 0,
                              hasUpstream: b.hasUpstream,
                            });
                          }
                        }}
                        title={chipTitle}
                        className={`inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-medium leading-tight transition-colors ${canPush
                            ? 'bg-column-development/10 text-column-development hover:bg-column-development/20 cursor-pointer'
                            : isActionable
                              ? 'bg-semantic-warning/10 text-semantic-warning hover:bg-semantic-warning/20 cursor-pointer'
                              : 'text-content-tertiary bg-surface-tertiary/40'
                          }`}
                      >
                        <span className="truncate max-w-[64px]">{b.name}</span>
                        {b.dirtyFiles > 0 && (
                          <span className="tabular-nums opacity-80 ml-px">±{b.dirtyFiles}</span>
                        )}
                        {b.ahead > 0 && (
                          <span className="tabular-nums ml-px">{b.ahead}&#8593;</span>
                        )}
                      </button>
                    );
                  })}
                  {branches.length > 0 && totalJobs > 0 && (
                    <span className="text-content-tertiary/40 text-[8px] leading-none select-none">·</span>
                  )}
                  {totalJobs > 0 && COLUMN_ORDER.map((col) => {
                    const count = stats!.counts[col];
                    if (count === 0) return null;
                    return (
                      <span key={col} className="flex items-center gap-px">
                        <span className={`inline-block w-1 h-1 rounded-full ${COLUMN_DOT_CLASSES[col]}`} />
                        <span className="text-[10px] tabular-nums text-content-tertiary leading-none">{count}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-chrome-subtle/70 px-4 py-2 flex flex-col gap-1">
        <button
          onClick={() => setShowSkillsPanel(true)}
          className="flex items-center gap-1.5 text-content-tertiary hover:text-content-secondary transition-colors"
          title="Installed Skills"
        >
          <LightbulbIcon size={14} />
          <span className="text-[11px]">Skills</span>
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 text-content-tertiary hover:text-content-secondary transition-colors"
          title="Settings"
        >
          <SettingsIcon size={14} />
          <span className="text-[11px]">Settings<Kbd shortcutId="openSettings" /></span>
        </button>
      </div>

      {/* Git panel (unified commit/push/publish dialog) */}
      {gitPanel && (() => {
        const project = projects.find(p => p.id === gitPanel.projectId);
        if (!project) return null;
        return (
          <GitPanel
            projectId={gitPanel.projectId}
            branch={gitPanel.branch}
            projectName={project.name}
            projectColor={getProjectColor(project.color)}
            isDirty={gitPanel.isDirty}
            hasUpstream={gitPanel.hasUpstream}
            onClose={() => setGitPanel(null)}
            onCommitted={handleGitPanelCommitted}
            onPushed={handleGitPanelPushed}
            onBranchDeleted={handleGitPanelBranchDeleted}
          />
        );
      })()}

      {/* Project detail dialog */}
      {detailProjectId && (() => {
        const project = projects.find(p => p.id === detailProjectId);
        if (!project) return null;
        return (
          <ProjectDetailDialog
            project={project}
            stats={projectStats.get(detailProjectId)}
            onClose={() => setDetailProjectId(null)}
            onRename={(name) => handleRenameProject(detailProjectId, name)}
            onRemove={() => handleRemoveProject(detailProjectId)}
            onSetDefaultBranch={(branch) => handleSetDefaultBranch(detailProjectId, branch)}
            onSetColor={(color) => handleSetColor(detailProjectId, color)}
          />
        );
      })()}

      {/* Git history dialog */}
      {gitHistoryProjectId && (() => {
        const project = projects.find(p => p.id === gitHistoryProjectId);
        if (!project) return null;
        return createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center"
            onClick={() => setGitHistoryProjectId(null)}
          >
            <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />
            <div
              className="relative rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl shadow-surface-overlay/20 overflow-hidden animate-[dialogIn_150ms_ease-out] flex flex-col w-[900px] h-[600px]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-3 pb-0 shrink-0">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: getProjectColor(project.color) }}
                  />
                  <span className="text-sm font-semibold text-content-primary truncate">{project.name}</span>
                </div>
                <button
                  onClick={() => setGitHistoryProjectId(null)}
                  className="p-1 rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/70 transition-colors"
                  aria-label="Close"
                >
                  <XIcon size={12} />
                </button>
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                <GitHistoryPanel
                  projectId={project.id}
                  isGitRepo={project.isGitRepo !== false}
                  currentBranch={gitHistoryBranches?.current}
                  branches={gitHistoryBranches?.branches}
                  onBranchChange={handleBranchCheckout}
                  onClose={() => setGitHistoryProjectId(null)}
                />
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
