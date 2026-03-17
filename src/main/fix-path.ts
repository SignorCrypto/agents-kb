import { execSync } from 'child_process';
import { app } from 'electron';
import os from 'os';

/**
 * On macOS, packaged Electron apps launched via Finder get a minimal PATH
 * (just /usr/bin:/bin:/usr/sbin:/sbin). On Windows, packaged apps may also
 * miss user-installed CLI tools. This function enriches process.env.PATH
 * so that CLIs like `claude` can be found.
 *
 * Must be called early in the main process before any CLI invocations.
 */
export function fixPath(): void {
  if (!app.isPackaged) return;

  if (process.platform === 'darwin') {
    fixPathDarwin();
  } else if (process.platform === 'win32') {
    fixPathWin32();
  }
}

function fixPathDarwin(): void {
  // Try to get the full PATH from the user's login shell
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const result = execSync(`${shell} -ilc 'echo -n "$PATH"'`, {
      timeout: 5000,
      encoding: 'utf-8',
      env: { ...process.env },
    });
    if (result.trim()) {
      process.env.PATH = result.trim();
      console.log('[fix-path] PATH set from shell:', process.env.PATH);
      return;
    }
  } catch (err) {
    console.warn('[fix-path] Could not get PATH from shell:', err);
  }

  // Fallback: manually add common CLI directories
  const home = os.homedir();
  const extraPaths = [
    `${home}/.local/bin`,
    `${home}/.cargo/bin`,
    `${home}/.nvm/versions/node`,  // won't match exactly but covers some cases
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
  ];
  const currentPath = process.env.PATH || '';
  const missing = extraPaths.filter((p) => !currentPath.includes(p));
  if (missing.length > 0) {
    process.env.PATH = [...missing, currentPath].join(':');
    console.log('[fix-path] PATH augmented with fallback dirs:', process.env.PATH);
  }
}

function fixPathWin32(): void {
  const home = os.homedir();
  const appData = process.env.APPDATA || `${home}\\AppData\\Roaming`;
  const localAppData = process.env.LOCALAPPDATA || `${home}\\AppData\\Local`;

  // Common CLI install locations on Windows
  const extraPaths = [
    `${appData}\\npm`,
    `${localAppData}\\pnpm`,
    `${home}\\.cargo\\bin`,
  ];
  const currentPath = process.env.PATH || '';
  const missing = extraPaths.filter((p) => !currentPath.includes(p));
  if (missing.length > 0) {
    process.env.PATH = [...missing, currentPath].join(';');
    console.log('[fix-path] PATH augmented with Windows fallback dirs:', process.env.PATH);
  }
}
