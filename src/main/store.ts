import Store from 'electron-store';
import type { Project, Job, OutputEntry, RawMessage, AppSettings, PromptConfig } from '../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, DEFAULT_PROMPT_CONFIGS, DEFAULT_COMMIT_PROMPT } from '../shared/types';
import {
  appendOutputRecord,
  appendRawRecord,
  deleteJobLogs,
  flushJobLogsNow,
  loadJobLogs,
  replaceJobLogs,
} from './job-log-store';

interface StoreSchema {
  projects: Project[];
  jobs: Job[];
  settings: AppSettings;
}

type PersistedJob = Job | (Omit<Job, 'status'> & { status: 'accepted'; acceptedAt?: string });

const store = new Store<StoreSchema>({
  name: 'agents-kb-data',
  defaults: {
    projects: [],
    jobs: [],
    settings: DEFAULT_SETTINGS,
  },
});

// --- In-memory job cache ---
const jobCache = new Map<string, Job>();
const outputLogs = new Map<string, OutputEntry[]>();
const rawMessageLogs = new Map<string, RawMessage[]>();

const MAX_OUTPUT_LOG_ENTRIES = 1000;
const MAX_RAW_MESSAGE_ENTRIES = 2000;

function normalizePersistedJob(job: PersistedJob): Job {
  if (job.status === 'accepted') {
    const { acceptedAt: _acceptedAt, ...rest } = job;
    return normalizePersistedJob({ ...rest, status: 'completed' } as Job);
  }

  const normalized = { ...(job as Job) };
  if (!normalized.thinkingMode && normalized.effort) {
    normalized.thinkingMode = 'sdkDefault';
  }
  return normalized;
}

function shouldMergeOutputEntry(last: OutputEntry | undefined, next: OutputEntry): boolean {
  if (!last) return false;

  if (next.type === 'text' || next.type === 'thinking') {
    return last.type === next.type && !next.toolName;
  }

  if (next.type !== 'tool-use' || last.type !== 'tool-use') {
    return false;
  }

  if (next.toolName && last.toolName && next.toolName !== last.toolName) {
    return false;
  }

  return true;
}

function applyOutputEntry(log: OutputEntry[], entry: OutputEntry): void {
  const last = log[log.length - 1];
  if (shouldMergeOutputEntry(last, entry)) {
    if (entry.toolName && !last.toolName) {
      last.toolName = entry.toolName;
    }
    last.content += entry.content;
  } else {
    log.push({ ...entry });
  }
}

function trimOutputLog(log: OutputEntry[]): void {
  if (log.length > MAX_OUTPUT_LOG_ENTRIES) {
    log.splice(0, log.length - MAX_OUTPUT_LOG_ENTRIES);
  }
}

function trimRawMessageLog(messages: RawMessage[]): void {
  if (messages.length > MAX_RAW_MESSAGE_ENTRIES) {
    messages.splice(0, messages.length - MAX_RAW_MESSAGE_ENTRIES);
  }
}

function rebuildOutputLog(entries: OutputEntry[]): OutputEntry[] {
  const log: OutputEntry[] = [];
  for (const entry of entries) {
    applyOutputEntry(log, entry);
    trimOutputLog(log);
  }
  return log;
}

function stripStreamingData(job: Job): Job {
  return {
    ...job,
    outputLog: [],
    rawMessages: [],
  };
}

// Initialize cache from disk, hydrating logs from the file-backed log store.
const normalizedJobs = (store.get('jobs') as PersistedJob[]).map(normalizePersistedJob);
for (const j of normalizedJobs) {
  const persistedLogs = loadJobLogs(j.id);
  const fallbackOutput = j.outputLog || [];
  const fallbackRawMessages = j.rawMessages || [];
  const hydratedOutput =
    persistedLogs.outputEntries.length > 0 ? rebuildOutputLog(persistedLogs.outputEntries) : rebuildOutputLog(fallbackOutput);
  const hydratedRawMessages =
    persistedLogs.rawMessages.length > 0 ? [...persistedLogs.rawMessages] : [...fallbackRawMessages];

  trimRawMessageLog(hydratedRawMessages);

  if (
    (persistedLogs.outputEntries.length === 0 && fallbackOutput.length > 0) ||
    (persistedLogs.rawMessages.length === 0 && fallbackRawMessages.length > 0)
  ) {
    replaceJobLogs(j.id, hydratedOutput, hydratedRawMessages);
  }

  outputLogs.set(j.id, hydratedOutput);
  rawMessageLogs.set(j.id, hydratedRawMessages);
  jobCache.set(j.id, stripStreamingData(j));
}
store.set('jobs', normalizedJobs.map(stripStreamingData));

// --- Debounced disk flush ---
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDiskFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushToDisk();
  }, 2000);
}

function flushToDisk(): void {
  if (process.env.DEMO_MODE === 'true') return;
  const jobs = Array.from(jobCache.values()).map(stripStreamingData);
  store.set('jobs', jobs);
}

export function flushNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushToDisk();
  flushJobLogsNow();
}

// --- Projects (unchanged — low frequency, fine to hit disk directly) ---
export function getProjects(): Project[] {
  return store.get('projects');
}

export function updateProjects(projects: Project[]): void {
  store.set('projects', projects);
}

export function addProject(project: Project): void {
  const projects = store.get('projects');
  projects.push(project);
  store.set('projects', projects);
}

export function renameProject(id: string, name: string): Project | undefined {
  const projects = store.get('projects');
  const project = projects.find(p => p.id === id);
  if (!project) return undefined;
  project.name = name;
  store.set('projects', projects);
  return project;
}

export function removeProject(id: string): void {
  const projects = store.get('projects').filter(p => p.id !== id);
  store.set('projects', projects);
  // Remove associated jobs from cache and disk
  for (const [jobId, job] of jobCache) {
    if (job.projectId === id) {
      jobCache.delete(jobId);
      outputLogs.delete(jobId);
      rawMessageLogs.delete(jobId);
      deleteJobLogs(jobId);
    }
  }
  scheduleDiskFlush();
}

export function setProjectDefaultBranch(id: string, branch: string | null): Project | undefined {
  const projects = store.get('projects');
  const project = projects.find(p => p.id === id);
  if (!project) return undefined;
  if (branch) {
    project.defaultBranch = branch;
  } else {
    delete project.defaultBranch;
  }
  store.set('projects', projects);
  return project;
}

export function setProjectColor(id: string, color: string | null): Project | undefined {
  const projects = store.get('projects');
  const project = projects.find(p => p.id === id);
  if (!project) return undefined;
  if (color) {
    project.color = color as Project['color'];
  } else {
    delete project.color;
  }
  store.set('projects', projects);
  return project;
}

export function reorderProjects(orderedIds: string[]): Project[] {
  const projects = store.get('projects');
  const byId = new Map(projects.map(p => [p.id, p]));
  const reordered = orderedIds.map(id => byId.get(id)).filter((p): p is Project => !!p);
  store.set('projects', reordered);
  return reordered;
}

// --- Jobs (in-memory cache) ---
export function getJobs(): Job[] {
  return Array.from(jobCache.values()).map(j => ({
    ...j,
    outputLog: outputLogs.get(j.id) || [],
    rawMessages: rawMessageLogs.get(j.id) || [],
  }));
}

export function getJob(id: string): Job | undefined {
  const j = jobCache.get(id);
  if (!j) return undefined;
  return {
    ...j,
    outputLog: outputLogs.get(id) || [],
    rawMessages: rawMessageLogs.get(id) || [],
  };
}

export function saveJob(job: Job): void {
  const outputLog = rebuildOutputLog(job.outputLog || []);
  const rawMessages = [...(job.rawMessages || [])];
  trimRawMessageLog(rawMessages);

  outputLogs.set(job.id, outputLog);
  rawMessageLogs.set(job.id, rawMessages);
  replaceJobLogs(job.id, outputLog, rawMessages);
  // Cache without streaming data
  jobCache.set(job.id, stripStreamingData(job));
  scheduleDiskFlush();
}

export function deleteJob(id: string): void {
  jobCache.delete(id);
  outputLogs.delete(id);
  rawMessageLogs.delete(id);
  deleteJobLogs(id);
  scheduleDiskFlush();
}

export function updateJob(id: string, updates: Partial<Job>): Job | undefined {
  const existing = jobCache.get(id);
  if (!existing) return undefined;

  // If updates include outputLog or rawMessages, route to separate maps
  if (updates.outputLog !== undefined) {
    outputLogs.set(id, rebuildOutputLog(updates.outputLog));
  }
  if (updates.rawMessages !== undefined) {
    const rawMessages = [...updates.rawMessages];
    trimRawMessageLog(rawMessages);
    rawMessageLogs.set(id, rawMessages);
  }
  if (updates.outputLog !== undefined || updates.rawMessages !== undefined) {
    replaceJobLogs(id, outputLogs.get(id) || [], rawMessageLogs.get(id) || []);
  }

  // Update the cached job (without streaming data)
  const { outputLog: _ol, rawMessages: _rm, ...metaUpdates } = updates;
  const updated = { ...existing, ...metaUpdates };
  jobCache.set(id, updated);
  scheduleDiskFlush();

  // Return full job with streaming data
  return {
    ...updated,
    outputLog: outputLogs.get(id) || [],
    rawMessages: rawMessageLogs.get(id) || [],
  };
}

// --- Streaming data functions ---
export function appendOutput(jobId: string, entry: OutputEntry): void {
  let log = outputLogs.get(jobId);
  if (!log) {
    log = [];
    outputLogs.set(jobId, log);
  }

  applyOutputEntry(log, entry);
  trimOutputLog(log);
  appendOutputRecord(jobId, entry);
}

export function appendRawMessage(jobId: string, raw: RawMessage): void {
  let messages = rawMessageLogs.get(jobId);
  if (!messages) {
    messages = [];
    rawMessageLogs.set(jobId, messages);
  }
  messages.push(raw);
  trimRawMessageLog(messages);
  appendRawRecord(jobId, raw);
}

export function getOutputLog(jobId: string): OutputEntry[] {
  return outputLogs.get(jobId) || [];
}

export function getRawMessages(jobId: string): RawMessage[] {
  return rawMessageLogs.get(jobId) || [];
}

// On app start, mark any running jobs as error (stale from previous session)
export function markStaleJobs(): void {
  let changed = false;
  for (const [, job] of jobCache) {
    if (job.status === 'running' || job.status === 'waiting-input') {
      job.status = 'error';
      job.error = 'App was restarted while this job was running. Please retry.';
      job.erroredAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    scheduleDiskFlush();
  }
}

// Run on import
markStaleJobs();

// --- Settings ---
export function getSettings(): AppSettings {
  const stored = store.get('settings');
  if (!stored) return DEFAULT_SETTINGS;
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  if (!stored.defaultThinkingMode) {
    merged.defaultThinkingMode = 'sdkDefault';
  }
  // Ensure newly added default shortcuts appear for existing users
  if (stored.shortcuts) {
    const existingIds = new Set((stored.shortcuts as Array<{ id: string }>).map((s) => s.id));
    const missing = DEFAULT_SHORTCUTS.filter((s) => !existingIds.has(s.id));
    merged.shortcuts = [...(stored.shortcuts as typeof DEFAULT_SHORTCUTS), ...missing];
  }

  // Migrate legacy commitPrompt -> promptConfigs
  if (!stored.promptConfigs) {
    merged.promptConfigs = { ...DEFAULT_PROMPT_CONFIGS };
    if (stored.commitPrompt && stored.commitPrompt !== DEFAULT_COMMIT_PROMPT) {
      merged.promptConfigs.commit = {
        ...DEFAULT_PROMPT_CONFIGS.commit,
        prompt: stored.commitPrompt as string,
      };
    }
  } else {
    // Ensure any new default prompts are present for existing users
    for (const [id, config] of Object.entries(DEFAULT_PROMPT_CONFIGS)) {
      if (!(merged.promptConfigs as Record<string, PromptConfig>)[id]) {
        (merged.promptConfigs as Record<string, PromptConfig>)[id] = config;
      }
    }
  }

  // Migrate legacy permission mode values
  const storedPermMode = stored.permissionMode as string;
  if (storedPermMode === 'skip') {
    merged.permissionMode = 'bypassPermissions';
  } else if (storedPermMode === 'manual') {
    merged.permissionMode = 'default';
  }

  return merged;
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...partial };
  store.set('settings', updated);
  return updated;
}

export { store };
