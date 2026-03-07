/**
 * Shared markdown-lite renderer for plan/summary content.
 * Handles headings, lists, fenced code blocks, inline code, and bold/italic.
 */

import { Fragment } from 'react';

/** Parse inline formatting: `code`, **bold**, *italic* */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Match: `code`, **bold**, *italic*
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      parts.push(
        <code key={match.index} className="bg-surface-tertiary/60 text-content-secondary px-1 py-0.5 rounded text-[11px]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**')) {
      parts.push(<strong key={match.index} className="font-semibold text-content-primary">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>;
}

export function PlanMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      // Skip closing ```
      if (i < lines.length) i++;

      elements.push(
        <div key={`code-${i}`} className="my-2 rounded border border-chrome-subtle/40 bg-surface-terminal overflow-x-auto">
          {lang && (
            <div className="px-2.5 py-1 text-[9px] font-semibold text-content-tertiary uppercase tracking-wider border-b border-chrome-subtle/30">
              {lang}
            </div>
          )}
          <pre className="px-3 py-2 text-[11px] text-content-secondary leading-relaxed whitespace-pre overflow-x-auto">
            {codeLines.join('\n')}
          </pre>
        </div>
      );
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(<div key={i} className="text-sm font-semibold text-content-primary mt-3 mb-1">{renderInline(line.slice(4))}</div>);
    } else if (line.startsWith('## ')) {
      elements.push(<div key={i} className="text-sm font-bold text-content-primary mt-4 mb-1">{renderInline(line.slice(3))}</div>);
    } else if (line.startsWith('# ')) {
      elements.push(<div key={i} className="text-base font-bold text-content-primary mt-4 mb-2">{renderInline(line.slice(2))}</div>);
    }
    // Unordered list
    else if (line.match(/^\s*[-*]\s/)) {
      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      elements.push(
        <div key={i} className="text-content-secondary" style={{ paddingLeft: `${indent * 4 + 8}px` }}>
          <span className="text-semantic-success mr-1">•</span>
          {renderInline(line.replace(/^\s*[-*]\s/, ''))}
        </div>
      );
    }
    // Ordered list
    else if (line.match(/^\s*\d+\.\s/)) {
      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      const num = line.match(/(\d+)\./)?.[1];
      elements.push(
        <div key={i} className="text-content-secondary" style={{ paddingLeft: `${indent * 4 + 8}px` }}>
          <span className="text-semantic-success mr-1">{num}.</span>
          {renderInline(line.replace(/^\s*\d+\.\s/, ''))}
        </div>
      );
    }
    // Empty line
    else if (!line.trim()) {
      elements.push(<div key={i} className="h-2" />);
    }
    // Plain text
    else {
      elements.push(<div key={i} className="text-content-secondary">{renderInline(line)}</div>);
    }

    i++;
  }

  return (
    <div className="text-xs leading-relaxed font-mono">
      {elements}
    </div>
  );
}
