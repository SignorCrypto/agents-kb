import { create } from 'zustand';
import type { Project, Job, OutputEntry, RawMessage, PendingQuestion, AppSettings, CliHealthStatus, ModelOption, TerminalTab, TerminalSplit } from '../types/index';
import { DEFAULT_SETTINGS } from '../types/index';
import { DEMO_TERMINAL_TABS } from '../../shared/demo-terminals';

interface KanbanState {
  cliHealth: CliHealthStatus | null;
  cliHealthLoading: boolean;
  projects: Project[];
  jobs: Job[];
  selectedJobId: string | null;
  selectedProjectId: string | null;
  showNewJobDialog: boolean;
  showSettings: boolean;
  showSkillsPanel: boolean;
  showAddTerminal: boolean;
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  terminalExpanded: boolean;
  terminalSplit: TerminalSplit | null;
  activeSplitPane: 'left' | 'right';
  promptHistoryJobId: string | null;
  showWhatsNew: boolean;
  whatsNewContent: string | null;
  whatsNewVersion: string | null;
  settings: AppSettings;
  /** Model catalog fetched from the SDK at app startup */
  availableModels: ModelOption[];
  /** Installed editors detected once at startup */
  installedEditors: Record<string, boolean> | null;

  // Separate streaming data — not on jobs array
  outputLogs: Record<string, OutputEntry[]>;
  rawMessages: Record<string, RawMessage[]>;

  // Actions
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  setProjectDefaultBranch: (id: string, branch: string | null) => void;
  setProjectColor: (id: string, color: string | null) => void;
  reorderProjects: (orderedIds: string[]) => void;

  setJobs: (jobs: Job[]) => void;
  addJob: (job: Job) => void;
  updateJob: (job: Job) => void;
  removeJob: (id: string) => void;
  appendOutputBatch: (jobId: string, entries: OutputEntry[]) => void;
  appendRawMessageBatch: (jobId: string, messages: RawMessage[]) => void;
  appendStreamingBatch: (jobId: string, entries: OutputEntry[], messages: RawMessage[]) => void;
  setJobQuestion: (jobId: string, question: PendingQuestion) => void;

  selectJob: (id: string | null) => void;
  selectProject: (id: string | null) => void;
  setShowNewJobDialog: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setShowSkillsPanel: (show: boolean) => void;
  setShowAddTerminal: (show: boolean) => void;
  addTerminalTab: (projectId: string, name: string) => TerminalTab;
  removeTerminalTab: (tabId: string) => void;
  renameTerminalTab: (tabId: string, name: string) => void;
  setActiveTerminal: (tabId: string) => void;
  setTerminalExpanded: (expanded: boolean) => void;
  clearTerminalTabs: () => void;
  toggleTerminalForProject: (projectId: string) => void;
  setTerminalSplit: (leftTabIds: string[], rightTabIds: string[]) => void;
  clearTerminalSplit: () => void;
  setTerminalSplitRatio: (ratio: number) => void;
  setActiveSplitPane: (pane: 'left' | 'right') => void;
  setActivePaneTab: (pane: 'left' | 'right', tabId: string) => void;
  moveTabToPane: (tabId: string, targetPane: 'left' | 'right') => void;
  addTerminalTabToPane: (projectId: string, name: string, pane: 'left' | 'right') => TerminalTab;
  reorderPaneTabs: (pane: 'left' | 'right' | 'single', orderedTabIds: string[]) => void;
  setPromptHistoryJobId: (id: string | null) => void;
  setShowWhatsNew: (show: boolean) => void;
  setSettings: (settings: AppSettings) => void;
  setAvailableModels: (models: ModelOption[]) => void;
  setInstalledEditors: (editors: Record<string, boolean>) => void;

  // CLI Health
  checkCliHealth: () => Promise<void>;

  // Initialization
  init: () => Promise<void>;
}

function removeProjectTerminalState(
  state: Pick<KanbanState, 'terminalTabs' | 'activeTerminalId' | 'terminalExpanded' | 'terminalSplit' | 'activeSplitPane'>,
  projectId: string,
): Pick<KanbanState, 'terminalTabs' | 'activeTerminalId' | 'terminalExpanded' | 'terminalSplit' | 'activeSplitPane'> {
  const removedTabIds = new Set(
    state.terminalTabs.filter((tab) => tab.projectId === projectId).map((tab) => tab.id),
  );

  if (removedTabIds.size === 0) {
    return {
      terminalTabs: state.terminalTabs,
      activeTerminalId: state.activeTerminalId,
      terminalExpanded: state.terminalExpanded,
      terminalSplit: state.terminalSplit,
      activeSplitPane: state.activeSplitPane,
    };
  }

  const terminalTabs = state.terminalTabs.filter((tab) => !removedTabIds.has(tab.id));
  const remainingTabIds = new Set(terminalTabs.map((tab) => tab.id));

  if (!state.terminalSplit) {
    const activeTerminalId =
      state.activeTerminalId && remainingTabIds.has(state.activeTerminalId)
        ? state.activeTerminalId
        : terminalTabs[terminalTabs.length - 1]?.id ?? null;

    return {
      terminalTabs,
      activeTerminalId,
      terminalExpanded: terminalTabs.length > 0 ? state.terminalExpanded : false,
      terminalSplit: null,
      activeSplitPane: state.activeSplitPane,
    };
  }

  const leftTabIds = state.terminalSplit.leftTabIds.filter((tabId) => remainingTabIds.has(tabId));
  const rightTabIds = state.terminalSplit.rightTabIds.filter((tabId) => remainingTabIds.has(tabId));

  if (leftTabIds.length === 0 && rightTabIds.length === 0) {
    return {
      terminalTabs,
      activeTerminalId: null,
      terminalExpanded: false,
      terminalSplit: null,
      activeSplitPane: 'left',
    };
  }

  if (leftTabIds.length === 0 || rightTabIds.length === 0) {
    const survivingTabIds = leftTabIds.length > 0 ? leftTabIds : rightTabIds;
    const survivingActiveId =
      leftTabIds.length > 0
        ? state.terminalSplit.activeLeftTabId
        : state.terminalSplit.activeRightTabId;
    const activeTerminalId =
      survivingActiveId && remainingTabIds.has(survivingActiveId)
        ? survivingActiveId
        : survivingTabIds[survivingTabIds.length - 1] ?? null;

    return {
      terminalTabs,
      activeTerminalId,
      terminalExpanded: terminalTabs.length > 0 ? state.terminalExpanded : false,
      terminalSplit: null,
      activeSplitPane: 'left',
    };
  }

  const activeLeftTabId = remainingTabIds.has(state.terminalSplit.activeLeftTabId)
    ? state.terminalSplit.activeLeftTabId
    : leftTabIds[leftTabIds.length - 1];
  const activeRightTabId = remainingTabIds.has(state.terminalSplit.activeRightTabId)
    ? state.terminalSplit.activeRightTabId
    : rightTabIds[rightTabIds.length - 1];
  const activeSplitPane = state.activeSplitPane;
  const preferredActiveTabId = activeSplitPane === 'left' ? activeLeftTabId : activeRightTabId;
  const activeTerminalId = remainingTabIds.has(preferredActiveTabId)
    ? preferredActiveTabId
    : activeSplitPane === 'left'
      ? activeRightTabId
      : activeLeftTabId;

  return {
    terminalTabs,
    activeTerminalId,
    terminalExpanded: state.terminalExpanded,
    terminalSplit: {
      ...state.terminalSplit,
      leftTabIds,
      rightTabIds,
      activeLeftTabId,
      activeRightTabId,
    },
    activeSplitPane,
  };
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  cliHealth: null,
  cliHealthLoading: true,
  projects: [],
  jobs: [],
  selectedJobId: null,
  selectedProjectId: null,
  showNewJobDialog: false,
  showSettings: false,
  showSkillsPanel: false,
  showAddTerminal: false,
  terminalTabs: [],
  activeTerminalId: null,
  terminalExpanded: false,
  terminalSplit: null,
  activeSplitPane: 'left',
  promptHistoryJobId: null,
  showWhatsNew: false,
  whatsNewContent: null,
  whatsNewVersion: null,
  settings: DEFAULT_SETTINGS,
  availableModels: [],
  installedEditors: null,
  outputLogs: {},
  rawMessages: {},

  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
  removeProject: (id) => set((s) => {
    const terminalState = removeProjectTerminalState(s, id);

    return {
      projects: s.projects.filter((p) => p.id !== id),
      jobs: s.jobs.filter((j) => j.projectId !== id),
      selectedJobId: s.jobs.some((j) => j.projectId === id && j.id === s.selectedJobId) ? null : s.selectedJobId,
      selectedProjectId: s.selectedProjectId === id ? null : s.selectedProjectId,
      ...terminalState,
    };
  }),
  renameProject: (id, name) => set((s) => ({
    projects: s.projects.map(p => p.id === id ? { ...p, name } : p),
  })),
  setProjectDefaultBranch: (id, branch) => set((s) => ({
    projects: s.projects.map(p => {
      if (p.id !== id) return p;
      if (branch) return { ...p, defaultBranch: branch };
      const { defaultBranch: _, ...rest } = p;
      return rest;
    }),
  })),
  setProjectColor: (id, color) => set((s) => ({
    projects: s.projects.map(p => {
      if (p.id !== id) return p;
      if (color) return { ...p, color: color as Project['color'] };
      const { color: _, ...rest } = p;
      return rest;
    }),
  })),
  reorderProjects: (orderedIds) => set((s) => {
    const byId = new Map(s.projects.map(p => [p.id, p]));
    return { projects: orderedIds.map(id => byId.get(id)!).filter(Boolean) };
  }),

  setJobs: (jobs) => {
    // Extract outputLogs and rawMessages from jobs into separate maps
    const outputLogs: Record<string, OutputEntry[]> = {};
    const rawMessages: Record<string, RawMessage[]> = {};
    for (const job of jobs) {
      if (job.outputLog?.length) outputLogs[job.id] = job.outputLog;
      if (job.rawMessages?.length) rawMessages[job.id] = job.rawMessages;
    }
    set({ jobs, outputLogs, rawMessages });
  },
  addJob: (job) => set((s) => {
    const outputLogs = { ...s.outputLogs };
    const rawMessages = { ...s.rawMessages };
    if (job.outputLog?.length) outputLogs[job.id] = job.outputLog;
    if (job.rawMessages?.length) rawMessages[job.id] = job.rawMessages;
    return { jobs: [...s.jobs, job], outputLogs, rawMessages };
  }),
  updateJob: (job) => set((s) => {
    const newJobs = s.jobs.map(j => j.id === job.id ? job : j);
    const result: Partial<KanbanState> = { jobs: newJobs };
    if (job.outputLog?.length) {
      result.outputLogs = { ...s.outputLogs, [job.id]: job.outputLog };
    }
    if (job.rawMessages?.length) {
      result.rawMessages = { ...s.rawMessages, [job.id]: job.rawMessages };
    }
    return result;
  }),
  removeJob: (id) => set((s) => {
    const { [id]: _ol, ...outputLogs } = s.outputLogs;
    const { [id]: _rm, ...rawMessages } = s.rawMessages;
    return {
      jobs: s.jobs.filter(j => j.id !== id),
      selectedJobId: s.selectedJobId === id ? null : s.selectedJobId,
      outputLogs,
      rawMessages,
    };
  }),
  appendOutputBatch: (jobId, entries) => set((s) => {
    const existing = s.outputLogs[jobId] || [];
    return {
      outputLogs: { ...s.outputLogs, [jobId]: [...existing, ...entries] },
    };
  }),
  appendRawMessageBatch: (jobId, messages) => set((s) => {
    const existing = s.rawMessages[jobId] || [];
    return {
      rawMessages: { ...s.rawMessages, [jobId]: [...existing, ...messages] },
    };
  }),
  appendStreamingBatch: (jobId, entries, messages) => set((s) => {
    const result: Partial<KanbanState> = {};
    if (entries.length > 0) {
      const existingOutput = s.outputLogs[jobId] || [];
      result.outputLogs = { ...s.outputLogs, [jobId]: [...existingOutput, ...entries] };
    }
    if (messages.length > 0) {
      const existingRaw = s.rawMessages[jobId] || [];
      result.rawMessages = { ...s.rawMessages, [jobId]: [...existingRaw, ...messages] };
    }
    return result;
  }),
  setJobQuestion: (jobId, question) => set((s) => ({
    jobs: s.jobs.map(j =>
      j.id === jobId ? { ...j, status: 'waiting-input' as const, pendingQuestion: question } : j
    ),
  })),

  selectJob: (id) => set({ selectedJobId: id }),
  selectProject: (id) => set((s) => ({ selectedProjectId: s.selectedProjectId === id ? null : id, selectedJobId: null })),
  setShowNewJobDialog: (show) => set({ showNewJobDialog: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowSkillsPanel: (show) => set({ showSkillsPanel: show }),
  setShowAddTerminal: (show) => set({ showAddTerminal: show }),
  addTerminalTab: (projectId, name) => {
    const tab: TerminalTab = { id: crypto.randomUUID(), projectId, name, createdAt: new Date().toISOString() };
    set((s) => {
      const newTabs = [...s.terminalTabs, tab];
      if (s.terminalSplit) {
        const pane = s.activeSplitPane;
        const newLeft = pane === 'left' ? [...s.terminalSplit.leftTabIds, tab.id] : s.terminalSplit.leftTabIds;
        const newRight = pane === 'right' ? [...s.terminalSplit.rightTabIds, tab.id] : s.terminalSplit.rightTabIds;
        const newActiveLeft = pane === 'left' ? tab.id : s.terminalSplit.activeLeftTabId;
        const newActiveRight = pane === 'right' ? tab.id : s.terminalSplit.activeRightTabId;
        return {
          terminalTabs: newTabs,
          terminalSplit: { ...s.terminalSplit, leftTabIds: newLeft, rightTabIds: newRight, activeLeftTabId: newActiveLeft, activeRightTabId: newActiveRight },
          activeTerminalId: tab.id,
          terminalExpanded: true,
        };
      }

      return { terminalTabs: newTabs, activeTerminalId: tab.id, terminalExpanded: true };
    });
    return tab;
  },
  removeTerminalTab: (tabId) => set((s) => {
    const tabs = s.terminalTabs.filter((t) => t.id !== tabId);
    let activeId = s.activeTerminalId;
    let split = s.terminalSplit;
    const removedIndex = s.terminalTabs.findIndex((t) => t.id === tabId);

    if (split) {
      const inLeft = split.leftTabIds.includes(tabId);
      const inRight = split.rightTabIds.includes(tabId);

      if (inLeft || inRight) {
        const newLeft = split.leftTabIds.filter((id) => id !== tabId);
        const newRight = split.rightTabIds.filter((id) => id !== tabId);

        // If a pane becomes empty, auto-unsplit
        if (newLeft.length === 0 || newRight.length === 0) {
          const remaining = newLeft.length > 0 ? newLeft : newRight;
          // Preserve active from the surviving pane (capture before nullifying split)
          const survivingActive = newLeft.length > 0 ? split.activeLeftTabId : split.activeRightTabId;
          split = null;
          activeId = (survivingActive && remaining.includes(survivingActive))
            ? survivingActive
            : remaining[remaining.length - 1] ?? null;
        } else {
          // Update active tab in the affected pane
          let activeLeft = split.activeLeftTabId;
          let activeRight = split.activeRightTabId;
          if (inLeft && activeLeft === tabId) {
            activeLeft = newLeft[newLeft.length - 1];
          }
          if (inRight && activeRight === tabId) {
            activeRight = newRight[newRight.length - 1];
          }
          split = { ...split, leftTabIds: newLeft, rightTabIds: newRight, activeLeftTabId: activeLeft, activeRightTabId: activeRight };
          // Update global activeTerminalId
          activeId = s.activeSplitPane === 'left' ? activeLeft : activeRight;
        }
      }
    } else if (activeId === tabId) {
      const fallbackIndex = removedIndex <= 0 ? 0 : removedIndex - 1;
      activeId = tabs[fallbackIndex]?.id ?? tabs[tabs.length - 1]?.id ?? null;
    }

    return {
      terminalTabs: tabs,
      activeTerminalId: activeId,
      terminalExpanded: tabs.length > 0 ? s.terminalExpanded : false,
      terminalSplit: split,
    };
  }),
  renameTerminalTab: (tabId, name) => set((s) => ({
    terminalTabs: s.terminalTabs.map((t) => t.id === tabId ? { ...t, name } : t),
  })),
  setActiveTerminal: (tabId) => set((s) => {
    const result: Partial<KanbanState> = { activeTerminalId: tabId };
    if (s.terminalSplit) {
      if (s.terminalSplit.leftTabIds.includes(tabId)) {
        result.terminalSplit = { ...s.terminalSplit, activeLeftTabId: tabId };
        result.activeSplitPane = 'left';
      } else if (s.terminalSplit.rightTabIds.includes(tabId)) {
        result.terminalSplit = { ...s.terminalSplit, activeRightTabId: tabId };
        result.activeSplitPane = 'right';
      }
    }
    return result;
  }),
  setTerminalExpanded: (expanded) => set({ terminalExpanded: expanded }),
  clearTerminalTabs: () => set({
    terminalTabs: [],
    activeTerminalId: null,
    terminalExpanded: false,
    terminalSplit: null,
  }),
  toggleTerminalForProject: (projectId) => set((s) => {
    const hasTabsForProject = s.terminalTabs.some((t) => t.projectId === projectId);
    if (hasTabsForProject) {
      const activeTab = s.terminalTabs.find((t) => t.id === s.activeTerminalId);
      // Toggle the active project's panel open/closed without destroying sessions.
      if (activeTab?.projectId === projectId) {
        return { terminalExpanded: !s.terminalExpanded };
      }

      const firstTab = s.terminalTabs.find((t) => t.projectId === projectId);
      if (!firstTab) return { terminalExpanded: true };

      const result: Partial<KanbanState> = {
        activeTerminalId: firstTab.id,
        terminalExpanded: true,
      };

      if (s.terminalSplit) {
        if (s.terminalSplit.leftTabIds.includes(firstTab.id)) {
          result.terminalSplit = { ...s.terminalSplit, activeLeftTabId: firstTab.id };
          result.activeSplitPane = 'left';
        } else if (s.terminalSplit.rightTabIds.includes(firstTab.id)) {
          result.terminalSplit = { ...s.terminalSplit, activeRightTabId: firstTab.id };
          result.activeSplitPane = 'right';
        }
      }

      return result;
    }
    // No terminals for this project — expand the panel and open the new terminal dialog
    return { terminalExpanded: true, showAddTerminal: true };
  }),
  setTerminalSplit: (leftTabIds, rightTabIds) => set({
    terminalSplit: {
      leftTabIds,
      rightTabIds,
      activeLeftTabId: leftTabIds[0],
      activeRightTabId: rightTabIds[0],
      dividerRatio: 0.5,
    },
    activeTerminalId: leftTabIds[0],
    activeSplitPane: 'left',
  }),
  clearTerminalSplit: () => set((s) => ({
    terminalSplit: null,
    activeTerminalId: s.terminalSplit
      ? (s.activeSplitPane === 'left' ? s.terminalSplit.activeLeftTabId : s.terminalSplit.activeRightTabId)
      : s.activeTerminalId,
  })),
  setTerminalSplitRatio: (ratio) => set((s) => ({
    terminalSplit: s.terminalSplit
      ? { ...s.terminalSplit, dividerRatio: Math.max(0.2, Math.min(0.8, ratio)) }
      : null,
  })),
  setActiveSplitPane: (pane) => set((s) => ({
    activeSplitPane: pane,
    activeTerminalId: s.terminalSplit
      ? (pane === 'left' ? s.terminalSplit.activeLeftTabId : s.terminalSplit.activeRightTabId)
      : s.activeTerminalId,
  })),
  setActivePaneTab: (pane, tabId) => set((s) => {
    if (!s.terminalSplit) return {};
    const update: Partial<TerminalSplit> = pane === 'left'
      ? { activeLeftTabId: tabId }
      : { activeRightTabId: tabId };
    return {
      terminalSplit: { ...s.terminalSplit, ...update },
      activeTerminalId: s.activeSplitPane === pane ? tabId : s.activeTerminalId,
    };
  }),
  moveTabToPane: (tabId, targetPane) => set((s) => {
    if (!s.terminalSplit) return {};
    const { leftTabIds, rightTabIds, activeLeftTabId, activeRightTabId } = s.terminalSplit;
    const sourcePane = leftTabIds.includes(tabId) ? 'left' : rightTabIds.includes(tabId) ? 'right' : null;
    if (!sourcePane || sourcePane === targetPane) return {};

    const newLeft = sourcePane === 'left' ? leftTabIds.filter((id) => id !== tabId) : [...leftTabIds];
    const newRight = sourcePane === 'right' ? rightTabIds.filter((id) => id !== tabId) : [...rightTabIds];
    if (targetPane === 'left') newLeft.push(tabId);
    else newRight.push(tabId);

    // If source pane is now empty, auto-unsplit
    if (newLeft.length === 0 || newRight.length === 0) {
      return { terminalSplit: null, activeTerminalId: tabId };
    }

    let newActiveLeft = activeLeftTabId;
    let newActiveRight = activeRightTabId;
    if (sourcePane === 'left' && activeLeftTabId === tabId) {
      newActiveLeft = newLeft[newLeft.length - 1];
    }
    if (sourcePane === 'right' && activeRightTabId === tabId) {
      newActiveRight = newRight[newRight.length - 1];
    }
    // Set moved tab as active in target pane
    if (targetPane === 'left') newActiveLeft = tabId;
    else newActiveRight = tabId;

    return {
      terminalSplit: { ...s.terminalSplit, leftTabIds: newLeft, rightTabIds: newRight, activeLeftTabId: newActiveLeft, activeRightTabId: newActiveRight },
      activeSplitPane: targetPane,
      activeTerminalId: tabId,
    };
  }),
  addTerminalTabToPane: (projectId, name, pane) => {
    const tab: TerminalTab = { id: crypto.randomUUID(), projectId, name, createdAt: new Date().toISOString() };
    set((s) => {
      const newTabs = [...s.terminalTabs, tab];
      if (!s.terminalSplit) {
        return { terminalTabs: newTabs, activeTerminalId: tab.id, terminalExpanded: true };
      }
      const newLeft = pane === 'left' ? [...s.terminalSplit.leftTabIds, tab.id] : s.terminalSplit.leftTabIds;
      const newRight = pane === 'right' ? [...s.terminalSplit.rightTabIds, tab.id] : s.terminalSplit.rightTabIds;
      const newActiveLeft = pane === 'left' ? tab.id : s.terminalSplit.activeLeftTabId;
      const newActiveRight = pane === 'right' ? tab.id : s.terminalSplit.activeRightTabId;
      return {
        terminalTabs: newTabs,
        terminalSplit: { ...s.terminalSplit, leftTabIds: newLeft, rightTabIds: newRight, activeLeftTabId: newActiveLeft, activeRightTabId: newActiveRight },
        activeTerminalId: tab.id,
        activeSplitPane: pane,
        terminalExpanded: true,
      };
    });
    return tab;
  },
  reorderPaneTabs: (pane, orderedTabIds) => set((s) => {
    if (pane === 'single' || !s.terminalSplit) {
      const reordered = orderedTabIds
        .map((id) => s.terminalTabs.find((t) => t.id === id))
        .filter((tab): tab is TerminalTab => Boolean(tab));
      return { terminalTabs: reordered };
    }
    // Split mode: reorder within the pane
    if (pane === 'left') {
      return { terminalSplit: { ...s.terminalSplit, leftTabIds: orderedTabIds } };
    }
    return { terminalSplit: { ...s.terminalSplit, rightTabIds: orderedTabIds } };
  }),
  setPromptHistoryJobId: (id) => set({ promptHistoryJobId: id }),
  setShowWhatsNew: (show) => set({ showWhatsNew: show }),
  setSettings: (settings) => set({ settings }),
  setAvailableModels: (models) => set({ availableModels: models }),
  setInstalledEditors: (editors) => set({ installedEditors: editors }),

  checkCliHealth: async () => {
    set({ cliHealthLoading: true });
    try {
      const health = await window.electronAPI.cliCheckHealth();
      set({ cliHealth: health, cliHealthLoading: false });
    } catch {
      set({
        cliHealth: { installed: false, authenticated: false, error: 'Failed to check CLI status.' },
        cliHealthLoading: false,
      });
    }
  },

  init: async () => {
    const api = window.electronAPI;
    const refreshSettings = () => {
      api.settingsGet().then((nextSettings) => {
        set({ settings: nextSettings });
      }).catch(() => { /* keep current settings if refresh fails */ });
    };
    const [projects, jobs, settings, isDemo] = await Promise.all([
      api.projectsList(),
      api.jobsList(),
      api.settingsGet(),
      api.appIsDemoMode(),
    ]);
    get().setJobs(jobs);
    set({ projects, settings });

    if (isDemo && DEMO_TERMINAL_TABS.length > 0) {
      set({
        terminalTabs: DEMO_TERMINAL_TABS,
        activeTerminalId: DEMO_TERMINAL_TABS[0].id,
        terminalExpanded: true,
      });
    }

    // Check for release notes on version change
    api.releaseNotesCheck().then(({ show, version, content }) => {
      if (show) {
        set({ showWhatsNew: true, whatsNewContent: content, whatsNewVersion: version });
      }
    }).catch(() => { /* silently skip if release notes check fails */ });

    // Fetch model catalog from SDK (cached in main process)
    api.modelsList().then((models) => {
      if (models?.length) {
        get().setAvailableModels(models);
        refreshSettings();
      }
    }).catch(() => { /* models will arrive via onModelsUpdated when ready */ });

    // Detect installed editors once at startup (cached for the session)
    api.editorsDetectInstalled().then((editors) => {
      if (editors) set({ installedEditors: editors });
    }).catch(() => { /* editor detection failed, leave as null */ });

    // Listen for model updates from the SDK (pushed at startup or when sessions discover new models)
    api.onModelsUpdated((models) => {
      if (models?.length) {
        get().setAvailableModels(models);
        refreshSettings();
      }
    });

    // Subscribe to events
    api.onJobStatusChanged((job) => {
      get().updateJob(job);
    });

    api.onJobStreamingBatch(({ jobId, entries, messages }) => {
      get().appendStreamingBatch(jobId, entries, messages);
    });

    api.onJobNeedsInput(({ jobId, question }) => {
      get().setJobQuestion(jobId, question);
    });

    api.onJobError(({ jobId, error }) => {
      set((s) => ({
        jobs: s.jobs.map(j =>
          j.id === jobId ? { ...j, status: 'error', error } : j
        ),
      }));
    });

    api.onJobFocus(({ jobId }) => {
      get().selectJob(jobId);
    });

    api.onJobComplete(async ({ jobId }) => {
      const state = get();
      set({
        jobs: state.jobs.map(j =>
          j.id === jobId ? { ...j, column: 'done', status: 'completed' } : j
        ),
      });
      // Re-check isGitRepo for the job's project (e.g. after git init)
      const job = state.jobs.find(j => j.id === jobId);
      if (job) {
        const updated = await api.projectsRefreshGitStatus(job.projectId);
        if (updated) {
          set((s) => ({
            projects: s.projects.map(p => p.id === updated.id ? updated : p),
          }));
        }
      }
    });
  },
}));
