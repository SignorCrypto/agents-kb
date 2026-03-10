import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { NotificationBadge } from './NotificationBadge';
import { formatDuration, useNow } from '../utils/duration';
import type { Job, JobStatus, FollowUp } from '../types/index';
import { MODEL_CATALOG, EFFORT_CATALOG, getProjectColor } from '../types/index';
import { BrainIcon } from './Icons';

interface JobCardProps {
  job: Job;
}

const statusLabels: Record<JobStatus, string> = {
  'running': 'Running',
  'waiting-input': 'Needs Input',
  'plan-ready': 'Plan Ready',
  'completed': 'Done',
  'error': 'Error',
  'rejected': 'Rejected',
};

const statusColors: Record<JobStatus, string> = {
  'running': 'text-status-running',
  'waiting-input': 'text-status-waiting',
  'plan-ready': 'text-status-plan-ready',
  'completed': 'text-status-completed',
  'error': 'text-status-error',
  'rejected': 'text-status-error',
};

export const JobCard = memo(function JobCard({ job }: JobCardProps) {
  const selectJob = useKanbanStore((s) => s.selectJob);
  const selectedJobId = useKanbanStore((s) => s.selectedJobId);
  const projects = useKanbanStore((s) => s.projects);
  const project = projects.find((p) => p.id === job.projectId);
  const projectColor = getProjectColor(project?.color);
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
  }, [job.prompt, job.title, expanded]);

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
        w-full text-left rounded-lg border-l-[3px] transition-all cursor-pointer
        ${isSelected
          ? 'bg-selected-bg ring-1 ring-selected-border'
          : 'bg-surface-elevated hover:bg-surface-tertiary/40'
        }
      `}
      style={{ borderLeftColor: projectColor }}
      onClick={handleClick}
    >
      <div className="px-3 py-2.5">
        {/* Top row: project + branch + status */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {project && (
              <span className="flex items-center gap-1 min-w-0">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: projectColor }}
                />
                <span className="text-[9px] font-semibold text-content-tertiary uppercase tracking-[0.08em] truncate">
                  {project.name}
                </span>
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
          <CardTimeline prompt={job.prompt} jobTitle={job.title} followUps={job.followUps} expanded={expanded} promptRef={promptRef} isActive={isActive} />
        ) : (
          <div ref={promptRef}>
            {job.title ? (
              <>
                <div className={`text-[13px] leading-snug font-semibold text-content-primary ${expanded ? '' : 'line-clamp-2'}`}>
                  {job.title}
                </div>
                {expanded && (
                  <div className="text-[12px] leading-snug text-content-tertiary mt-1 whitespace-pre-wrap break-words">
                    {job.prompt}
                  </div>
                )}
              </>
            ) : (
              <div className={`text-[13px] leading-snug font-medium text-content-primary whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-2'}`}>
                {job.prompt}
              </div>
            )}
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
  if ((job.status === 'waiting-input' || job.status === 'plan-ready') && job.waitingStartedAt) {
    paused += now - new Date(job.waitingStartedAt).getTime();
  }
  return paused;
}

function getBadge(catalog: { value: string; badge: string }[], value: string): string {
  return catalog.find((o) => o.value === value)?.badge || '';
}

function PhaseDurations({ job, now }: { job: Job; now: number }) {
  const settings = useKanbanStore((s) => s.settings);
  const pausedMs = getEffectivePausedMs(job, now);
  const phases: { label: string; value: string; dotColor: string; active: boolean }[] = [];

  if (job.planningStartedAt) {
    const isLive = job.column === 'planning' && !job.planningEndedAt && job.status !== 'plan-ready';
    const end = job.planningEndedAt ? new Date(job.planningEndedAt).getTime() : (job.column === 'planning' ? now : null);
    const phasePaused = job.column === 'planning' ? pausedMs : (job.totalPausedMs || 0);
    if (end) {
      phases.push({
        label: 'PLN',
        value: formatDuration(new Date(job.planningStartedAt).getTime() - (job.planningElapsedMs || 0), end, phasePaused),
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
        value: formatDuration(new Date(job.developmentStartedAt).getTime() - (job.developmentElapsedMs || 0), end, phasePaused),
        dotColor: 'bg-column-development',
        active: isLive,
      });
    }
  }

  // Determine model/effort badges
  const effectiveModel = job.model || settings.defaultModel;
  const effectiveEffort = job.effort || settings.defaultEffort;
  const showBadges = settings.alwaysShowModelEffort
    || effectiveModel !== settings.defaultModel
    || effectiveEffort !== settings.defaultEffort;
  const modelLabel = getBadge(MODEL_CATALOG, effectiveModel) || (settings.alwaysShowModelEffort ? 'DEFAULT' : '');
  const effortLabel = getBadge(EFFORT_CATALOG, effectiveEffort) || (settings.alwaysShowModelEffort ? 'DEFAULT' : '');

  if (phases.length === 0 && !showBadges) return null;

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
      {showBadges && (modelLabel || effortLabel) && (
        <div className="flex items-center gap-2 ml-auto">
          {modelLabel && (
            <span className="text-[9px] font-bold tracking-[0.08em] text-content-tertiary uppercase" title={`Model: ${modelLabel}`}>
              {modelLabel}
            </span>
          )}
          {effortLabel && (
            <span className="flex items-center gap-1 text-content-tertiary" title={`Effort: ${effortLabel}`}>
              <BrainIcon size={10} className="shrink-0 opacity-60" />
              <span className="text-[9px] font-bold tracking-[0.08em] uppercase">{effortLabel}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CardTimeline({
  prompt,
  jobTitle,
  followUps,
  expanded,
  promptRef,
  isActive,
}: {
  prompt: string;
  jobTitle?: string;
  followUps: FollowUp[];
  expanded: boolean;
  promptRef: React.RefObject<HTMLDivElement | null>;
  isActive: boolean;
}) {
  return (
    <div ref={promptRef}>
      {/* Original title — styled identically to non-followup cards */}
      {jobTitle ? (
        <div className={`text-[13px] leading-snug font-semibold text-content-primary ${expanded ? '' : 'line-clamp-2'}`}>
          {jobTitle}
        </div>
      ) : (
        <div className={`text-[13px] leading-snug font-medium text-content-primary whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-2'}`}>
          {prompt}
        </div>
      )}
      {expanded && jobTitle && (
        <div className="text-[12px] leading-snug text-content-tertiary mt-0.5 whitespace-pre-wrap break-words">
          {prompt}
        </div>
      )}

      {/* Follow-ups */}
      <div className="mt-1.5 pt-1.5 border-t border-chrome-subtle/30 space-y-0.5">
        {followUps.map((f, i) => {
          const isLast = i === followUps.length - 1;
          const isCurrent = isLast && isActive;
          return (
            <div key={i} className={`flex items-center gap-1.5 text-[11px] leading-snug ${isCurrent ? 'text-content-primary' : 'text-content-secondary'}`}>
              {isCurrent ? (
                <svg width="10" height="10" viewBox="0 0 16 16" className="shrink-0 animate-spin text-content-tertiary">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="28 10" strokeLinecap="round" />
                </svg>
              ) : (
                <span className="text-content-tertiary/60 shrink-0 text-[10px] w-[10px] text-center">+</span>
              )}
              <span className={`truncate ${isCurrent ? 'font-medium' : ''}`}>{f.title || f.prompt}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
