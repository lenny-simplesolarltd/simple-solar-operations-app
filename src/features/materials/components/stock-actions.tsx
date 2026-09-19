'use client';

import { Button } from '@/components/ui/button';
import { SimpleCommand } from '@/features/operations/simple-command';
import { IconCheck, IconClipboardList } from '@tabler/icons-react';
import type { StockProductRow, StocktakeRow } from '../types';

/** STOCK_OPENING_COUNT (once per product) and STOCK_QUARANTINE. */
export function StockProductActions({ product }: { product: StockProductRow }) {
  return (
    <span className='flex flex-wrap gap-1'>
      {!product.has_opening && (
        <SimpleCommand
          label='Opening count'
          title={`Opening count · ${product.name}`}
          description='Records the first counted quantity in the store. This can only be done once per product.'
          request={{
            command_type: 'STOCK_OPENING_COUNT',
            expected_version: product.version
          }}
          fields={[
            {
              key: 'quantity',
              label: `Quantity (${product.unit})`,
              kind: 'number',
              required: true
            },
            {
              key: 'reason',
              label: 'Reason',
              kind: 'note',
              required: true,
              initial: 'Opening count'
            }
          ]}
          payload={(v) => ({
            product_id: product.product_id,
            quantity: Number(v.quantity),
            reason: v.reason
          })}
        />
      )}
      <SimpleCommand
        label='Quarantine'
        title={`Quarantine · ${product.name}`}
        description='Moves damaged or suspect stock out of the usable store. It cannot be moved back from here.'
        request={{
          command_type: 'STOCK_QUARANTINE',
          expected_version: product.version
        }}
        fields={[
          {
            key: 'quantity',
            label: `Quantity (${product.unit})`,
            kind: 'number',
            required: true
          },
          { key: 'reason', label: 'Reason', kind: 'note', required: true }
        ]}
        // expected_balance guards against someone else moving stock meanwhile.
        payload={(v) => ({
          product_id: product.product_id,
          quantity: Number(v.quantity),
          expected_balance: Number(product.store_balance),
          reason: v.reason
        })}
        disabled={Number(product.store_balance) <= 0}
        disabledReason='Nothing in the store'
      />
    </span>
  );
}

export function StartStocktake() {
  return (
    <SimpleCommand
      label='Start stocktake'
      icon={<IconClipboardList />}
      title='Start a store stocktake'
      description='Freezes the expected quantity of every stock-tracked product now. Count each one, then approve to post any differences.'
      request={{ command_type: 'STOCKTAKE_START' }}
      payload={() => ({})}
    />
  );
}

/** STOCKTAKE_COUNT per line and STOCKTAKE_APPROVE once every line is counted. */
export function StocktakePanel({ stocktake }: { stocktake: StocktakeRow }) {
  return (
    <div className='flex flex-col gap-2'>
      <ul className='divide-y rounded-lg border text-sm'>
        {stocktake.items.map((i) => (
          <li
            key={i.product_id}
            className='flex flex-wrap items-center justify-between gap-2 p-2'
          >
            <span>
              {i.name}{' '}
              <span className='text-muted-foreground text-xs'>{i.sku}</span>
              <span className='text-muted-foreground block text-xs tabular-nums'>
                expected {Number(i.expected)}
                {i.counted != null && ` · counted ${Number(i.counted)}`}
                {i.variance != null && Number(i.variance) !== 0 && (
                  <span className='text-destructive'>
                    {' '}
                    · variance {Number(i.variance)}
                  </span>
                )}
              </span>
            </span>
            {stocktake.status !== 'Approved' && (
              <SimpleCommand
                label={i.counted == null ? 'Count' : 'Recount'}
                title={`Count · ${i.name}`}
                description='A difference from the expected quantity needs a reason.'
                request={{ command_type: 'STOCKTAKE_COUNT' }}
                fields={[
                  {
                    key: 'counted_quantity',
                    label: `Counted (${i.unit})`,
                    kind: 'number',
                    required: true
                  },
                  {
                    key: 'count_basis',
                    label: 'Counted as at',
                    kind: 'select',
                    initial: 'AtCutOff',
                    options: [
                      { value: 'AtCutOff', label: 'The stocktake start' },
                      {
                        value: 'AtCount',
                        label: 'Now (stock moved since the start)'
                      }
                    ]
                  },
                  {
                    key: 'reason',
                    label: 'Reason for any difference',
                    kind: 'note'
                  }
                ]}
                payload={(v) => ({
                  stocktake_id: stocktake.id,
                  product_id: i.product_id,
                  counted_quantity: Number(v.counted_quantity),
                  count_basis: v.count_basis,
                  ...(v.reason ? { reason: v.reason } : {})
                })}
              />
            )}
          </li>
        ))}
      </ul>
      {stocktake.status === 'Review' ? (
        <SimpleCommand
          label='Approve stocktake'
          icon={<IconCheck />}
          variant='default'
          title='Approve stocktake'
          description={`Posts ${stocktake.variances} adjustment${stocktake.variances === 1 ? '' : 's'} to the stock ledger.`}
          request={{ command_type: 'STOCKTAKE_APPROVE' }}
          payload={() => ({ stocktake_id: stocktake.id })}
        />
      ) : (
        <Button size='sm' variant='outline' disabled className='w-fit'>
          {stocktake.counted}/{stocktake.lines} counted
        </Button>
      )}
    </div>
  );
}
