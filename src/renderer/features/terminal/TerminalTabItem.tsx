import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { XIcon, TerminalIcon } from '../../components/Icons';

interface TerminalTabItemProps {
  name: string;
  isActive: boolean;
  isReady: boolean;
  exitCode: number | null;
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  hint?: ReactNode;
}

export function TerminalTabItem({
  name,
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

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={handleDoubleClick}
      className={`
        group flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
        transition-colors duration-100 select-none shrink-0
        ${isActive
          ? 'bg-surface-tertiary/80 text-content-primary'
          : 'text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary/40'
        }
      `}
    >
      {/* Status icon */}
      <TerminalIcon
        size={10}
        className={`shrink-0 ${
          exitCode !== null
            ? 'text-content-tertiary'
            : isReady
              ? 'text-content-primary'
              : 'text-content-tertiary animate-pulse'
        }`}
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
