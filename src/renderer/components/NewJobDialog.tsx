import { useState, useEffect, useCallback, useRef } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { useShortcut } from '../hooks/useShortcut';
import { Kbd } from './Kbd';
import { SegmentedPicker } from './SegmentedPicker';
import { MentionTextarea } from './MentionInput';
import { MODEL_CATALOG, EFFORT_CATALOG } from '../types/index';
import type { ModelChoice, EffortLevel } from '../types/index';

interface AttachedImage {
  name: string;
  dataUrl: string;
  base64: string;
}

export function NewJobDialog() {
  const projects = useKanbanStore((s) => s.projects);
  const addJob = useKanbanStore((s) => s.addJob);
  const setShowNewJobDialog = useKanbanStore((s) => s.setShowNewJobDialog);
  const filteredProjectId = useKanbanStore((s) => s.selectedProjectId);
  const settings = useKanbanStore((s) => s.settings);
  const api = useElectronAPI();

  const [selectedProjectId, setSelectedProjectId] = useState(filteredProjectId || projects[0]?.id || '');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [skipPlanning, setSkipPlanning] = useState(true);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelChoice>(settings.defaultModel);
  const [selectedEffort, setSelectedEffort] = useState<EffortLevel>(settings.defaultEffort);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const projectSelectRef = useRef<HTMLSelectElement>(null);
  const branchSelectRef = useRef<HTMLSelectElement>(null);

  const togglePlan = useCallback(() => setSkipPlanning((v) => !v), []);

  const addImageFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setImages((prev) => [...prev, { name: file.name, dataUrl, base64 }]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFromFile(file);
      }
    }
  }, [addImageFromFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        addImageFromFile(file);
      }
    }
  }, [addImageFromFile]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        togglePlan();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [togglePlan]);

  const handleSubmit = async () => {
    if (!selectedProjectId || !prompt.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      // Save images to temp files and collect paths
      let imagePaths: string[] | undefined;
      if (images.length > 0) {
        imagePaths = await Promise.all(
          images.map((img) => api.saveImage(img.base64, img.name, selectedProjectId))
        );
      }

      const branchToUse = branches.length > 0 ? selectedBranch : undefined;
      const modelToUse = selectedModel !== settings.defaultModel ? selectedModel : undefined;
      const effortToUse = selectedEffort !== settings.defaultEffort ? selectedEffort : undefined;
      const job = await api.jobsCreate(selectedProjectId, prompt.trim(), skipPlanning || undefined, imagePaths, branchToUse, modelToUse, effortToUse);
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
          {filteredProjectId ? (
            <div className="w-full px-3 py-2 text-sm rounded-lg border border-chrome bg-surface-tertiary/50 text-content-primary">
              {projects.find((p) => p.id === filteredProjectId)?.name}
            </div>
          ) : (
            <div className="relative">
              <select
                ref={projectSelectRef}
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full appearance-none px-3 pr-10 py-2 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
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
                Branch
                <span className="ml-auto"><Kbd shortcutId="focusBranch" /></span>
              </label>
              <div className="relative">
                <select
                  ref={branchSelectRef}
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
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
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </div>
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
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            projectId={selectedProjectId}
            placeholder="Describe what you want Claude to do... Use @ to reference files"
            rows={6}
            className="w-full px-3 py-2 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40 resize-none"
            autoFocus
          />
        </div>

        {/* Image attachments */}
        {images.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div
                key={i}
                className="relative group w-16 h-16 rounded-lg overflow-hidden border border-chrome"
              >
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute inset-0 bg-surface-overlay/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-content-inverted"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Image attach button */}
        <div className="mb-6 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-chrome text-content-secondary hover:text-content-primary hover:bg-surface-tertiary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <circle cx="5.5" cy="5.5" r="1" />
              <path d="M14 10l-3-3-7 7" />
            </svg>
            Attach Image
          </button>
          {images.length > 0 && (
            <span className="text-[10px] text-content-tertiary">
              {images.length} image{images.length !== 1 ? 's' : ''} attached
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files) {
                for (const file of files) {
                  addImageFromFile(file);
                }
              }
              e.target.value = '';
            }}
          />
        </div>

        {/* Plan toggle */}
        <div className="flex items-center justify-between mb-6">
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
          <span className="text-[10px] text-content-tertiary">
            shift+tab
          </span>
        </div>

        {/* Model & Effort */}
        {settings.showModelEffortInNewJob && <div className="mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-content-secondary uppercase tracking-wider">
              Model
            </label>
            <SegmentedPicker
              options={MODEL_CATALOG}
              value={selectedModel}
              onChange={(v) => setSelectedModel(v as ModelChoice)}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-content-secondary uppercase tracking-wider">
              Effort
            </label>
            <SegmentedPicker
              options={EFFORT_CATALOG}
              value={selectedEffort}
              onChange={(v) => setSelectedEffort(v as EffortLevel)}
            />
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
