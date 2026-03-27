import { app, BrowserWindow, nativeTheme } from 'electron';
import path from 'path';
import { fixPath } from './fix-path';

// Fix PATH for packaged apps before any CLI invocations
fixPath();

console.log('[main] Starting Agents-KB...');

import { registerIpcHandlers, initModels } from './ipc-handlers';
import { sessionManager } from './session-manager';
import { terminalManager } from './terminal/index';
import { flushNow, getSettings } from './store';
import { setupAutoUpdater } from './auto-updater';

let mainWindow: BrowserWindow | null = null;

interface ParsedModifierShortcut {
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

function parseModifierShortcut(keys: string): ParsedModifierShortcut {
  const parts = keys.toLowerCase().split('+');
  return {
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  };
}

function modifiersMatch(
  parsed: ParsedModifierShortcut,
  input: Electron.Input,
  ignoreShift = false,
): boolean {
  const modPressed = Boolean(input.meta || input.control);
  const shiftPressed = Boolean(input.shift);
  const altPressed = Boolean(input.alt);

  const modMatch = parsed.mod ? modPressed : !modPressed;
  const shiftMatch = ignoreShift || (parsed.shift ? shiftPressed : !shiftPressed);
  const altMatch = parsed.alt ? altPressed : !altPressed;

  return modMatch && shiftMatch && altMatch;
}

function getShortcutDigit(input: Electron.Input): number | null {
  const code = typeof input.code === 'string' ? input.code : '';
  const codeMatch = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (codeMatch) return Number(codeMatch[1]);

  const key = typeof input.key === 'string' ? input.key : '';
  const keyMatch = /^[1-9]$/.exec(key);
  if (keyMatch) return Number(keyMatch[0]);

  return null;
}

function getSwitchTerminalTabDigit(input: Electron.Input): number | null {
  const shortcut = getSettings().shortcuts.find((binding) => binding.id === 'switchTerminalTab');
  if (!shortcut?.enabled || !shortcut.keys) return null;

  const digit = getShortcutDigit(input);
  if (digit === null) return null;

  return modifiersMatch(parseModifierShortcut(shortcut.keys), input, true) ? digit : null;
}

function registerWindowShortcuts(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const digit = getSwitchTerminalTabDigit(input);
    if (digit === null) return;

    event.preventDefault();
    window.webContents.send('shortcut:switch-terminal-tab', digit);
  });
}

const createWindow = () => {
  const isDark = nativeTheme.shouldUseDarkColors;
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    ...(isWin ? { titleBarOverlay: {
      color: isDark ? '#0c0a09' : '#f1f0ee',
      symbolColor: isDark ? '#e7e5e4' : '#1c1917',
      height: 40,
    } } : {}),
    backgroundColor: isDark ? '#0c0a09' : '#f1f0ee',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerWindowShortcuts(mainWindow);

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

  // Fetch supported models from the SDK at startup
  void initModels(() => mainWindow);

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
  terminalManager.killAll();
});
