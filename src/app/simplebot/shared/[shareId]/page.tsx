import PageContainer from '@/components/layout/page-container';
import { readSharedConversation } from '@/features/assistant/server/conversations/shares';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Shared conversation | Simple Solar Operations'
};

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A SimpleBot conversation somebody shared, read-only.
 *
 * Signing in is required, and the database still decides: the share is the
 * grant, and a revoked or unknown one is the same answer as a conversation
 * that does not exist. A link forwarded outside the company opens nothing.
 */
export default async function SharedConversationPage({
  params
}: {
  params: Promise<{ shareId: string }>;
}) {
  const user = await getCurrentUser();
  const { shareId } = await params;
  if (!user)
    redirect(
      `/auth/sign-in?next=${encodeURIComponent(`/simplebot/shared/${shareId}`)}`
    );
  if (!UUID.test(shareId)) notFound();

  const shared = await readSharedConversation(shareId);
  if (!shared) notFound();

  return (
    <PageContainer>
      <article className='mx-auto flex w-full max-w-3xl flex-col gap-4'>
        <header className='flex flex-col gap-1 border-b pb-4'>
          <h1 className='text-2xl font-bold'>
            {shared.title ?? 'SimpleBot conversation'}
          </h1>
          <p className='text-muted-foreground text-sm'>
            Shared by {shared.sharedBy ?? 'a colleague'}
            {shared.createdAt && ` · ${formatDate(shared.createdAt)}`}
          </p>
          <p className='text-muted-foreground text-xs'>
            Read-only. What tools SimpleBot used is named; what they returned is
            not shown here. SimpleBot can be wrong — check anything you act on.
          </p>
        </header>

        <ol className='flex flex-col gap-4'>
          {shared.messages.map((message, i) => {
            if (message.tool)
              return (
                <li key={i} className='text-muted-foreground text-xs italic'>
                  SimpleBot used {message.tool}
                </li>
              );
            if (!message.text?.trim()) return null;
            const mine = message.role === 'user';
            return (
              <li
                key={i}
                className={mine ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={
                    mine
                      ? 'bg-secondary text-secondary-foreground max-w-[88%] rounded-lg rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap'
                      : 'max-w-[88%] text-sm whitespace-pre-wrap'
                  }
                >
                  <span className='text-muted-foreground mb-0.5 block text-xs font-medium'>
                    {mine ? (shared.sharedBy ?? 'They') : 'SimpleBot'}
                  </span>
                  {message.text}
                </div>
              </li>
            );
          })}
          {shared.messages.length === 0 && (
            <li className='text-muted-foreground text-sm'>
              This conversation has nothing in it yet.
            </li>
          )}
        </ol>
      </article>
    </PageContainer>
  );
}
