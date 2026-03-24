import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getProjects } from '../store';
import { isGitRepoRoot } from '../git-snapshot';
import { parseRefs } from '../git-utils';
import type { GitCommit, GitLogResult } from '../../shared/types';

const execFileAsync = promisify(execFile);
const GIT_OPTIONS = { timeout: 15000, env: { ...process.env, FORCE_COLOR: '0' } };
const PAGE_SIZE = 150;

async function git(projectPath: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: projectPath, ...GIT_OPTIONS });
  return stdout;
}

async function getTotalCount(projectPath: string): Promise<number> {
  try {
    const result = await git(projectPath, 'rev-list', '--branches', '--tags', '--remotes', '--count');
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function getGitLog(
  projectPath: string,
  page: number = 0,
  branch?: string,
): Promise<GitLogResult> {
  const skip = page * PAGE_SIZE;
  // Use %B (full body) instead of %s (subject only) to capture multi-line commit messages.
  // %B can contain newlines, so we use record separator (%x1e) between commits.
  const format = '%x1e%h%x00%H%x00%P%x00%an%x00%ae%x00%aI%x00%B%x00%D';

  const args = ['log', '--topo-order', `--format=${format}`, `--skip=${skip}`, `--max-count=${PAGE_SIZE + 1}`];
  if (branch) {
    args.push(branch);
  } else {
    args.push('--branches', '--tags', '--remotes');
  }

  const [output, totalCount] = await Promise.all([
    git(projectPath, ...args),
    page === 0 ? getTotalCount(projectPath) : Promise.resolve(-1),
  ]);

  // Split on record separator, filter empty chunks
  const records = output.split('\x1e').filter((r) => r.includes('\0'));
  const hasMore = records.length > PAGE_SIZE;
  const commitRecords = hasMore ? records.slice(0, PAGE_SIZE) : records;

  // Build full-to-abbreviated hash map
  const fullToAbbrev = new Map<string, string>();
  for (const record of commitRecords) {
    const parts = record.split('\0');
    if (parts.length >= 2) {
      fullToAbbrev.set(parts[1], parts[0].replace(/^\n+/, ''));
    }
  }

  const commits: GitCommit[] = commitRecords.map((record) => {
    const parts = record.split('\0');
    const hash = parts[0].replace(/^\n+/, '');
    const fullHash = parts[1];
    const parentsFull = parts[2];
    const authorName = parts[3];
    const authorEmail = parts[4];
    const date = parts[5];
    const message = (parts[6] || '').trim();
    const refsRaw = parts[7] || '';
    const parents = parentsFull
      ? parentsFull.split(' ').map((p) => fullToAbbrev.get(p) || p.slice(0, 7)).filter(Boolean)
      : [];
    return {
      hash,
      fullHash,
      parents,
      authorName,
      authorEmail,
      date,
      message,
      refs: parseRefs(refsRaw),
    };
  });

  return {
    commits,
    hasMore,
    totalCount: totalCount >= 0 ? totalCount : -1,
  };
}

export function registerGitHistoryIpc(): void {
  ipcMain.handle('git:log', async (_event, projectId: string, page?: number, branch?: string) => {
    const project = getProjects().find((p) => p.id === projectId);
    if (!project) return null;
    if (!(await isGitRepoRoot(project.path))) return null;
    try {
      return await getGitLog(project.path, page ?? 0, branch || undefined);
    } catch (err) {
      console.error('[git-history] Failed to get git log:', err);
      return null;
    }
  });
}
