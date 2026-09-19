'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CommandDialog } from '@/features/operations/command-dialog';
import { NoteField, TextField } from '@/features/operations/fields';
import { SimpleCommand } from '@/features/operations/simple-command';
import { useCommand } from '@/features/operations/use-command';
import { IconCheck, IconEdit, IconSend, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import type { OrderViewRead } from '../types';

/** ORDER_SEND / ORDER_CONFIRM / ORDER_REVISE / ORDER_CANCEL for one order, offered by status. */
export function OrderActions({ data }: { data: OrderViewRead }) {
  const { order } = data;
  const base = { job_id: order.job_id, expected_version: order.version };
  const received = data.lines.some(
    (l) => Number(l.received_good) + Number(l.received_damaged) > 0
  );
  const canSend = ['Draft', 'Review', 'Requested'].includes(order.status);
  const canConfirm = order.status === 'Requested';
  const canRevise = ['Draft', 'Review', 'Requested', 'Confirmed'].includes(
    order.status
  );
  const canCancel = order.status !== 'Cancelled' && !received;

  return (
    <div className='flex flex-wrap gap-2'>
      {canSend && (
        <SimpleCommand
          label={order.status === 'Requested' ? 'Re-send' : 'Send to merchant'}
          icon={<IconSend />}
          variant='default'
          title='Send order to merchant'
          description='Records the order message for the merchant and starts waiting for their confirmation.'
          request={{ command_type: 'ORDER_SEND', ...base }}
          fields={[
            {
              key: 'urgent',
              label: 'Urgent?',
              kind: 'select',
              initial: 'no',
              options: [
                { value: 'no', label: 'No' },
                { value: 'yes', label: 'Yes' }
              ]
            }
          ]}
          payload={(v) => ({ order_id: order.id, urgent: v.urgent === 'yes' })}
        />
      )}
      {canConfirm && (
        <SimpleCommand
          label='Record confirmation'
          icon={<IconCheck />}
          title='Merchant confirmation'
          description={`Record the merchant's reply to revision ${order.revision}. A reply to an older revision is recorded but does not confirm the order.`}
          request={{ command_type: 'ORDER_CONFIRM', ...base }}
          fields={[
            {
              key: 'supplier_reference',
              label: 'Merchant reference',
              required: true
            },
            {
              key: 'confirmed_delivery_date',
              label: 'Confirmed delivery date',
              kind: 'date',
              initial: order.requested_delivery_date ?? ''
            },
            {
              key: 'acknowledged_revision',
              label: 'Revision they replied to',
              kind: 'number',
              initial: String(order.revision)
            },
            { key: 'response_text', label: 'Their reply', kind: 'note' }
          ]}
          // The merchant's written confirmation, attached to the job and
          // passed as evidence_id (app.job_evidence: same job, file stored).
          evidence={{
            context: { type: 'Job', id: order.job_id },
            category: 'Other',
            label: 'Their confirmation (optional)'
          }}
          payload={(v) => ({
            order_id: order.id,
            supplier_reference: v.supplier_reference,
            ...(v.confirmed_delivery_date
              ? { confirmed_delivery_date: v.confirmed_delivery_date }
              : {}),
            ...(v.acknowledged_revision
              ? { acknowledged_revision: Number(v.acknowledged_revision) }
              : {}),
            ...(v.response_text ? { response_text: v.response_text } : {})
          })}
        />
      )}
      {canRevise && <ReviseOrder data={data} />}
      {canCancel && (
        <SimpleCommand
          label='Cancel order'
          icon={<IconX />}
          variant='destructive'
          title='Cancel this order'
          description='Releases its materials so they can be re-ordered. If it was already sent, a cancellation message is recorded for the merchant.'
          request={{ command_type: 'ORDER_CANCEL', ...base }}
          fields={[
            { key: 'reason', label: 'Reason', kind: 'note', required: true }
          ]}
          payload={(v) => ({ order_id: order.id, reason: v.reason })}
        />
      )}
    </div>
  );
}

function ReviseOrder({ data }: { data: OrderViewRead }) {
  const { order } = data;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(order.requested_delivery_date ?? '');
  const [qty, setQty] = useState<Record<string, string>>({});
  const { run, pending, outcome, reset } = useCommand();
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setReason('');
      setQty({});
      setDate(order.requested_delivery_date ?? '');
    }
  };
  const lines = data.lines
    .filter(
      (l) =>
        qty[l.id] !== undefined &&
        qty[l.id] !== '' &&
        Number(qty[l.id]) !== Number(l.quantity)
    )
    .map((l) => ({ order_line_id: l.id, quantity: Number(qty[l.id]) }));
  const dateChanged = date && date !== order.requested_delivery_date;

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <IconEdit /> Revise
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title='Revise order'
        description={
          ['Requested', 'Confirmed'].includes(order.status)
            ? 'The merchant has this order: a revision goes back to them for confirmation.'
            : 'Change quantities or the delivery date before sending.'
        }
        submitLabel='Save revision'
        pending={pending}
        outcome={outcome}
        canSubmit={!!reason.trim() && (lines.length > 0 || !!dateChanged)}
        onSubmit={() =>
          run(
            {
              command_type: 'ORDER_REVISE',
              job_id: order.job_id,
              expected_version: order.version,
              payload: {
                order_id: order.id,
                reason,
                ...(dateChanged ? { requested_delivery_date: date } : {}),
                ...(lines.length ? { lines } : {})
              }
            },
            (r) => r.ok && close(false)
          )
        }
      >
        <TextField
          label='Requested delivery date'
          type='date'
          value={date}
          onChange={setDate}
        />
        <div className='flex flex-col gap-1.5'>
          {data.lines.map((l) => (
            <label
              key={l.id}
              className='flex items-center justify-between gap-2 text-sm'
            >
              <span className='min-w-0'>
                {l.description}
                {Number(l.received_good) > 0 && (
                  <span className='text-muted-foreground block text-xs'>
                    {Number(l.received_good)} received
                  </span>
                )}
              </span>
              <Input
                className='h-8 w-24 text-right tabular-nums'
                inputMode='decimal'
                placeholder={String(Number(l.quantity))}
                value={qty[l.id] ?? ''}
                onChange={(e) =>
                  setQty((p) => ({
                    ...p,
                    [l.id]: e.target.value.replace(/[^0-9.]/g, '')
                  }))
                }
              />
            </label>
          ))}
        </div>
        <NoteField
          label='Reason'
          required
          value={reason}
          onChange={setReason}
        />
      </CommandDialog>
    </>
  );
}
