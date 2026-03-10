import { useMemo } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { KanbanColumn } from './KanbanColumn';
import type { KanbanColumn as ColumnType } from '../types/index';

const columns: { id: ColumnType; label: string }[] = [
  { id: 'planning', label: 'Planning' },
  { id: 'development', label: 'Development' },
  { id: 'done', label: 'Done' },
];

export function KanbanBoard() {
  const jobs = useKanbanStore((s) => s.jobs);
  const selectedProjectId = useKanbanStore((s) => s.selectedProjectId);
  const selectJob = useKanbanStore((s) => s.selectJob);

  const filteredJobs = useMemo(
    () => selectedProjectId ? jobs.filter((j) => j.projectId === selectedProjectId) : jobs,
    [jobs, selectedProjectId],
  );

  const planningJobs = useMemo(() => filteredJobs.filter((j) => j.column === 'planning'), [filteredJobs]);
  const developmentJobs = useMemo(() => filteredJobs.filter((j) => j.column === 'development'), [filteredJobs]);
  const doneJobs = useMemo(() => filteredJobs.filter((j) => j.column === 'done'), [filteredJobs]);

  const columnJobs = useMemo(() => ({
    planning: planningJobs,
    development: developmentJobs,
    done: doneJobs,
  }), [planningJobs, developmentJobs, doneJobs]);

  return (
    <div
      className="flex-1 flex gap-4 px-4 pt-1.5 pb-4 overflow-x-auto min-w-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) selectJob(null);
      }}
    >
      {columns.map((col) => (
        <KanbanColumn
          key={col.id}
          column={col.id}
          label={col.label}
          jobs={columnJobs[col.id]}
        />
      ))}
    </div>
  );
}
