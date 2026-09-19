'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDate } from '@/features/jobs/format';
import { OutcomeAlert } from '@/features/operations/command-dialog';
import { NoteField, TextField } from '@/features/operations/fields';
import { useCommand } from '@/features/operations/use-command';
import { IconLoader2 } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { previewMoveJob } from '../actions';
import { READINESS_REASON, type MoveJobPreview } from '../types';

// Preview activities use work package trades; MOVE_JOB calls a return visit "Return".
const ACTIVITIES = [
  { preview: 'Roof', command: 'Roof', label: 'Roof' },
  { preview: 'Electrical', command: 'Electrical', label: 'Electrical' },
  { preview: 'ReturnVisit', command: 'Return', label: 'Return visit' },
  { preview: 'Scaffold', command: 'Scaffold', label: 'Scaffold' }
];

const MATERIAL_FLAG: Record<string, string> = {
  NEED_BY_AFTER_NEW_START: 'Materials would arrive after the new start',
  DELIVERY_WELL_BEFORE_NEW_START:
    'Materials would arrive well before the new start'
};

const day = (v: string | null | undefined) => (v ? formatDate(v) : '—');

/** RP_MOVE_JOB_PREVIEW, then MOVE_JOB with the same inputs. */
export function MoveJob({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [erect, setErect] = useState('');
  const [strip, setStrip] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<MoveJobPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const { run, pending, outcome } = useCommand();

  const toggle = (a: string) => {
    setPreview(null);
    setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  };
  const trades = selected.filter((a) => a !== 'Scaffold');
  const dates = {
    ...(trades.length && start ? { planned_start: start } : {}),
    ...(trades.length && end ? { planned_end: end } : {}),
    ...(selected.includes('Scaffold') && erect
      ? { scaffold_erect: erect }
      : {}),
    ...(selected.includes('Scaffold') && strip ? { scaffold_strip: strip } : {})
  };
  const change = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPreview(null);
  };

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>What is moving</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <div className='flex flex-wrap gap-4'>
            {ACTIVITIES.map((a) => (
              <label
                key={a.preview}
                className='flex items-center gap-2 text-sm'
              >
                <Checkbox
                  checked={selected.includes(a.preview)}
                  onCheckedChange={() => toggle(a.preview)}
                />
                {a.label}
              </label>
            ))}
          </div>
          {trades.length > 0 && (
            <div className='grid gap-3 sm:grid-cols-2'>
              <TextField
                label='New start'
                type='date'
                required
                value={start}
                onChange={change(setStart)}
              />
              <TextField
                label='New end'
                type='date'
                required
                value={end}
                onChange={change(setEnd)}
              />
            </div>
          )}
          {selected.includes('Scaffold') && (
            <div className='grid gap-3 sm:grid-cols-2'>
              <TextField
                label='Scaffold up'
                type='date'
                value={erect}
                onChange={change(setErect)}
              />
              <TextField
                label='Scaffold down'
                type='date'
                value={strip}
                onChange={change(setStrip)}
              />
            </div>
          )}
          {previewError && (
            <p className='text-destructive text-sm'>{previewError}</p>
          )}
          <Button
            variant='outline'
            className='w-fit'
            disabled={selected.length === 0 || previewing}
            onClick={() =>
              startPreview(async () => {
                const r = await previewMoveJob({
                  job_id: jobId,
                  activities: selected,
                  ...dates
                });
                if (r.ok) {
                  setPreview(r.data);
                  setPreviewError(null);
                } else {
                  setPreview(null);
                  setPreviewError(r.error.message);
                }
              })
            }
          >
            {previewing && <IconLoader2 className='size-4 animate-spin' />}
            Preview the move
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
              Preview
              <Badge variant={preview.ok_to_move ? 'success' : 'warning'}>
                {preview.ok_to_move
                  ? 'No conflicts'
                  : `${preview.conflicts} conflict${preview.conflicts === 1 ? '' : 's'}`}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-3 text-sm'>
            {preview.work_packages.map((w) => (
              <div
                key={w.work_package_id}
                className='border-b pb-2 last:border-b-0'
              >
                <p className='font-medium'>
                  {w.trade}: {day(w.current.planned_start)} →{' '}
                  {day(w.proposed.planned_start)}
                  {w.proposed.planned_end !== w.proposed.planned_start &&
                    ` to ${day(w.proposed.planned_end)}`}
                </p>
                {w.people.map((p) => (
                  <p
                    key={p.person_id}
                    className={
                      p.ready ? 'text-muted-foreground' : 'text-destructive'
                    }
                  >
                    {p.display_name} ({p.role}):{' '}
                    {p.ready
                      ? 'free'
                      : p.reasons
                          .map((r) => READINESS_REASON[r] ?? r)
                          .join(', ')}
                  </p>
                ))}
              </div>
            ))}
            {preview.scaffold.map((s) => (
              <p key={s.scaffold_booking_id}>
                Scaffold ({s.status}):{' '}
                {s.moving && s.proposed
                  ? `up ${day(s.proposed.erect_planned_at)}, down ${day(s.proposed.strip_planned_at)}`
                  : 'not moving'}
                {s.acknowledgement_required_after_move &&
                  ' · the scaffolder must re-confirm'}
              </p>
            ))}
            {preview.preserved.length > 0 && (
              <p className='text-muted-foreground'>
                Not moving:{' '}
                {preview.preserved
                  .map((p) => `${p.trade} ${day(p.planned_start)}`)
                  .join(', ')}
              </p>
            )}
            {preview.materials
              .filter((m) => m.flag)
              .map((m) => (
                <p key={m.material_id} className='text-warning'>
                  {MATERIAL_FLAG[m.flag ?? ''] ?? m.flag}
                </p>
              ))}
            {preview.warnings.map((w) => (
              <p key={w} className='text-warning'>
                {w}
              </p>
            ))}
            {preview.calendar_links > 0 && (
              <p className='text-muted-foreground'>
                {preview.calendar_links} calendar entries will be updated.
              </p>
            )}
            <NoteField
              label='Reason for the move'
              required
              value={reason}
              onChange={setReason}
            />
            {outcome && <OutcomeAlert outcome={outcome} />}
            <Button
              className='w-fit'
              disabled={pending || !reason.trim()}
              onClick={() =>
                run(
                  {
                    command_type: 'MOVE_JOB',
                    job_id: jobId,
                    expected_version: preview.job_version,
                    payload: {
                      activities: selected.map(
                        (a) => ACTIVITIES.find((x) => x.preview === a)!.command
                      ),
                      reason,
                      ...dates
                    }
                  },
                  (r) =>
                    r.ok && router.push(`/dashboard/jobs/${jobId}?tab=work`)
                )
              }
            >
              {pending && <IconLoader2 className='size-4 animate-spin' />}
              Move job
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
