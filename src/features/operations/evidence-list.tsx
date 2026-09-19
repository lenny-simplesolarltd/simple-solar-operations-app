import 'server-only';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/features/jobs/format';
import { IconDownload, IconExternalLink } from '@tabler/icons-react';
import {
  getEvidence,
  type EvidenceItem,
  type EvidenceScope
} from './evidence-queries';
import { evidenceCategoryLabel, formatBytes } from './evidence-rules';

// The evidence of one job, task or work package, as the signed-in person may
// see it (see ./evidence-queries). Files open through /api/evidence/<id>,
// which authorizes again and issues a one-minute link.

export {
  getEvidence,
  type EvidenceItem,
  type EvidenceScope
} from './evidence-queries';

export async function EvidenceList({
  scope,
  empty = 'No files yet.',
  showTask = false
}: {
  scope: EvidenceScope;
  empty?: string;
  /** Name the task each file belongs to (job-wide lists). */
  showTask?: boolean;
}) {
  const items = await getEvidence(scope);
  if (items === null)
    return (
      <p className='text-muted-foreground text-sm'>
        Files could not be loaded. Refresh to try again.
      </p>
    );
  if (items.length === 0)
    return <p className='text-muted-foreground text-sm'>{empty}</p>;

  return (
    <ul className='flex flex-col divide-y text-sm'>
      {items.map((e) => (
        <EvidenceRow key={e.id} item={e} showTask={showTask} />
      ))}
    </ul>
  );
}

/** One file: name, category, who added it and when, Open / Download. */
export function EvidenceRow({
  item: e,
  showTask = false
}: {
  item: EvidenceItem;
  showTask?: boolean;
}) {
  const meta = [
    e.added_at ? formatDateTime(e.added_at) : null,
    e.added_by_name,
    formatBytes(e.size_bytes),
    showTask ? e.task_title : null
  ].filter(Boolean);
  return (
    <li className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0'>
      <div className='min-w-0'>
        <p className='flex flex-wrap items-center gap-2 font-medium'>
          <span className='truncate'>{e.filename ?? 'File'}</span>
          <Badge variant='outline'>{evidenceCategoryLabel(e.category)}</Badge>
          {e.current === false && <Badge variant='secondary'>Replaced</Badge>}
        </p>
        <p className='text-muted-foreground text-xs'>{meta.join(' · ')}</p>
      </div>
      {e.can_open ? (
        <EvidenceLinks id={e.id} filename={e.filename} />
      ) : (
        <span className='text-muted-foreground text-xs'>
          Reference only - no stored file
        </span>
      )}
    </li>
  );
}

/** Open (one-minute signed link, new tab) and Download for one file. */
export function EvidenceLinks({
  id,
  filename
}: {
  id: string;
  filename: string | null;
}) {
  return (
    <div className='flex shrink-0 items-center gap-1'>
      <Button asChild size='sm' variant='outline'>
        <a
          href={`/api/evidence/${id}`}
          target='_blank'
          rel='noopener noreferrer'
        >
          <IconExternalLink className='size-4' /> Open
        </a>
      </Button>
      <Button asChild size='sm' variant='ghost'>
        <a
          href={`/api/evidence/${id}?download=1`}
          aria-label={`Download ${filename ?? 'file'}`}
        >
          <IconDownload className='size-4' /> Download
        </a>
      </Button>
    </div>
  );
}
