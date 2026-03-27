import { useState, useCallback } from 'react';
import type { TerminalTab } from '../../types/index';
import { TerminalTabItem } from './TerminalTabItem';
import { Kbd, KbdDigit } from '../../components/Kbd';

interface PaneTabBarProps {
  tabs: TerminalTab[];
  projectColors: Map<string, string>;
  activeTabId: string;
  statuses: Map<string, { isReady: boolean; exitCode: number | null }>;
  pane: 'left' | 'right' | 'single';
  isActivePane: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabRename: (tabId: string, name: string) => void;
  onAddTerminal: () => void;
  onTabDrop?: (tabId: string) => void;
  onReorder?: (orderedTabIds: string[]) => void;
}

export function PaneTabBar({
  tabs,
  projectColors,
  activeTabId,
  statuses,
  pane,
  isActivePane,
  onTabClick,
  onTabClose,
  onTabRename,
  onAddTerminal,
  onTabDrop,
  onReorder,
}: PaneTabBarProps) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/terminal-tab-id')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropIndex(null);
      const droppedTabId = e.dataTransfer.getData('application/terminal-tab-id');
      if (!droppedTabId) return;

      // Check if this is a reorder within the same pane
      const isOwnTab = tabs.some((t) => t.id === droppedTabId);
      if (isOwnTab && onReorder && dropIndex !== null) {
        const currentIndex = tabs.findIndex((t) => t.id === droppedTabId);
        if (currentIndex === -1 || currentIndex === dropIndex) return;
        const ids = tabs.map((t) => t.id);
        ids.splice(currentIndex, 1);
        ids.splice(dropIndex, 0, droppedTabId);
        onReorder(ids);
        return;
      }

      // Cross-pane drop
      if (!isOwnTab) {
        onTabDrop?.(droppedTabId);
      }
    },
    [tabs, onTabDrop, onReorder, dropIndex],
  );

  const handleTabDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      if (!e.dataTransfer.types.includes('application/terminal-tab-id')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      // Determine if drop should be before or after this tab
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      setDropIndex(e.clientX < midX ? index : index + 1);
    },
    [],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropIndex(null);
  }, []);

  const isSplit = pane !== 'single';

  return (
    <div
      className={`
        flex items-center gap-0.5 px-1.5 py-0.5 shrink-0 select-none overflow-x-auto overflow-y-hidden
        border-b transition-colors duration-100
        ${isSplit && isActivePane
          ? 'bg-surface-secondary/60 border-accent/30'
          : 'bg-surface-secondary/40 border-chrome-subtle/50'
        }
      `}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      {tabs.map((tab, idx) => {
        const status = statuses.get(tab.id);
        return (
          <div
            key={tab.id}
            className="relative flex items-center min-w-0 shrink-0"
            onDragOver={(e) => handleTabDragOver(e, idx)}
          >
            {/* Drop indicator before this tab */}
            {dropIndex === idx && (
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full -translate-x-0.5 z-10" />
            )}
            <TerminalTabItem
              tabId={tab.id}
              name={tab.name}
              projectColor={projectColors.get(tab.projectId)}
              isActive={tab.id === activeTabId}
              isReady={status?.isReady ?? false}
              exitCode={status?.exitCode ?? null}
              onClick={() => onTabClick(tab.id)}
              onClose={() => onTabClose(tab.id)}
              onRename={(newName) => onTabRename(tab.id, newName)}
              hint={!isSplit && idx < 9 ? <KbdDigit shortcutId="switchTerminalTab" digit={idx + 1} /> : undefined}
            />
            {/* Drop indicator after last tab */}
            {idx === tabs.length - 1 && dropIndex === tabs.length && (
              <div className="absolute right-0 top-1 bottom-1 w-0.5 bg-accent rounded-full translate-x-0.5 z-10" />
            )}
          </div>
        );
      })}

      {/* Add terminal button */}
      <button
        onClick={(e) => { e.stopPropagation(); onAddTerminal(); }}
        className="w-5 h-5 flex items-center justify-center rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors shrink-0"
        title="New terminal"
      >
        <PlusIcon />
        {!isSplit && <Kbd shortcutId="newTerminal" />}
      </button>

    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="2" x2="6" y2="10" />
      <line x1="2" y1="6" x2="10" y2="6" />
    </svg>
  );
}
