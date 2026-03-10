import Store from 'electron-store';
import type { Project, Job, OutputEntry, RawMessage, AppSettings, PromptConfig } from '../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, DEFAULT_PROMPT_CONFIGS, DEFAULT_COMMIT_PROMPT } from '../shared/types';

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

function normalizePersistedJob(job: PersistedJob): Job {
  if (job.status === 'accepted') {
    const { acceptedAt: _acceptedAt, ...rest } = job;
    return { ...rest, status: 'completed' };
  }

  return job as Job;
}

// Initialize cache from disk, stripping outputLog/rawMessages (they stay in memory only)
const normalizedJobs = (store.get('jobs') as PersistedJob[]).map(normalizePersistedJob);
store.set('jobs', normalizedJobs);
for (const j of normalizedJobs) {
  jobCache.set(j.id, { ...j, outputLog: j.outputLog || [], rawMessages: j.rawMessages || [] });
}

// --- In-memory streaming data (never persisted) ---
const outputLogs = new Map<string, OutputEntry[]>();
const rawMessageLogs = new Map<string, RawMessage[]>();

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
  // Strip outputLog and rawMessages from persisted data
  const jobs = Array.from(jobCache.values()).map(j => ({
    ...j,
    outputLog: [],
    rawMessages: [],
  }));
  store.set('jobs', jobs);
}

export function flushNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushToDisk();
}

// --- Projects (unchanged — low frequency, fine to hit disk directly) ---
export function getProjects(): Project[] {
  return store.get('projects');
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
  // Store outputLog/rawMessages in their separate maps
  outputLogs.set(job.id, job.outputLog || []);
  rawMessageLogs.set(job.id, job.rawMessages || []);
  // Cache without streaming data
  jobCache.set(job.id, { ...job, outputLog: [], rawMessages: [] });
  scheduleDiskFlush();
}

export function deleteJob(id: string): void {
  jobCache.delete(id);
  outputLogs.delete(id);
  rawMessageLogs.delete(id);
  scheduleDiskFlush();
}

export function updateJob(id: string, updates: Partial<Job>): Job | undefined {
  const existing = jobCache.get(id);
  if (!existing) return undefined;

  // If updates include outputLog or rawMessages, route to separate maps
  if (updates.outputLog) {
    outputLogs.set(id, updates.outputLog);
  }
  if (updates.rawMessages) {
    rawMessageLogs.set(id, updates.rawMessages);
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

// --- Streaming data functions (no disk writes) ---
export function appendOutput(jobId: string, entry: OutputEntry): void {
  let log = outputLogs.get(jobId);
  if (!log) {
    log = [];
    outputLogs.set(jobId, log);
  }

  // Merge consecutive text/thinking deltas
  const last = log[log.length - 1];
  if (last && entry.type === last.type && (entry.type === 'text' || entry.type === 'thinking') && !entry.toolName) {
    last.content += entry.content;
  } else {
    log.push(entry);
  }

  if (log.length > 1000) log.splice(0, log.length - 1000);
}

export function appendRawMessage(jobId: string, raw: RawMessage): void {
  let messages = rawMessageLogs.get(jobId);
  if (!messages) {
    messages = [];
    rawMessageLogs.set(jobId, messages);
  }
  messages.push(raw);
  if (messages.length > 2000) messages.splice(0, messages.length - 2000);
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

  return merged;
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const updated = { ...current, ...partial };
  store.set('settings', updated);
  return updated;
}

export { store };
