import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { MinimiseToPanel } from '@/features/chat/components/chat-dock';
import { ChatFullScreen } from '@/features/chat/components/chat-full-screen';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Team chat | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TeamChatPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const permissions = await getPermissions(user);
  if (!permissions.has('communications.chat.use')) redirect('/dashboard');

  // The conversation to land on, so expanding the floating panel keeps your
  // place. The id is only adopted once the client can actually see it in its
  // own authorized list, so a guessed id in the URL opens nothing.
  const params = await searchParams;
  const raw = params.conversation;
  const conversation = (Array.isArray(raw) ? raw[0] : raw)?.trim();

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading
            title='Team chat'
            description='Internal conversations between staff. Nothing here leaves the company.'
          />
          <MinimiseToPanel />
        </div>
        <ChatFullScreen initialConversationId={conversation || undefined} />
      </div>
    </PageContainer>
  );
}
