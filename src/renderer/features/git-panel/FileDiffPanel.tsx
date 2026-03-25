import { useEffect, useRef, useCallback } from 'react';
import { LazyFileSection } from './LazyFileSection';
import type { ChangedFile } from '../../types/index';

interface FileDiffPanelProps {
  changedFiles: ChangedFile[];
  allDiffs: Map<string, string>;
  loadingDiffs: boolean;
  selectedFile: string | null;
  scrollToFile: { path: string; key: number } | null;
  onVisibleFileChange: (filePath: string) => void;
  fetchDiffForFile: (file: ChangedFile) => void;
}

export function FileDiffPanel({
  changedFiles,
  allDiffs,
  loadingDiffs,
  selectedFile,
  scrollToFile,
  onVisibleFileChange,
  fetchDiffForFile,
}: FileDiffPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isScrollingToRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Callback ref for file sections
  const setSectionRef = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) {
      sectionRefs.current.set(path, el);
    } else {
      sectionRefs.current.delete(path);
    }
  }, []);

  // IntersectionObserver for scroll-sync (scroll right panel -> highlight left panel)
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

  // scrollIntoView when scrollToFile changes (click left panel -> scroll right)
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
        {changedFiles.map((file) => (
          <LazyFileSection
            key={file.path}
            file={file}
            rawDiff={allDiffs.get(file.path)}
            onFetchDiff={fetchDiffForFile}
            onSectionRef={setSectionRef}
            scrollRoot={scrollContainerRef}
          />
        ))}
      </div>
    </div>
  );
}
