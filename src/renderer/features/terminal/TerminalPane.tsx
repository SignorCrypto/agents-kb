import type { TerminalTab } from '../../types/index';
import { PaneTabBar } from './PaneTabBar';
import { TerminalView } from './TerminalView';

interface TerminalPaneProps {
  tabIds: string[];
  activeTabId: string;
  allTabs: TerminalTab[];
  projectColors: Map<string, string>;
  statuses: Map<string, { isReady: boolean; exitCode: number | null }>;
  pane: 'left' | 'right' | 'single';
  isActivePane: boolean;
  onPaneClick: () => void;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabRename: (tabId: string, name: string) => void;
  onAddTerminal: () => void;
  onTabDrop?: (tabId: string) => void;
  onReorder?: (orderedTabIds: string[]) => void;
  digitOffset?: number;
}

export function TerminalPane({
  tabIds,
  activeTabId,
  allTabs,
  projectColors,
  statuses,
  pane,
  isActivePane,
  onPaneClick,
  onTabClick,
  onTabClose,
  onTabRename,
  onAddTerminal,
  onTabDrop,
  onReorder,
  digitOffset,
}: TerminalPaneProps) {
  // Preserve tab order from tabIds
  const paneTabs = tabIds.map((id) => allTabs.find((t) => t.id === id)).filter(Boolean) as TerminalTab[];

  return (
    <div
      className="flex flex-col min-w-0 overflow-hidden relative"
      style={{ flex: 1 }}
      onClick={onPaneClick}
    >
      <PaneTabBar
        tabs={paneTabs}
        projectColors={projectColors}
        activeTabId={activeTabId}
        statuses={statuses}
        pane={pane}
        isActivePane={isActivePane}
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onTabRename={onTabRename}
        onAddTerminal={onAddTerminal}
        onTabDrop={onTabDrop}
        onReorder={onReorder}
        digitOffset={digitOffset}
      />
      <div className="flex-1 min-h-0 relative">
        {paneTabs.map((tab) => (
          <TerminalView
            key={tab.id}
            terminalId={tab.id}
            projectId={tab.projectId}
            isActive={tab.id === activeTabId}
          />
        ))}
      </div>
    </div>
  );
}
