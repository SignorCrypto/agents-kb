/* ─── CLI Health ─── */

export interface CliHealthStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  error?: string;
}

/* ─── Account Info (from SDK initializationResult) ─── */

export interface AccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
}

/* ─── Settings ─── */

export type ThemeMode = "system" | "light" | "dark";
export type ThinkingMode = "sdkDefault" | "disabled";

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
  /** Optional description from the SDK */
  description?: string;
  /** Whether this model supports effort/thinking levels */
  supportsEffort?: boolean;
  /** Available effort levels for this model (from SDK) */
  supportedEffortLevels?: string[];
  /** Whether this model supports adaptive thinking */
  supportsAdaptiveThinking?: boolean;
}

export interface EffortOption {
  /** Value passed to `--effort` */
  value: string;
  /** Display label in UI */
  label: string;
  /** Short badge text for cards (empty = hidden when default) */
  badge: string;
}

export interface ThinkingModeOption {
  value: ThinkingMode;
  label: string;
  badge: string;
  description: string;
}

/** Model info fetched dynamically from the Agent SDK */
export interface DynamicModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsAdaptiveThinking?: boolean;
}

/** Label/badge lookup for effort levels — display only, available levels come from the model */
export const EFFORT_LABELS: Record<string, EffortOption> = {
  low: { value: "low", label: "Low", badge: "LOW" },
  medium: { value: "medium", label: "Medium", badge: "MED" },
  high: { value: "high", label: "High", badge: "HIGH" },
  max: { value: "max", label: "Max", badge: "MAX" },
};

/** Build an EffortOption[] from the model's supportedEffortLevels */
export function getEffortOptionsForModel(model: ModelOption | undefined): EffortOption[] {
  if (!model?.supportsEffort || !model.supportedEffortLevels?.length) return [];
  return model.supportedEffortLevels.map((level) => EFFORT_LABELS[level]).filter(Boolean);
}

export function getThinkingModeOptionsForModel(model: ModelOption | undefined): ThinkingModeOption[] {
  const adaptive = Boolean(model?.supportsAdaptiveThinking);
  return [
    {
      value: "sdkDefault",
      label: adaptive ? "Adaptive" : "Default",
      badge: adaptive ? "ADAPT" : "DEFAULT",
      description: adaptive ? "Claude decides when and how much to think" : "Use the model's default thinking behavior",
    },
    {
      value: "disabled",
      label: "Disabled",
      badge: "OFF",
      description: "No extended thinking",
    },
  ];
}

export function getEffortOptionsForThinking(
  model: ModelOption | undefined,
  thinkingMode: ThinkingMode | undefined,
): EffortOption[] {
  if (thinkingMode === "disabled") return [];
  return getEffortOptionsForModel(model);
}

export function normalizeEffortForThinking(
  model: ModelOption | undefined,
  thinkingMode: ThinkingMode | undefined,
  effort: EffortLevel | undefined,
): EffortLevel | undefined {
  if (thinkingMode === "disabled") return undefined;
  const options = getEffortOptionsForModel(model);
  if (options.length === 0) {
    return model ? undefined : effort;
  }
  if (effort && options.some((option) => option.value === effort)) {
    return effort;
  }
  return options[0]?.value;
}

export function getThinkingDisplay(
  model: ModelOption | undefined,
  thinkingMode: ThinkingMode | undefined,
  effort: EffortLevel | undefined,
): {
  modeLabel: string;
  modeBadge: string;
  effortLabel?: string;
  effortBadge?: string;
} {
  const resolvedMode = thinkingMode ?? "sdkDefault";
  const modeOption =
    getThinkingModeOptionsForModel(model).find((option) => option.value === resolvedMode) ??
    getThinkingModeOptionsForModel(model)[0];
  const normalizedEffort = normalizeEffortForThinking(model, resolvedMode, effort);
  const effortOption = normalizedEffort ? EFFORT_LABELS[normalizedEffort] : undefined;

  return {
    modeLabel: modeOption.label,
    modeBadge: modeOption.badge,
    ...(effortOption ? { effortLabel: effortOption.label, effortBadge: effortOption.badge } : {}),
  };
}

export type ModelChoice = string;
export type EffortLevel = string;

/* ─── Prompt Configs ─── */

export interface PromptConfig {
  id: string;
  label: string;
  prompt: string;
  suffix?: string;
  model: ModelChoice;
  effort?: EffortLevel;
}

export const PROMPT_IDS = { COMMIT: "commit", TITLE: "title", ROLLBACK: "rollback" } as const;
export type PromptId = (typeof PROMPT_IDS)[keyof typeof PROMPT_IDS];

export interface ShortcutBinding {
  id: string;
  label: string;
  keys: string;
  enabled: boolean;
}

export type PreferredEditor = "auto" | "cursor" | "vscode";
export type PermissionMode = "bypassPermissions" | "default";

export interface PermissionModeOption {
  value: PermissionMode;
  label: string;
  description: string;
}

export const PERMISSION_MODE_CATALOG: PermissionModeOption[] = [
  {
    value: "bypassPermissions",
    label: "Skip All",
    description: "All permission checks bypassed (--dangerously-skip-permissions)",
  },
  { value: "default", label: "Default", description: "Claude will ask for permission when needed" },
];

/* ─── Claude Tool Catalog ─── */
// All Claude CLI tools that can be toggled in --allowedTools.
// Read-only tools (Read, Glob, Grep) are always auto-allowed by the CLI.

export interface ClaudeToolOption {
  /** Tool name as passed to --allowedTools */
  name: string;
  /** Display label */
  label: string;
  /** Short description for the UI */
  description: string;
  /** Whether this tool is allowed by default */
  defaultAllowed: boolean;
}

export const CLAUDE_TOOL_CATALOG: ClaudeToolOption[] = [
  { name: "Edit", label: "Edit", description: "Modify existing files", defaultAllowed: true },
  { name: "Write", label: "Write", description: "Create new files", defaultAllowed: true },
  { name: "NotebookEdit", label: "NotebookEdit", description: "Edit Jupyter notebooks", defaultAllowed: true },
  { name: "Bash", label: "Bash", description: "Run shell commands", defaultAllowed: true },
  { name: "AskUserQuestion", label: "AskUserQuestion", description: "Ask questions to the user", defaultAllowed: true },
  { name: "Agent", label: "Agent", description: "Spawn subagents for parallel tasks", defaultAllowed: true },
  { name: "TodoWrite", label: "TodoWrite", description: "Internal task tracking", defaultAllowed: true },
  { name: "WebFetch", label: "WebFetch", description: "Fetch content from URLs", defaultAllowed: true },
  { name: "WebSearch", label: "WebSearch", description: "Search the web", defaultAllowed: true },
];

export const DEFAULT_ALLOWED_TOOLS: Record<string, boolean> = Object.fromEntries(
  CLAUDE_TOOL_CATALOG.map((t) => [t.name, t.defaultAllowed]),
);

export interface AppSettings {
  theme: ThemeMode;
  showShortcutHints: boolean;
  shortcuts: ShortcutBinding[];
  /** @deprecated Use promptConfigs.commit instead */
  commitPrompt?: string;
  promptConfigs: Record<string, PromptConfig>;
  defaultModel: ModelChoice;
  defaultThinkingMode: ThinkingMode;
  defaultEffort?: EffortLevel;
  alwaysShowModelEffort: boolean;
  showTokenUsage: boolean;
  showContextUsage: boolean;
  showModelEffortInNewJob: boolean;
  preferredEditor: PreferredEditor;
  notificationsEnabled: boolean;
  deleteCompletedJobsOnCommit: boolean;
  permissionMode: PermissionMode;
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: "newJob", label: "New Job", keys: "mod+n", enabled: true },
  { id: "submitForm", label: "Submit / Follow Up", keys: "mod+enter", enabled: true },
  { id: "openSettings", label: "Settings", keys: "mod+s", enabled: true },
  { id: "focusProject", label: "Focus Project (New Job)", keys: "mod+p", enabled: true },
  { id: "focusBranch", label: "Focus Branch (New Job)", keys: "mod+b", enabled: true },
  { id: "togglePlan", label: "Toggle Plan (New Job)", keys: "shift+tab", enabled: true },
];

export const DEFAULT_COMMIT_PROMPT =
  "Generate a concise conventional commit message for the current uncommitted changes.";
export const COMMIT_PROMPT_SUFFIX = "";

export const DEFAULT_TITLE_PROMPT = "Generate a very short task title (3-8 words) for this task.";
export const DEFAULT_ROLLBACK_PROMPT =
  "Revert the requested Agents-KB job changes by restoring the listed files to the provided target contents. Preserve unrelated newer changes whenever possible. If you cannot do this safely, explain why and make no changes.";

export const DEFAULT_PROMPT_CONFIGS: Record<PromptId, PromptConfig> = {
  commit: {
    id: "commit",
    label: "Commit Message",
    prompt: DEFAULT_COMMIT_PROMPT,
    suffix: COMMIT_PROMPT_SUFFIX,
    model: "haiku",
    effort: "low",
  },
  title: { id: "title", label: "Job Title", prompt: DEFAULT_TITLE_PROMPT, model: "haiku" },
  rollback: { id: "rollback", label: "Rollback", prompt: DEFAULT_ROLLBACK_PROMPT, model: "sonnet", effort: "medium" },
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  showShortcutHints: false,
  shortcuts: [...DEFAULT_SHORTCUTS],
  promptConfigs: { ...DEFAULT_PROMPT_CONFIGS },
  defaultModel: "opus",
  defaultThinkingMode: "sdkDefault",
  defaultEffort: "medium",
  alwaysShowModelEffort: false,
  showTokenUsage: false,
  showContextUsage: false,
  showModelEffortInNewJob: false,
  preferredEditor: "auto",
  notificationsEnabled: true,
  deleteCompletedJobsOnCommit: false,
  permissionMode: "bypassPermissions",
};

/* ─── File Rewind ─── */

export interface RewindFilesResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

/* ─── Token Usage ─── */

export interface PhaseTokenUsage {
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
}

/** Session-level context window snapshot (latest values, not accumulated). */
export interface ContextUsage {
  /** Peak input tokens from the latest session run (≈ actual context fill). */
  used: number;
  /** Model context window limit. */
  limit: number;
}

/* ─── Skills ─── */

export interface Skill {
  name: string;
  description: string;
  source: "global" | "project";
  filePath: string;
}

/* ─── Kanban ─── */

export type KanbanColumn = "planning" | "development" | "done";
export type JobStatus = "running" | "waiting-input" | "plan-ready" | "completed" | "error" | "rejected";

export type JobFileSnapshotKind = "text" | "binary" | "created" | "deleted";

export interface JobFileSnapshot {
  path: string;
  kind: JobFileSnapshotKind;
  beforeExists: boolean;
  afterExists: boolean;
  beforeIsBinary: boolean;
  afterIsBinary: boolean;
  beforeContent?: string;
  afterContent?: string;
  beforeHash?: string;
  afterHash?: string;
}

export interface JobStepSnapshot {
  id: string;
  label: string;
  order: number;
  startedAt: string;
  completedAt: string;
  appliedSeq: number;
  files: JobFileSnapshot[];
  rejectedAt?: string;
}

export const PROJECT_COLORS = [
  { id: "slate", hex: "#64748b" },
  { id: "red", hex: "#ef4444" },
  { id: "orange", hex: "#f97316" },
  { id: "amber", hex: "#f59e0b" },
  { id: "lime", hex: "#84cc16" },
  { id: "emerald", hex: "#10b981" },
  { id: "teal", hex: "#14b8a6" },
  { id: "cyan", hex: "#06b6d4" },
  { id: "blue", hex: "#3b82f6" },
  { id: "indigo", hex: "#6366f1" },
  { id: "violet", hex: "#8b5cf6" },
  { id: "pink", hex: "#ec4899" },
  { id: "rose", hex: "#f43f5e" },
] as const;

export type ProjectColorId = (typeof PROJECT_COLORS)[number]["id"];

export function getProjectColor(colorId?: string): string {
  const found = PROJECT_COLORS.find((c) => c.id === colorId);
  return found ? found.hex : PROJECT_COLORS[0].hex;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  defaultBranch?: string;
  isGitRepo?: boolean;
  color?: ProjectColorId;
}

export interface OutputEntry {
  timestamp: string;
  type: "text" | "thinking" | "tool-use" | "tool-result" | "system" | "error" | "plan" | "rate-limit" | "progress";
  content: string;
  toolName?: string;
  /** Follow-up prompt suggestions from the SDK */
  suggestions?: string[];
  /** SDK block ID for this tool_use (used to match sub-agent children) */
  toolUseId?: string;
  /** Parent Agent tool_use block ID — set on entries originating inside a sub-agent */
  parentToolUseId?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface SubQuestion {
  question: string; // question text, also the key in answers record
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface PendingQuestion {
  questionId: string;
  text: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  timestamp: string;
  /** When true, this prompt was triggered by a CLI permission denial */
  isPermissionRequest?: boolean;
  /** Tool names that were denied (e.g. ['Bash']) */
  deniedTools?: string[];
  /** All questions (1-4) from the SDK AskUserQuestion tool */
  subQuestions?: SubQuestion[];
}

export interface RawMessage {
  timestamp: string;
  json: Record<string, unknown>;
}

export interface FollowUp {
  prompt: string;
  timestamp: string;
  title?: string;
  rolledBack?: boolean;
}

export interface DraftImage {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64: string;
}

export interface JobComposerDraft {
  text: string;
  images: DraftImage[];
}

export interface PendingQuestionDraft {
  questionId: string;
  currentStep: number;
  responseText: string;
  selectedOptions: string[];
  questionAnswers: Record<string, string>;
  questionSelections: Record<string, string[]>;
}

export interface JobDetailDrafts {
  steer?: JobComposerDraft;
  planEdit?: JobComposerDraft;
  followUp?: JobComposerDraft;
  retry?: JobComposerDraft;
  pendingQuestion?: PendingQuestionDraft;
}

/** Image attachment metadata. base64 is transient (not persisted to electron-store). */
export interface JobImage {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64?: string;
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
  erroredAt?: string;
  branch?: string;
  images?: JobImage[];
  skipPlanning?: boolean;
  waitingStartedAt?: string;
  totalPausedMs?: number;
  planningElapsedMs?: number;
  planningPausedMs?: number;
  developmentElapsedMs?: number;
  planningTokens?: PhaseTokenUsage;
  developmentTokens?: PhaseTokenUsage;
  contextUsage?: ContextUsage;
  userMessageUuids?: string[];
  stepSnapshots?: JobStepSnapshot[];
  diffText?: string;
  rejectedAt?: string;
  committedSha?: string;
  editedFiles?: string[];
  model?: ModelChoice;
  thinkingMode?: ThinkingMode;
  effort?: EffortLevel;
  jobDetailDrafts?: JobDetailDrafts;
  jobDetailDraftVersion?: number;
}

/* --- Git Changed Files --- */

export interface ChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  oldPath?: string;
}

/* --- Git History --- */

export interface GitCommit {
  hash: string;
  fullHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  date: string;
  message: string;
  refs: GitRef[];
}

export interface GitRef {
  name: string;
  type: 'branch' | 'tag' | 'remote' | 'head';
}

export interface GitLogResult {
  commits: GitCommit[];
  hasMore: boolean;
  totalCount: number;
}
