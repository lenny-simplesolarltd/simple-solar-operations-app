'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconDots,
  IconDownload,
  IconEye,
  IconFileText,
  IconLoader2,
  IconMail,
  IconRefresh
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { DOCUMENT_TYPE_LABELS, type DocumentType } from '../types';
import type {
  DocumentRevisionRead,
  JobDocumentRead,
  JobDocumentsRead
} from '../server/queries';

// The Documents card.
//
// What a normal user should see here is one of four words - Queued,
// Generating, Ready, Failed - and the two or three things they can do about
// it. Template versions, hashes, attempt counts and processing ids are real
// and worth keeping, but they belong behind "Generation details" and in the
// Operations centre, not in front of somebody trying to send a customer a
// quotation.

const POLL_MS = 2500;

export interface JobDocumentsCardProps {
  documents: JobDocumentsRead;
  /** False for a role that may read documents but not ask for new ones. */
  canGenerate: boolean;
  generateAction: (
    commandId: string,
    jobId: string,
    documentType?: DocumentType
  ) => Promise<{ ok: boolean; message?: string; code?: string }>;
  pokeAction: () => Promise<void>;
}

/**
 * Where Email goes: the Communications compose screen, carrying the job and
 * the exact revision.
 *
 * Built here rather than passed in. Job Detail is a Server Component, and a
 * plain function cannot cross into a Client Component - only a 'use server'
 * action can, which is what generateAction and pokeAction are. The card
 * already has both ids, so there was never anything to pass.
 */
const composeHref = (jobId: string, revisionId: string) =>
  `/dashboard/communications/compose?job=${jobId}&revision=${revisionId}`;

const IN_FLIGHT = ['Queued', 'Generating'] as const;
const isInFlight = (r: DocumentRevisionRead | null) =>
  !!r && (IN_FLIGHT as readonly string[]).includes(r.status);

function StatusLine({ revision }: { revision: DocumentRevisionRead }) {
  const when = revision.generated_at
    ? new Date(revision.generated_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    : null;

  if (revision.status === 'Ready') {
    return (
      <p className='text-muted-foreground text-sm'>
        <span className='text-foreground font-medium'>Ready</span>
        {' · '}Revision {revision.revision_number}
        {when ? ` · Generated ${when}` : ''}
      </p>
    );
  }

  if (revision.status === 'Queued') {
    return (
      <p className='text-muted-foreground flex items-center gap-1.5 text-sm'>
        <IconLoader2 className='size-3.5 animate-spin' aria-hidden />
        {revision.attempt_count > 0 ? 'Retrying…' : 'Queued…'}
      </p>
    );
  }

  if (revision.status === 'Generating') {
    return (
      <p className='text-muted-foreground flex items-center gap-1.5 text-sm'>
        <IconLoader2 className='size-3.5 animate-spin' aria-hidden />
        <span className='text-foreground font-medium'>Generating…</span>
        <span>Preparing PDF</span>
      </p>
    );
  }

  return (
    <p className='text-destructive flex items-start gap-1.5 text-sm'>
      <IconAlertTriangle className='mt-0.5 size-3.5 shrink-0' aria-hidden />
      <span>
        <span className='font-medium'>Generation failed</span>
        {revision.error_detail?.message ? (
          <span className='text-muted-foreground block font-normal'>
            {revision.error_detail.message}
          </span>
        ) : null}
      </span>
    </p>
  );
}

/**
 * Pages the generator deliberately did not produce.
 *
 * This is not a failure and must not read like one: the MCS estimate is
 * withheld because the design data and reference tables it needs do not
 * exist, and the rest of the quotation is perfectly valid without it.
 */
function WithheldPages({ revision }: { revision: DocumentRevisionRead }) {
  if (!revision.omitted_pages?.length) return null;
  const reason = revision.omitted_pages[0]?.reason ?? '';
  const pages = revision.omitted_pages.map((p) => p.page).sort((a, b) => a - b);
  return (
    <div className='bg-muted/40 mt-3 rounded-md px-3 py-2'>
      <p className='text-sm font-medium'>MCS calculation pages</p>
      <p className='text-muted-foreground text-sm'>
        Not generated — required design and reference data unavailable
      </p>
      <details className='mt-1'>
        <summary className='text-muted-foreground hover:text-foreground cursor-pointer text-xs'>
          Why (pages {pages.join(', ')})
        </summary>
        <p className='text-muted-foreground mt-1 text-xs'>{reason}</p>
      </details>
    </div>
  );
}

function Details({ revision }: { revision: DocumentRevisionRead }) {
  const rows: [string, string | number | null][] = [
    [
      'Template',
      `${revision.details.template_id} v${revision.details.template_version}`
    ],
    ['Renderer', revision.details.renderer_version],
    ['Pages', revision.page_count],
    [
      'Size',
      revision.size_bytes
        ? `${Math.round(revision.size_bytes / 1024)} KB`
        : null
    ],
    ['Content hash', revision.details.content_sha256?.slice(0, 16) ?? null],
    ['Snapshot hash', revision.details.input_sha256?.slice(0, 16) ?? null],
    ['Attempts', revision.attempt_count],
    ['Requested', new Date(revision.requested_at).toLocaleString('en-GB')]
  ];
  return (
    <dl className='mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs'>
      {rows
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([label, v]) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='font-mono break-all'>{String(v)}</dd>
          </div>
        ))}
    </dl>
  );
}

function DocumentRow({
  document,
  jobId,
  canGenerate,
  generateAction,
  onChanged
}: {
  document: JobDocumentRead;
  jobId: string;
  canGenerate: boolean;
  generateAction: JobDocumentsCardProps['generateAction'];
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const current = document.current;
  const label = DOCUMENT_TYPE_LABELS[document.document_type];
  const ready = current?.status === 'Ready';
  const superseded = document.history.filter((h) => h.status === 'Superseded');

  const run = useCallback(() => {
    // A fresh id per press: the ledger turns a double click into a replay.
    const commandId = crypto.randomUUID();
    start(async () => {
      const result = await generateAction(
        commandId,
        jobId,
        document.document_type
      );
      if (!result.ok)
        toast.error(result.message ?? 'That could not be started.');
      else onChanged();
    });
  }, [document.document_type, generateAction, jobId, onChanged]);

  return (
    <div className='border-b px-4 py-3 last:border-b-0'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='flex items-center gap-2 font-medium'>
            <IconFileText
              className='text-muted-foreground size-4'
              aria-hidden
            />
            {label}
          </p>
          {current ? (
            <div className='mt-1'>
              <StatusLine revision={current} />
            </div>
          ) : (
            <p className='text-muted-foreground mt-1 text-sm'>
              Not generated yet
            </p>
          )}
        </div>

        <div className='flex shrink-0 items-center gap-2'>
          {ready && current?.evidence_id ? (
            <>
              <Button asChild size='sm' variant='outline'>
                <a
                  href={`/api/evidence/${current.evidence_id}`}
                  target='_blank'
                  rel='noreferrer'
                >
                  <IconEye className='size-4' aria-hidden />
                  Preview
                </a>
              </Button>
              <Button asChild size='sm' variant='outline'>
                {/* The stored revision, byte for byte. Nothing re-renders here. */}
                <a
                  href={`/api/evidence/${current.evidence_id}?download=1`}
                  download
                >
                  <IconDownload className='size-4' aria-hidden />
                  Download
                </a>
              </Button>
              <Button asChild size='sm' variant='outline'>
                <a href={composeHref(jobId, current.revision_id)}>
                  <IconMail className='size-4' aria-hidden />
                  Email
                </a>
              </Button>
            </>
          ) : null}

          {current?.status === 'Failed' && canGenerate ? (
            <Button size='sm' onClick={run} disabled={pending}>
              <IconRefresh
                className={cn('size-4', pending && 'animate-spin')}
                aria-hidden
              />
              Retry
            </Button>
          ) : null}

          {!current && canGenerate ? (
            <Button size='sm' onClick={run} disabled={pending}>
              Generate
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size='icon'
                variant='ghost'
                aria-label={`${label} actions`}
              >
                <IconDots className='size-4' aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-56'>
              {canGenerate && (
                <DropdownMenuItem
                  onSelect={run}
                  disabled={pending || isInFlight(current)}
                >
                  Regenerate
                </DropdownMenuItem>
              )}
              {superseded.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className='text-muted-foreground px-2 py-1.5 text-xs font-medium'>
                    Earlier revisions
                  </div>
                  {superseded.map((h) => (
                    <DropdownMenuItem key={h.revision_id} asChild>
                      <a
                        href={
                          h.evidence_id ? `/api/evidence/${h.evidence_id}` : '#'
                        }
                        target='_blank'
                        rel='noreferrer'
                      >
                        Revision {h.revision_number}
                        {h.generated_at
                          ? ` · ${new Date(h.generated_at).toLocaleDateString('en-GB')}`
                          : ''}
                      </a>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {current ? <WithheldPages revision={current} /> : null}

      {current ? (
        <details className='mt-2'>
          <summary className='text-muted-foreground hover:text-foreground cursor-pointer text-xs'>
            Generation details
          </summary>
          <Details revision={current} />
        </details>
      ) : null}
    </div>
  );
}

export function JobDocumentsCard({
  documents,
  canGenerate,
  generateAction,
  pokeAction
}: JobDocumentsCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const working = documents.documents.some((d) => isInFlight(d.current));

  // While anything is in flight the card refreshes itself, so a person who
  // pressed Generate watches it finish instead of wondering and reloading.
  useEffect(() => {
    if (!working) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled || busy) return;
      setBusy(true);
      try {
        await pokeAction();
        router.refresh();
      } finally {
        setBusy(false);
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [working, busy, pokeAction, router]);

  if (documents.is_historical_import) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-muted-foreground text-sm'>
            This is an imported historical record. It has no presale of record,
            so no customer documents are generated for it.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className='flex-row items-center justify-between space-y-0'>
        <CardTitle className='text-base'>Documents</CardTitle>
        {working ? (
          <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
            <IconLoader2 className='size-3 animate-spin' aria-hidden />
            Working…
          </span>
        ) : null}
      </CardHeader>
      <CardContent className='px-0 pb-0'>
        {!documents.has_presale ? (
          <p className='text-muted-foreground px-4 pb-4 text-sm'>
            This job has no presale, so there is no snapshot to generate a
            quotation or ROI from.
          </p>
        ) : (
          documents.documents.map((d) => (
            <DocumentRow
              key={d.document_type}
              document={d}
              jobId={documents.job_id}
              canGenerate={canGenerate}
              generateAction={generateAction}
              onChanged={() => router.refresh()}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
