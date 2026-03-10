import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Job, JobFileSnapshot, JobStepSnapshot } from '../shared/types';

const execFileAsync = promisify(execFile);

export interface FileState {
  exists: boolean;
  isBinary: boolean;
  content?: string;
  hash?: string;
}

export interface FileStateDiffEntry {
  path: string;
  before: FileState;
  after: FileState;
}

interface PendingTrackedFile {
  path: string;
  before: FileState;
}

interface PendingStepState {
  id: string;
  label: string;
  order: number;
  startedAt: string;
  gitSnapshotIndex?: number;
  files: Map<string, PendingTrackedFile>;
}

export interface ToolCallPayload {
  name: string;
  input: Record<string, unknown>;
}

export interface RollbackFileTarget {
  path: string;
  desired: FileState;
  current: FileState;
  history: JobFileSnapshot[];
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

function hashBuffer(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex');
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export async function readProjectFileState(projectPath: string, filePath: string): Promise<FileState> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectPath, filePath);
  try {
    const buffer = await fs.promises.readFile(absolutePath);
    const binary = isBinaryBuffer(buffer);
    return {
      exists: true,
      isBinary: binary,
      content: binary ? undefined : buffer.toString('utf-8'),
      hash: hashBuffer(buffer),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { exists: false, isBinary: false };
    }
    throw error;
  }
}

function toSnapshotKind(before: FileState, after: FileState): JobFileSnapshot['kind'] {
  if ((before.exists && before.isBinary) || (after.exists && after.isBinary)) return 'binary';
  if (!before.exists && after.exists) return 'created';
  if (before.exists && !after.exists) return 'deleted';
  return 'text';
}

export function fileSnapshotBeforeState(file: JobFileSnapshot): FileState {
  return {
    exists: file.beforeExists,
    isBinary: file.beforeIsBinary,
    content: file.beforeContent,
    hash: file.beforeHash,
  };
}

export function fileSnapshotAfterState(file: JobFileSnapshot): FileState {
  return {
    exists: file.afterExists,
    isBinary: file.afterIsBinary,
    content: file.afterContent,
    hash: file.afterHash,
  };
}

function sortedSteps(stepSnapshots?: JobStepSnapshot[]): JobStepSnapshot[] {
  return [...(stepSnapshots || [])].sort((a, b) => a.order - b.order);
}

async function buildTextDiff(
  filePath: string,
  before: FileState,
  after: FileState,
): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agents-kb-diff-'));
  const beforePath = path.join(tmpDir, 'before');
  const afterPath = path.join(tmpDir, 'after');
  await fs.promises.writeFile(beforePath, before.content || '', 'utf-8');
  await fs.promises.writeFile(afterPath, after.content || '', 'utf-8');

  try {
    let raw = '';
    try {
      const result = await execFileAsync(
        'git',
        ['diff', '--no-index', '--text', '--src-prefix=a/', '--dst-prefix=b/', '--', beforePath, afterPath],
        { cwd: tmpDir, env: { ...process.env, FORCE_COLOR: '0' } },
      );
      raw = result.stdout;
    } catch (error) {
      const diffErr = error as Error & { stdout?: string };
      raw = diffErr.stdout || '';
    }

    if (!raw.trim()) return '';

    return raw
      .replace(/^diff --git a\/.* b\/.*$/m, `diff --git a/${filePath} b/${filePath}`)
      .replace(/^--- .+$/m, before.exists ? `--- a/${filePath}` : '--- /dev/null')
      .replace(/^\+\+\+ .+$/m, after.exists ? `+++ b/${filePath}` : '+++ /dev/null')
      .trim();
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

function buildBinaryDiff(filePath: string, before: FileState, after: FileState): string {
  const left = before.exists ? `a/${filePath}` : '/dev/null';
  const right = after.exists ? `b/${filePath}` : '/dev/null';
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- ${left}`,
    `+++ ${right}`,
    `Binary files ${left} and ${right} differ`,
  ].join('\n');
}

function pathsFromToolInput(input: Record<string, unknown>): string[] {
  const maybePath = input.file_path || input.notebook_path;
  if (typeof maybePath === 'string') return [maybePath];
  return [];
}

export function mergeStatesByPath(stepSnapshots?: JobStepSnapshot[]): Map<string, { before: FileState; after: FileState }> {
  const merged = new Map<string, { before: FileState; after: FileState }>();

  for (const step of sortedSteps(stepSnapshots)) {
    for (const file of step.files) {
      const before = fileSnapshotBeforeState(file);
      const after = fileSnapshotAfterState(file);
      const existing = merged.get(file.path);
      if (!existing) {
        merged.set(file.path, { before, after });
      } else {
        existing.after = after;
      }
    }
  }

  return merged;
}

export function fileStatesEqual(left: FileState, right: FileState): boolean {
  return (
    left.exists === right.exists &&
    left.isBinary === right.isBinary &&
    left.hash === right.hash
  );
}

export async function buildDiffFromEntries(entries: FileStateDiffEntry[]): Promise<string> {
  const chunks: string[] = [];

  for (const entry of entries) {
    if (fileStatesEqual(entry.before, entry.after)) continue;

    if (entry.before.isBinary || entry.after.isBinary) {
      chunks.push(buildBinaryDiff(entry.path, entry.before, entry.after));
      continue;
    }

    const diff = await buildTextDiff(entry.path, entry.before, entry.after);
    if (diff) chunks.push(diff);
  }

  return chunks.join('\n\n').trim();
}

export function normalizeToolPath(projectPath: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectPath, filePath);
  const normalized = path.normalize(absolutePath);
  const projectRoot = path.normalize(projectPath + path.sep);
  if (normalized.startsWith(projectRoot)) {
    return path.relative(projectPath, normalized).replace(/\\/g, '/');
  }
  return filePath.replace(/\\/g, '/');
}

export class JobStepHistoryTracker {
  private pendingSteps = new Map<string, PendingStepState>();

  startStep(jobId: string, label: string, order: number, gitSnapshotIndex?: number): void {
    this.pendingSteps.set(jobId, {
      id: uuidv4(),
      label,
      order,
      startedAt: new Date().toISOString(),
      gitSnapshotIndex,
      files: new Map(),
    });
  }

  discardStep(jobId: string): void {
    this.pendingSteps.delete(jobId);
  }

  hasPendingStep(jobId: string): boolean {
    return this.pendingSteps.has(jobId);
  }

  async recordToolCall(jobId: string, projectPath: string, payload: ToolCallPayload): Promise<void> {
    const step = this.pendingSteps.get(jobId);
    if (!step || !FILE_TOOLS.has(payload.name)) return;

    const filePaths = pathsFromToolInput(payload.input);
    for (const filePath of filePaths) {
      const normalizedPath = normalizeToolPath(projectPath, filePath);
      if (step.files.has(normalizedPath)) continue;
      const before = await readProjectFileState(projectPath, normalizedPath);
      step.files.set(normalizedPath, { path: normalizedPath, before });
    }
  }

  async finalizeStep(jobId: string, projectPath: string, appliedSeq: number): Promise<JobStepSnapshot | null> {
    const step = this.pendingSteps.get(jobId);
    if (!step) return null;
    this.pendingSteps.delete(jobId);

    const files: JobFileSnapshot[] = [];
    for (const tracked of step.files.values()) {
      const after = await readProjectFileState(projectPath, tracked.path);
      const changed =
        tracked.before.exists !== after.exists ||
        tracked.before.isBinary !== after.isBinary ||
        tracked.before.hash !== after.hash;
      if (!changed) continue;

      files.push({
        path: tracked.path,
        kind: toSnapshotKind(tracked.before, after),
        beforeExists: tracked.before.exists,
        afterExists: after.exists,
        beforeIsBinary: tracked.before.isBinary,
        afterIsBinary: after.isBinary,
        beforeContent: tracked.before.content,
        afterContent: after.content,
        beforeHash: tracked.before.hash,
        afterHash: after.hash,
      });
    }

    return {
      id: step.id,
      label: step.label,
      order: step.order,
      startedAt: step.startedAt,
      completedAt: new Date().toISOString(),
      appliedSeq,
      gitSnapshotIndex: step.gitSnapshotIndex,
      files,
    };
  }
}

export function getNextProjectAppliedSeq(jobs: Job[], projectId: string): number {
  let maxAppliedSeq = 0;
  for (const job of jobs) {
    if (job.projectId !== projectId) continue;
    for (const step of job.stepSnapshots || []) {
      if (step.appliedSeq > maxAppliedSeq) maxAppliedSeq = step.appliedSeq;
    }
  }
  return maxAppliedSeq + 1;
}

export function getLatestProjectAppliedSeq(jobs: Job[], projectId: string): number {
  return getNextProjectAppliedSeq(jobs, projectId) - 1;
}

export async function buildStoredDiff(stepSnapshots?: JobStepSnapshot[]): Promise<string> {
  const merged = mergeStatesByPath(stepSnapshots);
  const chunks: string[] = [];

  for (const [filePath, states] of merged) {
    const before = states.before;
    const after = states.after;
    const unchanged =
      before.exists === after.exists &&
      before.isBinary === after.isBinary &&
      before.hash === after.hash;
    if (unchanged) continue;

    if (before.isBinary || after.isBinary) {
      chunks.push(buildBinaryDiff(filePath, before, after));
      continue;
    }

    const diff = await buildTextDiff(filePath, before, after);
    if (diff) chunks.push(diff);
  }

  return chunks.join('\n\n').trim();
}

export function buildRollbackTargets(
  job: Job,
  targetStepOrder: number,
  currentStates: Map<string, FileState>,
): { targets: RollbackFileTarget[]; unsupportedBinary: string[] } | null {
  const steps = sortedSteps(job.stepSnapshots);
  if (steps.length === 0 || targetStepOrder < 0 || targetStepOrder >= steps.length) return null;

  const boundaryState = new Map<string, FileState>();
  for (const step of steps) {
    if (step.order >= targetStepOrder) break;
    for (const file of step.files) {
      boundaryState.set(file.path, fileSnapshotAfterState(file));
    }
  }

  const targets: RollbackFileTarget[] = [];
  const unsupportedBinary: string[] = [];
  const affectedByPath = new Map<string, JobFileSnapshot[]>();

  for (const step of steps) {
    if (step.order < targetStepOrder) continue;
    for (const file of step.files) {
      const list = affectedByPath.get(file.path);
      if (list) list.push(file);
      else affectedByPath.set(file.path, [file]);
    }
  }

  for (const [filePath, history] of affectedByPath) {
    const desired =
      boundaryState.get(filePath) ||
      (history[0] ? fileSnapshotBeforeState(history[0]) : { exists: false, isBinary: false });
    const current = currentStates.get(filePath) || { exists: false, isBinary: false };
    if (desired.isBinary || current.isBinary || history.some((entry) => entry.beforeIsBinary || entry.afterIsBinary)) {
      unsupportedBinary.push(filePath);
      continue;
    }
    targets.push({ path: filePath, desired, current, history });
  }

  return { targets, unsupportedBinary };
}

export async function readCurrentStates(
  projectPath: string,
  filePaths: string[],
): Promise<Map<string, FileState>> {
  const states = new Map<string, FileState>();
  await Promise.all(
    filePaths.map(async (filePath) => {
      states.set(filePath, await readProjectFileState(projectPath, filePath));
    }),
  );
  return states;
}

export async function validateRollbackTargets(
  projectPath: string,
  targets: RollbackFileTarget[],
): Promise<boolean> {
  const currentStates = await readCurrentStates(projectPath, targets.map((target) => target.path));
  return targets.every((target) => {
    const current = currentStates.get(target.path) || { exists: false, isBinary: false };
    return (
      current.exists === target.desired.exists &&
      current.isBinary === target.desired.isBinary &&
      current.hash === target.desired.hash
    );
  });
}

export function serializeRollbackContext(targets: RollbackFileTarget[], targetLabel: string): string {
  const parts = [
    `Target rollback boundary: ${targetLabel}`,
    'Modify ONLY the listed files. Restore each file to the desired target state exactly. If that cannot be done safely, explain why and make no changes.',
  ];

  for (const target of targets) {
    const history = target.history
      .map((entry, index) => {
        const after = entry.afterExists ? (entry.afterContent || '') : '[delete file]';
        return `Step ${index + 1} (${entry.kind}) after:\n${after}`;
      })
      .join('\n\n');

    parts.push(
      [
        `FILE: ${target.path}`,
        `CURRENT STATE:\n${target.current.exists ? target.current.content || '' : '[missing]'}`,
        `DESIRED STATE:\n${target.desired.exists ? target.desired.content || '' : '[delete file]'}`,
        `STEP HISTORY:\n${history || '[no history]'}`,
      ].join('\n\n'),
    );
  }

  return parts.join('\n\n---\n\n');
}
