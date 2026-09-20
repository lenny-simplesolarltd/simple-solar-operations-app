import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { ChatClient } from '@/features/chat/components/chat-client';
import { listConversations, listMessages } from '@/features/chat/queries';
import { resolveJobRefs } from '@/features/chat/server/job-refs';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Team chat | Simple Solar Operations'
};

export default async function TeamChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const permissions = await getPermissions(user);
  if (!permissions.has('communications.chat.use')) redirect('/dashboard');

  const conversations = await listConversations();

  const heading = (
    <Heading
      title='Team chat'
      description='Internal conversations between staff. Nothing here leaves the company.'
    />
  );

  if (!conversations.ok)
    return (
      <PageContainer>
        <div className='flex w-full flex-col gap-4'>
          {heading}
          <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
            {conversations.error.kind === 'unavailable'
              ? 'Team chat is not deployed to this database yet.'
              : conversations.error.message}
          </p>
        </div>
      </PageContainer>
    );

  // Seed the first conversation's job links so the opening render already has
  // them, rather than flashing plain text and then linking.
  const first = conversations.data[0];
  const seed = first ? await listMessages(first.id) : null;
  const jobRefs = await resolveJobRefs(
    seed?.ok ? seed.data.flatMap((m) => m.jobIds) : []
  );

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-4'>
        {heading}
        <ChatClient
          viewerPersonId={user.id}
          viewerName={user.fullName ?? 'You'}
          initialConversations={conversations.data}
          initialJobRefs={jobRefs}
        />
      </div>
    </PageContainer>
  );
}
