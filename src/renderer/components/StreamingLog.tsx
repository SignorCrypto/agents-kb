import { useEffect, useRef, useMemo, useState } from 'react';
import type { OutputEntry } from '../types/index';

interface StreamingLogProps {
  entries: OutputEntry[];
}

interface Section {
  kind: 'text' | 'thinking' | 'tool' | 'system' | 'error' | 'plan';
  content: string;
  toolName?: string;
  timestamp: string;
}

function tryParseToolJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  // Try parsing directly
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }
  // Try finding JSON start (old PTY output may have prefix text)
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart > 0) {
    try {
      return JSON.parse(trimmed.slice(jsonStart));
    } catch { /* not parseable */ }
  }
  return null;
}

function buildSections(entries: OutputEntry[]): Section[] {
  const sections: Section[] = [];

  for (const entry of entries) {
    const last = sections[sections.length - 1];

    if (entry.type === 'plan') {
      sections.push({ kind: 'plan', content: entry.content, timestamp: entry.timestamp });
    } else if (entry.type === 'tool-use') {
      if (entry.toolName && entry.content === '') {
        // content_block_start marker — start new tool section
        sections.push({ kind: 'tool', content: '', toolName: entry.toolName, timestamp: entry.timestamp });
      } else if (last?.kind === 'tool' && !entry.toolName) {
        // Delta without toolName — append to current tool section
        last.content += entry.content;
      } else if (last?.kind === 'tool' && entry.toolName && entry.toolName === last.toolName) {
        // Delta with same toolName — append to current tool section (old logs)
        last.content += entry.content;
      } else if (entry.toolName && entry.content) {
        // Full tool-use with name and content — new section
        sections.push({ kind: 'tool', content: entry.content, toolName: entry.toolName, timestamp: entry.timestamp });
      } else if (last?.kind === 'tool') {
        // Fallback: append to current tool
        last.content += entry.content;
      } else {
        sections.push({ kind: 'tool', content: entry.content, timestamp: entry.timestamp });
      }
    } else if (entry.type === 'tool-result') {
      // Append result to last tool section if exists
      if (last?.kind === 'tool') {
        last.content += '\n--- result ---\n' + entry.content;
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
      // system
      if (last?.kind === 'system') {
        last.content += entry.content;
      } else {
        sections.push({ kind: 'system', content: entry.content, timestamp: entry.timestamp });
      }
    }
  }

  // Post-process: extract plans and suppress ExitPlanMode (retroactive for old logs)
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
    return s;
  }).filter((s): s is Section => s !== null);

  return processed;
}

function ToolSection({ section }: { section: Section }) {
  const [expanded, setExpanded] = useState(false);

  // Try to extract a short summary from the JSON content
  let summary = '';
  const content = section.content.trim();
  if (content) {
    try {
      const parsed = JSON.parse(content);
      // Common tool patterns
      if (parsed.command) summary = parsed.command;
      else if (parsed.file_path) summary = parsed.file_path;
      else if (parsed.pattern) summary = parsed.pattern;
      else if (parsed.query) summary = parsed.query;
      else if (parsed.path) summary = parsed.path;
      else if (parsed.url) summary = parsed.url;
      else if (parsed.prompt) summary = parsed.prompt.slice(0, 80);
    } catch {
      // Not complete JSON yet, show first line
      summary = content.split('\n')[0].slice(0, 80);
    }
  }

  return (
    <div className="my-1 rounded border border-neutral-800 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-neutral-800/50 transition-colors"
      >
        <span className="text-tool-icon text-[10px] shrink-0">{expanded ? '▼' : '▶'}</span>
        <span className="text-tool-label font-semibold text-[11px] shrink-0">
          {section.toolName || 'Tool'}
        </span>
        {summary && (
          <span className="text-neutral-500 text-[10px] truncate">{summary}</span>
        )}
      </button>
      {expanded && content && (
        <div className="px-3 py-2 text-neutral-400 text-[11px] whitespace-pre-wrap break-words border-t border-neutral-800 bg-neutral-900/50 max-h-80 overflow-y-auto">
          {content}
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
        className="w-full flex items-start gap-2 px-2 py-1 text-left hover:bg-neutral-800/30 rounded transition-colors"
      >
        <span className="text-neutral-500 text-[10px] shrink-0 mt-0.5">{expanded ? '▼' : '▶'}</span>
        <span className="text-neutral-400/70 text-[11px]">
          {expanded ? content : preview + (content.length > 150 ? '...' : '')}
        </span>
      </button>
    </div>
  );
}

function PlanSection({ content }: { content: string }) {
  const rendered = content.split('\n').map((line, i) => {
    if (line.startsWith('### ')) {
      return <div key={i} className="text-sm font-semibold text-neutral-200 mt-3 mb-1">{line.slice(4)}</div>;
    }
    if (line.startsWith('## ')) {
      return <div key={i} className="text-sm font-bold text-neutral-100 mt-4 mb-1">{line.slice(3)}</div>;
    }
    if (line.startsWith('# ')) {
      return <div key={i} className="text-base font-bold text-white mt-4 mb-2">{line.slice(2)}</div>;
    }
    if (line.match(/^\s*[-*]\s/)) {
      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      return (
        <div key={i} className="text-neutral-300" style={{ paddingLeft: `${indent * 4 + 8}px` }}>
          <span className="text-semantic-success mr-1">•</span>
          {line.replace(/^\s*[-*]\s/, '')}
        </div>
      );
    }
    if (line.match(/^\s*\d+\.\s/)) {
      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      const num = line.match(/(\d+)\./)?.[1];
      return (
        <div key={i} className="text-neutral-300" style={{ paddingLeft: `${indent * 4 + 8}px` }}>
          <span className="text-semantic-success mr-1">{num}.</span>
          {line.replace(/^\s*\d+\.\s/, '')}
        </div>
      );
    }
    if (line.startsWith('```')) {
      return <div key={i} className="text-neutral-500 text-[10px]">{line}</div>;
    }
    if (!line.trim()) {
      return <div key={i} className="h-2" />;
    }
    return <div key={i} className="text-neutral-300">{line}</div>;
  });

  return (
    <div className="my-2 rounded-lg border border-semantic-success-border/30 bg-semantic-success-bg/10 p-3 text-xs leading-relaxed">
      <div className="text-semantic-success text-[10px] font-semibold uppercase tracking-wider mb-2">Plan</div>
      {rendered}
    </div>
  );
}

const VISIBLE_SECTIONS = 100;

export function StreamingLog({ entries }: StreamingLogProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => buildSections(entries), [entries]);
  const [showAll, setShowAll] = useState(false);

  const hiddenCount = showAll ? 0 : Math.max(0, sections.length - VISIBLE_SECTIONS);
  const visibleSections = showAll ? sections : sections.slice(hiddenCount);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [entries.length]);

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-surface-terminal rounded-lg p-3 font-mono text-xs leading-relaxed">
      {entries.length === 0 && (
        <div className="text-neutral-600 text-center py-8">
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
            <div key={key} className="text-neutral-500/60 whitespace-pre-wrap break-words my-0.5 text-[10px]">
              {section.content}
            </div>
          );
        }
        return (
          <div key={key} className="text-neutral-200 whitespace-pre-wrap break-words my-2 leading-relaxed">
            {section.content}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
