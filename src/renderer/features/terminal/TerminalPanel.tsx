import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useKanbanStore } from '../../hooks/useKanbanStore';
import { useModifierDigitShortcut } from '../../hooks/useModifierDigitShortcut';
import { ChevronDownIcon } from '../../components/Icons';
import { Kbd } from '../../components/Kbd';
import { getProjectColor } from '../../types/index';

import { AddTerminalPopover } from './AddTerminalPopover';
import { TerminalPane } from './TerminalPane';
import { SplitDivider } from './SplitDivider';
import { useTerminalStatuses } from './useTerminalInstance';
import { destroyInstance } from './terminalRegistry';

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 250;
const MAX_HEIGHT_RATIO = 0.6;

export function TerminalPanel() {
  const terminalTabs = useKanbanStore((s) => s.terminalTabs);
  const activeTerminalId = useKanbanStore((s) => s.activeTerminalId);
  const expanded = useKanbanStore((s) => s.terminalExpanded);
  const setExpanded = useKanbanStore((s) => s.setTerminalExpanded);
  const setActiveTerminal = useKanbanStore((s) => s.setActiveTerminal);
  const removeTerminalTab = useKanbanStore((s) => s.removeTerminalTab);
  const renameTerminalTab = useKanbanStore((s) => s.renameTerminalTab);

  const terminalSplit = useKanbanStore((s) => s.terminalSplit);
  const activeSplitPane = useKanbanStore((s) => s.activeSplitPane);
  const setTerminalSplit = useKanbanStore((s) => s.setTerminalSplit);
  const clearTerminalSplit = useKanbanStore((s) => s.clearTerminalSplit);
  const setTerminalSplitRatio = useKanbanStore((s) => s.setTerminalSplitRatio);
  const setActiveSplitPane = useKanbanStore((s) => s.setActiveSplitPane);
  const setActivePaneTab = useKanbanStore((s) => s.setActivePaneTab);
  const moveTabToPane = useKanbanStore((s) => s.moveTabToPane);
  const reorderPaneTabs = useKanbanStore((s) => s.reorderPaneTabs);

  const projects = useKanbanStore((s) => s.projects);
  const selectedProjectId = useKanbanStore((s) => s.selectedProjectId);

  const showAddPopover = useKanbanStore((s) => s.showAddTerminal);
  const setShowAddPopover = useKanbanStore((s) => s.setShowAddTerminal);

  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const splitContentRef = useRef<HTMLDivElement>(null);
  const [dropZone, setDropZone] = useState<'left' | 'right' | null>(null);
  const [addPaneTarget, setAddPaneTarget] = useState<'left' | 'right' | null>(null);

  const hasTabs = terminalTabs.length > 0;

  const statuses = useTerminalStatuses(terminalTabs.map((t) => t.id));

  const activeTab = useMemo(
    () => terminalTabs.find((t) => t.id === activeTerminalId),
    [terminalTabs, activeTerminalId],
  );
  const activeProjectId = activeTab?.projectId ?? terminalTabs[0]?.projectId ?? null;
  const projectColors = useMemo(
    () => new Map(projects.map((project) => [project.id, getProjectColor(project.color)])),
    [projects],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      destroyInstance(tabId);
      removeTerminalTab(tabId);
    },
    [removeTerminalTab],
  );

  // --- Drag-and-drop for creating splits ---

  const isTerminalDrag = useCallback((e: React.DragEvent) => {
    return e.dataTransfer.types.includes('application/terminal-tab-id');
  }, []);

  const handleContentDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isTerminalDrag(e)) return;
      // Only show drop zone when not already split
      if (terminalSplit) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
      setDropZone(side);
    },
    [isTerminalDrag, terminalSplit],
  );

  const handleContentDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropZone(null);
  }, []);

  const handleContentDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropZone(null);
      if (terminalSplit) return;
      const droppedTabId = e.dataTransfer.getData('application/terminal-tab-id');
      if (!droppedTabId) return;

      const allTabIds = terminalTabs.map((t) => t.id);
      if (allTabIds.length < 2) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';

      const otherTabIds = allTabIds.filter((id) => id !== droppedTabId);
      if (side === 'left') {
        setTerminalSplit([droppedTabId], otherTabIds);
      } else {
        setTerminalSplit(otherTabIds, [droppedTabId]);
      }
    },
    [terminalTabs, terminalSplit, setTerminalSplit],
  );

  // Handle tab dropped onto a pane's tab bar (move between panes)
  const handlePaneTabDrop = useCallback(
    (targetPane: 'left' | 'right') => (tabId: string) => {
      moveTabToPane(tabId, targetPane);
    },
    [moveTabToPane],
  );

  const handleToggleExpand = useCallback(() => {
    if (hasTabs) {
      setExpanded(!expanded);
      return;
    }

    // No terminals exist — open the "new terminal" modal directly
    setShowAddPopover(true);
  }, [expanded, setExpanded, hasTabs, setShowAddPopover]);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!expanded) return;
      e.preventDefault();
      dragging.current = true;
      const startY = e.clientY;
      const startHeight = height;
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = startY - ev.clientY;
        const newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, startHeight + delta));
        setHeight(newHeight);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [height, expanded],
  );

  const shortcutTabIds = useMemo(
    () => terminalSplit
      ? [...terminalSplit.leftTabIds, ...terminalSplit.rightTabIds]
      : terminalTabs.map((t) => t.id),
    [terminalTabs, terminalSplit],
  );

  // Keyboard shortcut: switch between tabs (mod+1..9) in the same visible order as the tab bars
  const switchTerminalTab = useCallback(
    (index: number) => {
      const tabId = shortcutTabIds[index - 1];
      if (!tabId) return;

      setActiveTerminal(tabId);
      if (!expanded) setExpanded(true);
    },
    [shortcutTabIds, setActiveTerminal, expanded, setExpanded],
  );
  useModifierDigitShortcut('switchTerminalTab', switchTerminalTab, { enabled: hasTabs });
  useEffect(() => window.electronAPI.onSwitchTerminalTab(switchTerminalTab), [switchTerminalTab]);

  const getProjectName = useCallback(
    (projectId: string) => projects.find((p) => p.id === projectId)?.name ?? 'Unknown',
    [projects],
  );

  const defaultAddProjectId = activeProjectId ?? selectedProjectId ?? projects[0]?.id ?? null;
  const showExpanded = expanded && hasTabs;


  // Compute tab IDs for each pane
  const singlePaneTabIds = useMemo(
    () => terminalTabs.map((t) => t.id),
    [terminalTabs],
  );

  const handleAddTerminal = useCallback(
    (pane: 'left' | 'right' | null) => {
      setAddPaneTarget(pane);
      setShowAddPopover(true);
    },
    [setShowAddPopover],
  );

  return (
    <div
      className="flex flex-col border-t border-chrome-subtle/70 shrink-0"
      style={{ height: showExpanded ? height : 'auto' }}
    >
      {/* Header — drag handle + project switcher + expand/collapse */}
      <div className="flex flex-col bg-surface-secondary shrink-0">
        {/* Drag handle — only when expanded */}
        {showExpanded && (
          <div
            className="h-1 cursor-row-resize hover:bg-accent/30 transition-colors shrink-0"
            onMouseDown={onDragStart}
          />
        )}

        {/* Header row */}
        <div
          className={`flex items-center justify-between px-2 py-1 select-none ${hasTabs || projects.length > 0 ? 'cursor-pointer' : ''}`}
          onClick={handleToggleExpand}
        >
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
            <TerminalIcon />
            {hasTabs ? (
              <>
                <span className="text-xs font-medium text-content-secondary truncate max-w-[200px]">
                  {activeTab?.name ?? 'Terminal'}
                </span>
                {activeTab && activeProjectId && (
                  <span className="text-[10px] text-content-tertiary truncate max-w-[100px]">
                    · {getProjectName(activeProjectId)}
                  </span>
                )}
                {terminalTabs.length > 1 && (
                  <span className="text-[10px] text-content-tertiary">
                    +{terminalTabs.length - 1}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-content-tertiary">Terminal<Kbd shortcutId="toggleTerminal" /></span>
            )}
          </div>

          {hasTabs && (
            <ChevronDownIcon
              size={14}
              className={`text-content-tertiary transition-transform duration-150 shrink-0 ${expanded ? '' : 'rotate-180'}`}
            />
          )}
        </div>
      </div>

      {/* Terminal content — pane-based rendering */}
      {hasTabs && (
        <div
          ref={splitContentRef}
          className={`flex-1 min-h-0 bg-terminal-surface relative ${showExpanded ? 'flex' : 'hidden'}`}
          onDragOver={handleContentDragOver}
          onDragLeave={handleContentDragLeave}
          onDrop={handleContentDrop}
        >
          {terminalSplit && showExpanded ? (
            <>
              {/* Left pane */}
              <div
                className="min-w-0 overflow-hidden relative flex flex-col"
                style={{ width: `${terminalSplit.dividerRatio * 100}%` }}
              >
                <TerminalPane
                  tabIds={terminalSplit.leftTabIds}
                  activeTabId={terminalSplit.activeLeftTabId}
                  allTabs={terminalTabs}
                  projectColors={projectColors}
                  statuses={statuses}
                  pane="left"
                  isActivePane={activeSplitPane === 'left'}
                  onPaneClick={() => setActiveSplitPane('left')}
                  onTabClick={(tabId) => setActivePaneTab('left', tabId)}
                  onTabClose={handleCloseTab}
                  onTabRename={renameTerminalTab}
                  onAddTerminal={() => handleAddTerminal('left')}
                  onTabDrop={handlePaneTabDrop('left')}
                  onReorder={(ids) => reorderPaneTabs('left', ids)}
                />
              </div>
              <SplitDivider
                containerRef={splitContentRef}
                onResize={setTerminalSplitRatio}
              />
              {/* Right pane */}
              <div
                className="min-w-0 overflow-hidden relative flex flex-col"
                style={{ width: `${(1 - terminalSplit.dividerRatio) * 100}%` }}
              >
                <TerminalPane
                  tabIds={terminalSplit.rightTabIds}
                  activeTabId={terminalSplit.activeRightTabId}
                  allTabs={terminalTabs}
                  projectColors={projectColors}
                  statuses={statuses}
                  pane="right"
                  isActivePane={activeSplitPane === 'right'}
                  onPaneClick={() => setActiveSplitPane('right')}
                  onTabClick={(tabId) => setActivePaneTab('right', tabId)}
                  onTabClose={handleCloseTab}
                  onTabRename={renameTerminalTab}
                  onAddTerminal={() => handleAddTerminal('right')}
                  onTabDrop={handlePaneTabDrop('right')}
                  onReorder={(ids) => reorderPaneTabs('right', ids)}
                />
              </div>
            </>
          ) : (
            /* Single pane — tabs attached to terminal */
            <TerminalPane
              tabIds={singlePaneTabIds}
              activeTabId={activeTerminalId ?? ''}
              allTabs={terminalTabs}
              projectColors={projectColors}
              statuses={statuses}
              pane="single"
              isActivePane={true}
              onPaneClick={() => {}}
              onTabClick={setActiveTerminal}
              onTabClose={handleCloseTab}
              onTabRename={renameTerminalTab}
              onAddTerminal={() => handleAddTerminal(null)}
              onTabDrop={undefined}
              onReorder={(ids) => reorderPaneTabs('single', ids)}
            />
          )}

          {/* Drop zone overlay — only for creating new splits */}
          {dropZone && !terminalSplit && (
            <div className="absolute inset-0 flex pointer-events-none z-20">
              <div
                className={`w-1/2 transition-colors duration-100 ${
                  dropZone === 'left' ? 'bg-accent/15 border-2 border-accent/40 rounded-l-md' : ''
                }`}
              />
              <div
                className={`w-1/2 transition-colors duration-100 ${
                  dropZone === 'right' ? 'bg-accent/15 border-2 border-accent/40 rounded-r-md' : ''
                }`}
              />
            </div>
          )}
        </div>
      )}

      {/* Add terminal popover */}
      {showAddPopover && (
        <AddTerminalPopover
          defaultProjectId={defaultAddProjectId}
          pane={addPaneTarget}
          onClose={() => { setShowAddPopover(false); setAddPaneTarget(null); }}
        />
      )}
    </div>
  );
}

function TerminalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-content-tertiary shrink-0"
    >
      <path d="M4 5l4 3-4 3" />
      <line x1="9" y1="12" x2="13" y2="12" />
    </svg>
  );
}
