import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Job, Project } from '../shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

import { applyJobWorkspace } from './job-workspaces';
import { commitWorkspace, getWorkspacePublishStatus, pushWorkspace } from './job-workspace-publishing';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('applyJobWorkspace', () => {
  let root: string;
  let projectPath: string;
  let workspacePath: string;
  let project: Project;
  let job: Job;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-kb-workspace-test-'));
    projectPath = path.join(root, 'project');
    workspacePath = path.join(root, 'worktree');
    fs.mkdirSync(projectPath);
    git(projectPath, 'init', '-q', '-b', 'main');
    git(projectPath, 'config', 'user.email', 'test@example.com');
    git(projectPath, 'config', 'user.name', 'Test');
    fs.writeFileSync(path.join(projectPath, 'modify.txt'), 'alpha\nbeta\n');
    fs.writeFileSync(path.join(projectPath, 'delete.txt'), 'remove me\n');
    fs.writeFileSync(path.join(projectPath, 'binary.bin'), Buffer.from([0, 1, 2]));
    git(projectPath, 'add', '-A');
    git(projectPath, 'commit', '-qm', 'initial');
    const baseSha = git(projectPath, 'rev-parse', 'HEAD');
    git(projectPath, 'worktree', 'add', '-q', '-b', 'agents-kb/test', workspacePath, baseSha);

    fs.writeFileSync(path.join(workspacePath, 'modify.txt'), 'alpha\nchanged\n');
    fs.rmSync(path.join(workspacePath, 'delete.txt'));
    fs.writeFileSync(path.join(workspacePath, 'new.txt'), 'new file\n');
    fs.writeFileSync(path.join(workspacePath, 'binary.bin'), Buffer.from([0, 9, 2, 3]));

    project = {
      id: 'project',
      name: 'Project',
      path: projectPath,
      addedAt: new Date().toISOString(),
      isGitRepo: true,
    };
    job = {
      id: 'job',
      projectId: project.id,
      prompt: 'test',
      column: 'done',
      status: 'completed',
      createdAt: new Date().toISOString(),
      outputLog: [],
      rawMessages: [],
      useWorktree: true,
      workspacePath,
      workspaceBranch: 'agents-kb/test',
      workspaceBaseBranch: git(projectPath, 'branch', '--show-current'),
      workspaceBaseSha: baseSha,
      workspaceState: 'active',
    };
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('applies modified, deleted, untracked and binary files without staging them', async () => {
    const result = await applyJobWorkspace(job, project);

    expect(result).toEqual({ changed: true, targetBranch: 'main' });
    expect(fs.readFileSync(path.join(projectPath, 'modify.txt'), 'utf8')).toBe('alpha\nchanged\n');
    expect(fs.existsSync(path.join(projectPath, 'delete.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(projectPath, 'new.txt'), 'utf8')).toBe('new file\n');
    expect(fs.readFileSync(path.join(projectPath, 'binary.bin'))).toEqual(Buffer.from([0, 9, 2, 3]));
    expect(git(projectPath, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('rejects overlapping changes before mutating the project', async () => {
    fs.writeFileSync(path.join(projectPath, 'modify.txt'), 'alpha\nconflict\n');

    await expect(applyJobWorkspace(job, project)).rejects.toThrow('No files were changed');
    expect(fs.readFileSync(path.join(projectPath, 'modify.txt'), 'utf8')).toBe('alpha\nconflict\n');
    expect(fs.existsSync(path.join(projectPath, 'new.txt'))).toBe(false);
    expect(fs.existsSync(path.join(projectPath, 'delete.txt'))).toBe(true);
  });

  it('applies the full base delta after changes were committed in the worktree', async () => {
    git(workspacePath, 'add', '-A');
    git(workspacePath, 'commit', '-qm', 'feat: committed worktree changes');

    const result = await applyJobWorkspace(job, project);

    expect(result.changed).toBe(true);
    expect(fs.readFileSync(path.join(projectPath, 'modify.txt'), 'utf8')).toBe('alpha\nchanged\n');
    expect(fs.existsSync(path.join(projectPath, 'new.txt'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'delete.txt'))).toBe(false);
  });

  it('commits all worktree changes and reports a clean publishable branch', async () => {
    const sha = await commitWorkspace(job, project, 'feat: publish worktree');
    const status = await getWorkspacePublishStatus({ ...job, workspaceCommitSha: sha }, project);

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(status.dirty).toBe(false);
    expect(status.commitsAhead).toBe(1);
    expect(status.unpushedCommits).toBe(1);
    expect(status.provider).toBe('none');
  });

  it('pushes the isolated branch and configures its upstream', async () => {
    const remotePath = path.join(root, 'remote.git');
    fs.mkdirSync(remotePath);
    git(remotePath, 'init', '--bare', '-q');
    git(workspacePath, 'remote', 'add', 'origin', remotePath);
    const sha = await commitWorkspace(job, project, 'feat: publish worktree');

    await pushWorkspace({ ...job, workspaceCommitSha: sha }, project);
    const status = await getWorkspacePublishStatus({ ...job, workspaceCommitSha: sha }, project);

    expect(status.upstreamConfigured).toBe(true);
    expect(status.unpushedCommits).toBe(0);
    expect(git(workspacePath, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/agents-kb/test');
  });
});
