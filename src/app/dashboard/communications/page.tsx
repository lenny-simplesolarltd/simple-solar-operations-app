import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { CommunicationsList } from '@/features/communications/components/communications-list';
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
  { value: 'Failed', label: 'Problems' }
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
  const status = view === 'all' ? undefined : (view as CommunicationStatus);

  const result = await listCommunications({ status, limit: 200 });

  const heading = (
    <Heading
      title='Communications'
      description='Messages the system captured for merchants and scaffolders. Approve the wording, record what you sent yourself, and see exactly what has and has not left the building.'
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

        {/* The standing truth about this screen, not a transient banner. */}
        <p className='text-muted-foreground rounded-md border px-3 py-2 text-sm'>
          This system does not send email. It captures the message, records who
          approved it, and records when a person sent it. Anything marked sent
          by a person was sent from their own mailbox.
        </p>

        <ListFilters
          defaults={{ view: 'all' }}
          tabs={{ key: 'view', label: 'Show', options: [...VIEWS] }}
        />

        <CommunicationsList
          communications={result.data.communications}
          can={can}
        />
      </div>
    </PageContainer>
  );
}
