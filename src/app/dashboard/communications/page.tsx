import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { CommunicationsList } from '@/features/communications/components/communications-list';
import { CommunicationsWorkspace } from '@/features/communications/components/communications-workspace';
import { InboundList } from '@/features/communications/components/inbound-list';
import {
  getEmailTemplates,
  getInboundEmails
} from '@/features/communications/server/templates';
import { listCommunications } from '@/features/communications/queries';
import type { CommunicationStatus } from '@/features/communications/types';
import { ListFilters } from '@/features/operations/list-filters';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { isOfficeClass } from '@/lib/roles';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Communications | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

// 'attention' is not a database status: it is the two states a person has to
// do something about, asked for in one go.
const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'Draft', label: 'Drafts' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Queued', label: 'Queued' },
  { value: 'Sent', label: 'Sent' },
  { value: 'Failed', label: 'Problems' },
  // Not a communications status: the replies are a different table entirely.
  { value: 'received', label: 'Received' }
] as const;

export default async function CommunicationsPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  // Mirrors the communications_select RLS policy. The database checks again.
  if (!isOfficeClass(user) && !user.roles.includes('VariationApprover'))
    redirect('/dashboard');

  const permissions = await getPermissions(user);
  const can = {
    approve: permissions.has('communication.approve'),
    send: permissions.has('communication.send'),
    recordSend: permissions.has('communication.record_send')
  };

  const params = await searchParams;
  const view = VIEWS.some((v) => v.value === first(params.view))
    ? first(params.view)
    : 'all';
  const status =
    view === 'all' || view === 'received'
      ? undefined
      : (view as CommunicationStatus);

  const [result, compose, inbound] = await Promise.all([
    listCommunications({ status, limit: 200 }),
    // Null when this person may not send: the workspace then renders nothing
    // and the screen is the record only.
    can.send ? getEmailTemplates() : Promise.resolve(null),
    view === 'received' && can.send ? getInboundEmails() : Promise.resolve([])
  ]);

  const heading = (
    <Heading
      title='Communications'
      description='Write to a merchant, a scaffolder or a customer, and see exactly what has and has not left the building.'
    />
  );

  // The dispatch layer is a migration; say so plainly rather than showing an
  // empty list that looks like "no messages".
  if (!result.ok && result.error.kind === 'unavailable') {
    return (
      <PageContainer>
        <div className='flex w-full flex-col gap-4'>
          {heading}
          <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
            The communications read is not deployed to this database yet.
            Nothing is missing — the screen needs a backend update before it can
            show anything.
          </p>
        </div>
      </PageContainer>
    );
  }

  if (!result.ok) {
    return (
      <PageContainer>
        <div className='flex w-full flex-col gap-4'>
          {heading}
          <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
            {result.error.message}
          </p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-4'>
        {heading}

        {/* The standing truth about this screen, not a transient banner.
            It used to read "This system does not send email", which was
            written before the dispatch worker existed and stayed on the page
            after it shipped - directly above a list of messages the system
            had sent. The mailbox is read rather than written here: a screen
            that hardcoded it would print the wrong address the day somebody
            changed the setting. Each row already says which route it took. */}
        <p className='text-muted-foreground rounded-md border px-3 py-2 text-sm'>
          Email sent by this system goes from{' '}
          <span className='text-foreground font-medium'>
            {compose?.sendingMailbox ?? 'the office mailbox'}
          </span>
          , and replies come back there. A message the system generated is
          captured first and sent once someone approves the wording; one you
          write yourself sends as you send it. Submitted means the mail service
          accepted it, which is not proof anyone read it — and anything marked
          sent by a person left that person&rsquo;s own mailbox instead.
        </p>

        <CommunicationsWorkspace compose={compose} />

        <ListFilters
          defaults={{ view: 'all' }}
          tabs={{ key: 'view', label: 'Show', options: [...VIEWS] }}
        />

        {view === 'received' ? (
          <InboundList emails={inbound} />
        ) : (
          <CommunicationsList
            communications={result.data.communications}
            can={can}
          />
        )}
      </div>
    </PageContainer>
  );
}
