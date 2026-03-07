import { useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useFileMention } from '../hooks/useFileMention';
import { MentionDropdown } from './MentionDropdown';

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

  const handleSelect = useCallback(() => {
    setCursor(inputRef.current?.selectionStart ?? 0);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setCursor(e.target.selectionStart ?? 0);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mention.isOpen && mention.matches.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const { newText, newCursor } = mention.selectItem(mention.selectedIndex);
        onChange(newText);
        requestAnimationFrame(() => {
          inputRef.current?.setSelectionRange(newCursor, newCursor);
          setCursor(newCursor);
        });
        return;
      }
      if (mention.handleKeyDown(e)) return;
    }
    onKeyDown?.(e);
  }, [mention, onChange, onKeyDown]);

  const handleDropdownSelect = useCallback((index: number) => {
    const { newText, newCursor } = mention.selectItem(index);
    onChange(newText);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(newCursor, newCursor);
      setCursor(newCursor);
      inputRef.current?.focus();
    });
  }, [mention, onChange]);

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
      {mention.isOpen && (
        <MentionDropdown
          matches={mention.matches}
          selectedIndex={mention.selectedIndex}
          onSelect={handleDropdownSelect}
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

  const handleSelect = useCallback(() => {
    setCursor(textareaRef.current?.selectionStart ?? 0);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    setCursor(e.target.selectionStart ?? 0);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (mention.isOpen && mention.matches.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const { newText, newCursor } = mention.selectItem(mention.selectedIndex);
        onChange(newText);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(newCursor, newCursor);
          setCursor(newCursor);
        });
        return;
      }
      if (mention.handleKeyDown(e)) return;
    }
    onKeyDown?.(e);
  }, [mention, onChange, onKeyDown]);

  const handleDropdownSelect = useCallback((index: number) => {
    const { newText, newCursor } = mention.selectItem(index);
    onChange(newText);
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(newCursor, newCursor);
      setCursor(newCursor);
      textareaRef.current?.focus();
    });
  }, [mention, onChange]);

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
      {mention.isOpen && (
        <MentionDropdown
          matches={mention.matches}
          selectedIndex={mention.selectedIndex}
          onSelect={handleDropdownSelect}
          onHover={mention.setSelectedIndex}
        />
      )}
    </div>
  );
}
