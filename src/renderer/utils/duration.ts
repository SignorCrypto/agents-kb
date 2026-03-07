import { useSyncExternalStore } from 'react';

export function formatDuration(startMs: number, endMs: number, pausedMs = 0): string {
  const totalSec = Math.max(0, Math.floor((endMs - startMs - pausedMs) / 1000));

  if (totalSec < 60) return `${totalSec}s`;

  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${secs}s`;
}

// Shared 1-second timer — starts with first subscriber, stops with last
let sharedNow = Date.now();
let sharedTimer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  if (subscribers.size === 1 && !sharedTimer) {
    sharedTimer = setInterval(() => {
      sharedNow = Date.now();
      for (const fn of subscribers) fn();
    }, 1000);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && sharedTimer) {
      clearInterval(sharedTimer);
      sharedTimer = null;
    }
  };
}

function getSnapshot(): number {
  return sharedNow;
}

/** Returns Date.now(), updated every second via a shared timer.
 *  Pass 0 to disable ticking (returns a static snapshot). */
export function useNow(intervalMs: number): number {
  const shared = useSyncExternalStore(subscribe, getSnapshot);
  // When disabled, just return current Date.now() without subscribing to ticks
  if (!intervalMs) return Date.now();
  return shared;
}
