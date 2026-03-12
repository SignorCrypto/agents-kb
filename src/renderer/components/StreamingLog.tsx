import { useEffect, useRef, useMemo, useState } from 'react';
import type { OutputEntry } from '../types/index';
import { PlanMarkdown } from './PlanMarkdown';

interface StreamingLogProps {
  entries: OutputEntry[];
}

interface Section {
  kind: 'text' | 'thinking' | 'tool' | 'system' | 'error' | 'plan';
  content: string;
  toolName?: string;
  toolResult?: string;
  isStreaming?: boolean;
  timestamp: string;
}

function tryParseToolJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart > 0) {
    try {
      return JSON.parse(trimmed.slice(jsonStart));
    } catch { /* not parseable */ }
  }
  const keyStart = trimmed.search(/"[A-Za-z0-9_-]+"\s*:/);
  if (keyStart >= 0) {
    const jsonBody = trimmed.slice(keyStart).replace(/,\s*$/, '');
    try {
      return JSON.parse(`{${jsonBody}`);
    } catch { /* not parseable */ }
    try {
      return JSON.parse(`{${jsonBody}}`);
    } catch { /* not parseable */ }
  }
  return null;
}

function extractJsonStringField(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's'));
  if (!match) return undefined;

  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

function inferToolName(parsed: Record<string, unknown> | null, content: string): string | undefined {
  if (parsed) {
    if (parsed.command) return 'Bash';
    if (parsed.todos) return 'TodoWrite';
    if (parsed.url) return 'WebFetch';
    if (parsed.query) return 'WebSearch';
    if (parsed.prompt) return 'Agent';
    if (parsed.notebook_path) return 'NotebookEdit';
    if (parsed.old_string !== undefined) return 'Edit';
    if (parsed.file_path && parsed.content !== undefined) return 'Write';
    if (parsed.file_path) return 'Read';
    if (parsed.pattern && parsed.path) return 'Grep';
    if (parsed.pattern) return 'Glob';
  }

  if (/"command"\s*:/.test(content)) return 'Bash';
  if (/"todos"\s*:/.test(content)) return 'TodoWrite';
  if (/"url"\s*:/.test(content)) return 'WebFetch';
  if (/"query"\s*:/.test(content)) return 'WebSearch';
  if (/"prompt"\s*:/.test(content)) return 'Agent';
  if (/"notebook_path"\s*:/.test(content)) return 'NotebookEdit';
  if (/"old_string"\s*:/.test(content)) return 'Edit';
  if (/"file_path"\s*:/.test(content) && /"content"\s*:/.test(content)) return 'Write';
  if (/"file_path"\s*:/.test(content)) return 'Read';
  if (/"pattern"\s*:/.test(content) && /"path"\s*:/.test(content)) return 'Grep';
  if (/"pattern"\s*:/.test(content)) return 'Glob';

  return undefined;
}

function buildSections(entries: OutputEntry[]): Section[] {
  const sections: Section[] = [];

  for (const entry of entries) {
    const last = sections[sections.length - 1];
    if (last?.kind === 'tool' && entry.type !== 'tool-use' && last.isStreaming) {
      last.isStreaming = false;
    }

    if (entry.type === 'plan') {
      sections.push({ kind: 'plan', content: entry.content, timestamp: entry.timestamp });
    } else if (entry.type === 'tool-use') {
      if (entry.toolName && entry.content === '') {
        // content_block_start marker — start new tool section
        sections.push({ kind: 'tool', content: '', toolName: entry.toolName, isStreaming: true, timestamp: entry.timestamp });
      } else if (last?.kind === 'tool' && !entry.toolName) {
        // Delta without toolName — append to current tool section
        last.content += entry.content;
        last.isStreaming = true;
      } else if (last?.kind === 'tool' && entry.toolName && entry.toolName === last.toolName) {
        // Delta with same toolName — append to current tool section (old logs)
        last.content += entry.content;
        last.isStreaming = true;
      } else if (entry.toolName && entry.content) {
        // Full tool-use with name and content — new section
        sections.push({ kind: 'tool', content: entry.content, toolName: entry.toolName, isStreaming: true, timestamp: entry.timestamp });
      } else if (last?.kind === 'tool') {
        // Fallback: append to current tool
        last.content += entry.content;
        last.isStreaming = true;
      } else {
        sections.push({ kind: 'tool', content: entry.content, isStreaming: true, timestamp: entry.timestamp });
      }
    } else if (entry.type === 'tool-result') {
      // Append result to last tool section as separate field
      if (last?.kind === 'tool') {
        last.toolResult = (last.toolResult ? last.toolResult + '\n' : '') + entry.content;
        last.isStreaming = false;
      } else {
        sections.push({ kind: 'system', content: entry.content, timestamp: entry.timestamp });
      }
    } else if (entry.type === 'text') {
      if (last?.kind === 'text') {
        last.content += entry.content;
      } else {
        sections.push({ kind: 'text', content: entry.content, timestamp: entry.timestamp });
      }
    } else if (entry.type === 'thinking') {
      if (last?.kind === 'thinking') {
        last.content += entry.content;
      } else {
        sections.push({ kind: 'thinking', content: entry.content, timestamp: entry.timestamp });
      }
    } else if (entry.type === 'error') {
      sections.push({ kind: 'error', content: entry.content, timestamp: entry.timestamp });
    } else {
      // system — each entry gets its own section (don't concatenate)
      sections.push({ kind: 'system', content: entry.content, timestamp: entry.timestamp });
    }
  }

  // Post-process: extract plans, suppress noise, filter empty
  const processed = sections.map((s) => {
    // Detect Write tool writing to .claude/plans/ — extract content as plan
    if (s.kind === 'tool' && s.toolName === 'Write' && s.content) {
      try {
        const parsed = tryParseToolJson(s.content);
        const filePath = parsed?.file_path as string | undefined;
        const fileContent = parsed?.content as string | undefined;
        if (filePath?.includes('.claude/plans/') && fileContent) {
          return { ...s, kind: 'plan' as const, content: fileContent };
        }
      } catch { /* not parseable */ }
    }
    // Suppress ExitPlanMode — it only has allowedPrompts, not the plan
    if (s.kind === 'tool' && s.toolName?.includes('ExitPlanMode')) {
      return null;
    }
    // Suppress plan sections that are just JSON (old result.result with allowedPrompts)
    if (s.kind === 'plan' && s.content.trim().startsWith('{')) {
      return null;
    }
    // Filter empty tool sections (no input, no result, no name of value)
    if (s.kind === 'tool' && !s.content.trim() && !s.toolResult?.trim()) {
      return null;
    }
    return s;
  }).filter((s): s is Section => s !== null);

  return processed;
}

/** Try to parse tool input JSON and extract a readable summary + formatted params */
function parseToolInput(content: string): {
  parsed: Record<string, unknown> | null;
  summary: string;
  inferredToolName?: string;
} {
  const trimmed = content.trim();
  if (!trimmed) return { parsed: null, summary: '' };

  const parsed = tryParseToolJson(trimmed);
  const inferredToolName = inferToolName(parsed, trimmed);
  if (!parsed) {
    const fallbackSummary = (
      extractJsonStringField(trimmed, 'command')
      ?? extractJsonStringField(trimmed, 'file_path')
      ?? extractJsonStringField(trimmed, 'pattern')
      ?? extractJsonStringField(trimmed, 'query')
      ?? extractJsonStringField(trimmed, 'path')
      ?? extractJsonStringField(trimmed, 'url')
      ?? extractJsonStringField(trimmed, 'prompt')
      ?? extractJsonStringField(trimmed, 'regex')
    );

    if (fallbackSummary) {
      return { parsed: null, summary: fallbackSummary.slice(0, 100), inferredToolName };
    }

    const firstLine = trimmed
      .split('\n')
      .find((line) => line.trim())
      ?.replace(/^[\s,{[]+/, '')
      .slice(0, 100) ?? '';
    return { parsed: null, summary: firstLine, inferredToolName };
  }

  // Extract a short summary from common tool patterns
  let summary = '';
  if (parsed.command) summary = String(parsed.command);
  else if (parsed.file_path) summary = String(parsed.file_path);
  else if (parsed.pattern) summary = String(parsed.pattern);
  else if (parsed.query) summary = String(parsed.query).slice(0, 100);
  else if (parsed.path) summary = String(parsed.path);
  else if (parsed.url) summary = String(parsed.url);
  else if (parsed.prompt) summary = String(parsed.prompt).slice(0, 100);
  else if (parsed.regex) summary = String(parsed.regex);
  else if (parsed.old_string) summary = 'edit';
  else if (parsed.content && parsed.file_path) summary = String(parsed.file_path);

  return { parsed, summary, inferredToolName };
}

/** Format parsed JSON as readable key-value lines for tool input display */
function formatToolParams(parsed: Record<string, unknown>): { key: string; value: string; long: boolean }[] {
  const params: { key: string; value: string; long: boolean }[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || value === null || value === '') continue;
    const strValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const isLong = strValue.length > 120 || strValue.includes('\n');
    params.push({ key, value: strValue, long: isLong });
  }
  return params;
}

/** Shorten a file path for display */
function shortenPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 4) return p;
  return '.../' + parts.slice(-3).join('/');
}

function ToolSection({ section }: { section: Section }) {
  const [expanded, setExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);

  const { parsed, summary, inferredToolName } = useMemo(() => parseToolInput(section.content), [section.content]);
  const params = useMemo(() => parsed ? formatToolParams(parsed) : null, [parsed]);
  const hasResult = !!section.toolResult?.trim();
  const resultPreview = useMemo(() => {
    if (!hasResult) return '';
    const r = section.toolResult!.trim();
    // Truncate long results for preview
    const firstLine = r.split('\n')[0];
    return firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine;
  }, [section.toolResult, hasResult]);

  const displaySummary = summary ? shortenPath(summary) : '';
  const toolLabel = section.toolName || inferredToolName || 'Tool';
  const showInput = expanded || !!section.isStreaming;

  return (
    <div className="my-1 rounded border border-terminal-border overflow-hidden">
      {/* Tool header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-terminal-hover/50 transition-colors"
      >
        <span className="text-tool-icon text-[10px] shrink-0">{showInput ? '▼' : '▶'}</span>
        <span className="text-tool-label font-semibold text-[11px] shrink-0">
          {toolLabel}
        </span>
        {displaySummary && (
          <span className="text-terminal-text-muted text-[10px] truncate font-mono">{displaySummary}</span>
        )}
        {section.isStreaming && (
          <span
            className="ml-auto h-2 w-2 shrink-0 rounded-full border border-tool-label/40 border-t-tool-label animate-spin"
            aria-label={`${toolLabel} is running`}
          />
        )}
      </button>

      {/* Expanded tool input */}
      {showInput && (
        <div className="border-t border-terminal-border bg-terminal-surface/50">
          {params && params.length > 0 ? (
            <div className="px-3 py-2 space-y-1">
              {params.map(({ key, value, long }) => (
                <div key={key} className={long ? '' : 'flex items-baseline gap-2'}>
                  <span className="text-tool-label text-[10px] font-medium shrink-0">{key}:</span>
                  <span className={`text-terminal-text-secondary text-[11px] font-mono ${
                    long ? 'block mt-0.5 whitespace-pre-wrap break-words max-h-60 overflow-y-auto pl-2 border-l border-terminal-border/50' : 'truncate'
                  }`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          ) : section.content.trim() ? (
            <div className="px-3 py-2 text-terminal-text-secondary text-[11px] whitespace-pre-wrap break-words max-h-60 overflow-y-auto font-mono">
              {section.content.trim()}
            </div>
          ) : null}
        </div>
      )}

      {/* Tool result */}
      {hasResult && (
        <div className="border-t border-terminal-border/60">
          <button
            onClick={() => setResultExpanded(!resultExpanded)}
            className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-terminal-hover/30 transition-colors"
          >
            <span className="text-terminal-text-muted text-[10px] shrink-0">{resultExpanded ? '▼' : '▶'}</span>
            <span className="text-terminal-text-muted text-[10px] font-medium shrink-0">result</span>
            {!resultExpanded && resultPreview && (
              <span className="text-terminal-text-muted/60 text-[10px] truncate font-mono">{resultPreview}</span>
            )}
          </button>
          {resultExpanded && (
            <div className="px-3 py-2 text-terminal-text-secondary text-[11px] whitespace-pre-wrap break-words border-t border-terminal-border/40 bg-terminal-surface/30 max-h-80 overflow-y-auto font-mono">
              {section.toolResult!.trim()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingSection({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.slice(0, 150).replace(/\n/g, ' ');

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-2 px-2 py-1 text-left hover:bg-terminal-hover/30 rounded transition-colors"
      >
        <span className="text-terminal-text-muted text-[10px] shrink-0 mt-0.5">{expanded ? '▼' : '▶'}</span>
        <span className="text-terminal-text-secondary/70 text-[11px]">
          {expanded ? content : preview + (content.length > 150 ? '...' : '')}
        </span>
      </button>
    </div>
  );
}

function PlanSection({ content }: { content: string }) {
  return (
    <div className="my-2 rounded-lg border border-semantic-success-border/30 bg-semantic-success-bg/10 p-3 text-xs leading-relaxed">
      <div className="text-semantic-success text-[10px] font-semibold uppercase tracking-wider mb-2">Plan</div>
      <PlanMarkdown content={content} />
    </div>
  );
}

const VISIBLE_SECTIONS = 100;

export function StreamingLog({ entries }: StreamingLogProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => buildSections(entries), [entries]);
  const [showAll, setShowAll] = useState(false);
  const isNearBottomRef = useRef(true);

  const hiddenCount = showAll ? 0 : Math.max(0, sections.length - VISIBLE_SECTIONS);
  const visibleSections = showAll ? sections : sections.slice(hiddenCount);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [entries.length]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0 bg-surface-terminal rounded-lg p-3 font-mono text-xs leading-relaxed">
      {entries.length === 0 && (
        <div className="text-terminal-text-faint text-center py-8">
          Waiting for output...
        </div>
      )}
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-[10px] text-content-tertiary hover:text-content-secondary py-1 mb-2 transition-colors"
        >
          Show {hiddenCount} earlier section{hiddenCount !== 1 ? 's' : ''}
        </button>
      )}
      {visibleSections.map((section, i) => {
        const key = `${section.kind}-${section.timestamp}-${hiddenCount + i}`;
        if (section.kind === 'plan') {
          return <PlanSection key={key} content={section.content} />;
        }
        if (section.kind === 'tool') {
          return <ToolSection key={key} section={section} />;
        }
        if (section.kind === 'thinking') {
          return <ThinkingSection key={key} content={section.content} />;
        }
        if (section.kind === 'error') {
          return (
            <div key={key} className="text-semantic-error-light whitespace-pre-wrap break-words my-1 px-2 py-1 rounded bg-semantic-error-bg-dark/20">
              {section.content}
            </div>
          );
        }
        if (section.kind === 'system') {
          return (
            <div key={key} className="text-terminal-text-muted/60 whitespace-pre-wrap break-words my-0.5 text-[10px]">
              {section.content}
            </div>
          );
        }
        return (
          <div key={key} className="text-terminal-text whitespace-pre-wrap break-words my-2 leading-relaxed">
            {section.content}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
