/**
 * Dedicated markdown renderer for prose content (release notes, changelogs).
 * Sans-serif, generous spacing, proper heading hierarchy.
 */

/** Parse inline formatting: `code`, **bold**, *italic* */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
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
        <code key={match.index} className="bg-surface-tertiary/60 text-content-secondary px-1.5 py-0.5 rounded text-[12px] font-mono">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-semibold text-content-primary">
          {token.slice(2, -2)}
        </strong>,
      );
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

export function MarkdownRenderer({ content }: { content: string }) {
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
      if (i < lines.length) i++;

      elements.push(
        <div key={`code-${i}`} className="my-3 rounded-lg border border-chrome-subtle/40 bg-surface-terminal overflow-x-auto">
          {lang && (
            <div className="px-3 py-1 text-[10px] font-medium text-content-tertiary uppercase tracking-wider border-b border-chrome-subtle/30">
              {lang}
            </div>
          )}
          <pre className="px-3 py-2.5 text-[12px] text-content-secondary leading-relaxed whitespace-pre overflow-x-auto font-mono">
            {codeLines.join('\n')}
          </pre>
        </div>,
      );
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-sm font-semibold text-content-primary mt-4 mb-1.5">
          {renderInline(line.slice(4))}
        </h3>,
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-base font-semibold text-content-primary mt-5 mb-2">
          {renderInline(line.slice(3))}
        </h2>,
      );
    } else if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-lg font-bold text-content-primary mt-5 mb-2.5">
          {renderInline(line.slice(2))}
        </h1>,
      );
    }
    // Unordered list
    else if (line.match(/^\s*[-*]\s/)) {
      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      const level = Math.floor(indent / 2);
      elements.push(
        <div key={i} className="flex gap-2 text-content-secondary" style={{ paddingLeft: `${level * 16 + 20}px` }}>
          <span className="text-content-tertiary shrink-0 mt-[1px]">&bull;</span>
          <span>{renderInline(line.replace(/^\s*[-*]\s/, ''))}</span>
        </div>,
      );
    }
    // Ordered list
    else if (line.match(/^\s*\d+\.\s/)) {
      const indent = line.match(/^(\s*)/)?.[1].length || 0;
      const level = Math.floor(indent / 2);
      const num = line.match(/(\d+)\./)?.[1];
      elements.push(
        <div key={i} className="flex gap-2 text-content-secondary" style={{ paddingLeft: `${level * 16 + 20}px` }}>
          <span className="text-content-tertiary shrink-0 tabular-nums">{num}.</span>
          <span>{renderInline(line.replace(/^\s*\d+\.\s/, ''))}</span>
        </div>,
      );
    }
    // Empty line — paragraph break
    else if (!line.trim()) {
      elements.push(<div key={i} className="h-3" />);
    }
    // Plain text
    else {
      elements.push(
        <p key={i} className="text-content-secondary">
          {renderInline(line)}
        </p>,
      );
    }

    i++;
  }

  return (
    <div className="text-[13px] leading-relaxed space-y-0.5">
      {elements}
    </div>
  );
}
