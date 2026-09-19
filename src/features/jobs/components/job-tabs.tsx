import { cn } from '@/lib/utils';
import Link from 'next/link';

export const JOB_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'work', label: 'Work' },
  { id: 'money', label: 'Money' },
  { id: 'history', label: 'History' }
] as const;
export type JobTab = (typeof JOB_TABS)[number]['id'];

export const parseJobTab = (v: string | string[] | undefined): JobTab => {
  const value = Array.isArray(v) ? v[0] : v;
  return JOB_TABS.some((t) => t.id === value) ? (value as JobTab) : 'overview';
};

/** Tabs as links, so each tab has its own URL and works without JavaScript. */
export function JobTabNav({
  jobId,
  active,
  counts = {}
}: {
  jobId: string;
  active: JobTab;
  counts?: Partial<Record<JobTab, number>>;
}) {
  return (
    <nav
      aria-label='Job sections'
      className='-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0'
    >
      <ul className='flex w-max gap-1 border-b md:w-full'>
        {JOB_TABS.map((tab) => {
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
        })}
      </ul>
    </nav>
  );
}
