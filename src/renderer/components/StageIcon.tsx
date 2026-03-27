import type { KanbanColumn } from '../types/index';
import { CircleCheckBigIcon, CodeXmlIcon, NotebookPenIcon } from './Icons';

const STAGE_LABELS: Record<KanbanColumn, string> = {
  planning: 'Planning',
  development: 'Development',
  done: 'Done',
};

const STAGE_SHORT_LABELS: Record<KanbanColumn, string> = {
  planning: 'PLN',
  development: 'DEV',
  done: 'DONE',
};

const STAGE_ICONS = {
  planning: NotebookPenIcon,
  development: CodeXmlIcon,
  done: CircleCheckBigIcon,
} satisfies Record<KanbanColumn, typeof NotebookPenIcon>;

interface StageIconProps {
  stage: KanbanColumn;
  size?: number;
  className?: string;
}

export function StageIcon({ stage, size = 14, className }: StageIconProps) {
  const Icon = STAGE_ICONS[stage];
  return <Icon size={size} className={className} aria-hidden="true" />;
}

export function getStageLabel(stage: KanbanColumn): string {
  return STAGE_LABELS[stage];
}

export function getStageShortLabel(stage: KanbanColumn): string {
  return STAGE_SHORT_LABELS[stage];
}
