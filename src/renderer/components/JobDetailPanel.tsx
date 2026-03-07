import { useState, useRef, useMemo } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { useJobOutput } from '../hooks/useJobOutput';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { useShortcut } from '../hooks/useShortcut';
import { Kbd } from './Kbd';
import { StreamingLog } from './StreamingLog';
import { DiffViewer } from './DiffViewer';
import { AcceptJobDialog } from './AcceptJobDialog';
import { formatDuration, useNow } from '../utils/duration';
import type { Job, FollowUp, GitSnapshot, AppSettings, OutputEntry } from '../types/index';
import { MODEL_CATALOG, EFFORT_CATALOG } from '../types/index';
import { BrainIcon, BranchIcon } from './Icons';
import { PlanMarkdown } from './PlanMarkdown';

export function JobDetailPanel() {
  const selectedJobId = useKanbanStore((s) => s.selectedJobId);
  const jobs = useKanbanStore((s) => s.jobs);
  const projects = useKanbanStore((s) => s.projects);
  const selectJob = useKanbanStore((s) => s.selectJob);
  const removeJob = useKanbanStore((s) => s.removeJob);
  const api = useElectronAPI();
  const [responseText, setResponseText] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [editText, setEditText] = useState('');
  const [followUpText, setFollowUpText] = useState('');
  const [doneTab, setDoneTab] = useState<'summary' | 'diff' | 'log'>('summary');
  const [showLog, setShowLog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAcceptDialog, setShowAcceptDialog] = useState(false);

  const job = jobs.find((j) => j.id === selectedJobId);
  const outputLog = useJobOutput(selectedJobId || '');
  const liveEditedFiles = useMemo(() => extractEditedFiles(outputLog), [outputLog]);
  // Use persisted editedFiles (survives restart), fall back to live extraction from output log
  const editedFiles = useMemo(() => {
    if (job?.editedFiles && job.editedFiles.length > 0) {
      return job.editedFiles.map((p) => ({ path: p, tool: 'Edit' }));
    }
    return liveEditedFiles;
  }, [job?.editedFiles, liveEditedFiles]);
  const isActive = job?.status === 'running' || job?.status === 'waiting-input';
  const now = useNow(isActive ? 1000 : 0);

  if (!job) return null;

  const project = projects.find((p) => p.id === job.projectId);
  const settings = useKanbanStore((s) => s.settings);

  const handleRespond = async () => {
    const isMulti = job?.pendingQuestion?.multiSelect;
    const text = isMulti && selectedOptions.size > 0
      ? Array.from(selectedOptions).join(', ')
      : responseText.trim();
    if (!text) return;
    await api.jobsRespond(job.id, text);
    setResponseText('');
    setSelectedOptions(new Set());
  };

  const handleAcceptPlan = async () => {
    await api.jobsAcceptPlan(job.id);
  };

  const handleEditPlan = async () => {
    if (!editText.trim()) return;
    const updated = await api.jobsEditPlan(job.id, editText.trim());
    if (updated) {
      useKanbanStore.getState().updateJob(updated);
    }
    setEditText('');
  };

  const handleFollowUp = async () => {
    if (!followUpText.trim()) return;
    const updated = await api.jobsFollowUp(job.id, followUpText.trim());
    if (updated) {
      useKanbanStore.getState().updateJob(updated);
    }
    setFollowUpText('');
  };

  const handleAcceptJob = () => {
    setShowAcceptDialog(true);
  };

  const handleRejectJob = async (snapshotIndex?: number) => {
    const snapshots = job.gitSnapshots || [];
    const target = snapshotIndex != null ? snapshots[snapshotIndex] : snapshots[0];
    const label = target?.label || 'original state';
    const confirmed = window.confirm(
      `Roll back to "${label}"? This will undo all file changes made after that point. This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await api.jobsRejectJob(job.id, snapshotIndex);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reject job';
      window.alert(message);
    }
  };

  const handleCancel = async () => {
    await api.jobsCancel(job.id);
  };

  const handleDelete = async () => {
    await api.jobsDelete(job.id);
    removeJob(job.id);
    setConfirmDelete(false);
  };

  const handleRetry = async () => {
    const updated = await api.jobsRetry(job.id);
    if (updated) {
      useKanbanStore.getState().updateJob(updated);
    }
  };

  const hasPlan = !!job.planText && !job.planText.trim().startsWith('{');
  const isDone = job.status === 'completed' || job.status === 'accepted' || job.status === 'rejected';
  const hasSummary = !!job.summaryText && isDone;
  const hasSnapshots = (job.gitSnapshots?.length ?? 0) > 0;
  const hasDiff = isDone && (hasSnapshots || !!job.diffText);
  const canDelete = job.status !== 'running' && job.status !== 'waiting-input';

  return (
    <div className="w-[480px] shrink-0 border-l border-chrome-subtle/70 bg-surface-secondary flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-chrome-subtle/70">
        {/* Top row: project/branch + action icons */}
        <div className="flex items-center justify-between px-4 pt-2.5">
          <div className="flex items-center gap-2 text-[10px] text-content-tertiary uppercase tracking-wider min-w-0">
            <span>{project?.name || 'Unknown'}</span>
            {job.branch && (
              <span className="flex items-center gap-1 normal-case tracking-normal text-[11px] font-medium text-content-secondary bg-surface-tertiary/60 rounded px-1.5 py-0.5 max-w-[180px]">
                <BranchIcon size={12} className="shrink-0" />
                <span className="truncate">{job.branch}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
          {/* Accept — for completed jobs on git repos */}
          {job.status === 'completed' && project?.isGitRepo !== false && (
            <button
              onClick={handleAcceptJob}
              className="p-1.5 text-semantic-success/70 hover:text-semantic-success hover:bg-semantic-success/10 transition-colors rounded"
              aria-label="Accept changes"
              title="Accept changes"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3.5 3.5L13 5" />
              </svg>
            </button>
          )}

          {/* Cancel — inline for active jobs */}
          {isActive && (
            <button
              onClick={handleCancel}
              className="p-1.5 text-semantic-error/70 hover:text-semantic-error hover:bg-semantic-error-bg/10 transition-colors rounded"
              aria-label="Cancel job"
              title="Cancel job"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M6 6l4 4M10 6l-4 4" />
              </svg>
            </button>
          )}

          {/* Delete */}
          {canDelete && (
            <div className="relative">
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-1.5 text-content-tertiary hover:text-semantic-error transition-colors rounded"
                aria-label="Delete job"
                title="Delete job"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1" />
                  <path d="M4.5 4l.5 9a1 1 0 001 1h4a1 1 0 001-1l.5-9" />
                  <line x1="6.5" y1="7" x2="6.5" y2="11" />
                  <line x1="9.5" y1="7" x2="9.5" y2="11" />
                </svg>
              </button>

              {/* Delete confirmation popover */}
              {confirmDelete && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setConfirmDelete(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-surface-elevated border border-chrome rounded-lg shadow-lg p-3 w-[200px]">
                    <p className="text-xs text-content-secondary mb-2">Delete this job permanently?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 px-2 py-1.5 text-xs rounded border border-chrome text-content-secondary hover:bg-surface-tertiary transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDelete}
                        className="flex-1 px-2 py-1.5 text-xs rounded bg-semantic-error text-white hover:bg-semantic-error/80 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Close */}
          <button
            onClick={() => selectJob(null)}
            className="p-1.5 text-content-tertiary hover:text-content-secondary transition-colors rounded"
            aria-label="Close panel"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
          </div>
        </div>

        {/* Timeline + durations — full width */}
        <div className="px-4 pb-2.5">
          <PromptTimeline
            prompt={job.prompt}
            jobTitle={job.title}
            followUps={job.followUps}
            snapshots={job.status === 'completed' ? job.gitSnapshots : undefined}
            onRollback={job.status === 'completed' ? handleRejectJob : undefined}
          />
        </div>
      </div>

      {/* Plan view when plan is ready */}
      {hasPlan && job.status === 'plan-ready' && !showLog && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="text-[10px] font-semibold text-semantic-success uppercase tracking-wider">Plan Ready</span>
            <button
              onClick={() => setShowLog(true)}
              className="text-[10px] text-content-secondary hover:text-content-primary transition-colors"
            >
              Show full log
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <PlanView content={job.planText!} />
          </div>
        </div>
      )}

      {/* Done-state tabbed view (summary / diff / steps / log) */}
      {isDone && (hasSummary || hasDiff) && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tab bar */}
          <div className="flex items-center gap-0 px-3 pt-1.5 border-b border-chrome-subtle/40">
            {hasSummary && (
              <TabButton active={doneTab === 'summary'} onClick={() => setDoneTab('summary')}>
                Summary
              </TabButton>
            )}
            {hasDiff && (
              <TabButton active={doneTab === 'diff'} onClick={() => setDoneTab('diff')}>
                Diff
              </TabButton>
            )}
            <TabButton active={doneTab === 'log'} onClick={() => setDoneTab('log')}>
              Log
            </TabButton>
          </div>

          {/* Tab content */}
          {doneTab === 'summary' && hasSummary && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <EditedFilesList files={editedFiles} />
              <PlanView content={job.summaryText!} />
            </div>
          )}
          {doneTab === 'diff' && hasDiff && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <DiffViewer jobId={job.id} />
            </div>
          )}
          {doneTab === 'log' && (
            <div className="flex-1 min-h-0 p-3 flex flex-col">
              <StreamingLog entries={outputLog} />
            </div>
          )}
        </div>
      )}

      {/* Done state without summary or diff — show edited files + log */}
      {isDone && !hasSummary && !hasDiff && (
        <div className="flex-1 min-h-0 p-3 flex flex-col">
          <EditedFilesList files={editedFiles} />
          <StreamingLog entries={outputLog} />
        </div>
      )}

      {/* Streaming log for non-done, non-plan states */}
      {!isDone && (!hasPlan || job.status !== 'plan-ready' || showLog) && (
        <div className="flex-1 min-h-0 p-3 flex flex-col">
          {hasPlan && showLog && (
            <div className="flex justify-end mb-1">
              <button
                onClick={() => setShowLog(false)}
                className="text-[10px] text-content-secondary hover:text-content-primary transition-colors"
              >
                Show plan
              </button>
            </div>
          )}
          <StreamingLog entries={outputLog} />
        </div>
      )}

      {/* Action area */}
      <ActionArea
        job={job}
        responseText={responseText}
        setResponseText={setResponseText}
        selectedOptions={selectedOptions}
        setSelectedOptions={setSelectedOptions}
        editText={editText}
        setEditText={setEditText}
        followUpText={followUpText}
        setFollowUpText={setFollowUpText}
        onRespond={handleRespond}
        onAcceptPlan={handleAcceptPlan}
        onEditPlan={handleEditPlan}
        onFollowUp={handleFollowUp}
        onRetry={handleRetry}
      />

      {/* Phase durations — bottom footer */}
      <DetailPhaseDurations job={job} now={now} settings={settings} />

      {/* Accept dialog */}
      {showAcceptDialog && (
        <AcceptJobDialog
          jobId={job.id}
          initialMessage={job.generatedCommitMessage}
          onClose={() => setShowAcceptDialog(false)}
          onAccepted={() => setShowAcceptDialog(false)}
        />
      )}
    </div>
  );
}

/* ─── Action Area ─── */

interface ActionAreaProps {
  job: Job;
  responseText: string;
  setResponseText: (v: string) => void;
  selectedOptions: Set<string>;
  setSelectedOptions: React.Dispatch<React.SetStateAction<Set<string>>>;
  editText: string;
  setEditText: (v: string) => void;
  followUpText: string;
  setFollowUpText: (v: string) => void;
  onRespond: () => void;
  onAcceptPlan: () => void;
  onEditPlan: () => void;
  onFollowUp: () => void;
  onRetry: () => void;
}

function ActionArea({
  job, responseText, setResponseText, selectedOptions, setSelectedOptions,
  editText, setEditText, followUpText, setFollowUpText,
  onRespond, onAcceptPlan, onEditPlan, onFollowUp, onRetry,
}: ActionAreaProps) {
  const followUpRef = useRef<HTMLDivElement>(null);
  useShortcut('submitForm', onFollowUp, {
    ref: followUpRef,
    enabled: job.status === 'completed' && !!followUpText.trim(),
  });

  // No action area needed for accepted/rejected states — show inline banner instead
  if (job.status === 'accepted') {
    return (
      <div className="shrink-0 px-3 py-2 border-t border-chrome-subtle/70">
        <div className="text-xs text-semantic-success bg-semantic-success/10 rounded-md px-3 py-2 text-center">
          Changes accepted
        </div>
      </div>
    );
  }

  if (job.status === 'rejected') {
    return (
      <div className="shrink-0 px-3 py-2 border-t border-chrome-subtle/70">
        <div className="text-xs text-semantic-error bg-semantic-error-bg/20 rounded-md px-3 py-2 text-center">
          Changes rolled back
        </div>
      </div>
    );
  }

  // Running jobs — no bottom actions (cancel is in header now)
  if (job.status === 'running') return null;

  return (
    <div className="shrink-0 px-3 py-2.5 border-t border-chrome-subtle/70 space-y-2">
      {/* Pending question */}
      {job.status === 'waiting-input' && job.pendingQuestion && (
        <div className="space-y-2">
          {job.pendingQuestion.header && (
            <div className="text-[10px] font-semibold text-content-tertiary uppercase tracking-wider">
              {job.pendingQuestion.header}
            </div>
          )}
          <div className="text-sm font-medium text-semantic-warning">
            {job.pendingQuestion.text}
          </div>
          {job.pendingQuestion.options && (
            <div className="flex flex-col gap-1">
              {job.pendingQuestion.options.map((opt, i) => {
                const isMulti = job.pendingQuestion!.multiSelect;
                const isSelected = isMulti
                  ? selectedOptions.has(opt.label)
                  : responseText === opt.label;

                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (isMulti) {
                        setSelectedOptions((prev) => {
                          const next = new Set(prev);
                          if (next.has(opt.label)) next.delete(opt.label);
                          else next.add(opt.label);
                          return next;
                        });
                      } else {
                        setResponseText(opt.label);
                      }
                    }}
                    className={`text-left px-2.5 py-1.5 rounded border transition-colors ${
                      isSelected
                        ? 'border-focus-ring bg-focus-ring/10'
                        : 'border-chrome hover:bg-surface-tertiary'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isMulti && (
                        <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${
                          isSelected ? 'border-focus-ring bg-focus-ring' : 'border-content-tertiary'
                        }`}>
                          {isSelected && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 5l2.5 2.5L8 3" />
                            </svg>
                          )}
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-medium text-content-primary">{opt.label}</div>
                        {opt.description && (
                          <div className="text-[10px] text-content-tertiary mt-0.5">{opt.description}</div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={job.pendingQuestion?.multiSelect && selectedOptions.size > 0
                ? Array.from(selectedOptions).join(', ')
                : responseText}
              onChange={(e) => {
                if (!job.pendingQuestion?.multiSelect) {
                  setResponseText(e.target.value);
                }
              }}
              onKeyDown={(e) => e.key === 'Enter' && onRespond()}
              placeholder={job.pendingQuestion?.multiSelect ? 'Select options above...' : 'Type your response...'}
              readOnly={!!job.pendingQuestion?.multiSelect && selectedOptions.size > 0}
              className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
            />
            <button
              onClick={onRespond}
              disabled={job.pendingQuestion?.multiSelect
                ? selectedOptions.size === 0
                : !responseText.trim()}
              className="px-4 py-1.5 text-sm rounded-lg bg-btn-primary text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Plan ready — edit + accept */}
      {job.status === 'plan-ready' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onEditPlan()}
              placeholder="Edit plan: e.g. 'also add tests'..."
              className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
            />
            <button
              onClick={onEditPlan}
              disabled={!editText.trim()}
              className="px-3 py-1.5 text-sm rounded-lg bg-btn-secondary text-content-inverted hover:bg-btn-secondary-hover disabled:opacity-40 transition-colors"
            >
              Edit
            </button>
          </div>
          <button
            onClick={onAcceptPlan}
            className="w-full py-2 rounded-lg bg-btn-primary text-content-inverted text-sm font-medium hover:bg-btn-primary-hover transition-colors"
          >
            Accept Plan & Start Development
          </button>
        </div>
      )}

      {/* Completed — follow-up input */}
      {job.status === 'completed' && (
        <div ref={followUpRef} className="flex gap-2">
          <input
            type="text"
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onFollowUp()}
            placeholder="Follow up: e.g. 'also add tests'..."
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
          />
          <button
            onClick={onFollowUp}
            disabled={!followUpText.trim()}
            className="px-4 py-1.5 text-sm rounded-lg bg-btn-primary text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
          >
            Follow Up<Kbd shortcutId="submitForm" />
          </button>
        </div>
      )}

      {/* Error state */}
      {job.status === 'error' && (
        <div className="space-y-2">
          <div className="text-xs text-semantic-error bg-semantic-error-bg/20 rounded-md px-3 py-2">
            {job.error || 'An error occurred'}
          </div>
          <button
            onClick={onRetry}
            className="w-full py-2 rounded-lg bg-btn-primary text-content-inverted text-sm font-medium hover:bg-btn-primary-hover transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Tab Button ─── */

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${
        active
          ? 'border-content-primary text-content-primary'
          : 'border-transparent text-content-tertiary hover:text-content-secondary'
      }`}
    >
      {children}
    </button>
  );
}

/* ─── Phase Durations ─── */

function DetailPhaseDurations({ job, now, settings }: { job: Job; now: number; settings: AppSettings }) {
  let pausedMs = job.totalPausedMs || 0;
  if (job.status === 'waiting-input' && job.waitingStartedAt) {
    pausedMs += now - new Date(job.waitingStartedAt).getTime();
  }

  const phases: { label: string; value: string; accentColor: string; dotColor: string; active: boolean }[] = [];

  if (job.planningStartedAt) {
    const isLive = job.column === 'planning' && !job.planningEndedAt;
    const end = job.planningEndedAt ? new Date(job.planningEndedAt).getTime() : (job.column === 'planning' ? now : null);
    const phasePaused = job.column === 'planning' ? pausedMs : (job.totalPausedMs || 0);
    if (end) {
      phases.push({
        label: 'PLN',
        value: formatDuration(new Date(job.planningStartedAt).getTime(), end, phasePaused),
        accentColor: 'border-l-column-planning',
        dotColor: 'bg-column-planning',
        active: isLive,
      });
    }
  }

  if (job.developmentStartedAt) {
    const isLive = job.column === 'development' && !job.completedAt;
    const end = job.completedAt ? new Date(job.completedAt).getTime() : (job.column === 'development' ? now : null);
    const phasePaused = job.column === 'development' ? pausedMs : (job.totalPausedMs || 0);
    if (end) {
      phases.push({
        label: 'DEV',
        value: formatDuration(new Date(job.developmentStartedAt).getTime(), end, phasePaused),
        accentColor: 'border-l-column-development',
        dotColor: 'bg-column-development',
        active: isLive,
      });
    }
  }

  // Model/effort badges
  const effectiveModel = job.model || settings.defaultModel;
  const effectiveEffort = job.effort || settings.defaultEffort;
  const showBadges = settings.alwaysShowModelEffort
    || effectiveModel !== settings.defaultModel
    || effectiveEffort !== settings.defaultEffort;
  const modelEntry = MODEL_CATALOG.find((o) => o.value === effectiveModel);
  const effortEntry = EFFORT_CATALOG.find((o) => o.value === effectiveEffort);
  const modelLabel = modelEntry?.label && effectiveModel !== 'default'
    ? modelEntry.label
    : (settings.alwaysShowModelEffort ? 'Default' : '');
  const effortLabel = effortEntry?.label && effectiveEffort !== settings.defaultEffort
    ? effortEntry.label
    : (settings.alwaysShowModelEffort ? 'Default' : '');

  if (phases.length === 0 && !showBadges) return null;

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-1.5 border-t border-chrome-subtle/40 bg-surface-secondary">
      {phases.map((p) => (
        <div key={p.label} className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dotColor}`} />
          <span className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider">
            {p.label}
          </span>
          <span className="text-[11px] font-mono text-content-secondary tabular-nums">
            {p.value}
          </span>
          {p.active && (
            <span className="relative flex h-1.5 w-1.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${p.dotColor} opacity-50`} />
              <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${p.dotColor}`} />
            </span>
          )}
        </div>
      ))}
      {showBadges && (modelLabel || effortLabel) && (
        <div className="flex items-center gap-2.5 ml-auto">
          {modelLabel && (
            <span className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider" title={`Model: ${modelLabel}`}>
              {modelLabel}
            </span>
          )}
          {effortLabel && (
            <span className="flex items-center gap-1 text-content-tertiary" title={`Effort: ${effortLabel}`}>
              <BrainIcon size={11} className="shrink-0 opacity-60" />
              <span className="text-[10px] font-medium uppercase tracking-wider">{effortLabel}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Plan View ─── */

function PlanView({ content }: { content: string }) {
  return <PlanMarkdown content={content} />;
}

/* ─── Prompt Timeline ─── */

function PromptTimeline({
  prompt,
  jobTitle,
  followUps,
  snapshots,
  onRollback,
}: {
  prompt: string;
  jobTitle?: string;
  followUps?: FollowUp[];
  snapshots?: GitSnapshot[];
  onRollback?: (index: number) => void;
}) {
  const hasFollowUps = followUps && followUps.length > 0;
  const canRollback = snapshots && snapshots.length > 0 && onRollback;

  // Simple case: no follow-ups and no rollback
  if (!hasFollowUps && !canRollback) {
    return <div className="text-sm font-medium truncate">{jobTitle || prompt}</div>;
  }

  const steps = [
    { label: prompt, title: jobTitle, isOriginal: true },
    ...(followUps || []).map((f) => ({ label: f.prompt, title: f.title, isOriginal: false })),
  ];

  return (
    <div className="mt-1 space-y-0">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        // Snapshot at this index means we can roll back to before this step
        const snapshot = canRollback && snapshots[i] ? snapshots[i] : null;

        return (
          <div key={i} className="flex items-start gap-2 relative group/step">
            {/* Dot + connector */}
            <div className="flex flex-col items-center shrink-0 w-4">
              <div className={`w-[5px] h-[5px] rounded-full mt-[7px] shrink-0 bg-column-done`} />
              {!isLast && (
                <div className="w-px flex-1 min-h-[8px] bg-chrome-subtle/70" />
              )}
            </div>

            {/* Step content */}
            <div className="pb-1.5 min-w-0 flex-1">
              <span className={`text-[10px] uppercase tracking-wider font-semibold mr-1.5 ${
                step.isOriginal ? 'text-content-tertiary' : 'text-column-development'
              }`}>
                {step.isOriginal ? 'Task' : `Follow-up #${i}`}
              </span>
              <span className={`text-sm leading-snug ${
                isLast ? 'font-medium text-content-primary' : 'text-content-secondary'
              }`}>
                {step.title || step.label}
              </span>
              {step.title && (
                <div className="text-content-tertiary text-xs mt-0.5 truncate">{step.label}</div>
              )}
            </div>

            {/* Rollback icon */}
            {snapshot && onRollback && (
              <button
                onClick={() => onRollback(i)}
                className="shrink-0 mt-1 p-1 rounded text-content-tertiary/40 hover:text-semantic-error hover:bg-semantic-error-bg/10 opacity-0 group-hover/step:opacity-100 transition-all"
                title={`Roll back to "${snapshot.label}"`}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 6h5M4.5 3.5L2 6l2.5 2.5M10 3v6" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Edited Files ─── */

interface EditedFile {
  path: string;
  tool: string; // 'Write' | 'Edit' | etc.
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

function extractEditedFiles(entries: OutputEntry[]): EditedFile[] {
  const seen = new Map<string, string>(); // path -> tool
  let currentTool = '';
  let toolBuffer = '';

  const flush = () => {
    if (FILE_TOOLS.has(currentTool) && toolBuffer) {
      try {
        const parsed = JSON.parse(toolBuffer);
        const filePath = (parsed.file_path || parsed.notebook_path) as string | undefined;
        if (filePath && !seen.has(filePath)) {
          seen.set(filePath, currentTool);
        }
      } catch { /* incomplete JSON */ }
    }
    currentTool = '';
    toolBuffer = '';
  };

  for (const entry of entries) {
    if (entry.type === 'tool-use') {
      if (entry.toolName && entry.content === '') {
        // New tool block start — flush previous
        flush();
        currentTool = entry.toolName;
      } else if (entry.toolName && entry.content) {
        // Full tool-use entry (old format)
        flush();
        currentTool = entry.toolName;
        toolBuffer = entry.content;
        flush();
      } else {
        // Delta — append
        toolBuffer += entry.content;
      }
    } else {
      flush();
    }
  }
  flush();

  return Array.from(seen.entries()).map(([path, tool]) => ({ path, tool }));
}

function EditedFilesList({ files }: { files: EditedFile[] }) {
  if (files.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="text-[10px] font-semibold text-content-tertiary uppercase tracking-wider mb-1.5">
        {files.length} file{files.length !== 1 ? 's' : ''} touched
      </div>
      <div className="space-y-px">
        {files.map((file) => {
          const parts = file.path.split('/');
          const fileName = parts.pop() || file.path;
          const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';
          // Shorten long dir paths to last 3 segments
          const shortDir = parts.length > 3
            ? '.../' + parts.slice(-3).join('/') + '/'
            : dirPath;

          return (
            <div
              key={file.path}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-tertiary/40 transition-colors group"
            >
              {/* File icon */}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-content-tertiary">
                <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" />
                <path d="M9 2v4h4" />
              </svg>
              {/* Path */}
              <span className="text-[11px] font-mono truncate min-w-0">
                <span className="text-content-tertiary">{shortDir}</span>
                <span className="text-content-primary font-medium">{fileName}</span>
              </span>
              {/* Tool badge */}
              <span className="shrink-0 text-[9px] font-medium text-content-tertiary/60 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                {file.tool === 'Write' ? 'new' : 'edit'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
