import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { XIcon } from '../../components/Icons';

interface TerminalTabItemProps {
  tabId: string;
  name: string;
  projectColor?: string;
  isActive: boolean;
  isReady: boolean;
  exitCode: number | null;
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  hint?: ReactNode;
}

export function TerminalTabItem({
  tabId,
  name,
  projectColor,
  isActive,
  isReady,
  exitCode,
  onClick,
  onClose,
  onRename,
  hint,
}: TerminalTabItemProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [editValue, name, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditValue(name);
        setEditing(false);
      }
    },
    [commitRename, name],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(name);
      setEditing(true);
    },
    [name],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('application/terminal-tab-id', tabId);
      e.dataTransfer.effectAllowed = 'move';
      if (buttonRef.current) buttonRef.current.style.opacity = '0.4';
    },
    [tabId],
  );

  const handleDragEnd = useCallback(() => {
    if (buttonRef.current) buttonRef.current.style.opacity = '';
  }, []);

  return (
    <button
      ref={buttonRef}
      draggable={!editing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={handleDoubleClick}
      className={`
        group flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
        transition-colors duration-100 select-none min-w-0
        ${isActive
          ? 'bg-surface-tertiary/80 text-content-primary'
          : 'text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary/40'
        }
      `}
    >
      {/* Color dot */}
      <span
        className={`shrink-0 w-2 h-2 rounded-full ${
          exitCode !== null
            ? 'opacity-50'
            : isReady
              ? isActive
                ? 'opacity-100'
                : 'opacity-80'
              : 'opacity-75 animate-pulse'
        }`}
        style={{ backgroundColor: projectColor || 'currentColor' }}
      />

      {/* Name (editable) */}
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="w-20 bg-surface-elevated border border-chrome-focus rounded px-1 py-0 text-xs text-content-primary outline-none"
          autoFocus
        />
      ) : (
        <span className="truncate max-w-[100px]">{name}</span>
      )}

      {hint}

      {/* Close button */}
      <span
        onClick={handleClose}
        className={`
          w-4 h-4 flex items-center justify-center rounded
          transition-colors duration-75
          ${isActive
            ? 'text-content-tertiary hover:text-content-primary hover:bg-surface-secondary'
            : 'opacity-0 group-hover:opacity-100 text-content-tertiary hover:text-content-primary hover:bg-surface-secondary'
          }
        `}
      >
        <XIcon size={10} />
      </span>
    </button>
  );
}
