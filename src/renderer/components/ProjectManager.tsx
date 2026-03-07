import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { ClaudeMdEditor } from './ClaudeMdEditor';
import { SettingsDialog } from './SettingsDialog';
import type { KanbanColumn, Project } from '../types/index';

interface BranchStatus {
  name: string;
  isCurrent: boolean;
  ahead: number;
  dirtyFiles: number;
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
}: {
  project: Project;
  stats: { counts: Record<KanbanColumn, number>; hasNotification: boolean } | undefined;
  onClose: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onSetDefaultBranch: (branch: string | null) => void;
}) {
  const [name, setName] = useState(project.name);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('details');
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
        className={`relative rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl shadow-surface-overlay/20 overflow-hidden animate-[dialogIn_150ms_ease-out] transition-[width] duration-200 ease-out flex flex-col ${
          isClaudeMdTab ? 'w-[560px] h-[480px]' : 'w-80'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={stableOnClose}
          className="absolute top-2.5 right-2.5 p-1 rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/70 transition-colors z-10"
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
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
        <div className="flex items-center gap-0 px-4 shrink-0 border-b border-chrome-subtle/70">
          <button
            onClick={() => setActiveTab('details')}
            className={`relative px-3 py-2 text-[11px] font-medium transition-colors ${
              activeTab === 'details'
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
            className={`relative px-3 py-2 text-[11px] font-medium font-mono transition-colors ${
              activeTab === 'claude-md'
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
              <div>
                <span className="text-[10px] uppercase tracking-wider text-content-tertiary font-medium">Path</span>
                <p className="text-xs text-content-secondary mt-0.5 break-all leading-relaxed">{project.path}</p>
              </div>

              {/* Added */}
              <div>
                <span className="text-[10px] uppercase tracking-wider text-content-tertiary font-medium">Added</span>
                <p className="text-xs text-content-secondary mt-0.5">{addedDate}</p>
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
  const renameProject = useKanbanStore((s) => s.renameProject);
  const reorderProjects = useKanbanStore((s) => s.reorderProjects);
  const selectedProjectId = useKanbanStore((s) => s.selectedProjectId);
  const selectProject = useKanbanStore((s) => s.selectProject);
  const setProjectDefaultBranch = useKanbanStore((s) => s.setProjectDefaultBranch);
  const api = useElectronAPI();

  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [branchStatuses, setBranchStatuses] = useState<Map<string, BranchStatus[]>>(new Map());
  const [pushConfirm, setPushConfirm] = useState<{ projectId: string; branch: string } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  // Fetch branch statuses for all projects
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const newMap = new Map<string, BranchStatus[]>();
      await Promise.all(
        projects.map(async (p) => {
          const result = await api.gitBranchesStatus(p.id);
          if (result && result.length > 0) newMap.set(p.id, result);
        }),
      );
      if (!cancelled) setBranchStatuses(newMap);
    };
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projects, api]);

  const handlePush = async (projectId: string, branch: string) => {
    setPushing(true);
    setPushError(null);
    const result = await api.gitPush(projectId, branch);
    setPushing(false);
    if (!result.success) {
      setPushError(result.error || 'Push failed');
      return;
    }
    setPushConfirm(null);
    // Refresh branch statuses after push
    const updated = await api.gitBranchesStatus(projectId);
    setBranchStatuses((prev) => {
      const next = new Map(prev);
      if (updated && updated.length > 0) next.set(projectId, updated);
      else next.delete(projectId);
      return next;
    });
  };

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
        className="h-12 shrink-0 flex items-center px-4 border-b border-chrome-subtle/70"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <div className="flex items-center justify-between px-4 py-3">
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

      <div className="flex-1 overflow-y-auto px-2">
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
          const branches = branchStatuses.get(project.id) || [];
          const hasSecondaryInfo = totalJobs > 0 || branches.length > 0;
          return (
            <div
              key={project.id}
              className="relative"
            >
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, project.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, project.id)}
                onDragLeave={() => { if (dragOverId === project.id) { setDragOverId(null); setDragOverPosition(null); } }}
                onDrop={(e) => handleDrop(e, project.id)}
                onClick={() => selectProject(project.id)}
                className={`group relative flex items-stretch rounded-lg cursor-pointer transition-all duration-150 ${
                  isSelected
                    ? 'bg-selected-bg/80 border border-selected-border/30 shadow-sm'
                    : 'border border-transparent hover:bg-surface-tertiary/60'
                } ${isDragOver && dragOverPosition === 'above' ? 'border-t-2 !border-t-active-indicator' : ''}
                  ${isDragOver && dragOverPosition === 'below' ? 'border-b-2 !border-b-active-indicator' : ''}`}
              >
                {/* Left edge: accent bar (selected) / drag grip zone */}
                <div className="relative w-5 shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing">
                  {isSelected && (
                    <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-[3px] h-3/5 rounded-full bg-active-indicator" />
                  )}
                  <div className="opacity-0 group-hover:opacity-50 transition-opacity text-content-tertiary">
                    <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
                      <circle cx="1.5" cy="1.5" r="1" />
                      <circle cx="4.5" cy="1.5" r="1" />
                      <circle cx="1.5" cy="5" r="1" />
                      <circle cx="4.5" cy="5" r="1" />
                      <circle cx="1.5" cy="8.5" r="1" />
                      <circle cx="4.5" cy="8.5" r="1" />
                    </svg>
                  </div>
                </div>

                {/* Main content area */}
                <div className={`flex-1 min-w-0 pr-1.5 ${branches.length > 0 ? 'py-1.5' : 'py-2'}`}>
                  {/* Primary row: name + info icon + notification */}
                  <div className="flex items-center gap-1">
                    <span className={`text-[13px] font-medium truncate transition-colors ${
                      isSelected ? 'text-content-primary' : ''
                    }`}>
                      {project.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailProjectId(isDetailOpen ? null : project.id);
                      }}
                      className={`p-0.5 rounded flex items-center justify-center transition-all shrink-0 ${
                        isDetailOpen
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
                    {stats?.hasNotification && (
                      <span className="relative flex h-1.5 w-1.5 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-semantic-notification opacity-60" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-semantic-notification" />
                      </span>
                    )}
                  </div>

                  {/* Tertiary row: git branch chips */}
                  {branches.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {branches.map((b) => {
                        const canPush = b.ahead > 0;
                        const chipTitle = [
                          b.name,
                          b.dirtyFiles > 0 ? `${b.dirtyFiles} uncommitted file${b.dirtyFiles > 1 ? 's' : ''}` : '',
                          canPush ? `${b.ahead} commit${b.ahead > 1 ? 's' : ''} to push — click to push` : '',
                        ].filter(Boolean).join(' · ');

                        const ChipTag = canPush ? 'button' : 'span';

                        return (
                          <ChipTag
                            key={b.name}
                            {...(canPush ? {
                              onClick: (e: React.MouseEvent) => {
                                e.stopPropagation();
                                setPushConfirm({ projectId: project.id, branch: b.name });
                              },
                            } : {})}
                            title={chipTitle}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded border text-[9px] font-medium transition-colors ${
                              canPush
                                ? 'border-column-development/20 bg-column-development/6 text-column-development hover:bg-column-development/15 hover:border-column-development/40 cursor-pointer'
                                : 'border-semantic-warning/20 bg-semantic-warning/6 text-semantic-warning'
                            }`}
                          >
                            <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                              <circle cx="5" cy="4" r="2" />
                              <circle cx="5" cy="12" r="2" />
                              <circle cx="12" cy="6" r="2" />
                              <path d="M5 6v4M10.2 7.2C9 8.5 7 9 5 9" />
                            </svg>
                            <span className="truncate max-w-[56px]">{b.name}</span>
                            {b.dirtyFiles > 0 && (
                              <span className="tabular-nums opacity-80">{b.dirtyFiles}M</span>
                            )}
                            {canPush && (
                              <span className="tabular-nums">{b.ahead}&#8593;</span>
                            )}
                          </ChipTag>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Right side: job counters */}
                {totalJobs > 0 && (
                  <div className="shrink-0 flex items-center gap-1.5 pr-2">
                    {COLUMN_ORDER.map((col) => {
                      const count = stats!.counts[col];
                      if (count === 0) return null;
                      return (
                        <span key={col} className="flex items-center gap-0.5">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${COLUMN_DOT_CLASSES[col]}`} />
                          <span className="text-[10px] tabular-nums text-content-tertiary leading-none">{count}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          );
        })}
      </div>

      {/* Settings footer */}
      <div className="shrink-0 border-t border-chrome-subtle/70 px-4 py-2">
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 text-content-tertiary hover:text-content-secondary transition-colors"
          title="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="2.5" />
            <path d="M13.5 8a5.5 5.5 0 00-.08-.87l1.44-1.13a.34.34 0 00.08-.44l-1.37-2.36a.34.34 0 00-.42-.15l-1.7.68a5.3 5.3 0 00-1.5-.87L9.63 1.1a.34.34 0 00-.34-.28H6.56a.34.34 0 00-.34.28l-.25 1.8a5.3 5.3 0 00-1.5.87l-1.7-.68a.34.34 0 00-.42.15L.98 5.6a.34.34 0 00.08.44l1.44 1.13a5.5 5.5 0 000 1.74L1.06 10a.34.34 0 00-.08.44l1.37 2.36a.34.34 0 00.42.15l1.7-.68c.46.35.96.64 1.5.87l.25 1.8a.34.34 0 00.34.28h2.73a.34.34 0 00.34-.28l.25-1.8a5.3 5.3 0 001.5-.87l1.7.68a.34.34 0 00.42-.15l1.37-2.36a.34.34 0 00-.08-.44l-1.44-1.13c.05-.29.08-.58.08-.87z" />
          </svg>
          <span className="text-[11px]">Settings</span>
        </button>
      </div>

      {/* Settings dialog */}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

      {/* Push confirmation dialog */}
      {pushConfirm && createPortal(
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center"
          onClick={() => { if (!pushing) { setPushConfirm(null); setPushError(null); } }}
        >
          <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />
          <div
            className="relative rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl p-4 w-72 animate-[dialogIn_150ms_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-content-primary font-medium">Push to remote?</p>
            <p className="text-xs text-content-secondary mt-1.5">
              Push branch <span className="font-mono font-medium text-content-primary">{pushConfirm.branch}</span> to origin?
            </p>
            {pushError && (
              <p className="text-xs text-status-error mt-2 bg-status-error/10 rounded px-2 py-1.5 break-words">
                {pushError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => { setPushConfirm(null); setPushError(null); }}
                disabled={pushing}
                className="px-3 py-1 text-xs rounded text-content-tertiary hover:bg-surface-tertiary/70 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handlePush(pushConfirm.projectId, pushConfirm.branch)}
                disabled={pushing}
                className="px-3 py-1 text-xs font-medium rounded bg-column-development/15 text-column-development hover:bg-column-development/25 transition-colors disabled:opacity-50"
              >
                {pushing ? 'Pushing...' : 'Push'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

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
          />
        );
      })()}
    </div>
  );
}
