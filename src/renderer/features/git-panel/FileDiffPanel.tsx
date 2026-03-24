import { useMemo, useEffect, useRef, useCallback } from 'react';
import { parseDiff, FileSection } from '../../components/DiffViewer';
import type { ChangedFile } from '../../types/index';

interface FileDiffPanelProps {
  changedFiles: ChangedFile[];
  allDiffs: Map<string, string>;
  loadingDiffs: boolean;
  selectedFile: string | null;
  scrollToFile: { path: string; key: number } | null;
  onVisibleFileChange: (filePath: string) => void;
}

export function FileDiffPanel({
  changedFiles,
  allDiffs,
  loadingDiffs,
  selectedFile,
  scrollToFile,
  onVisibleFileChange,
}: FileDiffPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isScrollingToRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Memoize parsed diffs so parseDiff isn't called on every render
  const parsedDiffs = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseDiff>>();
    for (const [path, raw] of allDiffs) {
      map.set(path, parseDiff(raw));
    }
    return map;
  }, [allDiffs]);

  // Callback ref for file sections
  const setSectionRef = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) {
      sectionRefs.current.set(path, el);
    } else {
      sectionRefs.current.delete(path);
    }
  }, []);

  // IntersectionObserver for scroll-sync (scroll right panel → highlight left panel)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || changedFiles.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingToRef.current) return;

        // Find the topmost intersecting entry
        let topEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
              topEntry = entry;
            }
          }
        }

        if (topEntry) {
          const filePath = (topEntry.target as HTMLElement).dataset.filePath;
          if (filePath) {
            onVisibleFileChange(filePath);
          }
        }
      },
      {
        root: container,
        rootMargin: '0px 0px -70% 0px',
        threshold: 0,
      },
    );

    // Observe all file section divs
    for (const el of sectionRefs.current.values()) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [changedFiles, onVisibleFileChange, allDiffs]);

  // scrollIntoView when scrollToFile changes (click left panel → scroll right)
  useEffect(() => {
    if (!scrollToFile) return;

    const el = sectionRefs.current.get(scrollToFile.path);
    if (!el) return;

    isScrollingToRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Clear the guard after scroll animation completes
    clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingToRef.current = false;
    }, 500);
  }, [scrollToFile]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => clearTimeout(scrollTimeoutRef.current);
  }, []);

  // Empty state
  if (changedFiles.length === 0 && !loadingDiffs) {
    return (
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex items-center justify-center h-full text-content-tertiary">
          <div className="text-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" className="mx-auto mb-2 opacity-30">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <p className="text-[11px]">No changed files</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0">
      <div className="p-3 space-y-1.5">
        {changedFiles.map((file) => {
          const diff = allDiffs.get(file.path);
          const files = parsedDiffs.get(file.path);
          const hasDiff = diff !== undefined;

          return (
            <div
              key={file.path}
              data-file-path={file.path}
              ref={(el) => setSectionRef(file.path, el)}
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
                  {/* Skeleton diff lines — stabilize layout height */}
                  <div className="px-3 py-2 space-y-1.5">
                    <div className="h-2.5 w-[60%] rounded bg-surface-tertiary/50 animate-pulse" />
                    <div className="h-2.5 w-[80%] rounded bg-surface-tertiary/40 animate-pulse" style={{ animationDelay: '75ms' }} />
                    <div className="h-2.5 w-[45%] rounded bg-surface-tertiary/30 animate-pulse" style={{ animationDelay: '150ms' }} />
                    <div className="h-2.5 w-[70%] rounded bg-surface-tertiary/40 animate-pulse" style={{ animationDelay: '225ms' }} />
                  </div>
                </div>
              ) : files && files.length > 0 ? (
                // Render all parsed sections for this file
                files.map((f, i) => <FileSection key={i} file={f} />)
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
        })}
      </div>
    </div>
  );
}
