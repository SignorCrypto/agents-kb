import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useKanbanStore } from '../../hooks/useKanbanStore';
import { LightbulbIcon, SearchIcon, XIcon } from '../../components/Icons';
import type { Skill } from '../../types/index';
import { useSkillsCatalog } from './useSkillsCatalog';

export function SkillsPanel({ onClose }: { onClose: () => void }) {
  const selectedProjectId = useKanbanStore((s) => s.selectedProjectId);
  const { skills, loading } = useSkillsCatalog(selectedProjectId ?? undefined);
  const [search, setSearch] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const query = search.toLowerCase().trim();
  const filtered = query
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query),
      )
    : skills;
  const projectSkills = filtered.filter((s) => s.source === 'project');
  const globalSkills = filtered.filter((s) => s.source === 'global');

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-surface-overlay/40 backdrop-blur-[2px]" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="relative w-[500px] max-h-[72vh] rounded-xl border border-chrome/50 bg-surface-elevated shadow-2xl shadow-surface-overlay/20 overflow-hidden animate-[dialogIn_150ms_ease-out] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-surface-tertiary/60 flex items-center justify-center">
              <LightbulbIcon size={13} className="text-content-secondary" />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-content-primary">
                Skills
              </h2>
              {!loading && skills.length > 0 && (
                <span className="text-[10px] font-medium tabular-nums text-content-tertiary bg-surface-tertiary/50 rounded-full px-1.5 py-0.5 leading-none">
                  {skills.length}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/70 transition-colors"
            aria-label="Close"
          >
            <XIcon size={12} />
          </button>
        </div>

        <div className="border-t border-chrome-subtle/70" />

        {/* Search */}
        {!loading && skills.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <div className="relative">
              <SearchIcon
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-content-tertiary pointer-events-none"
              />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search skills…"
                spellCheck={false}
                className="w-full h-8 pl-[30px] pr-3 rounded-lg text-xs bg-surface-tertiary/40 border border-chrome-subtle/50 text-content-primary placeholder:text-content-tertiary/60 focus:outline-none focus:border-focus-ring/40 focus:bg-surface-tertiary/60 transition-colors"
              />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <svg
                className="animate-spin h-4 w-4 text-content-tertiary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 019.5 7" strokeLinecap="round" />
              </svg>
            </div>
          ) : skills.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-10 h-10 rounded-xl bg-surface-tertiary/40 flex items-center justify-center mx-auto mb-3">
                <LightbulbIcon size={18} className="text-content-tertiary" />
              </div>
              <p className="text-xs font-medium text-content-secondary">
                No skills installed
              </p>
              <p className="text-[11px] text-content-tertiary mt-1.5 leading-relaxed max-w-[280px] mx-auto">
                Add skill folders to{' '}
                <span className="font-mono text-content-secondary">
                  ~/.claude/skills/
                </span>{' '}
                or{' '}
                <span className="font-mono text-content-secondary">
                  .claude/skills/
                </span>{' '}
                in your project.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-content-tertiary">
                No skills matching{' '}
                <span className="font-mono text-content-secondary">
                  &ldquo;{search}&rdquo;
                </span>
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {projectSkills.length > 0 && (
                <SkillSection label="Project" skills={projectSkills} startIndex={0} />
              )}
              {globalSkills.length > 0 && (
                <SkillSection
                  label="Global"
                  skills={globalSkills}
                  startIndex={projectSkills.length}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SkillSection({
  label,
  skills,
  startIndex,
}: {
  label: string;
  skills: Skill[];
  startIndex: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">
          {label}
        </span>
        <div className="flex-1 h-px bg-chrome-subtle/50" />
      </div>
      <div>
        {skills.map((skill, i) => (
          <div
            key={`${skill.source}-${skill.name}`}
            className="py-2 px-1 border-b border-chrome-subtle/40 last:border-b-0"
            style={{
              animation: `skillCardIn 200ms ease-out ${(startIndex + i) * 40}ms both`,
            }}
          >
            <span className="text-[12.5px] font-semibold font-mono text-content-primary">
              {skill.name}
            </span>
            {skill.description && (
              <p className="text-[11px] text-content-tertiary mt-0.5 leading-relaxed line-clamp-2">
                {skill.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
