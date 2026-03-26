import { useState, useCallback, useRef, useMemo } from 'react';
import { useKanbanStore } from '../../hooks/useKanbanStore';
import { useModifierDigitShortcut } from '../../hooks/useModifierDigitShortcut';
import { ChevronDownIcon } from '../../components/Icons';
import { Kbd, KbdDigit } from '../../components/Kbd';

import { TerminalTabItem } from './TerminalTabItem';
import { AddTerminalPopover } from './AddTerminalPopover';
import { TerminalView } from './TerminalView';
import { useTerminalStatuses } from './useTerminalInstance';
import { destroyInstance } from './terminalRegistry';
import { getProjectColor } from '../../../shared/types';

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

  const projects = useKanbanStore((s) => s.projects);
  const selectedProjectId = useKanbanStore((s) => s.selectedProjectId);

  const showAddPopover = useKanbanStore((s) => s.showAddTerminal);
  const setShowAddPopover = useKanbanStore((s) => s.setShowAddTerminal);

  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);

  const hasTabs = terminalTabs.length > 0;

  // Track per-tab ready/exit status from the registry
  const statuses = useTerminalStatuses(terminalTabs.map((t) => t.id));

  // Group tabs by project
  const projectGroups = useMemo(() => {
    const grouped = new Map<string, typeof terminalTabs>();
    for (const tab of terminalTabs) {
      const list = grouped.get(tab.projectId) ?? [];
      list.push(tab);
      grouped.set(tab.projectId, list);
    }
    return grouped;
  }, [terminalTabs]);

  const projectIds = useMemo(() => [...projectGroups.keys()], [projectGroups]);
  const multiProject = projectIds.length > 1;

  // Active tab and its project
  const activeTab = useMemo(
    () => terminalTabs.find((t) => t.id === activeTerminalId),
    [terminalTabs, activeTerminalId],
  );
  const activeProjectId = activeTab?.projectId ?? projectIds[0] ?? null;

  // Tabs for the active project group
  const activeProjectTabs = useMemo(
    () => (activeProjectId ? projectGroups.get(activeProjectId) ?? [] : []),
    [activeProjectId, projectGroups],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      destroyInstance(tabId);
      removeTerminalTab(tabId);
    },
    [removeTerminalTab],
  );

  const handleToggleExpand = useCallback(() => {
    if (hasTabs) setExpanded(!expanded);
  }, [expanded, setExpanded, hasTabs]);

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

  // Switch to a project group
  const handleProjectClick = useCallback(
    (projectId: string) => {
      const tabs = projectGroups.get(projectId);
      if (tabs?.length) {
        setActiveTerminal(tabs[0].id);
      }
    },
    [projectGroups, setActiveTerminal],
  );

  // Keyboard shortcut: switch between project groups (mod+1..9)
  const switchTerminalProject = useCallback(
    (index: number) => {
      const targetProjectId = projectIds[index - 1];
      if (!targetProjectId) return;
      const tabs = projectGroups.get(targetProjectId);
      if (tabs?.length) {
        setActiveTerminal(tabs[0].id);
        if (!expanded) setExpanded(true);
      }
    },
    [projectIds, projectGroups, setActiveTerminal, expanded, setExpanded],
  );
  useModifierDigitShortcut('switchTerminalProject', switchTerminalProject, { enabled: hasTabs });

  // Keyboard shortcut: switch between tabs in active project (mod+shift+1..9)
  const switchTerminalTab = useCallback(
    (index: number) => {
      const tab = activeProjectTabs[index - 1];
      if (tab) {
        setActiveTerminal(tab.id);
        if (!expanded) setExpanded(true);
      }
    },
    [activeProjectTabs, setActiveTerminal, expanded, setExpanded],
  );
  useModifierDigitShortcut('switchTerminalTab', switchTerminalTab, { enabled: hasTabs });

  const getProjectName = useCallback(
    (projectId: string) => projects.find((p) => p.id === projectId)?.name ?? 'Unknown',
    [projects],
  );

  const getProjectColorHex = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      return getProjectColor(project?.color);
    },
    [projects],
  );

  // Default project for the add popover
  const defaultAddProjectId = activeProjectId ?? selectedProjectId ?? projects[0]?.id ?? null;

  const showExpanded = expanded && hasTabs;

  return (
    <div
      className="flex flex-col border-t border-chrome-subtle/70 shrink-0"
      style={{ height: showExpanded ? height : 'auto' }}
    >
      {/* Header */}
      <div className="flex flex-col bg-surface-secondary shrink-0">
        {/* Drag handle — only when expanded */}
        {showExpanded && (
          <div
            className="h-1 cursor-row-resize hover:bg-accent/30 transition-colors shrink-0"
            onMouseDown={onDragStart}
          />
        )}
        {/* Multi-project row — chevron, project tabs, +, and close-all on same row */}
        {multiProject && showExpanded && (
          <div
            className={`flex items-center justify-between px-2 pt-1.5 pb-0.5 select-none ${hasTabs ? 'cursor-pointer' : ''}`}
            onClick={handleToggleExpand}
          >
            <div className="flex items-center gap-0.5 min-w-0">
              {projectIds.map((pid, idx) => {
                const isActiveGroup = pid === activeProjectId;
                const color = getProjectColorHex(pid);
                return (
                  <button
                    key={pid}
                    onClick={(e) => { e.stopPropagation(); handleProjectClick(pid); }}
                    className={`
                      flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium
                      transition-colors duration-100 select-none
                      ${isActiveGroup
                        ? 'bg-surface-tertiary/80 text-content-primary'
                        : 'text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary/40'
                      }
                    `}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate max-w-[100px]">{getProjectName(pid)}</span>
                    <span className="text-[10px] text-content-tertiary">
                      {projectGroups.get(pid)?.length ?? 0}
                    </span>
                    {idx < 9 && <KbdDigit shortcutId="switchTerminalProject" digit={idx + 1} />}
                  </button>
                );
              })}
              {/* Add button */}
              <button
                onClick={(e) => { e.stopPropagation(); setShowAddPopover(true); }}
                className="w-5 h-5 flex items-center justify-center rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors shrink-0"
                title="New terminal"
              >
                <PlusIcon />
                <Kbd shortcutId="newTerminal" />
              </button>
              {showAddPopover && (
                <AddTerminalPopover
                  defaultProjectId={defaultAddProjectId}
                  onClose={() => setShowAddPopover(false)}
                />
              )}
            </div>
            {hasTabs && (
              <ChevronDownIcon
                size={14}
                className={`text-content-tertiary transition-transform duration-150 shrink-0 ${expanded ? '' : 'rotate-180'}`}
              />
            )}
          </div>
        )}

        {/* Terminal tabs row (no chevron/+/X when multi-project, they're above) */}
        {multiProject && showExpanded ? (
          <div className="flex items-center gap-1 px-2 py-1 min-w-0 overflow-x-auto select-none">
            {activeProjectTabs.map((tab, idx) => {
              const status = statuses.get(tab.id);
              return (
                <TerminalTabItem
                  key={tab.id}
                  name={tab.name}
                  isActive={tab.id === activeTerminalId}
                  isReady={status?.isReady ?? false}
                  exitCode={status?.exitCode ?? null}
                  onClick={() => setActiveTerminal(tab.id)}
                  onClose={() => handleCloseTab(tab.id)}
                  onRename={(newName) => renameTerminalTab(tab.id, newName)}
                  hint={idx < 9 ? <KbdDigit shortcutId="switchTerminalTab" digit={idx + 1} /> : undefined}
                />
              );
            })}
          </div>
        ) : (
          <div
            className={`flex items-center justify-between px-2 py-1 select-none ${hasTabs ? 'cursor-pointer' : ''}`}
            onClick={handleToggleExpand}
          >
            <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
              {showExpanded ? (
                <>
                  {/* Show single-project label if not multiProject */}
                  {activeProjectId && (
                    <div className="flex items-center gap-1.5 mr-1 shrink-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getProjectColorHex(activeProjectId) }}
                      />
                      <span className="text-[11px] font-medium text-content-secondary truncate max-w-[100px]">
                        {getProjectName(activeProjectId)}
                      </span>
                    </div>
                  )}
                  {activeProjectTabs.map((tab, idx) => {
                    const status = statuses.get(tab.id);
                    return (
                      <TerminalTabItem
                        key={tab.id}
                        name={tab.name}
                        isActive={tab.id === activeTerminalId}
                        isReady={status?.isReady ?? false}
                        exitCode={status?.exitCode ?? null}
                        onClick={() => setActiveTerminal(tab.id)}
                        onClose={() => handleCloseTab(tab.id)}
                        onRename={(newName) => renameTerminalTab(tab.id, newName)}
                        hint={idx < 9 ? <KbdDigit shortcutId="switchTerminalTab" digit={idx + 1} /> : undefined}
                      />
                    );
                  })}
                </>
              ) : (
                <>
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
                </>
              )}

              {/* Add button */}
              <button
                onClick={(e) => { e.stopPropagation(); setShowAddPopover(true); }}
                className="w-5 h-5 flex items-center justify-center rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary transition-colors shrink-0"
                title="New terminal"
              >
                <PlusIcon />
                <Kbd shortcutId="newTerminal" />
              </button>
              {showAddPopover && (
                <AddTerminalPopover
                  defaultProjectId={defaultAddProjectId}
                  onClose={() => setShowAddPopover(false)}
                />
              )}
            </div>

            {hasTabs && (
              <ChevronDownIcon
                size={14}
                className={`text-content-tertiary transition-transform duration-150 shrink-0 ${expanded ? '' : 'rotate-180'}`}
              />
            )}
          </div>
        )}
      </div>

      {/* Terminal content — all tabs mounted, only active visible */}
      {hasTabs && (
        <div className={`flex-1 min-h-0 bg-terminal-surface ${showExpanded ? '' : 'hidden'}`}>
          {terminalTabs.map((tab) => (
            <TerminalView
              key={tab.id}
              terminalId={tab.id}
              projectId={tab.projectId}
              isActive={showExpanded && tab.id === activeTerminalId}
            />
          ))}
        </div>
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
