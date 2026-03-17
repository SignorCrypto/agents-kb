import { useEffect, useRef } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { XIcon } from './Icons';
import { CopyButton } from './CopyButton';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${time}`;
  if (isYesterday) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

export function PromptHistoryDialog() {
  const promptHistoryJobId = useKanbanStore((s) => s.promptHistoryJobId);
  const setPromptHistoryJobId = useKanbanStore((s) => s.setPromptHistoryJobId);
  const jobs = useKanbanStore((s) => s.jobs);
  const dialogRef = useRef<HTMLDivElement>(null);

  const job = jobs.find((j) => j.id === promptHistoryJobId);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPromptHistoryJobId(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [setPromptHistoryJobId]);

  if (!job) return null;

  const followUps = job.followUps?.filter((f) => !f.rolledBack) || [];
  const totalEntries = 1 + followUps.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-surface-overlay/50 backdrop-blur-[2px]"
        onClick={() => setPromptHistoryJobId(null)}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="relative bg-surface-elevated rounded-xl shadow-2xl border border-chrome/50 w-full max-w-xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
        style={{ animation: 'dialogIn 0.18s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-chrome-subtle/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-surface-tertiary/80 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-content-secondary">
                <path d="M2 4h12M2 8h8M2 12h10" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-content-primary truncate">
                Prompt History
              </h2>
              <p className="text-[10px] text-content-tertiary mt-0.5">
                {totalEntries} {totalEntries === 1 ? 'prompt' : 'prompts'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setPromptHistoryJobId(null)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors"
          >
            <XIcon size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="relative">
            {/* Timeline line */}
            {followUps.length > 0 && (
              <div className="absolute left-[11px] top-6 bottom-4 w-px bg-chrome-subtle/60" />
            )}

            {/* Original prompt */}
            <div className="relative flex gap-3.5 pb-5">
              {/* Timeline dot */}
              <div className="relative z-10 mt-1.5 shrink-0">
                <div className="w-[23px] h-[23px] rounded-full bg-btn-primary flex items-center justify-center shadow-sm">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-content-inverted">
                    <path d="M4 8h8M8 4v8" />
                  </svg>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-content-tertiary">
                    Original
                  </span>
                  <span className="text-[10px] text-content-tertiary/60">
                    {formatTimestamp(job.createdAt)}
                  </span>
                  <CopyButton text={job.prompt} className="ml-auto -my-1" />
                </div>
                {job.title && (
                  <div className="text-[13px] font-semibold text-content-primary leading-snug mb-1">
                    {job.title}
                  </div>
                )}
                <div className="text-[12.5px] leading-relaxed text-content-secondary whitespace-pre-wrap break-words bg-surface-tertiary/30 rounded-lg px-3 py-2.5 border border-chrome-subtle/30">
                  {job.prompt}
                </div>
              </div>
            </div>

            {/* Follow-ups */}
            {followUps.map((f, i) => (
              <div key={i} className="relative flex gap-3.5 pb-5 last:pb-0">
                {/* Timeline dot */}
                <div className="relative z-10 mt-1.5 shrink-0">
                  <div className="w-[23px] h-[23px] rounded-full bg-surface-elevated border-2 border-chrome flex items-center justify-center">
                    <span className="text-[9px] font-bold text-content-tertiary tabular-nums">
                      {i + 1}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-content-tertiary">
                      Follow-up #{i + 1}
                    </span>
                    <span className="text-[10px] text-content-tertiary/60">
                      {formatTimestamp(f.timestamp)}
                    </span>
                    <CopyButton text={f.prompt} className="ml-auto -my-1" />
                  </div>
                  {f.title && (
                    <div className="text-[13px] font-semibold text-content-primary leading-snug mb-1">
                      {f.title}
                    </div>
                  )}
                  <div className="text-[12.5px] leading-relaxed text-content-secondary whitespace-pre-wrap break-words bg-surface-tertiary/30 rounded-lg px-3 py-2.5 border border-chrome-subtle/30">
                    {f.prompt}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
