import { app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import type { Job, Project } from '../shared/types';
import { isGitRepoRoot } from './git-snapshot';

const execFileAsync = promisify(execFile);
const GIT_OPTIONS = {
  timeout: 30000,
  maxBuffer: 100 * 1024 * 1024,
  env: { ...process.env, FORCE_COLOR: '0' },
};

async function git(projectPath: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: projectPath, ...GIT_OPTIONS });
  return stdout.trim();
}

async function gitWithEnv(projectPath: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectPath,
    ...GIT_OPTIONS,
    env: { ...GIT_OPTIONS.env, ...env },
  });
  return stdout;
}

function jobWorktreeRoot(): string {
  return path.join(app.getPath('userData'), 'job-worktrees');
}

function slugifyWorktreeName(input: string, jobId: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/[.-]+$/g, '');
  return `${slug || 'job'}-${jobId.slice(0, 8)}`;
}

function worktreePathForJob(worktreeName: string): string {
  return path.join(jobWorktreeRoot(), worktreeName);
}

function worktreeBranchForJob(worktreeName: string): string {
  return `agents-kb/${worktreeName}`;
}

export interface JobWorkspaceMetadata {
  useWorktree: true;
  workspacePath: string;
  workspaceBranch: string;
  workspaceBaseBranch: string;
  workspaceBaseSha: string;
  workspaceState: 'active';
  branch: string;
}

export async function prepareJobWorkspace(
  project: Project,
  jobId: string,
  prompt: string,
  useWorktree?: boolean,
): Promise<Partial<JobWorkspaceMetadata>> {
  if (!useWorktree) return {};

  if (!(await isGitRepoRoot(project.path))) {
    throw new Error('Worktrees require the project path to be a Git repository root.');
  }

  const hasHead = await git(project.path, 'rev-parse', '--verify', 'HEAD').then(
    () => true,
    () => false,
  );
  if (!hasHead) {
    throw new Error('Worktrees require at least one commit in the repository.');
  }

  const baseBranch = await git(project.path, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => '');
  if (!baseBranch) {
    throw new Error('Worktrees cannot be created from a detached HEAD. Check out a branch first.');
  }

  const dirty = await git(project.path, 'status', '--porcelain');
  if (dirty) {
    throw new Error('The project working tree must be clean before creating an isolated worktree. Commit or stash the current changes first.');
  }

  const baseSha = await git(project.path, 'rev-parse', 'HEAD');
  const worktreeName = slugifyWorktreeName(prompt, jobId);
  const workspacePath = worktreePathForJob(worktreeName);
  const workspaceBranch = worktreeBranchForJob(worktreeName);

  await fs.mkdir(jobWorktreeRoot(), { recursive: true });
  await git(project.path, 'worktree', 'prune');

  // Names include the job id. Existing entries are only possible after an interrupted
  // creation attempt, and are safe to reclaim before the job is persisted.
  await git(project.path, 'worktree', 'remove', '--force', workspacePath).catch(() => undefined);
  await fs.rm(workspacePath, { recursive: true, force: true });
  await git(project.path, 'branch', '-D', workspaceBranch).catch(() => undefined);
  await git(project.path, 'worktree', 'add', '-b', workspaceBranch, workspacePath, baseSha);

  return {
    useWorktree: true,
    workspacePath,
    workspaceBranch,
    workspaceBaseBranch: baseBranch,
    workspaceBaseSha: baseSha,
    workspaceState: 'active',
    branch: baseBranch,
  };
}

export async function resolveJobWorkspacePath(job: Job, project: Project): Promise<string> {
  if (!job.useWorktree) return project.path;
  if (job.workspaceState === 'applied' || job.workspaceState === 'discarded') {
    throw new Error(`This worktree was already ${job.workspaceState} and cannot run more sessions.`);
  }
  if (!job.workspacePath || !job.workspaceBranch) {
    throw new Error('The job worktree metadata is incomplete. The main project was not used as a fallback.');
  }

  const stat = await fs.stat(job.workspacePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`The job worktree is missing: ${job.workspacePath}`);
  }

  const actualRoot = await git(job.workspacePath, 'rev-parse', '--show-toplevel').catch(() => '');
  const canonicalActualRoot = actualRoot ? await fs.realpath(actualRoot).catch(() => '') : '';
  const canonicalWorkspacePath = await fs.realpath(job.workspacePath).catch(() => '');
  if (!canonicalActualRoot || canonicalActualRoot !== canonicalWorkspacePath) {
    throw new Error('The saved job workspace is no longer a valid Git worktree.');
  }

  const actualBranch = await git(job.workspacePath, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => '');
  if (actualBranch !== job.workspaceBranch) {
    throw new Error(`The job worktree branch changed unexpectedly (expected ${job.workspaceBranch || 'unknown'}, found ${actualBranch || 'detached HEAD'}).`);
  }

  return job.workspacePath;
}

export async function recoverJobWorkspaceMetadata(job: Job, project: Project): Promise<Partial<Job>> {
  const workspacePath = await resolveJobWorkspacePath(
    { ...job, workspaceState: job.workspaceState || 'active' },
    project,
  );
  const workspaceBaseSha = job.workspaceBaseSha || await git(workspacePath, 'rev-parse', 'HEAD');
  const workspaceBaseBranch = job.workspaceBaseBranch
    || job.branch
    || await git(project.path, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => '');
  if (!workspaceBaseBranch) {
    throw new Error('Could not recover the base branch for this worktree.');
  }
  return {
    workspaceState: 'active',
    workspaceBaseSha,
    workspaceBaseBranch,
    branch: workspaceBaseBranch,
    workspaceError: undefined,
  };
}

export async function cleanupJobWorkspace(job: Job, project: Project): Promise<void> {
  if (!job.useWorktree || !job.workspacePath) return;

  await git(project.path, 'worktree', 'remove', '--force', job.workspacePath).catch(async () => {
    await fs.rm(job.workspacePath!, { recursive: true, force: true });
    await git(project.path, 'worktree', 'prune').catch(() => undefined);
  });

  if (job.workspaceBranch) {
    await git(project.path, 'branch', '-D', job.workspaceBranch).catch(() => undefined);
  }
}

export async function cleanupOrphanedJobWorktrees(jobs: Job[], projects: Project[]): Promise<void> {
  const root = jobWorktreeRoot();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const referenced = new Set(
    jobs.flatMap((job) => job.workspacePath ? [path.resolve(job.workspacePath)] : []),
  );

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspacePath = path.join(root, entry.name);
    if (referenced.has(path.resolve(workspacePath))) continue;

    const dirty = await git(workspacePath, 'status', '--porcelain').catch(() => '__invalid__');
    if (dirty) {
      console.warn(`[worktrees] Preserving unreferenced workspace with changes: ${workspacePath}`);
      continue;
    }

    const commonDirRaw = await git(workspacePath, 'rev-parse', '--git-common-dir').catch(() => '');
    if (!commonDirRaw) continue;
    const commonDir = await fs.realpath(path.resolve(workspacePath, commonDirRaw)).catch(
      () => path.resolve(workspacePath, commonDirRaw),
    );
    let owner: Project | undefined;
    for (const project of projects) {
      const projectCommonRaw = await git(project.path, 'rev-parse', '--git-common-dir').catch(() => '');
      const projectCommonDir = projectCommonRaw
        ? await fs.realpath(path.resolve(project.path, projectCommonRaw)).catch(() => path.resolve(project.path, projectCommonRaw))
        : '';
      if (projectCommonDir === commonDir) {
        owner = project;
        break;
      }
    }
    if (!owner) {
      console.warn(`[worktrees] Could not identify the project for orphaned workspace: ${workspacePath}`);
      continue;
    }

    const branch = await git(workspacePath, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => '');
    await git(owner.path, 'worktree', 'remove', '--force', workspacePath).catch(() => undefined);
    if (branch.startsWith('agents-kb/')) {
      await git(owner.path, 'branch', '-D', branch).catch(() => undefined);
    }
    await git(owner.path, 'worktree', 'prune').catch(() => undefined);
  }
}

export interface ApplyWorkspaceResult {
  changed: boolean;
  targetBranch: string;
}

export async function applyJobWorkspace(job: Job, project: Project): Promise<ApplyWorkspaceResult> {
  const workspacePath = await resolveJobWorkspacePath(job, project);
  if (job.status !== 'completed') throw new Error('Only completed jobs can be applied.');
  if (!job.workspaceBaseBranch || !job.workspaceBaseSha) {
    throw new Error('The job is missing its base branch metadata and cannot be applied safely.');
  }

  const currentBranch = await git(project.path, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => '');
  if (currentBranch !== job.workspaceBaseBranch) {
    throw new Error(`Check out ${job.workspaceBaseBranch} before applying this job (currently on ${currentBranch || 'detached HEAD'}).`);
  }
  const baseIsAncestor = await git(project.path, 'merge-base', '--is-ancestor', job.workspaceBaseSha, 'HEAD').then(
    () => true,
    () => false,
  );
  if (!baseIsAncestor) {
    throw new Error(`The history of ${currentBranch} was rewritten after this worktree was created. Rebase or recover the worktree manually before applying it.`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-kb-worktree-'));
  const indexPath = path.join(tempDir, 'index');
  const patchPath = path.join(tempDir, 'changes.patch');
  const env = { GIT_INDEX_FILE: indexPath };

  try {
    // A temporary index captures tracked, deleted, renamed, untracked and binary files
    // without changing the worktree's own staging state.
    await gitWithEnv(workspacePath, env, 'read-tree', 'HEAD');
    await gitWithEnv(workspacePath, env, 'add', '-A');
    const patch = await gitWithEnv(
      workspacePath,
      env,
      'diff', '--cached', '--binary', '--full-index', job.workspaceBaseSha, '--',
    );

    if (!patch.trim()) {
      return { changed: false, targetBranch: currentBranch };
    }

    await fs.writeFile(patchPath, patch, 'utf8');
    try {
      await git(project.path, 'apply', '--check', '--binary', patchPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`The worktree changes conflict with the current project state. No files were changed. Commit, stash, or resolve overlapping changes and retry.\n${message}`);
    }
    await git(project.path, 'apply', '--binary', patchPath);
    return { changed: true, targetBranch: currentBranch };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
