import { useState, useEffect, useMemo, useCallback } from 'react';
import { useElectronAPI } from '../hooks/useElectronAPI';

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  note?: string;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: '+' | '-' | ' ';
  content: string;
  oldNum?: number;
  newNum?: number;
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');

    // Extract file path from the first line: "a/path b/path"
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    const filePath = headerMatch?.[2] || headerMatch?.[1] || 'unknown';

    let additions = 0;
    let deletions = 0;
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;
    let note: string | undefined;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Hunk header
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (hunkMatch) {
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        continue;
      }

      if (!currentHunk) continue;

      // Skip binary / header metadata lines
      if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') ||
          line.startsWith('new file') || line.startsWith('deleted file') ||
          line.startsWith('old mode') || line.startsWith('new mode') ||
          line.startsWith('similarity') || line.startsWith('rename') ||
          line.startsWith('Binary')) {
        if (line.startsWith('Binary')) note = 'Binary file changed';
        continue;
      }
      if (line === '\\ No newline at end of file') continue;

      if (line.startsWith('+')) {
        additions++;
        currentHunk.lines.push({ type: '+', content: line.slice(1), newNum: newLine });
        newLine++;
      } else if (line.startsWith('-')) {
        deletions++;
        currentHunk.lines.push({ type: '-', content: line.slice(1), oldNum: oldLine });
        oldLine++;
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({ type: ' ', content: line.slice(1), oldNum: oldLine, newNum: newLine });
        oldLine++;
        newLine++;
      }
    }

    if (hunks.length > 0 || note) {
      files.push({ path: filePath, additions, deletions, hunks, note });
    }
  }

  return files;
}

function StatBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const blocks = 5;
  const addBlocks = Math.round((additions / total) * blocks);
  const delBlocks = blocks - addBlocks;

  return (
    <div className="flex items-center gap-1.5 ml-auto shrink-0">
      <span className="text-[10px] font-mono tabular-nums text-semantic-success">+{additions}</span>
      <span className="text-[10px] font-mono tabular-nums text-semantic-error">-{deletions}</span>
      <div className="flex gap-px">
        {Array.from({ length: addBlocks }, (_, i) => (
          <div key={`a${i}`} className="w-[5px] h-[5px] rounded-[1px] bg-semantic-success/70" />
        ))}
        {Array.from({ length: delBlocks }, (_, i) => (
          <div key={`d${i}`} className="w-[5px] h-[5px] rounded-[1px] bg-semantic-error/70" />
        ))}
      </div>
    </div>
  );
}

function FileSection({ file }: { file: DiffFile }) {
  const [collapsed, setCollapsed] = useState(false);

  const fileName = file.path.split('/').pop() || file.path;
  const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) + '/' : '';

  return (
    <div className="border border-chrome-subtle/50 rounded-md overflow-hidden">
      {/* File header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-surface-tertiary/60 hover:bg-surface-tertiary transition-colors"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={`text-content-tertiary shrink-0 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
        >
          <path d="M2.5 3.5L5 6.5L7.5 3.5" />
        </svg>
        <span className="text-[11px] font-mono truncate text-left">
          <span className="text-content-tertiary">{dirPath}</span>
          <span className="text-content-primary font-medium">{fileName}</span>
        </span>
        <StatBar additions={file.additions} deletions={file.deletions} />
      </button>

      {/* Diff lines */}
      {!collapsed && (
        <div className="overflow-x-auto">
          {file.note && file.hunks.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-content-tertiary border-t border-chrome-subtle/20 bg-surface-tertiary/20">
              {file.note}
            </div>
          )}
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              {/* Hunk header */}
              <div className="px-2.5 py-0.5 text-[10px] font-mono text-content-tertiary bg-surface-tertiary/30 border-t border-chrome-subtle/30 select-none">
                {hunk.header.replace(/^@@.*@@/, (m) => m).slice(0, 80)}
              </div>
              {/* Lines */}
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={`flex font-mono text-[11px] leading-[18px] ${
                    line.type === '+'
                      ? 'bg-semantic-success/[0.07]'
                      : line.type === '-'
                        ? 'bg-semantic-error/[0.06]'
                        : ''
                  }`}
                >
                  {/* Line numbers */}
                  <span className="shrink-0 w-[38px] text-right pr-1.5 select-none text-[10px] text-content-tertiary/50 tabular-nums leading-[18px]">
                    {line.type !== '+' ? line.oldNum : ''}
                  </span>
                  <span className="shrink-0 w-[38px] text-right pr-1.5 select-none text-[10px] text-content-tertiary/50 tabular-nums leading-[18px] border-r border-chrome-subtle/20">
                    {line.type !== '-' ? line.newNum : ''}
                  </span>
                  {/* +/- indicator */}
                  <span className={`shrink-0 w-[18px] text-center select-none leading-[18px] ${
                    line.type === '+' ? 'text-semantic-success' : line.type === '-' ? 'text-semantic-error' : 'text-transparent'
                  }`}>
                    {line.type === ' ' ? '' : line.type}
                  </span>
                  {/* Content */}
                  <span className={`flex-1 whitespace-pre pr-3 ${
                    line.type === '+'
                      ? 'text-semantic-success/90'
                      : line.type === '-'
                        ? 'text-semantic-error/80'
                        : 'text-content-secondary/70'
                  }`}>
                    {line.content || '\u00A0'}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DiffViewerProps {
  jobId: string;
}

export function DiffViewer({ jobId }: DiffViewerProps) {
  const api = useElectronAPI();
  const [rawDiff, setRawDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const diff = await api.jobsGetDiff(jobId);
      setRawDiff(diff);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diff');
    } finally {
      setLoading(false);
    }
  }, [api, jobId]);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  const files = useMemo(() => (rawDiff ? parseDiff(rawDiff) : []), [rawDiff]);
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-content-tertiary">
        <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
          <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="text-xs">Loading diff...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-semantic-error/80 text-center py-4">{error}</div>
    );
  }

  if (!rawDiff || files.length === 0) {
    return (
      <div className="text-xs text-content-tertiary text-center py-6">
        No file changes detected
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-1 py-1">
        <span className="text-[10px] font-semibold text-content-tertiary uppercase tracking-wider">
          {files.length} file{files.length !== 1 ? 's' : ''} changed
        </span>
        <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums">
          <span className="text-semantic-success">+{totalAdditions}</span>
          <span className="text-semantic-error">-{totalDeletions}</span>
        </div>
      </div>

      {/* File sections */}
      {files.map((file, i) => (
        <FileSection key={i} file={file} />
      ))}
    </div>
  );
}
