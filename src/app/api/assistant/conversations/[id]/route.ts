import { itemsFromHistory } from '@/features/assistant/lib/history';
import {
  conversationUpdateSchema,
  type ConversationDetail
} from '@/features/assistant/protocol';
import {
  contextProfileFor,
  contextStateFor,
  estimateTokens
} from '@/features/assistant/server/conversations/context-window';
import {
  conversationId,
  conversationRequest,
  errorResponse,
  noStore,
  notFound,
  storeFailure
} from '@/features/assistant/server/conversations/http';
import { resolveProvider } from '@/features/assistant/server/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** One of the staff member's conversations, ready for the drawer to redraw. */
export async function GET(_request: Request, { params }: Params) {
  const ctx = await conversationRequest({ write: false });
  if (!ctx.ok) return ctx.response;
  const id = await conversationId(params);
  if (!id) return notFound();
  try {
    const record = await ctx.store.get(id);
    if (!record) return notFound();
    const messages = await ctx.store.messages(id);
    const provider = resolveProvider();
    const profile = contextProfileFor(provider.ok ? provider.provider.id : '');
    const detail: ConversationDetail = {
      id: record.id,
      title: record.title,
      lastMessageAt: record.lastMessageAt,
      createdAt: record.createdAt,
      archived: record.archived,
      messageCount: record.messageCount,
      jobId: record.jobId,
      summary: record.summary,
      sourceConversationId: record.sourceConversationId,
      contextState: contextStateFor(
        record.estimatedTokens + estimateTokens(record.summary ?? ''),
        profile
      ),
      items: itemsFromHistory(messages)
    };
    return noStore(detail);
  } catch (error) {
    return storeFailure(error);
  }
}

/** Rename, archive or restore. Only the owner's own conversation can change. */
export async function PATCH(request: Request, { params }: Params) {
  const ctx = await conversationRequest({ write: true });
  if (!ctx.ok) return ctx.response;
  const id = await conversationId(params);
  if (!id) return notFound();
  const parsed = conversationUpdateSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return errorResponse(400, 'INVALID_REQUEST', 'That change was not valid.');
  }
  try {
    const record = await ctx.store.update(id, parsed.data);
    if (!record) return notFound();
    return noStore({
      id: record.id,
      title: record.title,
      lastMessageAt: record.lastMessageAt,
      createdAt: record.createdAt,
      archived: record.archived,
      messageCount: record.messageCount,
      jobId: record.jobId
    });
  } catch (error) {
    return storeFailure(error);
  }
}

/** Permanently deletes the conversation and its messages. The drawer asks first. */
export async function DELETE(_request: Request, { params }: Params) {
  const ctx = await conversationRequest({ write: true });
  if (!ctx.ok) return ctx.response;
  const id = await conversationId(params);
  if (!id) return notFound();
  try {
    return (await ctx.store.remove(id)) ? noStore({ ok: true }) : notFound();
  } catch (error) {
    return storeFailure(error);
  }
}
