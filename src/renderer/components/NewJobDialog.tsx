import { useState, useEffect, useCallback, useRef } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { useShortcut } from '../hooks/useShortcut';
import { useImageAttachment } from '../hooks/useImageAttachment';
import { Kbd } from './Kbd';
import { SegmentedPicker } from './SegmentedPicker';
import { MentionTextarea } from './MentionInput';
import { ImageAttachmentBar } from './ImageAttachmentBar';
import { ProjectSelect } from './ProjectSelect';
import { getEffortOptionsForThinking, getProjectColor, getThinkingModeOptionsForModel, normalizeEffortForThinking } from '../types/index';
import type { ModelChoice, EffortLevel, ThinkingMode } from '../types/index';

export function NewJobDialog() {
  const projects = useKanbanStore((s) => s.projects);
  const addJob = useKanbanStore((s) => s.addJob);
  const setShowNewJobDialog = useKanbanStore((s) => s.setShowNewJobDialog);
  const filteredProjectId = useKanbanStore((s) => s.selectedProjectId);
  const settings = useKanbanStore((s) => s.settings);
  const availableModels = useKanbanStore((s) => s.availableModels);
  const api = useElectronAPI();

  const [selectedProjectId, setSelectedProjectId] = useState(filteredProjectId || projects[0]?.id || '');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [skipPlanning, setSkipPlanning] = useState(true);
  const [useWorktree, setUseWorktree] = useState(false);
  const imageAttachment = useImageAttachment();
  const [selectedModel, setSelectedModel] = useState<ModelChoice>(settings.defaultModel);
  const [selectedThinkingMode, setSelectedThinkingMode] = useState<ThinkingMode>(settings.defaultThinkingMode);
  const [selectedEffort, setSelectedEffort] = useState<EffortLevel | undefined>(settings.defaultEffort);

  const currentModelOption = availableModels.find((m) => m.value === selectedModel);
  const thinkingModeOptions = getThinkingModeOptionsForModel(currentModelOption);
  const effortOptions = getEffortOptionsForThinking(currentModelOption, selectedThinkingMode);
  const normalizedSelectedEffort = normalizeEffortForThinking(currentModelOption, selectedThinkingMode, selectedEffort);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const projectSelectRef = useRef<HTMLSelectElement>(null);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const worktreeAvailable = selectedProject?.isGitRepo !== false;

  const togglePlan = useCallback(() => setSkipPlanning((v) => !v), []);

  useEffect(() => {
    if (normalizedSelectedEffort !== selectedEffort) {
      setSelectedEffort(normalizedSelectedEffort);
    }
  }, [normalizedSelectedEffort, selectedEffort]);

  useEffect(() => {
    if (!worktreeAvailable && useWorktree) {
      setUseWorktree(false);
    }
  }, [worktreeAvailable, useWorktree]);

  useShortcut('togglePlan', togglePlan, { ref: dialogRef });

  const handleSubmit = async () => {
    if (!selectedProjectId || !prompt.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const modelToUse = selectedModel !== settings.defaultModel ? selectedModel : undefined;
      const thinkingModeToUse = selectedThinkingMode !== settings.defaultThinkingMode ? selectedThinkingMode : undefined;
      const fallbackEffort = normalizeEffortForThinking(currentModelOption, selectedThinkingMode, settings.defaultEffort);
      const effortToUse = normalizedSelectedEffort !== fallbackEffort ? normalizedSelectedEffort : undefined;
      const job = await api.jobsCreate(
        selectedProjectId,
        prompt.trim(),
        skipPlanning || undefined,
        imageAttachment.toJobImages(),
        useWorktree || undefined,
        modelToUse,
        thinkingModeToUse,
        effortToUse,
      );
      addJob(job);
      setShowNewJobDialog(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create job';
      setError(msg);
      console.error('Failed to create job:', err);
    } finally {
      setSubmitting(false);
    }
  };

  useShortcut('submitForm', handleSubmit, {
    ref: dialogRef,
    enabled: !submitting && !!selectedProjectId && !!prompt.trim(),
  });

  useShortcut('focusProject', useCallback(() => {
    projectSelectRef.current?.focus();
    projectSelectRef.current?.showPicker?.();
  }, []), { ref: dialogRef, enabled: !filteredProjectId });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-surface-overlay/50"
        onClick={() => setShowNewJobDialog(false)}
      />

      {/* Dialog */}
      <div ref={dialogRef} className="relative bg-surface-elevated rounded-xl shadow-2xl border border-chrome/50 w-full max-w-lg mx-4 p-6">
        <h2 className="text-lg font-semibold mb-4">New Job</h2>

        {/* Project selector */}
        <div className="mb-4">
          <label className="flex items-center justify-between text-xs font-medium text-content-secondary uppercase tracking-wider mb-1.5">
            Project
            {!filteredProjectId && <Kbd shortcutId="focusProject" />}
          </label>
          {filteredProjectId ? (() => {
            const fp = projects.find((p) => p.id === filteredProjectId);
            return (
              <div className="w-full px-3 py-2 text-sm rounded-lg border border-chrome bg-surface-tertiary/50 text-content-primary flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: getProjectColor(fp?.color) }}
                />
                {fp?.name}
              </div>
            );
          })() : (
            <ProjectSelect
              ref={projectSelectRef}
              projects={projects}
              value={selectedProjectId}
              onChange={setSelectedProjectId}
            />
          )}
        </div>

        {/* Workspace mode */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => worktreeAvailable && setUseWorktree((v) => !v)}
            disabled={!worktreeAvailable}
            className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${useWorktree
              ? 'border-focus-ring/50 bg-focus-ring/10'
              : 'border-chrome bg-surface-tertiary/35 hover:bg-surface-tertiary/55'
              } ${!worktreeAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-content-secondary"
              >
                <line x1="5" y1="3" x2="5" y2="13" />
                <circle cx="5" cy="3" r="2" />
                <circle cx="11" cy="5" r="2" />
                <path d="M11 7c0 3-2 4-6 6" />
              </svg>
              <span className="text-sm font-medium text-content-primary">Worktree</span>
              {!worktreeAvailable && (
                <span className="text-[11px] text-content-tertiary">Git unavailable</span>
              )}
            </span>
            <span
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${useWorktree ? 'bg-btn-primary' : 'bg-chrome/50'}`}
              aria-hidden="true"
            >
              <span
                className={`absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform ${useWorktree ? 'translate-x-4' : ''}`}
              />
            </span>
          </button>
          {worktreeAvailable && (
            <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-content-tertiary">
              Isolates the job from the currently checked-out branch. The project must be clean; you can review and apply the result when the job is done.
            </p>
          )}
        </div>

        {/* Prompt */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-content-secondary uppercase tracking-wider mb-1.5">
            Prompt
          </label>
          <MentionTextarea
            value={prompt}
            onChange={setPrompt}
            onPaste={imageAttachment.handlePaste}
            onDrop={imageAttachment.handleDrop}
            onDragOver={imageAttachment.handleDragOver}
            projectId={selectedProjectId}
            placeholder="Describe what you want Claude to do... Use @ to reference files"
            rows={6}
            className="w-full px-3 py-2 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40 resize-none"
            autoFocus
          />
        </div>

        {/* Image attachments + Plan toggle — single row */}
        <div className="flex items-center mb-6">
          <ImageAttachmentBar
            images={imageAttachment.images}
            onRemove={imageAttachment.removeImage}
            onAddFiles={imageAttachment.addFiles}
            compact
          />

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlan}
              className="flex items-center gap-2 group"
            >
              <div
                className={`relative w-8 h-[18px] rounded-full transition-colors ${skipPlanning ? 'bg-chrome/40' : 'bg-btn-primary'
                  }`}
              >
                <div
                  className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${skipPlanning ? 'left-[2px]' : 'translate-x-[14px] left-[2px]'
                    }`}
                />
              </div>
              <span className="text-xs text-content-secondary group-hover:text-content-primary transition-colors">
                Plan
              </span>
            </button>
            <Kbd shortcutId="togglePlan" />
          </div>
        </div>

        {/* Model & Thinking */}
        {settings.showModelEffortInNewJob && <div className="mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-content-secondary uppercase tracking-wider">
              Model
            </label>
            <SegmentedPicker
              options={availableModels}
              value={selectedModel}
              onChange={(v) => setSelectedModel(v as ModelChoice)}
            />
          </div>
          <div className="rounded-lg border border-chrome-subtle/50 bg-surface-secondary/70 px-3 py-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium text-content-secondary uppercase tracking-wider">
                Thinking
              </label>
              <SegmentedPicker
                options={thinkingModeOptions}
                value={selectedThinkingMode}
                onChange={(v) => setSelectedThinkingMode(v as ThinkingMode)}
              />
            </div>
            {effortOptions.length > 0 ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-content-tertiary">
                  Effort
                </span>
                <SegmentedPicker
                  options={effortOptions}
                  value={normalizedSelectedEffort ?? effortOptions[0]?.value ?? ''}
                  onChange={(v) => setSelectedEffort(v as EffortLevel)}
                />
              </div>
            ) : (
              <div className="rounded-md bg-surface-tertiary/40 px-3 py-2 text-[11px] leading-relaxed text-content-tertiary">
                {selectedThinkingMode === 'disabled'
                  ? 'Effort is unavailable while thinking is disabled.'
                  : 'This model does not expose effort levels in the SDK.'}
              </div>
            )}
          </div>
        </div>}

        {/* Error */}
        {error && (
          <div className="mb-4 text-xs text-semantic-error bg-semantic-error/10 border border-semantic-error/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setShowNewJobDialog(false)}
            className="px-4 py-2 text-sm rounded-lg border border-chrome hover:bg-surface-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedProjectId || !prompt.trim() || submitting}
            className="px-4 py-2 text-sm rounded-lg bg-btn-primary text-content-inverted font-medium hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
          >
            {submitting ? 'Creating...' : <>Create Job<Kbd shortcutId="submitForm" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
