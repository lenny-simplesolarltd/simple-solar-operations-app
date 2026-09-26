import {
  revokeConversationShare,
  shareConversation
} from '@/features/assistant/server/conversations/shares';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const no = (message: string, status = 400) =>
  Response.json({ ok: false, message }, { status });

/** Creates (or returns) the link for a conversation the caller owns. */
export async function POST(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return no('Sign in first.', 401);
  const { id } = await params;
  if (!UUID.test(id)) return no('That conversation could not be found.', 404);

  const result = await shareConversation(id);
  if (!result.ok) return no(result.message, 404);
  return Response.json(
    { ok: true, shareId: result.shareId },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Turns off every live link for that conversation. */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return no('Sign in first.', 401);
  const { id } = await params;
  if (!UUID.test(id)) return no('That conversation could not be found.', 404);

  const result = await revokeConversationShare(id);
  if (!result.ok) return no(result.message, 404);
  return Response.json(
    { ok: true, revoked: result.revoked },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
