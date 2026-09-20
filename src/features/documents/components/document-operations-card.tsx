import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { formatDateTime } from '@/features/jobs/format';
import Link from 'next/link';

import { DOCUMENT_TYPE_LABELS, type RevisionStatus } from '../types';
import type { DocumentOperationsRead } from '../server/queries';

// Document generation, in the operations centre.
//
// The Job Detail card answers "is my customer's quotation ready?". This
// answers the operator's questions instead: what is queued, what is running,
// what failed and why, how many attempts it has had and when the next one is
// due. Same philosophy as batch task processing - the work is visible, so
// nobody has to read a log to find out whether the system is stuck.

const VARIANT: Record<
  RevisionStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  Queued: 'secondary',
  Generating: 'secondary',
  Ready: 'default',
  Failed: 'destructive',
  Superseded: 'outline'
};

/** Only the states an operator needs at a glance; Ready is the quiet one. */
const HEADLINE: RevisionStatus[] = ['Queued', 'Generating', 'Failed', 'Ready'];

export function DocumentOperationsCard({
  data
}: {
  data: DocumentOperationsRead;
}) {
  // Superseded rows are history, not work. They stay out of the operator's
  // list unless something about them is unfinished.
  const rows = data.revisions.filter((r) => r.status !== 'Superseded');
  const open = rows.filter((r) =>
    ['Queued', 'Generating', 'Failed'].includes(r.status)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Document generation</CardTitle>
        <div className='flex flex-wrap gap-2 pt-1'>
          {HEADLINE.map((status) => (
            <Badge key={status} variant={VARIANT[status]}>
              {status} {data.counts[status] ?? 0}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {open.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nothing queued, running or failed.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>State</TableHead>
                <TableHead className='text-right'>Attempts</TableHead>
                <TableHead>Last attempt</TableHead>
                <TableHead>Next attempt</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {open.map((r) => (
                <TableRow key={r.revision_id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/jobs/${r.job_id}`}
                      className='font-medium hover:underline'
                    >
                      {r.job_reference}
                    </Link>
                    <span className='text-muted-foreground block text-xs'>
                      {r.customer}
                    </span>
                  </TableCell>
                  <TableCell>
                    {DOCUMENT_TYPE_LABELS[r.document_type]}
                    <span className='text-muted-foreground block text-xs'>
                      Revision {r.revision_number}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={VARIANT[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {r.attempt_count}
                  </TableCell>
                  <TableCell className='text-xs'>
                    {r.claimed_at
                      ? formatDateTime(r.claimed_at)
                      : formatDateTime(r.requested_at)}
                  </TableCell>
                  <TableCell className='text-xs'>
                    {r.next_attempt ? formatDateTime(r.next_attempt) : '-'}
                  </TableCell>
                  <TableCell className='max-w-[22rem] text-xs'>
                    {r.error_code ? (
                      <>
                        <span className='font-mono'>{r.error_code}</span>
                        {r.error_detail?.message ? (
                          <span className='text-muted-foreground block'>
                            {r.error_detail.message}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
