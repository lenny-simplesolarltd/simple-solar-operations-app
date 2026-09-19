// URL search parameters for the task lists. Parsing only normalises values
// to the ones the TASKS read model accepts; the server still validates them.
// Safe to import from client components.

import {
  TASK_QUEUES,
  type TaskDueFilter,
  type TaskQueue,
  type TaskScope,
  type TaskStatusFilter
} from '@/lib/backend/models';

export interface TaskFilters {
  scope: TaskScope;
  status: TaskStatusFilter;
  due: TaskDueFilter;
  queue: TaskQueue | null;
  owner: string | null;
  q: string;
}

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? '';
const oneOf = <T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T
): T =>
  (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DUE_OPTIONS: { value: TaskDueFilter; label: string }[] = [
  { value: 'any', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'soon', label: 'Next 7 days' },
  { value: 'later', label: 'Later' },
  { value: 'none', label: 'No due date' }
];

export const STATUS_OPTIONS: { value: TaskStatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'History' },
  { value: 'all', label: 'All' }
];

export const QUEUE_LABELS: Record<TaskQueue, string> = {
  booking: 'Booking',
  calls: 'Calls',
  issues: 'Issues',
  payments: 'Payments',
  ghl: 'CRM (GHL)',
  cancellation: 'Cancellation',
  materials: 'Materials',
  scaffold: 'Scaffold',
  install: 'Install',
  system: 'System'
};

/** Page headings for a whole-team queue (scope=all&queue=...). */
export const QUEUE_TITLES: Record<TaskQueue, string> = {
  booking: 'Booking tasks',
  calls: 'Calls',
  issues: 'Issue tasks',
  payments: 'Payment tasks',
  ghl: 'CRM (GHL) tasks',
  cancellation: 'Cancellation tasks',
  materials: 'Materials tasks',
  scaffold: 'Scaffold tasks',
  install: 'Install tasks',
  system: 'System tasks'
};

/** The team-wide queues offered as chips on the Everyone view. */
export const TEAM_QUEUE_CHIPS: TaskQueue[] = [
  'calls',
  'issues',
  'cancellation',
  'payments',
  'ghl',
  'booking'
];

export function parseTaskFilters(params: Params): TaskFilters {
  const owner = first(params.owner);
  return {
    scope: oneOf(first(params.scope), ['my', 'team', 'all'] as const, 'my'),
    status: oneOf(
      first(params.status),
      ['open', 'closed', 'all'] as const,
      'open'
    ),
    due: oneOf(
      first(params.due),
      ['any', 'overdue', 'today', 'soon', 'later', 'none', 'dated'] as const,
      'any'
    ),
    queue: (TASK_QUEUES as readonly string[]).includes(first(params.queue))
      ? (first(params.queue) as TaskQueue)
      : null,
    owner: UUID.test(owner) ? owner : null,
    q: first(params.q).trim().slice(0, 120)
  };
}

/** True when anything beyond the default "my open tasks" view is applied. */
export const hasActiveFilters = (f: TaskFilters) =>
  f.status !== 'open' || f.due !== 'any' || !!f.queue || !!f.owner || !!f.q;
