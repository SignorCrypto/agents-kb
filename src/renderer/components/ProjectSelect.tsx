import { forwardRef } from 'react';
import { getProjectColor } from '../../shared/types';
import type { Project } from '../types/index';

interface ProjectSelectProps {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
  className?: string;
}

export const ProjectSelect = forwardRef<HTMLSelectElement, ProjectSelectProps>(
  function ProjectSelect({ projects, value, onChange, className }, ref) {
    const selected = projects.find((p) => p.id === value);

    return (
      <div className="relative">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 inline-block w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: getProjectColor(selected?.color) }}
        />
        <select
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full appearance-none pl-8 pr-10 py-2 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40 ${className ?? ''}`}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>
    );
  },
);
