import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';

interface TerminalInstance {
  pty: IPty;
  projectId: string;
}

class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();

  create(
    terminalId: string,
    cwd: string,
    projectId: string,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void,
  ): void {
    // Kill existing terminal with same ID if any
    this.kill(terminalId);

    const shell =
      process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || '/bin/zsh';

    const pty = nodePty.spawn(shell, [], {
      name: process.platform === 'win32' ? 'windows-terminal' : 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, PATH: process.env.PATH } as Record<string, string>,
    });

    this.terminals.set(terminalId, { pty, projectId });

    pty.onData((data) => onData(data));
    pty.onExit(({ exitCode }) => {
      this.terminals.delete(terminalId);
      onExit(exitCode);
    });
  }

  write(terminalId: string, data: string): void {
    this.terminals.get(terminalId)?.pty.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.terminals.get(terminalId)?.pty.resize(cols, rows);
  }

  kill(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (instance) {
      instance.pty.kill();
      this.terminals.delete(terminalId);
    }
  }

  killByProject(projectId: string): void {
    for (const [id, instance] of this.terminals) {
      if (instance.projectId === projectId) {
        instance.pty.kill();
        this.terminals.delete(id);
      }
    }
  }

  killAll(): void {
    for (const instance of this.terminals.values()) {
      instance.pty.kill();
    }
    this.terminals.clear();
  }

  has(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }
}

export const terminalManager = new TerminalManager();
