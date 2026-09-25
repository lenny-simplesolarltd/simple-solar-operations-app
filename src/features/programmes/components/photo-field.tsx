'use client';

import type { FieldControlProps } from '@/features/forms/components/form-renderer';
import {
  EVIDENCE_ACCEPT,
  evidenceFileProblem,
  formatBytes
} from '@/features/operations/evidence-rules';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { IconCamera, IconLoader2, IconTrash } from '@tabler/icons-react';
import { useId, useRef, useState } from 'react';
import {
  beginVisitPhotoAction,
  completeVisitPhotoAction
} from '../server/actions';
import { evidenceCategory } from '../labels';

/**
 * The photo control for a visit form.
 *
 * Each chosen file goes through the canonical three-step evidence upload as soon
 * as it is chosen - register, send the bytes to a one-off signed URL, confirm -
 * so by the time the form is submitted every photograph is already durable and
 * the submission only names it. That is deliberate: on a doorstep the upload is
 * the slow, flaky part, and doing it at submit time would mean a failed submit
 * loses the photographs.
 *
 * The answer is the list of canonical evidence ids. Nothing about a programme is
 * decided here: the server checks that each id is a registration of this visit,
 * by this person, of the expected kind.
 */
export function VisitPhotoField({
  field,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
  visitId,
  category,
  disabled
}: FieldControlProps<string[]> & {
  visitId: string | null;
  /** Which kind of evidence this question collects. From the programme's field map. */
  category: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const picker = useRef<HTMLInputElement>(null);
  const max = field.max ?? 4;
  const full = value.length >= max;
  const helpId = useId();

  async function add(files: FileList | null) {
    if (!files?.length || !visitId) return;
    setProblem(null);
    // Accumulated locally: several files can finish while this loop runs, and
    // `value` is the list from the render that started it.
    let added = [...value];
    const room = max - added.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room)
      setProblem(
        `Only ${max} ${max === 1 ? 'file' : 'files'} can be added here, so ${files.length - room} ${files.length - room === 1 ? 'was' : 'were'} left out.`
      );

    for (const file of chosen) {
      const early = evidenceFileProblem(file);
      if (early) {
        setProblem(early);
        continue;
      }
      setBusy((n) => n + 1);
      try {
        const uploadId = crypto.randomUUID();
        const begun = await beginVisitPhotoAction({
          uploadId,
          visitId,
          category,
          file: { name: file.name, type: file.type, size: file.size }
        });
        if (!begun.ok) {
          setProblem(begun.message);
          continue;
        }
        if (begun.token) {
          const { createClient } = await import('@/lib/supabase/client');
          const supabase = createClient();
          const sent = await supabase.storage
            .from('evidence')
            .uploadToSignedUrl(begun.path, begun.token, file, {
              contentType: file.type || undefined
            });
          if (sent.error) {
            setProblem('That photo did not upload. Try again.');
            continue;
          }
          const done = await completeVisitPhotoAction(begun.evidenceId);
          if (!done.ok) {
            setProblem(done.message);
            continue;
          }
        }
        setNames((n) => ({ ...n, [begun.evidenceId]: file.name }));
        added = [...added, begun.evidenceId].slice(0, max);
        onChange(added);
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (picker.current) picker.current.value = '';
  }

  return (
    <div className='flex flex-col gap-2'>
      <input
        ref={picker}
        id={inputId}
        type='file'
        // `capture` opens the camera directly on a phone; a laptop shows the
        // normal picker, so one control works in both places.
        capture='environment'
        accept={EVIDENCE_ACCEPT}
        multiple={max > 1}
        className='sr-only'
        aria-describedby={[describedBy, helpId].filter(Boolean).join(' ')}
        aria-invalid={invalid || undefined}
        disabled={disabled || !visitId || full}
        onChange={(e) => void add(e.target.files)}
      />

      {value.length > 0 && (
        <ul className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
          {value.map((id) => (
            <li
              key={id}
              className='bg-muted/40 relative overflow-hidden rounded-lg border'
            >
              {/* The canonical evidence route: a 60-second signed URL minted
                  under this person's own session. No permanent URL exists. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL behind a redirect */}
              <img
                src={`/api/evidence/${id}`}
                alt={names[id] ?? `${evidenceCategory(category)} photo`}
                className='aspect-square w-full object-cover'
              />
              <Button
                type='button'
                size='icon'
                variant='secondary'
                aria-label={`Remove ${names[id] ?? 'this photo'}`}
                onClick={() => onChange(value.filter((x) => x !== id))}
                className='absolute top-1 right-1 size-8 rounded-full opacity-90'
              >
                <IconTrash aria-hidden className='size-4' />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type='button'
        variant='outline'
        // A doorstep target: full width, 48px tall.
        className={cn(
          'h-12 w-full justify-center',
          invalid && 'border-destructive'
        )}
        disabled={disabled || !visitId || full || busy > 0}
        onClick={() => picker.current?.click()}
      >
        {busy > 0 ? (
          <IconLoader2 aria-hidden className='animate-spin' />
        ) : (
          <IconCamera aria-hidden />
        )}
        {busy > 0
          ? `Uploading ${busy} ${busy === 1 ? 'photo' : 'photos'}…`
          : value.length
            ? 'Add another photo'
            : 'Take or choose a photo'}
      </Button>

      <p id={helpId} className='text-muted-foreground text-xs'>
        {full
          ? `${max} of ${max} added.`
          : `${value.length} of ${max} added. Photos are saved as soon as you take them, so they are not lost if you lose signal.`}
      </p>
      {problem && (
        <p role='alert' className='text-destructive text-sm font-medium'>
          {problem}
        </p>
      )}
    </div>
  );
}

/** A read-only strip of a visit's photographs, for the review screen. */
export function EvidenceStrip({
  evidence,
  className
}: {
  evidence: {
    id: string;
    category: string;
    filename: string;
    mimeType: string | null;
  }[];
  className?: string;
}) {
  if (evidence.length === 0)
    return (
      <p className='text-muted-foreground text-sm'>No photographs recorded.</p>
    );
  return (
    <ul
      className={cn(
        'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4',
        className
      )}
    >
      {evidence.map((e) => (
        <li key={e.id} className='overflow-hidden rounded-lg border'>
          <a
            href={`/api/evidence/${e.id}`}
            target='_blank'
            rel='noreferrer'
            className='focus-visible:ring-ring block focus-visible:ring-2'
          >
            {e.mimeType === 'application/pdf' ? (
              <div className='bg-muted flex aspect-square items-center justify-center text-xs'>
                PDF
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL behind a redirect */
              <img
                src={`/api/evidence/${e.id}`}
                alt={`${evidenceCategory(e.category)}: ${e.filename}`}
                className='aspect-square w-full bg-black/5 object-cover'
              />
            )}
          </a>
          <p className='px-2 py-1.5 text-xs font-medium'>
            {evidenceCategory(e.category)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export { formatBytes };
