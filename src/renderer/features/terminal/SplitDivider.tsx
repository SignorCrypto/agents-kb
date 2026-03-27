import { useCallback, type RefObject } from 'react';

interface SplitDividerProps {
  containerRef: RefObject<HTMLElement | null>;
  onResize: (ratio: number) => void;
}

export function SplitDivider({ containerRef, onResize }: SplitDividerProps) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const onMouseMove = (ev: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const ratio = (ev.clientX - rect.left) / rect.width;
        onResize(Math.max(0.2, Math.min(0.8, ratio)));
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [containerRef, onResize],
  );

  return (
    <div
      className="relative w-0 shrink-0 cursor-col-resize group"
      onMouseDown={onMouseDown}
    >
      {/* Visible border line */}
      <div className="absolute inset-y-0 -left-px w-px bg-chrome-subtle/70 group-hover:bg-accent/60 group-active:bg-accent/80 transition-colors" />
      {/* Wider invisible drag target */}
      <div className="absolute inset-y-0 -left-1.5 w-3" />
    </div>
  );
}
