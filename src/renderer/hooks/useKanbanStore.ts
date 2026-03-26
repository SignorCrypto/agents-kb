import { create } from 'zustand';
import type { Project, Job, OutputEntry, RawMessage, PendingQuestion, AppSettings, CliHealthStatus, ModelOption, TerminalTab } from '../types/index';
import { DEFAULT_SETTINGS } from '../types/index';

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
  promptHistoryJobId: string | null;
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
  setPromptHistoryJobId: (id: string | null) => void;
  setSettings: (settings: AppSettings) => void;
  setAvailableModels: (models: ModelOption[]) => void;
  setInstalledEditors: (editors: Record<string, boolean>) => void;

  // CLI Health
  checkCliHealth: () => Promise<void>;

  // Initialization
  init: () => Promise<void>;
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
  promptHistoryJobId: null,
  settings: DEFAULT_SETTINGS,
  availableModels: [],
  installedEditors: null,
  outputLogs: {},
  rawMessages: {},

  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
  removeProject: (id) => set((s) => ({
    projects: s.projects.filter(p => p.id !== id),
    jobs: s.jobs.filter(j => j.projectId !== id),
    selectedJobId: s.jobs.some(j => j.projectId === id && j.id === s.selectedJobId) ? null : s.selectedJobId,
  })),
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
    set((s) => ({
      terminalTabs: [...s.terminalTabs, tab],
      activeTerminalId: tab.id,
      terminalExpanded: true,
    }));
    return tab;
  },
  removeTerminalTab: (tabId) => set((s) => {
    const tabs = s.terminalTabs.filter((t) => t.id !== tabId);
    let activeId = s.activeTerminalId;
    if (activeId === tabId) {
      // Pick the previous tab in the same project group, or the first remaining tab
      const removed = s.terminalTabs.find((t) => t.id === tabId);
      const siblings = tabs.filter((t) => t.projectId === removed?.projectId);
      activeId = siblings.length > 0 ? siblings[siblings.length - 1].id : (tabs.length > 0 ? tabs[tabs.length - 1].id : null);
    }
    return {
      terminalTabs: tabs,
      activeTerminalId: activeId,
      terminalExpanded: tabs.length > 0 ? s.terminalExpanded : false,
    };
  }),
  renameTerminalTab: (tabId, name) => set((s) => ({
    terminalTabs: s.terminalTabs.map((t) => t.id === tabId ? { ...t, name } : t),
  })),
  setActiveTerminal: (tabId) => set({ activeTerminalId: tabId }),
  setTerminalExpanded: (expanded) => set({ terminalExpanded: expanded }),
  clearTerminalTabs: () => set({
    terminalTabs: [],
    activeTerminalId: null,
    terminalExpanded: false,
  }),
  toggleTerminalForProject: (projectId) => set((s) => {
    const hasTabsForProject = s.terminalTabs.some((t) => t.projectId === projectId);
    if (hasTabsForProject) {
      const activeTab = s.terminalTabs.find((t) => t.id === s.activeTerminalId);
      // Toggle the active project's panel open/closed without destroying sessions.
      if (activeTab?.projectId === projectId) {
        return { terminalExpanded: !s.terminalExpanded };
      }

      // Otherwise switch to the first tab of this project and expand the panel.
      const firstTab = s.terminalTabs.find((t) => t.projectId === projectId);
      return { activeTerminalId: firstTab?.id ?? s.activeTerminalId, terminalExpanded: true };
    }
    // No terminals for this project — open the new terminal dialog
    return { showAddTerminal: true };
  }),
  setPromptHistoryJobId: (id) => set({ promptHistoryJobId: id }),
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
    const [projects, jobs, settings] = await Promise.all([
      api.projectsList(),
      api.jobsList(),
      api.settingsGet(),
    ]);
    get().setJobs(jobs);
    set({ projects, settings });

    // Fetch model catalog from SDK (cached in main process)
    api.modelsList().then((models) => {
      if (models?.length) get().setAvailableModels(models);
    }).catch(() => { /* models will arrive via onModelsUpdated when ready */ });

    // Detect installed editors once at startup (cached for the session)
    api.editorsDetectInstalled().then((editors) => {
      if (editors) set({ installedEditors: editors });
    }).catch(() => { /* editor detection failed, leave as null */ });

    // Listen for model updates from the SDK (pushed at startup or when sessions discover new models)
    api.onModelsUpdated((models) => {
      if (models?.length) get().setAvailableModels(models);
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
