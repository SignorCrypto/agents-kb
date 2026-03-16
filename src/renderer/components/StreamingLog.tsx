import { useEffect, useRef, useMemo, useState } from 'react';
import type { OutputSection } from '../hooks/useJobOutput';
import { PlanMarkdown } from './PlanMarkdown';

interface StreamingLogProps {
  sections: OutputSection[];
  entryCount: number;
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

function ToolSection({ section }: { section: OutputSection }) {
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

export function StreamingLog({ sections, entryCount }: StreamingLogProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
  }, [entryCount]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0 bg-surface-terminal rounded-lg p-3 font-mono text-xs leading-relaxed">
      {entryCount === 0 && (
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
        if (section.kind === 'rate-limit') {
          return (
            <div key={key} className="flex items-center gap-1.5 text-semantic-warning whitespace-pre-wrap break-words my-1 px-2 py-1 rounded bg-semantic-warning/10 border border-semantic-warning/20 text-[11px]">
              <span className="shrink-0">&#9888;</span>
              {section.content}
            </div>
          );
        }
        if (section.kind === 'progress') {
          return (
            <div key={key} className="text-terminal-text-muted/50 whitespace-pre-wrap break-words my-0.5 text-[10px] italic">
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
