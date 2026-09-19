import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { OrderList } from '@/features/materials/components/order-list';
import { ORDER_VIEWS } from '@/features/materials/labels';
import type { OrdersListRead } from '@/features/materials/types';
import { ListFilters } from '@/features/operations/list-filters';
import { SimpleCommand } from '@/features/operations/simple-command';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { isOfficeManager } from '@/lib/roles';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Merchant orders | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrdersPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const params = await searchParams;
  const view =
    ORDER_VIEWS.find((v) => v.value === first(params.view)) ?? ORDER_VIEWS[0];
  const merchant = UUID.test(first(params.merchant))
    ? first(params.merchant)
    : undefined;
  const q = first(params.q).slice(0, 120);

  const result = await readOps<OrdersListRead>('ORDERS_LIST', {
    status: view.statuses,
    merchant_id: merchant,
    q
  });

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'operations',
          surface: 'merchant-orders',
          view: view.label
        }}
      />
      <div className='flex w-full flex-col gap-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading
            title='Merchant orders'
            description='Orders across every job. Open an order to send, confirm, revise or cancel it.'
          />
          {isOfficeManager(user) && (
            <SimpleCommand
              label='Weekly delivery lists'
              title='Record weekly merchant delivery lists'
              description='Prepares one delivery list per merchant for next week’s deliveries, with follow-up tasks. Lists are recorded for sending; nothing is emailed from here.'
              request={{ command_type: 'MERCHANT_WEEKLY_LIST' }}
              fields={[
                {
                  key: 'list_date',
                  label: 'List date',
                  kind: 'date',
                  hint: 'Blank means today.'
                }
              ]}
            />
          )}
        </div>
        <ListFilters
          defaults={{ view: 'open' }}
          tabs={{
            key: 'view',
            label: 'Order status',
            options: ORDER_VIEWS.map((v) => ({
              value: v.value,
              label: v.label
            }))
          }}
          selects={
            result.ok
              ? [
                  {
                    key: 'merchant',
                    label: 'Merchant',
                    allLabel: 'All merchants',
                    options: result.data.merchants.map((m) => ({
                      value: m.id,
                      label: m.name
                    }))
                  }
                ]
              : []
          }
          searchPlaceholder='Search job, merchant, reference'
        />
        {result.ok ? (
          <>
            {result.data.truncated && (
              <p className='text-muted-foreground text-sm'>
                Showing {result.data.count} of {result.data.total}. Narrow the
                filters to see the rest.
              </p>
            )}
            <OrderList orders={result.data.orders} />
          </>
        ) : (
          <ReadFailureState failure={result.error} />
        )}
      </div>
    </PageContainer>
  );
}
