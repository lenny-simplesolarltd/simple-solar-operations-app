import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/features/jobs/format';
import Link from 'next/link';
import type { PlannerRead, PlannerRow, PlannerScaffold } from '../types';
import {
  AllocateButton,
  ChangeInstallerButton,
  MovePackageButton
} from './planner-actions';

const weekOf = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

const SCAFFOLD_KIND: Record<string, string> = {
  Erect: 'Scaffold up',
  Strip: 'Scaffold down',
  StripForecast: 'Scaffold down (forecast)'
};

type Item =
  | { kind: 'work'; day: string; row: PlannerRow }
  | { kind: 'scaffold'; day: string; s: PlannerScaffold };

/**
 * The 3- and 6-week planner as a list grouped by week (no drag and drop:
 * every change is an explicit, versioned command from the row).
 */
export function PlannerList({
  data,
  canPlan
}: {
  data: PlannerRead;
  canPlan: boolean;
}) {
  const items: Item[] = [
    ...data.rows.map((row) => ({
      kind: 'work' as const,
      day: row.start_at < data.from ? data.from : row.start_at,
      row
    })),
    ...data.scaffold.map((s) => ({ kind: 'scaffold' as const, day: s.date, s }))
  ].sort((a, b) => a.day.localeCompare(b.day));
  if (items.length === 0) {
    return <EmptyState title='Nothing planned in this window' />;
  }
  const weeks = new Map<string, Item[]>();
  for (const item of items) {
    const w = weekOf(item.day);
    weeks.set(w, [...(weeks.get(w) ?? []), item]);
  }
  return (
    <div className='flex flex-col gap-5'>
      {Array.from(weeks.entries()).map(([week, list]: [string, Item[]]) => (
        <section key={week} className='flex flex-col gap-2'>
          <h2 className='text-muted-foreground text-sm font-semibold tracking-wide uppercase'>
            Week of {formatDate(week)}
          </h2>
          <ul className='flex flex-col gap-2'>
            {list.map((item) =>
              item.kind === 'work' ? (
                <li
                  key={`${item.row.work_package_id}-${item.row.allocation_id ?? 'none'}`}
                  className='bg-card grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[9rem_minmax(10rem,1fr)_minmax(9rem,1fr)_auto] md:items-center'
                >
                  <span className='tabular-nums'>
                    {formatDate(item.row.start_at)}
                    {item.row.end_at !== item.row.start_at && (
                      <span className='text-muted-foreground block text-xs'>
                        to {formatDate(item.row.end_at)}
                      </span>
                    )}
                  </span>
                  <span>
                    <Link
                      href={`/dashboard/jobs/${item.row.job_id}`}
                      className='font-mono font-semibold hover:underline'
                    >
                      {item.row.job_ref}
                    </Link>
                    <span className='text-muted-foreground block text-xs'>
                      {item.row.trade} · {item.row.work_package_status}
                      {item.row.job_display && ` · ${item.row.job_display}`}
                    </span>
                  </span>
                  <span>
                    {item.row.allocated ? (
                      <>
                        {item.row.person_name}
                        <span className='text-muted-foreground text-xs'>
                          {' '}
                          · {item.row.role}
                        </span>
                      </>
                    ) : (
                      <Badge variant='warning'>Unallocated</Badge>
                    )}
                  </span>
                  {canPlan && (
                    <span className='flex flex-wrap gap-1 md:justify-end'>
                      {item.row.allocated ? (
                        <>
                          <ChangeInstallerButton row={item.row} />
                          <MovePackageButton row={item.row} />
                        </>
                      ) : (
                        <AllocateButton row={item.row} />
                      )}
                    </span>
                  )}
                </li>
              ) : (
                <li
                  key={`${item.s.scaffold_booking_id}-${item.s.kind}`}
                  className='bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm'
                >
                  <span>
                    <span className='tabular-nums'>
                      {formatDate(item.s.date)}
                    </span>{' '}
                    · {SCAFFOLD_KIND[item.s.kind]}
                    <span className='text-muted-foreground block text-xs'>
                      {item.s.company ?? 'No scaffolder'} · {item.s.status}
                    </span>
                  </span>
                  <span className='flex items-center gap-2'>
                    {!item.s.acknowledged && (
                      <Badge variant='warning'>Not acknowledged</Badge>
                    )}
                    <Link
                      href={`/dashboard/scaffold/${item.s.scaffold_booking_id}`}
                      className='text-xs underline'
                    >
                      booking
                    </Link>
                  </span>
                </li>
              )
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
