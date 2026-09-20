import { listConversations } from '@/features/chat/queries';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Just the conversation list. Used when a Realtime nudge arrives for a
 * conversation that is not the one on screen — a new message somewhere else
 * still has to move its unread count.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const result = await listConversations();
  if (!result.ok)
    return Response.json({ error: result.error.message }, { status: 400 });
  return Response.json(
    { conversations: result.data },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
