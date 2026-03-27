import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from './Icons';
import { MarkdownRenderer } from './MarkdownRenderer';

interface WhatsNewDialogProps {
  version: string;
  content: string;
  onClose: () => void;
}

export function WhatsNewDialog({ version, content, onClose }: WhatsNewDialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />

      {/* Dialog */}
      <div
        className="relative w-[520px] rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl shadow-surface-overlay/20 overflow-hidden animate-[dialogIn_150ms_ease-out] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-content-primary">
            What&apos;s New in v{version}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/70 transition-colors"
            aria-label="Close"
          >
            <XIcon size={12} />
          </button>
        </div>

        <div className="border-t border-chrome-subtle/70" />

        {/* Content */}
        <div className="px-5 py-4 overflow-y-auto max-h-[60vh]">
          <MarkdownRenderer content={content} />
        </div>

        <div className="border-t border-chrome-subtle/70" />

        {/* Footer */}
        <div className="flex justify-end px-5 py-3">
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 rounded-md bg-btn-primary text-content-inverted font-medium hover:bg-btn-primary-hover transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
