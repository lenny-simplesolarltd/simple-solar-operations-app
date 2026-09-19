'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OutcomeAlert } from '@/features/operations/command-dialog';
import { EvidenceField } from '@/features/operations/evidence-field';
import { NoteField, TextField } from '@/features/operations/fields';
import { useCommand } from '@/features/operations/use-command';
import { IconLoader2 } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { GoodsInDetailRead } from '../types';

type Qty = { good: string; damaged: string; short: string };

/** GOODS_IN_RECEIVE: what arrived against each outstanding line. */
export function ReceiveForm({ data }: { data: GoodsInDetailRead }) {
  const router = useRouter();
  const open = data.lines.filter((l) => Number(l.outstanding) > 0);
  const [note, setNote] = useState('');
  const [discrepancy, setDiscrepancy] = useState('');
  const [notePath, setNotePath] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, Qty>>(() =>
    Object.fromEntries(
      open.map((l) => [
        l.id,
        { good: String(Number(l.outstanding)), damaged: '', short: '' }
      ])
    )
  );
  const { run, pending, outcome } = useCommand();
  const set = (id: string, k: keyof Qty) => (v: string) =>
    setQty((p) => ({
      ...p,
      [id]: { ...p[id], [k]: v.replace(/[^0-9.]/g, '') }
    }));

  const lines = open
    .map((l) => {
      const q = qty[l.id];
      const out: Record<string, unknown> = { order_line_id: l.id };
      if (q.good) out.quantity_good = Number(q.good);
      if (q.damaged) out.quantity_damaged = Number(q.damaged);
      if (q.short) out.quantity_short = Number(q.short);
      return out;
    })
    .filter((l) => Object.keys(l).length > 1);

  if (open.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>
        Everything on this delivery has been received.
      </p>
    );
  }

  return (
    <form
      className='flex flex-col gap-4'
      onSubmit={(e) => {
        e.preventDefault();
        run(
          {
            command_type: 'GOODS_IN_RECEIVE',
            job_id: data.job_id,
            expected_version: data.expected_version,
            payload: {
              delivery_id: data.delivery_id,
              delivery_note_reference: note,
              ...(discrepancy ? { discrepancy_note: discrepancy } : {}),
              ...(notePath ? { delivery_note_path: notePath } : {}),
              lines
            }
          },
          (r) => r.ok && router.push('/dashboard/goods-in')
        );
      }}
    >
      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full min-w-[34rem] text-sm'>
          <thead className='text-muted-foreground bg-muted/50 text-left text-xs'>
            <tr>
              <th className='p-2 font-medium'>Line</th>
              <th className='p-2 text-right font-medium'>Outstanding</th>
              <th className='p-2 text-right font-medium'>Good</th>
              <th className='p-2 text-right font-medium'>Damaged</th>
              <th className='p-2 text-right font-medium'>Short</th>
            </tr>
          </thead>
          <tbody>
            {open.map((l) => (
              <tr key={l.id} className='border-t'>
                <td className='p-2'>{l.description}</td>
                <td className='p-2 text-right tabular-nums'>
                  {Number(l.outstanding)} {l.unit}
                </td>
                {(['good', 'damaged', 'short'] as const).map((k) => (
                  <td key={k} className='p-2 text-right'>
                    <Input
                      aria-label={`${k} quantity for ${l.description}`}
                      className='ml-auto h-8 w-20 text-right tabular-nums'
                      inputMode='decimal'
                      value={qty[l.id][k]}
                      onChange={(e) => set(l.id, k)(e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='grid gap-3 md:grid-cols-2'>
        <TextField
          label='Delivery note reference'
          required
          value={note}
          onChange={setNote}
        />
        <EvidenceField
          jobId={data.job_id}
          label='Photo of the delivery note'
          onUploaded={setNotePath}
        />
      </div>
      <NoteField
        label='Anything wrong with the delivery?'
        value={discrepancy}
        onChange={setDiscrepancy}
      />
      {outcome && <OutcomeAlert outcome={outcome} />}
      <div className='flex justify-end'>
        <Button
          type='submit'
          disabled={pending || !note.trim() || lines.length === 0}
        >
          {pending && <IconLoader2 className='size-4 animate-spin' />}
          Record delivery
        </Button>
      </div>
    </form>
  );
}
