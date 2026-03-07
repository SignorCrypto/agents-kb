import { useKanbanStore } from './useKanbanStore';
import type { OutputEntry, RawMessage } from '../types/index';

const EMPTY_OUTPUT: OutputEntry[] = [];
const EMPTY_RAW: RawMessage[] = [];

export function useJobOutput(jobId: string): OutputEntry[] {
  return useKanbanStore((s) => s.outputLogs[jobId] ?? EMPTY_OUTPUT);
}

export function useJobRawMessages(jobId: string): RawMessage[] {
  return useKanbanStore((s) => s.rawMessages[jobId] ?? EMPTY_RAW);
}
