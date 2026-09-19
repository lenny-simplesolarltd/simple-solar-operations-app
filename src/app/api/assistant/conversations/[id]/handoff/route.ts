import { handoffRequestSchema } from '@/features/assistant/protocol';
import {
  conversationId,
  conversationRequest,
  errorResponse,
  noStore,
  notFound,
  storeFailure
} from '@/features/assistant/server/conversations/http';
import { summarizeForHandoff } from '@/features/assistant/server/conversations/summary';
import { resolveProvider } from '@/features/assistant/server/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Starts a new conversation from a long one. With a summary, the new
 * conversation carries a compact, server-written handoff note (never the old
 * transcript); either way it links back, and the original stays available.
 */
export async function POST(request: Request, { params }: Params) {
  const ctx = await conversationRequest({ write: true });
  if (!ctx.ok) return ctx.response;
  const id = await conversationId(params);
  if (!id) return notFound();
  const parsed = handoffRequestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return errorResponse(400, 'INVALID_REQUEST', 'That request was not valid.');
  }

  try {
    const source = await ctx.store.get(id);
    if (!source) return notFound();

    let summary: string | null = null;
    if (parsed.data.withSummary) {
      const provider = resolveProvider();
      summary =
        (
          await summarizeForHandoff({
            provider: provider.ok ? provider.provider : null,
            messages: await ctx.store.messages(id),
            previousSummary: source.summary,
            signal: request.signal
          })
        ).text || null;
    }

    const created = await ctx.store.createHandoff({
      sourceId: source.id,
      summary
    });
    return noStore({ id: created.id, summary: created.summary }, 201);
  } catch (error) {
    return storeFailure(error);
  }
}
