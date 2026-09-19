import {
  conversationRequest,
  noStore,
  storeFailure
} from '@/features/assistant/server/conversations/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The signed-in staff member's own SimpleBot conversations, most recent first. */
export async function GET(request: Request) {
  const ctx = await conversationRequest({ write: false });
  if (!ctx.ok) return ctx.response;
  const archived = new URL(request.url).searchParams.get('archived') === '1';
  try {
    return noStore({ conversations: await ctx.store.list({ archived }) });
  } catch (error) {
    return storeFailure(error);
  }
}
