export type { KanbanColumn, JobStatus, Project, OutputEntry, RawMessage, PendingQuestion, FollowUp, Job, GitSnapshot, ShortcutBinding, AppSettings } from '../../shared/types';
export { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, DEFAULT_COMMIT_PROMPT } from '../../shared/types';
import type { Project, Job, OutputEntry, RawMessage, PendingQuestion, AppSettings } from '../../shared/types';

// IPC API exposed via preload
export interface ElectronAPI {
  // Projects
  projectsList: () => Promise<Project[]>;
  projectsAdd: () => Promise<Project | null>;
  projectsRename: (id: string, name: string) => Promise<Project | undefined>;
  projectsRemove: (id: string) => Promise<void>;
  projectsReorder: (orderedIds: string[]) => Promise<Project[]>;
  projectsSetDefaultBranch: (id: string, branch: string | null) => Promise<Project | undefined>;

  // Git
  gitListBranches: (projectId: string) => Promise<{ branches: string[]; current: string } | null>;
  gitBranchesStatus: (projectId: string) => Promise<{ name: string; isCurrent: boolean; ahead: number; dirtyFiles: number }[] | null>;
  gitPush: (projectId: string, branch: string) => Promise<{ success: boolean; error?: string }>;

  // Jobs
  jobsList: () => Promise<Job[]>;
  jobsCreate: (projectId: string, prompt: string, skipPlanning?: boolean, images?: string[], branch?: string) => Promise<Job>;
  saveImage: (dataBase64: string, filename: string, projectId: string) => Promise<string>;
  jobsCancel: (jobId: string) => Promise<void>;
  jobsDelete: (jobId: string) => Promise<void>;
  jobsRetry: (jobId: string) => Promise<Job>;
  jobsRespond: (jobId: string, response: string) => Promise<void>;
  jobsEditPlan: (jobId: string, feedback: string) => Promise<Job>;
  jobsAcceptPlan: (jobId: string) => Promise<void>;
  jobsGetDiff: (jobId: string) => Promise<string | null>;
  jobsAcceptJob: (jobId: string, commitMessage?: string) => Promise<void>;
  jobsGenerateCommitMessage: (jobId: string) => Promise<string>;
  jobsRejectJob: (jobId: string, snapshotIndex?: number) => Promise<void>;
  jobsFollowUp: (jobId: string, prompt: string) => Promise<Job>;

  // Settings
  settingsGet: () => Promise<AppSettings>;
  settingsUpdate: (partial: Partial<AppSettings>) => Promise<AppSettings>;

  // CLAUDE.md
  claudeMdRead: (projectId: string) => Promise<{ exists: boolean; content: string }>;
  claudeMdInit: (projectId: string) => Promise<{ exists: boolean; content: string }>;
  claudeMdWrite: (projectId: string, content: string) => Promise<{ success: boolean }>;

  // Events (renderer listens)
  onJobStatusChanged: (callback: (job: Job) => void) => () => void;
  onJobOutputBatch: (callback: (data: { jobId: string; entries: OutputEntry[] }) => void) => () => void;
  onJobRawMessageBatch: (callback: (data: { jobId: string; messages: RawMessage[] }) => void) => () => void;
  onJobNeedsInput: (callback: (data: { jobId: string; question: PendingQuestion }) => void) => () => void;
  onJobError: (callback: (data: { jobId: string; error: string }) => void) => () => void;
  onJobComplete: (callback: (data: { jobId: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
