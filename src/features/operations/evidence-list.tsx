import 'server-only';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/features/jobs/format';
import { createDataClient } from '@/lib/supabase/data';
import { IconDownload, IconExternalLink } from '@tabler/icons-react';
import { evidenceCategoryLabel, formatBytes } from './evidence-rules';

// The evidence of one job, task or work package, as the signed-in person may
// see it. public.list_evidence decides that from the evidence rows (job, work
// package, category); it never returns a storage path. Files open through
// /api/evidence/<id>, which authorizes again and issues a one-minute link.

export type EvidenceScope =
  | { job_id: string }
  | { task_id: string }
  | { work_package_id: string };

export type EvidenceItem = {
  id: string;
  job_id: string;
  task_id: string | null;
  work_package_id: string | null;
  category: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  upload_status: string;
  added_at: string | null;
  added_by_name: string | null;
  task_title: string | null;
  current: boolean | null;
  can_open: boolean;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

export async function getEvidence(
  scope: EvidenceScope
): Promise<EvidenceItem[] | null> {
  const supabase = (await createDataClient()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc('list_evidence', {
    p_request: scope
  });
  if (error) {
    if (error.code !== 'P0001')
      console.error('list_evidence failed', error.code, error.message);
    return null;
  }
  return (data as { evidence?: EvidenceItem[] } | null)?.evidence ?? [];
}

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
      {items.map((e) => {
        const meta = [
          e.added_at ? formatDateTime(e.added_at) : null,
          e.added_by_name,
          formatBytes(e.size_bytes),
          showTask ? e.task_title : null
        ].filter(Boolean);
        return (
          <li
            key={e.id}
            className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0'
          >
            <div className='min-w-0'>
              <p className='flex flex-wrap items-center gap-2 font-medium'>
                <span className='truncate'>{e.filename ?? 'File'}</span>
                <Badge variant='outline'>
                  {evidenceCategoryLabel(e.category)}
                </Badge>
                {e.current === false && (
                  <Badge variant='secondary'>Replaced</Badge>
                )}
              </p>
              <p className='text-muted-foreground text-xs'>
                {meta.join(' · ')}
              </p>
            </div>
            {e.can_open ? (
              <div className='flex shrink-0 items-center gap-1'>
                <Button asChild size='sm' variant='outline'>
                  <a
                    href={`/api/evidence/${e.id}`}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    <IconExternalLink className='size-4' /> Open
                  </a>
                </Button>
                <Button asChild size='sm' variant='ghost'>
                  <a
                    href={`/api/evidence/${e.id}?download=1`}
                    aria-label={`Download ${e.filename ?? 'file'}`}
                  >
                    <IconDownload className='size-4' /> Download
                  </a>
                </Button>
              </div>
            ) : (
              <span className='text-muted-foreground text-xs'>
                Reference only - no stored file
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
