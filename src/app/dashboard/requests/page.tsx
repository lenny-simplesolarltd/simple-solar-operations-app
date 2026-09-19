import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDateTime } from '@/features/jobs/format';
import { getCurrentUser } from '@/lib/auth';
import type { MyRequestsRead, RequestRow } from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'My requests | Simple Solar Operations'
};

// Staff wording for command types (the AppSheet request forms they replace).
const COMMAND_LABEL: Record<string, string> = {
  SOLD_INTAKE: 'Job sold',
  SUBMIT_PRESALE: 'Job sold',
  TASK_COMPLETE: 'Complete task',
  TASK_REOPEN: 'Reopen task',
  TASK_EVIDENCE_ATTACH: 'Attach evidence',
  DEPOSIT_CONFIRM: 'Confirm deposit',
  BOOKING_INTAKE: 'Booking form',
  BOOKING_GATES: 'Re-check booking',
  CONFIRM_BOOKING: 'Confirm booking',
  CALL_RECORD: 'Record call',
  ISSUE_CREATE: 'Raise issue',
  ISSUE_UPDATE: 'Update issue',
  PLANNER_UPDATE: 'Planner change',
  MOVE_JOB: 'Move job',
  CHANGE_INSTALLER: 'Change installer',
  CANCEL_JOB: 'Cancel job',
  REINSTATE_JOB: 'Reinstate job',
  OPERATIONAL_COMPLETE: 'Operational completion',
  COMMISSIONING_REVIEW: 'Commissioning review',
  GOODS_IN_RECEIVE: 'Goods in'
};

const commandLabel = (type: string) =>
  COMMAND_LABEL[type] ??
  type
    .toLowerCase()
    .split('_')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');

type Variant = 'success' | 'warning' | 'danger' | 'outline';
const OUTCOME_VARIANT: Record<string, Variant> = {
  Succeeded: 'success',
  FollowUpRequired: 'warning',
  ActionRequired: 'warning',
  Failed: 'danger'
};

function Outcome({ row }: { row: RequestRow }) {
  if (!row.outcome) return <span className='text-muted-foreground'>-</span>;
  return (
    <span className='flex flex-col items-start gap-1'>
      <Badge variant={OUTCOME_VARIANT[row.outcome.status] ?? 'outline'}>
        {row.outcome.heading}
      </Badge>
      <span className='text-muted-foreground text-xs'>
        {row.outcome.message}
      </span>
    </span>
  );
}

function JobLink({ row }: { row: RequestRow }) {
  if (!row.job_id || !row.job_ref)
    return <span className='text-muted-foreground'>-</span>;
  return (
    <Link
      href={`/dashboard/jobs/${row.job_id}`}
      className='font-mono font-semibold hover:underline'
    >
      {row.job_ref}
    </Link>
  );
}

export default async function RequestsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const result = await readOps<MyRequestsRead>('MY_REQUESTS', { limit: '100' });

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'requests' }} />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='My requests'
          description='Everything you have submitted, newest first, with the result the system recorded.'
        />
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : result.data.requests.length === 0 ? (
          <EmptyState
            title='No requests yet'
            description='Actions you take on jobs and tasks appear here.'
          />
        ) : (
          <>
            <div className='hidden overflow-x-auto rounded-lg border md:block'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.data.requests.map((row) => (
                    <TableRow key={row.command_id}>
                      <TableCell className='whitespace-nowrap'>
                        {formatDateTime(row.created_at)}
                      </TableCell>
                      <TableCell>{commandLabel(row.command_type)}</TableCell>
                      <TableCell>
                        <JobLink row={row} />
                      </TableCell>
                      <TableCell className='max-w-md whitespace-normal'>
                        <Outcome row={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className='flex flex-col gap-2 md:hidden'>
              {result.data.requests.map((row) => (
                <li
                  key={row.command_id}
                  className='bg-card flex flex-col gap-2 rounded-lg border p-3'
                >
                  <div className='flex items-start justify-between gap-2'>
                    <span className='font-medium'>
                      {commandLabel(row.command_type)}
                    </span>
                    <JobLink row={row} />
                  </div>
                  <span className='text-muted-foreground text-xs'>
                    {formatDateTime(row.created_at)}
                  </span>
                  <Outcome row={row} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </PageContainer>
  );
}
