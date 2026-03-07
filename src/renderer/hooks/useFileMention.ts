import { useState, useEffect, useCallback, useRef } from 'react';

const fileCache = new Map<string, string[]>();

function fuzzyMatch(query: string, filePath: string): number {
  const lower = filePath.toLowerCase();
  const q = query.toLowerCase();

  // Exact substring match scores highest
  const subIdx = lower.indexOf(q);
  if (subIdx !== -1) {
    // Prefer filename matches over path matches
    const fileName = lower.split('/').pop() || '';
    if (fileName.indexOf(q) !== -1) return 1000 - subIdx;
    return 500 - subIdx;
  }

  // Fuzzy: all chars in order
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 100;

  return -1; // no match
}

function filterFiles(files: string[], query: string, max: number): string[] {
  if (!query) return files.slice(0, max);

  const scored: { file: string; score: number }[] = [];
  for (const file of files) {
    const score = fuzzyMatch(query, file);
    if (score >= 0) scored.push({ file, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.file);
}

interface MentionState {
  isOpen: boolean;
  matches: string[];
  selectedIndex: number;
  mentionStart: number; // cursor position of the "@"
}

export interface UseFileMentionOptions {
  projectId: string;
  text: string;
  cursorPosition: number;
}

export interface UseFileMentionResult {
  isOpen: boolean;
  matches: string[];
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => boolean; // returns true if consumed
  selectItem: (index: number) => { newText: string; newCursor: number };
  dismiss: () => void;
}

export function useFileMention({ projectId, text, cursorPosition }: UseFileMentionOptions): UseFileMentionResult {
  const [state, setState] = useState<MentionState>({
    isOpen: false,
    matches: [],
    selectedIndex: 0,
    mentionStart: -1,
  });
  const filesRef = useRef<string[]>([]);
  const fetchingRef = useRef<string | null>(null);

  // Fetch file list lazily
  const ensureFiles = useCallback(async (pid: string) => {
    if (fileCache.has(pid)) {
      filesRef.current = fileCache.get(pid)!;
      return;
    }
    if (fetchingRef.current === pid) return;
    fetchingRef.current = pid;
    try {
      const files = await window.electronAPI.filesList(pid);
      fileCache.set(pid, files);
      filesRef.current = files;
    } catch {
      filesRef.current = [];
    } finally {
      fetchingRef.current = null;
    }
  }, []);

  // Detect "@" trigger and update matches
  useEffect(() => {
    if (!projectId || cursorPosition <= 0) {
      if (state.isOpen) setState((s) => ({ ...s, isOpen: false }));
      return;
    }

    // Find the last "@" before cursor
    let atPos = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
      if (text[i] === '@') {
        atPos = i;
        break;
      }
      // Stop at whitespace or newline — the "@" must be contiguous
      if (text[i] === ' ' || text[i] === '\n' || text[i] === '\r') break;
    }

    // Also allow "@" at position with space/newline before it or at start
    if (atPos >= 0 && atPos > 0) {
      const charBefore = text[atPos - 1];
      if (charBefore !== ' ' && charBefore !== '\n' && charBefore !== '\r') {
        // "@" is mid-word — still allow it (file paths don't have spaces)
      }
    }

    if (atPos < 0) {
      if (state.isOpen) setState((s) => ({ ...s, isOpen: false }));
      return;
    }

    const query = text.slice(atPos + 1, cursorPosition);
    // Don't trigger if there's a space in the query (user moved on)
    if (query.includes(' ') || query.includes('\n')) {
      if (state.isOpen) setState((s) => ({ ...s, isOpen: false }));
      return;
    }

    ensureFiles(projectId).then(() => {
      const matches = filterFiles(filesRef.current, query, 10);
      setState({
        isOpen: true,
        matches,
        selectedIndex: 0,
        mentionStart: atPos,
      });
    });
  }, [projectId, text, cursorPosition, ensureFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
  }, []);

  const setSelectedIndex = useCallback((i: number) => {
    setState((s) => ({ ...s, selectedIndex: i }));
  }, []);

  const selectItem = useCallback((index: number): { newText: string; newCursor: number } => {
    const file = state.matches[index];
    if (!file) return { newText: text, newCursor: cursorPosition };

    const before = text.slice(0, state.mentionStart);
    const after = text.slice(cursorPosition);
    const inserted = `@${file}`;
    const newText = before + inserted + (after.startsWith(' ') ? after : ' ' + after);
    const newCursor = before.length + inserted.length + 1;

    setState((s) => ({ ...s, isOpen: false }));
    return { newText, newCursor };
  }, [state.matches, state.mentionStart, text, cursorPosition]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!state.isOpen || state.matches.length === 0) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setState((s) => ({ ...s, selectedIndex: (s.selectedIndex + 1) % s.matches.length }));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setState((s) => ({ ...s, selectedIndex: (s.selectedIndex - 1 + s.matches.length) % s.matches.length }));
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      return true; // caller should call selectItem
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
      return true;
    }
    return false;
  }, [state.isOpen, state.matches.length, dismiss]);

  return {
    isOpen: state.isOpen,
    matches: state.matches,
    selectedIndex: state.selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    selectItem,
    dismiss,
  };
}
