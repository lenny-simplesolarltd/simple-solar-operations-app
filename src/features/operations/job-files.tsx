import 'server-only';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { groupEvidence } from './evidence-groups';
import { EvidenceRow, getEvidence } from './evidence-list';
import { JobFileUpload } from './job-file-upload';

/**
 * A job's files, grouped the way staff look for them (Contracts, Photos &
 * installation, ...). public.list_evidence decides what the signed-in person
 * may see; files open through /api/evidence/<id> for one minute.
 */
export async function JobFiles({
  jobId,
  canUpload
}: {
  jobId: string;
  /** Office class: may add files to the job (the database checks assignment). */
  canUpload: boolean;
}) {
  const items = await getEvidence({ job_id: jobId });
  const groups = items ? groupEvidence(items) : [];

  return (
    <div className='flex flex-col gap-4'>
      {canUpload && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Upload a file</CardTitle>
          </CardHeader>
          <CardContent>
            <JobFileUpload jobId={jobId} />
          </CardContent>
        </Card>
      )}

      {items === null ? (
        <Card>
          <CardContent>
            <p className='text-muted-foreground text-sm'>
              Files could not be loaded. Refresh to try again.
            </p>
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Files</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-muted-foreground text-sm'>
              No files have been added to this job yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.key}>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                {group.label}
                <Badge variant='secondary'>{group.files.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className='flex flex-col divide-y text-sm'>
                {group.files.map((e) => (
                  <EvidenceRow key={e.id} item={e} showTask />
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
      <p className='text-muted-foreground text-xs'>
        Files are private. Open and Download use a link that works for 60
        seconds.
      </p>
    </div>
  );
}
