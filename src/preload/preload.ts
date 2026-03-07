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

  // Git
  gitListBranches: (projectId) => ipcRenderer.invoke('git:list-branches', projectId),
  gitBranchesStatus: (projectId) => ipcRenderer.invoke('git:branches-status', projectId),
  gitPush: (projectId, branch) => ipcRenderer.invoke('git:push', projectId, branch),

  // Jobs
  jobsList: () => ipcRenderer.invoke('jobs:list'),
  jobsCreate: (projectId, prompt, skipPlanning, images, branch) => ipcRenderer.invoke('jobs:create', projectId, prompt, skipPlanning, images, branch),
  saveImage: (dataBase64, filename, projectId) => ipcRenderer.invoke('images:save', dataBase64, filename, projectId),
  jobsCancel: (jobId) => ipcRenderer.invoke('jobs:cancel', jobId),
  jobsDelete: (jobId) => ipcRenderer.invoke('jobs:delete', jobId),
  jobsRetry: (jobId) => ipcRenderer.invoke('jobs:retry', jobId),
  jobsRespond: (jobId, response) => ipcRenderer.invoke('jobs:respond', jobId, response),
  jobsEditPlan: (jobId, feedback) => ipcRenderer.invoke('jobs:edit-plan', jobId, feedback),
  jobsAcceptPlan: (jobId) => ipcRenderer.invoke('jobs:accept-plan', jobId),
  jobsGetDiff: (jobId) => ipcRenderer.invoke('jobs:get-diff', jobId),
  jobsAcceptJob: (jobId, commitMessage) => ipcRenderer.invoke('jobs:accept-job', jobId, commitMessage),
  jobsGenerateCommitMessage: (jobId) => ipcRenderer.invoke('jobs:generate-commit-message', jobId),
  jobsRejectJob: (jobId, snapshotIndex) => ipcRenderer.invoke('jobs:reject-job', jobId, snapshotIndex),
  jobsFollowUp: (jobId, prompt) => ipcRenderer.invoke('jobs:follow-up', jobId, prompt),

  // Settings
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (partial) => ipcRenderer.invoke('settings:update', partial),

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
