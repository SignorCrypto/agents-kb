import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../renderer/types/index';

const api: ElectronAPI = {
  // Projects
  projectsList: () => ipcRenderer.invoke('projects:list'),
  projectsAdd: () => ipcRenderer.invoke('projects:add'),
  projectsRename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
  projectsRemove: (id) => ipcRenderer.invoke('projects:remove', id),
  projectsReorder: (orderedIds) => ipcRenderer.invoke('projects:reorder', orderedIds),
  projectsSetDefaultBranch: (id, branch) => ipcRenderer.invoke('projects:set-default-branch', id, branch),
  projectsSetColor: (id, color) => ipcRenderer.invoke('projects:set-color', id, color),
  projectsOpenInEditor: (id, branch) => ipcRenderer.invoke('projects:open-in-editor', id, branch),
  projectsOpenFolder: (id) => ipcRenderer.invoke('projects:open-folder', id),

  // Git
  gitListBranches: (projectId) => ipcRenderer.invoke('git:list-branches', projectId),
  gitBranchesStatus: (projectId) => ipcRenderer.invoke('git:branches-status', projectId),
  gitPush: (projectId, branch) => ipcRenderer.invoke('git:push', projectId, branch),
  gitCommit: (projectId, message, branch, files) => ipcRenderer.invoke('git:commit', projectId, message, branch, files),
  gitGenerateCommitMessage: (projectId, branch) => ipcRenderer.invoke('git:generate-commit-message', projectId, branch),
  gitLog: (projectId: string, page?: number, branch?: string) => ipcRenderer.invoke('git:log', projectId, page, branch),
  gitListChangedFiles: (projectId) => ipcRenderer.invoke('git:list-changed-files', projectId),
  gitDiffFile: (projectId, filePath, isUntracked) => ipcRenderer.invoke('git:diff-file', projectId, filePath, isUntracked),
  gitDiscardFile: (projectId, filePath, isUntracked) => ipcRenderer.invoke('git:discard-file', projectId, filePath, isUntracked),
  gitUnpushedCommits: (projectId, branch) => ipcRenderer.invoke('git:unpushed-commits', projectId, branch),

  // Jobs
  jobsList: () => ipcRenderer.invoke('jobs:list'),
  jobsCreate: (projectId, prompt, skipPlanning, images, branch, model, thinkingMode, effort) => ipcRenderer.invoke('jobs:create', projectId, prompt, skipPlanning, images, branch, model, thinkingMode, effort),
  jobsCancel: (jobId) => ipcRenderer.invoke('jobs:cancel', jobId),
  jobsDelete: (jobId, options) => ipcRenderer.invoke('jobs:delete', jobId, options),
  jobsRetry: (jobId, message, images) => ipcRenderer.invoke('jobs:retry', jobId, message, images),
  jobsRespond: (jobId, response) => ipcRenderer.invoke('jobs:respond', jobId, response),
  jobsSteer: (jobId, message, images) => ipcRenderer.invoke('jobs:steer', jobId, message, images),
  jobsUpdateDrafts: (jobId, patch, version) => ipcRenderer.invoke('jobs:update-drafts', jobId, patch, version),
  jobsAcceptPlan: (jobId) => ipcRenderer.invoke('jobs:accept-plan', jobId),
  jobsEditPlan: (jobId, feedback, images) => ipcRenderer.invoke('jobs:edit-plan', jobId, feedback, images),
  jobsGetDiff: (jobId) => ipcRenderer.invoke('jobs:get-diff', jobId),
  jobsRejectJob: (jobId, snapshotIndex) => ipcRenderer.invoke('jobs:reject-job', jobId, snapshotIndex),
  jobsFollowUp: (jobId, prompt, images) => ipcRenderer.invoke('jobs:follow-up', jobId, prompt, images),

  // File Rewind
  jobsRewindPreview: (jobId, userMessageId) => ipcRenderer.invoke('jobs:rewind-preview', jobId, userMessageId),
  jobsRewindFiles: (jobId, userMessageId) => ipcRenderer.invoke('jobs:rewind-files', jobId, userMessageId),
  jobsRewindMessages: (jobId) => ipcRenderer.invoke('jobs:rewind-messages', jobId),

  // Files
  filesList: (projectId) => ipcRenderer.invoke('files:list', projectId),
  filesOpenInEditor: (projectId, filePath) => ipcRenderer.invoke('files:open-in-editor', projectId, filePath),

  // CLI Health
  cliCheckHealth: () => ipcRenderer.invoke('cli:check-health'),
  cliStartLogin: () => ipcRenderer.invoke('cli:start-login'),
  cliLoginWrite: (data) => ipcRenderer.invoke('cli:login-write', data),
  cliLoginKill: () => ipcRenderer.invoke('cli:login-kill'),
  onCliLoginData: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on('cli:login-data', handler);
    return () => ipcRenderer.removeListener('cli:login-data', handler);
  },
  onCliLoginExit: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, exitCode: number) => callback(exitCode);
    ipcRenderer.on('cli:login-exit', handler);
    return () => ipcRenderer.removeListener('cli:login-exit', handler);
  },

  // Shell
  shellOpenExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Editors
  editorsDetectInstalled: () => ipcRenderer.invoke('editors:detect-installed'),

  // Settings
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (partial) => ipcRenderer.invoke('settings:update', partial),

  // Theme
  themeGetActual: () => ipcRenderer.invoke('theme:get-actual'),
  onThemeChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, actual: 'light' | 'dark') => callback(actual);
    ipcRenderer.on('theme:changed', handler);
    return () => ipcRenderer.removeListener('theme:changed', handler);
  },

  // CLAUDE.md
  claudeMdRead: (projectId) => ipcRenderer.invoke('claudemd:read', projectId),
  claudeMdInit: (projectId) => ipcRenderer.invoke('claudemd:init', projectId),
  claudeMdWrite: (projectId, content) => ipcRenderer.invoke('claudemd:write', projectId, content),

  // Skills
  skillsList: (projectId?) => ipcRenderer.invoke('skills:list', projectId),

  // Models
  modelsList: () => ipcRenderer.invoke('models:list'),

  // Account
  accountInfo: () => ipcRenderer.invoke('account:info'),
  onAccountUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
    ipcRenderer.on('account:updated', handler);
    return () => ipcRenderer.removeListener('account:updated', handler);
  },
  onModelsUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
    ipcRenderer.on('models:updated', handler);
    return () => ipcRenderer.removeListener('models:updated', handler);
  },

  // App
  appGetPlatform: () => process.platform,
  appGetVersion: () => ipcRenderer.invoke('app:get-version'),

  // Updater
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  onUpdaterUpdateAvailable: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { version: string; releaseNotes?: string }) => callback(data);
    ipcRenderer.on('updater:update-available', handler);
    return () => ipcRenderer.removeListener('updater:update-available', handler);
  },
  onUpdaterDownloadProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { percent: number }) => callback(data);
    ipcRenderer.on('updater:download-progress', handler);
    return () => ipcRenderer.removeListener('updater:download-progress', handler);
  },
  onUpdaterUpdateDownloaded: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('updater:update-downloaded', handler);
    return () => ipcRenderer.removeListener('updater:update-downloaded', handler);
  },
  onUpdaterUpToDate: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('updater:up-to-date', handler);
    return () => ipcRenderer.removeListener('updater:up-to-date', handler);
  },
  onUpdaterError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on('updater:error', handler);
    return () => ipcRenderer.removeListener('updater:error', handler);
  },

  // Events
  onJobStatusChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
    ipcRenderer.on('job:status-changed', handler);
    return () => ipcRenderer.removeListener('job:status-changed', handler);
  },
  onJobOutputBatch: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
    ipcRenderer.on('job:output-batch', handler);
    return () => ipcRenderer.removeListener('job:output-batch', handler);
  },
  onJobRawMessageBatch: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
    ipcRenderer.on('job:raw-message-batch', handler);
    return () => ipcRenderer.removeListener('job:raw-message-batch', handler);
  },
  onJobStreamingBatch: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
    ipcRenderer.on('job:streaming-batch', handler);
    return () => ipcRenderer.removeListener('job:streaming-batch', handler);
  },
  onJobNeedsInput: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
    ipcRenderer.on('job:needs-input', handler);
    return () => ipcRenderer.removeListener('job:needs-input', handler);
  },
  onJobError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
    ipcRenderer.on('job:error', handler);
    return () => ipcRenderer.removeListener('job:error', handler);
  },
  onJobComplete: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data);
    ipcRenderer.on('job:complete', handler);
    return () => ipcRenderer.removeListener('job:complete', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
