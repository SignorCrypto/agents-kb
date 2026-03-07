/* ─── Settings ─── */

export interface ShortcutBinding {
  id: string;
  label: string;
  keys: string;
  enabled: boolean;
}

export interface AppSettings {
  showShortcutHints: boolean;
  shortcuts: ShortcutBinding[];
  commitPrompt: string;
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: 'newJob', label: 'New Job', keys: 'mod+n', enabled: true },
  { id: 'submitForm', label: 'Submit / Follow Up', keys: 'mod+enter', enabled: true },
];

export const DEFAULT_COMMIT_PROMPT = 'Generate a concise conventional commit message for the current uncommitted changes. Output ONLY the commit message, nothing else.';

export const DEFAULT_SETTINGS: AppSettings = {
  showShortcutHints: false,
  shortcuts: [...DEFAULT_SHORTCUTS],
  commitPrompt: DEFAULT_COMMIT_PROMPT,
};

/* ─── Kanban ─── */

export type KanbanColumn = 'planning' | 'development' | 'done';
export type JobStatus = 'running' | 'waiting-input' | 'plan-ready' | 'completed' | 'error' | 'accepted' | 'rejected';

export interface GitSnapshot {
  commitSha: string;
  hadDirtyTree: boolean;
  tempCommitSha?: string;
  refName: string;
  label: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  defaultBranch?: string;
}

export interface OutputEntry {
  timestamp: string;
  type: 'text' | 'thinking' | 'tool-use' | 'tool-result' | 'system' | 'error' | 'plan';
  content: string;
  toolName?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface PendingQuestion {
  questionId: string;
  text: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  timestamp: string;
}

export interface RawMessage {
  timestamp: string;
  json: Record<string, unknown>;
}

export interface FollowUp {
  prompt: string;
  timestamp: string;
}

export interface Job {
  id: string;
  projectId: string;
  prompt: string;
  followUps?: FollowUp[];
  column: KanbanColumn;
  status: JobStatus;
  sessionId?: string;
  createdAt: string;
  planningStartedAt?: string;
  planningEndedAt?: string;
  developmentStartedAt?: string;
  completedAt?: string;
  outputLog: OutputEntry[];
  rawMessages: RawMessage[];
  pendingQuestion?: PendingQuestion;
  planText?: string;
  summaryText?: string;
  error?: string;
  branch?: string;
  images?: string[];
  skipPlanning?: boolean;
  waitingStartedAt?: string;
  totalPausedMs?: number;
  gitSnapshots?: GitSnapshot[];
  diffText?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  committedSha?: string;
  generatedCommitMessage?: string;
}
