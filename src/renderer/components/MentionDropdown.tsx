import { useEffect, useRef } from 'react';

interface MentionDropdownProps {
  matches: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
}

export function MentionDropdown({ matches, selectedIndex, onSelect, onHover }: MentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (matches.length === 0) {
    return (
      <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-elevated border border-chrome rounded-lg shadow-lg p-2">
        <span className="text-xs text-content-tertiary">No matching files</span>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-elevated border border-chrome rounded-lg shadow-lg max-h-[240px] overflow-y-auto py-1"
    >
      {matches.map((filePath, i) => {
        const parts = filePath.split('/');
        const fileName = parts.pop() || filePath;
        const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';
        const shortDir = parts.length > 3
          ? '.../' + parts.slice(-3).join('/') + '/'
          : dirPath;

        return (
          <button
            key={filePath}
            ref={(el) => { itemRefs.current[i] = el; }}
            onMouseDown={(e) => {
              e.preventDefault(); // prevent input blur
              onSelect(i);
            }}
            onMouseEnter={() => onHover(i)}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
              i === selectedIndex
                ? 'bg-focus-ring/10 text-content-primary'
                : 'text-content-primary hover:bg-surface-tertiary'
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-content-tertiary">
              <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" />
              <path d="M9 2v4h4" />
            </svg>
            <span className="text-xs font-mono truncate min-w-0">
              <span className="text-content-tertiary">{shortDir}</span>
              <span className="font-medium">{fileName}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
