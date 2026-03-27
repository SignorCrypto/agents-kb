import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Skill } from '../../types';

const GLOBAL_SKILLS_KEY = '__global__';
const SKILL_REFRESH_INTERVAL_MS = 30_000;

interface SkillCatalogState {
  skills: Skill[];
  fetchedAt: number | null;
  inFlight: boolean;
}

interface SkillCatalogEntry {
  state: SkillCatalogState;
  inFlightRequest: Promise<void> | null;
  listeners: Set<() => void>;
  consumerCount: number;
  pollTimer: ReturnType<typeof setInterval> | null;
}

const catalogEntries = new Map<string, SkillCatalogEntry>();

function getCatalogKey(projectId?: string | null): string {
  return projectId || GLOBAL_SKILLS_KEY;
}

function getCatalogEntry(key: string): SkillCatalogEntry {
  let entry = catalogEntries.get(key);
  if (!entry) {
    entry = {
      state: { skills: [], fetchedAt: null, inFlight: true },
      inFlightRequest: null,
      listeners: new Set(),
      consumerCount: 0,
      pollTimer: null,
    };
    catalogEntries.set(key, entry);
  }
  return entry;
}

function emitCatalogUpdate(key: string): void {
  const entry = getCatalogEntry(key);
  for (const listener of entry.listeners) {
    listener();
  }
}

function refreshSkillsForKey(key: string): Promise<void> {
  const entry = getCatalogEntry(key);
  if (entry.inFlightRequest) return entry.inFlightRequest;

  entry.state = { ...entry.state, inFlight: true };
  emitCatalogUpdate(key);

  const projectId = key === GLOBAL_SKILLS_KEY ? undefined : key;
  const request = window.electronAPI
    .skillsList(projectId)
    .then((skills) => {
      entry.state = {
        skills,
        fetchedAt: Date.now(),
        inFlight: false,
      };
      emitCatalogUpdate(key);
    })
    .catch(() => {
      entry.state = {
        ...entry.state,
        inFlight: false,
      };
      emitCatalogUpdate(key);
    })
    .finally(() => {
      if (entry.inFlightRequest === request) {
        entry.inFlightRequest = null;
      }
    });

  entry.inFlightRequest = request;
  return request;
}

function refreshActiveCatalogs(): void {
  for (const [key, entry] of catalogEntries) {
    if (entry.consumerCount > 0) {
      void refreshSkillsForKey(key);
    }
  }
}

function handleWindowFocus(): void {
  refreshActiveCatalogs();
}

let focusListenerAttached = false;

function attachFocusListener(): void {
  if (focusListenerAttached) return;
  window.addEventListener('focus', handleWindowFocus);
  focusListenerAttached = true;
}

function detachFocusListener(): void {
  if (!focusListenerAttached) return;

  for (const entry of catalogEntries.values()) {
    if (entry.consumerCount > 0) return;
  }

  window.removeEventListener('focus', handleWindowFocus);
  focusListenerAttached = false;
}

function startPolling(key: string): void {
  const entry = getCatalogEntry(key);
  if (entry.pollTimer) return;
  entry.pollTimer = setInterval(() => {
    void refreshSkillsForKey(key);
  }, SKILL_REFRESH_INTERVAL_MS);
}

function stopPolling(key: string): void {
  const entry = getCatalogEntry(key);
  if (!entry.pollTimer) return;
  clearInterval(entry.pollTimer);
  entry.pollTimer = null;
}

function subscribeToCatalog(key: string, listener: () => void): () => void {
  const entry = getCatalogEntry(key);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

function getCatalogSnapshot(key: string): SkillCatalogState {
  return getCatalogEntry(key).state;
}

export interface UseSkillsCatalogResult {
  skills: Skill[];
  fetchedAt: number | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useSkillsCatalog(projectId?: string | null): UseSkillsCatalogResult {
  const key = getCatalogKey(projectId);
  const state = useSyncExternalStore(
    useCallback((listener) => subscribeToCatalog(key, listener), [key]),
    useCallback(() => getCatalogSnapshot(key), [key]),
    useCallback(() => getCatalogSnapshot(key), [key]),
  );

  useEffect(() => {
    const entry = getCatalogEntry(key);
    entry.consumerCount += 1;
    attachFocusListener();
    startPolling(key);
    void refreshSkillsForKey(key);

    return () => {
      const currentEntry = getCatalogEntry(key);
      currentEntry.consumerCount = Math.max(0, currentEntry.consumerCount - 1);
      if (currentEntry.consumerCount === 0) {
        stopPolling(key);
      }
      detachFocusListener();
    };
  }, [key]);

  const refresh = useCallback(() => refreshSkillsForKey(key), [key]);

  return {
    skills: state.skills,
    fetchedAt: state.fetchedAt,
    loading: state.fetchedAt === null && state.inFlight,
    refresh,
  };
}
