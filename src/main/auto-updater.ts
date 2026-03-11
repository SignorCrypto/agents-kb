import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';

export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null) {
  // In dev builds, register no-op handlers so the renderer doesn't crash
  if (!app.isPackaged) {
    ipcMain.handle('updater:check', () => {
      const win = getMainWindow();
      if (win) win.webContents.send('updater:up-to-date');
    });
    ipcMain.handle('updater:download', () => {});
    ipcMain.handle('updater:install', () => {});
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send('updater:update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send('updater:download-progress', {
        percent: progress.percent,
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send('updater:update-downloaded');
    }
  });

  autoUpdater.on('update-not-available', () => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send('updater:up-to-date');
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] Error:', err.message);
    const win = getMainWindow();
    if (win) {
      win.webContents.send('updater:error', err.message);
    }
  });

  // IPC handlers
  ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates());
  ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall());

  // Check on launch, then every 30 minutes
  const CHECK_INTERVAL = 30 * 60 * 1000;

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL);
}
