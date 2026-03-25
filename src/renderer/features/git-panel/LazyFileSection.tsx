import { memo, useEffect, useRef, useMemo } from 'react';
import { parseDiff, FileSection } from '../../components/DiffViewer';
import type { ChangedFile } from '../../types/index';

/** Buffer above/below the viewport to pre-fetch diffs before they scroll into view */
const FETCH_MARGIN = '400px 0px 400px 0px';

interface LazyFileSectionProps {
  file: ChangedFile;
  rawDiff: string | undefined;
  onFetchDiff: (file: ChangedFile) => void;
  onSectionRef: (path: string, el: HTMLDivElement | null) => void;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
}

export const LazyFileSection = memo(
  function LazyFileSection({
    file,
    rawDiff,
    onFetchDiff,
    onSectionRef,
    scrollRoot,
  }: LazyFileSectionProps) {
    const elRef = useRef<HTMLDivElement | null>(null);

    // Register with parent's sectionRefs for scroll-sync
    const setRef = (el: HTMLDivElement | null) => {
      elRef.current = el;
      onSectionRef(file.path, el);
    };

    // IntersectionObserver to trigger lazy fetch when approaching viewport
    useEffect(() => {
      const el = elRef.current;
      const root = scrollRoot.current;
      if (!el || !root) return;

      // Already loaded — no need to observe for fetching
      if (rawDiff !== undefined) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            onFetchDiff(file);
            observer.disconnect();
          }
        },
        { root, rootMargin: FETCH_MARGIN, threshold: 0 },
      );

      observer.observe(el);
      return () => observer.disconnect();
    }, [file, rawDiff, onFetchDiff, scrollRoot]);

    // Per-file parsing — only this file re-parses when its diff arrives
    const parsedFiles = useMemo(
      () => (rawDiff ? parseDiff(rawDiff) : null),
      [rawDiff],
    );

    const hasDiff = rawDiff !== undefined;

    return (
      <div
        data-file-path={file.path}
        ref={setRef}
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }}
      >
        {!hasDiff ? (
          // Per-file skeleton — fixed height prevents layout shift when diff loads
          <div className="border border-chrome-subtle/50 rounded-md overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-2 bg-surface-tertiary/60">
              <svg className="animate-spin h-3 w-3 shrink-0 text-content-tertiary" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="text-[11px] font-mono text-content-tertiary truncate">{file.path}</span>
            </div>
            <div className="px-3 py-2 space-y-1.5">
              <div className="h-2.5 w-[60%] rounded bg-surface-tertiary/50 animate-pulse" />
              <div className="h-2.5 w-[80%] rounded bg-surface-tertiary/40 animate-pulse" style={{ animationDelay: '75ms' }} />
              <div className="h-2.5 w-[45%] rounded bg-surface-tertiary/30 animate-pulse" style={{ animationDelay: '150ms' }} />
              <div className="h-2.5 w-[70%] rounded bg-surface-tertiary/40 animate-pulse" style={{ animationDelay: '225ms' }} />
            </div>
          </div>
        ) : parsedFiles && parsedFiles.length > 0 ? (
          parsedFiles.map((f, i) => <FileSection key={i} file={f} />)
        ) : (
          // No changes to display for this file
          <div className="border border-chrome-subtle/50 rounded-md overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-2 bg-surface-tertiary/60">
              <span className="text-[11px] font-mono text-content-tertiary truncate">{file.path}</span>
              <span className="text-[10px] text-content-tertiary ml-auto">No changes</span>
            </div>
          </div>
        )}
      </div>
    );
  },
  // Custom comparator: only re-render when rawDiff reference or file path changes
  (prev, next) =>
    prev.file.path === next.file.path && prev.rawDiff === next.rawDiff,
);
