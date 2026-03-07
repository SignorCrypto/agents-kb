import { useKanbanStore } from '../hooks/useKanbanStore';
import { JobCard } from './JobCard';
import type { Job, KanbanColumn as ColumnType } from '../types/index';

interface KanbanColumnProps {
  column: ColumnType;
  label: string;
  jobs: Job[];
}

const columnColors: Record<ColumnType, string> = {
  planning: 'bg-column-planning',
  development: 'bg-column-development',
  done: 'bg-column-done',
};

export function KanbanColumn({ column, label, jobs }: KanbanColumnProps) {
  const selectJob = useKanbanStore((s) => s.selectJob);

  const handleEmptyClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) selectJob(null);
  };

  return (
    <div className="flex-1 min-w-[280px] flex flex-col" onClick={handleEmptyClick}>
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 pb-3">
        <div className={`w-2.5 h-2.5 rounded-full ${columnColors[column]}`} />
        <h2 className="text-sm font-semibold text-content-secondary">
          {label}
        </h2>
        <span className="text-xs text-content-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded-full">
          {jobs.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto space-y-2 px-1 pt-1" onClick={handleEmptyClick}>
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
        {jobs.length === 0 && (
          <div className="text-xs text-content-tertiary text-center py-8">
            No jobs
          </div>
        )}
      </div>
    </div>
  );
}
