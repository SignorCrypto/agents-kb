import { useEffect, useRef } from 'react';
import type { Skill } from '../types';

interface SlashCommandDropdownProps {
  matches: Skill[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
}

export function SlashCommandDropdown({ matches, selectedIndex, onSelect, onHover }: SlashCommandDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (matches.length === 0) {
    return (
      <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-elevated border border-chrome rounded-lg shadow-lg p-2">
        <span className="text-xs text-content-tertiary">No matching commands</span>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-elevated border border-chrome rounded-lg shadow-lg max-h-[240px] overflow-y-auto py-1"
    >
      {matches.map((skill, i) => (
        <button
          key={`${skill.source}:${skill.name}`}
          ref={(el) => { itemRefs.current[i] = el; }}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(i);
          }}
          onMouseEnter={() => onHover(i)}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors ${
            i === selectedIndex
              ? 'bg-focus-ring/10 text-content-primary'
              : 'text-content-primary hover:bg-surface-tertiary'
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-content-tertiary">
            <path d="M5 2L3 14" />
            <path d="M13 2L11 14" />
            <path d="M1 6h14" />
            <path d="M1 10h14" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono font-medium">/{skill.name}</span>
              {skill.source === 'project' && (
                <span className="text-[10px] text-content-tertiary bg-surface-tertiary px-1 rounded">project</span>
              )}
            </div>
            {skill.description && (
              <p className="text-[11px] text-content-tertiary truncate mt-0.5">{skill.description}</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
