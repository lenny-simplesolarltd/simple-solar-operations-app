import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate } from '@/features/jobs/format';
import { ReceiveForm } from '@/features/materials/components/receive-form';
import type { GoodsInDetailRead } from '@/features/materials/types';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Receive delivery | Simple Solar Operations'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReceiveDeliveryPage({
  params
}: {
  params: Promise<{ deliveryId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const { deliveryId } = await params;
  if (!UUID.test(deliveryId)) notFound();

  // Stock reads take their parameters under `payload`.
  const result = await readOps<GoodsInDetailRead>('GOODS_IN_DETAIL', {
    payload: { delivery_id: deliveryId }
  });

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'goods-in', view: 'receive' }}
      />
      <div className='flex w-full max-w-4xl flex-col gap-4'>
        <Button asChild variant='ghost' size='sm' className='-ml-2 w-fit'>
          <Link href='/dashboard/goods-in'>
            <IconArrowLeft /> Goods in
          </Link>
        </Button>
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : (
          <>
            <div>
              <h1 className='text-2xl font-bold'>
                Receive delivery · {result.data.job_ref}
              </h1>
              <p className='text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm'>
                {result.data.job_label}
                {result.data.expected_date && (
                  <span>
                    · expected {formatDate(result.data.expected_date)}
                  </span>
                )}
                <Badge variant='outline'>
                  {result.data.receipt_status ?? 'Expected'}
                </Badge>
                <Link
                  href={`/dashboard/orders/${result.data.order_id}`}
                  className='underline underline-offset-4'
                >
                  order
                </Link>
              </p>
            </div>
            <ReceiveForm data={result.data} />
          </>
        )}
      </div>
    </PageContainer>
  );
}
