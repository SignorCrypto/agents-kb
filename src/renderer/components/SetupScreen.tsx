import { useState, useEffect, useRef, useCallback } from 'react';
import type { CliHealthStatus } from '../types/index';

interface SetupScreenProps {
  health: CliHealthStatus;
  onRetry: () => void;
  loading: boolean;
}

const DOCS_URL = 'https://code.claude.com/docs/en/quickstart';

/* ─── Icons ─── */

function TerminalIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="40" height="32" rx="4" className="stroke-content-tertiary" />
      <path d="M14 20l6 4-6 4" className="stroke-content-primary" />
      <line x1="24" y1="28" x2="34" y2="28" className="stroke-content-tertiary" />
    </svg>
  );
}

function CheckCircle() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" className="stroke-semantic-success" strokeWidth="1.5" />
      <path d="M6.5 10l2.5 2.5 5-5" className="stroke-semantic-success" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XCircle() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" className="stroke-semantic-error" strokeWidth="1.5" />
      <path d="M7 7l6 6M13 7l-6 6" className="stroke-semantic-error" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="animate-spin">
      <circle cx="10" cy="10" r="8" strokeWidth="2" className="stroke-chrome opacity-30" />
      <path d="M10 2a8 8 0 0 1 8 8" strokeWidth="2" strokeLinecap="round" className="stroke-content-primary" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-1 -mt-0.5">
      <path d="M10.5 7.5v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1H6.5" />
      <path d="M8.5 2h3.5v3.5" />
      <path d="M6 8l6-6" />
    </svg>
  );
}

/* ─── Login Terminal (xterm.js) ─── */

function LoginTerminal({ onComplete }: { onComplete: () => void }) {
  const [running, setRunning] = useState(false);
  const [exited, setExited] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);

  const startLogin = useCallback(() => {
    setRunning(true);
    setExited(false);

    const api = window.electronAPI;
    const term = terminalRef.current;

    term?.clear();

    const unsubData = api.onCliLoginData((data) => {
      term?.write(data);
    });

    const unsubExit = api.onCliLoginExit((exitCode) => {
      setRunning(false);
      setExited(true);
      if (exitCode === 0) {
        term?.writeln('\r\nLogin successful.');
        setTimeout(onComplete, 800);
      } else {
        term?.writeln(`\r\nLogin exited with code ${exitCode}.`);
      }
    });

    cleanupRef.current = [unsubData, unsubExit];
    api.cliStartLogin();
  }, [onComplete]);

  // Initialize xterm.js
  useEffect(() => {
    let mounted = true;

    async function init() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      if (!mounted || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        theme: {
          background: '#1a1a1a',
          foreground: '#e0e0e0',
          cursor: '#e0e0e0',
        },
        rows: 12,
        convertEol: true,
        allowProposedApi: true,
      });

      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      // Forward user keyboard input to the PTY
      term.onData((data) => {
        window.electronAPI.cliLoginWrite(data);
      });

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      // Start login after terminal is ready
      startLogin();
    }

    init();

    // Resize observer to keep terminal fitted
    const resizeObserver = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      mounted = false;
      cleanupRef.current.forEach((fn) => fn());
      window.electronAPI.cliLoginKill();
      resizeObserver.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full rounded-lg border border-chrome-subtle overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-surface-tertiary border-b border-chrome-subtle">
        <span className="text-xs font-medium text-content-secondary">claude login</span>
        {running && (
          <span className="flex items-center gap-1.5 text-xs text-content-tertiary">
            <span className="w-1.5 h-1.5 rounded-full bg-semantic-success animate-pulse" />
            Running
          </span>
        )}
        {exited && !running && (
          <button
            onClick={startLogin}
            className="text-xs text-content-tertiary hover:text-content-primary transition-colors"
          >
            Retry
          </button>
        )}
      </div>
      <div ref={containerRef} className="h-52" />
    </div>
  );
}

/* ─── Setup Screen ─── */

export function SetupScreen({ health, onRetry, loading }: SetupScreenProps) {
  const [showLoginTerminal, setShowLoginTerminal] = useState(false);
  const notInstalled = !health.installed;
  const notAuthenticated = health.installed && !health.authenticated;

  const handleLoginComplete = useCallback(() => {
    setShowLoginTerminal(false);
    onRetry();
  }, [onRetry]);

  return (
    <div className="flex h-full items-center justify-center bg-surface-primary">
      {/* Drag region for window controls */}
      <div
        className="fixed top-0 left-0 right-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <div className="w-full max-w-md px-6">
        <div className="flex flex-col items-center text-center">
          {/* Icon */}
          <div className="mb-6">
            <TerminalIcon />
          </div>

          {/* Title */}
          <h1 className="text-xl font-semibold text-content-primary mb-2">
            Set Up Claude Code
          </h1>
          <p className="text-sm text-content-secondary mb-8 leading-relaxed max-w-sm">
            Agents-KB requires Claude Code CLI to manage your coding sessions.
          </p>

          {/* Status checklist */}
          <div className="w-full rounded-lg border border-chrome bg-surface-elevated p-4 mb-6">
            <div className="flex items-center gap-3 py-2">
              {loading ? <Spinner /> : health.installed ? <CheckCircle /> : <XCircle />}
              <span className={`text-sm ${health.installed ? 'text-content-secondary' : 'text-content-primary font-medium'}`}>
                CLI installed
              </span>
              {health.version && (
                <span className="ml-auto text-xs text-content-tertiary font-mono">
                  {health.version}
                </span>
              )}
            </div>
            <div className="border-t border-chrome-subtle my-1" />
            <div className="flex items-center gap-3 py-2">
              {loading ? <Spinner /> : health.authenticated ? <CheckCircle /> : <XCircle />}
              <span className={`text-sm ${health.authenticated ? 'text-content-secondary' : 'text-content-primary font-medium'}`}>
                Logged in
              </span>
            </div>
          </div>

          {/* Install: link to official docs */}
          {notInstalled && (
            <div className="w-full rounded-lg border border-chrome-subtle bg-surface-secondary p-4 mb-6 text-left">
              <p className="text-sm font-medium text-content-primary mb-2">Install Claude Code</p>
              <p className="text-xs text-content-secondary mb-3 leading-relaxed">
                Follow the official documentation to install the Claude Code CLI on your system.
              </p>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-xs font-medium text-interactive-link hover:text-interactive-link-hover transition-colors"
                onClick={(e) => {
                  e.preventDefault();
                  window.electronAPI.shellOpenExternal(DOCS_URL);
                }}
              >
                Claude Code Quickstart
                <ExternalLinkIcon />
              </a>
            </div>
          )}

          {/* Login: show terminal or button */}
          {notAuthenticated && !showLoginTerminal && (
            <div className="w-full mb-6">
              <button
                onClick={() => setShowLoginTerminal(true)}
                className="w-full px-5 py-2.5 rounded-md bg-btn-primary text-content-inverted text-sm font-medium hover:bg-btn-primary-hover transition-colors"
              >
                Log In to Claude Code
              </button>
            </div>
          )}

          {notAuthenticated && showLoginTerminal && (
            <div className="w-full mb-6">
              <LoginTerminal onComplete={handleLoginComplete} />
            </div>
          )}

          {/* Retry button */}
          <button
            onClick={onRetry}
            disabled={loading}
            className="px-5 py-2 rounded-md border border-chrome text-sm font-medium text-content-secondary hover:text-content-primary hover:border-chrome-focus disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Checking…' : 'Check Again'}
          </button>
        </div>
      </div>
    </div>
  );
}
