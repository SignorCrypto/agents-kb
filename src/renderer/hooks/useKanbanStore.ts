import { create } from 'zustand';
import type { Project, Job, OutputEntry, RawMessage, PendingQuestion, AppSettings } from '../types/index';
import { DEFAULT_SETTINGS } from '../types/index';

interface KanbanState {
  projects: Project[];
  jobs: Job[];
  selectedJobId: string | null;
  selectedProjectId: string | null;
  showNewJobDialog: boolean;
  settings: AppSettings;

  // Separate streaming data — not on jobs array
  outputLogs: Record<string, OutputEntry[]>;
  rawMessages: Record<string, RawMessage[]>;

  // Actions
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  setProjectDefaultBranch: (id: string, branch: string | null) => void;
  reorderProjects: (orderedIds: string[]) => void;

  setJobs: (jobs: Job[]) => void;
  addJob: (job: Job) => void;
  updateJob: (job: Job) => void;
  removeJob: (id: string) => void;
  appendOutputBatch: (jobId: string, entries: OutputEntry[]) => void;
  appendRawMessageBatch: (jobId: string, messages: RawMessage[]) => void;
  setJobQuestion: (jobId: string, question: PendingQuestion) => void;

  selectJob: (id: string | null) => void;
  selectProject: (id: string | null) => void;
  setShowNewJobDialog: (show: boolean) => void;
  setSettings: (settings: AppSettings) => void;

  // Initialization
  init: () => Promise<void>;
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  projects: [],
  jobs: [],
  selectedJobId: null,
  selectedProjectId: null,
  showNewJobDialog: false,
  settings: DEFAULT_SETTINGS,
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
    const outputLogs = { ...s.outputLogs };
    const rawMessages = { ...s.rawMessages };
    if (job.outputLog?.length) outputLogs[job.id] = job.outputLog;
    if (job.rawMessages?.length) rawMessages[job.id] = job.rawMessages;
    return {
      jobs: s.jobs.map(j => j.id === job.id ? job : j),
      outputLogs,
      rawMessages,
    };
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
  setJobQuestion: (jobId, question) => set((s) => ({
    jobs: s.jobs.map(j =>
      j.id === jobId ? { ...j, status: 'waiting-input' as const, pendingQuestion: question } : j
    ),
  })),

  selectJob: (id) => set({ selectedJobId: id }),
  selectProject: (id) => set((s) => ({ selectedProjectId: s.selectedProjectId === id ? null : id })),
  setShowNewJobDialog: (show) => set({ showNewJobDialog: show }),
  setSettings: (settings) => set({ settings }),

  init: async () => {
    const api = window.electronAPI;
    const [projects, jobs, settings] = await Promise.all([
      api.projectsList(),
      api.jobsList(),
      api.settingsGet(),
    ]);
    get().setJobs(jobs);
    set({ projects, settings });

    // Subscribe to events
    api.onJobStatusChanged((job) => {
      get().updateJob(job);
    });

    api.onJobOutputBatch(({ jobId, entries }) => {
      get().appendOutputBatch(jobId, entries);
    });

    api.onJobRawMessageBatch(({ jobId, messages }) => {
      get().appendRawMessageBatch(jobId, messages);
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

    api.onJobComplete(({ jobId }) => {
      set((s) => ({
        jobs: s.jobs.map(j =>
          j.id === jobId ? { ...j, column: 'done', status: 'completed' } : j
        ),
      }));
    });
  },
}));
