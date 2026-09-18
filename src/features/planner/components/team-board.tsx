import { EmptyState } from '@/components/empty-state';
import { formatDate } from '@/features/jobs/format';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { Alloc, Leave, TeamPlannerRead } from '../types';

function days(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const within = (day: string, from: string, to: string | null) =>
  day >= from && day <= (to ?? from);
const dayLabel = new Intl.DateTimeFormat('en-GB', {
  weekday: 'narrow',
  day: 'numeric',
  timeZone: 'UTC'
});

type Person = {
  person_id: string;
  display_name: string;
  role?: string;
  allocations: Alloc[];
  leave: Leave[];
};

function PersonRow({
  person,
  dayList,
  holidays
}: {
  person: Person;
  dayList: string[];
  holidays: Set<string>;
}) {
  return (
    <tr className='border-t'>
      <th
        scope='row'
        className='bg-card sticky left-0 z-10 min-w-40 p-2 text-left text-sm font-medium'
      >
        {person.display_name}
        {person.role && (
          <span className='text-muted-foreground block text-xs font-normal'>
            {person.role}
          </span>
        )}
      </th>
      {dayList.map((day) => {
        const weekend = [0, 6].includes(
          new Date(`${day}T12:00:00Z`).getUTCDay()
        );
        const leave = person.leave.find((l) =>
          within(day, l.from_date, l.to_date)
        );
        const work = person.allocations.filter((a) =>
          within(day, a.start_at, a.end_at)
        );
        return (
          <td
            key={day}
            className={cn(
              'h-12 min-w-16 border-l p-0.5 align-top text-[11px] leading-tight',
              (weekend || holidays.has(day)) && 'bg-muted/60',
              leave && 'bg-warning-soft'
            )}
            title={leave ? leave.type : undefined}
          >
            {leave && (
              <span className='text-warning block font-medium'>
                {leave.type}
              </span>
            )}
            {work.map((a) => (
              <Link
                key={a.allocation_id}
                href={`/dashboard/jobs/${a.job_id}`}
                className='bg-info-soft text-info mb-0.5 block truncate rounded px-1 hover:underline'
                title={`${a.job_display ?? ''} · ${a.trade}`}
              >
                {a.trade.slice(0, 4)} {a.job_display ?? ''}
              </Link>
            ))}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * Team board: people down the side, days across. Read-only - changes are
 * made from the planner list rows, never by dragging.
 */
export function TeamBoard({ data }: { data: TeamPlannerRead }) {
  const dayList = days(data.from, data.to);
  const holidays = new Set(data.holidays);
  const groups: { label: string; people: Person[] }[] = [
    ...data.teams.map((t) => ({
      label: `${t.name} · ${t.trade}`,
      people: t.members
    })),
    { label: 'Not in a team', people: data.unassigned_installers }
  ].filter((g) => g.people.length > 0);

  return (
    <div className='flex flex-col gap-4'>
      {groups.length === 0 ? (
        <EmptyState
          title='No installers set up'
          description='Add installers and teams under Installer skills.'
        />
      ) : (
        <div className='max-w-full overflow-x-auto rounded-lg border'>
          <table className='border-collapse'>
            <thead>
              <tr>
                <th className='bg-card sticky left-0 z-10 p-2 text-left text-xs'>
                  Installer
                </th>
                {dayList.map((day) => (
                  <th
                    key={day}
                    className='text-muted-foreground min-w-16 border-l p-1 text-center text-[11px] font-medium'
                  >
                    {dayLabel.format(new Date(`${day}T12:00:00Z`))}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.label}>
                <tr>
                  <th
                    colSpan={dayList.length + 1}
                    className='bg-muted/50 sticky left-0 p-2 text-left text-xs font-semibold tracking-wide uppercase'
                  >
                    {g.label}
                  </th>
                </tr>
                {g.people.map((p) => (
                  <PersonRow
                    key={p.person_id}
                    person={p}
                    dayList={dayList}
                    holidays={holidays}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {data.unallocated_work.length > 0 && (
        <section className='flex flex-col gap-2'>
          <h2 className='text-lg font-semibold'>Work with nobody allocated</h2>
          <ul className='flex flex-col gap-1 text-sm'>
            {data.unallocated_work.map((w) => (
              <li key={w.work_package_id}>
                <Link
                  href={`/dashboard/jobs/${w.job_id}`}
                  className='font-mono font-semibold hover:underline'
                >
                  {w.job_id_human ?? w.job_display}
                </Link>{' '}
                · {w.trade}
                {w.planned_start && ` · ${formatDate(w.planned_start)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
