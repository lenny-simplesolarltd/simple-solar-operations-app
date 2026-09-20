'use client';

import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { evidenceCategoryLabel } from '@/features/operations/evidence-rules';
import { IconLoader2 } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchFileDetails } from '../actions';
import { fileTypeLabel, formatBytes } from '../format';
import type { FileDetails } from '../types';

// What a document is, where it lives, what relies on it, and what has happened
// to it. The history is the audit log itself - uploads, renames, moves, links,
// trashing and restoring are all recorded there against the document's id, so
// this panel invents nothing and nobody has to type a reason to get it.

const ACTION_WORDS: Record<string, string> = {
  Register: 'Upload started',
  Upload: 'Uploaded',
  Attach: 'Attached to work',
  Rename: 'Renamed',
  Move: 'Moved',
  Trash: 'Moved to Trash',
  Restore: 'Restored',
  Destroy: 'Permanently deleted',
  TaskLink: 'Linked to a task',
  TaskReplace: 'Replaced on a task',
  FileMissing: 'Stored file reported missing'
};

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex flex-col gap-0.5 py-2'>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className='text-sm'>{children}</dd>
    </div>
  );
}

export function DetailsSheet({
  fileId,
  open,
  onOpenChange
}: {
  fileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // One state, so nothing has to be set synchronously as the effect starts:
  // the panel is mounted for one document and begins in its loading state.
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; details: FileDetails | null }
  >({ status: 'loading' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchFileDetails(fileId).then((result) => {
      if (!cancelled) setState({ status: 'ready', details: result });
    });
    return () => {
      cancelled = true;
    };
  }, [open, fileId]);

  const loading = state.status === 'loading';
  const details = state.status === 'ready' ? state.details : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-md'>
        <SheetHeader>
          <SheetTitle className='truncate'>
            {details?.file.name ?? 'Document'}
          </SheetTitle>
          <SheetDescription>
            Where this document lives and everything that has been done to it.
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <p className='text-muted-foreground flex items-center gap-2 p-4 text-sm'>
            <IconLoader2 className='size-4 animate-spin' aria-hidden /> Loading…
          </p>
        ) : !details ? (
          <p className='p-4 text-sm'>
            That document could not be found, or you do not have access to it.
          </p>
        ) : (
          <div className='flex flex-col gap-6 p-4'>
            <dl className='divide-y'>
              <Field label='Type'>
                <Badge variant='outline'>
                  {fileTypeLabel(details.file.mimeType)}
                </Badge>{' '}
                {evidenceCategoryLabel(details.file.category)}
              </Field>
              <Field label='Size'>
                {formatBytes(details.file.sizeBytes) ?? 'Unknown'}
              </Field>
              <Field label='Added'>
                {[details.file.addedAt?.slice(0, 10), details.file.addedByName]
                  .filter(Boolean)
                  .join(' · ') || 'Unknown'}
              </Field>
              <Field label='Uploaded file name'>
                <span className='font-mono text-xs'>
                  {details.file.uploadedFilename ?? '—'}
                </span>
              </Field>
              <Field label='Where it lives'>
                {details.location.scope === 'Library' ? (
                  <span>Company documents</span>
                ) : (
                  <span>
                    {details.location.jobId ? (
                      <Link
                        href={`/dashboard/jobs/${details.location.jobId}?tab=files`}
                        className='font-mono underline'
                      >
                        {details.location.jobRef}
                      </Link>
                    ) : null}
                    {details.location.customerName
                      ? ` · ${details.location.customerName}`
                      : ''}
                  </span>
                )}
                <span className='text-muted-foreground block text-xs'>
                  {details.location.folderPath ?? 'Top level'}
                </span>
              </Field>
              {details.taskTitle && (
                <Field label='Evidence for'>{details.taskTitle}</Field>
              )}
              {details.evidenceLocked && (
                <Field label='Retention'>
                  <span className='text-muted-foreground'>
                    This document is the evidence for work that has been
                    recorded. It can be filed and renamed, but not deleted.
                  </span>
                </Field>
              )}
            </dl>

            <section>
              <h3 className='mb-2 text-sm font-semibold'>History</h3>
              {details.history.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  Nothing has been recorded yet.
                </p>
              ) : (
                <ol className='flex flex-col divide-y text-sm'>
                  {details.history.map((entry, index) => (
                    <li
                      key={`${entry.action}-${entry.at}-${index}`}
                      className='py-2'
                    >
                      <span className='font-medium'>
                        {ACTION_WORDS[entry.action] ?? entry.action}
                      </span>
                      <span className='text-muted-foreground block text-xs'>
                        {[
                          entry.at
                            ? entry.at.replace('T', ' ').slice(0, 16)
                            : null,
                          entry.byName
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {entry.from && entry.to && entry.from !== entry.to && (
                        <span className='text-muted-foreground block text-xs'>
                          {entry.from} → {entry.to}
                        </span>
                      )}
                      {entry.reason && (
                        <span className='text-muted-foreground block text-xs'>
                          {entry.reason}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
