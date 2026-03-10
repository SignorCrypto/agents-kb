import { useEffect, useCallback, useMemo } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';
import { useShortcut } from './hooks/useShortcut';
import { KanbanBoard } from './components/KanbanBoard';
import { ProjectManager } from './components/ProjectManager';
import { JobDetailPanel } from './components/JobDetailPanel';
import { NewJobDialog } from './components/NewJobDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { SetupScreen } from './components/SetupScreen';
import { Kbd } from './components/Kbd';
import { getProjectColor } from '../shared/types';

function applyDarkClass(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark);
}

export default function App() {
  const cliHealth = useKanbanStore((s) => s.cliHealth);
  const cliHealthLoading = useKanbanStore((s) => s.cliHealthLoading);
  const checkCliHealth = useKanbanStore((s) => s.checkCliHealth);
  const init = useKanbanStore((s) => s.init);
  const selectedJobId = useKanbanStore((s) => s.selectedJobId);
  const showNewJobDialog = useKanbanStore((s) => s.showNewJobDialog);
  const setShowNewJobDialog = useKanbanStore((s) => s.setShowNewJobDialog);
  const showSettings = useKanbanStore((s) => s.showSettings);
  const setShowSettings = useKanbanStore((s) => s.setShowSettings);
  const projects = useKanbanStore((s) => s.projects);
  const selectedProjectId = useKanbanStore((s) => s.selectedProjectId);
  const selectProject = useKanbanStore((s) => s.selectProject);
  const theme = useKanbanStore((s) => s.settings.theme);

  const selectedProject = useMemo(
    () => selectedProjectId ? projects.find((p) => p.id === selectedProjectId) : null,
    [projects, selectedProjectId],
  );
  const projectColor = selectedProject ? getProjectColor(selectedProject.color) : null;

  // Check CLI health on mount
  useEffect(() => {
    checkCliHealth();
  }, [checkCliHealth]);

  // Only initialize store once CLI is healthy
  const cliReady = cliHealth?.installed && cliHealth?.authenticated;
  useEffect(() => {
    if (cliReady) {
      init().catch((err) => console.error('[App] init failed:', err));
    }
  }, [cliReady, init]);

  // Sync dark class with actual resolved theme from main process
  useEffect(() => {
    const api = window.electronAPI;
    // Get initial actual theme
    api.themeGetActual().then((actual) => applyDarkClass(actual === 'dark'));
    // Listen for changes (system theme change or user toggle)
    return api.onThemeChanged((actual) => applyDarkClass(actual === 'dark'));
  }, [theme]);

  const toggleNewJob = useCallback(() => {
    if (projects.length > 0) setShowNewJobDialog(!showNewJobDialog);
  }, [projects.length, setShowNewJobDialog, showNewJobDialog]);

  useShortcut('newJob', toggleNewJob, { enabled: projects.length > 0 });

  const toggleSettings = useCallback(() => setShowSettings(!showSettings), [setShowSettings, showSettings]);
  useShortcut('openSettings', toggleSettings);

  // Show setup screen if CLI is not ready
  if (!cliReady) {
    return (
      <SetupScreen
        health={cliHealth ?? { installed: false, authenticated: false }}
        onRetry={checkCliHealth}
        loading={cliHealthLoading}
      />
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <ProjectManager />

      {/* Main board area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Drag region / title bar */}
        <div
          className="h-12 flex items-center justify-between px-4 shrink-0 border-b border-chrome-subtle/70"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2">
            {selectedProject ? (
              <div
                className="flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-full border border-chrome/40 bg-surface-elevated/80 shadow-sm backdrop-blur-sm"
                style={{ borderColor: `${projectColor}40`, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: projectColor!, boxShadow: `0 0 0 3px ${projectColor}20` }}
                />
                <span className="text-xs font-semibold text-content-primary tracking-wide truncate max-w-[200px]">
                  {selectedProject.name}
                </span>
                <button
                  onClick={() => selectProject(null)}
                  className="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/80 transition-colors duration-150"
                  title="Clear project filter"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" />
                  </svg>
                </button>
              </div>
            ) : (
              <span className="text-sm font-medium text-content-tertiary">
                All Projects
              </span>
            )}
          </div>
          <button
            onClick={() => setShowNewJobDialog(true)}
            disabled={projects.length === 0}
            className="text-sm px-4 py-1.5 rounded-md bg-btn-primary text-content-inverted font-medium hover:bg-btn-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            + New Job<Kbd shortcutId="newJob" />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          <KanbanBoard />
          {selectedJobId && <JobDetailPanel />}
        </div>
      </div>

      {/* Modals */}
      {showNewJobDialog && <NewJobDialog />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  );
}
