import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { GitSnapshot } from '../shared/types';

const execFileAsync = promisify(execFile);

const GIT_OPTIONS = { timeout: 15000, env: { ...process.env, FORCE_COLOR: '0' } };

async function git(projectPath: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: projectPath, ...GIT_OPTIONS });
  return stdout.trim();
}

/**
 * Checks if the project directory is a git repo root.
 * Returns false for subdirectories of a parent repo — snapshot operations
 * would affect the entire parent repo which is unsafe.
 */
export async function isGitRepoRoot(projectPath: string): Promise<boolean> {
  try {
    const result = await git(projectPath, 'rev-parse', '--is-inside-work-tree');
    if (result !== 'true') return false;

    const toplevel = await git(projectPath, 'rev-parse', '--show-toplevel');
    return path.resolve(toplevel) === path.resolve(projectPath);
  } catch {
    return false;
  }
}

export async function listBranches(
  projectPath: string,
): Promise<{ branches: string[]; current: string } | null> {
  if (!(await isGitRepoRoot(projectPath))) return null;

  try {
    const branchOutput = await git(projectPath, 'branch', '--list', '--no-color');
    const branches = branchOutput
      .split('\n')
      .map((line) => line.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);

    const current = await git(projectPath, 'rev-parse', '--abbrev-ref', 'HEAD');
    return { branches, current };
  } catch {
    return null;
  }
}

export async function checkoutBranch(projectPath: string, branch: string): Promise<void> {
  const status = await git(projectPath, 'status', '--porcelain');
  if (status) {
    throw new Error(
      `Working tree is dirty. Please commit or stash your changes before switching branches.`,
    );
  }
  await git(projectPath, 'checkout', branch);
}

export async function captureSnapshot(
  projectPath: string,
  jobId: string,
  index: number,
  label: string,
): Promise<GitSnapshot | null> {
  if (!(await isGitRepoRoot(projectPath))) return null;

  const commitSha = await git(projectPath, 'rev-parse', 'HEAD');
  const refName = `refs/agent-kanban/${jobId}/${index}`;

  let hadDirtyTree = false;
  let tempCommitSha: string | undefined;

  try {
    const stashSha = await git(projectPath, 'stash', 'create');
    if (stashSha) {
      hadDirtyTree = true;
      tempCommitSha = stashSha;
      await git(projectPath, 'update-ref', refName, stashSha);
    } else {
      await git(projectPath, 'update-ref', refName, commitSha);
    }
  } catch {
    await git(projectPath, 'update-ref', refName, commitSha);
  }

  return { commitSha, hadDirtyTree, tempCommitSha, refName, label };
}

export async function restoreSnapshot(projectPath: string, snapshot: GitSnapshot): Promise<void> {
  await git(projectPath, 'reset', '--hard', snapshot.commitSha);
  await git(projectPath, 'clean', '-fd');

  if (snapshot.hadDirtyTree && snapshot.tempCommitSha) {
    try {
      await git(projectPath, 'stash', 'apply', snapshot.tempCommitSha);
    } catch {
      // Best-effort: stash apply can fail on conflicts
    }
  }
}

export async function cleanupSnapshot(projectPath: string, snapshot: GitSnapshot): Promise<void> {
  try {
    await git(projectPath, 'update-ref', '-d', snapshot.refName);
  } catch {
    // Ref may already be gone
  }
}

export async function cleanupAllSnapshots(projectPath: string, snapshots: GitSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    await cleanupSnapshot(projectPath, snapshot);
  }
}

export async function getDiff(projectPath: string, snapshot: GitSnapshot): Promise<string> {
  try {
    const diff = await git(projectPath, 'diff', snapshot.commitSha);
    return diff;
  } catch {
    return '';
  }
}

export async function gitStageAll(projectPath: string): Promise<void> {
  await git(projectPath, 'add', '-A');
}

export async function gitCommit(projectPath: string, message: string): Promise<string> {
  await git(projectPath, 'commit', '-m', message);
  return git(projectPath, 'rev-parse', 'HEAD');
}

export interface BranchStatus {
  name: string;
  isCurrent: boolean;
  ahead: number;       // commits ahead of remote
  dirtyFiles: number;  // uncommitted changed files (current branch only)
}

export async function getBranchesStatus(projectPath: string): Promise<BranchStatus[] | null> {
  if (!(await isGitRepoRoot(projectPath))) return null;

  try {
    const branchOutput = await git(projectPath, 'branch', '--list', '--no-color');
    const current = await git(projectPath, 'rev-parse', '--abbrev-ref', 'HEAD');

    const branches = branchOutput
      .split('\n')
      .map((line) => line.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);

    const results: BranchStatus[] = [];

    for (const name of branches) {
      const isCurrent = name === current;

      // Count commits ahead of remote tracking branch
      let ahead = 0;
      try {
        const aheadStr = await git(
          projectPath,
          'rev-list',
          '--count',
          `${name}@{upstream}..${name}`,
        );
        ahead = parseInt(aheadStr, 10) || 0;
      } catch {
        // No upstream configured — skip
      }

      // Count dirty files only for current branch
      let dirtyFiles = 0;
      if (isCurrent) {
        try {
          const status = await git(projectPath, 'status', '--porcelain');
          dirtyFiles = status ? status.split('\n').filter(Boolean).length : 0;
        } catch {
          // ignore
        }
      }

      if (ahead > 0 || dirtyFiles > 0) {
        results.push({ name, isCurrent, ahead, dirtyFiles });
      }
    }

    return results;
  } catch {
    return null;
  }
}

export async function gitPush(projectPath: string, branch: string): Promise<{ success: boolean; error?: string }> {
  if (!(await isGitRepoRoot(projectPath))) return { success: false, error: 'Not a git repo' };

  try {
    await git(projectPath, 'push', 'origin', branch);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getDiffBetween(projectPath: string, fromSha: string, toSha: string): Promise<string> {
  try {
    const diff = await git(projectPath, 'diff', fromSha, toSha);
    return diff;
  } catch {
    return '';
  }
}
