import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate } from '@/features/jobs/format';
import { ListFilters } from '@/features/operations/list-filters';
import type {
  MaterialsBoardRead,
  MaterialsBoardRow
} from '@/features/materials/types';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Materials | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

function Counts({ row }: { row: MaterialsBoardRow }) {
  const chips: [
    string,
    number,
    'danger' | 'warning' | 'secondary' | 'info' | 'success'
  ][] = [
    ['to order', row.to_order, 'danger'],
    ['at risk', row.at_risk, 'danger'],
    ['draft', row.drafted, 'warning'],
    ['awaiting confirmation', row.awaiting_confirmation, 'warning'],
    ['check external order', row.external, 'warning'],
    ['part received', row.part_received, 'warning'],
    ['confirmed', row.confirmed, 'info'],
    ['from stock', row.from_stock, 'secondary'],
    ['received', row.received - row.part_received, 'success']
  ];
  return (
    <div className='flex flex-wrap gap-1'>
      {chips
        .filter(([, n]) => n > 0)
        .map(([label, n, variant]) => (
          <Badge key={label} variant={variant}>
            {n} {label}
          </Badge>
        ))}
    </div>
  );
}

export default async function MaterialsPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const params = await searchParams;
  const view = first(params.view) === 'all' ? 'all' : 'action';
  const q = first(params.q).slice(0, 120);
  const result = await readOps<MaterialsBoardRead>('MATERIALS_BOARD', {
    view,
    q
  });

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'materials', view }}
      />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Materials'
          description='Jobs whose materials still need ordering, confirming or receiving, soonest need-by date first.'
        />
        <ListFilters
          defaults={{ view: 'action' }}
          tabs={{
            key: 'view',
            label: 'Which jobs',
            options: [
              { value: 'action', label: 'Needs action' },
              { value: 'all', label: 'All with materials' }
            ]
          }}
          searchPlaceholder='Search job, customer, postcode'
        />
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : result.data.jobs.length === 0 ? (
          <EmptyState
            title='Nothing to order'
            description='Jobs with material lines needing attention appear here.'
          />
        ) : (
          <ul className='flex flex-col gap-2'>
            {result.data.jobs.map((row) => (
              <li key={row.job_id}>
                <Link
                  href={`/dashboard/materials/${row.job_id}`}
                  className='bg-card hover:border-primary grid gap-2 rounded-lg border p-3 transition-colors md:grid-cols-[minmax(12rem,1fr)_2fr_auto] md:items-center'
                >
                  <span>
                    <span className='font-mono font-semibold'>
                      {row.job_ref}
                    </span>
                    <span className='text-muted-foreground block text-xs'>
                      {[row.customer_name, row.postcode]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <Counts row={row} />
                  <span className='text-muted-foreground text-xs md:text-right'>
                    {row.next_need_by && (
                      <>Needed by {formatDate(row.next_need_by)}</>
                    )}
                    {row.install_date && (
                      <span className='block'>
                        Install {formatDate(row.install_date)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
