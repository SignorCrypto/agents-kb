import { ipcMain, dialog, BrowserWindow, nativeTheme, shell } from 'electron';
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
import { isGitRepoRoot, captureSnapshot, restoreSnapshot, cleanupSnapshot, cleanupAllSnapshots, getDiff, listBranches, checkoutBranch, gitStageAll, gitCommit, getBranchesStatus, gitPush } from './git-snapshot';
import { listProjectFiles } from './file-list';
import type { Job, OutputEntry, RawMessage, PendingQuestion, AppSettings, Project, ModelChoice, EffortLevel, PromptConfig } from '../shared/types';
import { DEFAULT_PROMPT_CONFIGS } from '../shared/types';

type WindowGetter = () => BrowserWindow | null;

/** Extract file paths touched by Write/Edit tools from the output log */
function extractEditedFilePaths(entries: OutputEntry[]): string[] {
  const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
  const seen = new Set<string>();
  let currentTool = '';
  let toolBuffer = '';

  const flush = () => {
    if (FILE_TOOLS.has(currentTool) && toolBuffer) {
      try {
        const parsed = JSON.parse(toolBuffer);
        const filePath = (parsed.file_path || parsed.notebook_path) as string | undefined;
        if (filePath) seen.add(filePath);
      } catch { /* incomplete JSON */ }
    }
    currentTool = '';
    toolBuffer = '';
  };

  for (const entry of entries) {
    if (entry.type === 'tool-use') {
      if (entry.toolName && entry.content === '') {
        flush();
        currentTool = entry.toolName;
      } else if (entry.toolName && entry.content) {
        flush();
        currentTool = entry.toolName;
        toolBuffer = entry.content;
        flush();
      } else {
        toolBuffer += entry.content;
      }
    } else {
      flush();
    }
  }
  flush();

  return Array.from(seen);
}

function projectIsGitRepo(p: Project): boolean {
  return p.isGitRepo !== false;
}

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

// Cache of pre-generated commit messages keyed by "projectId:branch"
const commitMessageCache = new Map<string, string>();

async function generateAndCacheBranchCommitMessage(projectId: string, branch: string) {
  const project = getProjects().find(p => p.id === projectId);
  if (!project) return;
  try {
    const config = getPromptConfig('commit');
    const prompt = buildPromptText(config);
    const message = await runClaudePrint(project.path, prompt, { model: config.model, effort: config.effort });
    if (message) {
      commitMessageCache.set(`${projectId}:${branch}`, message);
    }
  } catch {
    // Best-effort
  }
}

async function startClaudeSession(job: Job, getWindow: WindowGetter, batchedSender: BatchedSender, phase: 'plan' | 'dev', sessionId?: string) {
  const project = getProjects().find(p => p.id === job.projectId);
  if (!project) throw new Error('Project not found');

  // Check out the target branch if specified (git repos only)
  if (job.branch && projectIsGitRepo(project)) {
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

  // Resolve effective model and effort: job overrides > settings defaults
  const settings = getSettings();
  const effectiveModel = job.model || settings.defaultModel;
  const effectiveEffort = job.effort || settings.defaultEffort;

  const session = sessionManager.create({
    jobId: job.id,
    projectPath: project.path,
    prompt,
    phase,
    sessionId,
    images: job.images,
    model: effectiveModel !== 'default' ? effectiveModel : undefined,
    effort: effectiveEffort !== 'default' ? effectiveEffort : undefined,
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
      notifyInputNeeded(job.id, project.name, job.title || job.prompt, question.text, getWindow);
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
        notifyPlanReady(job.id, project.name, job.title || job.prompt, getWindow);
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
          notifyJobError(job.id, project.name, job.title || job.prompt, updated.error!, getWindow);
        }
      }
      return;
    }

    if (phase === 'dev') {
      // Extract edited files from output log before completion
      const outputLog = getOutputLog(job.id);
      const editedFiles = extractEditedFilePaths(outputLog);

      const updated = updateJob(job.id, {
        column: 'done',
        status: 'completed',
        pendingQuestion: undefined,
        completedAt: new Date().toISOString(),
        editedFiles: editedFiles.length > 0 ? editedFiles : undefined,
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
        sendToRenderer(getWindow, 'job:complete', { jobId: job.id });
        notifyJobComplete(job.id, project.name, job.title || job.prompt, getWindow);

        // Pre-generate branch commit messages for the project commit flow.
        const completedProject = getProjects().find(p => p.id === job.projectId);
        if (completedProject && projectIsGitRepo(completedProject)) {
          (async () => {
            const branch = job.branch || (await listBranches(completedProject.path))?.current;
            if (branch) generateAndCacheBranchCommitMessage(job.projectId, branch);
          })();
        }
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
          notifyPlanReady(job.id, project.name, job.title || job.prompt, getWindow);
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
      notifyJobError(job.id, project.name, job.title || job.prompt, errorMsg, getWindow);
    }
  });

  session.start();
  return session;
}

function getPromptConfig(promptId: string): PromptConfig {
  const settings = getSettings();
  return settings.promptConfigs[promptId] ?? DEFAULT_PROMPT_CONFIGS[promptId as keyof typeof DEFAULT_PROMPT_CONFIGS];
}

function buildPromptText(config: PromptConfig, extra?: string): string {
  return config.prompt + (config.suffix || '') + (extra || '');
}

function runClaudePrint(projectPath: string, prompt: string, options?: { model?: string; effort?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process') as typeof import('child_process');
    const args = ['-p'];
    const model = options?.model && options.model !== 'default' ? options.model : 'haiku';
    args.push('--model', model);
    if (options?.effort && options.effort !== 'default') {
      args.push('--effort', options.effort);
    }
    const child = spawn('claude', args, {
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

async function generateTitleInBackground(
  jobId: string,
  prompt: string,
  projectPath: string,
  getWindow: WindowGetter,
  followUpIndex?: number,
  context?: string
) {
  try {
    const config = getPromptConfig('title');
    let titlePrompt = `${config.prompt}\n\n`;
    if (context) {
      titlePrompt += `Context: ${context}\n\n`;
    }
    titlePrompt += `Task: ${prompt}`;
    const title = await runClaudePrint(projectPath, titlePrompt, { model: config.model, effort: config.effort });
    if (!title?.trim()) return;

    const current = getJob(jobId);
    if (!current) return;

    if (followUpIndex !== undefined) {
      const followUps = [...(current.followUps || [])];
      if (followUps[followUpIndex]) {
        followUps[followUpIndex] = { ...followUps[followUpIndex], title: title.trim() };
        const updated = updateJob(jobId, { followUps });
        if (updated) sendToRenderer(getWindow, 'job:status-changed', updated);
      }
    } else {
      const updated = updateJob(jobId, { title: title.trim() });
      if (updated) sendToRenderer(getWindow, 'job:status-changed', updated);
    }
  } catch {
    // Best-effort
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
    const isGitRepo = await isGitRepoRoot(folderPath);
    const project = {
      id: uuidv4(),
      name: path.basename(folderPath),
      path: folderPath,
      addedAt: new Date().toISOString(),
      isGitRepo,
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

  ipcMain.handle('projects:open-in-editor', async (_event, projectId: string, branch?: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };

    // Check git status — isGitRepo may be undefined for older projects
    const isGit = project.isGitRepo ?? await isGitRepoRoot(project.path);

    // Non-git projects: open folder in file manager
    if (!isGit) {
      await shell.openPath(project.path);
      return { success: true, editor: 'finder' };
    }

    // Checkout branch if specified
    if (branch) {
      try {
        await checkoutBranch(project.path, branch);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to checkout branch';
        return { success: false, error: message };
      }
    }

    // Git repos: open in preferred editor
    const settings = getSettings();
    const preferred = settings.preferredEditor ?? 'auto';
    const { spawn: spawnProc } = await import('child_process');
    const { existsSync } = await import('fs');

    // Editor definitions with bundled CLI paths inside .app bundles (macOS)
    const EDITORS: { key: string; cli: string; appBin: string; appDir: string }[] = [
      {
        key: 'cursor',
        cli: 'cursor',
        appBin: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
        appDir: '/Applications/Cursor.app',
      },
      {
        key: 'vscode',
        cli: 'code',
        appBin: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
        appDir: '/Applications/Visual Studio Code.app',
      },
    ];

    const tryEditor = (editor: typeof EDITORS[number]): boolean => {
      // 1) macOS: use the CLI script bundled inside the .app
      if (process.platform === 'darwin' && existsSync(editor.appBin)) {
        const child = spawnProc(editor.appBin, [project.path], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return true;
      }

      return false;
    };

    const order: typeof EDITORS[number][] =
      preferred === 'cursor' ? [EDITORS[0]] :
      preferred === 'vscode' ? [EDITORS[1]] :
      EDITORS; // auto: try cursor first, then vscode

    for (const editor of order) {
      if (tryEditor(editor)) return { success: true, editor: editor.key };
    }

    // No editor found — open folder
    await shell.openPath(project.path);
    return { success: true, editor: 'finder' };
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

  ipcMain.handle('git:commit', async (_event, projectId: string, message: string, branch?: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };
    try {
      await gitStageAll(project.path);
      const sha = await gitCommit(project.path, message);
      // Clear cached commit message for this branch
      if (branch) commitMessageCache.delete(`${projectId}:${branch}`);
      return { success: true, sha };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('git:generate-commit-message', async (_event, projectId: string, branch?: string) => {
    // Return cached message if available
    if (branch) {
      const cacheKey = `${projectId}:${branch}`;
      const cached = commitMessageCache.get(cacheKey);
      if (cached) {
        commitMessageCache.delete(cacheKey);
        return cached;
      }
    }
    const project = getProjects().find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');
    const config = getPromptConfig('commit');
    const prompt = buildPromptText(config);
    return runClaudePrint(project.path, prompt, { model: config.model, effort: config.effort });
  });

  // === Files ===
  const fileCache = new Map<string, { files: string[]; timestamp: number }>();
  const FILE_CACHE_TTL = 30_000;

  ipcMain.handle('files:list', async (_event, projectId: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) return [];

    const cached = fileCache.get(projectId);
    if (cached && Date.now() - cached.timestamp < FILE_CACHE_TTL) {
      return cached.files;
    }

    const files = await listProjectFiles(project.path, project.isGitRepo !== false);
    fileCache.set(projectId, { files, timestamp: Date.now() });
    return files;
  });

  // === Jobs ===
  ipcMain.handle('jobs:list', () => {
    return getJobs();
  });

  ipcMain.handle('jobs:create', async (_event, projectId: string, prompt: string, skipPlanning?: boolean, images?: string[], branch?: string, model?: ModelChoice, effort?: EffortLevel) => {
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
      ...(model && model !== 'default' ? { model } : {}),
      ...(effort && effort !== 'default' ? { effort } : {}),
      outputLog: [],
      rawMessages: [],
    };

    // Capture git snapshot before dev phase (skip-planning jobs go straight to dev, git repos only)
    if (skipPlanning) {
      const project = getProjects().find(p => p.id === projectId);
      if (project && projectIsGitRepo(project)) {
        const snapshot = await captureSnapshot(project.path, job.id, 0, 'Original');
        if (snapshot) job.gitSnapshots = [snapshot];
      }
    }

    saveJob(job);

    // Generate title in background (non-blocking)
    const titleProject = getProjects().find(p => p.id === projectId);
    if (titleProject) {
      generateTitleInBackground(job.id, prompt, titleProject.path, getWindow);
    }

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

    // Accumulate previous phase elapsed time before resetting
    const nowMs = new Date(now).getTime();
    let elapsedUpdate: Partial<Job> = {};
    if (phase === 'plan' && job.planningStartedAt) {
      const prev = job.planningElapsedMs || 0;
      const elapsed = nowMs - new Date(job.planningStartedAt).getTime() - (job.totalPausedMs || 0);
      elapsedUpdate = { planningElapsedMs: prev + elapsed, planningStartedAt: now };
    } else if (phase === 'dev' && job.developmentStartedAt) {
      const prev = job.developmentElapsedMs || 0;
      const elapsed = nowMs - new Date(job.developmentStartedAt).getTime() - (job.totalPausedMs || 0);
      elapsedUpdate = { developmentElapsedMs: prev + elapsed, developmentStartedAt: now };
    } else {
      elapsedUpdate = phase === 'plan' ? { planningStartedAt: now } : { developmentStartedAt: now };
    }

    const updated = updateJob(jobId, {
      status: 'running',
      error: undefined,
      pendingQuestion: undefined,
      totalPausedMs: 0,
      waitingStartedAt: undefined,
      ...elapsedUpdate,
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

    // Capture snapshot before this follow-up (git repos only)
    const snapshots = [...(job.gitSnapshots || [])];
    const project = getProjects().find(p => p.id === job.projectId);
    if (project && projectIsGitRepo(project)) {
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

    // Accumulate previous dev elapsed time before resetting
    let devElapsed = job.developmentElapsedMs || 0;
    if (job.developmentStartedAt && job.completedAt) {
      devElapsed += new Date(job.completedAt).getTime() - new Date(job.developmentStartedAt).getTime() - (job.totalPausedMs || 0);
    }

    const updated = updateJob(jobId, {
      column: 'development',
      status: 'running',
      completedAt: undefined,
      summaryText: undefined,
      developmentStartedAt: now,
      developmentElapsedMs: devElapsed,
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

      // Generate title for the follow-up in background, with job context
      if (project) {
        const prevContext = (job.title || job.prompt) + (job.summaryText ? `\n\nPrevious result: ${job.summaryText.slice(0, 300)}` : '');
        generateTitleInBackground(jobId, prompt, project.path, getWindow, followUps.length - 1, prevContext);
      }

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

    // Capture git snapshot before development starts (git repos only)
    const project = getProjects().find(p => p.id === job.projectId);
    const snapshots = [...(job.gitSnapshots || [])];
    if (snapshots.length === 0 && project && projectIsGitRepo(project)) {
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

    // Return stored diff if available from a previously resolved job.
    if (job.diffText != null) return job.diffText;

    // Compute live diff from the first (original) snapshot
    const snapshots = job.gitSnapshots || [];
    if (snapshots.length === 0) return null;
    const project = getProjects().find(p => p.id === job.projectId);
    if (!project) return null;

    return getDiff(project.path, snapshots[0]);
  });

  // === Settings ===
  ipcMain.handle('settings:get', () => {
    return getSettings();
  });

  ipcMain.handle('settings:update', (_event, partial: Partial<AppSettings>) => {
    const updated = updateSettings(partial);
    if (partial.theme) {
      nativeTheme.themeSource = partial.theme;
    }
    return updated;
  });

  // === Theme ===
  ipcMain.handle('theme:get-actual', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

  nativeTheme.on('updated', () => {
    const actual = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    sendToRenderer(getWindow, 'theme:changed', actual);
  });

  ipcMain.handle('jobs:reject-job', async (_event, jobId: string, snapshotIndex?: number) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');
    if (job.status !== 'completed') throw new Error('Job is not completed');

    const snapshots = job.gitSnapshots || [];

    // Non-git projects (no snapshots): just mark as rejected without rollback
    if (snapshots.length === 0) {
      const updated = updateJob(jobId, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
      }
      return;
    }

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
