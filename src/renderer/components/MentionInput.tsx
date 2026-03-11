import { useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useFileMention } from '../hooks/useFileMention';
import { useSlashCommand } from '../hooks/useSlashCommand';
import { MentionDropdown } from './MentionDropdown';
import { SlashCommandDropdown } from './SlashCommandDropdown';

/* ─── MentionInput (single-line) ─── */

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  projectId: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
}

export const MentionInput = forwardRef<HTMLInputElement, MentionInputProps>(function MentionInput(
  { value, onChange, onKeyDown, projectId, placeholder, className, autoFocus, readOnly },
  outerRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(outerRef, () => inputRef.current!);
  const [cursor, setCursor] = useState(0);

  const mention = useFileMention({ projectId, text: value, cursorPosition: cursor });
  const slash = useSlashCommand({ projectId, text: value, cursorPosition: cursor });

  // Slash commands take priority when both are open
  const activeDropdown = slash.isOpen ? 'slash' : mention.isOpen ? 'mention' : null;

  const handleSelect = useCallback(() => {
    setCursor(inputRef.current?.selectionStart ?? 0);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setCursor(e.target.selectionStart ?? 0);
  }, [onChange]);

  const applySelection = useCallback((result: { newText: string; newCursor: number }) => {
    onChange(result.newText);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(result.newCursor, result.newCursor);
      setCursor(result.newCursor);
    });
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (activeDropdown === 'slash' && slash.matches.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applySelection(slash.selectItem(slash.selectedIndex));
        return;
      }
      if (slash.handleKeyDown(e)) return;
    }
    if (activeDropdown === 'mention' && mention.matches.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applySelection(mention.selectItem(mention.selectedIndex));
        return;
      }
      if (mention.handleKeyDown(e)) return;
    }
    onKeyDown?.(e);
  }, [activeDropdown, slash, mention, applySelection, onKeyDown]);

  const handleSlashSelect = useCallback((index: number) => {
    applySelection(slash.selectItem(index));
    inputRef.current?.focus();
  }, [slash, applySelection]);

  const handleMentionSelect = useCallback((index: number) => {
    applySelection(mention.selectItem(index));
    inputRef.current?.focus();
  }, [mention, applySelection]);

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoFocus={autoFocus}
        readOnly={readOnly}
      />
      {activeDropdown === 'slash' && (
        <SlashCommandDropdown
          matches={slash.matches}
          selectedIndex={slash.selectedIndex}
          onSelect={handleSlashSelect}
          onHover={slash.setSelectedIndex}
        />
      )}
      {activeDropdown === 'mention' && (
        <MentionDropdown
          matches={mention.matches}
          selectedIndex={mention.selectedIndex}
          onSelect={handleMentionSelect}
          onHover={mention.setSelectedIndex}
        />
      )}
    </div>
  );
});

/* ─── MentionTextarea (multi-line) ─── */

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  projectId: string;
  placeholder?: string;
  className?: string;
  rows?: number;
  autoFocus?: boolean;
}

export function MentionTextarea({
  value, onChange, onPaste, onDrop, onDragOver, onKeyDown,
  projectId, placeholder, className, rows, autoFocus,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);

  const mention = useFileMention({ projectId, text: value, cursorPosition: cursor });
  const slash = useSlashCommand({ projectId, text: value, cursorPosition: cursor });

  const activeDropdown = slash.isOpen ? 'slash' : mention.isOpen ? 'mention' : null;

  const handleSelect = useCallback(() => {
    setCursor(textareaRef.current?.selectionStart ?? 0);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    setCursor(e.target.selectionStart ?? 0);
  }, [onChange]);

  const applySelection = useCallback((result: { newText: string; newCursor: number }) => {
    onChange(result.newText);
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(result.newCursor, result.newCursor);
      setCursor(result.newCursor);
    });
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (activeDropdown === 'slash' && slash.matches.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applySelection(slash.selectItem(slash.selectedIndex));
        return;
      }
      if (slash.handleKeyDown(e)) return;
    }
    if (activeDropdown === 'mention' && mention.matches.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applySelection(mention.selectItem(mention.selectedIndex));
        return;
      }
      if (mention.handleKeyDown(e)) return;
    }
    onKeyDown?.(e);
  }, [activeDropdown, slash, mention, applySelection, onKeyDown]);

  const handleSlashSelect = useCallback((index: number) => {
    applySelection(slash.selectItem(index));
    textareaRef.current?.focus();
  }, [slash, applySelection]);

  const handleMentionSelect = useCallback((index: number) => {
    applySelection(mention.selectItem(index));
    textareaRef.current?.focus();
  }, [mention, applySelection]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={onDragOver}
        placeholder={placeholder}
        className={className}
        rows={rows}
        autoFocus={autoFocus}
      />
      {activeDropdown === 'slash' && (
        <SlashCommandDropdown
          matches={slash.matches}
          selectedIndex={slash.selectedIndex}
          onSelect={handleSlashSelect}
          onHover={slash.setSelectedIndex}
        />
      )}
      {activeDropdown === 'mention' && (
        <MentionDropdown
          matches={mention.matches}
          selectedIndex={mention.selectedIndex}
          onSelect={handleMentionSelect}
          onHover={mention.setSelectedIndex}
        />
      )}
    </div>
  );
}
