import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDateTime } from '@/features/jobs/format';
import {
  StartStocktake,
  StockProductActions,
  StocktakePanel
} from '@/features/materials/components/stock-actions';
import type { StockOverviewRead } from '@/features/materials/types';
import { ListFilters } from '@/features/operations/list-filters';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Stock | Simple Solar Operations' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

export default async function StockPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const q = first((await searchParams).q).slice(0, 120);
  const result = await readOps<StockOverviewRead>('STOCK_OVERVIEW', { q });

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'operations', surface: 'stock' }} />
      <div className='flex w-full flex-col gap-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading
            title='Stock'
            description='What is in the store, set aside for jobs and in quarantine. Balances come from the stock ledger.'
          />
          {result.ok &&
            result.data.configured &&
            result.data.stocktakes.length === 0 && <StartStocktake />}
        </div>
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : !result.data.configured ? (
          <EmptyState
            title='Stock locations are not set up'
            description='A store and a quarantine location must be configured before stock can be counted.'
          />
        ) : (
          <>
            {result.data.stocktakes.map((s) => (
              <section
                key={s.id}
                className='flex flex-col gap-2 rounded-lg border p-3'
              >
                <h2 className='flex flex-wrap items-center gap-2 font-semibold'>
                  Stocktake · {s.location ?? 'Store'}
                  <Badge
                    variant={s.status === 'Review' ? 'warning' : 'secondary'}
                  >
                    {s.status}
                  </Badge>
                  <span className='text-muted-foreground text-xs font-normal'>
                    started {formatDateTime(s.cut_off_at)}
                  </span>
                </h2>
                <StocktakePanel stocktake={s} />
              </section>
            ))}
            <ListFilters searchPlaceholder='Search product or SKU' />
            {result.data.products.length === 0 ? (
              <EmptyState title='No stock-tracked products' />
            ) : (
              <div className='overflow-x-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className='text-right'>In store</TableHead>
                      <TableHead className='text-right'>Reserved</TableHead>
                      <TableHead className='text-right'>Available</TableHead>
                      <TableHead className='text-right'>Quarantine</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.products.map((p) => (
                      <TableRow key={p.product_id}>
                        <TableCell className='whitespace-normal'>
                          {p.name}
                          <span className='text-muted-foreground block text-xs'>
                            {p.sku} · {p.unit}
                          </span>
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {Number(p.store_balance)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {Number(p.reserved)}
                        </TableCell>
                        <TableCell
                          className={
                            Number(p.available) <= 0
                              ? 'text-destructive text-right font-medium tabular-nums'
                              : 'text-right tabular-nums'
                          }
                        >
                          {Number(p.available)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {Number(p.quarantine_balance)}
                        </TableCell>
                        <TableCell className='text-right'>
                          <StockProductActions product={p} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
