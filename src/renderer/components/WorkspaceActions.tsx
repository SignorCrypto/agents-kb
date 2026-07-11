import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { Job, WorkspacePublishStatus } from '../types/index';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { BranchIcon } from './Icons';

type WorkspaceAction = 'apply' | 'open' | 'status' | 'commit' | 'push' | 'login' | 'pr';

function conciseTitle(job: Job): string {
  const source = job.title || job.prompt;
  return source.split('\n')[0].trim().slice(0, 100) || 'Update project';
}

function pullRequestBody(job: Job): string {
  const sections = [
    '## Summary',
    job.summaryText?.trim() || `Implements the Agents-KB job: ${job.prompt.trim()}`,
  ];
  if (job.editedFiles?.length) {
    sections.push('', '## Files changed', ...job.editedFiles.map((file) => `- \`${file}\``));
  }
  sections.push('', '---', 'Created from an isolated Agents-KB worktree.');
  return sections.join('\n');
}

function StepMark({ complete, label }: { complete: boolean; label: string }) {
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${complete
      ? 'border-semantic-success-border bg-semantic-success-bg text-semantic-success'
      : 'border-chrome bg-surface-elevated text-content-tertiary'
      }`} aria-label={`${label}: ${complete ? 'complete' : 'pending'}`}>
      {complete ? '✓' : '·'}
    </span>
  );
}

export const WorkspaceActions = memo(function WorkspaceActions({ job }: { job: Job }) {
  const api = useElectronAPI();
  const [loading, setLoading] = useState<WorkspaceAction | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [status, setStatus] = useState<WorkspacePublishStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState(() => conciseTitle(job));
  const [prTitle, setPrTitle] = useState(() => conciseTitle(job));

  const updateJob = useCallback((updated: Job) => {
    useKanbanStore.getState().updateJob(updated);
  }, []);

  const refreshStatus = useCallback(async () => {
    if (job.workspaceState !== 'active' || job.status !== 'completed') return;
    setLoading((current) => current || 'status');
    try {
      const next = await api.jobsWorkspaceStatus(job.id);
      setStatus(next);
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to inspect the worktree.');
    } finally {
      setLoading((current) => current === 'status' ? null : current);
    }
  }, [api, job.id, job.status, job.workspaceState]);

  useEffect(() => {
    if (publishOpen) void refreshStatus();
  }, [publishOpen, refreshStatus]);

  const runAction = useCallback(async (
    action: WorkspaceAction,
    operation: () => Promise<Job | WorkspacePublishStatus | { success: boolean; error?: string }>,
  ) => {
    setLoading(action);
    setError(null);
    try {
      const result = await operation();
      if ('id' in result) updateJob(result);
      if ('dirty' in result) setStatus(result);
      if ('success' in result && !result.success) throw new Error(result.error || 'The action failed.');
      if (action !== 'open' && action !== 'apply') await refreshStatus();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The action failed.');
    } finally {
      setLoading(null);
    }
  }, [refreshStatus, updateJob]);

  const handleOpen = useCallback(() => {
    void runAction('open', () => api.jobsOpenWorkspace(job.id));
  }, [api, job.id, runAction]);

  const handleApply = useCallback(() => {
    const confirmed = window.confirm(
      'Apply this worktree locally? Its full delta will become unstaged changes on the base branch, and the isolated workspace will be removed.'
    );
    if (confirmed) void runAction('apply', () => api.jobsApplyWorkspace(job.id));
  }, [api, job.id, runAction]);

  const handleCommit = useCallback(() => {
    void runAction('commit', () => api.jobsCommitWorkspace(job.id, commitMessage));
  }, [api, commitMessage, job.id, runAction]);

  const handlePush = useCallback(() => {
    void runAction('push', () => api.jobsPushWorkspace(job.id));
  }, [api, job.id, runAction]);

  const handleLogin = useCallback(() => {
    void runAction('login', () => api.jobsGithubLogin(job.id));
  }, [api, job.id, runAction]);

  const handlePr = useCallback(() => {
    void runAction('pr', () => api.jobsOpenWorkspacePr(job.id, prTitle, pullRequestBody(job)));
  }, [api, job, prTitle, runAction]);

  const prUrl = job.workspacePrUrl || status?.pullRequestUrl;
  const commitComplete = Boolean(status && !status.dirty && status.commitsAhead > 0);
  const pushComplete = Boolean(status?.upstreamConfigured && status.unpushedCommits === 0);
  const authComplete = Boolean(status?.ghAuthenticated);
  const statusCaption = useMemo(() => {
    if (!status) return 'Inspecting branch state…';
    const parts = [status.dirty ? 'Uncommitted changes' : 'Clean worktree'];
    if (status.commitsAhead > 0) parts.push(`${status.commitsAhead} commit${status.commitsAhead === 1 ? '' : 's'} ahead`);
    if (status.unpushedCommits > 0) parts.push(`${status.unpushedCommits} to push`);
    return parts.join(' · ');
  }, [status]);

  if (job.workspaceState === 'applied') {
    return (
      <div className="shrink-0 mx-3 mb-2 rounded-lg border border-semantic-success/30 bg-semantic-success-bg/15 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-semantic-success">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-semantic-success/15" aria-hidden="true">✓</span>
          Applied to {job.branch || job.workspaceBaseBranch || 'project branch'}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-content-tertiary">Review and commit the changes from the project Git panel.</p>
      </div>
    );
  }

  if (job.workspaceState === 'missing') {
    return (
      <div className="shrink-0 mx-3 mb-2 rounded-lg border border-semantic-error/30 bg-semantic-error-bg/20 px-3 py-2">
        <div className="text-xs font-medium text-semantic-error">Worktree unavailable</div>
        <p className="mt-1 text-[10px] leading-relaxed text-content-secondary">{job.workspaceError || 'The saved workspace could not be validated.'}</p>
      </div>
    );
  }

  if (job.workspaceState === 'discarded') return null;

  return (
    <div className="shrink-0 mx-3 mb-2 overflow-hidden rounded-xl border border-focus-ring/25 bg-focus-ring/[0.05] shadow-sm">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-content-primary">
            <BranchIcon size={12} className="text-focus-ring" />
            Isolated worktree
            {prUrl ? <span className="rounded bg-semantic-success-bg px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-semantic-success">PR open</span> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[9px] text-content-tertiary" title={job.workspacePath}>
            {job.workspaceBranch || job.workspacePath}
          </p>
        </div>
        <button
          onClick={handleOpen}
          disabled={loading !== null}
          className="shrink-0 rounded-md border border-chrome px-2.5 py-1 text-[11px] font-medium text-content-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-40"
        >
          {loading === 'open' ? 'Opening…' : 'Open'}
        </button>
      </div>

      {job.status === 'completed' ? (
        <div className="border-t border-focus-ring/15">
          <div className="grid grid-cols-2 gap-px bg-focus-ring/15">
            <button
              onClick={handleApply}
              disabled={loading !== null || Boolean(prUrl)}
              title={prUrl ? 'This worktree already has a pull request' : 'Apply as unstaged local changes'}
              className="bg-surface-elevated px-3 py-2 text-[11px] font-semibold text-content-primary transition-colors hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading === 'apply' ? 'Applying…' : 'Apply locally'}
            </button>
            <button
              onClick={() => setPublishOpen((open) => !open)}
              className={`px-3 py-2 text-[11px] font-semibold transition-colors ${publishOpen
                ? 'bg-btn-primary text-content-inverted'
                : 'bg-surface-elevated text-content-primary hover:bg-surface-tertiary'
                }`}
              aria-expanded={publishOpen}
            >
              {prUrl ? 'Pull request' : 'Commit & publish'}
            </button>
          </div>

          {publishOpen ? (
            <div className="max-h-[42vh] space-y-3 overflow-y-auto overscroll-contain bg-surface-secondary/70 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-content-tertiary">Branch delivery</span>
                <span className="truncate text-[9px] text-content-tertiary">{statusCaption}</span>
              </div>

              {error ? (
                <div className="rounded-md border border-semantic-error/25 bg-semantic-error-bg/20 px-2.5 py-2 text-[10px] leading-relaxed text-semantic-error">{error}</div>
              ) : null}

              {!status ? (
                error ? (
                  <button
                    onClick={() => void refreshStatus()}
                    disabled={loading !== null}
                    className="w-full rounded-md border border-chrome bg-surface-elevated px-3 py-2 text-[10px] font-semibold text-content-secondary hover:bg-surface-tertiary disabled:opacity-40"
                  >
                    Retry status check
                  </button>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-chrome-subtle bg-surface-elevated/60 px-3 py-3 text-[10px] text-content-tertiary">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-active-indicator" />
                    Reading commits, remote and GitHub status…
                  </div>
                )
              ) : (
              <div className="space-y-2.5">
                <div className="flex gap-2.5">
                  <StepMark complete={commitComplete} label="Commit" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-content-primary">Commit changes</div>
                    {status?.dirty ? (
                      <div className="mt-1.5 flex gap-1.5">
                        <input
                          value={commitMessage}
                          onChange={(event) => setCommitMessage(event.target.value)}
                          placeholder="Commit message"
                          aria-label="Worktree commit message"
                          className="min-w-0 flex-1 rounded-md border border-chrome bg-surface-elevated px-2 py-1.5 text-[11px] text-content-primary outline-none focus:ring-2 focus:ring-focus-ring/30"
                        />
                        <button
                          onClick={handleCommit}
                          disabled={loading !== null || !commitMessage.trim()}
                          className="rounded-md bg-btn-primary px-2.5 py-1.5 text-[10px] font-semibold text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40"
                        >
                          {loading === 'commit' ? 'Committing…' : 'Commit'}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-[10px] text-content-tertiary">
                        {commitComplete ? `${status?.commitsAhead} commit${status?.commitsAhead === 1 ? '' : 's'} ready` : 'No file changes to commit'}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <StepMark complete={pushComplete} label="Push" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold text-content-primary">Push branch</div>
                        <p className="mt-0.5 text-[10px] text-content-tertiary">
                          {status?.remoteName ? `${status.remoteName} · ${status.remoteHost || status.remoteUrl}` : 'No remote configured'}
                        </p>
                      </div>
                      {commitComplete && (!pushComplete || (status?.unpushedCommits || 0) > 0) ? (
                        <button
                          onClick={handlePush}
                          disabled={loading !== null || status?.dirty || !status?.remoteName}
                          className="shrink-0 rounded-md border border-chrome bg-surface-elevated px-2.5 py-1.5 text-[10px] font-semibold text-content-primary hover:bg-surface-tertiary disabled:opacity-40"
                        >
                          {loading === 'push' ? 'Pushing…' : 'Push'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <StepMark complete={Boolean(prUrl)} label="Pull request" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-content-primary">Pull request</div>
                    {prUrl ? (
                      <button
                        onClick={() => void api.shellOpenExternal(prUrl)}
                        className="mt-1.5 w-full rounded-md bg-semantic-success px-3 py-1.5 text-[10px] font-semibold text-content-inverted hover:opacity-90"
                      >
                        Open PR{job.workspacePrNumber || status?.pullRequestNumber ? ` #${job.workspacePrNumber || status?.pullRequestNumber}` : ''} ↗
                      </button>
                    ) : status?.provider === 'none' ? (
                      <p className="mt-0.5 text-[10px] text-content-tertiary">Add a Git remote to publish this branch.</p>
                    ) : status?.provider === 'other' ? (
                      <p className="mt-0.5 text-[10px] text-content-tertiary">Push is available; automatic PR creation currently supports GitHub remotes.</p>
                    ) : !status?.ghInstalled ? (
                      <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-chrome bg-surface-elevated px-2 py-1.5">
                        <span className="text-[10px] text-content-secondary">GitHub CLI is required</span>
                        <button onClick={() => void api.shellOpenExternal('https://cli.github.com/')} className="text-[10px] font-semibold text-interactive-link hover:text-interactive-link-hover">Install gh ↗</button>
                      </div>
                    ) : !authComplete ? (
                      <div className="mt-1.5">
                        <button
                          onClick={handleLogin}
                          disabled={loading !== null}
                          className="w-full rounded-md border border-chrome bg-surface-elevated px-3 py-1.5 text-[10px] font-semibold text-content-primary hover:bg-surface-tertiary disabled:opacity-40"
                        >
                          {loading === 'login' ? 'Complete sign-in in your browser…' : 'Connect GitHub'}
                        </button>
                        {loading === 'login' ? <p className="mt-1 text-[9px] text-content-tertiary">The one-time code is in your clipboard. Agents-KB never receives your token.</p> : null}
                      </div>
                    ) : !pushComplete ? (
                      <p className="mt-0.5 text-[10px] text-content-tertiary">Push the branch before opening a PR.</p>
                    ) : (
                      <div className="mt-1.5 space-y-1.5">
                        <input
                          value={prTitle}
                          onChange={(event) => setPrTitle(event.target.value)}
                          placeholder="Pull request title"
                          aria-label="Pull request title"
                          className="w-full rounded-md border border-chrome bg-surface-elevated px-2 py-1.5 text-[11px] text-content-primary outline-none focus:ring-2 focus:ring-focus-ring/30"
                        />
                        <button
                          onClick={handlePr}
                          disabled={loading !== null || !prTitle.trim()}
                          className="w-full rounded-md bg-btn-primary px-3 py-1.5 text-[10px] font-semibold text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40"
                        >
                          {loading === 'pr' ? 'Opening pull request…' : `Open PR as ${status?.ghLogin || 'GitHub user'}`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
