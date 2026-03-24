import { useState, useEffect, useCallback, useRef } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { useShortcut } from '../hooks/useShortcut';
import { useImageAttachment } from '../hooks/useImageAttachment';
import { Kbd } from './Kbd';
import { SegmentedPicker } from './SegmentedPicker';
import { MentionTextarea } from './MentionInput';
import { ImageAttachmentBar } from './ImageAttachmentBar';
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
  const imageAttachment = useImageAttachment();
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchError, setBranchError] = useState('');
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
  const branchSelectRef = useRef<HTMLSelectElement>(null);

  const togglePlan = useCallback(() => setSkipPlanning((v) => !v), []);

  const CREATE_BRANCH_VALUE = '__create_new__';

  const newBranchInputRef = useRef<HTMLInputElement>(null);

  const validateBranchName = (name: string): string | null => {
    if (!name.trim()) return 'Branch name is required';
    if (/\s/.test(name)) return 'Cannot contain spaces';
    if (name.startsWith('-')) return 'Cannot start with a dash';
    if (name.includes('..')) return 'Cannot contain ".."';
    if (/[~^:\\]/.test(name)) return 'Contains invalid characters';
    if (name.endsWith('.lock')) return 'Cannot end with ".lock"';
    if (/[./]$/.test(name)) return 'Cannot end with "." or "/"';
    if (branches.includes(name)) return 'Branch already exists';
    return null;
  };

  useEffect(() => {
    if (normalizedSelectedEffort !== selectedEffort) {
      setSelectedEffort(normalizedSelectedEffort);
    }
  }, [normalizedSelectedEffort, selectedEffort]);

  useEffect(() => {
    if (!selectedProjectId) {
      setBranches([]);
      setCurrentBranch('');
      setSelectedBranch('');
      return;
    }
    let cancelled = false;
    setLoadingBranches(true);
    api.gitListBranches(selectedProjectId).then((result) => {
      if (cancelled) return;
      setLoadingBranches(false);
      if (!result) {
        setBranches([]);
        setCurrentBranch('');
        setSelectedBranch('');
        return;
      }
      setBranches(result.branches);
      setCurrentBranch(result.current);
      const project = projects.find((p) => p.id === selectedProjectId);
      const defaultBranch = project?.defaultBranch;
      if (defaultBranch && result.branches.includes(defaultBranch)) {
        setSelectedBranch(defaultBranch);
      } else {
        setSelectedBranch(result.current);
      }
    });
    return () => { cancelled = true; };
  }, [selectedProjectId, api, projects]);

  useShortcut('togglePlan', togglePlan, { ref: dialogRef });

  const handleSubmit = async () => {
    if (!selectedProjectId || !prompt.trim()) return;
    setSubmitting(true);
    setError('');
    setBranchError('');
    try {
      let branchToUse: string | undefined;
      if (isCreatingBranch && newBranchName.trim()) {
        const validationError = validateBranchName(newBranchName.trim());
        if (validationError) {
          setBranchError(validationError);
          setSubmitting(false);
          return;
        }
        const result = await api.gitCreateBranch(selectedProjectId, newBranchName.trim(), selectedBranch);
        if (!result.success) {
          setError(result.error || 'Failed to create branch');
          setSubmitting(false);
          return;
        }
        branchToUse = newBranchName.trim();
      } else {
        branchToUse = branches.length > 0 ? selectedBranch : undefined;
      }
      const modelToUse = selectedModel !== settings.defaultModel ? selectedModel : undefined;
      const thinkingModeToUse = selectedThinkingMode !== settings.defaultThinkingMode ? selectedThinkingMode : undefined;
      const fallbackEffort = normalizeEffortForThinking(currentModelOption, selectedThinkingMode, settings.defaultEffort);
      const effortToUse = normalizedSelectedEffort !== fallbackEffort ? normalizedSelectedEffort : undefined;
      const job = await api.jobsCreate(
        selectedProjectId,
        prompt.trim(),
        skipPlanning || undefined,
        imageAttachment.toJobImages(),
        branchToUse,
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

  useShortcut('focusBranch', useCallback(() => {
    branchSelectRef.current?.focus();
    branchSelectRef.current?.showPicker?.();
  }, []), { ref: dialogRef, enabled: branches.length > 0 });

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
            <div className="relative">
              <span
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: getProjectColor(projects.find((p) => p.id === selectedProjectId)?.color) }}
              />
              <select
                ref={projectSelectRef}
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full appearance-none pl-8 pr-10 py-2 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </div>
          )}
        </div>

        {/* Branch selector */}
        {branches.length > 0 && (() => {
          const selectedProject = projects.find((p) => p.id === selectedProjectId);
          return (
            <div className="mb-4">
              <label className="flex items-center gap-1.5 text-xs font-medium text-content-secondary uppercase tracking-wider mb-1.5">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="3" x2="6" y2="13" />
                  <circle cx="6" cy="3" r="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7c0 3-2 4-6 6" />
                </svg>
                {isCreatingBranch ? 'New Branch' : 'Branch'}
                <span className="ml-auto"><Kbd shortcutId="focusBranch" /></span>
              </label>

              {/* Main dropdown — includes real branches + "Create new branch…" action */}
              <div className="relative">
                <select
                  ref={branchSelectRef}
                  value={isCreatingBranch ? CREATE_BRANCH_VALUE : selectedBranch}
                  onChange={(e) => {
                    if (e.target.value === CREATE_BRANCH_VALUE) {
                      setIsCreatingBranch(true);
                      setBranchError('');
                      setNewBranchName('');
                      requestAnimationFrame(() => newBranchInputRef.current?.focus());
                    } else {
                      setIsCreatingBranch(false);
                      setSelectedBranch(e.target.value);
                      setNewBranchName('');
                      setBranchError('');
                    }
                  }}
                  disabled={loadingBranches}
                  className="w-full appearance-none px-3 pr-10 py-2 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
                >
                  {branches.map((b) => {
                    const suffixes: string[] = [];
                    if (b === currentBranch) suffixes.push('current');
                    if (b === selectedProject?.defaultBranch) suffixes.push('default');
                    const suffix = suffixes.length > 0 ? ` (${suffixes.join(', ')})` : '';
                    return (
                      <option key={b} value={b}>
                        {b}{suffix}
                      </option>
                    );
                  })}
                  <option value={CREATE_BRANCH_VALUE}>+ Create new branch...</option>
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </div>

              {/* New branch fields — revealed when "Create new branch" is selected */}
              {isCreatingBranch && (
                <div className="mt-2 space-y-2">
                  <input
                    ref={newBranchInputRef}
                    type="text"
                    value={newBranchName}
                    onChange={(e) => {
                      setNewBranchName(e.target.value);
                      if (branchError) setBranchError('');
                    }}
                    placeholder="feature/my-branch"
                    className={`w-full px-3 py-2 text-sm rounded-lg border bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40 ${
                      branchError ? 'border-semantic-error' : 'border-chrome'
                    }`}
                  />
                  {branchError && (
                    <p className="text-[11px] text-semantic-error">{branchError}</p>
                  )}
                  <div>
                    <span className="text-[11px] text-content-tertiary mb-1 block">Based on</span>
                    <div className="relative">
                      <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        disabled={loadingBranches}
                        className="w-full appearance-none px-3 pr-10 py-1.5 text-xs rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
                      >
                        {branches.map((b) => {
                          const suffixes: string[] = [];
                          if (b === currentBranch) suffixes.push('current');
                          if (b === selectedProject?.defaultBranch) suffixes.push('default');
                          const suffix = suffixes.length > 0 ? ` (${suffixes.join(', ')})` : '';
                          return (
                            <option key={b} value={b}>
                              {b}{suffix}
                            </option>
                          );
                        })}
                      </select>
                      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 6l4 4 4-4" />
                      </svg>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

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
