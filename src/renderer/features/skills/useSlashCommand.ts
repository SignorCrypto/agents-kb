import { useState, useEffect, useCallback } from 'react';
import type { Skill } from '../../types';
import { useSkillsCatalog } from './useSkillsCatalog';

function filterSkills(skills: Skill[], query: string, max: number): Skill[] {
  if (!query) return skills.slice(0, max);

  const q = query.toLowerCase();
  const scored: { skill: Skill; score: number }[] = [];

  for (const skill of skills) {
    const name = skill.name.toLowerCase();
    const desc = skill.description.toLowerCase();

    // Exact prefix match on name — highest score
    if (name.startsWith(q)) {
      scored.push({ skill, score: 1000 - name.length });
      continue;
    }
    // Substring match on name
    if (name.includes(q)) {
      scored.push({ skill, score: 500 });
      continue;
    }
    // Substring match on description
    if (desc.includes(q)) {
      scored.push({ skill, score: 200 });
      continue;
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.skill);
}

interface SlashCommandState {
  isOpen: boolean;
  matches: Skill[];
  selectedIndex: number;
  slashStart: number; // cursor position of the "/"
}

export interface UseSlashCommandOptions {
  projectId: string;
  text: string;
  cursorPosition: number;
}

export interface UseSlashCommandResult {
  isOpen: boolean;
  matches: Skill[];
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  selectItem: (index: number) => { newText: string; newCursor: number };
  dismiss: () => void;
}

export function useSlashCommand({ projectId, text, cursorPosition }: UseSlashCommandOptions): UseSlashCommandResult {
  const { skills } = useSkillsCatalog(projectId);
  const [state, setState] = useState<SlashCommandState>({
    isOpen: false,
    matches: [],
    selectedIndex: 0,
    slashStart: -1,
  });

  // Detect "/" trigger and update matches
  useEffect(() => {
    if (cursorPosition <= 0) {
      if (state.isOpen) setState((s) => ({ ...s, isOpen: false }));
      return;
    }

    // Find the last "/" before cursor
    let slashPos = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
      if (text[i] === '/') {
        slashPos = i;
        break;
      }
      // Stop at whitespace or newline
      if (text[i] === ' ' || text[i] === '\n' || text[i] === '\r') break;
    }

    // "/" must be at start of text or preceded by whitespace/newline
    if (slashPos >= 0 && slashPos > 0) {
      const charBefore = text[slashPos - 1];
      if (charBefore !== ' ' && charBefore !== '\n' && charBefore !== '\r') {
        if (state.isOpen) setState((s) => ({ ...s, isOpen: false }));
        return;
      }
    }

    if (slashPos < 0) {
      if (state.isOpen) setState((s) => ({ ...s, isOpen: false }));
      return;
    }

    const query = text.slice(slashPos + 1, cursorPosition);
    // Don't trigger if there's a space in the query
    if (query.includes(' ') || query.includes('\n')) {
      if (state.isOpen) setState((s) => ({ ...s, isOpen: false }));
      return;
    }

    const matches = filterSkills(skills, query, 10);
    setState({
      isOpen: matches.length > 0 || query.length === 0,
      matches,
      selectedIndex: 0,
      slashStart: slashPos,
    });
  }, [cursorPosition, projectId, skills, state.isOpen, text]);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
  }, []);

  const setSelectedIndex = useCallback((i: number) => {
    setState((s) => ({ ...s, selectedIndex: i }));
  }, []);

  const selectItem = useCallback((index: number): { newText: string; newCursor: number } => {
    const skill = state.matches[index];
    if (!skill) return { newText: text, newCursor: cursorPosition };

    const before = text.slice(0, state.slashStart);
    const after = text.slice(cursorPosition);
    const inserted = `/${skill.name}`;
    const newText = before + inserted + (after.startsWith(' ') ? after : ' ' + after);
    const newCursor = before.length + inserted.length + 1;

    setState((s) => ({ ...s, isOpen: false }));
    return { newText, newCursor };
  }, [state.matches, state.slashStart, text, cursorPosition]);

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
