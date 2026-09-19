import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { TaskStatusBadge } from '@/components/task-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate, formatDateTime } from '@/features/jobs/format';
import { OrderActions } from '@/features/materials/components/order-actions';
import { ORDER_STATUS } from '@/features/materials/labels';
import type { OrderViewRead } from '@/features/materials/types';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { isOfficeManager } from '@/lib/roles';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Merchant order | Simple Solar Operations'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderPage({
  params
}: {
  params: Promise<{ orderId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();

  const result = await readOps<OrderViewRead>('ORDER_VIEW', {
    order_id: orderId
  });
  if (!result.ok) {
    return (
      <PageContainer>
        <ReadFailureState failure={result.error} />
      </PageContainer>
    );
  }
  if (!result.data.found) notFound();
  const d = result.data;
  const status = ORDER_STATUS[d.order.status];

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'operations',
          surface: 'merchant-orders',
          view: d.job?.job_reference ?? undefined
        }}
      />
      <div className='flex w-full flex-col gap-5'>
        <Button asChild variant='ghost' size='sm' className='-ml-2 w-fit'>
          <Link href='/dashboard/orders'>
            <IconArrowLeft /> Merchant orders
          </Link>
        </Button>
        <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
          <div>
            <h1 className='text-2xl font-bold'>
              {d.merchant?.name ?? 'Order'} · {d.order.work_type}
            </h1>
            <div className='mt-1 flex flex-wrap items-center gap-2 text-sm'>
              <Badge variant={status?.variant ?? 'outline'}>
                {status?.label ?? d.order.status}
              </Badge>
              {d.acknowledgement_required && (
                <Badge variant='danger'>Needs merchant reply</Badge>
              )}
              <span className='text-muted-foreground'>
                Revision {d.order.revision}
                {d.order.supplier_reference &&
                  ` · ref ${d.order.supplier_reference}`}
                {d.job && (
                  <>
                    {' · '}
                    <Link
                      href={`/dashboard/materials/${d.job.id}`}
                      className='font-mono underline'
                    >
                      {d.job.job_reference}
                    </Link>
                  </>
                )}
              </span>
            </div>
          </div>
          {isOfficeManager(user) && <OrderActions data={d} />}
        </div>

        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead className='text-right'>Ordered</TableHead>
                <TableHead className='text-right'>Received</TableHead>
                <TableHead className='text-right'>Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className='whitespace-normal'>
                    {l.description}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {Number(l.quantity) - Number(l.cancelled_quantity)} {l.unit}
                    {Number(l.cancelled_quantity) > 0 && (
                      <span className='text-muted-foreground block text-xs'>
                        {Number(l.cancelled_quantity)} cancelled
                      </span>
                    )}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {Number(l.received_good)}
                    {Number(l.received_damaged) > 0 && (
                      <span className='text-destructive block text-xs'>
                        {Number(l.received_damaged)} damaged
                      </span>
                    )}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {Number(l.outstanding)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className='grid gap-4 md:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Deliveries</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-2 text-sm'>
              {d.deliveries.length === 0 && (
                <p className='text-muted-foreground'>None expected yet.</p>
              )}
              {d.deliveries.map((x) => (
                <div
                  key={x.id}
                  className='flex items-start justify-between gap-2 border-b pb-2 last:border-b-0'
                >
                  <span>
                    {x.expected_date ? formatDate(x.expected_date) : 'No date'}
                    {x.delivery_note_reference && (
                      <span className='text-muted-foreground block text-xs'>
                        Note {x.delivery_note_reference}
                      </span>
                    )}
                    {x.discrepancy_note && (
                      <span className='text-destructive block text-xs'>
                        {x.discrepancy_note}
                      </span>
                    )}
                  </span>
                  <span className='flex items-center gap-2'>
                    <Badge variant='outline'>
                      {x.receipt_status ?? 'Expected'}
                    </Badge>
                    {!x.actual_received_at &&
                      x.receipt_status !== 'Cancelled' && (
                        <Link
                          href={`/dashboard/goods-in/${x.id}`}
                          className='text-xs underline'
                        >
                          receive
                        </Link>
                      )}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Merchant</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-1 text-sm'>
              {d.merchant?.contacts.map((c) => (
                <p key={c.contact_id}>
                  {c.name}
                  <span className='text-muted-foreground'>
                    {' '}
                    ·{' '}
                    {c.email === 'NOT_CONFIGURED'
                      ? 'no email on file'
                      : c.email}
                  </span>
                </p>
              ))}
              {d.acknowledgements.map((a) => (
                <p key={a.id} className='text-muted-foreground text-xs'>
                  Reply to rev {a.acknowledged_revision}: {a.response}
                  {a.received_at && ` · ${formatDateTime(a.received_at)}`}
                  {a.response_text && ` · ${a.response_text}`}
                </p>
              ))}
              {d.communications.map((c) => (
                <p key={c.id} className='text-muted-foreground text-xs'>
                  {c.type} rev {c.revision ?? '-'} · {c.status}
                </p>
              ))}
            </CardContent>
          </Card>
        </div>

        {(d.tasks.length > 0 || d.issues.length > 0) && (
          <section className='flex flex-col gap-2'>
            <h2 className='text-lg font-semibold'>Tasks & issues</h2>
            <ul className='flex flex-col gap-1 text-sm'>
              {d.tasks.map((t) => (
                <li
                  key={t.id}
                  className='flex items-center justify-between gap-2'
                >
                  <Link
                    href={`/dashboard/tasks/${t.id}`}
                    className='hover:underline'
                  >
                    <span className='text-muted-foreground font-mono text-xs'>
                      {t.template_code}
                    </span>{' '}
                    {t.title}
                  </Link>
                  <TaskStatusBadge status={t.status} />
                </li>
              ))}
              {d.issues.map((i) => (
                <li
                  key={i.id}
                  className='flex items-center justify-between gap-2'
                >
                  <span>Supply issue · {i.category}</span>
                  <Badge variant='outline'>{i.status}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageContainer>
  );
}
