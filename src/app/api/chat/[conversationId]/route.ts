import { listConversations, listMessages } from '@/features/chat/queries';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One conversation's messages, plus the conversation list so unread counts
 * stay in step. Used by the chat client to refetch after it sends, and after
 * Realtime says something changed.
 *
 * Authorization is not done here: both reads go through
 * execute_operations_read, which resolves the signed-in person and refuses a
 * conversation they are not a member of. A Realtime event is only ever a nudge
 * to call this - nothing is rendered straight from the socket.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { conversationId } = await params;
  const [messages, conversations] = await Promise.all([
    listMessages(conversationId),
    listConversations()
  ]);

  if (!messages.ok)
    return Response.json(
      { error: messages.error.message },
      { status: messages.error.kind === 'forbidden' ? 403 : 400 }
    );

  return Response.json(
    {
      messages: messages.data,
      conversations: conversations.ok ? conversations.data : []
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
