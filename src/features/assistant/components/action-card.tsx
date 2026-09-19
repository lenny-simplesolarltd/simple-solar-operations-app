import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconLoader2
} from '@tabler/icons-react';
import type { ConversationItem } from '../lib/conversation';
import { ResultCard } from './result-cards';

type Proposal = Extract<ConversationItem, { kind: 'proposal' }>;

const time = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit'
});

/**
 * The confirmation card for a proposed change. It is the ONLY way a mutation
 * runs: the buttons send the server-signed token back, nothing else.
 */
export function ActionCard({
  item,
  onDecide,
  onNavigate
}: {
  item: Proposal;
  onDecide(actionId: string, decision: 'confirm' | 'cancel'): void;
  onNavigate?: () => void;
}) {
  const { action, state } = item;
  const open = state === 'pending' || state === 'working';
  const canRetry = state === 'failed' && item.retryable;

  return (
    <div
      role='group'
      aria-label={`Proposed change: ${action.title}`}
      className={cn(
        'bg-background overflow-hidden rounded-lg border',
        open && 'border-l-brand border-l-4'
      )}
    >
      <div className='flex flex-col gap-1 px-3 pt-3'>
        <p className='text-muted-foreground text-[11px] font-semibold tracking-wide uppercase'>
          {open ? 'Needs your confirmation' : 'Proposed change'}
        </p>
        <h3 className='text-sm font-semibold'>{action.title}</h3>
        <p className='text-muted-foreground text-sm'>{action.summary}</p>
      </div>

      {action.changes.length > 0 && (
        <dl className='mx-3 mt-2 divide-y rounded-md border text-sm'>
          {action.changes.map((change) => (
            <div
              key={change.label}
              className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-2.5 py-1.5'
            >
              <dt className='text-muted-foreground'>{change.label}</dt>
              <dd className='font-medium'>
                {change.from !== undefined && (
                  <>
                    <span className='text-muted-foreground line-through'>
                      {change.from}
                    </span>
                    <span aria-hidden> → </span>
                    <span className='sr-only'> changes to </span>
                  </>
                )}
                {change.to}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {action.warnings.map((warning) => (
        <p
          key={warning}
          className='bg-warning-soft text-warning mx-3 mt-2 flex gap-1.5 rounded-md px-2.5 py-1.5 text-xs'
        >
          <IconAlertTriangle aria-hidden className='mt-px size-3.5 shrink-0' />
          {warning}
        </p>
      ))}

      <div className='mt-3 border-t px-3 py-2.5' aria-live='polite'>
        {open && (
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              size='sm'
              disabled={state === 'working'}
              onClick={() => onDecide(action.actionId, 'confirm')}
            >
              {state === 'working' && (
                <IconLoader2 aria-hidden className='animate-spin' />
              )}
              {action.confirmLabel}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={state === 'working'}
              onClick={() => onDecide(action.actionId, 'cancel')}
            >
              Cancel
            </Button>
            <p className='text-muted-foreground ml-auto text-xs'>
              No changes have been made yet · expires{' '}
              {time.format(new Date(action.expiresAt))}
            </p>
          </div>
        )}
        {state === 'confirmed' && (
          <p className='text-success flex items-center gap-1.5 text-sm font-medium'>
            <IconCircleCheck aria-hidden className='size-4' />
            {item.message ?? 'Done.'}
          </p>
        )}
        {state === 'cancelled' && (
          <p className='text-muted-foreground flex items-center gap-1.5 text-sm'>
            <IconCircleX aria-hidden className='size-4' />
            {item.message ?? 'Cancelled. Nothing was changed.'}
          </p>
        )}
        {state === 'failed' && (
          <div className='flex flex-wrap items-center gap-2'>
            <p className='text-destructive min-w-0 flex-1 text-sm'>
              {item.message}
            </p>
            {canRetry && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => onDecide(action.actionId, 'confirm')}
              >
                Try again
              </Button>
            )}
          </div>
        )}
      </div>

      {item.display && (
        <div className='border-t p-3'>
          <ResultCard card={item.display} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}
