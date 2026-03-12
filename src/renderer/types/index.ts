export type { KanbanColumn, JobStatus, Project, OutputEntry, RawMessage, PendingQuestion, FollowUp, Job, GitSnapshot, JobStepSnapshot, JobFileSnapshot, ShortcutBinding, AppSettings, ThemeMode, ModelChoice, EffortLevel, ModelOption, EffortOption, PromptConfig, PromptId, PreferredEditor, PermissionMode, PermissionModeOption, ProjectColorId, CliHealthStatus, PhaseTokenUsage, Skill } from '../../shared/types';
export { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, DEFAULT_COMMIT_PROMPT, DEFAULT_PROMPT_CONFIGS, PROMPT_IDS, MODEL_CATALOG, EFFORT_CATALOG, PROJECT_COLORS, getProjectColor, PERMISSION_MODE_CATALOG } from '../../shared/types';

import type { Project, Job, OutputEntry, RawMessage, PendingQuestion, AppSettings, ModelChoice, EffortLevel, CliHealthStatus, Skill } from '../../shared/types';

// IPC API exposed via preload
export interface ElectronAPI {
  // CLI Health
  cliCheckHealth: () => Promise<CliHealthStatus>;
  cliStartLogin: () => Promise<void>;
  cliLoginWrite: (data: string) => Promise<void>;
  cliLoginKill: () => Promise<void>;
  onCliLoginData: (callback: (data: string) => void) => () => void;
  onCliLoginExit: (callback: (exitCode: number) => void) => () => void;

  // Shell
  shellOpenExternal: (url: string) => Promise<void>;

  // Projects
  projectsList: () => Promise<Project[]>;
  projectsAdd: () => Promise<Project | null>;
  projectsRename: (id: string, name: string) => Promise<Project | undefined>;
  projectsRemove: (id: string) => Promise<void>;
  projectsReorder: (orderedIds: string[]) => Promise<Project[]>;
  projectsSetDefaultBranch: (id: string, branch: string | null) => Promise<Project | undefined>;
  projectsSetColor: (id: string, color: string | null) => Promise<Project | undefined>;
  projectsOpenInEditor: (id: string, branch?: string) => Promise<{ success: boolean; editor?: string; error?: string }>;
  projectsOpenFolder: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Git
  gitListBranches: (projectId: string) => Promise<{ branches: string[]; current: string } | null>;
  gitBranchesStatus: (projectId: string) => Promise<{ name: string; isCurrent: boolean; ahead: number; dirtyFiles: number }[] | null>;
  gitPush: (projectId: string, branch: string) => Promise<{ success: boolean; error?: string }>;
  gitCommit: (
    projectId: string,
    message: string,
    branch?: string,
  ) => Promise<{ success: boolean; sha?: string; error?: string; deletedJobIds?: string[]; warning?: string }>;
  gitGenerateCommitMessage: (projectId: string, branch?: string) => Promise<string>;

  // Jobs
  jobsList: () => Promise<Job[]>;
  jobsCreate: (projectId: string, prompt: string, skipPlanning?: boolean, images?: string[], branch?: string, model?: ModelChoice, effort?: EffortLevel) => Promise<Job>;
  saveImage: (dataBase64: string, filename: string, projectId: string) => Promise<string>;
  jobsCancel: (jobId: string) => Promise<void>;
  jobsDelete: (jobId: string, options?: { rollback?: boolean }) => Promise<void>;
  jobsRetry: (jobId: string, message?: string) => Promise<Job>;
  jobsRespond: (jobId: string, response: string) => Promise<void>;
  jobsSteer: (jobId: string, message: string) => Promise<void>;
  jobsAcceptPlan: (jobId: string) => Promise<Job>;
  jobsEditPlan: (jobId: string, feedback: string) => Promise<Job>;
  jobsGetDiff: (jobId: string) => Promise<string | null>;
  jobsRejectJob: (jobId: string, snapshotIndex?: number) => Promise<void>;
  jobsFollowUp: (jobId: string, prompt: string) => Promise<Job>;

  // Files
  filesList: (projectId: string) => Promise<string[]>;

  // Settings
  settingsGet: () => Promise<AppSettings>;
  settingsUpdate: (partial: Partial<AppSettings>) => Promise<AppSettings>;

  // Theme
  themeGetActual: () => Promise<'light' | 'dark'>;
  onThemeChanged: (callback: (actual: 'light' | 'dark') => void) => () => void;

  // CLAUDE.md
  claudeMdRead: (projectId: string) => Promise<{ exists: boolean; content: string }>;
  claudeMdInit: (projectId: string) => Promise<{ exists: boolean; content: string }>;
  claudeMdWrite: (projectId: string, content: string) => Promise<{ success: boolean }>;

  // Skills
  skillsList: (projectId?: string) => Promise<Skill[]>;

  // App
  appGetVersion: () => Promise<string>;

  // Updater
  updaterCheck: () => Promise<void>;
  updaterDownload: () => Promise<void>;
  updaterInstall: () => Promise<void>;
  onUpdaterUpdateAvailable: (callback: (data: { version: string; releaseNotes?: string }) => void) => () => void;
  onUpdaterDownloadProgress: (callback: (data: { percent: number }) => void) => () => void;
  onUpdaterUpdateDownloaded: (callback: () => void) => () => void;
  onUpdaterUpToDate: (callback: () => void) => () => void;
  onUpdaterError: (callback: (message: string) => void) => () => void;

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
