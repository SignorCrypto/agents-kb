/* ─── Settings ─── */

export type ThemeMode = "system" | "light" | "dark";

/* ─── Model & Effort catalog (single source of truth) ─── */
// Uses CLI aliases so --model always resolves to the latest version.
// To add a new model, just add an entry here — UI and backend pick it up automatically.

export interface ModelOption {
  /** CLI alias passed to `--model` (or 'default' to omit the flag) */
  value: string;
  /** Display label in UI */
  label: string;
  /** Short badge text for cards */
  badge: string;
}

export interface EffortOption {
  /** Value passed to `--effort` */
  value: string;
  /** Display label in UI */
  label: string;
  /** Short badge text for cards (empty = hidden when default) */
  badge: string;
}

export const MODEL_CATALOG: ModelOption[] = [
  { value: "default", label: "Default", badge: "" },
  { value: "opus", label: "Opus", badge: "OPUS" },
  { value: "sonnet", label: "Sonnet", badge: "SONNET" },
  { value: "haiku", label: "Haiku", badge: "HAIKU" },
];

export const EFFORT_CATALOG: EffortOption[] = [
  { value: "default", label: "Default", badge: "" },
  { value: "low", label: "Low", badge: "LOW" },
  { value: "medium", label: "Medium", badge: "MED" },
  { value: "high", label: "High", badge: "HIGH" },
  // { value: "max", label: "Max", badge: "MAX" },
];

export type ModelChoice = (typeof MODEL_CATALOG)[number]["value"];
export type EffortLevel = (typeof EFFORT_CATALOG)[number]["value"];

/* ─── Prompt Configs ─── */

export interface PromptConfig {
  id: string;
  label: string;
  prompt: string;
  suffix?: string;
  model: ModelChoice;
  effort: EffortLevel;
}

export const PROMPT_IDS = { COMMIT: 'commit', TITLE: 'title' } as const;
export type PromptId = (typeof PROMPT_IDS)[keyof typeof PROMPT_IDS];

export interface ShortcutBinding {
  id: string;
  label: string;
  keys: string;
  enabled: boolean;
}

export interface AppSettings {
  theme: ThemeMode;
  showShortcutHints: boolean;
  shortcuts: ShortcutBinding[];
  /** @deprecated Use promptConfigs.commit instead */
  commitPrompt?: string;
  promptConfigs: Record<string, PromptConfig>;
  defaultModel: ModelChoice;
  defaultEffort: EffortLevel;
  alwaysShowModelEffort: boolean;
  showModelEffortInNewJob: boolean;
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: "newJob", label: "New Job", keys: "mod+n", enabled: true },
  { id: "submitForm", label: "Submit / Follow Up", keys: "mod+enter", enabled: true },
  { id: "openSettings", label: "Settings", keys: "mod+s", enabled: true },
  { id: "focusProject", label: "Focus Project (New Job)", keys: "mod+p", enabled: true },
  { id: "focusBranch", label: "Focus Branch (New Job)", keys: "mod+b", enabled: true },
];

export const DEFAULT_COMMIT_PROMPT =
  "Generate a concise conventional commit message for the current uncommitted changes.";
export const COMMIT_PROMPT_SUFFIX = " Output ONLY the commit message, nothing else.";

export const DEFAULT_TITLE_PROMPT =
  'Generate a very short task title (3-8 words) for this task. Output ONLY the title, no quotes, no formatting, no punctuation at the end.';

export const DEFAULT_PROMPT_CONFIGS: Record<PromptId, PromptConfig> = {
  commit: { id: 'commit', label: 'Commit Message', prompt: DEFAULT_COMMIT_PROMPT, suffix: COMMIT_PROMPT_SUFFIX, model: 'haiku', effort: 'low' },
  title:  { id: 'title',  label: 'Job Title',      prompt: DEFAULT_TITLE_PROMPT,  model: 'haiku', effort: 'low' },
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  showShortcutHints: false,
  shortcuts: [...DEFAULT_SHORTCUTS],
  promptConfigs: { ...DEFAULT_PROMPT_CONFIGS },
  defaultModel: "default",
  defaultEffort: "default",
  alwaysShowModelEffort: false,
  showModelEffortInNewJob: false,
};

/* ─── Kanban ─── */

export type KanbanColumn = "planning" | "development" | "done";
export type JobStatus = "running" | "waiting-input" | "plan-ready" | "completed" | "error" | "accepted" | "rejected";

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
  isGitRepo?: boolean;
}

export interface OutputEntry {
  timestamp: string;
  type: "text" | "thinking" | "tool-use" | "tool-result" | "system" | "error" | "plan";
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
  title?: string;
}

export interface Job {
  id: string;
  projectId: string;
  prompt: string;
  title?: string;
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
  editedFiles?: string[];
  model?: ModelChoice;
  effort?: EffortLevel;
}
