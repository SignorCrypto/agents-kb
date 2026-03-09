import { ipcMain, dialog, BrowserWindow, nativeTheme, shell } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createHash } from 'crypto';
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
import { notifyInputNeeded, notifyJobComplete, notifyJobError } from './notifications';
import { isGitRepoRoot, captureSnapshot, restoreSnapshot, cleanupAllSnapshots, getDiff, listBranches, checkoutBranch, gitStageAll, gitCommit, getBranchesStatus, gitPush, listChangedFiles, readHeadFileState } from './git-snapshot';
import { listProjectFiles } from './file-list';
import type { Job, OutputEntry, RawMessage, PendingQuestion, AppSettings, Project, ModelChoice, EffortLevel, PromptConfig } from '../shared/types';
import { DEFAULT_PROMPT_CONFIGS } from '../shared/types';
import {
  JobStepHistoryTracker,
  buildDiffFromEntries,
  buildRollbackTargets,
  buildStoredDiff,
  fileSnapshotAfterState,
  fileStatesEqual,
  type FileState,
  getLatestProjectAppliedSeq,
  getNextProjectAppliedSeq,
  normalizeToolPath,
  readCurrentStates,
  serializeRollbackContext,
  validateRollbackTargets,
} from './job-step-history';

type WindowGetter = () => BrowserWindow | null;

const stepHistoryTracker = new JobStepHistoryTracker();

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
  const project = getProjects().find(p => p.id === job.projectId);
  const snapshots = [...(job.gitSnapshots || [])];
  if (snapshots.length === 0 && project && projectIsGitRepo(project)) {
    const snapshot = await captureSnapshot(project.path, jobId, 0, 'Original');
    if (snapshot) snapshots.push(snapshot);
  }

  const outputLog = getOutputLog(jobId);
  outputLog.push({
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
    gitSnapshots: snapshots,
    outputLog,
  });

  if (updated) {
    stepHistoryTracker.startStep(
      jobId,
      getStepLabel((job.stepSnapshots || []).length),
      (job.stepSnapshots || []).length,
      snapshots.length > 0 ? 0 : undefined,
    );
    sendToRenderer(getWindow, 'job:status-changed', updated);
    await startClaudeSession(updated, getWindow, batchedSender, 'dev', sessionId || job.sessionId);
  }

  return updated;
}

async function cleanupCompletedJobsForBranch(project: Project, branch: string): Promise<string[]> {
  const completedJobs = getJobs().filter(
    (job) => job.projectId === project.id && job.branch === branch && (job.status === 'completed' || job.status === 'rejected'),
  );

  for (const job of completedJobs) {
    stepHistoryTracker.discardStep(job.id);
    if (job.gitSnapshots?.length) {
      await cleanupAllSnapshots(project.path, job.gitSnapshots);
    }
    deleteJob(job.id);
  }

  invalidateCommitMessageCache(project.id, branch);
  return completedJobs.map((job) => job.id);
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

interface CommitMessageCacheEntry {
  fingerprint: string;
  message: string;
}

interface OrderedCommitJob {
  job: Job;
  sortSeq: number;
  message: string;
}

interface BranchCommitInputs {
  fingerprint: string;
  perJobItems: string[];
  uncategorizedDiff: string;
}

const commitMessageCache = new Map<string, CommitMessageCacheEntry>();

function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function commitCacheKey(projectId: string, branch: string): string {
  return `${projectId}:${branch}`;
}

function invalidateCommitMessageCache(projectId: string, branch?: string): void {
  if (!branch) return;
  commitMessageCache.delete(commitCacheKey(projectId, branch));
}

function sanitizeCommitLine(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0]
    ?.replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim() || '';
}

function parseCommitListLines(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split('\n')
    .map((line) => sanitizeCommitLine(line))
    .filter(Boolean);
}

function fallbackCommitSubject(): string {
  return 'chore: apply completed jobs';
}

function fallbackCommitItem(): string {
  return 'chore: update project';
}

function fallbackExtraCommitItem(): string {
  return 'chore: update additional branch changes';
}

function buildJobContext(job: Job): string {
  const sections = [
    `Primary task: ${job.title || job.prompt}`,
  ];

  if (job.followUps?.length) {
    sections.push(
      'Follow-ups:',
      ...job.followUps.map((followUp, index) => `- ${index + 1}. ${followUp.title || followUp.prompt}`),
    );
  }

  if (job.stepSnapshots?.length) {
    sections.push(
      'Development steps:',
      ...job.stepSnapshots.map((step) => `- ${step.label}`),
    );
  }

  return sections.join('\n');
}

function buildPerJobCommitPrompt(config: PromptConfig, job: Job, diffText: string): string {
  return [
    config.prompt,
    'Summarize the ENTIRE job below as a single concise conventional-commit line.',
    'Use the full job context and the cumulative diff, not just the latest follow-up or last step.',
    'Output exactly one line with no bullet prefix, no numbering, and no surrounding quotes.',
    '',
    'JOB CONTEXT:',
    buildJobContext(job),
    '',
    'JOB DIFF:',
    diffText || '[no diff available]',
  ].join('\n');
}

function buildExtraCommitItemsPrompt(config: PromptConfig, diffText: string): string {
  return [
    config.prompt,
    'Summarize ONLY the uncategorized branch changes below.',
    'Output one or more concise conventional-commit lines, one item per line, with no bullet prefixes, no numbering, and no surrounding quotes.',
    '',
    'UNCATEGORIZED DIFF:',
    diffText,
  ].join('\n');
}

function buildCommitSubjectPrompt(config: PromptConfig, items: string[]): string {
  return [
    config.prompt,
    'Generate a single concise conventional-commit subject that covers the combined list below.',
    'Output exactly one line with no bullet prefix, no numbering, and no surrounding quotes.',
    '',
    'COMBINED ITEMS:',
    ...items.map((item) => `- ${item}`),
  ].join('\n');
}

function buildCommitMessage(subject: string, items: string[], options?: { omitSingleItemBody?: boolean }): string {
  const cleanSubject = sanitizeCommitLine(subject) || fallbackCommitSubject();
  const cleanItems = items.map((item) => sanitizeCommitLine(item)).filter(Boolean);
  if (options?.omitSingleItemBody && cleanItems.length === 1) return cleanSubject;
  if (cleanItems.length === 0) return cleanSubject;
  return `${cleanSubject}\n\n${cleanItems.map((item) => `- ${item}`).join('\n')}`;
}

function extractPathsFromDiffText(diffText?: string): string[] {
  if (!diffText) return [];
  const matches = diffText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm);
  const paths = new Set<string>();
  for (const match of matches) {
    const candidate = (match[2] || match[1] || '').trim();
    if (candidate) paths.add(candidate);
  }
  return Array.from(paths);
}

function getJobLatestAppliedSeq(job: Job): number {
  const sequences = (job.stepSnapshots || []).map((step) => step.appliedSeq);
  if (sequences.length > 0) return Math.max(...sequences);
  const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
  return completedAt > 0 ? completedAt : Number.MAX_SAFE_INTEGER;
}

async function getOrderedCompletedJobsForBranch(project: Project, branch: string): Promise<OrderedCommitJob[]> {
  const jobs = getJobs().filter(
    (job) => job.projectId === project.id && job.branch === branch && job.status === 'completed',
  );
  const resolved: OrderedCommitJob[] = [];

  for (const job of jobs) {
    let message = sanitizeCommitLine(job.generatedCommitMessage);
    let diffText = job.diffText?.trim() || '';

    if (!message) {
      diffText = diffText || await buildStableJobDiff(project.path, job, job.stepSnapshots);
      try {
        message = await generateJobCommitMessage(project.path, job, diffText);
      } catch {
        message = fallbackCommitItem();
      }

      const updated = updateJob(job.id, {
        diffText: diffText || undefined,
        generatedCommitMessage: message,
      });
      if (updated) {
        message = sanitizeCommitLine(updated.generatedCommitMessage) || message;
      }
    }

    resolved.push({
      job,
      sortSeq: getJobLatestAppliedSeq(job),
      message,
    });
  }

  return resolved
    .filter((entry) => Boolean(entry.message))
    .sort((left, right) => {
      if (left.sortSeq !== right.sortSeq) return left.sortSeq - right.sortSeq;
      const leftCompleted = left.job.completedAt ? new Date(left.job.completedAt).getTime() : 0;
      const rightCompleted = right.job.completedAt ? new Date(right.job.completedAt).getTime() : 0;
      if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
      return left.job.createdAt.localeCompare(right.job.createdAt);
    });
}

async function buildStableJobDiff(projectPath: string, job: Job, stepSnapshots?: Job['stepSnapshots']): Promise<string> {
  if ((stepSnapshots?.length ?? 0) > 0) {
    const stored = await buildStoredDiff(stepSnapshots);
    if (stored.trim()) return stored;
  }

  if (job.diffText?.trim()) return job.diffText.trim();

  const snapshots = job.gitSnapshots || [];
  if (snapshots.length > 0) {
    const liveDiff = await getDiff(projectPath, snapshots[0]);
    if (liveDiff.trim()) return liveDiff.trim();
  }

  return '';
}

async function generateJobCommitMessage(projectPath: string, job: Job, diffText: string): Promise<string> {
  const normalizedDiff = diffText.trim();
  if (!normalizedDiff) return fallbackCommitItem();

  const config = getPromptConfig('commit');
  const raw = await runClaudePrint(
    projectPath,
    buildPerJobCommitPrompt(config, job, normalizedDiff),
    { model: config.model, effort: config.effort },
  );
  return sanitizeCommitLine(raw) || fallbackCommitItem();
}

async function generateExtraCommitItems(projectPath: string, diffText: string): Promise<string[]> {
  const normalizedDiff = diffText.trim();
  if (!normalizedDiff) return [];

  const config = getPromptConfig('commit');
  const raw = await runClaudePrint(
    projectPath,
    buildExtraCommitItemsPrompt(config, normalizedDiff),
    { model: config.model, effort: config.effort },
  );
  const lines = parseCommitListLines(raw);
  return lines.length > 0 ? lines : [fallbackExtraCommitItem()];
}

async function generateCombinedCommitSubject(projectPath: string, items: string[]): Promise<string> {
  const cleanItems = items.map((item) => sanitizeCommitLine(item)).filter(Boolean);
  if (cleanItems.length === 0) return fallbackCommitSubject();

  const config = getPromptConfig('commit');
  const raw = await runClaudePrint(
    projectPath,
    buildCommitSubjectPrompt(config, cleanItems),
    { model: config.model, effort: config.effort },
  );
  return sanitizeCommitLine(raw) || cleanItems[0] || fallbackCommitSubject();
}

async function buildUncategorizedDiff(project: Project, orderedJobs: OrderedCommitJob[]): Promise<string> {
  const exactCoveredStates = new Map<string, FileState>();
  const opaqueCoveredPaths = new Set<string>();
  const sortedSteps = orderedJobs
    .flatMap(({ job }) =>
      (job.stepSnapshots || []).map((step) => ({
        step,
        job,
      })),
    )
    .sort((left, right) => {
      if (left.step.appliedSeq !== right.step.appliedSeq) return left.step.appliedSeq - right.step.appliedSeq;
      return left.step.completedAt.localeCompare(right.step.completedAt);
    });

  for (const { step } of sortedSteps) {
    for (const file of step.files) {
      exactCoveredStates.set(file.path, fileSnapshotAfterState(file));
    }
  }

  for (const { job } of orderedJobs) {
    if ((job.stepSnapshots?.length ?? 0) > 0) continue;
    for (const filePath of new Set([...(job.editedFiles || []), ...extractPathsFromDiffText(job.diffText)])) {
      opaqueCoveredPaths.add(filePath);
    }
  }

  const changedFiles = await listChangedFiles(project.path);
  if (changedFiles.length === 0) return '';

  const currentStates = await readCurrentStates(project.path, changedFiles);
  const diffEntries: Array<{ path: string; before: FileState; after: FileState }> = [];

  for (const filePath of changedFiles) {
    const currentState = currentStates.get(filePath) || { exists: false, isBinary: false };
    const coveredState = exactCoveredStates.get(filePath);

    if (coveredState) {
      if (!fileStatesEqual(coveredState, currentState)) {
        diffEntries.push({ path: filePath, before: coveredState, after: currentState });
      }
      continue;
    }

    if (opaqueCoveredPaths.has(filePath)) continue;

    const headState = await readHeadFileState(project.path, filePath);
    if (!fileStatesEqual(headState, currentState)) {
      diffEntries.push({ path: filePath, before: headState, after: currentState });
    }
  }

  return buildDiffFromEntries(diffEntries);
}

async function computeBranchCommitInputs(project: Project, branch: string): Promise<BranchCommitInputs> {
  const orderedJobs = await getOrderedCompletedJobsForBranch(project, branch);
  const perJobItems = orderedJobs.map((entry) => entry.message);
  const uncategorizedDiff = await buildUncategorizedDiff(project, orderedJobs);
  return {
    perJobItems,
    uncategorizedDiff,
    fingerprint: hashText(JSON.stringify({
      branch,
      jobs: orderedJobs.map((entry) => ({
        id: entry.job.id,
        sortSeq: entry.sortSeq,
        message: entry.message,
      })),
      uncategorizedDiff,
    })),
  };
}

async function computeBranchCommitMessage(project: Project, branch: string, inputs?: BranchCommitInputs): Promise<CommitMessageCacheEntry> {
  const resolvedInputs = inputs || await computeBranchCommitInputs(project, branch);
  const extraItems = resolvedInputs.uncategorizedDiff
    ? await generateExtraCommitItems(project.path, resolvedInputs.uncategorizedDiff)
    : [];
  const items = [...resolvedInputs.perJobItems, ...extraItems];
  const subject = await generateCombinedCommitSubject(project.path, items);
  const omitSingleItemBody = resolvedInputs.perJobItems.length === 1 && extraItems.length === 0;

  return {
    fingerprint: resolvedInputs.fingerprint,
    message: buildCommitMessage(subject, items, { omitSingleItemBody }),
  };
}

async function getOrGenerateBranchCommitMessage(projectId: string, branch: string): Promise<string> {
  const project = getProjects().find((candidate) => candidate.id === projectId);
  if (!project) throw new Error('Project not found');

  const inputs = await computeBranchCommitInputs(project, branch);
  const cacheKey = commitCacheKey(projectId, branch);
  const cached = commitMessageCache.get(cacheKey);
  if (cached?.fingerprint === inputs.fingerprint) {
    return cached.message;
  }

  const nextEntry = await computeBranchCommitMessage(project, branch, inputs);
  commitMessageCache.set(cacheKey, nextEntry);
  return nextEntry.message;
}

async function generateAndCacheBranchCommitMessage(projectId: string, branch: string): Promise<void> {
  try {
    await getOrGenerateBranchCommitMessage(projectId, branch);
  } catch {
    // Best-effort
  }
}

async function resolveCommitBranch(project: Project, branch?: string): Promise<string | null> {
  if (branch) return branch;
  const branches = await listBranches(project.path);
  return branches?.current || null;
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
      prompt = `The planning phase produced this implementation plan. Carry it out now.\n\n--- IMPLEMENTATION PLAN ---\n${job.planText}\n--- END PLAN ---`;
    } else {
      prompt = 'Continue from planning and implement the requested changes.';
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

  session.on('tool-call', (payload: { name: string; input: Record<string, unknown> }) => {
    void stepHistoryTracker.recordToolCall(job.id, project.path, payload);
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

      void startDevelopmentPhase(job.id, getWindow, batchedSender, sessionId, {
        planningEndedAt: new Date().toISOString(),
        totalPausedMs,
      });
    }
  });

  session.on('close', async (code: number) => {
    const current = getJob(job.id);
    if (!current) return;

    if (code !== 0 || current.status === 'error') {
      stepHistoryTracker.discardStep(job.id);
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
        generatedCommitMessage: undefined,
        editedFiles: editedFiles.length > 0 ? editedFiles : undefined,
        stepSnapshots: nextStepSnapshots,
      });
      if (updated) {
        sendToRenderer(getWindow, 'job:status-changed', updated);
        sendToRenderer(getWindow, 'job:complete', { jobId: job.id });
        notifyJobComplete(job.id, project.name, job.title || job.prompt, getWindow);

        void (async () => {
          try {
            const commitMessage = await generateJobCommitMessage(project.path, updated, diffText);
            const refreshed = updateJob(job.id, { generatedCommitMessage: commitMessage });
            if (refreshed) {
              sendToRenderer(getWindow, 'job:status-changed', refreshed);
            }
          } catch {
            const refreshed = updateJob(job.id, { generatedCommitMessage: fallbackCommitItem() });
            if (refreshed) {
              sendToRenderer(getWindow, 'job:status-changed', refreshed);
            }
          } finally {
            if (updated.branch && projectIsGitRepo(project)) {
              invalidateCommitMessageCache(updated.projectId, updated.branch);
              void generateAndCacheBranchCommitMessage(updated.projectId, updated.branch);
            }
          }
        })();
      }
    } else {
      if (current.column === 'planning' && current.status === 'running') {
        await startDevelopmentPhase(job.id, getWindow, batchedSender, sessionId, {
          planningEndedAt: new Date().toISOString(),
        });
      }
    }
  });

  session.on('error', (errorMsg: string) => {
    stepHistoryTracker.discardStep(job.id);
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

function runClaudeEditTask(projectPath: string, prompt: string, options?: { model?: string; effort?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process') as typeof import('child_process');
    const args = ['-p', '--dangerously-skip-permissions'];
    if (options?.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
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
        reject(new Error(`claude exited with code ${code}: ${stderr || stdout}`));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
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

  const guardSnapshot = await captureSnapshot(projectPath, `${job.id}-rollback-guard`, Date.now(), 'Rollback guard');
  const config = getPromptConfig('rollback');
  const prompt = buildPromptText(config, `\n\n${serializeRollbackContext(rollbackPlan.targets, targetLabel)}`);

  try {
    await runClaudeEditTask(projectPath, prompt, { model: config.model, effort: config.effort });
    const valid = await validateRollbackTargets(projectPath, rollbackPlan.targets);
    if (!valid) {
      throw new Error('Rollback output did not match the requested target state');
    }
  } catch (error) {
    if (guardSnapshot) {
      await restoreSnapshot(projectPath, guardSnapshot);
    }
    throw error;
  } finally {
    if (guardSnapshot) {
      await cleanupAllSnapshots(projectPath, [guardSnapshot]);
    }
  }
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
    const { spawn: spawnProc } = await import('child_process');
    const { existsSync } = await import('fs');

    const launchDetached = (command: string, args: string[]): Promise<boolean> =>
      new Promise((resolve) => {
        try {
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

    // Editor definitions with CLI and app bundle fallbacks.
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

      invalidateCommitMessageCache(projectId, targetBranch || undefined);
      return { success: true, sha, deletedJobIds, warning };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('git:generate-commit-message', async (_event, projectId: string, branch?: string) => {
    const project = getProjects().find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');
    const targetBranch = await resolveCommitBranch(project, branch);
    if (!targetBranch) {
      const config = getPromptConfig('commit');
      const prompt = buildPromptText(config);
      return runClaudePrint(project.path, prompt, { model: config.model, effort: config.effort });
    }
    return getOrGenerateBranchCommitMessage(projectId, targetBranch);
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
      stepHistoryTracker.startStep(job.id, getStepLabel(0), 0, job.gitSnapshots?.length ? 0 : undefined);
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
    stepHistoryTracker.discardStep(jobId);
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
    stepHistoryTracker.discardStep(jobId);
    const job = getJob(jobId);
    if (job?.branch) {
      invalidateCommitMessageCache(job.projectId, job.branch);
    }
    if (job?.gitSnapshots?.length) {
      const project = getProjects().find(p => p.id === job.projectId);
      if (project) {
        await cleanupAllSnapshots(project.path, job.gitSnapshots);
      }
    }
    deleteJob(jobId);
  });

  ipcMain.handle('jobs:retry', async (_event, jobId: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    sessionManager.kill(jobId);
    stepHistoryTracker.discardStep(jobId);

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
      completedAt: undefined,
      diffText: undefined,
      generatedCommitMessage: undefined,
      ...elapsedUpdate,
      outputLog,
    });

    if (updated) {
      if (job.branch) {
        invalidateCommitMessageCache(job.projectId, job.branch);
      }
      if (phase === 'dev') {
        stepHistoryTracker.startStep(
          jobId,
          getStepLabel((job.stepSnapshots || []).length),
          (job.stepSnapshots || []).length,
          job.gitSnapshots ? (job.stepSnapshots || []).length : undefined,
        );
      }
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
      generatedCommitMessage: undefined,
      followUps,
      gitSnapshots: snapshots,
      outputLog,
    });

    if (updated) {
      if (job.branch) {
        invalidateCommitMessageCache(job.projectId, job.branch);
      }
      stepHistoryTracker.startStep(
        jobId,
        getStepLabel((job.stepSnapshots || []).length),
        (job.stepSnapshots || []).length,
        snapshots.length > 0 ? snapshots.length - 1 : undefined,
      );
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

  ipcMain.handle('jobs:get-diff', async (_event, jobId: string) => {
    const job = getJob(jobId);
    if (!job) throw new Error('Job not found');

    if (job.diffText != null) return job.diffText;

    if ((job.stepSnapshots?.length ?? 0) > 0) {
      return buildStoredDiff(job.stepSnapshots);
    }

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
    const stepSnapshots = job.stepSnapshots || [];

    // Non-git or legacy jobs without stored snapshots: just mark as rejected without rollback
    if (stepSnapshots.length === 0 && snapshots.length === 0) {
      const updated = updateJob(jobId, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
      });
      if (updated) {
        if (job.branch) {
          invalidateCommitMessageCache(job.projectId, job.branch);
        }
        sendToRenderer(getWindow, 'job:status-changed', updated);
      }
      return;
    }

    // Default to first snapshot (original state) if no index specified
    const targetIndex = snapshotIndex ?? 0;
    const maxRollbackIndex = stepSnapshots.length > 0 ? stepSnapshots.length - 1 : snapshots.length - 1;
    if (targetIndex < 0 || targetIndex > maxRollbackIndex) {
      throw new Error('Invalid snapshot index');
    }

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

    const targetLabel = snapshots[targetIndex]?.label || (targetIndex === 0 ? 'Original' : getStepLabel(targetIndex));
    const latestAppliedSeq = getLatestProjectAppliedSeq(allJobs, job.projectId);
    const canUseGitFastPath =
      snapshots.length > targetIndex &&
      (stepSnapshots.length === 0 || stepSnapshots[stepSnapshots.length - 1]?.appliedSeq === latestAppliedSeq);

    if (canUseGitFastPath && snapshots.length > targetIndex) {
      await restoreSnapshot(project.path, snapshots[targetIndex]);
    } else if (stepSnapshots.length > 0) {
      await rollbackWithModel(job, project.path, targetIndex, targetLabel);
    }

    if (snapshots.length > 0) {
      await cleanupAllSnapshots(project.path, snapshots);
    }

    const isFullRejection = targetIndex === 0;

    if (isFullRejection) {
      // Full rejection: mark the entire job as rejected
      const updated = updateJob(jobId, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        gitSnapshots: undefined,
      });
      if (updated) {
        if (job.branch) {
          invalidateCommitMessageCache(job.projectId, job.branch);
        }
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
        gitSnapshots: undefined,
      });
      if (updated) {
        if (job.branch) {
          invalidateCommitMessageCache(job.projectId, job.branch);
        }
        sendToRenderer(getWindow, 'job:status-changed', updated);
      }
    }
  });
}
