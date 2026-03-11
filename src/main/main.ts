import { app, BrowserWindow, nativeTheme } from 'electron';
import path from 'path';

console.log('[main] Starting Agents-KB...');

import { registerIpcHandlers } from './ipc-handlers';
import { sessionManager } from './session-manager';
import { flushNow, getSettings } from './store';
import { setupAutoUpdater } from './auto-updater';

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// Register IPC handlers before window creation
registerIpcHandlers(() => mainWindow);

app.whenReady().then(() => {
  // Apply saved theme preference
  const settings = getSettings();
  nativeTheme.themeSource = settings.theme;

  createWindow();

  // Set up auto-updater
  setupAutoUpdater(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  flushNow();
  sessionManager.killAll();
});
