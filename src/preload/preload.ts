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
  gitCommit: (projectId, message, branch) => ipcRenderer.invoke('git:commit', projectId, message, branch),
  gitGenerateCommitMessage: (projectId, branch) => ipcRenderer.invoke('git:generate-commit-message', projectId, branch),

  // Jobs
  jobsList: () => ipcRenderer.invoke('jobs:list'),
  jobsCreate: (projectId, prompt, skipPlanning, images, branch, model, effort) => ipcRenderer.invoke('jobs:create', projectId, prompt, skipPlanning, images, branch, model, effort),
  saveImage: (dataBase64, filename, projectId) => ipcRenderer.invoke('images:save', dataBase64, filename, projectId),
  jobsCancel: (jobId) => ipcRenderer.invoke('jobs:cancel', jobId),
  jobsDelete: (jobId, options) => ipcRenderer.invoke('jobs:delete', jobId, options),
  jobsRetry: (jobId, message) => ipcRenderer.invoke('jobs:retry', jobId, message),
  jobsRespond: (jobId, response) => ipcRenderer.invoke('jobs:respond', jobId, response),
  jobsSteer: (jobId, message) => ipcRenderer.invoke('jobs:steer', jobId, message),
  jobsAcceptPlan: (jobId) => ipcRenderer.invoke('jobs:accept-plan', jobId),
  jobsEditPlan: (jobId, feedback) => ipcRenderer.invoke('jobs:edit-plan', jobId, feedback),
  jobsGetDiff: (jobId) => ipcRenderer.invoke('jobs:get-diff', jobId),
  jobsRejectJob: (jobId, snapshotIndex) => ipcRenderer.invoke('jobs:reject-job', jobId, snapshotIndex),
  jobsFollowUp: (jobId, prompt) => ipcRenderer.invoke('jobs:follow-up', jobId, prompt),

  // Files
  filesList: (projectId) => ipcRenderer.invoke('files:list', projectId),

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
