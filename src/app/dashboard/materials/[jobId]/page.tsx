import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate } from '@/features/jobs/format';
import { getJobDetail } from '@/features/jobs/server/queries';
import {
  AddMaterial,
  BuildOrders,
  StockLineActions
} from '@/features/materials/components/material-actions';
import { OrderList } from '@/features/materials/components/order-list';
import { MATERIAL_STATE } from '@/features/materials/labels';
import {
  getMerchantOptions,
  getProductOptions
} from '@/features/materials/server/queries';
import type {
  MaterialRequirementsRead,
  OrdersListRead,
  StockPickingRead
} from '@/features/materials/types';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { isOfficeManager } from '@/lib/roles';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Job materials | Simple Solar Operations'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobMaterialsPage({
  params
}: {
  params: Promise<{ jobId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const { jobId } = await params;
  if (!UUID.test(jobId)) notFound();

  const detail = await getJobDetail(jobId);
  if (!detail) notFound();
  const { job } = detail;

  const [requirements, orders, picking, products, merchants] =
    await Promise.all([
      readOps<MaterialRequirementsRead>('MATERIAL_REQUIREMENTS', {
        job_id: jobId
      }),
      readOps<OrdersListRead>('ORDERS_LIST', { job_id: jobId }),
      readOps<StockPickingRead>('STOCK_JOB_PICKING', {
        payload: { job_id: jobId }
      }),
      getProductOptions(),
      getMerchantOptions()
    ]);
  // Ordering commands: Admin, Manager, Office (and assigned to the job; the command checks that).
  const canOrder = isOfficeManager(user);
  const toOrder = requirements.ok ? requirements.data.to_order : 0;

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'materials', view: job.job_ref }}
      />
      <div className='flex w-full flex-col gap-5'>
        <Button asChild variant='ghost' size='sm' className='-ml-2 w-fit'>
          <Link href='/dashboard/materials'>
            <IconArrowLeft /> Materials
          </Link>
        </Button>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold'>Materials · {job.job_ref}</h1>
            <p className='text-muted-foreground text-sm'>
              {job.customers.first_name} {job.customers.last_name} ·{' '}
              {job.customers.postcode} ·{' '}
              <Link
                href={`/dashboard/jobs/${job.id}`}
                className='underline underline-offset-4'
              >
                open job
              </Link>
            </p>
          </div>
          {canOrder && (
            <div className='flex flex-wrap gap-2'>
              <AddMaterial
                jobId={job.id}
                jobVersion={job.version}
                products={products}
                merchants={merchants}
              />
              <BuildOrders jobId={job.id} pending={toOrder} />
            </div>
          )}
        </div>

        <section className='flex flex-col gap-2'>
          <h2 className='text-lg font-semibold'>Requirements</h2>
          {!requirements.ok ? (
            <ReadFailureState failure={requirements.error} />
          ) : requirements.data.items.length === 0 ? (
            <EmptyState
              title='No material lines yet'
              description='Lines come from the booking form or can be added here.'
            />
          ) : (
            <div className='overflow-x-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className='text-right'>Qty</TableHead>
                    <TableHead>Merchant</TableHead>
                    <TableHead>Needed by</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requirements.data.items.map((m) => (
                    <TableRow key={m.material_id}>
                      <TableCell className='max-w-sm whitespace-normal'>
                        {m.product_name ?? m.description}
                        <span className='text-muted-foreground block text-xs'>
                          {m.work_type}
                        </span>
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {m.quantity} {m.unit}
                        {(m.received_good > 0 || m.received_damaged > 0) && (
                          <span className='text-muted-foreground block text-xs'>
                            {m.received_good} in
                            {m.received_damaged > 0 &&
                              `, ${m.received_damaged} damaged`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {m.source === 'Stock'
                          ? 'Our stock'
                          : (m.merchant ?? '-')}
                      </TableCell>
                      <TableCell className='whitespace-nowrap'>
                        {m.need_by_date ? formatDate(m.need_by_date) : '-'}
                        {m.lead_time_risk?.at_risk && (
                          <span className='text-destructive block text-xs'>
                            Order by{' '}
                            {formatDate(m.lead_time_risk.latest_order_date)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            MATERIAL_STATE[m.state]?.variant ?? 'outline'
                          }
                        >
                          {MATERIAL_STATE[m.state]?.label ?? m.state}
                        </Badge>
                        {m.order_id && (
                          <Link
                            href={`/dashboard/orders/${m.order_id}`}
                            className='ml-2 text-xs underline'
                          >
                            order
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className='flex flex-col gap-2'>
          <h2 className='text-lg font-semibold'>Merchant orders</h2>
          {orders.ok ? (
            <OrderList orders={orders.data.orders} showJob={false} />
          ) : (
            <ReadFailureState failure={orders.error} />
          )}
        </section>

        {picking.ok && picking.data.items.length > 0 && (
          <section className='flex flex-col gap-2'>
            <h2 className='text-lg font-semibold'>
              From our stock{' '}
              <Badge
                variant={
                  picking.data.summary === 'Blocked' ? 'danger' : 'secondary'
                }
              >
                {picking.data.summary}
              </Badge>
            </h2>
            <ul className='flex flex-col gap-2'>
              {picking.data.items.map((i) => (
                <li
                  key={i.material_id}
                  className='bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm'
                >
                  <span>
                    <span className='font-medium'>
                      {i.product_name ?? 'Unmapped product'}
                    </span>
                    <span className='text-muted-foreground block text-xs tabular-nums'>
                      need {i.required} · reserved {i.reserved} · picked{' '}
                      {i.picked} · issued {i.issued}
                      {i.available != null && ` · ${i.available} available`}
                    </span>
                    {i.issues.map((x) => (
                      <span key={x} className='text-destructive block text-xs'>
                        {x}
                      </span>
                    ))}
                  </span>
                  {i.outstanding > 0 || i.reservation_id ? (
                    <StockLineActions jobId={job.id} item={i} />
                  ) : (
                    <Badge variant='success'>Issued</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageContainer>
  );
}
