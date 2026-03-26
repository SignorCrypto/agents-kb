import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createInstance,
  getInstance,
  attachInstance,
  onStatusChange,
  refitInstance,
  focusInstance,
} from './terminalRegistry';

interface UseTerminalInstanceOptions {
  terminalId: string;
  projectId: string;
  isActive: boolean;
}

interface UseTerminalInstanceReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isReady: boolean;
  exitCode: number | null;
  refit: () => void;
}

export function useTerminalInstance({
  terminalId,
  projectId,
  isActive,
}: UseTerminalInstanceOptions): UseTerminalInstanceReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isActiveRef = useRef(isActive);
  const [isReady, setIsReady] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const attachAndActivate = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;

    attachInstance(terminalId, container);

    return window.setTimeout(() => {
      refitInstance(terminalId);
      focusInstance(terminalId);
    }, 50);
  }, [terminalId]);

  // Create instance on mount (spawns PTY immediately, but does NOT open xterm yet)
  useEffect(() => {
    let mounted = true;
    let activationTimeout: number | null = null;

    async function init() {
      try {
        let instance = getInstance(terminalId);
        if (!instance) {
          instance = await createInstance(terminalId, projectId);
        }

        if (!mounted) return;

        setIsReady(instance.isReady);
        setExitCode(instance.exitCode);

        if (isActiveRef.current && containerRef.current) {
          activationTimeout = attachAndActivate();
        }
      } catch (error) {
        if (
          mounted
          && !(error instanceof Error && error.message.includes('was destroyed during creation'))
        ) {
          console.warn('[terminal] failed to create terminal instance', { terminalId, error });
        }
      }
    }

    init();

    return () => {
      mounted = false;
      if (activationTimeout !== null) {
        window.clearTimeout(activationTimeout);
      }
    };
  }, [attachAndActivate, projectId, terminalId]);

  // Subscribe to status changes
  useEffect(() => {
    return onStatusChange((id, ready, code) => {
      if (id === terminalId) {
        setIsReady(ready);
        setExitCode(code);
      }
    });
  }, [terminalId]);

  // Attach, refit, and focus when becoming active (visible in DOM).
  // isActive is true only when this tab is selected AND the panel is expanded,
  // so this fires on tab switch, panel expand, and initial display.
  useEffect(() => {
    if (!isActive || !isReady) return;

    const activationTimeout = attachAndActivate();
    return () => {
      if (activationTimeout !== null) {
        window.clearTimeout(activationTimeout);
      }
    };
  }, [attachAndActivate, isActive, isReady]);

  // ResizeObserver for auto-fit when container size changes (e.g. panel drag resize)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isActive) return;
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => refitInstance(terminalId), 100);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, [isActive, terminalId]);

  const refit = useCallback(() => {
    refitInstance(terminalId);
  }, [terminalId]);

  return { containerRef, isReady, exitCode, refit };
}

/**
 * Track ready/exit status for multiple terminal IDs.
 * Used by TerminalPanel to show status dots in tabs.
 */
export function useTerminalStatuses(terminalIds: string[]): Map<string, { isReady: boolean; exitCode: number | null }> {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return onStatusChange((id) => {
      if (terminalIds.includes(id)) {
        setVersion((v) => v + 1);
      }
    });
  }, [terminalIds]);

  return useMemo(() => {
    // version used to trigger recalc
    void version;
    const map = new Map<string, { isReady: boolean; exitCode: number | null }>();
    for (const id of terminalIds) {
      const inst = getInstance(id);
      map.set(id, { isReady: inst?.isReady ?? false, exitCode: inst?.exitCode ?? null });
    }
    return map;
  }, [terminalIds, version]);
}
