import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { NotificationBadge } from './NotificationBadge';
import { formatDuration, useNow } from '../utils/duration';
import type { Job, KanbanColumn, JobStatus, FollowUp } from '../types/index';

interface JobCardProps {
  job: Job;
}

const statusLabels: Record<JobStatus, string> = {
  'running': 'Running',
  'waiting-input': 'Needs Input',
  'plan-ready': 'Plan Ready',
  'completed': 'Done',
  'error': 'Error',
  'accepted': 'Accepted',
  'rejected': 'Rejected',
};

const statusColors: Record<JobStatus, string> = {
  'running': 'text-status-running',
  'waiting-input': 'text-status-waiting',
  'plan-ready': 'text-status-plan-ready',
  'completed': 'text-status-completed',
  'error': 'text-status-error',
  'accepted': 'text-status-completed',
  'rejected': 'text-status-error',
};

const columnAccent: Record<KanbanColumn, string> = {
  planning: 'border-l-column-planning',
  development: 'border-l-column-development',
  done: 'border-l-column-done',
};

export const JobCard = memo(function JobCard({ job }: JobCardProps) {
  const selectJob = useKanbanStore((s) => s.selectJob);
  const selectedJobId = useKanbanStore((s) => s.selectedJobId);
  const projects = useKanbanStore((s) => s.projects);
  const project = projects.find((p) => p.id === job.projectId);
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);
  const isActive = job.status === 'running' || job.status === 'waiting-input';
  const now = useNow(isActive ? 1000 : 0);

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;

    const check = () => setIsClamped(el.scrollHeight > el.clientHeight);
    check();

    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [job.prompt, expanded]);

  const isSelected = selectedJobId === job.id;
  const needsAttention = job.status === 'waiting-input' || job.status === 'plan-ready';

  const handleClick = useCallback(() => {
    selectJob(isSelected ? null : job.id);
  }, [selectJob, isSelected, job.id]);

  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(prev => !prev);
  }, []);

  return (
    <div
      className={`
        w-full text-left rounded-lg border-l-2 transition-all cursor-pointer
        ${columnAccent[job.column]}
        ${isSelected
          ? 'bg-selected-bg ring-1 ring-selected-border'
          : 'bg-surface-elevated hover:bg-surface-tertiary/40'
        }
      `}
      onClick={handleClick}
    >
      <div className="px-3 py-2.5">
        {/* Top row: project + branch + status */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {project && (
              <span className="text-[9px] font-semibold text-content-tertiary uppercase tracking-[0.08em] truncate">
                {project.name}
              </span>
            )}
            {job.branch && (
              <span className="flex items-center gap-0.5 text-[9px] font-medium text-content-tertiary bg-surface-tertiary/60 rounded px-1 py-px max-w-[100px]">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <line x1="6" y1="3" x2="6" y2="13" />
                  <circle cx="6" cy="3" r="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7c0 3-2 4-6 6" />
                </svg>
                <span className="truncate">{job.branch}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            {job.status === 'running' && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-active-ping opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-active-indicator" />
              </span>
            )}
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${statusColors[job.status]}`}>
              {statusLabels[job.status]}
            </span>
            {needsAttention && <NotificationBadge />}
          </div>
        </div>

        {/* Prompt timeline */}
        {job.followUps && job.followUps.length > 0 ? (
          <CardTimeline prompt={job.prompt} followUps={job.followUps} expanded={expanded} promptRef={promptRef} />
        ) : (
          <div
            ref={promptRef}
            className={`text-[13px] leading-snug font-medium text-content-primary whitespace-pre-wrap break-words ${
              expanded ? '' : 'line-clamp-2'
            }`}
          >
            {job.prompt}
          </div>
        )}

        {/* Expand/collapse */}
        {(isClamped || expanded) && (
          <button
            onClick={toggleExpanded}
            className="text-[10px] text-interactive-link hover:text-interactive-link-hover mt-0.5"
          >
            {expanded ? 'Less' : 'More'}
          </button>
        )}

        {/* Phase timers */}
        <PhaseDurations job={job} now={now} />
      </div>
    </div>
  );
});

function getEffectivePausedMs(job: Job, now: number): number {
  let paused = job.totalPausedMs || 0;
  if (job.status === 'waiting-input' && job.waitingStartedAt) {
    paused += now - new Date(job.waitingStartedAt).getTime();
  }
  return paused;
}

function PhaseDurations({ job, now }: { job: Job; now: number }) {
  const pausedMs = getEffectivePausedMs(job, now);
  const phases: { label: string; value: string; dotColor: string; active: boolean }[] = [];

  if (job.planningStartedAt) {
    const isLive = job.column === 'planning' && !job.planningEndedAt;
    const end = job.planningEndedAt ? new Date(job.planningEndedAt).getTime() : (job.column === 'planning' ? now : null);
    const phasePaused = job.column === 'planning' ? pausedMs : (job.totalPausedMs || 0);
    if (end) {
      phases.push({
        label: 'PLN',
        value: formatDuration(new Date(job.planningStartedAt).getTime(), end, phasePaused),
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
        dotColor: 'bg-column-development',
        active: isLive,
      });
    }
  }

  if (phases.length === 0) return null;

  return (
    <div className="flex items-center gap-3 mt-2 pt-1.5 border-t border-chrome-subtle/40">
      {phases.map((p) => (
        <div key={p.label} className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            {p.active && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${p.dotColor} opacity-50`} />
            )}
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${p.dotColor}`} />
          </span>
          <span className="text-[9px] font-bold tracking-[0.1em] text-content-tertiary uppercase">
            {p.label}
          </span>
          <span className="text-[11px] font-mono font-semibold text-content-secondary tabular-nums leading-none">
            {p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function CardTimeline({
  prompt,
  followUps,
  expanded,
  promptRef,
}: {
  prompt: string;
  followUps: FollowUp[];
  expanded: boolean;
  promptRef: React.RefObject<HTMLDivElement | null>;
}) {
  const totalSteps = 1 + followUps.length;
  const activeStep = totalSteps; // latest follow-up is the current step

  return (
    <div ref={promptRef} className={expanded ? '' : ''}>
      {/* Step indicators row */}
      <div className="flex items-center gap-0.5 mb-1.5">
        {Array.from({ length: totalSteps }, (_, i) => {
          const stepNum = i + 1;
          const isCurrent = stepNum === activeStep;
          return (
            <div key={i} className="flex items-center gap-0.5">
              <div
                className={`w-[14px] h-[14px] rounded-full flex items-center justify-center text-[8px] font-bold leading-none ${
                  isCurrent
                    ? 'bg-column-development text-content-inverted'
                    : 'bg-column-done/20 text-column-done'
                }`}
              >
                {isCurrent ? stepNum : (
                  <svg width="7" height="7" viewBox="0 0 7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1.5 3.5l1.5 1.5 3-3" />
                  </svg>
                )}
              </div>
              {i < totalSteps - 1 && (
                <div className="w-2 h-px bg-chrome-subtle/70" />
              )}
            </div>
          );
        })}
        <span className="text-[9px] text-content-tertiary ml-1">
          Step {activeStep}/{totalSteps}
        </span>
      </div>

      {/* Show all steps when expanded, only current when collapsed */}
      {expanded ? (
        <div className="space-y-1">
          <div className="flex items-start gap-1.5">
            <span className="text-[9px] font-bold text-content-tertiary uppercase shrink-0 mt-[2px] w-6">1.</span>
            <span className="text-[12px] leading-snug text-content-secondary line-clamp-1">{prompt}</span>
          </div>
          {followUps.map((f, i) => {
            const isCurrent = i === followUps.length - 1;
            return (
              <div key={i} className="flex items-start gap-1.5">
                <span className={`text-[9px] font-bold uppercase shrink-0 mt-[2px] w-6 ${
                  isCurrent ? 'text-column-development' : 'text-content-tertiary'
                }`}>{i + 2}.</span>
                <span className={`text-[12px] leading-snug ${
                  isCurrent
                    ? 'font-medium text-content-primary'
                    : 'text-content-secondary line-clamp-1'
                }`}>{f.prompt}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-[13px] leading-snug font-medium text-content-primary whitespace-pre-wrap break-words line-clamp-2">
          {followUps[followUps.length - 1].prompt}
        </div>
      )}
    </div>
  );
}
