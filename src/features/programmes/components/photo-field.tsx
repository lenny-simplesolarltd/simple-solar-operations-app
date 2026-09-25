'use client';

import type { FieldControlProps } from '@/features/forms/components/form-renderer';
import {
  EVIDENCE_ACCEPT,
  evidenceFileProblem,
  formatBytes
} from '@/features/operations/evidence-rules';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconCamera,
  IconCheck,
  IconLoader2,
  IconRefresh,
  IconTrash
} from '@tabler/icons-react';
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
/**
 * One file on its way up. It is kept, with the File itself, until it either
 * lands or is given up on: a doorstep upload fails often enough that "it
 * failed" has to be visible per photograph, and retrying has to re-send the
 * same bytes rather than ask the person to open the camera again.
 */
interface PendingUpload {
  key: string;
  file: File;
  name: string;
  state: 'uploading' | 'failed';
  message?: string;
}

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
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const picker = useRef<HTMLInputElement>(null);
  const max = field.max ?? 4;
  const uploading = pending.filter((p) => p.state === 'uploading').length;
  const failed = pending.filter((p) => p.state === 'failed').length;
  // An upload still in flight has already claimed its place, so the count that
  // decides whether there is room includes it.
  const full = value.length + uploading >= max;
  const helpId = useId();

  const markFailed = (key: string, message: string) =>
    setPending((list) =>
      list.map((p) => (p.key === key ? { ...p, state: 'failed', message } : p))
    );

  /**
   * Register, send the bytes, confirm. `current` is passed in rather than read
   * from `value`, because several of these run at once and each needs the list
   * as it stands when it finishes, not as it was when it started.
   */
  async function send(file: File, key: string, current: string[]) {
    try {
      const uploadId = crypto.randomUUID();
      const begun = await beginVisitPhotoAction({
        uploadId,
        visitId: visitId!,
        category,
        file: { name: file.name, type: file.type, size: file.size }
      });
      if (!begun.ok) {
        markFailed(key, begun.message);
        return current;
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
          markFailed(key, 'The photo did not reach us.');
          return current;
        }
        const done = await completeVisitPhotoAction(begun.evidenceId);
        if (!done.ok) {
          markFailed(key, done.message);
          return current;
        }
      }
      setNames((n) => ({ ...n, [begun.evidenceId]: file.name }));
      setPending((list) => list.filter((p) => p.key !== key));
      const next = [...current, begun.evidenceId].slice(0, max);
      onChange(next);
      return next;
    } catch {
      // A lost connection mid-upload throws rather than returning a refusal.
      markFailed(key, 'The photo did not reach us.');
      return current;
    }
  }

  async function add(files: FileList | null) {
    if (!files?.length || !visitId) return;
    setProblem(null);
    // Accumulated locally: several files can finish while this loop runs, and
    // `value` is the list from the render that started it.
    let added = [...value];
    const room = max - (added.length + uploading);
    const chosen = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > chosen.length) {
      const left = files.length - chosen.length;
      setProblem(
        `Only ${max} ${max === 1 ? 'file' : 'files'} can be added here, so ${left} ${left === 1 ? 'was' : 'were'} left out.`
      );
    }

    for (const file of chosen) {
      const early = evidenceFileProblem(file);
      if (early) {
        setProblem(early);
        continue;
      }
      const key = crypto.randomUUID();
      setPending((list) => [
        ...list,
        { key, file, name: file.name, state: 'uploading' }
      ]);
      added = await send(file, key, added);
    }
    if (picker.current) picker.current.value = '';
  }

  async function retry(item: PendingUpload, current: string[]) {
    setPending((list) =>
      list.map((p) =>
        p.key === item.key
          ? { ...p, state: 'uploading', message: undefined }
          : p
      )
    );
    await send(item.file, item.key, current);
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
              <span className='bg-success text-background absolute bottom-1 left-1 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium'>
                <IconCheck aria-hidden className='size-3' />
                Saved
              </span>
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

      {pending.length > 0 && (
        <ul className='flex flex-col gap-2' aria-live='polite'>
          {pending.map((item) => (
            <li
              key={item.key}
              className={cn(
                'flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm',
                item.state === 'failed' &&
                  'border-destructive/50 bg-destructive-soft'
              )}
            >
              <div className='flex items-start gap-2'>
                {item.state === 'uploading' ? (
                  <IconLoader2
                    aria-hidden
                    className='text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin'
                  />
                ) : (
                  <IconAlertTriangle
                    aria-hidden
                    className='text-destructive mt-0.5 size-4 shrink-0'
                  />
                )}
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-medium'>{item.name}</p>
                  <p
                    className={cn(
                      'text-xs',
                      item.state === 'failed'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    )}
                  >
                    {item.state === 'uploading'
                      ? 'Uploading…'
                      : `Not saved. ${item.message ?? 'It did not upload.'}`}
                  </p>
                </div>
              </div>
              {item.state === 'failed' && (
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    variant='outline'
                    className='h-11 flex-1'
                    onClick={() => void retry(item, value)}
                  >
                    <IconRefresh aria-hidden className='size-4' />
                    Try again
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    className='h-11'
                    onClick={() =>
                      setPending((list) =>
                        list.filter((p) => p.key !== item.key)
                      )
                    }
                  >
                    Discard
                  </Button>
                </div>
              )}
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
        disabled={disabled || !visitId || full || uploading > 0}
        onClick={() => picker.current?.click()}
      >
        {uploading > 0 ? (
          <IconLoader2 aria-hidden className='animate-spin' />
        ) : (
          <IconCamera aria-hidden />
        )}
        {uploading > 0
          ? `Uploading ${uploading} ${uploading === 1 ? 'photo' : 'photos'}…`
          : value.length
            ? 'Add another photo'
            : 'Take or choose a photo'}
      </Button>

      <p id={helpId} className='text-muted-foreground text-xs'>
        {`${value.length} of ${max} saved. `}
        {failed > 0
          ? `${failed} did not upload and ${failed === 1 ? 'is' : 'are'} not saved yet.`
          : full
            ? 'Photos are saved as soon as you take them.'
            : 'Photos are saved as soon as you take them, so they are not lost if you lose signal.'}
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
