export const CODE_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'archived'
] as const;

export type CodeStatus = (typeof CODE_STATUSES)[number];

export const CODE_STATUS_LABELS: Record<CodeStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  archived: 'Archived'
};
