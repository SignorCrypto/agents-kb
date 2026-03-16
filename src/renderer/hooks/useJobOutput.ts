import { useMemo, useRef } from 'react';
import { useKanbanStore } from './useKanbanStore';
import type { OutputEntry, RawMessage } from '../types/index';

const EMPTY_OUTPUT: OutputEntry[] = [];
const EMPTY_RAW: RawMessage[] = [];

export interface OutputSection {
  kind: 'text' | 'thinking' | 'tool' | 'system' | 'error' | 'plan' | 'rate-limit' | 'progress';
  content: string;
  toolName?: string;
  toolResult?: string;
  isStreaming?: boolean;
  timestamp: string;
}

export interface EditedFile {
  path: string;
  tool: string;
}

interface OutputAnalysisState {
  processedLength: number;
  lastProcessedEntry?: OutputEntry;
  rawSections: OutputSection[];
  processedSections: OutputSection[];
  processedIndexByRawIndex: number[];
  currentTool: string;
  toolBuffer: string;
  seenEditedFiles: Map<string, string>;
  editedFiles: EditedFile[];
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

export function useJobOutput(jobId: string): OutputEntry[] {
  return useKanbanStore((s) => s.outputLogs[jobId] ?? EMPTY_OUTPUT);
}

export function useJobRawMessages(jobId: string): RawMessage[] {
  return useKanbanStore((s) => s.rawMessages[jobId] ?? EMPTY_RAW);
}

function tryParseToolJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart > 0) {
    try {
      return JSON.parse(trimmed.slice(jsonStart));
    } catch { /* not parseable */ }
  }
  const keyStart = trimmed.search(/"[A-Za-z0-9_-]+"\s*:/);
  if (keyStart >= 0) {
    const jsonBody = trimmed.slice(keyStart).replace(/,\s*$/, '');
    try {
      return JSON.parse(`{${jsonBody}`);
    } catch { /* not parseable */ }
    try {
      return JSON.parse(`{${jsonBody}}`);
    } catch { /* not parseable */ }
  }
  return null;
}

function finalizeSection(section: OutputSection): OutputSection | null {
  if (section.kind === 'tool' && section.toolName === 'Write' && section.content) {
    const parsed = tryParseToolJson(section.content);
    const filePath = parsed?.file_path as string | undefined;
    const fileContent = parsed?.content as string | undefined;
    if (filePath?.includes('.claude/plans/') && fileContent) {
      return { ...section, kind: 'plan', content: fileContent };
    }
  }

  if (section.kind === 'tool' && section.toolName?.includes('ExitPlanMode')) {
    return null;
  }

  if (section.kind === 'plan' && section.content.trim().startsWith('{')) {
    return null;
  }

  if (section.kind === 'tool' && !section.content.trim() && !section.toolResult?.trim()) {
    return null;
  }

  return section;
}

function createOutputAnalysisState(): OutputAnalysisState {
  return {
    processedLength: 0,
    lastProcessedEntry: undefined,
    rawSections: [],
    processedSections: [],
    processedIndexByRawIndex: [],
    currentTool: '',
    toolBuffer: '',
    seenEditedFiles: new Map<string, string>(),
    editedFiles: [],
  };
}

function syncSection(state: OutputAnalysisState, rawIndex: number): void {
  const next = finalizeSection(state.rawSections[rawIndex]);
  const currentIndex = state.processedIndexByRawIndex[rawIndex] ?? -1;

  if (!next) {
    if (currentIndex >= 0) {
      state.processedSections.splice(currentIndex, 1);
      state.processedIndexByRawIndex[rawIndex] = -1;
      for (let i = rawIndex + 1; i < state.processedIndexByRawIndex.length; i += 1) {
        if (state.processedIndexByRawIndex[i] > currentIndex) {
          state.processedIndexByRawIndex[i] -= 1;
        }
      }
    }
    return;
  }

  if (currentIndex >= 0) {
    state.processedSections[currentIndex] = next;
    return;
  }

  state.processedSections.push(next);
  state.processedIndexByRawIndex[rawIndex] = state.processedSections.length - 1;
}

function appendRawSection(state: OutputAnalysisState, section: OutputSection): void {
  state.rawSections.push(section);
  state.processedIndexByRawIndex.push(-1);
  syncSection(state, state.rawSections.length - 1);
}

function syncLastSection(state: OutputAnalysisState): void {
  if (state.rawSections.length === 0) return;
  syncSection(state, state.rawSections.length - 1);
}

function finalizeStreamingTool(state: OutputAnalysisState, nextType: OutputEntry['type']): void {
  const last = state.rawSections[state.rawSections.length - 1];
  if (last?.kind === 'tool' && nextType !== 'tool-use' && last.isStreaming) {
    last.isStreaming = false;
    syncLastSection(state);
  }
}

function flushEditedFileTool(state: OutputAnalysisState): void {
  if (FILE_TOOLS.has(state.currentTool) && state.toolBuffer) {
    try {
      const parsed = JSON.parse(state.toolBuffer);
      const filePath = (parsed.file_path || parsed.notebook_path) as string | undefined;
      if (filePath && !state.seenEditedFiles.has(filePath)) {
        state.seenEditedFiles.set(filePath, state.currentTool);
        state.editedFiles.push({ path: filePath, tool: state.currentTool });
      }
    } catch {
      // Ignore incomplete tool payloads while streaming.
    }
  }
  state.currentTool = '';
  state.toolBuffer = '';
}

function appendEditedFileEntry(state: OutputAnalysisState, entry: OutputEntry): void {
  if (entry.type === 'tool-use') {
    if (entry.toolName && entry.content === '') {
      flushEditedFileTool(state);
      state.currentTool = entry.toolName;
    } else if (entry.toolName && entry.content) {
      flushEditedFileTool(state);
      state.currentTool = entry.toolName;
      state.toolBuffer = entry.content;
      flushEditedFileTool(state);
    } else {
      state.toolBuffer += entry.content;
    }
    return;
  }

  flushEditedFileTool(state);
}

function appendSectionEntry(state: OutputAnalysisState, entry: OutputEntry): void {
  finalizeStreamingTool(state, entry.type);

  const last = state.rawSections[state.rawSections.length - 1];

  if (entry.type === 'plan') {
    appendRawSection(state, { kind: 'plan', content: entry.content, timestamp: entry.timestamp });
    return;
  }

  if (entry.type === 'tool-use') {
    if (entry.toolName && entry.content === '') {
      appendRawSection(state, { kind: 'tool', content: '', toolName: entry.toolName, isStreaming: true, timestamp: entry.timestamp });
      return;
    }
    if (last?.kind === 'tool' && !entry.toolName) {
      last.content += entry.content;
      last.isStreaming = true;
      syncLastSection(state);
      return;
    }
    if (last?.kind === 'tool' && entry.toolName && entry.toolName === last.toolName) {
      last.content += entry.content;
      last.isStreaming = true;
      syncLastSection(state);
      return;
    }
    if (entry.toolName && entry.content) {
      appendRawSection(state, { kind: 'tool', content: entry.content, toolName: entry.toolName, isStreaming: true, timestamp: entry.timestamp });
      return;
    }
    if (last?.kind === 'tool') {
      last.content += entry.content;
      last.isStreaming = true;
      syncLastSection(state);
      return;
    }
    appendRawSection(state, { kind: 'tool', content: entry.content, isStreaming: true, timestamp: entry.timestamp });
    return;
  }

  if (entry.type === 'tool-result') {
    if (last?.kind === 'tool') {
      last.toolResult = (last.toolResult ? `${last.toolResult}\n` : '') + entry.content;
      last.isStreaming = false;
      syncLastSection(state);
    } else {
      appendRawSection(state, { kind: 'system', content: entry.content, timestamp: entry.timestamp });
    }
    return;
  }

  if (entry.type === 'text') {
    if (last?.kind === 'text') {
      last.content += entry.content;
      syncLastSection(state);
    } else {
      appendRawSection(state, { kind: 'text', content: entry.content, timestamp: entry.timestamp });
    }
    return;
  }

  if (entry.type === 'thinking') {
    if (last?.kind === 'thinking') {
      last.content += entry.content;
      syncLastSection(state);
    } else {
      appendRawSection(state, { kind: 'thinking', content: entry.content, timestamp: entry.timestamp });
    }
    return;
  }

  if (entry.type === 'error') {
    appendRawSection(state, { kind: 'error', content: entry.content, timestamp: entry.timestamp });
    return;
  }

  if (entry.type === 'rate-limit') {
    appendRawSection(state, { kind: 'rate-limit', content: entry.content, timestamp: entry.timestamp });
    return;
  }

  if (entry.type === 'progress') {
    if (last?.kind === 'progress' && entry.toolName && last.toolName === entry.toolName) {
      last.content = entry.content;
      syncLastSection(state);
    } else {
      appendRawSection(state, { kind: 'progress', content: entry.content, toolName: entry.toolName, timestamp: entry.timestamp });
    }
    return;
  }

  appendRawSection(state, { kind: 'system', content: entry.content, timestamp: entry.timestamp });
}

function processEntries(state: OutputAnalysisState, entries: OutputEntry[], startIndex: number): void {
  for (let i = startIndex; i < entries.length; i += 1) {
    const entry = entries[i];
    appendSectionEntry(state, entry);
    appendEditedFileEntry(state, entry);
  }
  state.processedLength = entries.length;
  state.lastProcessedEntry = entries[entries.length - 1];
}

function isAppendOnly(state: OutputAnalysisState, entries: OutputEntry[]): boolean {
  if (entries.length < state.processedLength) return false;
  if (state.processedLength === 0) return true;
  return entries[state.processedLength - 1] === state.lastProcessedEntry;
}

export function useJobOutputAnalysis(jobId: string, entries: OutputEntry[]): {
  sections: OutputSection[];
  editedFiles: EditedFile[];
} {
  const cacheRef = useRef<{ jobId: string; entries: OutputEntry[]; state: OutputAnalysisState } | null>(null);

  return useMemo(() => {
    const cached = cacheRef.current;
    let state: OutputAnalysisState;

    if (!cached || cached.jobId !== jobId || !isAppendOnly(cached.state, entries)) {
      state = createOutputAnalysisState();
      processEntries(state, entries, 0);
    } else {
      state = cached.state;
      if (entries !== cached.entries && entries.length > state.processedLength) {
        processEntries(state, entries, state.processedLength);
      }
    }

    cacheRef.current = { jobId, entries, state };
    return { sections: state.processedSections, editedFiles: state.editedFiles };
  }, [entries, jobId]);
}
