import PageContainer from '@/components/layout/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { CommunicationActions } from '@/features/communications/components/communication-actions';
import { CommunicationStatusBadge } from '@/features/communications/components/communications-list';
import {
  describeStatus,
  manualReference,
  whyNotDispatchable
} from '@/features/communications/explain';
import { getCommunication } from '@/features/communications/queries';
import { formatDateTime } from '@/features/jobs/format';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { isOfficeClass } from '@/lib/roles';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export default async function CommunicationPage({
  params
}: {
  params: Promise<{ communicationId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (!isOfficeClass(user) && !user.roles.includes('VariationApprover'))
    redirect('/dashboard');

  const { communicationId } = await params;
  const result = await getCommunication(communicationId);
  if (!result.ok) {
    if (result.error.kind === 'not_found') notFound();
    return (
      <PageContainer>
        <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
          {result.error.message}
        </p>
      </PageContainer>
    );
  }

  const comm = result.data;
  const note = describeStatus(comm);
  const blocked = whyNotDispatchable(comm);
  const manualRef = manualReference(comm);
  const permissions = await getPermissions(user);
  const can = {
    approve: permissions.has('communication.approve'),
    send: permissions.has('communication.send'),
    recordSend: permissions.has('communication.record_send')
  };

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-4'>
        <Link
          href='/dashboard/communications'
          className='text-muted-foreground text-sm hover:underline'
        >
          ← All communications
        </Link>

        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading title={comm.subject} description={comm.type} />
          <CommunicationStatusBadge comm={comm} />
        </div>

        <p className='text-muted-foreground rounded-md border px-3 py-2 text-sm'>
          {note.detail}
        </p>

        <CommunicationActions comm={comm} can={can} />
        {blocked && comm.status !== 'Sent' && (
          <p className='text-muted-foreground text-xs italic'>{blocked}</p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Recipients</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-1 text-sm'>
            {comm.recipients.ok && comm.recipients.to.length > 0 ? (
              comm.recipients.to.map((to) => <p key={to}>{to}</p>)
            ) : (
              <p className='text-muted-foreground text-sm'>
                {comm.recipients.detail ??
                  'No readable recipients on this message.'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Message</CardTitle>
          </CardHeader>
          <CardContent>
            {comm.body ? (
              // The captured body is plain text written by the database.
              <pre className='text-sm break-words whitespace-pre-wrap'>
                {comm.body}
              </pre>
            ) : (
              <p className='text-muted-foreground text-sm'>
                No body was captured for this message.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>What happened</CardTitle>
          </CardHeader>
          <CardContent className='text-muted-foreground flex flex-col gap-1 text-sm'>
            {comm.createdAt && <p>Captured {formatDateTime(comm.createdAt)}</p>}
            {comm.approvedAt && (
              <p>Approved {formatDateTime(comm.approvedAt)}</p>
            )}
            {comm.sentAt && (
              <p>
                {manualRef !== null || comm.status === 'Sent'
                  ? 'Recorded as sent'
                  : 'Sent'}{' '}
                {formatDateTime(comm.sentAt)}
              </p>
            )}
            {manualRef && <p>Reference given by the sender: {manualRef}</p>}
            {comm.outbox && (
              <p>
                Queue: {comm.outbox.status}
                {comm.outbox.attemptCount !== null &&
                  ` · ${comm.outbox.attemptCount} attempt(s)`}
                {comm.outbox.responseSummary &&
                  ` · ${comm.outbox.responseSummary}`}
              </p>
            )}
            {comm.jobs.length > 0 && (
              <p>Covers {comm.jobs.length} job(s) on this message.</p>
            )}
          </CardContent>
        </Card>

        {comm.acknowledgements.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Replies recorded</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-2 text-sm'>
              {comm.acknowledgements.map((a) => (
                <p key={a.id}>
                  {a.response}
                  {a.acknowledgedRevision !== null &&
                    ` to rev ${a.acknowledgedRevision}`}
                  {a.receivedAt && ` · ${formatDateTime(a.receivedAt)}`}
                  {a.responseText && ` · ${a.responseText}`}
                </p>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
