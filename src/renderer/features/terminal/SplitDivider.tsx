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
      className="w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors shrink-0"
      onMouseDown={onMouseDown}
    />
  );
}
