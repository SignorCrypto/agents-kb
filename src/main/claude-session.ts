import * as nodePty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { OutputEntry, PendingQuestion, QuestionOption, PermissionMode } from '../shared/types';

export type SessionPhase = 'plan' | 'dev';

export interface ClaudeSessionOptions {
  jobId: string;
  projectPath: string;
  prompt: string;
  phase: SessionPhase;
  sessionId?: string; // for resuming
  images?: string[];
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
}

export class ClaudeSession extends EventEmitter {
  readonly jobId: string;
  sessionId: string;
  private pty: nodePty.IPty | null = null;
  private buffer = '';
  private killed = false;
  private hasStderrContent = false;
  private currentToolName = '';
  private currentToolBuffer = '';
  private planEmitted = false;
  private assistantTextBuffer = '';
  private isAskingQuestion = false;
  private pendingPlanFileRead = '';

  constructor(private options: ClaudeSessionOptions) {
    super();
    this.jobId = options.jobId;
    this.sessionId = options.sessionId || uuidv4();
  }

  start(): void {
    let prompt = this.options.prompt;
    if (this.options.images && this.options.images.length > 0) {
      const imageList = this.options.images.map(p => `- ${p}`).join('\n');
      prompt += `\n\nThe following image files are attached for reference. Please read and examine them:\n${imageList}`;
    }

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (this.options.effort && this.options.effort !== 'default') {
      args.push('--effort', this.options.effort);
    }

    if (this.options.model && this.options.model !== 'default') {
      args.push('--model', this.options.model);
    }

    if (this.options.phase === 'plan') {
      args.push('--permission-mode', 'default');
    } else if (this.options.permissionMode === 'default') {
      args.push('--permission-mode', 'default');
    } else {
      args.push('--dangerously-skip-permissions');
    }

    if (this.options.sessionId) {
      args.push('--resume', this.options.sessionId);
    }

    // Strip CLAUDECODE env var to avoid "nested session" error
    const env = { ...process.env };
    delete env.CLAUDECODE;

    console.log('[claude-session] Spawning via PTY:', 'claude', args.join(' '));
    console.log('[claude-session] CWD:', this.options.projectPath);

    this.pty = nodePty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd: this.options.projectPath,
      env: env as Record<string, string>,
    });

    console.log('[claude-session] PTY PID:', this.pty.pid);

    this.pty.onData((data: string) => {
      // Strip ANSI escape codes and carriage returns from PTY output
      const cleaned = data
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // ANSI escape sequences
        .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC sequences
        .replace(/\x1b[^[]\S/g, '')               // Other escape sequences
        .replace(/\r/g, '');                       // Carriage returns

      if (cleaned) {
        this.handleStdout(cleaned);
      }
    });

    this.pty.onExit(({ exitCode }) => {
      console.log('[claude-session] PTY exited with code:', exitCode);
      // Flush any remaining buffer content
      if (this.buffer.trim()) {
        try {
          const msg = JSON.parse(this.buffer.trim());
          this.emit('raw-message', { timestamp: new Date().toISOString(), json: msg });
          this.handleMessage(msg);
        } catch {
          this.emit('output', {
            timestamp: new Date().toISOString(),
            type: 'system',
            content: this.buffer.trim(),
          } satisfies OutputEntry);
        }
        this.buffer = '';
      }
      if (!this.killed) {
        this.emit('close', exitCode);
      }
    });
  }

  private handleStdout(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for error lines (non-JSON errors from CLI)
      if (trimmed.startsWith('Error:') || trimmed.startsWith('error:')) {
        this.hasStderrContent = true;
        this.emit('error', trimmed);
        this.emit('output', {
          timestamp: new Date().toISOString(),
          type: 'error',
          content: trimmed,
        } satisfies OutputEntry);
        continue;
      }

      try {
        const msg = JSON.parse(trimmed);
        this.emit('raw-message', {
          timestamp: new Date().toISOString(),
          json: msg,
        });
        this.handleMessage(msg);
      } catch {
        // Non-JSON output — could be error text or other CLI output
        console.log('[claude-session] Non-JSON line:', trimmed.slice(0, 200));
        this.emit('output', {
          timestamp: new Date().toISOString(),
          type: 'text',
          content: trimmed,
        } satisfies OutputEntry);
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    switch (type) {
      case 'stream_event': {
        const event = msg.event as Record<string, unknown>;
        if (!event) break;
        this.handleStreamEvent(event);
        break;
      }

      case 'assistant': {
        // Complete assistant message — tool-use blocks already streamed via deltas, skip duplicates
        break;
      }

      case 'result': {
        const subtype = msg.subtype as string;
        const result = (msg.result as string) || '';
        if (subtype === 'success') {
          if (result && !this.planEmitted) {
            // Check if result looks like actual plan text (not JSON from ExitPlanMode)
            const trimmedResult = result.trim();
            if (trimmedResult.startsWith('{') || trimmedResult.startsWith('[')) {
              // This is JSON (likely ExitPlanMode's allowedPrompts), not the plan
              // Don't emit as plan
            } else {
              this.planEmitted = true;
              this.emit('output', {
                timestamp: new Date().toISOString(),
                type: 'plan',
                content: result,
              } satisfies OutputEntry);
              this.emit('plan-text', result);
            }
          }
          // If no plan was explicitly captured, use accumulated assistant text as the plan
          if (!this.planEmitted && this.assistantTextBuffer.trim()) {
            this.planEmitted = true;
            this.emit('output', {
              timestamp: new Date().toISOString(),
              type: 'plan',
              content: this.assistantTextBuffer.trim(),
            } satisfies OutputEntry);
            this.emit('plan-text', this.assistantTextBuffer.trim());
          }
          // For dev phase, emit the result (or accumulated text) as a summary
          if (this.options.phase === 'dev') {
            const summary = result?.trim() || this.assistantTextBuffer.trim();
            if (summary) {
              this.emit('summary-text', summary);
            }
          }
          this.emit('plan-complete');
        } else if (subtype?.startsWith('error')) {
          if (result) {
            this.emit('output', {
              timestamp: new Date().toISOString(),
              type: 'error',
              content: result,
            } satisfies OutputEntry);
          }
          this.emit('error', result || `Session ended with: ${subtype}`);
        }
        break;
      }

      case 'system': {
        // Capture session ID from init message
        if (msg.subtype === 'init' && msg.session_id) {
          this.sessionId = msg.session_id as string;
          this.emit('session-id', this.sessionId);
        }
        const content = this.formatSystemMessage(msg);
        if (content) {
          this.emit('output', {
            timestamp: new Date().toISOString(),
            type: 'system',
            content,
          } satisfies OutputEntry);
        }
        break;
      }

      case 'user': {
        // Read the full plan file from disk after an Edit tool modified it
        if (this.pendingPlanFileRead) {
          const planPath = this.pendingPlanFileRead;
          this.pendingPlanFileRead = '';
          try {
            const planContent = fs.readFileSync(planPath, 'utf-8');
            if (planContent.trim()) {
              this.planEmitted = true;
              this.emit('output', {
                timestamp: new Date().toISOString(),
                type: 'plan',
                content: planContent,
              } satisfies OutputEntry);
              this.emit('plan-text', planContent);
            }
          } catch (err) {
            console.log('[claude-session] Failed to read edited plan file:', planPath, err);
          }
        }

        // Tool results come back as user messages containing tool_result content blocks
        const content = msg.content as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              const resultContent = block.content;
              if (!resultContent) continue;
              let text: string;
              if (typeof resultContent === 'string') {
                text = resultContent;
              } else if (Array.isArray(resultContent)) {
                // Content blocks array — extract text from text blocks
                text = (resultContent as Array<Record<string, unknown>>)
                  .filter((b) => b.type === 'text' && b.text)
                  .map((b) => b.text as string)
                  .join('\n');
                if (!text) text = JSON.stringify(resultContent);
              } else {
                text = JSON.stringify(resultContent);
              }
              if (text) {
                this.emit('output', {
                  timestamp: new Date().toISOString(),
                  type: 'tool-result',
                  content: text,
                } satisfies OutputEntry);
              }
            }
          }
        }
        break;
      }

      case 'input_request': {
        // CLI may emit input_request when waiting for user input
        const questionText = (msg.question as string) || (msg.message as string) || 'Claude is waiting for input';
        let options: QuestionOption[] | undefined;
        if (Array.isArray(msg.options)) {
          options = (msg.options as Array<unknown>).map((opt) => {
            if (typeof opt === 'string') return { label: opt };
            const o = opt as Record<string, unknown>;
            return { label: (o.label as string) || String(opt), description: o.description as string | undefined };
          });
        }
        this.emit('needs-input', {
          questionId: (msg.request_id as string) || uuidv4(),
          text: questionText,
          options,
          timestamp: new Date().toISOString(),
        } satisfies PendingQuestion);
        break;
      }

      default: {
        // Unknown top-level type — extract readable content instead of raw JSON dump
        const readable = this.extractReadableContent(msg);
        if (readable) {
          this.emit('output', {
            timestamp: new Date().toISOString(),
            type: 'system',
            content: readable,
          } satisfies OutputEntry);
        }
      }
    }
  }

  private handleStreamEvent(event: Record<string, unknown>): void {
    const eventType = event.type as string;

    switch (eventType) {
      case 'message_start': {
        const message = event.message as { model?: string; usage?: Record<string, number> } | undefined;
        if (message?.model) {
          console.log('[claude-session] Model:', message.model);
        }
        break;
      }

      case 'message_delta': {
        const delta = event.delta as { stop_reason?: string } | undefined;
        const usage = event.usage as { output_tokens?: number } | undefined;
        if (delta?.stop_reason === 'max_tokens') {
          this.emit('output', {
            timestamp: new Date().toISOString(),
            type: 'system',
            content: 'Warning: response was truncated (max_tokens reached)',
          } satisfies OutputEntry);
        }
        if (usage?.output_tokens) {
          console.log('[claude-session] Output tokens:', usage.output_tokens);
        }
        break;
      }

      case 'content_block_start': {
        const block = event.content_block as { type: string; name?: string };
        if (block?.type === 'tool_use' && block.name) {
          this.currentToolName = block.name;
          this.currentToolBuffer = '';
          this.isAskingQuestion = block.name === 'AskUserQuestion';

          // Suppress ExitPlanMode and AskUserQuestion from tool output
          if (!block.name.includes('ExitPlanMode') && block.name !== 'AskUserQuestion') {
            this.emit('output', {
              timestamp: new Date().toISOString(),
              type: 'tool-use',
              content: '',
              toolName: block.name,
            } satisfies OutputEntry);
          }
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta as { type: string; text?: string; thinking?: string; partial_json?: string };
        if (!delta) break;

        if (delta.type === 'text_delta' && delta.text) {
          this.assistantTextBuffer += delta.text;
          this.emit('output', {
            timestamp: new Date().toISOString(),
            type: 'text',
            content: delta.text,
          } satisfies OutputEntry);
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          this.emit('output', {
            timestamp: new Date().toISOString(),
            type: 'thinking',
            content: delta.thinking,
          } satisfies OutputEntry);
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          // Always buffer the tool input for plan detection and question parsing on block_stop
          this.currentToolBuffer += delta.partial_json;

          if (this.currentToolName.includes('ExitPlanMode') || this.isAskingQuestion) {
            // Suppress ExitPlanMode and AskUserQuestion deltas from tool output
          } else {
            // Emit delta WITHOUT toolName — the content_block_start already created the section
            this.emit('output', {
              timestamp: new Date().toISOString(),
              type: 'tool-use',
              content: delta.partial_json,
            } satisfies OutputEntry);
          }
        }
        break;
      }

      case 'content_block_stop': {
        if (this.currentToolName && this.currentToolBuffer) {
          try {
            const input = JSON.parse(this.currentToolBuffer) as Record<string, unknown>;
            this.emit('tool-call', {
              name: this.currentToolName,
              input,
            });
          } catch {
            // Ignore incomplete tool JSON
          }
        }

        // Check if Claude is asking a question via AskUserQuestion tool
        if (this.isAskingQuestion && this.currentToolBuffer) {
          try {
            const input = JSON.parse(this.currentToolBuffer);
            this.emitQuestion(input);
          } catch {
            // Fallback: use raw buffer as question text
            this.emit('needs-input', {
              questionId: uuidv4(),
              text: this.currentToolBuffer,
              timestamp: new Date().toISOString(),
            } satisfies PendingQuestion);
          }
          this.isAskingQuestion = false;
        }

        // Check if this tool wrote the plan file
        if (this.currentToolName === 'Write' && this.currentToolBuffer) {
          try {
            const input = JSON.parse(this.currentToolBuffer);
            if (input.file_path && input.file_path.includes('.claude/plans/') && input.content) {
              this.planEmitted = true;
              this.emit('output', {
                timestamp: new Date().toISOString(),
                type: 'plan',
                content: input.content,
              } satisfies OutputEntry);
              this.emit('plan-text', input.content);
            }
          } catch {
            // JSON not complete, ignore
          }
        }

        // Check if this tool edited the plan file — schedule a file read on next tool result
        if (this.currentToolName === 'Edit' && this.currentToolBuffer) {
          try {
            const input = JSON.parse(this.currentToolBuffer);
            if (input.file_path && input.file_path.includes('.claude/plans/')) {
              const filePath = path.isAbsolute(input.file_path)
                ? input.file_path
                : path.join(this.options.projectPath, input.file_path);
              this.pendingPlanFileRead = filePath;
            }
          } catch {
            // JSON not complete, ignore
          }
        }

        this.currentToolBuffer = '';
        this.currentToolName = '';
        break;
      }

      default:
        break;
    }
  }

  /**
   * Format a system message into a human-readable string.
   * Returns empty string to suppress the message entirely.
   */
  private formatSystemMessage(msg: Record<string, unknown>): string {
    const subtype = msg.subtype as string | undefined;

    switch (subtype) {
      case 'init':
        return `Session started (${msg.session_id})`;

      case 'task_started': {
        const description = msg.description as string | undefined;
        const taskType = msg.task_type as string | undefined;
        const label = taskType === 'local_agent' ? 'Subagent' : (taskType || 'Task');
        return description ? `${label} started: ${description}` : `${label} started`;
      }

      case 'task_progress': {
        const description = msg.description as string | undefined;
        const toolName = msg.last_tool_name as string | undefined;
        if (description) {
          return toolName ? `[${toolName}] ${description}` : description;
        }
        return '';
      }

      case 'task_notification': {
        const status = msg.status as string || 'unknown';
        const summary = msg.summary as string || '';
        const usage = msg.usage as { total_tokens?: number; tool_uses?: number; duration_ms?: number } | undefined;
        const parts = [summary ? `Task ${status}: ${summary}` : `Task ${status}`];
        if (usage) {
          const details: string[] = [];
          if (usage.tool_uses != null) details.push(`${usage.tool_uses} tool uses`);
          if (usage.duration_ms != null) details.push(`${(usage.duration_ms / 1000).toFixed(1)}s`);
          if (usage.total_tokens != null) details.push(`${usage.total_tokens.toLocaleString()} tokens`);
          if (details.length > 0) parts.push(`(${details.join(', ')})`);
        }
        return parts.join(' ');
      }

      case 'task_completed': {
        const description = msg.description as string | undefined;
        return description ? `Task completed: ${description}` : 'Task completed';
      }

      case 'api_request': {
        // Internal API request telemetry — suppress from logs
        return '';
      }

      default: {
        // Fallback: use explicit message field if present, otherwise build from known fields
        if (msg.message && typeof msg.message === 'string') {
          return msg.message;
        }
        // Extract only meaningful fields for display, skip internal IDs / raw data
        return this.extractReadableContent(msg);
      }
    }
  }

  /**
   * Extract a human-readable summary from an arbitrary message object.
   * Prioritizes display-friendly fields and suppresses internal/noisy ones.
   */
  private extractReadableContent(msg: Record<string, unknown>): string {
    // Fields that carry user-meaningful information
    const readableKeys = ['description', 'summary', 'message', 'status', 'error', 'reason', 'text', 'name', 'title'];
    // Fields that are internal/noisy and should never be shown
    const suppressKeys = new Set([
      'type', 'subtype', 'task_id', 'tool_use_id', 'uuid', 'session_id',
      'prompt', 'content', 'usage', 'task_type',
    ]);

    // Try to build from readable fields first
    const parts: string[] = [];
    for (const key of readableKeys) {
      const val = msg[key];
      if (val && typeof val === 'string') {
        parts.push(val);
      }
    }
    if (parts.length > 0) return parts.join(' — ');

    // Last resort: show remaining non-suppressed scalar fields
    const remaining: string[] = [];
    for (const [key, val] of Object.entries(msg)) {
      if (suppressKeys.has(key)) continue;
      if (val == null || typeof val === 'object') continue;
      remaining.push(`${key}: ${String(val)}`);
    }
    return remaining.length > 0 ? remaining.join(', ') : '';
  }

  private emitQuestion(input: Record<string, unknown>): void {
    // Handle structured questions format: {questions: [{question, header, options: [{label, description}], multiSelect}]}
    if (Array.isArray(input.questions) && input.questions.length > 0) {
      const q = input.questions[0] as Record<string, unknown>;
      const questionText = (q.question as string) || (q.text as string) || '';
      const header = q.header as string | undefined;
      const multiSelect = q.multiSelect as boolean | undefined;

      let options: QuestionOption[] | undefined;
      if (Array.isArray(q.options)) {
        options = (q.options as Array<Record<string, unknown>>).map((opt) => {
          if (typeof opt === 'string') return { label: opt };
          return {
            label: (opt.label as string) || String(opt),
            description: opt.description as string | undefined,
          };
        });
      }

      this.emit('needs-input', {
        questionId: uuidv4(),
        text: questionText,
        header,
        options,
        multiSelect,
        timestamp: new Date().toISOString(),
      } satisfies PendingQuestion);
    } else {
      // Flat format: {question: "...", options: [...]}
      const questionText = (input.question as string) || (input.text as string) || JSON.stringify(input);
      let options: QuestionOption[] | undefined;
      if (Array.isArray(input.options)) {
        options = (input.options as Array<unknown>).map((opt) => {
          if (typeof opt === 'string') return { label: opt };
          const o = opt as Record<string, unknown>;
          return {
            label: (o.label as string) || String(opt),
            description: o.description as string | undefined,
          };
        });
      }

      this.emit('needs-input', {
        questionId: uuidv4(),
        text: questionText,
        options,
        timestamp: new Date().toISOString(),
      } satisfies PendingQuestion);
    }
  }

  sendResponse(text: string): void {
    if (this.pty) {
      this.pty.write(text + '\n');
    }
  }

  interrupt(): void {
    if (this.pty) {
      this.pty.write('\x1b'); // Escape to interrupt current generation
    }
  }

  kill(): void {
    this.killed = true;
    if (this.pty) {
      this.pty.kill();
    }
  }

  get isRunning(): boolean {
    return this.pty !== null && !this.killed;
  }
}
