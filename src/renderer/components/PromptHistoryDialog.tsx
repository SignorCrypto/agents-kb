import { useEffect, useRef } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { XIcon } from './Icons';
import { CopyButton } from './CopyButton';
import { ResponseSection } from './ResponseSection';

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
  const originalResponse = (followUps.length > 0 ? job.originalSummaryText : job.summaryText) || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-surface-overlay/60 backdrop-blur-[3px]"
        onClick={() => setPromptHistoryJobId(null)}
      />

      <div
        ref={dialogRef}
        className="relative bg-surface-elevated rounded-2xl shadow-2xl border border-chrome/40 w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        style={{ animation: 'dialogIn 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-chrome-subtle/30">
          <div className="min-w-0 pr-6">
            <h2 className="text-[13px] font-semibold text-content-primary truncate">
              {job.title || 'Conversation'}
            </h2>
            <p className="text-[10px] text-content-tertiary mt-0.5">
              {1 + followUps.length} {followUps.length === 0 ? 'turn' : 'turns'} &middot; {formatTimestamp(job.createdAt)}
            </p>
          </div>
          <button
            onClick={() => setPromptHistoryJobId(null)}
            className="absolute top-3 right-3.5 w-7 h-7 flex items-center justify-center rounded-lg text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/60 transition-colors"
          >
            <XIcon size={14} />
          </button>
        </div>

        {/* Chat thread */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Original */}
          <PromptBubble label="You" timestamp={formatTimestamp(job.createdAt)} text={job.prompt} />
          {originalResponse && <ResponseSection text={originalResponse} />}

          {/* Follow-ups */}
          {followUps.map((f, i) => (
            <div key={i} className="space-y-4 pt-3 border-t border-chrome-subtle/15">
              <PromptBubble
                label={f.title || `Follow-up #${i + 1}`}
                timestamp={formatTimestamp(f.timestamp)}
                text={f.prompt}
              />
              <ResponseSection
                text={f.summaryText || (i === followUps.length - 1 ? job.summaryText : '') || ''}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PromptBubble({ label, timestamp, text }: { label: string; timestamp: string; text: string }) {
  return (
    <div className="group flex gap-2.5 justify-end">
      <div className="flex-1 min-w-0 flex flex-col items-end">
        <div className="flex items-center gap-1.5 mb-1">
          <CopyButton text={text} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="text-[10px] font-semibold text-content-tertiary">{label}</span>
          <span className="text-[10px] text-content-tertiary/50">{timestamp}</span>
        </div>
        <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-btn-primary/10 border border-btn-primary/15 px-3.5 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-content-primary whitespace-pre-wrap break-words">
            {text}
          </p>
        </div>
      </div>

      {/* Avatar */}
      <div className="w-6 h-6 rounded-full bg-btn-primary flex items-center justify-center shrink-0 mt-0.5">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-content-inverted">
          <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z" />
        </svg>
      </div>
    </div>
  );
}
