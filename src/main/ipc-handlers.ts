import { ipcMain, dialog, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  getProjects,
  addProject,
  removeProject,
  renameProject,
  reorderProjects,
  setProjectDefaultBranch,
  getJobs,
  getJob,
  saveJob,
  updateJob,
  deleteJob,
  appendOutput,
  appendRawMessage,
  getOutputLog,
  getRawMessages,
  getSettings,
  updateSettings,
} from './store';
import { sessionManager } from './session-manager';
import { notifyInputNeeded, notifyPlanReady, notifyJobComplete, notifyJobError } from './notifications';
import { captureSnapshot, restoreSnapshot, cleanupSnapshot, cleanupAllSnapshots, getDiff, listBranches, checkoutBranch, gitStageAll, gitCommit, getBranchesStatus, gitPush } from './git-snapshot';
import type { Job, OutputEntry, RawMessage, PendingQuestion, AppSettings } from '../shared/types';

type WindowGetter = () => BrowserWindow | null;

function sendToRenderer(getWindow: WindowGetter, channel: string, data: unknown) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

// --- Batched IPC sender for high-frequency events ---
class BatchedSender {
  private outputBatches = new Map<string, OutputEntry[]>();
  private rawMessageBatches = new Map<string, RawMessage[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private getWindow: WindowGetter;

  constructor(getWindow: WindowGetter) {
    this.getWindow = getWindow;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), 50);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  pushOutput(jobId: string, entry: OutputEntry): void {
    let batch = this.outputBatches.get(jobId);
    if (!batch) {
      batch = [];
      this.outputBatches.set(jobId, batch);
    }
    batch.push(entry);
  }

  pushRawMessage(jobId: string, raw: RawMessage): void {
    let batch = this.rawMessageBatches.get(jobId);
    if (!batch) {
      batch = [];
      this.rawMessageBatches.set(jobId, batch);
    }
    batch.push(raw);
  }

  private flush(): void {
    for (const [jobId, entries] of this.outputBatches) {
      if (entries.length > 0) {
        sendToRenderer(this.getWindow, 'job:output-batch', { jobId, entries });
      }
    }
    this.outputBatches.clear();

    for (const [jobId, messages] of this.rawMessageBatches) {
      if (messages.length > 0) {
        sendToRenderer(this.getWindow, 'job:raw-message-batch', { jobId, messages });
      }
    }
    this.rawMessageBatches.clear();
  }
}

async function startClaudeSession(job: Job, getWindow: WindowGetter, batchedSender: BatchedSender, phase: 'plan' | 'dev', sessionId?: string) {
  const project = getProjects().find(p => p.id === job.projectId);
  if (!project) throw new Error('Project not found');

  // Check out the target branch if specified
  if (job.branch) {
    const branchInfo = await listBranches(project.path);
    if (branchInfo && branchInfo.current !== job.branch) {
      await checkoutBranch(project.path, job.branch);
    }
  }

  // For follow-ups, use the latest follow-up prompt (session is resumed so context is preserved)
  const latestFollowUp = job.followUps?.length ? job.followUps[job.followUps.length - 1].prompt : null;

  let prompt: string;
  if (latestFollowUp && phase === 'dev' && sessionId) {
    prompt = latestFollowUp;
  } else if (phase === 'dev') {
    if (job.skipPlanning) {
      prompt = job.prompt;
    } else if (job.planText) {
      prompt = `The following plan has been approved. Implement it now.\n\n--- APPROVED PLAN ---\n${job.planText}\n--- END PLAN ---`;
    } else {
      prompt = 'Continue with the approved plan. Implement the changes.';
    }
  } else {
    prompt = job.prompt;
  }

  const session = sessionManager.create({
    jobId: job.id,
    projectPath: project.path,
    prompt,
    phase,
    sessionId,
    images: job.images,
  });

  session.on('session-id', (sid: string) => {
    updateJob(job.id, { sessionId: sid });
  });

  session.on('raw-message', (raw: RawMessage) => {
    appendRawMessage(job.id, raw);
    batchedSender.pushRawMessage(job.id, raw);
  });

  session.on('output', (entry: OutputEntry) => {
    appendOutput(job.id, entry);
    batchedSender.pushOutput(job.id, entry);
  });

  session.on('needs-input', (question: PendingQuestion) => {
    const updated = updateJob(job.id, {
      status: 'waiting-input',
      pendingQuestion: question,
      waitingStartedAt: new Date().toISOString(),
    });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
      sendToRenderer(getWindow, 'job:needs-input', { jobId: job.id, question });
      notifyInputNeeded(job.id, question.text, getWindow);
    }
  });

  session.on('plan-text', (text: string) => {
    const updated = updateJob(job.id, { planText: text });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }
  });

  session.on('summary-text', (text: string) => {
    const updated = updateJob(job.id, { summaryText: text });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }
  });

  session.on('plan-complete', () => {
    if (phase === 'plan') {
      // Flush any remaining paused time
      const current = getJob(job.id);
      let totalPausedMs = current?.totalPausedMs || 0;
      if (current?.waitingStartedAt) {
        totalPausedMs += Date.now() - new Date(current.waitingStartedAt).getTime();
      }

      const updated = updateJob(job.id, {
        status: 'plan-ready',
        pendingQuestion: undefined,
        waitingStartedAt: undefined,
        planningEndedAt: new Date().toISOString(),
        totalPausedMs,
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
        notifyPlanReady(job.id, getWindow);
      }
    }
  });

  session.on('close', (code: number) => {
    const current = getJob(job.id);
    if (!current) return;

    if (code !== 0 || current.status === 'error') {
      if (current.status !== 'error') {
        const updated = updateJob(job.id, {
          status: 'error',
          error: `Claude process exited with code ${code}`,
        });
        if (updated) {
          sendToRenderer(getWindow, 'job:status-changed', updated);
          sendToRenderer(getWindow, 'job:error', { jobId: job.id, error: updated.error! });
          notifyJobError(job.id, updated.error!, getWindow);
        }
      }
      return;
    }

    if (phase === 'dev') {
      const updated = updateJob(job.id, {
        column: 'done',
        status: 'completed',
        pendingQuestion: undefined,
        completedAt: new Date().toISOString(),
        generatedCommitMessage: undefined,
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
        sendToRenderer(getWindow, 'job:complete', { jobId: job.id });
        notifyJobComplete(job.id, getWindow);

        // Generate commit message in the background
        generateCommitMessageInBackground(job.id, getWindow);
      }
    } else {
      if (current.status === 'running') {
        const updated = updateJob(job.id, {
          status: 'plan-ready',
          pendingQuestion: undefined,
          planningEndedAt: new Date().toISOString(),
        });
        if (updated) {
          sendToRenderer(getWindow, 'job:status-changed', updated);
          notifyPlanReady(job.id, getWindow);
        }
      }
    }
  });

  session.on('error', (errorMsg: string) => {
    const updated = updateJob(job.id, {
      status: 'error',
      error: errorMsg,
    });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
      sendToRenderer(getWindow, 'job:error', { jobId: job.id, error: errorMsg });
      notifyJobError(job.id, errorMsg, getWindow);
    }
  });

  session.start();
  return session;
}

function runClaudePrint(projectPath: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process') as typeof import('child_process');
    const child = spawn('claude', ['-p', '--model', 'haiku'], {
      cwd: projectPath,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderr}`));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function generateCommitMessageInBackground(jobId: string, getWindow: WindowGetter) {
  try {
    const job = getJob(jobId);
    if (!job) return;
    const project = getProjects().find(p => p.id === job.projectId);
    if (!project) return;

    const settings = getSettings();
    const prompt = settings.commitPrompt || 'Generate a concise conventional commit message for the current uncommitted changes. Output ONLY the commit message, nothing else.';
    const message = await runClaudePrint(project.path, prompt);
    if (!message) return;

    // Only store if job is still completed (not accepted/rejected in the meantime)
    const current = getJob(jobId);
    if (current?.status !== 'completed') return;

    const updated = updateJob(jobId, { generatedCommitMessage: message });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }
  } catch {
    // Best-effort — don't block anything on failure
  }
}

export function registerIpcHandlers(getWindow: WindowGetter): void {
  const batchedSender = new BatchedSender(getWindow);
  batchedSender.start();

  // === Projects ===
  ipcMain.handle('projects:list', () => {
    return getProjects();
  });

  ipcMain.handle('projects:add', async () => {
    const win = getWindow();
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const folderPath = result.filePaths[0];
    const project = {
      id: uuidv4(),
      name: path.basename(folderPath),
      path: folderPath,
      addedAt: new Date().toISOString(),
    };

    addProject(project);
    return project;
  });

  ipcMain.handle('projects:rename', (_event, id: string, name: string) => {
    return renameProject(id, name);
  });

  ipcMain.handle('projects:remove', (_event, id: string) => {
    const jobs = getJobs().filter(j => j.projectId === id);
    for (const job of jobs) {
      sessionManager.kill(job.id);
    }
    removeProject(id);
  });

  ipcMain.handle('projects:reorder', (_event, orderedIds: string[]) => {
    return reorderProjects(orderedIds);
  });

  ipcMain.handle('projects:set-default-branch', (_event, id: string, branch: string | null) => {
    return setProjectDefaultBranch(id, branch);
  });

  ipcMain.handle('git:list-branches', (_event, projectId: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) return null;
    return listBranches(project.path);
  });

  ipcMain.handle('git:branches-status', (_event, projectId: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) return null;
    return getBranchesStatus(project.path);
  });

  ipcMain.handle('git:push', (_event, projectId: string, branch: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };
    return gitPush(project.path, branch);
  });

  // === Jobs ===
  ipcMain.handle('jobs:list', () => {
    return getJobs();
  });

  ipcMain.handle('jobs:create', async (_event, projectId: string, prompt: string, skipPlanning?: boolean, images?: string[], branch?: string) => {
    const now = new Date().toISOString();
    const job: Job = {
      id: uuidv4(),
      projectId,
      prompt,
      column: skipPlanning ? 'development' : 'planning',
      status: 'running',
      createdAt: now,
      ...(skipPlanning
        ? { developmentStartedAt: now, skipPlanning: true }
        : { planningStartedAt: now }),
      ...(images && images.length > 0 ? { images } : {}),
      ...(branch ? { branch } : {}),
      outputLog: [],
      rawMessages: [],
    };

    // Capture git snapshot before dev phase (skip-planning jobs go straight to dev)
    if (skipPlanning) {
      const project = getProjects().find(p => p.id === projectId);
      if (project) {
        const snapshot = await captureSnapshot(project.path, job.id, 0, 'Original');
        if (snapshot) job.gitSnapshots = [snapshot];
      }
    }

    saveJob(job);

    await startClaudeSession(job, getWindow, batchedSender, skipPlanning ? 'dev' : 'plan');

    return job;
  });

  ipcMain.handle('images:save', (_event, dataBase64: string, filename: string, projectId: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');

    const tmpDir = path.join(os.tmpdir(), 'agent-kanban-images');
    fs.mkdirSync(tmpDir, { recursive: true });

    const ext = path.extname(filename) || '.png';
    const safeName = `${uuidv4()}${ext}`;
    const filePath = path.join(tmpDir, safeName);

    const buffer = Buffer.from(dataBase64, 'base64');
    fs.writeFileSync(filePath, buffer);

    return filePath;
  });

  ipcMain.handle('jobs:cancel', (_event, jobId: string) => {
    sessionManager.kill(jobId);
    const updated = updateJob(jobId, {
      status: 'error',
      error: 'Cancelled by user',
    });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }
  });

  ipcMain.handle('jobs:delete', async (_event, jobId: string) => {
    sessionManager.kill(jobId);
    const job = getJob(jobId);
    if (job?.gitSnapshots?.length) {
      const project = getProjects().find(p => p.id === job.projectId);
      if (project) {
        // Guard: refuse if another job on the same project is currently running
        const allJobs = getJobs();
        const runningOnSameProject = allJobs.some(
          j => j.id !== jobId && j.projectId === job.projectId && (j.status === 'running' || j.status === 'waiting-input')
        );
        if (runningOnSameProject) {
          throw new Error('Cannot delete while another job on this project is running');
        }

        // Rollback to original state before cleanup
        await restoreSnapshot(project.path, job.gitSnapshots[0]);
        await cleanupAllSnapshots(project.path, job.gitSnapshots);
      }
    }
    deleteJob(jobId);
  });

  ipcMain.handle('jobs:retry', async (_event, jobId: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    sessionManager.kill(jobId);

    const phase = job.column === 'development' ? 'dev' : 'plan';
    const now = new Date().toISOString();

    const outputLog = getOutputLog(jobId);
    outputLog.push({
      timestamp: new Date().toISOString(),
      type: 'system',
      content: `--- Retrying (${phase} phase) ---`,
    });

    const updated = updateJob(jobId, {
      status: 'running',
      error: undefined,
      pendingQuestion: undefined,
      ...(phase === 'plan' ? { planningStartedAt: now } : { developmentStartedAt: now }),
      outputLog,
    });

    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
      await startClaudeSession(updated, getWindow, batchedSender, phase);
    }

    return updated;
  });

  ipcMain.handle('jobs:respond', (_event, jobId: string, response: string) => {
    const session = sessionManager.get(jobId);
    if (session) {
      session.sendResponse(response);

      // Accumulate paused time
      const current = getJob(jobId);
      let totalPausedMs = current?.totalPausedMs || 0;
      if (current?.waitingStartedAt) {
        totalPausedMs += Date.now() - new Date(current.waitingStartedAt).getTime();
      }

      const updated = updateJob(jobId, {
        status: 'running',
        pendingQuestion: undefined,
        waitingStartedAt: undefined,
        totalPausedMs,
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
      }
    }
  });

  ipcMain.handle('jobs:edit-plan', async (_event, jobId: string, feedback: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    sessionManager.kill(jobId);

    const outputLog = getOutputLog(jobId);
    outputLog.push({
      timestamp: new Date().toISOString(),
      type: 'system',
      content: `--- Editing plan: ${feedback} ---`,
    });

    const updated = updateJob(jobId, {
      status: 'running',
      prompt: feedback,
      planText: undefined,
      pendingQuestion: undefined,
      outputLog,
    });

    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
      await startClaudeSession(updated, getWindow, batchedSender, 'plan', job.sessionId);
    }

    return updated;
  });

  ipcMain.handle('jobs:follow-up', async (_event, jobId: string, prompt: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');
    if (job.status !== 'completed') throw new Error('Job is not completed');

    const now = new Date().toISOString();
    const followUps = [...(job.followUps || []), { prompt, timestamp: now }];
    const followUpIndex = followUps.length;

    // Capture snapshot before this follow-up
    const snapshots = [...(job.gitSnapshots || [])];
    const project = getProjects().find(p => p.id === job.projectId);
    if (project) {
      const label = followUpIndex === 1
        ? 'After initial development'
        : `After follow-up #${followUpIndex - 1}`;
      const snapshot = await captureSnapshot(project.path, jobId, snapshots.length, label);
      if (snapshot) snapshots.push(snapshot);
    }

    const outputLog = getOutputLog(jobId);
    outputLog.push({
      timestamp: now,
      type: 'system',
      content: `--- Follow-up #${followUps.length}: ${prompt} ---`,
    });

    const updated = updateJob(jobId, {
      column: 'development',
      status: 'running',
      completedAt: undefined,
      summaryText: undefined,
      developmentStartedAt: now,
      totalPausedMs: 0,
      waitingStartedAt: undefined,
      pendingQuestion: undefined,
      error: undefined,
      diffText: undefined,
      followUps,
      gitSnapshots: snapshots,
      outputLog,
    });

    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
      await startClaudeSession(updated, getWindow, batchedSender, 'dev', job.sessionId);
    }

    return updated;
  });

  // === CLAUDE.md ===
  ipcMain.handle('claudemd:read', (_event, projectId: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');

    const filePath = path.join(project.path, 'CLAUDE.md');
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { exists: true, content };
    } catch {
      return { exists: false, content: '' };
    }
  });

  ipcMain.handle('claudemd:init', async (_event, projectId: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    await execFileAsync('claude', ['init', '-y'], {
      cwd: project.path,
      timeout: 60000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    const filePath = path.join(project.path, 'CLAUDE.md');
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { exists: true, content };
    } catch {
      return { exists: false, content: '' };
    }
  });

  ipcMain.handle('claudemd:write', (_event, projectId: string, content: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');

    const filePath = path.join(project.path, 'CLAUDE.md');
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  });

  ipcMain.handle('jobs:accept-plan', async (_event, jobId: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    const now = new Date().toISOString();

    // Capture git snapshot before development starts
    const project = getProjects().find(p => p.id === job.projectId);
    const snapshots = [...(job.gitSnapshots || [])];
    if (snapshots.length === 0 && project) {
      const snapshot = await captureSnapshot(project.path, jobId, 0, 'Original');
      if (snapshot) snapshots.push(snapshot);
    }

    const outputLog = getOutputLog(jobId);
    outputLog.push({
      timestamp: new Date().toISOString(),
      type: 'system',
      content: '--- Plan accepted. Starting development phase ---',
    });

    const updated = updateJob(jobId, {
      column: 'development',
      status: 'running',
      pendingQuestion: undefined,
      planningEndedAt: now,
      developmentStartedAt: now,
      gitSnapshots: snapshots,
      outputLog,
    });

    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
      await startClaudeSession(updated, getWindow, batchedSender, 'dev', job.sessionId);
    }
  });

  ipcMain.handle('jobs:get-diff', async (_event, jobId: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    // Return stored diff if available (from accepted/rejected jobs)
    if (job.diffText != null) return job.diffText;

    // Compute live diff from the first (original) snapshot
    const snapshots = job.gitSnapshots || [];
    if (snapshots.length === 0) return null;
    const project = getProjects().find(p => p.id === job.projectId);
    if (!project) return null;

    return getDiff(project.path, snapshots[0]);
  });

  ipcMain.handle('jobs:accept-job', async (_event, jobId: string, commitMessage?: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');
    if (job.status !== 'completed') throw new Error('Job is not completed');

    const project = getProjects().find(p => p.id === job.projectId);
    const snapshots = job.gitSnapshots || [];

    // Capture diff from original snapshot before cleaning up
    let diffText: string | undefined;
    if (snapshots.length > 0 && project) {
      diffText = await getDiff(project.path, snapshots[0]);
    }

    // Stage and commit if a message was provided
    let committedSha: string | undefined;
    if (commitMessage && project) {
      await gitStageAll(project.path);
      committedSha = await gitCommit(project.path, commitMessage);
    }

    if (snapshots.length > 0 && project) {
      await cleanupAllSnapshots(project.path, snapshots);
    }

    const updated = updateJob(jobId, {
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      gitSnapshots: undefined,
      diffText,
      committedSha,
    });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }
  });

  ipcMain.handle('jobs:generate-commit-message', async (_event, jobId: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    const project = getProjects().find(p => p.id === job.projectId);
    if (!project) throw new Error('Project not found');

    const settings = getSettings();
    const prompt = settings.commitPrompt || 'Generate a concise conventional commit message for the current uncommitted changes. Output ONLY the commit message, nothing else.';
    return runClaudePrint(project.path, prompt);
  });

  // === Settings ===
  ipcMain.handle('settings:get', () => {
    return getSettings();
  });

  ipcMain.handle('settings:update', (_event, partial: Partial<AppSettings>) => {
    return updateSettings(partial);
  });

  ipcMain.handle('jobs:reject-job', async (_event, jobId: string, snapshotIndex?: number) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');
    if (job.status !== 'completed') throw new Error('Job is not completed');

    const snapshots = job.gitSnapshots || [];
    if (snapshots.length === 0) throw new Error('No git snapshots available for rollback');

    // Default to first snapshot (original state) if no index specified
    const targetIndex = snapshotIndex ?? 0;
    if (targetIndex < 0 || targetIndex >= snapshots.length) {
      throw new Error('Invalid snapshot index');
    }
    const targetSnapshot = snapshots[targetIndex];

    const project = getProjects().find(p => p.id === job.projectId);
    if (!project) throw new Error('Project not found');

    // Guard: refuse if another job on the same project is currently running
    const allJobs = getJobs();
    const runningOnSameProject = allJobs.some(
      j => j.id !== jobId && j.projectId === job.projectId && (j.status === 'running' || j.status === 'waiting-input')
    );
    if (runningOnSameProject) {
      throw new Error('Cannot reject while another job on this project is running');
    }

    // Capture diff from original before restoring
    const diffText = await getDiff(project.path, snapshots[0]);

    await restoreSnapshot(project.path, targetSnapshot);
    await cleanupAllSnapshots(project.path, snapshots);

    const updated = updateJob(jobId, {
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      gitSnapshots: undefined,
      diffText,
    });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }
  });
}
