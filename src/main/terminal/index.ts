import { ipcMain, BrowserWindow } from 'electron';
import { terminalManager } from './terminal-manager';
import { getProjects } from '../store';

type WindowGetter = () => BrowserWindow | null;

function sendToRenderer(getWindow: WindowGetter, channel: string, data: unknown) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

export function registerTerminalIpc(getWindow: WindowGetter): void {
  ipcMain.handle(
    'terminal:create',
    (_event, { projectId, terminalId }: { projectId: string | null; terminalId: string }) => {
      let cwd: string;
      if (projectId) {
        const project = getProjects().find((p) => p.id === projectId);
        if (!project) throw new Error('Project not found');
        cwd = project.path;
      } else {
        cwd = require('os').homedir();
      }

      terminalManager.create(
        terminalId,
        cwd,
        projectId ?? '__global__',
        (data) => sendToRenderer(getWindow, 'terminal:data', { terminalId, data }),
        (exitCode) => sendToRenderer(getWindow, 'terminal:exit', { terminalId, exitCode }),
      );
    },
  );

  ipcMain.handle(
    'terminal:write',
    (_event, { terminalId, data }: { terminalId: string; data: string }) => {
      terminalManager.write(terminalId, data);
    },
  );

  ipcMain.handle(
    'terminal:resize',
    (_event, { terminalId, cols, rows }: { terminalId: string; cols: number; rows: number }) => {
      terminalManager.resize(terminalId, cols, rows);
    },
  );

  ipcMain.handle('terminal:kill', (_event, { terminalId }: { terminalId: string }) => {
    terminalManager.kill(terminalId);
  });

  ipcMain.handle(
    'terminal:kill-project',
    (_event, { projectId }: { projectId: string }) => {
      terminalManager.killByProject(projectId);
    },
  );
}

export { terminalManager } from './terminal-manager';
