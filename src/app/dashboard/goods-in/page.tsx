import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate } from '@/features/jobs/format';
import type { StoreQueueRead } from '@/features/materials/types';
import { ListFilters } from '@/features/operations/list-filters';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Goods in | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();
const WINDOWS: Record<string, number> = { week: 7, fortnight: 14, month: 31 };

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
    new Date()
  );
}
function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function GoodsInPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const params = await searchParams;
  const window = WINDOWS[first(params.window)]
    ? first(params.window)
    : 'fortnight';
  // Overdue deliveries are still expected, so look back a fortnight too.
  const from = addDays(londonToday(), -14);
  const to = addDays(londonToday(), WINDOWS[window]);
  const result = await readOps<StoreQueueRead>('STORE_QUEUE', { from, to });
  const today = londonToday();

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'goods-in', view: window }}
      />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Goods in'
          description='Deliveries expected at the store, including any that are late. Open one to record what arrived.'
        />
        <ListFilters
          defaults={{ window: 'fortnight' }}
          tabs={{
            key: 'window',
            label: 'Looking ahead',
            options: [
              { value: 'week', label: 'Next 7 days' },
              { value: 'fortnight', label: 'Next 14 days' },
              { value: 'month', label: 'Next month' }
            ]
          }}
        />
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : (
          <>
            <section className='flex flex-col gap-2'>
              <h2 className='text-lg font-semibold'>Expected deliveries</h2>
              {result.data.expected_deliveries.length === 0 ? (
                <EmptyState title='No deliveries expected' />
              ) : (
                <ul className='flex flex-col gap-2'>
                  {result.data.expected_deliveries.map((d) => {
                    const late =
                      d.expected_date !== null && d.expected_date < today;
                    return (
                      <li key={d.delivery_id}>
                        <Link
                          href={`/dashboard/goods-in/${d.delivery_id}`}
                          className='bg-card hover:border-primary flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm transition-colors'
                        >
                          <span>
                            <span className='font-semibold'>
                              {d.merchant ?? 'Merchant'}
                            </span>
                            <span className='text-muted-foreground block text-xs'>
                              {d.work_type}
                              {d.supplier_reference &&
                                ` · ref ${d.supplier_reference}`}
                            </span>
                          </span>
                          <span className='flex items-center gap-2'>
                            <span
                              className={
                                late
                                  ? 'text-destructive font-medium'
                                  : undefined
                              }
                            >
                              {d.expected_date
                                ? formatDate(d.expected_date)
                                : 'No date'}
                              {late && ' · late'}
                            </span>
                            <Badge variant='outline'>{d.order_status}</Badge>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section className='flex flex-col gap-2'>
              <h2 className='text-lg font-semibold'>Store tasks</h2>
              {result.data.open_store_tasks.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  No open store tasks.
                </p>
              ) : (
                <ul className='flex flex-col gap-1 text-sm'>
                  {result.data.open_store_tasks.map((t) => (
                    <li key={t.task_id}>
                      <Link
                        href={`/dashboard/tasks/${t.task_id}`}
                        className='hover:underline'
                      >
                        <span className='text-muted-foreground font-mono text-xs'>
                          {t.template_code}
                        </span>{' '}
                        {t.title}
                      </Link>
                      {t.due_at && (
                        <span className='text-muted-foreground'>
                          {' '}
                          · due {formatDate(t.due_at)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </PageContainer>
  );
}
