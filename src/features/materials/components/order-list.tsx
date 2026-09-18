import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/features/jobs/format';
import Link from 'next/link';
import { ORDER_STATUS } from '../labels';
import type { OrderRow } from '../types';

/** Merchant orders as cards (every width); each opens the order. */
export function OrderList({
  orders,
  showJob = true
}: {
  orders: OrderRow[];
  showJob?: boolean;
}) {
  if (orders.length === 0)
    return (
      <EmptyState
        title='No orders'
        description='Orders appear once they are built.'
      />
    );
  return (
    <ul className='flex flex-col gap-2'>
      {orders.map((o) => {
        const status = ORDER_STATUS[o.status];
        return (
          <li key={o.id}>
            <Link
              href={`/dashboard/orders/${o.id}`}
              className='bg-card hover:border-primary grid gap-2 rounded-lg border p-3 text-sm transition-colors md:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] md:items-center'
            >
              <span>
                <span className='font-semibold'>
                  {o.merchant ?? 'No merchant'}
                </span>
                <span className='text-muted-foreground block text-xs'>
                  {o.work_type} · rev {o.revision}
                  {o.supplier_reference && ` · ${o.supplier_reference}`}
                </span>
              </span>
              {showJob ? (
                <span>
                  <span className='font-mono font-semibold'>
                    {o.job_ref ?? '-'}
                  </span>
                  <span className='text-muted-foreground block text-xs'>
                    {[o.customer_name, o.postcode].filter(Boolean).join(' · ')}
                  </span>
                </span>
              ) : (
                <span className='text-muted-foreground text-xs'>
                  {o.line_count} line{o.line_count === 1 ? '' : 's'}
                </span>
              )}
              <span className='text-xs'>
                {o.next_delivery?.expected_date ? (
                  <>Delivery {formatDate(o.next_delivery.expected_date)}</>
                ) : o.requested_delivery_date ? (
                  <>Requested for {formatDate(o.requested_delivery_date)}</>
                ) : (
                  <span className='text-muted-foreground'>
                    No delivery date
                  </span>
                )}
                {Number(o.outstanding) > 0 && (
                  <span className='text-muted-foreground block'>
                    {Number(o.outstanding)} outstanding
                  </span>
                )}
              </span>
              <span className='flex flex-wrap gap-1 md:justify-end'>
                <Badge variant={status?.variant ?? 'outline'}>
                  {status?.label ?? o.status}
                </Badge>
                {o.acknowledgement_required && (
                  <Badge variant='danger'>Needs merchant reply</Badge>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
