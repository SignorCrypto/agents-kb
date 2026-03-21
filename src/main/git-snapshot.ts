import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import type { FileState } from './job-step-history';
import type { ChangedFile } from '../shared/types';

export interface GitSnapshot {
  commitSha: string;
  hadDirtyTree: boolean;
  tempCommitSha?: string;
  refName: string;
  label: string;
}

const execFileAsync = promisify(execFile);

const GIT_OPTIONS = { timeout: 15000, env: { ...process.env, FORCE_COLOR: '0' } };

async function git(projectPath: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: projectPath, ...GIT_OPTIONS });
  return stdout.trim();
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex');
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function parsePorcelainPath(line: string): string | null {
  const rawPath = line.slice(3).trim();
  if (!rawPath) return null;
  const renameParts = rawPath.split(' -> ');
  return (renameParts[renameParts.length - 1] || '').trim() || null;
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
  const refName = `refs/agents-kb/${jobId}/${index}`;

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

export async function listChangedFiles(projectPath: string): Promise<string[]> {
  if (!(await isGitRepoRoot(projectPath))) return [];

  try {
    const status = await git(projectPath, 'status', '--porcelain=v1', '--untracked-files=all');
    return status
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map(parsePorcelainPath)
      .filter((filePath): filePath is string => Boolean(filePath));
  } catch {
    return [];
  }
}

function parseStatusCode(xy: string): ChangedFile['status'] {
  const x = xy[0];
  const y = xy[1];
  if (x === '?' && y === '?') return 'untracked';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'A' || y === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  return 'modified';
}

export async function listChangedFilesDetailed(projectPath: string): Promise<ChangedFile[]> {
  if (!(await isGitRepoRoot(projectPath))) return [];

  try {
    // Use execFileAsync directly — the git() helper trims the full stdout,
    // which strips the leading space from the first line's XY status code.
    const { stdout } = await execFileAsync(
      'git', ['status', '--porcelain=v1', '--untracked-files=all'],
      { cwd: projectPath, ...GIT_OPTIONS },
    );

    // Fetch per-file diff stats (additions/deletions)
    const statMap = new Map<string, { additions: number; deletions: number }>();
    try {
      const { stdout: numstat } = await execFileAsync(
        'git', ['diff', '--numstat', 'HEAD'],
        { cwd: projectPath, ...GIT_OPTIONS },
      );
      for (const line of numstat.split('\n').filter(Boolean)) {
        const [add, del, ...pathParts] = line.split('\t');
        const p = pathParts.join('\t');
        if (p && add !== '-' && del !== '-') {
          statMap.set(p, { additions: parseInt(add, 10), deletions: parseInt(del, 10) });
        }
      }
    } catch {
      // diff stats are optional — ignore errors (e.g. no HEAD yet)
    }

    return stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const xy = line.slice(0, 2);
        const rest = line.slice(3).trim();
        if (!rest) return null;

        const renameParts = rest.split(' -> ');
        const filePath = (renameParts[renameParts.length - 1] || '').trim();
        if (!filePath) return null;

        const changedFile: ChangedFile = {
          path: filePath,
          status: parseStatusCode(xy),
        };
        if (renameParts.length > 1) {
          changedFile.oldPath = renameParts[0].trim();
        }
        const stats = statMap.get(filePath);
        if (stats) {
          changedFile.additions = stats.additions;
          changedFile.deletions = stats.deletions;
        }
        return changedFile;
      })
      .filter((f): f is ChangedFile => f !== null);
  } catch {
    return [];
  }
}

export async function getFileDiff(projectPath: string, filePath: string, isUntracked: boolean = false): Promise<string> {
  if (!(await isGitRepoRoot(projectPath))) return '';

  try {
    if (isUntracked) {
      try {
        return await git(projectPath, 'diff', '--no-index', '--', '/dev/null', filePath);
      } catch (err) {
        // git diff --no-index exits with code 1 when files differ, which is expected
        if (err instanceof Error && 'stdout' in err) {
          return (err as Error & { stdout: string }).stdout || '';
        }
        return '';
      }
    }

    // Try diff against HEAD first (shows both staged and unstaged vs last commit)
    try {
      const diff = await git(projectPath, 'diff', 'HEAD', '--', filePath);
      if (diff) return diff;
    } catch {
      // HEAD might not exist (empty repo), fall through
    }

    // Fallback: unstaged changes only
    try {
      const diff = await git(projectPath, 'diff', '--', filePath);
      if (diff) return diff;
    } catch {
      // ignore
    }

    // Fallback: staged changes only
    try {
      return await git(projectPath, 'diff', '--cached', '--', filePath);
    } catch {
      return '';
    }
  } catch {
    return '';
  }
}

export async function gitStageFiles(projectPath: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await git(projectPath, 'add', '--', ...files);
}

export async function gitDiscardFile(
  projectPath: string,
  filePath: string,
  isUntracked: boolean = false,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (isUntracked) {
      await fs.unlink(path.join(projectPath, filePath));
    } else {
      await git(projectPath, 'checkout', 'HEAD', '--', filePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function readHeadFileState(projectPath: string, filePath: string): Promise<FileState> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['show', `HEAD:${filePath}`],
      { cwd: projectPath, ...GIT_OPTIONS, encoding: 'buffer' as never },
    );
    const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    const binary = isBinaryBuffer(buffer);
    return {
      exists: true,
      isBinary: binary,
      content: binary ? undefined : buffer.toString('utf-8'),
      hash: hashBuffer(buffer),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
    const stderr = typeof err.stderr === 'string'
      ? err.stderr
      : Buffer.isBuffer(err.stderr)
        ? err.stderr.toString('utf-8')
        : '';
    if (
      stderr.includes('exists on disk, but not in') ||
      stderr.includes('does not exist in') ||
      stderr.includes('pathspec')
    ) {
      return { exists: false, isBinary: false };
    }
    return { exists: false, isBinary: false };
  }
}
