import { useState, useEffect, useCallback, useRef } from 'react';

type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready' };

export function UpdateButton() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    const api = window.electronAPI;

    const unsubs = [
      api.onUpdaterUpdateAvailable((data) => {
        setState({ status: 'available', version: data.version });
      }),
      api.onUpdaterDownloadProgress((data) => {
        setState({ status: 'downloading', percent: data.percent });
      }),
      api.onUpdaterUpdateDownloaded(() => {
        setState({ status: 'ready' });
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  const handleClick = useCallback(() => {
    const api = window.electronAPI;
    if (state.status === 'available') {
      setState({ status: 'downloading', percent: 0 });
      api.updaterDownload();
    } else if (state.status === 'ready') {
      api.updaterInstall();
    }
  }, [state.status]);

  if (state.status === 'idle') return null;

  const bgColor = state.status === 'ready'
    ? 'rgb(var(--color-success) / 0.12)'
    : 'rgb(var(--color-warning) / 0.10)';
  const fgColor = state.status === 'ready'
    ? 'rgb(var(--color-success))'
    : 'rgb(var(--color-warning))';

  return (
    <button
      onClick={handleClick}
      className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-wide transition-all duration-200 overflow-hidden"
      style={{ WebkitAppRegion: 'no-drag', background: bgColor, color: fgColor } as React.CSSProperties}
    >
      {state.status === 'downloading' && (
        <span
          className="absolute inset-0 opacity-15 transition-[width] duration-300 ease-out"
          style={{ width: `${state.percent}%`, background: 'rgb(var(--color-warning))' }}
        />
      )}
      <span className="relative shrink-0">
        {state.status === 'available' && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2v6M3.5 5.5 6 8l2.5-2.5" />
            <path d="M2.5 9.5h7" />
          </svg>
        )}
        {state.status === 'downloading' && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="animate-spin">
            <path d="M6 1a5 5 0 0 1 5 5" />
          </svg>
        )}
        {state.status === 'ready' && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.5 5 9l4.5-6" />
          </svg>
        )}
      </span>
      <span className="relative whitespace-nowrap">
        {state.status === 'available' && `Update v${state.version}`}
        {state.status === 'downloading' && `${Math.round(state.percent)}%`}
        {state.status === 'ready' && 'Restart'}
      </span>
    </button>
  );
}

/* ─── Settings: Check for Updates ─── */

type CheckState = 'idle' | 'checking' | 'up-to-date' | 'error';

export function CheckForUpdatesButton() {
  const [state, setState] = useState<CheckState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const api = window.electronAPI;

    const unsubs = [
      api.onUpdaterUpdateAvailable(() => {
        setState('idle');
      }),
      api.onUpdaterUpToDate(() => {
        setState('up-to-date');
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setState('idle'), 4000);
      }),
      api.onUpdaterError(() => {
        setState('error');
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setState('idle'), 4000);
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      clearTimeout(timerRef.current);
    };
  }, []);

  const handleCheck = useCallback(() => {
    setState('checking');
    window.electronAPI.updaterCheck();
  }, []);

  const label =
    state === 'checking' ? 'Checking…' :
    state === 'up-to-date' ? 'Up to date' :
    state === 'error' ? 'Check failed' :
    'Check for Updates';

  return (
    <button
      onClick={handleCheck}
      disabled={state === 'checking'}
      className="text-[11px] px-3 py-1.5 rounded-md border border-chrome/60 bg-surface-tertiary/40 text-content-secondary hover:border-chrome-focus/60 hover:bg-surface-tertiary/80 hover:text-content-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
    >
      {state === 'up-to-date' ? (
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="rgb(var(--color-success))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 5.5 4 7.5l4-5" />
          </svg>
          {label}
        </span>
      ) : label}
    </button>
  );
}
