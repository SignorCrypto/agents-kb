import { app, ipcMain, dialog, BrowserWindow, nativeTheme, shell } from 'electron';
import { query as sdkQuery, fetchSupportedModels, withProjectScopedClaudeCodeOptions } from './sdk';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import {
  getProjects,
  addProject,
  removeProject,
  renameProject,
  reorderProjects,
  setProjectDefaultBranch,
  setProjectColor,
  getJobs,
  getJob,
  saveJob,
  updateJob,
  deleteJob,
  appendOutput,
  appendRawMessage,
  getOutputLog,
  getSettings,
  updateSettings,
} from './store';
import { sessionManager } from './session-manager';
import { notifyInputNeeded, notifyJobComplete, notifyJobError, notifyPlanReady } from './notifications';
import { checkCliHealth, spawnLogin, fetchAccountInfo } from './cli-health';
import { isDemoMode, getDemoProjects, getDemoJobs, getDemoSettings, getDemoBranchStatuses } from './demo-loader';
import { isGitRepoRoot, listBranches, checkoutBranch, gitStageAll, gitCommit, getBranchesStatus, gitPush } from './git-snapshot';
import { setSkillsCache, registerSkillsIpc } from './skills/index';
import { listProjectFiles } from './file-list';
import { TitleGenerationQueue } from './title-generation';
import type { Job, JobImage, JobDetailDrafts, JobComposerDraft, PendingQuestionDraft, OutputEntry, RawMessage, PendingQuestion, AppSettings, Project, ModelChoice, EffortLevel, PromptConfig, PermissionMode, DynamicModelInfo, ModelOption, Skill, AccountInfo, ThinkingMode } from '../shared/types';
import { DEFAULT_PROMPT_CONFIGS, normalizeEffortForThinking } from '../shared/types';
import {
  JobStepHistoryTracker,
  buildRollbackTargets,
  buildStoredDiff,
  getLatestProjectAppliedSeq,
  getNextProjectAppliedSeq,
  normalizeToolPath,
  readCurrentStates,
  serializeRollbackContext,
  validateRollbackTargets,
} from './job-step-history';

/* ─── Supported Editors ─── */

const EDITORS: { key: string; cli: string; appBin: string; appName: string }[] = [
  {
    key: 'cursor',
    cli: 'cursor',
    appBin: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    appName: 'Cursor',
  },
  {
    key: 'vscode',
    cli: 'code',
    appBin: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    appName: 'Visual Studio Code',
  },
];

/* ─── Shared editor-launch helpers ─── */

const launchDetached = (command: string, args: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      const { spawn: spawnProc } = require('child_process');
      const child = spawnProc(command, args, {
        detached: true,
        stdio: 'ignore',
      });

      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      child.once('error', () => finish(false));
      child.once('spawn', () => {
        child.unref();
        finish(true);
      });
    } catch {
      resolve(false);
    }
  });

const activateApp = async (appName: string): Promise<void> => {
  if (process.platform !== 'darwin') return;
  await launchDetached('osascript', ['-e', `tell application "${appName}" to activate`]);
};

type WindowGetter = () => BrowserWindow | null;

const stepHistoryTracker = new JobStepHistoryTracker();
const titleGenerationQueue = new TitleGenerationQueue();

// --- Dynamic model catalog from SDK ---
let cachedDynamicModels: DynamicModelInfo[] | null = null;

// --- Account info from SDK ---
let cachedAccountInfo: AccountInfo | null = null;

/** Convert SDK ModelInfo[] to ModelOption[] for the renderer. */
function buildModelCatalog(models: DynamicModelInfo[]): ModelOption[] {
  return models.map((m) => ({
    value: m.value,
    label: m.displayName,
    badge: m.displayName.toUpperCase(),
    ...(m.description ? { description: m.description } : {}),
    ...(m.supportsEffort != null ? { supportsEffort: m.supportsEffort } : {}),
    ...(m.supportedEffortLevels?.length ? { supportedEffortLevels: m.supportedEffortLevels } : {}),
    ...(m.supportsAdaptiveThinking != null ? { supportsAdaptiveThinking: m.supportsAdaptiveThinking } : {}),
  }));
}

function getModelCatalogEntry(model: string): ModelOption | undefined {
  if (!cachedDynamicModels?.length) return undefined;
  const found = cachedDynamicModels.find((entry) => entry.value === model);
  if (!found) return undefined;
  return buildModelCatalog([found])[0];
}

function resolveRuntimeThinking(job: Job, settings: AppSettings): {
  model: ModelChoice;
  thinkingMode: ThinkingMode;
  effort?: EffortLevel;
} {
  const model = job.model || settings.defaultModel;
  const thinkingMode = job.thinkingMode || settings.defaultThinkingMode;
  const effort = normalizeEffortForThinking(
    getModelCatalogEntry(model),
    thinkingMode,
    job.effort || settings.defaultEffort,
  );

  return { model, thinkingMode, ...(effort ? { effort } : {}) };
}

/**
 * Fetch models from the SDK at app startup and populate the cache.
 * Call this once from main.ts after the window is created.
 */
export async function initModels(getWindow: WindowGetter): Promise<void> {
  try {
    const models = await fetchSupportedModels();
    if (models?.length) {
      cachedDynamicModels = models as DynamicModelInfo[];
      sendToRenderer(getWindow, 'models:updated', buildModelCatalog(cachedDynamicModels));
    }
  } catch (err) {
    console.warn('[init-models] Failed to fetch models from SDK:', err);
  }
}

/** Extract file paths touched by Write/Edit tools from the output log */
function extractEditedFilePaths(entries: OutputEntry[], projectPath: string): string[] {
  const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
  const seen = new Set<string>();
  let currentTool = '';
  let toolBuffer = '';

  const flush = () => {
    if (FILE_TOOLS.has(currentTool) && toolBuffer) {
      try {
        const parsed = JSON.parse(toolBuffer);
        const filePath = (parsed.file_path || parsed.notebook_path) as string | undefined;
        if (filePath) seen.add(normalizeToolPath(projectPath, filePath));
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

function getStepLabel(order: number): string {
  return order === 0 ? 'Initial development' : `Follow-up #${order}`;
}

function normalizeComposerDraft(draft?: JobComposerDraft): JobComposerDraft | undefined {
  if (!draft) return undefined;
  const text = draft.text || '';
  const images = draft.images || [];
  if (!text.trim() && images.length === 0) return undefined;
  return { text, images };
}

function normalizePendingQuestionDraft(draft?: PendingQuestionDraft): PendingQuestionDraft | undefined {
  if (!draft) return undefined;

  const responseText = draft.responseText || '';
  const selectedOptions = draft.selectedOptions || [];
  const questionAnswers = Object.fromEntries(
    Object.entries(draft.questionAnswers || {}).filter(([, value]) => !!value?.trim()),
  );
  const questionSelections = Object.fromEntries(
    Object.entries(draft.questionSelections || {}).filter(([, value]) => Array.isArray(value) && value.length > 0),
  );
  const hasContent =
    !!responseText.trim() ||
    selectedOptions.length > 0 ||
    Object.keys(questionAnswers).length > 0 ||
    Object.keys(questionSelections).length > 0 ||
    draft.currentStep > 0;

  if (!hasContent) return undefined;

  return {
    questionId: draft.questionId,
    currentStep: draft.currentStep,
    responseText,
    selectedOptions,
    questionAnswers,
    questionSelections,
  };
}

function normalizeJobDetailDrafts(drafts?: JobDetailDrafts): JobDetailDrafts | undefined {
  if (!drafts) return undefined;

  const normalized: JobDetailDrafts = {
    steer: normalizeComposerDraft(drafts.steer),
    planEdit: normalizeComposerDraft(drafts.planEdit),
    followUp: normalizeComposerDraft(drafts.followUp),
    retry: normalizeComposerDraft(drafts.retry),
    pendingQuestion: normalizePendingQuestionDraft(drafts.pendingQuestion),
  };

  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function mergeJobDetailDrafts(existing: JobDetailDrafts | undefined, patch: Partial<JobDetailDrafts>): JobDetailDrafts | undefined {
  return normalizeJobDetailDrafts({
    ...(existing || {}),
    ...patch,
  });
}

function nextJobDraftVersion(job: Job, candidate?: number): number {
  const current = job.jobDetailDraftVersion || 0;
  if (typeof candidate === 'number') {
    return Math.max(current + 1, candidate);
  }
  return current + 1;
}

async function startDevelopmentPhase(
  jobId: string,
  getWindow: WindowGetter,
  batchedSender: BatchedSender,
  sessionId?: string,
  updates: Partial<Job> = {},
) {
  const job = getJob(jobId);
  if (!job) throw new Error('Job not found');

  const now = new Date().toISOString();
  appendOutput(jobId, {
    timestamp: now,
    type: 'system',
    content: '--- Planning complete. Starting development phase ---',
  });

  const updated = updateJob(jobId, {
    ...updates,
    column: 'development',
    status: 'running',
    pendingQuestion: undefined,
    waitingStartedAt: undefined,
    planningEndedAt: updates.planningEndedAt || now,
    developmentStartedAt: updates.developmentStartedAt || now,
  });

  if (updated) {
    stepHistoryTracker.startStep(
      jobId,
      getStepLabel((job.stepSnapshots || []).length),
      (job.stepSnapshots || []).length,
    );
    sendToRenderer(getWindow, 'job:status-changed', updated);
    await startClaudeSession(updated, getWindow, batchedSender, 'dev', sessionId || job.sessionId);
  }

  return updated;
}

async function markPlanReady(
  jobId: string,
  getWindow: WindowGetter,
  updates: Partial<Job> = {},
) {
  const job = getJob(jobId);
  if (!job) throw new Error('Job not found');

  const now = new Date().toISOString();
  const project = getProjects().find(p => p.id === job.projectId);
  appendOutput(jobId, {
    timestamp: now,
    type: 'system',
    content: '--- Planning complete. Waiting for plan approval ---',
  });

  const updated = updateJob(jobId, {
    ...updates,
    status: 'plan-ready',
    pendingQuestion: undefined,
    waitingStartedAt: now,
  });

  if (updated) {
    sendToRenderer(getWindow, 'job:status-changed', updated);
    if (project) {
      notifyPlanReady(job.id, project.name, job.title || job.prompt, getWindow);
    }
  }

  return updated;
}

async function cleanupCompletedJobsForBranch(project: Project, branch: string): Promise<string[]> {
  const completedJobs = getJobs().filter(
    (job) => job.projectId === project.id && job.branch === branch && (job.status === 'completed' || job.status === 'rejected'),
  );

  for (const job of completedJobs) {
    stepHistoryTracker.discardStep(job.id);
    deleteJob(job.id);
  }

  return completedJobs.map((job) => job.id);
}

// --- Batched IPC sender for high-frequency events ---
class BatchedSender {
  private outputBatches = new Map<string, OutputEntry[]>();
  private rawMessageBatches = new Map<string, RawMessage[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private getWindow: WindowGetter;
  private flushCallbacks: Array<(jobId: string, entries: OutputEntry[], messages: RawMessage[]) => void> = [];

  constructor(getWindow: WindowGetter) {
    this.getWindow = getWindow;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), 100);
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

    if (batch.length > 0) {
      const last = batch[batch.length - 1];
      const sameParent = entry.parentToolUseId === last.parentToolUseId;
      if (
        sameParent &&
        ((entry.type === 'text' && last.type === 'text') ||
        (entry.type === 'thinking' && last.type === 'thinking'))
      ) {
        last.content += entry.content;
        last.timestamp = entry.timestamp;
        return;
      }
      if (sameParent && entry.type === 'tool-use' && last.type === 'tool-use' && !entry.toolName) {
        last.content += entry.content;
        last.timestamp = entry.timestamp;
        return;
      }
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

  onFlush(cb: (jobId: string, entries: OutputEntry[], messages: RawMessage[]) => void): () => void {
    this.flushCallbacks.push(cb);
    return () => {
      const idx = this.flushCallbacks.indexOf(cb);
      if (idx >= 0) this.flushCallbacks.splice(idx, 1);
    };
  }

  private flush(): void {
    // Collect all job IDs from both maps
    const jobIds = new Set<string>([
      ...this.outputBatches.keys(),
      ...this.rawMessageBatches.keys(),
    ]);

    for (const jobId of jobIds) {
      const entries = this.outputBatches.get(jobId);
      const messages = this.rawMessageBatches.get(jobId);
      if (entries?.length || messages?.length) {
        // Fire persistence callbacks before sending IPC
        for (const cb of this.flushCallbacks) {
          cb(jobId, entries || [], messages || []);
        }
        sendToRenderer(this.getWindow, 'job:streaming-batch', {
          jobId,
          entries: entries || [],
          messages: messages || [],
        });
      }
    }
    this.outputBatches.clear();
    this.rawMessageBatches.clear();
  }
}

async function resolveCommitBranch(project: Project, branch?: string): Promise<string | null> {
  if (branch) return branch;
  const branches = await listBranches(project.path);
  return branches?.current || null;
}

async function buildStableJobDiff(projectPath: string, job: Job, stepSnapshots?: Job['stepSnapshots']): Promise<string> {
  if ((stepSnapshots?.length ?? 0) > 0) {
    const stored = await buildStoredDiff(stepSnapshots);
    if (stored.trim()) return stored;
  }

  if (job.diffText?.trim()) return job.diffText.trim();

  return '';
}

async function startClaudeSession(
  job: Job,
  getWindow: WindowGetter,
  batchedSender: BatchedSender,
  phase: 'plan' | 'dev',
  sessionId?: string,
  promptOverride?: string,
) {
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
  if (promptOverride) {
    prompt = promptOverride;
  } else if (latestFollowUp && phase === 'dev' && sessionId) {
    prompt = latestFollowUp;
  } else if (phase === 'dev') {
    if (job.skipPlanning) {
      prompt = job.prompt;
    } else if (job.planText) {
      prompt = `The planning phase produced this implementation plan. Carry it out now.\n\n--- IMPLEMENTATION PLAN ---\n${job.planText}\n--- END PLAN ---`;
    } else {
      prompt = 'Continue from planning and implement the requested changes.';
    }
  } else {
    prompt = job.prompt;
  }

  // Resolve effective model/thinking settings: job overrides > settings defaults
  const settings = getSettings();
  const effectiveThinking = resolveRuntimeThinking(job, settings);

  // Pull transient image data from cache (if any), then clear to free memory
  const images = pendingImages.get(job.id);
  pendingImages.delete(job.id);

  const session = sessionManager.create({
    jobId: job.id,
    projectPath: project.path,
    prompt,
    phase,
    sessionId,
    images,
    model: effectiveThinking.model,
    thinkingMode: effectiveThinking.thinkingMode,
    effort: effectiveThinking.effort,
    permissionMode: settings.permissionMode,
  });

  session.on('session-id', (sid: string) => {
    updateJob(job.id, { sessionId: sid });
  });

  session.on('raw-message', (raw: RawMessage) => {
    batchedSender.pushRawMessage(job.id, raw);
  });

  session.on('output', (entry: OutputEntry) => {
    batchedSender.pushOutput(job.id, entry);
  });

  // Defer persistence to the batch flush cycle — aligns disk writes with IPC interval
  const unsubFlush = batchedSender.onFlush((flushedJobId, entries, messages) => {
    if (flushedJobId !== job.id) return;
    for (const entry of entries) appendOutput(job.id, entry);
    for (const raw of messages) appendRawMessage(job.id, raw);
  });

  // Capture file "before" state from canUseTool (pre-tool-call) — fires BEFORE
  // the SDK executes the tool, so the file hasn't been modified yet.
  session.on('pre-tool-call', (payload: { name: string; input: Record<string, unknown> }) => {
    void stepHistoryTracker.recordToolCall(job.id, project.path, payload);
  });

  session.on('user-message-uuid', (uuid: string) => {
    const current = getJob(job.id);
    if (current) {
      const uuids = [...(current.userMessageUuids || []), uuid];
      updateJob(job.id, { userMessageUuids: uuids });
    }
  });

  session.on('supported-models', (models: DynamicModelInfo[]) => {
    if (models?.length && !cachedDynamicModels) {
      cachedDynamicModels = models;
      sendToRenderer(getWindow, 'models:updated', buildModelCatalog(models));
    }
  });

  session.on('skills', (skills: Skill[]) => {
    if (skills.length > 0) {
      setSkillsCache(project.path, skills);
    }
  });

  session.on('account-info', (info: AccountInfo) => {
    if (info && !cachedAccountInfo) {
      cachedAccountInfo = info;
      sendToRenderer(getWindow, 'account:updated', info);
    }
  });

  session.on('needs-input', (question: PendingQuestion) => {
    const current = getJob(job.id);
    const shouldPreservePendingDraft = current?.jobDetailDrafts?.pendingQuestion?.questionId === question.questionId;
    const jobDetailDrafts = shouldPreservePendingDraft
      ? current.jobDetailDrafts
      : mergeJobDetailDrafts(current?.jobDetailDrafts, { pendingQuestion: undefined });
    const updated = updateJob(job.id, {
      status: 'waiting-input',
      pendingQuestion: question,
      waitingStartedAt: new Date().toISOString(),
      jobDetailDrafts,
      ...(current ? { jobDetailDraftVersion: shouldPreservePendingDraft ? current.jobDetailDraftVersion : nextJobDraftVersion(current) } : {}),
    });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
      sendToRenderer(getWindow, 'job:needs-input', { jobId: job.id, question });
      notifyInputNeeded(job.id, project.name, job.title || job.prompt, question.text, getWindow);
    }
  });

  // AskUserQuestion and permission prompts are now handled inline by the SDK's
  // canUseTool callback. The session emits 'needs-input' and blocks until
  // sendResponse() is called — no need to kill/restart the session.

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

  let planReadyPromise: Promise<Job | undefined> | null = null;

  session.on('plan-complete', () => {
    if (phase === 'plan') {
      const current = getJob(job.id);
      if (current?.column === 'planning' && current.status === 'running') {
        planReadyPromise = markPlanReady(job.id, getWindow);
      }
    }
  });

  session.on('close', async (code: number) => {
    unsubFlush();
    const current = getJob(job.id);
    if (!current) return;

    // If session was killed while waiting for user input (permission or question), preserve that state
    if (current.pendingQuestion && current.status === 'waiting-input') {
      return;
    }

    // Compute merged token usage
    const tokens = session.tokenUsage;
    const tokenField = phase === 'plan' ? 'planningTokens' : 'developmentTokens';
    const existing = current?.[tokenField] || { inputTokens: 0, outputTokens: 0 };
    const mergedTokens = {
      inputTokens: existing.inputTokens + tokens.inputTokens,
      outputTokens: existing.outputTokens + tokens.outputTokens,
      ...(tokens.contextWindow > 0 ? { contextWindow: tokens.contextWindow } : {}),
    };
    // Session-level context snapshot: latest peak input vs context window (not accumulated)
    const contextUsage = tokens.contextWindow > 0 && tokens.inputTokens > 0
      ? { used: tokens.inputTokens, limit: tokens.contextWindow }
      : current.contextUsage;

    if (code !== 0 || current.status === 'error') {
      stepHistoryTracker.discardStep(job.id);
      if (current.status !== 'error') {
        const updated = updateJob(job.id, {
          status: 'error',
          error: `Claude process exited with code ${code}`,
          erroredAt: new Date().toISOString(),
          [tokenField]: mergedTokens,
          contextUsage,
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
      const editedFiles = extractEditedFilePaths(outputLog, project.path);
      const nextAppliedSeq = getNextProjectAppliedSeq(getJobs(), job.projectId);
      const completedStep = await stepHistoryTracker.finalizeStep(job.id, project.path, nextAppliedSeq);
      const nextStepSnapshots = completedStep
        ? [...(current.stepSnapshots || []), completedStep]
        : current.stepSnapshots;
      const diffText = await buildStableJobDiff(project.path, current, nextStepSnapshots);

      const updated = updateJob(job.id, {
        column: 'done',
        status: 'completed',
        pendingQuestion: undefined,
        completedAt: new Date().toISOString(),
        diffText: diffText || undefined,
        editedFiles: editedFiles.length > 0 ? editedFiles : undefined,
        stepSnapshots: nextStepSnapshots,
        [tokenField]: mergedTokens,
        contextUsage,
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
        sendToRenderer(getWindow, 'job:complete', { jobId: job.id });
        notifyJobComplete(job.id, project.name, job.title || job.prompt, getWindow);
      }
    } else {
      if (planReadyPromise) {
        // plan-complete already triggered markPlanReady — await it, then persist tokens
        await planReadyPromise;
        const updated = updateJob(job.id, { [tokenField]: mergedTokens, contextUsage });
        if (updated) {
          sendToRenderer(getWindow, 'job:status-changed', updated);
        }
      } else if (current.column === 'planning' && current.status === 'running') {
        // plan-complete hasn't fired yet — mark ready now with tokens
        await markPlanReady(job.id, getWindow, { [tokenField]: mergedTokens, contextUsage });
      } else {
        // Already handled (e.g. status changed externally) — persist tokens only
        const updated = updateJob(job.id, { [tokenField]: mergedTokens, contextUsage });
        if (updated) {
          sendToRenderer(getWindow, 'job:status-changed', updated);
        }
      }
    }
  });

  session.on('error', (errorMsg: string) => {
    unsubFlush();
    stepHistoryTracker.discardStep(job.id);
    const updated = updateJob(job.id, {
      status: 'error',
      error: errorMsg,
      erroredAt: new Date().toISOString(),
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

/**
 * Run a one-shot SDK query with structured JSON output.
 * Returns the parsed structured_output from the result message.
 */
async function runClaudeStructured<T>(
  projectPath: string,
  prompt: string,
  schema: Record<string, unknown>,
  options?: { model?: string; effort?: string },
): Promise<T | null> {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkOptions: Record<string, any> = withProjectScopedClaudeCodeOptions({
    cwd: projectPath,
    env,
    permissionMode: 'plan',
    settingSources: ['user', 'project'],
    outputFormat: { type: 'json_schema', schema },
  });


  sdkOptions.model = options?.model || 'haiku';
  sdkOptions.effort = options?.effort || 'low';

  for await (const msg of sdkQuery({ prompt, options: sdkOptions })) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any;
    if (m.type === 'result') {
      if (m.subtype === 'success') {
        if (m.structured_output != null) {
          return m.structured_output as T;
        }
        // Fallback: try parsing the text result as JSON
        const text = (m.result as string)?.trim();
        if (text) {
          try { return JSON.parse(text) as T; } catch { /* not JSON */ }
        }
        return null;
      } else if (m.subtype?.startsWith('error')) {
        throw new Error(`Claude query failed: ${m.result || m.subtype}`);
      }
    }
  }
  return null;
}

// --- Structured output schemas ---

const SINGLE_LINE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'A single concise conventional-commit message line' },
  },
  required: ['message'],
  additionalProperties: false,
} as const;

async function runClaudeEditTask(
  projectPath: string,
  prompt: string,
  options?: {
    model?: string;
    effort?: string;
    permissionMode?: PermissionMode;
  },
): Promise<string> {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const bypassPermissions = (options?.permissionMode ?? 'bypassPermissions') === 'bypassPermissions';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkOptions: Record<string, any> = withProjectScopedClaudeCodeOptions({
    cwd: projectPath,
    env,
    permissionMode: bypassPermissions ? 'bypassPermissions' : 'default',
    allowDangerouslySkipPermissions: bypassPermissions,
    settingSources: ['user', 'project'],
  });


  if (options?.model) {
    sdkOptions.model = options.model;
  }
  if (options?.effort) {
    sdkOptions.effort = options.effort;
  }

  let result = '';
  for await (const msg of sdkQuery({ prompt, options: sdkOptions })) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any;
    if (m.type === 'result' && m.subtype === 'success') {
      result = (m.result as string) || '';
    } else if (m.type === 'result' && m.subtype?.startsWith('error')) {
      throw new Error(`Claude query failed: ${m.result || m.subtype}`);
    }
  }
  return result.trim();
}

/**
 * Resume a completed session to call rewindFiles().
 * Opens a temporary SDK session with the original sessionId, calls rewind, then closes.
 */
async function rewindViaResume(
  projectPath: string,
  sessionId: string,
  userMessageId: string,
  options?: { dryRun?: boolean },
): Promise<{ canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number }> {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkOptions: Record<string, any> = withProjectScopedClaudeCodeOptions({
    cwd: projectPath,
    permissionMode: 'plan',
    enableFileCheckpointing: true,
    resume: sessionId,
    env,
    settingSources: ['user', 'project'],
  });


  let q;
  try {
    q = sdkQuery({ prompt: '', options: sdkOptions });
    const result = await q.rewindFiles(userMessageId, options);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { canRewind: false, error: msg };
  } finally {
    if (q) {
      try { q.close(); } catch { /* already closed */ }
    }
  }
}

/**
 * Shared rollback logic used by both reject-job and delete-with-rollback.
 * Uses SDK rewindFiles() as primary mechanism, model-assisted rollback as fallback.
 */
async function rollbackJobToSnapshot(
  job: Job,
  project: Project,
  targetIndex: number,
  allJobs: Job[],
): Promise<void> {
  const stepSnapshots = job.stepSnapshots || [];
  const userMessageUuids = job.userMessageUuids || [];

  if (stepSnapshots.length === 0 && userMessageUuids.length === 0) {
    return; // nothing to roll back
  }

  // Guard: refuse if another job on the same project is currently running
  const runningOnSameProject = allJobs.some(
    j => j.id !== job.id && j.projectId === job.projectId && (j.status === 'running' || j.status === 'waiting-input')
  );
  if (runningOnSameProject) {
    throw new Error('Cannot roll back while another job on this project is running');
  }

  const targetLabel = targetIndex === 0 ? 'Original' : getStepLabel(targetIndex);

  // Primary: try SDK rewindFiles() via session resume
  if (job.sessionId && userMessageUuids.length > targetIndex) {
    const targetUuid = userMessageUuids[targetIndex];
    console.log(`[rollback] SDK rewind: sessionId=${job.sessionId}, targetUuid=${targetUuid}, targetIndex=${targetIndex}`);
    const result = await rewindViaResume(project.path, job.sessionId, targetUuid);
    if (result.canRewind) {
      console.log(`[rollback] SDK rewind succeeded:`, result);
      return;
    }
    console.log(`[rollback] SDK rewind failed, falling back to model-assisted:`, result.error);
  }

  // Fallback: model-assisted rollback using step snapshots
  if (stepSnapshots.length > 0) {
    await rollbackWithModel(job, project.path, targetIndex, targetLabel);
  }
}

async function rollbackWithModel(job: Job, projectPath: string, targetIndex: number, targetLabel: string): Promise<void> {
  const rollbackPlan = buildRollbackTargets(
    job,
    targetIndex,
    await readCurrentStates(
      projectPath,
      Array.from(
        new Set(
          (job.stepSnapshots || [])
            .filter((step) => step.order >= targetIndex)
            .flatMap((step) => step.files.map((file) => file.path)),
        ),
      ),
    ),
  );

  if (!rollbackPlan) {
    throw new Error('No stored step snapshots are available for rollback');
  }
  if (rollbackPlan.unsupportedBinary.length > 0) {
    throw new Error(
      `Rollback requires manual handling for binary files: ${rollbackPlan.unsupportedBinary.join(', ')}`,
    );
  }
  if (rollbackPlan.targets.length === 0) {
    return;
  }

  const config = getPromptConfig('rollback');
  const prompt = buildPromptText(config, `\n\n${serializeRollbackContext(rollbackPlan.targets, targetLabel)}`);

  const settings = getSettings();
  await runClaudeEditTask(projectPath, prompt, {
    model: config.model,
    effort: config.effort,
    permissionMode: settings.permissionMode,
  });
  const valid = await validateRollbackTargets(projectPath, rollbackPlan.targets);
  if (!valid) {
    throw new Error('Rollback output did not match the requested target state');
  }
}

function enqueueTitleGeneration(
  jobId: string,
  prompt: string,
  getWindow: WindowGetter,
  followUpIndex?: number,
  context?: string
) {
  const config = getPromptConfig('title');
  let titlePrompt = buildPromptText(config, '\n\n');
  if (context) {
    titlePrompt += `Context: ${context}\n\n`;
  }
  titlePrompt += `Task: ${prompt}`;

  titleGenerationQueue.enqueue({
    jobId,
    followUpIndex,
    prompt: titlePrompt,
    model: config.model,
    effort: config.effort,
    onSuccess: async (title) => {
      const current = getJob(jobId);
      if (!current) return;

      if (followUpIndex !== undefined) {
        const followUps = [...(current.followUps || [])];
        if (!followUps[followUpIndex]) return;
        followUps[followUpIndex] = { ...followUps[followUpIndex], title };
        const updated = updateJob(jobId, { followUps });
        if (updated) sendToRenderer(getWindow, 'job:status-changed', updated);
        return;
      }

      const updated = updateJob(jobId, { title });
      if (updated) sendToRenderer(getWindow, 'job:status-changed', updated);
    },
    onError: async (err) => {
      console.error('[enqueueTitleGeneration] Failed:', err);
    },
  });
}

function registerDemoHandlers(): void {
  // Data handlers
  ipcMain.handle('cli:check-health', () => ({ installed: true, authenticated: true, version: '1.0.0 (demo)' }));
  ipcMain.handle('projects:list', () => getDemoProjects());
  ipcMain.handle('jobs:list', () => getDemoJobs());
  ipcMain.handle('settings:get', () => getDemoSettings());
  ipcMain.handle('theme:get-actual', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
  ipcMain.handle('git:branches-status', (_event, projectId: string) => getDemoBranchStatuses(projectId));

  // Mutation channels — all no-ops
  const noOpChannels = [
    'projects:add', 'projects:rename', 'projects:remove', 'projects:reorder',
    'projects:set-default-branch', 'projects:set-color', 'projects:open-folder', 'projects:open-in-editor',
    'git:list-branches', 'git:push', 'git:commit', 'git:generate-commit-message',
    'files:list',
    'jobs:create', 'jobs:cancel', 'jobs:delete', 'jobs:retry', 'jobs:respond', 'jobs:steer',
    'jobs:accept-plan', 'jobs:edit-plan', 'jobs:follow-up', 'jobs:get-diff', 'jobs:reject-job',
    'jobs:rewind-preview', 'jobs:rewind-files', 'jobs:rewind-messages',
    'images:save',
    'claudemd:read', 'claudemd:init', 'claudemd:write',
    'cli:start-login', 'cli:login-write', 'cli:login-kill',
    'shell:open-external',
    'settings:update',
    'skills:list',
    'models:list',
    'account:info',
  ];
  for (const channel of noOpChannels) {
    ipcMain.handle(channel, () => null);
  }

  console.log('[Demo Mode] Registered demo IPC handlers — all mutations are no-ops');
}

/**
 * Transient in-memory cache for image base64 data.
 * Images are stored here on job creation / follow-up / steer / etc.,
 * then consumed by startClaudeSession and cleared to free memory.
 */
const pendingImages = new Map<string, JobImage[]>();

export function registerIpcHandlers(getWindow: WindowGetter): void {
  // App version — always available
  ipcMain.handle('app:get-version', () => app.getVersion());

  // --- Demo mode: register lightweight canned-data handlers and skip real registration ---
  if (isDemoMode()) {
    registerDemoHandlers();
    return;
  }

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

  ipcMain.handle('projects:set-color', (_event, id: string, color: string | null) => {
    return setProjectColor(id, color);
  });

  ipcMain.handle('projects:open-folder', async (_event, projectId: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };
    const error = await shell.openPath(project.path);
    return error ? { success: false, error } : { success: true };
  });

  ipcMain.handle('projects:open-in-editor', async (_event, projectId: string, branch?: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };
    let skippedBranchCheckout = false;

    const openFolder = async () => {
      const error = await shell.openPath(project.path);
      return error
        ? { success: false, error }
        : { success: true, editor: 'finder' };
    };

    // Check git status — isGitRepo may be undefined for older projects
    const isGit = project.isGitRepo ?? await isGitRepoRoot(project.path);

    // Non-git projects: open folder in file manager
    if (!isGit) {
      return openFolder();
    }

    // Checkout branch if specified
    if (branch) {
      try {
        await checkoutBranch(project.path, branch);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to checkout branch';
        if (message.includes('Working tree is dirty')) {
          skippedBranchCheckout = true;
        } else {
          return { success: false, error: message };
        }
      }
    }

    // Git repos: open in preferred editor
    const settings = getSettings();
    const preferred = settings.preferredEditor ?? 'auto';
    const { existsSync } = await import('fs');

    const tryEditor = async (editor: typeof EDITORS[number]): Promise<boolean> => {
      // 1) Prefer the editor CLI from PATH for cross-platform installs.
      if (await launchDetached(editor.cli, [project.path])) {
        await activateApp(editor.appName);
        return true;
      }

      // 2) macOS: use the bundled CLI script inside the .app when available.
      if (process.platform === 'darwin' && existsSync(editor.appBin)) {
        if (await launchDetached(editor.appBin, [project.path])) {
          await activateApp(editor.appName);
          return true;
        }
      }

      // 3) macOS fallback: ask Launch Services to open the folder in the app.
      if (process.platform === 'darwin') {
        if (await launchDetached('open', ['-a', editor.appName, project.path])) {
          await activateApp(editor.appName);
          return true;
        }
      }

      return false;
    };

    const order: typeof EDITORS[number][] =
      preferred === 'cursor' ? [EDITORS[0]] :
      preferred === 'vscode' ? [EDITORS[1]] :
      EDITORS; // auto: try cursor first, then vscode

    for (const editor of order) {
      if (await tryEditor(editor)) {
        if (skippedBranchCheckout) {
          console.warn(`[open-in-editor] Opened ${project.path} without switching to branch "${branch}" because the working tree is dirty.`);
        }
        return { success: true, editor: editor.key };
      }
    }

    // No editor found — open folder
    const result = await openFolder();
    if (result.success && skippedBranchCheckout) {
      console.warn(`[open-in-editor] Opened folder ${project.path} without switching to branch "${branch}" because the working tree is dirty.`);
    }
    return result;
  });

  /* ─── Detect Installed Editors ─── */

  ipcMain.handle('editors:detect-installed', async () => {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { existsSync } = await import('fs');
    const execFileAsync = promisify(execFile);

    const whichCmd = process.platform === 'win32' ? 'where' : 'which';

    const isInstalled = async (editor: typeof EDITORS[number]): Promise<boolean> => {
      // 1) Check CLI on PATH
      try {
        await execFileAsync(whichCmd, [editor.cli], { timeout: 5_000 });
        return true;
      } catch { /* not on PATH */ }

      // 2) macOS: check app bundle binary
      if (process.platform === 'darwin' && existsSync(editor.appBin)) {
        return true;
      }

      // 3) macOS: check .app exists via mdfind (Spotlight)
      if (process.platform === 'darwin') {
        try {
          const { stdout } = await execFileAsync('mdfind', [
            `kMDItemFSName == "${editor.appName}.app" && kMDItemContentType == "com.apple.application-bundle"`,
          ], { timeout: 5_000 });
          if (stdout.trim().length > 0) return true;
        } catch { /* mdfind failed */ }
      }

      return false;
    };

    const results = await Promise.all(EDITORS.map(async (e) => [e.key, await isInstalled(e)] as const));
    return Object.fromEntries(results) as Record<string, boolean>;
  });

  /* ─── Open a specific file in the preferred editor ─── */

  ipcMain.handle('files:open-in-editor', async (_event, projectId: string, filePath: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const { existsSync } = await import('fs');

    // Resolve the full file path (handle relative paths)
    const fullFilePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(project.path, filePath);

    const settings = getSettings();
    const preferred = settings.preferredEditor ?? 'auto';

    const tryEditorWithFile = async (editor: typeof EDITORS[number]): Promise<boolean> => {
      // Editor CLIs accept: <cli> <project-folder> <file-path>
      // This opens the project and focuses the specific file tab
      const args = [project.path, fullFilePath];

      // 1) CLI on PATH
      if (await launchDetached(editor.cli, args)) {
        await activateApp(editor.appName);
        return true;
      }

      // 2) macOS: bundled CLI inside .app
      if (process.platform === 'darwin' && existsSync(editor.appBin)) {
        if (await launchDetached(editor.appBin, args)) {
          await activateApp(editor.appName);
          return true;
        }
      }

      // 3) macOS fallback: Launch Services (can only open folder, not specific file)
      if (process.platform === 'darwin') {
        if (await launchDetached('open', ['-a', editor.appName, fullFilePath])) {
          await activateApp(editor.appName);
          return true;
        }
      }

      return false;
    };

    const order: typeof EDITORS[number][] =
      preferred === 'cursor' ? [EDITORS[0]] :
      preferred === 'vscode' ? [EDITORS[1]] :
      EDITORS; // auto: try cursor first, then vscode

    for (const editor of order) {
      if (await tryEditorWithFile(editor)) {
        return { success: true, editor: editor.key };
      }
    }

    // No editor found — open with OS default
    const error = await shell.openPath(fullFilePath);
    return error
      ? { success: false, error }
      : { success: true, editor: 'default' };
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
      const targetBranch = await resolveCommitBranch(project, branch);
      await gitStageAll(project.path);
      const sha = await gitCommit(project.path, message);
      const settings = getSettings();
      let deletedJobIds: string[] = [];
      let warning: string | undefined;

      if (targetBranch && settings.deleteCompletedJobsOnCommit) {
        try {
          deletedJobIds = await cleanupCompletedJobsForBranch(project, targetBranch);
        } catch (cleanupError: unknown) {
          warning = cleanupError instanceof Error
            ? cleanupError.message
            : 'Completed jobs were not cleared after commit.';
        }
      }

      return { success: true, sha, deletedJobIds, warning };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('git:generate-commit-message', async (_event, projectId: string, _branch?: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');
    const config = getPromptConfig('commit');
    const prompt = buildPromptText(config);
    const result = await runClaudeStructured<{ message: string }>(
      project.path, prompt, SINGLE_LINE_SCHEMA,
      { model: config.model, effort: config.effort },
    );
    return result?.message?.trim() || 'chore: update project';
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

  ipcMain.handle('jobs:update-drafts', (_event, jobId: string, patch: Partial<JobDetailDrafts>, version: number) => {
    const job = getJob(jobId);
    if (!job) return undefined;
    const currentVersion = job.jobDetailDraftVersion || 0;

    if (version < currentVersion) {
      return job;
    }

    const updated = updateJob(jobId, {
      jobDetailDrafts: mergeJobDetailDrafts(job.jobDetailDrafts, patch),
      jobDetailDraftVersion: version,
    });

    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }

    return updated;
  });

  ipcMain.handle('jobs:create', async (_event, projectId: string, prompt: string, skipPlanning?: boolean, images?: JobImage[], branch?: string, model?: ModelChoice, thinkingMode?: ThinkingMode, effort?: EffortLevel) => {
    const now = new Date().toISOString();

    // Strip base64 data for persistence — keep only metadata
    const persistImages = images?.length
      ? images.map(({ name, mediaType }) => ({ name, mediaType }))
      : undefined;

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
      ...(persistImages ? { images: persistImages } : {}),
      ...(branch ? { branch } : {}),
      ...(model ? { model } : {}),
      ...(thinkingMode ? { thinkingMode } : {}),
      ...(effort ? { effort } : {}),
      outputLog: [],
      rawMessages: [],
    };

    // Cache full image data (with base64) for the session
    if (images?.length) {
      pendingImages.set(job.id, images);
    }

    if (skipPlanning) {
      stepHistoryTracker.startStep(job.id, getStepLabel(0), 0);
    }

    saveJob(job);

    // Generate title in background (non-blocking)
    const titleProject = getProjects().find(p => p.id === projectId);
    if (titleProject) {
      enqueueTitleGeneration(job.id, prompt, getWindow);
    }

    await startClaudeSession(job, getWindow, batchedSender, skipPlanning ? 'dev' : 'plan');

    return job;
  });


  ipcMain.handle('jobs:cancel', (_event, jobId: string) => {
    sessionManager.kill(jobId);
    stepHistoryTracker.discardStep(jobId);
    const updated = updateJob(jobId, {
      status: 'error',
      error: 'Cancelled by user',
      erroredAt: new Date().toISOString(),
    });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }
  });

  ipcMain.handle('jobs:delete', async (_event, jobId: string, options?: { rollback?: boolean }) => {
    sessionManager.kill(jobId);
    stepHistoryTracker.discardStep(jobId);
    titleGenerationQueue.cancel(jobId);
    const job = getJob(jobId);

    if (options?.rollback && job) {
      // Roll back changes using SDK rewind, with model-assisted fallback
      const project = getProjects().find(p => p.id === job.projectId);
      if (!project) throw new Error('Project not found');
      const allJobs = getJobs();
      await rollbackJobToSnapshot(job, project, 0, allJobs);
    }

    deleteJob(jobId);
  });

  ipcMain.handle('jobs:retry', async (_event, jobId: string, message?: string, images?: JobImage[]) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    sessionManager.kill(jobId);
    stepHistoryTracker.discardStep(jobId);

    const phase = job.column === 'development' ? 'dev' : 'plan';
    const now = new Date().toISOString();

    const isCancelled = job.error === 'Cancelled by user';
    const verb = isCancelled ? 'Resuming' : 'Retrying';

    appendOutput(jobId, {
      timestamp: new Date().toISOString(),
      type: 'system',
      content: message
        ? `--- ${verb} with message (${phase} phase) ---\n${message}`
        : `--- ${verb} (${phase} phase) ---`,
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
      completedAt: undefined,
      diffText: undefined,
      ...elapsedUpdate,
      jobDetailDrafts: mergeJobDetailDrafts(job.jobDetailDrafts, { retry: undefined }),
      jobDetailDraftVersion: nextJobDraftVersion(job),
    });

    if (updated) {
      if (phase === 'dev') {
        stepHistoryTracker.startStep(
          jobId,
          getStepLabel((job.stepSnapshots || []).length),
          (job.stepSnapshots || []).length,
        );
      }
      sendToRenderer(getWindow, 'job:status-changed', updated);
      if (images?.length) pendingImages.set(jobId, images);
      await startClaudeSession(updated, getWindow, batchedSender, phase, undefined, message || undefined);
    }

    return updated;
  });

  ipcMain.handle('jobs:respond', async (_event, jobId: string, answers: Record<string, string>) => {
    const current = getJob(jobId);
    if (!current) return;

    // With the SDK, the session stays alive during questions and permission prompts.
    // sendResponse() resolves the canUseTool promise and the SDK continues.
    const session = sessionManager.get(jobId);
    if (!session) {
      console.log('[ipc-handlers] jobs:respond — no active session for job', jobId);
      return;
    }

    let totalPausedMs = current.totalPausedMs || 0;
    if (current.waitingStartedAt) {
      totalPausedMs += Date.now() - new Date(current.waitingStartedAt).getTime();
    }

    // Log permission grants
    if (current.pendingQuestion?.isPermissionRequest) {
      const firstValue = Object.values(answers)[0] || '';
      const isAllowed = firstValue.toLowerCase().includes('allow');
      const deniedTools = current.pendingQuestion.deniedTools || [];
      if (isAllowed) {
        appendOutput(jobId, {
          timestamp: new Date().toISOString(),
          type: 'system',
          content: `Permission granted for ${deniedTools.join(', ')}`,
        });
        updateJob(jobId, {});
      }
    }

    session.sendResponse(answers);

    const updated = updateJob(jobId, {
      status: 'running',
      pendingQuestion: undefined,
      waitingStartedAt: undefined,
      totalPausedMs,
      jobDetailDrafts: mergeJobDetailDrafts(current.jobDetailDrafts, { pendingQuestion: undefined }),
      jobDetailDraftVersion: nextJobDraftVersion(current),
    });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }
  });

  ipcMain.handle('jobs:steer', async (_event, jobId: string, message: string, images?: JobImage[]) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    const session = sessionManager.get(jobId);
    if (!session) throw new Error('No active session for this job');

    appendOutput(jobId, {
      timestamp: new Date().toISOString(),
      type: 'system',
      content: `--- Steer: ${message} ---`,
    });

    const updated = updateJob(jobId, {
      jobDetailDrafts: mergeJobDetailDrafts(job.jobDetailDrafts, { steer: undefined }),
      jobDetailDraftVersion: nextJobDraftVersion(job),
    });
    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
    }

    // Kill current session and resume with the steer message
    const sessionId = job.sessionId;
    sessionManager.kill(jobId);

    if (images?.length) pendingImages.set(jobId, images);
    const phase = job.column === 'planning' ? 'plan' as const : 'dev' as const;
    await startClaudeSession(
      { ...job, ...updated } as Job,
      getWindow,
      batchedSender,
      phase,
      sessionId,
      message,
    );
  });

  ipcMain.handle('jobs:accept-plan', async (_event, jobId: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');
    if (job.column !== 'planning' || job.status !== 'plan-ready') {
      throw new Error('Job is not waiting for plan approval');
    }

    let totalPausedMs = job.totalPausedMs || 0;
    if (job.waitingStartedAt) {
      totalPausedMs += Date.now() - new Date(job.waitingStartedAt).getTime();
    }

    const updated = await startDevelopmentPhase(jobId, getWindow, batchedSender, job.sessionId, {
      planningEndedAt: new Date().toISOString(),
      planningPausedMs: totalPausedMs,
      waitingStartedAt: undefined,
      totalPausedMs,
      jobDetailDrafts: mergeJobDetailDrafts(job.jobDetailDrafts, { planEdit: undefined }),
      jobDetailDraftVersion: nextJobDraftVersion(job),
    });

    if (!updated) {
      throw new Error('Failed to accept plan');
    }

    return updated;
  });

  ipcMain.handle('jobs:edit-plan', async (_event, jobId: string, feedback: string, images?: JobImage[]) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');
    if (job.column !== 'planning' || job.status !== 'plan-ready') {
      throw new Error('Job is not waiting for plan edits');
    }

    sessionManager.kill(jobId);

    appendOutput(jobId, {
      timestamp: new Date().toISOString(),
      type: 'system',
      content: `--- Editing plan: ${feedback} ---`,
    });

    let totalPausedMs = job.totalPausedMs || 0;
    if (job.waitingStartedAt) {
      totalPausedMs += Date.now() - new Date(job.waitingStartedAt).getTime();
    }

    const updated = updateJob(jobId, {
      status: 'running',
      error: undefined,
      planText: undefined,
      pendingQuestion: undefined,
      waitingStartedAt: undefined,
      totalPausedMs,
      jobDetailDrafts: mergeJobDetailDrafts(job.jobDetailDrafts, { planEdit: undefined }),
      jobDetailDraftVersion: nextJobDraftVersion(job),
    });

    if (updated) {
      sendToRenderer(getWindow, 'job:status-changed', updated);
      const revisionPrompt = [
        'Revise the implementation plan based on the user feedback below.',
        '',
        'Return only the updated implementation plan.',
        '',
        '--- ORIGINAL TASK ---',
        job.prompt,
        '--- END ORIGINAL TASK ---',
        '',
        '--- CURRENT PLAN ---',
        job.planText || '(No plan was captured.)',
        '--- END CURRENT PLAN ---',
        '',
        '--- USER FEEDBACK ---',
        feedback,
        '--- END USER FEEDBACK ---',
      ].join('\n');

      if (images?.length) pendingImages.set(jobId, images);
      await startClaudeSession(updated, getWindow, batchedSender, 'plan', job.sessionId, revisionPrompt);
    }

    return updated;
  });

  ipcMain.handle('jobs:follow-up', async (_event, jobId: string, prompt: string, images?: JobImage[]) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');
    if (job.status !== 'completed') throw new Error('Job is not completed');

    const now = new Date().toISOString();
    const followUps = [...(job.followUps || []), { prompt, timestamp: now }];
    const project = getProjects().find(p => p.id === job.projectId);

    appendOutput(jobId, {
      timestamp: now,
      type: 'system',
      content: `--- Follow-up #${followUps.length}: ${prompt} ---`,
    });

    // Accumulate previous dev elapsed time before resetting
    let devElapsed = job.developmentElapsedMs || 0;
    if (job.developmentStartedAt && job.completedAt) {
      const devPausedMs = Math.max(0, (job.totalPausedMs || 0) - (job.planningPausedMs || 0));
      devElapsed += new Date(job.completedAt).getTime() - new Date(job.developmentStartedAt).getTime() - devPausedMs;
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
      jobDetailDrafts: mergeJobDetailDrafts(job.jobDetailDrafts, { followUp: undefined }),
      jobDetailDraftVersion: nextJobDraftVersion(job),
    });

    if (updated) {
      stepHistoryTracker.startStep(
        jobId,
        getStepLabel((job.stepSnapshots || []).length),
        (job.stepSnapshots || []).length,
      );
      sendToRenderer(getWindow, 'job:status-changed', updated);

      // Generate title for the follow-up in background, with job context
      if (project) {
        const prevContext = (job.title || job.prompt) + (job.summaryText ? `\n\nPrevious result: ${job.summaryText.slice(0, 300)}` : '');
        enqueueTitleGeneration(jobId, prompt, getWindow, followUps.length - 1, prevContext);
      }

      if (images?.length) pendingImages.set(jobId, images);
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
      shell: process.platform === 'win32',
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

  ipcMain.handle('jobs:get-diff', async (_event, jobId: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    if (job.diffText != null) return job.diffText;

    if ((job.stepSnapshots?.length ?? 0) > 0) {
      return buildStoredDiff(job.stepSnapshots);
    }

    return null;
  });

  // === File Rewind (SDK checkpointing) ===

  ipcMain.handle('jobs:rewind-preview', async (_event, jobId: string, userMessageId?: string) => {
    const session = sessionManager.get(jobId);
    if (session) {
      const messages = session.userMessages;
      const targetId = userMessageId || messages[0];
      if (!targetId) return { canRewind: false, error: 'No user messages to rewind to' };
      return session.rewindFiles(targetId, { dryRun: true });
    }

    // Fallback: resume completed session for rewind preview
    const job = getJob(jobId);
    if (!job?.sessionId) return { canRewind: false, error: 'No session to rewind' };
    const uuids = job.userMessageUuids || [];
    const targetId = userMessageId || uuids[0];
    if (!targetId) return { canRewind: false, error: 'No user messages to rewind to' };
    const project = getProjects().find(p => p.id === job.projectId);
    if (!project) return { canRewind: false, error: 'Project not found' };
    return rewindViaResume(project.path, job.sessionId, targetId, { dryRun: true });
  });

  ipcMain.handle('jobs:rewind-files', async (_event, jobId: string, userMessageId?: string) => {
    const session = sessionManager.get(jobId);
    if (session) {
      const messages = session.userMessages;
      const targetId = userMessageId || messages[0];
      if (!targetId) return { canRewind: false, error: 'No user messages to rewind to' };
      return session.rewindFiles(targetId);
    }

    // Fallback: resume completed session for rewind
    const job = getJob(jobId);
    if (!job?.sessionId) return { canRewind: false, error: 'No session to rewind' };
    const uuids = job.userMessageUuids || [];
    const targetId = userMessageId || uuids[0];
    if (!targetId) return { canRewind: false, error: 'No user messages to rewind to' };
    const project = getProjects().find(p => p.id === job.projectId);
    if (!project) return { canRewind: false, error: 'Project not found' };
    return rewindViaResume(project.path, job.sessionId, targetId);
  });

  ipcMain.handle('jobs:rewind-messages', async (_event, jobId: string) => {
    const session = sessionManager.get(jobId);
    if (session) return session.userMessages;

    // Fallback: return persisted UUIDs for completed jobs
    const job = getJob(jobId);
    return job?.userMessageUuids || [];
  });

  // === Settings ===
  // === CLI Health ===
  ipcMain.handle('cli:check-health', async () => {
    return checkCliHealth();
  });

  let loginCleanup: { write: (data: string) => void; kill: () => void } | null = null;

  ipcMain.handle('cli:start-login', () => {
    const win = getWindow();
    if (!win) return;
    loginCleanup = spawnLogin(
      (data) => {
        const w = getWindow();
        if (w && !w.isDestroyed()) w.webContents.send('cli:login-data', data);
      },
      (exitCode) => {
        const w = getWindow();
        if (w && !w.isDestroyed()) w.webContents.send('cli:login-exit', exitCode);
        loginCleanup = null;
      },
    );
  });

  ipcMain.handle('cli:login-write', (_event, data: string) => {
    loginCleanup?.write(data);
  });

  ipcMain.handle('cli:login-kill', () => {
    loginCleanup?.kill();
    loginCleanup = null;
  });

  ipcMain.handle('shell:open-external', (_event, url: string) => {
    return shell.openExternal(url);
  });

  ipcMain.handle('settings:get', () => {
    return getSettings();
  });

  ipcMain.handle('settings:update', (_event, partial: Partial<AppSettings>) => {
    const updated = updateSettings(partial);
    if (partial.theme) {
      nativeTheme.themeSource = partial.theme;
      // Update Windows title bar overlay colors to match new theme
      if (process.platform === 'win32') {
        const win = getWindow();
        const isDark = nativeTheme.shouldUseDarkColors;
        if (win) {
          win.setTitleBarOverlay({
            color: isDark ? '#0c0a09' : '#f1f0ee',
            symbolColor: isDark ? '#e7e5e4' : '#1c1917',
          });
        }
      }
    }
    return updated;
  });

  // === Models ===
  ipcMain.handle('models:list', () => {
    if (cachedDynamicModels) {
      return buildModelCatalog(cachedDynamicModels);
    }
    return [];
  });

  // === Skills ===
  registerSkillsIpc();

  // === Account Info ===
  // Eagerly fetch at startup
  void fetchAccountInfo().then((info) => {
    if (info) {
      cachedAccountInfo = info;
      sendToRenderer(getWindow, 'account:updated', info);
    }
  });

  ipcMain.handle('account:info', async () => {
    if (cachedAccountInfo) return cachedAccountInfo;
    // Lazy fetch if not yet cached
    const info = await fetchAccountInfo();
    if (info) cachedAccountInfo = info;
    return info;
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

    const stepSnapshots = job.stepSnapshots || [];
    const userMessageUuids = job.userMessageUuids || [];

    // Jobs without stored snapshots or rewind points: just mark as rejected without rollback
    if (stepSnapshots.length === 0 && userMessageUuids.length === 0) {
      const updated = updateJob(jobId, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
      }
      return;
    }

    // Default to first (original state) if no index specified
    const targetIndex = snapshotIndex ?? 0;
    const maxRollbackIndex = stepSnapshots.length > 0
      ? stepSnapshots.length - 1
      : userMessageUuids.length - 1;
    if (targetIndex < 0 || targetIndex > maxRollbackIndex) {
      throw new Error('Invalid snapshot index');
    }

    const project = getProjects().find(p => p.id === job.projectId);
    if (!project) throw new Error('Project not found');

    const allJobs = getJobs();
    await rollbackJobToSnapshot(job, project, targetIndex, allJobs);

    const isFullRejection = targetIndex === 0;

    if (isFullRejection) {
      // Full rejection: mark the entire job as rejected
      const updated = updateJob(jobId, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
      }
    } else {
      // Partial rollback: only mark rolled-back steps as rejected, job stays completed
      const now = new Date().toISOString();
      const updatedStepSnapshots = stepSnapshots.map(s =>
        s.order >= targetIndex ? { ...s, rejectedAt: now } : s
      );
      const updatedFollowUps = (job.followUps || []).map((f, i) => {
        // Follow-up at index i corresponds to step order i+1
        const stepOrder = i + 1;
        return stepOrder >= targetIndex ? { ...f, rolledBack: true } : f;
      });
      const updated = updateJob(jobId, {
        stepSnapshots: updatedStepSnapshots,
        followUps: updatedFollowUps,
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
      }
    }
  });
}
