import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Job, Project, WorkspacePublishStatus } from '../shared/types';
import { resolveJobWorkspacePath } from './job-workspaces';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT = 30_000;
const PUBLISH_TIMEOUT = 120_000;
const LOGIN_TIMEOUT = 10 * 60_000;

async function run(
  cwd: string,
  command: string,
  args: string[],
  timeout = DEFAULT_TIMEOUT,
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  return stdout.trim();
}

const git = (cwd: string, ...args: string[]) => run(cwd, 'git', args);

function remoteHost(remoteUrl?: string): string | undefined {
  if (!remoteUrl) return undefined;
  try {
    return new URL(remoteUrl).hostname;
  } catch {
    return /^(?:[^@]+@)?([^:]+):/.exec(remoteUrl)?.[1];
  }
}

async function resolveRemote(workspacePath: string): Promise<{ name?: string; url?: string }> {
  const remotes = await git(workspacePath, 'remote').catch(() => '');
  const names = remotes.split('\n').map((name) => name.trim()).filter(Boolean);
  const name = names.includes('origin') ? 'origin' : names[0];
  if (!name) return {};
  const url = await git(workspacePath, 'remote', 'get-url', name).catch(() => '');
  return { name, ...(url ? { url } : {}) };
}

async function githubCliInstalled(workspacePath: string): Promise<boolean> {
  return run(workspacePath, 'gh', ['--version']).then(() => true, () => false);
}

async function githubAuth(workspacePath: string, host: string): Promise<{ authenticated: boolean; login?: string }> {
  const authenticated = await run(workspacePath, 'gh', ['auth', 'status', '--hostname', host]).then(
    () => true,
    () => false,
  );
  if (!authenticated) return { authenticated: false };
  const login = await run(workspacePath, 'gh', ['api', '--hostname', host, 'user', '--jq', '.login']).catch(() => '');
  return { authenticated: true, ...(login ? { login } : {}) };
}

async function existingPullRequest(workspacePath: string, branch: string): Promise<{
  url?: string;
  number?: number;
  state?: string;
}> {
  const json = await run(workspacePath, 'gh', [
    'pr', 'view', branch,
    '--json', 'url,number,state',
  ]).catch(() => '');
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as { url?: string; number?: number; state?: string };
    return parsed;
  } catch {
    return {};
  }
}

export async function getWorkspacePublishStatus(job: Job, project: Project): Promise<WorkspacePublishStatus> {
  const workspacePath = await resolveJobWorkspacePath(job, project);
  if (!job.workspaceBaseSha || !job.workspaceBranch) {
    throw new Error('The worktree publishing metadata is incomplete.');
  }

  const [porcelain, commitsAheadText, currentSha, upstream, remote] = await Promise.all([
    git(workspacePath, 'status', '--porcelain'),
    git(workspacePath, 'rev-list', '--count', `${job.workspaceBaseSha}..HEAD`),
    git(workspacePath, 'rev-parse', 'HEAD'),
    git(workspacePath, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').catch(() => ''),
    resolveRemote(workspacePath),
  ]);

  const host = remoteHost(remote.url);
  const unpushedCommits = upstream
    ? Number.parseInt(await git(workspacePath, 'rev-list', '--count', '@{upstream}..HEAD').catch(() => '0'), 10) || 0
    : Number.parseInt(commitsAheadText, 10) || 0;
  const provider = !remote.url
    ? 'none'
    : host && (host === 'github.com' || host.includes('github'))
      ? 'github'
      : 'other';
  const ghInstalled = provider === 'github' && await githubCliInstalled(workspacePath);
  const auth = ghInstalled && host
    ? await githubAuth(workspacePath, host)
    : { authenticated: false as const };
  const pr = auth.authenticated
    ? await existingPullRequest(workspacePath, job.workspaceBranch)
    : {};

  return {
    dirty: porcelain.length > 0,
    commitsAhead: Number.parseInt(commitsAheadText, 10) || 0,
    currentSha,
    upstreamConfigured: upstream.length > 0,
    unpushedCommits,
    ...(remote.name ? { remoteName: remote.name } : {}),
    ...(remote.url ? { remoteUrl: remote.url } : {}),
    ...(host ? { remoteHost: host } : {}),
    provider,
    ghInstalled,
    ghAuthenticated: auth.authenticated,
    ...(auth.login ? { ghLogin: auth.login } : {}),
    ...(pr.url ? { pullRequestUrl: pr.url } : {}),
    ...(pr.number ? { pullRequestNumber: pr.number } : {}),
    ...(pr.state ? { pullRequestState: pr.state } : {}),
  };
}

export async function commitWorkspace(job: Job, project: Project, message: string): Promise<string> {
  const workspacePath = await resolveJobWorkspacePath(job, project);
  if (!message.trim()) throw new Error('A commit message is required.');
  await git(workspacePath, 'add', '-A');
  const staged = await git(workspacePath, 'diff', '--cached', '--name-only');
  if (!staged) {
    const existingAhead = job.workspaceBaseSha
      ? Number.parseInt(await git(workspacePath, 'rev-list', '--count', `${job.workspaceBaseSha}..HEAD`), 10) || 0
      : 0;
    if (existingAhead > 0) return git(workspacePath, 'rev-parse', 'HEAD');
    throw new Error('There are no worktree changes to commit.');
  }
  await git(workspacePath, 'commit', '-m', message.trim());
  return git(workspacePath, 'rev-parse', 'HEAD');
}

export async function pushWorkspace(job: Job, project: Project): Promise<{ sha: string; remoteName: string }> {
  const workspacePath = await resolveJobWorkspacePath(job, project);
  if (!job.workspaceBranch) throw new Error('The worktree branch is missing.');
  const status = await getWorkspacePublishStatus(job, project);
  if (status.dirty) throw new Error('Commit the remaining worktree changes before pushing.');
  if (status.commitsAhead === 0) throw new Error('The worktree has no commits to push.');
  if (!status.remoteName) throw new Error('No Git remote is configured for this project.');
  await run(
    workspacePath,
    'git',
    ['push', '--set-upstream', status.remoteName, job.workspaceBranch],
    PUBLISH_TIMEOUT,
  );
  return { sha: status.currentSha, remoteName: status.remoteName };
}

export async function loginGithub(job: Job, project: Project): Promise<void> {
  const workspacePath = await resolveJobWorkspacePath(job, project);
  const status = await getWorkspacePublishStatus(job, project);
  if (!status.ghInstalled) throw new Error('GitHub CLI (gh) is not installed.');
  if (!status.remoteHost) throw new Error('The GitHub remote host could not be determined.');
  if (status.ghAuthenticated) return;
  await run(workspacePath, 'gh', [
    'auth', 'login',
    '--hostname', status.remoteHost,
    '--web',
    '--clipboard',
    '--git-protocol', 'https',
  ], LOGIN_TIMEOUT);
  if (/^https?:\/\//i.test(status.remoteUrl || '')) {
    await run(workspacePath, 'gh', ['auth', 'setup-git', '--hostname', status.remoteHost]);
  }
}

export async function openWorkspacePullRequest(
  job: Job,
  project: Project,
  title: string,
  body: string,
): Promise<{ url: string; number?: number }> {
  const workspacePath = await resolveJobWorkspacePath(job, project);
  if (!job.workspaceBranch || !job.workspaceBaseBranch) {
    throw new Error('The worktree branch metadata is incomplete.');
  }
  if (!title.trim()) throw new Error('A pull request title is required.');
  const status = await getWorkspacePublishStatus(job, project);
  if (status.dirty) throw new Error('Commit the remaining worktree changes before opening a pull request.');
  if (!status.upstreamConfigured) throw new Error('Push the worktree branch before opening a pull request.');
  if (status.unpushedCommits > 0) throw new Error('Push the latest worktree commits before opening a pull request.');
  if (!status.ghInstalled) throw new Error('GitHub CLI (gh) is not installed.');
  if (!status.ghAuthenticated) throw new Error('Connect GitHub before opening a pull request.');
  if (status.pullRequestUrl) {
    return { url: status.pullRequestUrl, number: status.pullRequestNumber };
  }

  const output = await run(workspacePath, 'gh', [
    'pr', 'create',
    '--head', job.workspaceBranch,
    '--base', job.workspaceBaseBranch,
    '--title', title.trim(),
    '--body', body.trim(),
  ], PUBLISH_TIMEOUT);
  const url = output.split('\n').map((line) => line.trim()).find((line) => /^https?:\/\//.test(line));
  if (!url) throw new Error('GitHub CLI did not return a pull request URL.');
  const pr = await existingPullRequest(workspacePath, job.workspaceBranch);
  return { url: pr.url || url, ...(pr.number ? { number: pr.number } : {}) };
}
