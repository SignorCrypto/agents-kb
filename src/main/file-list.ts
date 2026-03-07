import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', '.cache', '.turbo', 'coverage', '.output',
]);
const MAX_FILES = 5000;

async function gitListFiles(projectPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files'], {
    cwd: projectPath,
    timeout: 10000,
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim().split('\n').filter(Boolean);
}

async function walkDir(dir: string, root: string, results: string[]): Promise<void> {
  if (results.length >= MAX_FILES) return;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= MAX_FILES) return;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      await walkDir(path.join(dir, entry.name), root, results);
    } else {
      results.push(path.relative(root, path.join(dir, entry.name)));
    }
  }
}

async function fallbackListFiles(projectPath: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(projectPath, projectPath, results);
  return results;
}

export async function listProjectFiles(projectPath: string, isGitRepo: boolean): Promise<string[]> {
  if (isGitRepo) {
    try {
      return await gitListFiles(projectPath);
    } catch {
      // Fall back to readdir if git fails
    }
  }
  return fallbackListFiles(projectPath);
}
