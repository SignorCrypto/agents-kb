import { execFile } from 'child_process';
import { promisify } from 'util';
import * as nodePty from 'node-pty';
import type { CliHealthStatus } from '../shared/types';

const execFileAsync = promisify(execFile);

let loginPty: nodePty.IPty | null = null;

/**
 * Check if the Claude CLI is installed and the user is authenticated.
 * 1. Runs `claude --version` to verify installation.
 * 2. Runs `claude auth status` — exit 0 means logged in.
 */
export async function checkCliHealth(): Promise<CliHealthStatus> {
  // 1. Check installation
  let version: string | undefined;
  try {
    const { stdout } = await execFileAsync('claude', ['--version'], {
      timeout: 10_000,
      env: { ...process.env, PATH: process.env.PATH },
    });
    version = stdout.trim();
  } catch {
    return { installed: false, authenticated: false, error: 'Claude Code CLI is not installed or not in PATH.' };
  }

  // 2. Check authentication
  try {
    await execFileAsync('claude', ['auth', 'status'], {
      timeout: 10_000,
      env: { ...process.env, PATH: process.env.PATH },
    });
    return { installed: true, authenticated: true, version };
  } catch {
    return { installed: true, authenticated: false, version, error: 'Claude Code CLI is not logged in.' };
  }
}

/**
 * Spawn an interactive `claude login` session via node-pty.
 * Returns callbacks to write input and kill the process.
 */
export function spawnLogin(
  onData: (data: string) => void,
  onExit: (exitCode: number) => void,
): { write: (data: string) => void; kill: () => void } {
  // Kill any existing login session
  if (loginPty) {
    loginPty.kill();
    loginPty = null;
  }

  loginPty = nodePty.spawn('claude', ['login'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    env: { ...process.env, PATH: process.env.PATH } as Record<string, string>,
  });

  loginPty.onData((data) => onData(data));
  loginPty.onExit(({ exitCode }) => {
    loginPty = null;
    onExit(exitCode);
  });

  return {
    write: (data: string) => loginPty?.write(data),
    kill: () => {
      loginPty?.kill();
      loginPty = null;
    },
  };
}
