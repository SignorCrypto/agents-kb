import { ClaudeSession, ClaudeSessionOptions } from './claude-session';

class SessionManager {
  private sessions = new Map<string, ClaudeSession>();

  create(options: ClaudeSessionOptions): ClaudeSession {
    // Kill existing session for this job if any
    this.kill(options.jobId);

    const session = new ClaudeSession(options);
    this.sessions.set(options.jobId, session);

    session.on('close', () => {
      this.sessions.delete(options.jobId);
    });

    return session;
  }

  get(jobId: string): ClaudeSession | undefined {
    return this.sessions.get(jobId);
  }

  kill(jobId: string): void {
    const session = this.sessions.get(jobId);
    if (session) {
      session.kill();
      this.sessions.delete(jobId);
    }
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.kill();
    }
    this.sessions.clear();
  }

  get activeCount(): number {
    return this.sessions.size;
  }
}

export const sessionManager = new SessionManager();
