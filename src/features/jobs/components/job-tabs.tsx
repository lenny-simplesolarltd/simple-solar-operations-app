import { cn } from '@/lib/utils';
import Link from 'next/link';

export const JOB_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'work', label: 'Work' },
  { id: 'operations', label: 'Operations' },
  { id: 'money', label: 'Money' },
  { id: 'files', label: 'Files' },
  { id: 'history', label: 'History' }
] as const;
export type JobTab = (typeof JOB_TABS)[number]['id'];

/** Tabs whose reads only the office class may make (execute_read job reads, JOB_OPERATIONS). */
export const OFFICE_ONLY_TABS: readonly JobTab[] = [
  'work',
  'operations',
  'money',
  'history'
];

export const parseJobTab = (
  v: string | string[] | undefined,
  allowed: readonly JobTab[] = JOB_TABS.map((t) => t.id)
): JobTab => {
  const value = Array.isArray(v) ? v[0] : v;
  return allowed.includes(value as JobTab) ? (value as JobTab) : 'overview';
};

/** Tabs as links, so each tab has its own URL and works without JavaScript. */
export function JobTabNav({
  jobId,
  active,
  counts = {},
  visible
}: {
  jobId: string;
  active: JobTab;
  counts?: Partial<Record<JobTab, number>>;
  /** Tabs this person can use; hidden tabs would only show "No access". */
  visible?: readonly JobTab[];
}) {
  return (
    <nav
      aria-label='Job sections'
      className='-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0'
    >
      <ul className='flex w-max gap-1 border-b md:w-full'>
        {JOB_TABS.filter((t) => !visible || visible.includes(t.id)).map(
          (tab) => {
            const current = tab.id === active;
            return (
              <li key={tab.id}>
                <Link
                  href={
                    tab.id === 'overview'
                      ? `/dashboard/jobs/${jobId}`
                      : `/dashboard/jobs/${jobId}?tab=${tab.id}`
                  }
                  aria-current={current ? 'page' : undefined}
                  scroll={false}
                  className={cn(
                    '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                    current
                      ? 'border-brand text-foreground'
                      : 'text-muted-foreground hover:text-foreground border-transparent'
                  )}
                >
                  {tab.label}
                  {counts[tab.id] != null && (
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {counts[tab.id]}
                    </span>
                  )}
                </Link>
              </li>
            );
          }
        )}
      </ul>
    </nav>
  );
}
