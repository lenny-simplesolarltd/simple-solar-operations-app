import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate } from '@/features/jobs/format';
import { ListFilters } from '@/features/operations/list-filters';
import {
  AddAvailability,
  AvailabilityRowActions
} from '@/features/planner/components/resourcing-actions';
import type { StaffAvailabilityRead } from '@/features/planner/types';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { isOfficeManager } from '@/lib/roles';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Staff availability | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOWS: Record<string, number> = { month: 31, quarter: 92, year: 365 };

const TYPE_VARIANT: Record<
  string,
  'warning' | 'danger' | 'info' | 'secondary' | 'success'
> = {
  Leave: 'warning',
  Sick: 'danger',
  Training: 'info',
  Unavailable: 'secondary',
  Available: 'success'
};

export default async function AvailabilityPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const params = await searchParams;
  const window = WINDOWS[first(params.window)]
    ? first(params.window)
    : 'quarter';
  const person = UUID.test(first(params.person))
    ? first(params.person)
    : undefined;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London'
  }).format(new Date());
  const to = new Date(`${today}T12:00:00Z`);
  to.setUTCDate(to.getUTCDate() + WINDOWS[window]);

  const result = await readOps<StaffAvailabilityRead>('STAFF_AVAILABILITY', {
    from: today,
    to: to.toISOString().slice(0, 10),
    person_id: person
  });
  const canEdit = isOfficeManager(user);

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'availability', view: window }}
      />
      <div className='flex w-full flex-col gap-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading
            title='Staff availability'
            description='Leave, sickness, training and other time away, from today. Installer entries block allocation on those days.'
          />
          {canEdit && result.ok && (
            <AddAvailability people={result.data.people} />
          )}
        </div>
        <ListFilters
          defaults={{ window: 'quarter' }}
          tabs={{
            key: 'window',
            label: 'How far ahead',
            options: [
              { value: 'month', label: 'Next month' },
              { value: 'quarter', label: 'Next 3 months' },
              { value: 'year', label: 'Next year' }
            ]
          }}
          selects={
            result.ok
              ? [
                  {
                    key: 'person',
                    label: 'Person',
                    allLabel: 'Everyone',
                    options: result.data.people.map((p) => ({
                      value: p.id,
                      label: p.name
                    }))
                  }
                ]
              : []
          }
        />
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : result.data.entries.length === 0 ? (
          <EmptyState
            title='Everyone is available'
            description='No time away recorded in this window.'
          />
        ) : (
          <ul className='flex flex-col gap-2'>
            {result.data.entries.map((e) => (
              <li
                key={e.availability_id}
                className='bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm'
              >
                <span>
                  <span className='font-medium'>{e.display_name}</span>{' '}
                  <Badge variant={TYPE_VARIANT[e.type] ?? 'secondary'}>
                    {e.type}
                  </Badge>
                  <span className='text-muted-foreground block text-xs'>
                    {formatDate(e.from_date)}
                    {e.to_date !== e.from_date && ` – ${formatDate(e.to_date)}`}
                    {e.reason && ` · ${e.reason}`}
                  </span>
                  {e.allocations > 0 && e.type !== 'Available' && (
                    <span className='text-destructive block text-xs'>
                      Booked on {e.allocations} job
                      {e.allocations === 1 ? '' : 's'} in this period – re-plan
                      in the Planner.
                    </span>
                  )}
                </span>
                {canEdit && <AvailabilityRowActions entry={e} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
