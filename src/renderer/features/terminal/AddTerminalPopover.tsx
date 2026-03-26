import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useKanbanStore } from '../../hooks/useKanbanStore';
import { useShortcut } from '../../hooks/useShortcut';
import { ProjectSelect } from '../../components/ProjectSelect';
import { Input } from '../../components/Input';
import { Kbd } from '../../components/Kbd';

interface AddTerminalDialogProps {
  defaultProjectId: string | null;
  onClose: () => void;
}

export function AddTerminalPopover({ defaultProjectId, onClose }: AddTerminalDialogProps) {
  const projects = useKanbanStore((s) => s.projects);
  const terminalTabs = useKanbanStore((s) => s.terminalTabs);
  const addTerminalTab = useKanbanStore((s) => s.addTerminalTab);

  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? projects[0]?.id ?? '');
  const [name, setName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const projectSelectRef = useRef<HTMLSelectElement>(null);

  // Set default name based on project
  useEffect(() => {
    const count = terminalTabs.filter((t) => t.projectId === projectId).length + 1;
    setName(`Terminal ${count}`);
  }, [projectId, terminalTabs]);

  // Focus and select name input on mount
  useEffect(() => {
    const t = setTimeout(() => nameInputRef.current?.select(), 50);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const handleSubmit = useCallback(
    () => {
      if (!projectId || !name.trim()) return;
      addTerminalTab(projectId, name.trim());
      onClose();
    },
    [projectId, name, addTerminalTab, onClose],
  );

  useShortcut('submitForm', handleSubmit, {
    ref: dialogRef,
    enabled: !!projectId && !!name.trim(),
  });

  useShortcut('focusProject', useCallback(() => {
    projectSelectRef.current?.focus();
    projectSelectRef.current?.showPicker?.();
  }, []), { ref: dialogRef, enabled: !defaultProjectId });

  if (projects.length === 0) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />
      <div
        ref={dialogRef}
        className="relative w-80 p-6 rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl animate-[dialogIn_150ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">New Terminal</h2>

        {/* Project selector */}
        <div className="mb-4">
          <label className="flex items-center justify-between text-xs font-medium text-content-secondary uppercase tracking-wider mb-1.5">
            Project
            {!defaultProjectId && <Kbd shortcutId="focusProject" />}
          </label>
          <ProjectSelect
            ref={projectSelectRef}
            projects={projects}
            value={projectId}
            onChange={setProjectId}
          />
        </div>

        {/* Name input */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-content-secondary uppercase tracking-wider mb-1.5">
            Name
          </label>
          <Input
            ref={nameInputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Terminal name"
            autoFocus
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-chrome hover:bg-surface-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!projectId || !name.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-btn-primary text-content-inverted font-medium hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
          >
            Create<Kbd shortcutId="submitForm" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
