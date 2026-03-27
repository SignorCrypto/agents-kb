/**
 * Module-level registry for long-lived xterm + FitAddon instances.
 * Decouples xterm lifecycle from React mount/unmount so switching tabs
 * doesn't kill shell sessions.
 */

type StatusCallback = (terminalId: string, ready: boolean, exitCode: number | null) => void;

function getTerminalTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const toHex = (varName: string): string => {
    const rgb = style.getPropertyValue(`--color-${varName}`).trim();
    if (!rgb) return '#171717';
    const parts = rgb.split(' ').map(Number);
    if (parts.length < 3) return '#171717';
    return `#${parts.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  };

  return {
    background: toHex('terminal-surface'),
    foreground: toHex('terminal-text'),
    cursor: toHex('terminal-text'),
    cursorAccent: toHex('terminal-surface'),
    selectionBackground: toHex('terminal-hover'),
  };
}

function applyTerminalTheme(terminal: import('@xterm/xterm').Terminal): void {
  terminal.options.theme = getTerminalTheme();
  if (terminal.rows > 0) {
    terminal.refresh(0, terminal.rows - 1);
  }
}

export interface TerminalInstance {
  terminalId: string;
  projectId: string;
  terminal: import('@xterm/xterm').Terminal;
  fitAddon: import('@xterm/addon-fit').FitAddon;
  element: HTMLDivElement;
  opened: boolean;
  isReady: boolean;
  exitCode: number | null;
  destroyRequested: boolean;
  cleanup: (() => void)[];
}

const instances = new Map<string, TerminalInstance>();
const pendingCreates = new Map<string, Promise<TerminalInstance>>();
const pendingDestroy = new Set<string>();
const statusListeners = new Set<StatusCallback>();

export function onStatusChange(cb: StatusCallback): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

function notifyStatus(terminalId: string, ready: boolean, exitCode: number | null) {
  for (const cb of statusListeners) cb(terminalId, ready, exitCode);
}

function cleanupInstance(
  terminalId: string,
  instance: TerminalInstance,
  options: { killPty: boolean },
): void {
  if (instances.get(terminalId) === instance) {
    instances.delete(terminalId);
  }
  pendingDestroy.delete(terminalId);
  instance.cleanup.forEach((fn) => fn());
  if (options.killPty) {
    window.electronAPI.terminalKill(terminalId);
  }
  instance.terminal.dispose();
}

export async function createInstance(terminalId: string, projectId: string): Promise<TerminalInstance> {
  const existing = instances.get(terminalId);
  if (existing) return existing;

  const pending = pendingCreates.get(terminalId);
  if (pending) return pending;

  const createPromise = (async () => {
    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      theme: getTerminalTheme(),
      convertEol: true,
      allowProposedApi: true,
    });
    terminal.loadAddon(fitAddon);

    // Create a persistent DOM element — xterm.open() is deferred until attached to DOM
    const element = document.createElement('div');
    element.style.width = '100%';
    element.style.height = '100%';

    const cleanup: (() => void)[] = [];

    const instance: TerminalInstance = {
      terminalId,
      projectId,
      terminal,
      fitAddon,
      element,
      opened: false,
      isReady: false,
      exitCode: null,
      destroyRequested: pendingDestroy.has(terminalId),
      cleanup,
    };

    instances.set(terminalId, instance);

    // Wire user input → PTY
    const dataDisposable = terminal.onData((data) => {
      window.electronAPI.terminalWrite(terminalId, data);
    });
    cleanup.push(() => dataDisposable.dispose());

    // Wire PTY output → terminal
    const unsubData = window.electronAPI.onTerminalData(({ terminalId: id, data }) => {
      if (id === terminalId) terminal.write(data);
    });
    cleanup.push(unsubData);

    // Wire PTY exit
    const unsubExit = window.electronAPI.onTerminalExit(({ terminalId: id, exitCode: code }) => {
      if (id === terminalId) {
        instance.exitCode = code;
        notifyStatus(terminalId, instance.isReady, code);
      }
    });
    cleanup.push(unsubExit);

    try {
      // Spawn the PTY (open/fit happens later via attachInstance once in DOM)
      await window.electronAPI.terminalCreate(projectId, terminalId);
    } catch (error) {
      cleanupInstance(terminalId, instance, { killPty: false });
      throw error;
    }

    if (instance.destroyRequested || pendingDestroy.has(terminalId)) {
      cleanupInstance(terminalId, instance, { killPty: true });
      throw new Error(`Terminal ${terminalId} was destroyed during creation`);
    }

    instance.isReady = true;
    notifyStatus(terminalId, true, null);

    return instance;
  })().finally(() => {
    pendingCreates.delete(terminalId);
  });

  pendingCreates.set(terminalId, createPromise);
  return createPromise;
}

export function getInstance(terminalId: string): TerminalInstance | undefined {
  return instances.get(terminalId);
}

/**
 * Attach an instance's element to a container and open xterm if not yet opened.
 * Must be called after the container is in the DOM so xterm can measure dimensions.
 */
export function attachInstance(terminalId: string, container: HTMLElement): void {
  const instance = instances.get(terminalId);
  if (!instance) return;

  if (!container.contains(instance.element)) {
    container.appendChild(instance.element);
  }

  if (!instance.opened) {
    instance.opened = true;
    instance.terminal.open(instance.element);
    // Small delay to ensure DOM layout is settled before fitting
    setTimeout(() => {
      try {
        instance.fitAddon.fit();
        window.electronAPI.terminalResize(terminalId, instance.terminal.cols, instance.terminal.rows);
      } catch {
        // Terminal may be disposed
      }
    }, 0);
  }
}

export function destroyInstance(terminalId: string): void {
  const instance = instances.get(terminalId);
  if (!instance) {
    if (pendingCreates.has(terminalId)) {
      pendingDestroy.add(terminalId);
    }
    return;
  }

  instance.destroyRequested = true;

  if (!instance.isReady) {
    pendingDestroy.add(terminalId);
    return;
  }

  cleanupInstance(terminalId, instance, { killPty: true });
}

export function destroyAllInstances(): void {
  const terminalIds = new Set([...instances.keys(), ...pendingCreates.keys()]);
  for (const id of terminalIds) {
    destroyInstance(id);
  }
}

export function refitInstance(terminalId: string): void {
  const instance = instances.get(terminalId);
  if (!instance) return;
  try {
    instance.fitAddon.fit();
    window.electronAPI.terminalResize(terminalId, instance.terminal.cols, instance.terminal.rows);
  } catch {
    // Terminal may be disposed
  }
}

export function focusInstance(terminalId: string): void {
  const instance = instances.get(terminalId);
  if (!instance) return;
  instance.terminal.focus();
}

export function refreshAllTerminalThemes(): void {
  for (const instance of instances.values()) {
    applyTerminalTheme(instance.terminal);
  }
}
