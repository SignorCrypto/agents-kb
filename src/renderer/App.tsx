import { useEffect, useCallback, useMemo } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';
import { useShortcut } from './hooks/useShortcut';
import { KanbanBoard } from './components/KanbanBoard';
import { ProjectManager } from './components/ProjectManager';
import { JobDetailPanel } from './components/JobDetailPanel';
import { NewJobDialog } from './components/NewJobDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { SkillsPanel } from './features/skills';
import { TerminalPanel } from './features/terminal';
import { PromptHistoryDialog } from './components/PromptHistoryDialog';
import { WhatsNewDialog } from './components/WhatsNewDialog';
import { SetupScreen } from './components/SetupScreen';
import { SplashScreen } from './components/SplashScreen';
import { Kbd } from './components/Kbd';
import { UpdateButton } from './components/UpdateButton';
import { XIcon } from './components/Icons';
import { refreshAllTerminalThemes } from './features/terminal/terminalRegistry';
import { getProjectColor } from '../shared/types';

function applyDarkClass(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark);
}

const isWindows = window.electronAPI.appGetPlatform() === 'win32';

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
  const showSkillsPanel = useKanbanStore((s) => s.showSkillsPanel);
  const setShowSkillsPanel = useKanbanStore((s) => s.setShowSkillsPanel);
  const promptHistoryJobId = useKanbanStore((s) => s.promptHistoryJobId);
  const showWhatsNew = useKanbanStore((s) => s.showWhatsNew);
  const whatsNewContent = useKanbanStore((s) => s.whatsNewContent);
  const whatsNewVersion = useKanbanStore((s) => s.whatsNewVersion);
  const setShowWhatsNew = useKanbanStore((s) => s.setShowWhatsNew);
  const projects = useKanbanStore((s) => s.projects);
  const selectedProjectId = useKanbanStore((s) => s.selectedProjectId);
  const selectProject = useKanbanStore((s) => s.selectProject);
  const toggleTerminalForProject = useKanbanStore((s) => s.toggleTerminalForProject);
  const setShowAddTerminal = useKanbanStore((s) => s.setShowAddTerminal);
  const theme = useKanbanStore((s) => s.settings.theme);

  const applyResolvedTheme = useCallback((actual: 'light' | 'dark') => {
    applyDarkClass(actual === 'dark');
    requestAnimationFrame(() => {
      refreshAllTerminalThemes();
    });
  }, []);

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
    void api.themeGetActual().then(applyResolvedTheme);
    return api.onThemeChanged(applyResolvedTheme);
  }, [applyResolvedTheme, theme]);

  const toggleNewJob = useCallback(() => {
    if (projects.length > 0) setShowNewJobDialog(!showNewJobDialog);
  }, [projects.length, setShowNewJobDialog, showNewJobDialog]);

  useShortcut('newJob', toggleNewJob, { enabled: projects.length > 0 });

  const toggleSettings = useCallback(() => setShowSettings(!showSettings), [setShowSettings, showSettings]);
  useShortcut('openSettings', toggleSettings);

  const terminalTabs = useKanbanStore((s) => s.terminalTabs);
  const terminalExpanded = useKanbanStore((s) => s.terminalExpanded);
  const setTerminalExpanded = useKanbanStore((s) => s.setTerminalExpanded);

  const toggleTerminalShortcut = useCallback(() => {
    if (selectedProjectId) {
      toggleTerminalForProject(selectedProjectId);
    } else if (terminalTabs.length > 0) {
      // No project selected — just toggle the panel
      setTerminalExpanded(!terminalExpanded);
    } else {
      // No terminals at all — open the new terminal dialog
      setTerminalExpanded(true);
      setShowAddTerminal(true);
    }
  }, [selectedProjectId, toggleTerminalForProject, terminalTabs.length, terminalExpanded, setTerminalExpanded, setShowAddTerminal]);
  useShortcut('toggleTerminal', toggleTerminalShortcut);

  const openNewTerminal = useCallback(() => setShowAddTerminal(true), [setShowAddTerminal]);
  useShortcut('newTerminal', openNewTerminal);

  // Show splash screen during initial health check
  if (cliHealth === null && cliHealthLoading) {
    return <SplashScreen />;
  }

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
          className="h-10 flex items-center justify-between px-3 shrink-0"
          style={{ WebkitAppRegion: 'drag', ...(isWindows ? { paddingRight: 140 } : {}) } as React.CSSProperties}
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
                  <XIcon size={10} />
                </button>
              </div>
            ) : (
              <span className="text-sm font-medium text-content-tertiary">
                All Projects
              </span>
            )}
          </div>
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <UpdateButton />
            <button
              onClick={() => setShowNewJobDialog(true)}
              disabled={projects.length === 0}
              className="text-xs px-3 py-1 rounded-md bg-btn-primary text-content-inverted font-medium hover:bg-btn-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              + New Job<Kbd shortcutId="newJob" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 flex min-h-0">
            <KanbanBoard />
            {selectedJobId && <JobDetailPanel />}
          </div>
          <TerminalPanel />
        </div>
      </div>

      {/* Modals */}
      {showNewJobDialog && <NewJobDialog />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showSkillsPanel && <SkillsPanel onClose={() => setShowSkillsPanel(false)} />}
      {promptHistoryJobId && <PromptHistoryDialog />}
      {showWhatsNew && whatsNewContent && whatsNewVersion && (
        <WhatsNewDialog
          version={whatsNewVersion}
          content={whatsNewContent}
          onClose={() => setShowWhatsNew(false)}
        />
      )}
    </div>
  );
}
