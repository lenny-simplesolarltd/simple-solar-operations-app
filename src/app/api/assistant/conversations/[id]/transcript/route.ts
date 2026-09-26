import { conversationTranscript } from '@/features/assistant/server/conversations/transcript';
import {
  conversationId,
  conversationRequest,
  noStore,
  notFound,
  storeFailure
} from '@/features/assistant/server/conversations/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * One conversation as Markdown, for copying, downloading or sending on.
 *
 * Same gate as every other conversation route: the store runs as the signed-in
 * person under owner-only RLS, so somebody else's conversation is simply not
 * found. Nothing here takes a person id.
 */
export async function GET(_request: Request, { params }: Params) {
  const ctx = await conversationRequest({ write: false });
  if (!ctx.ok) return ctx.response;
  const id = await conversationId(params);
  if (!id) return notFound();
  try {
    const transcript = await conversationTranscript(ctx.store, id);
    if (!transcript) return notFound();
    return noStore({ ok: true, ...transcript });
  } catch (error) {
    return storeFailure(error);
  }
}
