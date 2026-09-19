'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OutcomeAlert } from '@/features/operations/command-dialog';
import { EvidenceField } from '@/features/operations/evidence-field';
import { useCommand } from '@/features/operations/use-command';
import { IconLoader2 } from '@tabler/icons-react';
import { useState } from 'react';
import type { CommissioningQuestion, WorkflowRead } from '../types';

type Kind = 'number' | 'date' | 'boolean' | 'choice' | 'text';
const kindOf = (q: CommissioningQuestion): Kind => {
  if (q.allowed_values?.length) return 'choice';
  const t = q.data_type.toLowerCase();
  if (t.includes('number') || t.includes('decimal') || t.includes('int'))
    return 'number';
  if (t.includes('date')) return 'date';
  if (t.includes('bool') || t.includes('yes')) return 'boolean';
  return 'text';
};

/** The commissioning form: IW_COMMISSIONING_DRAFT then IW_COMMISSIONING_SUBMIT. */
export function CommissioningForm({
  wf,
  officeReason
}: {
  wf: WorkflowRead;
  officeReason: boolean;
}) {
  const sub = wf.submission;
  const editable = !sub || ['Draft', 'Returned'].includes(sub.status);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      wf.answers.map((a) => [
        a.question_key,
        a.value_text ??
          (a.value_number != null ? String(a.value_number) : null) ??
          a.value_date ??
          (a.value_boolean != null ? (a.value_boolean ? 'true' : 'false') : '')
      ])
    )
  );
  const [photo, setPhoto] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const draft = useCommand();
  const submit = useCommand();

  const answers = wf.questions
    .filter((q) => (values[q.question_key] ?? '') !== '')
    .map((q) => {
      const v = values[q.question_key];
      const k = kindOf(q);
      return {
        question_key: q.question_key,
        ...(k === 'number' ? { value_number: Number(v) } : {}),
        ...(k === 'date' ? { value_date: v } : {}),
        ...(k === 'boolean' ? { value_boolean: v === 'true' } : {}),
        ...(k === 'text' || k === 'choice' ? { value_text: v } : {})
      };
    });

  const saveDraft = () =>
    draft.run({
      command_type: 'IW_COMMISSIONING_DRAFT',
      job_id: wf.job_id,
      work_package_id: wf.work_package_id,
      expected_version: wf.expected_version,
      payload: {
        ...(sub && ['Draft', 'Returned'].includes(sub.status)
          ? {
              submission_id: sub.id,
              expected_submission_version: sub.expected_version
            }
          : {}),
        ...(answers.length ? { answers } : {}),
        ...(photo
          ? {
              evidence: [
                { storage_path: photo, filename: photo.split('/').pop() }
              ]
            }
          : {}),
        ...(officeReason ? { reason } : {})
      }
    });

  return (
    <div className='flex flex-col gap-4'>
      {sub && (
        <p className='flex flex-wrap items-center gap-2 text-sm'>
          <Badge
            variant={
              sub.status === 'Returned'
                ? 'danger'
                : sub.status === 'Accepted'
                  ? 'success'
                  : 'secondary'
            }
          >
            {sub.status}
          </Badge>
          {sub.review_notes && (
            <span className='text-muted-foreground'>
              Office notes: {sub.review_notes}
            </span>
          )}
        </p>
      )}
      {wf.questions.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          No approved commissioning template for {wf.trade} yet. Photos can
          still be attached and submitted.
        </p>
      )}
      {editable && (
        <>
          <div className='grid gap-3 md:grid-cols-2'>
            {wf.questions
              .slice()
              .sort((a, b) => a.display_order - b.display_order)
              .map((q) => {
                const k = kindOf(q);
                const id = `q-${q.question_key}`;
                const value = values[q.question_key] ?? '';
                const set = (v: string) =>
                  setValues((p) => ({ ...p, [q.question_key]: v }));
                return (
                  <div key={q.id} className='flex flex-col gap-1.5'>
                    <Label htmlFor={id}>{q.label}</Label>
                    {k === 'boolean' ? (
                      <label className='flex items-center gap-2 text-sm'>
                        <Checkbox
                          id={id}
                          checked={value === 'true'}
                          onCheckedChange={(c) => set(c ? 'true' : 'false')}
                        />
                        Yes
                      </label>
                    ) : k === 'choice' ? (
                      <select
                        id={id}
                        className='border-input bg-background h-9 rounded-md border px-2 text-sm'
                        value={value}
                        onChange={(e) => set(e.target.value)}
                      >
                        <option value=''>Choose…</option>
                        {q.allowed_values!.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id={id}
                        type={k === 'date' ? 'date' : 'text'}
                        inputMode={k === 'number' ? 'decimal' : undefined}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                      />
                    )}
                    {q.help_text && (
                      <p className='text-muted-foreground text-xs'>
                        {q.help_text}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
          <EvidenceField
            context={{ type: 'WorkPackage', id: wf.work_package_id }}
            category='Commissioning'
            label='Commissioning photo'
            onUploaded={setPhoto}
          />
          {officeReason && (
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='comm-reason'>
                Why the office is recording this
              </Label>
              <Input
                id='comm-reason'
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
          {draft.outcome && <OutcomeAlert outcome={draft.outcome} />}
          {submit.outcome && <OutcomeAlert outcome={submit.outcome} />}
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              disabled={
                draft.pending ||
                (answers.length === 0 && !photo) ||
                (officeReason && !reason.trim())
              }
              onClick={saveDraft}
            >
              {draft.pending && <IconLoader2 className='size-4 animate-spin' />}
              Save draft
            </Button>
            {sub?.status === 'Draft' && (
              <Button
                disabled={submit.pending}
                onClick={() =>
                  submit.run({
                    command_type: 'IW_COMMISSIONING_SUBMIT',
                    job_id: wf.job_id,
                    work_package_id: wf.work_package_id,
                    expected_version: sub.expected_version,
                    payload: {
                      submission_id: sub.id,
                      ...(officeReason ? { reason } : {})
                    }
                  })
                }
              >
                {submit.pending && (
                  <IconLoader2 className='size-4 animate-spin' />
                )}
                Submit for review
              </Button>
            )}
          </div>
          <p className='text-muted-foreground text-xs'>
            Save the draft first; submitting sends the saved answers to the
            office.
          </p>
        </>
      )}
    </div>
  );
}
