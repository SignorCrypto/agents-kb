import { PlanMarkdown } from './PlanMarkdown';
import { CopyButton } from './CopyButton';
import { BotIcon } from './Icons';

export function ResponseSection({ text }: { text: string }) {
  if (!text) return null;

  return (
    <div className="group/resp flex gap-2.5">
      {/* Avatar */}
      <div className="w-6 h-6 rounded-full bg-surface-tertiary flex items-center justify-center shrink-0 mt-0.5">
        <BotIcon size={13} className="text-content-tertiary" />
      </div>

      {/* Bubble */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] font-semibold text-content-tertiary">Agent</span>
          <CopyButton text={text} className="opacity-0 group-hover/resp:opacity-100 transition-opacity" />
        </div>
        <div className="rounded-xl rounded-tl-sm bg-surface-tertiary/30 border border-chrome-subtle/25 px-3.5 py-2.5">
          <div className="text-[12px] leading-[1.7] text-content-secondary">
            <PlanMarkdown content={text} />
          </div>
        </div>
      </div>
    </div>
  );
}
